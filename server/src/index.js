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
import { SnowError } from './servicenow/client.js';
import { getDb } from './memory/db.js';
import { seedLedger } from './memory/facts.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/system', systemRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/flows', flowsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/sla', slaRouter);
app.use('/api/access', accessRouter);
app.use('/api/audit', auditRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err instanceof SnowError ? err.status : (err.status || 500);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: err.message || 'Internal error',
    detail: err.detail || null,
  });
});

const PORT = Number(process.env.PORT) || 4000;

// Storage comes up before the listener: migrations are idempotent, and a
// database that cannot open should stop the server rather than fail the first
// chat turn with something unrecognisable.
getDb();
const seeded = seedLedger();

app.listen(PORT, () => {
  console.log(`NowHelpAssist server listening on http://localhost:${PORT}`);
  console.log(`  memory: ${seeded.seeded} ledger facts for ${seeded.instance}`);
});
