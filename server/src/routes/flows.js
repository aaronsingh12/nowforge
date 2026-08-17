import { Router } from 'express';
import { flows, designFlowBlueprint, blueprintToBusinessRule } from '../servicenow/flows.js';
import { capability, createLiveFlow, listManaged, removeManaged, smokeRun, verify } from '../servicenow/fluent.js';

export const flowsRouter = Router();

/* ---------------- live authoring (Fluent SDK) ----------------
 * Registered before '/:sysId' so "live" is not read as a sys_id. */

flowsRouter.get('/live/capability', async (req, res, next) => {
  try { res.json(await capability({ deep: req.query.deep === 'true', force: req.query.force === 'true' })); }
  catch (err) { next(err); }
});

flowsRouter.get('/live', async (_req, res, next) => {
  try { res.json(await listManaged()); } catch (err) { next(err); }
});

/**
 * POST /api/flows/live { spec } | { blueprint }
 * Streams SSE progress, mirroring /api/agent/chat.
 */
flowsRouter.post('/live', async (req, res) => {
  const { spec, blueprint } = req.body || {};
  const text = spec || (blueprint ? blueprintToSpec(blueprint) : null);
  if (!text) return res.status(400).json({ message: 'spec (or blueprint) is required' });

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
    const result = await createLiveFlow(text, emit);
    emit(result.ok ? { type: 'done', result } : { type: 'error', ...result });
  } catch (err) {
    emit({ type: 'error', message: err.message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

/**
 * POST /api/flows/live/verify { name }
 * Runs the stored verification spec: setup → wait → assert → cleanup, streamed.
 * This CREATES a real record (and deletes it again), so it is never automatic.
 */
flowsRouter.post('/live/verify', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ message: 'name is required' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event) => { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ } };
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
  try {
    const result = await verify(name, emit);
    emit({ type: 'done', result });
  } catch (err) {
    emit({ type: 'error', message: err.message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

/**
 * POST /api/flows/live/smoke { table, values, wait_ms }
 * Explicitly fires a flow by creating (and then deleting) a matching record.
 * Never invoked as part of a deploy — the caller has to ask for it.
 */
flowsRouter.post('/live/smoke', async (req, res, next) => {
  try {
    const { table, values, wait_ms } = req.body || {};
    if (!table || !values) return res.status(400).json({ message: 'table and values are required' });
    const result = await smokeRun({ table, values, waitMs: wait_ms || 45000 });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (err) { next(err); }
});

flowsRouter.delete('/live/:name', async (req, res, next) => {
  try {
    const result = await removeManaged(decodeURIComponent(req.params.name));
    res.status(result.ok ? 200 : 422).json(result);
  } catch (err) { next(err); }
});

/** A blueprint is already a precise design — flatten it into a spec sentence set. */
function blueprintToSpec(bp) {
  const t = bp.trigger || {};
  const lines = [
    `Create an automation named "${bp.name}".`,
    bp.description ? `Purpose: ${bp.description}` : null,
    t.type ? `Trigger: ${t.type}${t.table ? ` on the ${t.table} table` : ''}${t.condition_plain ? ` when ${t.condition_plain}` : ''}.` : null,
    t.condition_encoded_query ? `Trigger condition (encoded query): ${t.condition_encoded_query}` : null,
    t.schedule ? `Schedule: ${t.schedule}` : null,
    'Steps:',
    ...(bp.steps || []).map((s, i) => `  ${s.order ?? i + 1}. [${s.kind}] ${s.summary}${s.flow_designer_action ? ` (action: ${s.flow_designer_action})` : ''}`),
  ].filter(Boolean);
  return lines.join('\n');
}

flowsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await flows.list({
      search: req.query.search,
      activeOnly: req.query.active === 'true',
      type: req.query.type || 'all',
    }));
  } catch (err) { next(err); }
});

flowsRouter.get('/executions', async (req, res, next) => {
  try { res.json(await flows.executions(req.query.flow)); } catch (err) { next(err); }
});

flowsRouter.get('/:sysId', async (req, res, next) => {
  try { res.json(await flows.detail(req.params.sysId)); } catch (err) { next(err); }
});

flowsRouter.post('/:sysId/active', async (req, res, next) => {
  try { res.json(await flows.setActive(req.params.sysId, Boolean(req.body.active))); } catch (err) { next(err); }
});

flowsRouter.post('/design', async (req, res, next) => {
  try {
    if (!req.body?.description) return res.status(400).json({ message: 'description is required' });
    res.json(await designFlowBlueprint(req.body.description));
  } catch (err) { next(err); }
});

flowsRouter.post('/blueprint-to-rule', async (req, res, next) => {
  try {
    if (!req.body?.blueprint) return res.status(400).json({ message: 'blueprint is required' });
    const result = await blueprintToBusinessRule(req.body.blueprint);
    if (result.error) return res.status(422).json({ message: result.error, ...result });
    res.status(201).json(result);
  } catch (err) { next(err); }
});
