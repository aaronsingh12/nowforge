import { Router } from 'express';
import { flows, designFlowBlueprint, blueprintToBusinessRule } from '../servicenow/flows.js';

export const flowsRouter = Router();

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
