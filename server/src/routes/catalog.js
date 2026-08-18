import { Router } from 'express';
import { catalog, variableTypes } from '../servicenow/catalog.js';
import {
  listPoliciesForItem, getPolicy, createPolicy, updatePolicy, deletePolicy,
  validatePolicyInput, itemVariables, CONDITION_OPERATORS, ACTION_STATES,
} from '../servicenow/catalogPolicy.js';

export const catalogRouter = Router();

/**
 * Variable types come from the instance's own dictionary, with the hardcoded
 * list as a fallback. `variableTypeSource` tells the UI which one it got —
 * serving stale codes silently is how a variable ships with the wrong type.
 */
catalogRouter.get('/meta', async (_req, res, next) => {
  try {
    const vt = await variableTypes();
    res.json({
      variableTypes: vt.types,
      variableTypeSource: vt.source,
      variableTypeFallbackReason: vt.reason || null,
      conditionOperators: CONDITION_OPERATORS,
      actionStates: ACTION_STATES,
    });
  } catch (err) { next(err); }
});

catalogRouter.get('/catalogs', async (_req, res, next) => {
  try { res.json(await catalog.listCatalogs()); } catch (err) { next(err); }
});

catalogRouter.get('/categories', async (_req, res, next) => {
  try { res.json(await catalog.listCategories()); } catch (err) { next(err); }
});

catalogRouter.post('/categories', async (req, res, next) => {
  try {
    if (!req.body?.title) return res.status(400).json({ message: 'title is required' });
    res.status(201).json(await catalog.createCategory(req.body));
  } catch (err) { next(err); }
});

// ---- Items ----
catalogRouter.get('/items', async (req, res, next) => {
  try { res.json(await catalog.listItems({ search: req.query.search, klass: req.query.class })); } catch (err) { next(err); }
});

catalogRouter.post('/items', async (req, res, next) => {
  try { res.status(201).json(await catalog.createItem(req.body)); } catch (err) { next(err); }
});

catalogRouter.get('/items/:sysId', async (req, res, next) => {
  try { res.json(await catalog.getItemDeep(req.params.sysId)); } catch (err) { next(err); }
});

catalogRouter.patch('/items/:sysId', async (req, res, next) => {
  try { res.json(await catalog.updateItem(req.params.sysId, req.body)); } catch (err) { next(err); }
});

catalogRouter.delete('/items/:sysId', async (req, res, next) => {
  try { res.json(await catalog.deleteItem(req.params.sysId)); } catch (err) { next(err); }
});

// ---- Variables ----
catalogRouter.post('/items/:sysId/variables', async (req, res, next) => {
  try { res.status(201).json(await catalog.createVariable({ cat_item: req.params.sysId }, req.body)); } catch (err) { next(err); }
});

catalogRouter.patch('/variables/:sysId', async (req, res, next) => {
  try { res.json(await catalog.updateVariable(req.params.sysId, req.body)); } catch (err) { next(err); }
});

catalogRouter.delete('/variables/:sysId', async (req, res, next) => {
  try { res.json(await catalog.deleteVariable(req.params.sysId)); } catch (err) { next(err); }
});

/** POST /catalog/items/:sysId/variables/reorder { ids: [...] } — renumbers the whole list. */
catalogRouter.post('/items/:sysId/variables/reorder', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!ids?.length) return res.status(400).json({ message: 'ids (an ordered array of variable sys_ids) is required' });
    const result = await catalog.reorderVariables(ids);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (err) { next(err); }
});

// ---- Choices on a choice-type variable ----
catalogRouter.get('/variables/:sysId/choices', async (req, res, next) => {
  try { res.json(await catalog.listChoices(req.params.sysId)); } catch (err) { next(err); }
});

catalogRouter.post('/variables/:sysId/choices', async (req, res, next) => {
  try { res.status(201).json(await catalog.createChoice(req.params.sysId, req.body || {})); } catch (err) { next(err); }
});

catalogRouter.patch('/choices/:sysId', async (req, res, next) => {
  try { res.json(await catalog.updateChoice(req.params.sysId, req.body || {})); } catch (err) { next(err); }
});

catalogRouter.delete('/choices/:sysId', async (req, res, next) => {
  try { res.json(await catalog.deleteChoice(req.params.sysId)); } catch (err) { next(err); }
});

// ---- UI policies, scoped to an item (C-1) ----
catalogRouter.get('/items/:sysId/policies', async (req, res, next) => {
  try { res.json(await listPoliciesForItem(req.params.sysId)); } catch (err) { next(err); }
});

/** Every variable on the item, sets included, with real choice values. */
catalogRouter.get('/items/:sysId/policy-variables', async (req, res, next) => {
  try { res.json(await itemVariables(req.params.sysId)); } catch (err) { next(err); }
});

/** Dry run: the same checks createPolicy applies, without writing anything. */
catalogRouter.post('/policies/validate', async (req, res, next) => {
  try { res.json(await validatePolicyInput(req.body || {})); } catch (err) { next(err); }
});

/**
 * POST /catalog/policies — SSE, because this compiles and installs through the
 * SDK and takes a minute. The actions cannot be written over REST at all
 * (fluent-research §23), so there is no faster path to fall back to.
 */
catalogRouter.post('/policies', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event) => { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ } };
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
  try {
    const result = await createPolicy(req.body || {}, emit);
    emit({ type: 'done', result });
  } catch (err) {
    emit({ type: 'error', message: err.message, detail: err.detail || null });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

catalogRouter.get('/policies/:sysId', async (req, res, next) => {
  try { res.json(await getPolicy(req.params.sysId)); } catch (err) { next(err); }
});

catalogRouter.patch('/policies/:sysId', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event) => { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ } };
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
  try {
    emit({ type: 'done', result: await updatePolicy(req.params.sysId, req.body || {}, emit) });
  } catch (err) {
    emit({ type: 'error', message: err.message, detail: err.detail || null });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

/** DELETE is a source removal + reinstall, so it streams too. */
catalogRouter.delete('/policies/:sysId', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event) => { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ } };
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 15000);
  try {
    emit({ type: 'done', result: await deletePolicy(req.params.sysId, emit) });
  } catch (err) {
    emit({ type: 'error', message: err.message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

// ---- Variable sets ----
catalogRouter.get('/variable-sets', async (_req, res, next) => {
  try { res.json(await catalog.listVariableSets()); } catch (err) { next(err); }
});

catalogRouter.post('/variable-sets', async (req, res, next) => {
  try { res.status(201).json(await catalog.createVariableSet(req.body)); } catch (err) { next(err); }
});

catalogRouter.get('/variable-sets/:sysId/variables', async (req, res, next) => {
  try { res.json(await catalog.listSetVariables(req.params.sysId)); } catch (err) { next(err); }
});

catalogRouter.post('/variable-sets/:sysId/variables', async (req, res, next) => {
  try { res.status(201).json(await catalog.createVariable({ variable_set: req.params.sysId }, req.body)); } catch (err) { next(err); }
});

catalogRouter.post('/variable-sets/:sysId/attach', async (req, res, next) => {
  try { res.status(201).json(await catalog.attachSetToItem(req.params.sysId, req.body.cat_item)); } catch (err) { next(err); }
});

// ---- Order guides ----
catalogRouter.get('/order-guides', async (_req, res, next) => {
  try { res.json(await catalog.listOrderGuides()); } catch (err) { next(err); }
});

catalogRouter.post('/order-guides', async (req, res, next) => {
  try { res.status(201).json(await catalog.createOrderGuide(req.body)); } catch (err) { next(err); }
});

catalogRouter.delete('/order-guides/:sysId', async (req, res, next) => {
  try { res.json(await catalog.deleteOrderGuide(req.params.sysId)); } catch (err) { next(err); }
});

catalogRouter.get('/order-guides/:sysId/items', async (req, res, next) => {
  try { res.json(await catalog.listGuideItems(req.params.sysId)); } catch (err) { next(err); }
});

catalogRouter.post('/order-guides/:sysId/items', async (req, res, next) => {
  try { res.status(201).json(await catalog.addGuideItem({ ...req.body, guide: req.params.sysId })); } catch (err) { next(err); }
});

// ---- Record producers ----
catalogRouter.get('/record-producers', async (_req, res, next) => {
  try { res.json(await catalog.listRecordProducers()); } catch (err) { next(err); }
});

catalogRouter.post('/record-producers', async (req, res, next) => {
  try { res.status(201).json(await catalog.createRecordProducer(req.body)); } catch (err) { next(err); }
});

catalogRouter.delete('/record-producers/:sysId', async (req, res, next) => {
  try { res.json(await catalog.deleteRecordProducer(req.params.sysId)); } catch (err) { next(err); }
});
