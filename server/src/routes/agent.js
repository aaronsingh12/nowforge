import { Router } from 'express';
import { runTurn, resolveApproval } from '../agent/orchestrator.js';
import { providerInfo } from '../agent/providers/index.js';
import {
  listSessions,
  createSession,
  getSession,
  renameSession,
  deleteSession,
  loadMessages,
  loadToolEvents,
  loadDigests,
} from '../memory/sessions.js';
import { search, searchSessions, embeddingsAvailable, pullCommand, embedModelName } from '../memory/recall.js';
import { listFacts, recordFact, deleteFact, rememberFromChat, seedLedger } from '../memory/facts.js';
import { estimateTokens, HISTORY_TOKEN_BUDGET } from '../memory/compaction.js';
import { loadHistory } from '../memory/sessions.js';

export const agentRouter = Router();

agentRouter.get('/info', (_req, res) => res.json(providerInfo()));

/* ------------------------------------------------------------------ *
 * Sessions (A-1)
 * ------------------------------------------------------------------ */

agentRouter.get('/sessions', (_req, res) => res.json(listSessions()));

agentRouter.post('/sessions', (req, res) => {
  res.json(createSession({ id: req.body?.id, title: req.body?.title }));
});

agentRouter.get('/sessions/:id', (req, res, next) => {
  const s = getSession(req.params.id);
  if (!s) return next(Object.assign(new Error('No such session.'), { status: 404 }));
  const history = loadHistory(req.params.id);
  res.json({
    ...s,
    // The UI shows this so a session approaching compaction is visible before
    // it happens, rather than the transcript quietly changing shape one turn.
    tokens: { estimated: estimateTokens(history), budget: HISTORY_TOKEN_BUDGET },
    digests: loadDigests(req.params.id).length,
  });
});

agentRouter.get('/sessions/:id/messages', (req, res) => {
  res.json({
    messages: loadMessages(req.params.id),
    digests: loadDigests(req.params.id),
    toolEvents: loadToolEvents(req.params.id),
  });
});

agentRouter.patch('/sessions/:id', (req, res, next) => {
  try { res.json(renameSession(req.params.id, req.body?.title)); }
  catch (err) { next(Object.assign(err, { status: 400 })); }
});

agentRouter.delete('/sessions/:id', (req, res) => res.json(deleteSession(req.params.id)));

/* ------------------------------------------------------------------ *
 * Recall (A-5)
 * ------------------------------------------------------------------ */

/** Mode + the exact pull command, so the UI banner never has to guess. */
agentRouter.get('/memory/status', async (_req, res) => {
  const avail = await embeddingsAvailable();
  res.json({
    mode: avail.ok ? 'semantic' : 'keyword',
    degraded: !avail.ok,
    model: embedModelName(),
    dim: avail.dim,
    reason: avail.reason,
    command: avail.ok ? null : pullCommand(),
  });
});

agentRouter.get('/memory/search', async (req, res, next) => {
  const q = String(req.query.q || '').trim();
  if (!q) return next(Object.assign(new Error('q is required'), { status: 400 }));
  try {
    if (req.query.sessions === 'true') return res.json(await searchSessions(q, { limit: Number(req.query.limit) || 20 }));
    res.json(await search(q, { limit: Number(req.query.limit) || 8, sessionId: req.query.session || null }));
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ *
 * Knowledge ledger (A-4)
 * ------------------------------------------------------------------ */

agentRouter.get('/facts', (req, res) => res.json(listFacts({ kind: req.query.kind || undefined })));

agentRouter.post('/facts', (req, res, next) => {
  try { res.json(recordFact(req.body || {})); }
  catch (err) { next(Object.assign(err, { status: 400 })); }
});

agentRouter.delete('/facts/:id', (req, res) => res.json(deleteFact(Number(req.params.id))));

agentRouter.post('/facts/seed', (_req, res) => res.json(seedLedger()));

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

/**
 * POST /api/agent/chat  { sessionId, message }
 * Streams Server-Sent Events over the POST response body.
 */
agentRouter.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId || !message) {
    return res.status(400).json({ message: 'sessionId and message are required' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ }
  };
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
  try {
    // "remember: ..." is handled before the turn so the fact is in the ledger
    // by the time the system prompt is built, and the agent can confirm it in
    // the same breath rather than a turn late.
    const remembered = rememberFromChat(message);
    if (remembered) emit({ type: 'remembered', fact: remembered });
    await runTurn(sessionId, message, emit);
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

/** POST /api/agent/approve  { sessionId, approvalId, approved } */
agentRouter.post('/approve', (req, res) => {
  const { sessionId, approvalId, approved } = req.body || {};
  const ok = resolveApproval(sessionId, approvalId, approved);
  res.json({ ok });
});
