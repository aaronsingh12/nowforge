import { Router } from 'express';
import { getSettings, saveSettings, publicSettings } from '../config/store.js';
import { testConnection, resetAuthCache } from '../servicenow/client.js';
import { getSchema, referenceLookup, tableLookup, clearSchemaCaches, getTableHierarchy } from '../servicenow/schema.js';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  const s = getSettings();
  res.json({
    ok: true,
    connected: Boolean(s.connection.instanceUrl && s.connection.username),
    instanceUrl: s.connection.instanceUrl || null,
    llmProvider: s.llm.provider,
  });
});

systemRouter.get('/settings', (_req, res) => res.json(publicSettings()));

systemRouter.post('/settings', (req, res) => {
  const { connection, llm, agent } = req.body || {};
  // Don't wipe stored secrets when the client sends blanks for untouched fields.
  const cur = getSettings();
  if (connection) {
    if (connection.password === '') delete connection.password;
    if (connection.clientSecret === '') delete connection.clientSecret;
  }
  if (llm && llm.apiKey === '') delete llm.apiKey;
  saveSettings({ connection, llm, agent });
  if (connection) { resetAuthCache(); clearSchemaCaches(); }
  res.json(publicSettings());
  void cur;
});

systemRouter.post('/connection/test', async (_req, res, next) => {
  try { res.json(await testConnection()); } catch (err) { next(err); }
});

systemRouter.get('/schema/:table', async (req, res, next) => {
  try { res.json(await getSchema(req.params.table)); } catch (err) { next(err); }
});

systemRouter.get('/hierarchy/:table', async (req, res, next) => {
  try { res.json({ hierarchy: await getTableHierarchy(req.params.table) }); } catch (err) { next(err); }
});

systemRouter.get('/reference/:table', async (req, res, next) => {
  try {
    res.json(await referenceLookup(req.params.table, req.query.q || '', Number(req.query.limit) || 15));
  } catch (err) { next(err); }
});

systemRouter.get('/tables', async (req, res, next) => {
  try { res.json(await tableLookup(req.query.q || '')); } catch (err) { next(err); }
});
