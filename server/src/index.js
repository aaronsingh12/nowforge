import express from 'express';
import cors from 'cors';
import { systemRouter } from './routes/system.js';
import { incidentsRouter } from './routes/incidents.js';
import { catalogRouter } from './routes/catalog.js';
import { flowsRouter } from './routes/flows.js';
import { agentRouter } from './routes/agent.js';
import { slaRouter } from './routes/sla.js';
import { accessRouter } from './routes/access.js';
import { auditRouter } from './routes/audit.js';
import { applicationsRouter } from './routes/applications.js';
import { transportRouter } from './routes/transport.js';
import { logsRouter } from './routes/logs.js';
import { log, requestLogger, banner } from './logging.js';
import { SnowError } from './servicenow/client.js';
import { getDb } from './memory/db.js';
import { seedLedger } from './memory/facts.js';
import { getSettings } from './config/store.js';
import { DB_PATH } from './memory/db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
// Before the routes, so a request is logged even when it 404s.
app.use(requestLogger());

app.use('/api/system', systemRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/sla', slaRouter);
app.use('/api/access', accessRouter);
app.use('/api/audit', auditRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/transport', transportRouter);
app.use('/api/logs', logsRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err instanceof SnowError ? err.status : (err.status || 500);
  // The terminal gets the stack; the browser gets the message. Before this,
  // a 500 was a red box in the UI and nothing anywhere else.
  log.error('http', `${req.method} ${req.originalUrl.split('?')[0]} — ${err.message}`, err.detail ? { detail: err.detail, stack: err.stack } : err);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: err.message || 'Internal error',
    detail: err.detail || null,
  });
});

// A crash in an async handler must not die silently in a detached terminal.
process.on('unhandledRejection', (reason) => log.error('process', 'unhandled promise rejection', reason));
process.on('uncaughtException', (err) => { log.error('process', 'uncaught exception', err); process.exit(1); });

const PORT = Number(process.env.PORT) || 4000;

// Storage comes up before the listener: migrations are idempotent, and a
// database that cannot open should stop the server rather than fail the first
// chat turn with something unrecognisable.
getDb();
const seeded = seedLedger();

app.listen(PORT, () => {
  const s = getSettings();
  banner([
    `NowHelpAssist  ·  http://localhost:${PORT}`,
    `instance   ${s.connection.instanceUrl || '(none bound)'}`,
    `model      ${s.llm.provider} · ${s.llm.model || '(default)'}`,
    `storage    ${DB_PATH}`,
    `ledger     ${seeded.seeded} facts for ${seeded.instance}`,
    `log level  ${log.level}   (LOG_LEVEL=debug for polls and reads)`,
  ]);
});
