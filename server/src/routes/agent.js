import { Router } from 'express';
import { runTurn, resolveApproval } from '../agent/orchestrator.js';
import { providerInfo } from '../agent/providers/index.js';

export const agentRouter = Router();

agentRouter.get('/info', (_req, res) => res.json(providerInfo()));

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
