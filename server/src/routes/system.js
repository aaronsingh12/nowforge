import { Router } from 'express';
import { getSettings, saveSettings, publicSettings, clearConnection } from '../config/store.js';
import { testConnection, resetAuthCache } from '../servicenow/client.js';
import { getSchema, referenceLookup, tableLookup, clearSchemaCaches, getTableHierarchy } from '../servicenow/schema.js';
import { capability, cachedCapability } from '../servicenow/fluent.js';

export const systemRouter = Router();

/**
 * The one source of truth for "is an instance bound" (D-3), which means every
 * page polls it — so it must be fast, and it is: it reads settings and the
 * CACHED capability probe, never the probe itself. Shelling out to `now-sdk`
 * here made this endpoint take 5.5s on a cold cache while eight pages waited
 * on it to decide whether to render. `/api/flows/live/capability` is still the
 * place to ask the SDK a real question.
 */
systemRouter.get('/health', (_req, res) => {
  const s = getSettings();
  const cap = cachedCapability();
  const liveAuthoring = cap
    ? {
      ok: cap.ok,
      cliVersion: cap.cli.version,
      authAlias: cap.auth.alias,
      authVerified: cap.auth.verified,
      scope: cap.workspace.scope,
      managedSources: cap.workspace.sources.length,
      lastInstall: cap.lastInstall,
      fixes: cap.fixes,
    }
    // Not "ok: false" — that would print fix commands for a probe that simply
    // has not run yet.
    : { pending: true };
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
