import { Router } from 'express';
import { getSettings, saveSettings, publicSettings, clearConnection } from '../config/store.js';
import { testConnection, resetAuthCache } from '../servicenow/client.js';
import { getSchema, referenceLookup, tableLookup, clearSchemaCaches, getTableHierarchy } from '../servicenow/schema.js';
import { capability } from '../servicenow/fluent.js';

export const systemRouter = Router();

systemRouter.get('/health', async (_req, res) => {
  const s = getSettings();
  let liveAuthoring = { ok: false, error: null };
  try {
    const cap = await capability();
    liveAuthoring = {
      ok: cap.ok,
      cliVersion: cap.cli.version,
      authAlias: cap.auth.alias,
      authVerified: cap.auth.verified,
      scope: cap.workspace.scope,
      managedSources: cap.workspace.sources.length,
      lastInstall: cap.lastInstall,
      fixes: cap.fixes,
    };
  } catch (err) {
    liveAuthoring = { ok: false, error: err.message };
  }
  res.json({
    ok: true,
    connected: Boolean(s.connection.instanceUrl && s.connection.username),
    instanceUrl: s.connection.instanceUrl || null,
    llmProvider: s.llm.provider,
    liveAuthoring,
  });
});

systemRouter.get('/settings', (_req, res) => res.json(publicSettings()));

systemRouter.post('/settings', (req, res) => {
  const { connection, llm, agent } = req.body || {};
  // Don't wipe stored secrets when the client sends blanks for untouched fields.
  if (connection) {
    if (connection.password === '') delete connection.password;
    if (connection.clientSecret === '') delete connection.clientSecret;
  }
  if (llm && llm.apiKey === '') delete llm.apiKey;
  saveSettings({ connection, llm, agent });
  if (connection) { resetAuthCache(); clearSchemaCaches(); }
  res.json(publicSettings());
});

/** Unbind the instance: clears the stored credentials and every cached derivative. */
systemRouter.post('/connection/disconnect', (_req, res) => {
  clearConnection();
  resetAuthCache();
  clearSchemaCaches();
  res.json({ ok: true, ...publicSettings() });
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
