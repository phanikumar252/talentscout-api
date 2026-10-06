# TalentScout API

Backend for **TalentScout**, a conversational candidate-sourcing tool. A recruiter describes a role in plain
English. The API turns it into structured search criteria, **streams** the assistant's reply, ranks a candidate
pool, and runs background **AI-style evaluations** whose progress is pushed live over **Server-Sent Events**.

Node.js · JavaScript (ES modules) · Express 5 · MongoDB (Mongoose) · Zod · JWT · `node:test` + Supertest

> Frontend: [`talentscout-web`](../talentscout-web) (React + TypeScript + Redux Toolkit).

---

## Quick start

```bash
npm install
cp .env.example .env      # optional: every value has a dev default
npm run dev               # http://localhost:4000
npm test                  # 38 unit + integration tests
```

- **No MongoDB installed?** Leave `MONGODB_URI` empty and the API starts an in-memory MongoDB
  (`mongodb-memory-server`). Data resets on restart.
- **Persistent data:** set `MONGODB_URI` to a local mongod (`mongodb://127.0.0.1:27017`) or a free MongoDB Atlas cluster.
- On first boot it seeds 400 deterministic synthetic candidates and two demo accounts:

| Email | Password | Org | Credits |
|---|---|---|---|
| `demo@talentscout.dev` | `Demo@1234` | Northwind Staffing | 25 |
| `other@talentscout.dev` | `Demo@1234` | Contoso Talent | 5 |

---

## Architecture

```
src/
├── server.js            boot: connect DB → seed → resume jobs → listen; graceful shutdown
├── app.js               express app (helmet, cors, json, request id, routes, errors); no listen, so tests can use it
├── config/env.js        Zod-validated environment; fails fast on bad config
├── db/
│   ├── connection.js    Mongoose connect (or in-memory mongod), builds indexes up front
│   ├── models/index.js  schemas + indexes (unique indexes enforce business rules)
│   ├── plugins.js       shared toJSON: _id → id, no __v
│   └── seed.js          idempotent demo data
├── middleware/          auth (JWT), validate (Zod), errorHandler, requestContext, rateLimits
├── lib/                 errors (AppError), logger (JSON lines), eventBus (pub/sub), password (scrypt), csv
├── engine/              pure functions, no I/O, so they unit-test easily
│   ├── vocabulary.js        canonical roles/skills/locations/companies + aliases
│   ├── interpreter.js       natural language → criteria (incremental: "add X", "drop Y", "not from Z")
│   ├── scoring.js           weighted match score + Mongo pre-filter builder
│   ├── evaluator.js         per-requirement evaluation (met / partial / missing)
│   ├── writer.js            assistant reply + candidate summary text
│   └── candidateGenerator.js deterministic synthetic profiles
└── modules/<feature>/   routes (HTTP only) → service (business rules) → models/repository
    auth · projects · searches · chat · candidates · shortlist · evaluations · credits · meta
```

**Request flow:** `route` validates with Zod into `req.valid`, then calls a **service**. The service enforces tenancy
and business rules and talks to Mongo. Errors are thrown as `AppError` and the central **error handler** maps them to
`{ error: { code, message, details? } }`. Express 5 forwards rejected promises from async handlers automatically,
so the routes need no try/catch.

---

## API

All `/api/*` routes except `/api/auth/login` need `Authorization: Bearer <token>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | → `{ token, user }`. Rate-limited per IP |
| GET | `/api/auth/me` | profile + credits |
| GET | `/api/credits/me` | `{ total, used, remaining }` |
| GET | `/api/meta/vocabulary` | allowed values for hand-edited criteria |
| GET / POST | `/api/projects` | list (with counts via one aggregation) / create |
| GET / PATCH / DELETE | `/api/projects/:projectId` | detail with searches / rename / delete with children |
| POST | `/api/projects/:projectId/searches` | create a search |
| GET / PATCH / DELETE | `/api/searches/:searchId` | detail with transcript / edit title or criteria / delete |
| **POST** | `/api/searches/:searchId/chat` | **NDJSON stream**: `ack → step* → criteria → step* → delta* → done` |
| GET | `/api/searches/:searchId/candidates?page&pageSize` | ranked, annotated with shortlist / evaluation / summary state |
| POST | `/api/searches/:searchId/candidates/:candidateId/summary` | costs 1 credit once; repeats are free |
| POST | `/api/searches/:searchId/evaluations` | `{ candidateIds }` → **202**, work runs in background |
| GET | `/api/searches/:searchId/evaluations/stream` | **SSE**: `snapshot`, then `evaluation` events |
| GET / POST | `/api/projects/:projectId/shortlist` | list / bulk add (idempotent) |
| DELETE | `/api/projects/:projectId/shortlist/:candidateId` | remove |
| GET | `/api/projects/:projectId/shortlist/export.csv` | CSV download |
| GET | `/healthz` | 200 when Mongo is connected, else 503 |

Try the stream from a terminal:

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@talentscout.dev","password":"Demo@1234"}' | jq -r .token)
# create a project + search, then:
curl -N localhost:4000/api/searches/<searchId>/chat -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"text":"senior react dev in austin, 5+ years, not from google"}'
```

---

## Design decisions

**Streaming chat (NDJSON over a POST).** The chat turn is an `async function*` that yields events, and the route writes each one as a line.
- `EventSource` only supports GET without custom headers, but this endpoint needs a body and a Bearer token.
- Headers are flushed early, and `X-Accel-Buffering: no` stops nginx from buffering the stream.
- Once headers are sent, an error can't change the status code, so it goes out as an `error` event inside the stream.
- **Client disconnect** is detected with `res.on('close')`. `req.on('close')` doesn't work for this: on modern Node it fires as soon as the body is read. The disconnect aborts an `AbortController` whose signal cancels the pending delays.

**Background evaluations + SSE.**
- `POST` returns **202** right away. A bounded-concurrency queue (3 workers) processes jobs and publishes each status change to an event bus.
- The SSE endpoint subscribes to `search:<id>`. It sends a heartbeat comment every 20s so proxies don't drop idle connections, and unsubscribes on close.
- Job state lives in Mongo, so `resumePendingEvaluations()` re-queues unfinished work after a restart.
- *At scale* the queue would be BullMQ on Redis and the bus would be Redis pub/sub. Both sit behind small modules (`eventBus.js`, `evaluations.worker.js`), so callers wouldn't change.

**Credits without double-charging, and without transactions.** `chargeOnce` works on a standalone mongod:
1. Insert a ledger row. A **unique index** on `(userId, reason, reference)` means a second attempt for the same item is free.
2. Run an atomic conditional `$inc` with `$expr: used + amount <= total`, so there's no read-modify-write race.
3. If that update fails, delete the ledger row as a compensating action and return **402**.

**Multi-tenancy.**
- The JWT carries `orgId`, and every query filters by it. Tenant ids are never read from request bodies.
- `orgId` is denormalised onto searches, so the ownership check is one indexed `findOne({ _id, orgId })`.
- Another org's ids return **404**, not 403, so callers can't probe which ids exist.

**Search = Mongo pre-filter + in-memory scoring.**
- `buildCandidateFilter` uses indexed fields (`title`, `history.title`, `skills` multikey) and mirrors the scorer's hard rules (excluded employer, open-to-work).
- `scoreCandidate` then applies the weighted score.
- *At scale:* MongoDB Atlas Search or Elasticsearch for retrieval, and an embedding model for semantic matching.

**The "AI" is deterministic on purpose.**
- `engine/interpreter.js` is a rule-based parser, so the project runs offline with no API key and the tests are deterministic.
- An LLM would replace one function: `interpretMessage(text, currentCriteria) → { criteria, changes }` becomes a structured-output call, and `writer.js` becomes the streamed completion. The stream protocol and the UI stay the same.

**Security & hygiene.**
- **Passwords:** scrypt hashing with constant-time compare. Unknown emails take the same time as wrong passwords.
- **Requests:** Helmet headers, a CORS allow-list, a 100 kB JSON limit, Zod validation, and an `ObjectId` regex that turns bad ids into 400s instead of 500s.
- **Rate limits:** per IP on login, per user on chat.
- **Data exposure:** the `email` and `passwordHash` fields are never selected.
- **CSV export:** cells that start like a formula are prefixed to prevent spreadsheet injection.

**Operability.**
- JSON-lines logs with a request id, also returned in `X-Request-Id`.
- `/healthz` reports database status.
- `SIGTERM` stops the worker, closes the server, force-closes open streaming connections after a grace period, then disconnects Mongo.

---

## Testing

`npm test` runs the suite against an in-memory MongoDB. Each test file gets its own database.

- `test/engine.test.js`: interpreter, years parsing, scoring, evaluator, CSV escaping.
- `test/api.test.js`:
  - **Auth:** login and token checks.
  - **Sourcing flow:** project → search → **streamed chat** → ranked results → manual criteria edit.
  - **Credits:** charged once, then free; **402** when exhausted.
  - **Shortlist:** idempotent add, CSV export.
  - **Evaluations:** run in the background.
  - **Robustness:** **tenant isolation**, malformed ids return 400, project delete cascades.

## What I would add next

- A real LLM behind the interpreter (structured outputs), keeping the same event protocol.
- Redis (BullMQ + pub/sub) so evaluations and SSE scale across instances.
- Refresh tokens in httpOnly cookies, plus user invites and roles within an org.
- OpenAPI spec generated from the Zod schemas.
