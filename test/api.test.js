import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connection.js';
import { DEMO_PASSWORD, seedDatabase } from '../src/db/seed.js';
import { stopEvaluationWorker } from '../src/modules/evaluations/evaluations.worker.js';

const app = createApp();
const api = request(app);

async function login(email) {
  const res = await api.post('/api/auth/login').send({ email, password: DEMO_PASSWORD }).expect(200);
  return res.body.token;
}

/** Collects NDJSON events from a streamed response body. */
const parseNdjson = (text) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const waitFor = async (check, { timeoutMs = 5000, intervalMs = 50 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
};

let token;
let otherToken;
const auth = () => ({ Authorization: `Bearer ${token}` });

before(async () => {
  await connectDatabase();
  await seedDatabase();
  token = await login('demo@talentscout.dev');
  otherToken = await login('other@talentscout.dev');
});

after(async () => {
  stopEvaluationWorker();
  await disconnectDatabase();
});

describe('auth', () => {
  it('rejects bad credentials with a generic message', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'demo@talentscout.dev', password: 'wrong' }).expect(401);
    assert.equal(res.body.error.message, 'Invalid email or password');
  });

  it('validates the body', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('requires a token for /api routes', async () => {
    await api.get('/api/projects').expect(401);
    await api.get('/api/projects').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('returns the profile with credits', async () => {
    const res = await api.get('/api/auth/me').set(auth()).expect(200);
    assert.equal(res.body.email, 'demo@talentscout.dev');
    assert.equal(res.body.credits.remaining, 25);
    assert.equal(res.body.passwordHash, undefined);
  });
});

describe('meta', () => {
  it('serves the criteria vocabulary', async () => {
    const res = await api.get('/api/meta/vocabulary').set(auth()).expect(200);
    assert.ok(res.body.skills.includes('React'));
    assert.deepEqual(res.body.seniority, ['junior', 'mid', 'senior', 'lead']);
  });
});

describe('sourcing flow', () => {
  let projectId;
  let searchId;
  let topCandidateId;

  it('creates a project and a search', async () => {
    const project = await api.post('/api/projects').set(auth()).send({ name: 'Frontend hiring Q4' }).expect(201);
    projectId = project.body.id;
    const search = await api.post(`/api/projects/${projectId}/searches`).set(auth()).send({}).expect(201);
    searchId = search.body.id;
    assert.equal(search.body.title, 'Search 1');
    assert.deepEqual(search.body.criteria.skills, []);
  });

  it('lists projects with counts from the aggregation', async () => {
    const res = await api.get('/api/projects').set(auth()).expect(200);
    const project = res.body.find((p) => p.id === projectId);
    assert.equal(project.searchCount, 1);
    assert.equal(project.shortlistCount, 0);
  });

  it('streams a chat turn as NDJSON and stores the criteria', async () => {
    const res = await api
      .post(`/api/searches/${searchId}/chat`)
      .set(auth())
      .send({ text: 'Senior frontend engineer with React and TypeScript, 4+ years' })
      .buffer(true)
      .parse((response, done) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => done(null, body));
      })
      .expect(200)
      .expect('Content-Type', /application\/x-ndjson/);

    const events = parseNdjson(res.body);
    const types = events.map((event) => event.type);
    assert.equal(types[0], 'ack');
    assert.ok(types.includes('criteria'));
    assert.ok(types.includes('delta'));
    assert.equal(types.at(-1), 'done');

    const criteriaEvent = events.find((event) => event.type === 'criteria');
    assert.deepEqual(criteriaEvent.criteria.titles, ['Frontend Engineer']);
    assert.equal(criteriaEvent.criteria.minYears, 4);

    const detail = await api.get(`/api/searches/${searchId}`).set(auth()).expect(200);
    assert.equal(detail.body.messages.length, 2);
    assert.deepEqual(detail.body.criteria.seniority, ['senior']);
    const reply = events.filter((event) => event.type === 'delta').map((event) => event.text).join('');
    assert.equal(detail.body.messages[1].content, reply);
  });

  it('returns ranked, paginated candidates', async () => {
    const res = await api.get(`/api/searches/${searchId}/candidates?page=1&pageSize=5`).set(auth()).expect(200);
    assert.ok(res.body.total > 0, 'expected at least one match');
    assert.ok(res.body.items.length <= 5);
    const scores = res.body.items.map((item) => item.match.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.equal(res.body.items[0].email, undefined, 'contact details must not leak in the list');
    topCandidateId = res.body.items[0].id;
  });

  it('rejects invalid manual criteria and accepts valid ones', async () => {
    await api
      .patch(`/api/searches/${searchId}`)
      .set(auth())
      .send({ criteria: { titles: ['Astronaut'] } })
      .expect(400);

    const detail = await api.get(`/api/searches/${searchId}`).set(auth());
    const criteria = { ...detail.body.criteria, skills: ['React'] };
    const res = await api.patch(`/api/searches/${searchId}`).set(auth()).send({ criteria }).expect(200);
    assert.deepEqual(res.body.criteria.skills, ['React']);
  });

  it('charges one credit for a summary, and nothing for the same summary again', async () => {
    const first = await api.post(`/api/searches/${searchId}/candidates/${topCandidateId}/summary`).set(auth()).expect(200);
    assert.equal(first.body.charged, true);
    assert.equal(first.body.credits.remaining, 24);

    const second = await api.post(`/api/searches/${searchId}/candidates/${topCandidateId}/summary`).set(auth()).expect(200);
    assert.equal(second.body.charged, false);
    assert.equal(second.body.summary, first.body.summary);

    const balance = await api.get('/api/credits/me').set(auth()).expect(200);
    assert.equal(balance.body.remaining, 24);
  });

  it('shortlists idempotently and exports CSV', async () => {
    const first = await api.post(`/api/projects/${projectId}/shortlist`).set(auth()).send({ candidateIds: [topCandidateId], searchId }).expect(201);
    assert.equal(first.body.added, 1);
    const again = await api.post(`/api/projects/${projectId}/shortlist`).set(auth()).send({ candidateIds: [topCandidateId] }).expect(201);
    assert.equal(again.body.alreadyShortlisted, 1);

    const list = await api.get(`/api/projects/${projectId}/shortlist`).set(auth()).expect(200);
    assert.equal(list.body.length, 1);

    const csv = await api.get(`/api/projects/${projectId}/shortlist/export.csv`).set(auth()).expect(200).expect('Content-Type', /text\/csv/);
    assert.match(csv.text, /Name,Title,Seniority/);
    assert.match(csv.headers['content-disposition'], /frontend-hiring-q4-shortlist\.csv/);

    const results = await api.get(`/api/searches/${searchId}/candidates?pageSize=50`).set(auth());
    assert.equal(results.body.items.find((item) => item.id === topCandidateId).shortlisted, true);
  });

  it('runs evaluations in the background and reports results', async () => {
    const start = await api.post(`/api/searches/${searchId}/evaluations`).set(auth()).send({ candidateIds: [topCandidateId] }).expect(202);
    assert.equal(start.body.queued, 1);

    const evaluation = await waitFor(async () => {
      const res = await api.get(`/api/searches/${searchId}/candidates?pageSize=50`).set(auth());
      const item = res.body.items.find((candidate) => candidate.id === topCandidateId);
      return item.evaluation?.status === 'done' && item.evaluation;
    });
    assert.ok(evaluation.checks.length > 0);
    assert.ok(['strong', 'possible', 'weak'].includes(evaluation.verdict));
  });

  it('isolates tenants: another org cannot see or touch this data', async () => {
    const other = { Authorization: `Bearer ${otherToken}` };
    await api.get(`/api/projects/${projectId}`).set(other).expect(404);
    await api.get(`/api/searches/${searchId}`).set(other).expect(404);
    await api.post(`/api/searches/${searchId}/chat`).set(other).send({ text: 'react' }).expect(404);
    const list = await api.get('/api/projects').set(other).expect(200);
    assert.equal(list.body.some((p) => p.id === projectId), false);
  });

  it('returns 400 for malformed ids instead of a server error', async () => {
    await api.get('/api/searches/not-an-id').set(auth()).expect(400);
  });

  it('deletes a project and everything under it', async () => {
    await api.delete(`/api/projects/${projectId}`).set(auth()).expect(204);
    await api.get(`/api/searches/${searchId}`).set(auth()).expect(404);
  });
});

describe('credits', () => {
  it('returns 402 when credits run out and does not record a charge', async () => {
    const other = { Authorization: `Bearer ${otherToken}` };
    const project = await api.post('/api/projects').set(other).send({ name: 'Budget test' }).expect(201);
    const search = await api.post(`/api/projects/${project.body.id}/searches`).set(other).send({}).expect(201);
    await api.post(`/api/searches/${search.body.id}/chat`).set(other).send({ text: 'python data engineer' }).expect(200);
    const results = await api.get(`/api/searches/${search.body.id}/candidates?pageSize=10`).set(other).expect(200);
    assert.ok(results.body.items.length >= 6, 'need more candidates than credits');

    // This account has 5 credits.
    for (const item of results.body.items.slice(0, 5)) {
      await api.post(`/api/searches/${search.body.id}/candidates/${item.id}/summary`).set(other).expect(200);
    }
    const denied = await api.post(`/api/searches/${search.body.id}/candidates/${results.body.items[5].id}/summary`).set(other).expect(402);
    assert.equal(denied.body.error.code, 'INSUFFICIENT_CREDITS');

    const balance = await api.get('/api/credits/me').set(other).expect(200);
    assert.deepEqual(balance.body, { total: 5, used: 5, remaining: 0 });
  });
});
