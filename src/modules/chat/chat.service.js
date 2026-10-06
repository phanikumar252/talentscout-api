import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../../config/env.js';
import { Message } from '../../db/models/index.js';
import { interpretMessage } from '../../engine/interpreter.js';
import { rankCandidates } from '../../engine/scoring.js';
import { composeReply } from '../../engine/writer.js';
import { findCandidatePool } from '../candidates/candidates.repository.js';
import { saveCriteria } from '../searches/searches.service.js';

/**
 * One chat turn as an async generator of events. The route writes each event
 * as one NDJSON line, and the generator stays transport-agnostic and easy to test.
 *
 * Events, in order:
 *   ack      { messageId }                 user message stored
 *   step     { id, label }                 progress ("Reading your request"…)
 *   criteria { criteria, changes }         updated structured search
 *   delta    { text }                      next chunk of the assistant reply
 *   done     { messageId, total }          assistant message stored
 * (the route adds `error` if something fails mid-stream)
 *
 * @param {{ search: any, text: string, signal: AbortSignal }} input
 */
export async function* runChatTurn({ search, text, signal }) {
  const pause = (ms = env.STREAM_DELAY_MS) => delay(ms, undefined, { signal });
  const steps = [];
  const step = (id, label) => {
    steps.push({ id, label });
    return { type: 'step', id, label };
  };

  const userMessage = await Message.create({ searchId: search._id, role: 'user', content: text });
  yield { type: 'ack', messageId: String(userMessage._id) };

  yield step('interpret', 'Reading your request');
  await pause(env.STREAM_DELAY_MS * 8);
  const { criteria, changes } = interpretMessage(text, search.criteria.toObject());
  await saveCriteria(search, criteria);
  yield { type: 'criteria', criteria, changes };

  yield step('search', 'Searching the candidate pool');
  await pause(env.STREAM_DELAY_MS * 8);
  const ranked = rankCandidates(await findCandidatePool(criteria), criteria);
  yield step('rank', ranked.length ? `Ranked ${ranked.length} matching profiles` : 'No profiles matched');

  // Stream the reply word by word, the way an LLM response arrives.
  const reply = composeReply({ criteria, changes, total: ranked.length, top: ranked.slice(0, 3) });
  for (const chunk of reply.match(/\S+\s*/g) ?? []) {
    await pause();
    yield { type: 'delta', text: chunk };
  }

  const assistantMessage = await Message.create({
    searchId: search._id,
    role: 'assistant',
    content: reply,
    meta: { steps, changes, total: ranked.length },
  });
  yield { type: 'done', messageId: String(assistantMessage._id), total: ranked.length };
}
