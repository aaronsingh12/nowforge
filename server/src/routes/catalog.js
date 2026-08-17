import { Router } from 'express';
import { catalog, VARIABLE_TYPES } from '../servicenow/catalog.js';

export const catalogRouter = Router();

catalogRouter.get('/meta', (_req, res) => res.json({ variableTypes: VARIABLE_TYPES }));

catalogRouter.get('/catalogs', async (_req, res, next) => {
  try { res.json(await catalog.listCatalogs()); } catch (err) { next(err); }
});

catalogRouter.get('/categories', async (_req, res, next) => {
  try { res.json(await catalog.listCategories()); } catch (err) { next(err); }
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
