import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from '../config/store.js';
import { chatOnce } from '../agent/providers/index.js';
import { getSchema, referenceLookup } from './schema.js';
import { flows } from './flows.js';
import { table } from './client.js';

const pexec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const WORKSPACE = path.join(SERVER_ROOT, 'fluent-workspace');
const FLOWS_DIR = path.join(WORKSPACE, 'src/fluent/flows');
const STAGED_DIR = path.join(WORKSPACE, 'staged');
const STATE_FILE = path.join(SERVER_ROOT, 'data/fluent-state.json');
const CHEATSHEET = path.join(REPO_ROOT, 'docs/fluent-flow-cheatsheet.md');

const MAX_ATTEMPTS = 3;
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const QUICK_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Live Flow Designer authoring via the ServiceNow SDK (Fluent).
 *
 * Pipeline: plain-language spec → LLM-generated Fluent TypeScript → OFFLINE
 * `now-sdk build` (compile rejection never touches the instance) → serialized
 * `now-sdk install` → read-back through flows.detail().
 *
 * Hygiene invariants — these are load-bearing, because `now-sdk install`
 * deploys the ENTIRE application every time (there is no per-file deploy):
 *   (a) only build-validated sources may sit in src/fluent when install runs;
 *   (b) a generation candidate that never compiles is deleted before the error
 *       is returned, and the workspace is rebuilt to resync keys.ts;
 *   (c) every build/install runs through one serialized queue — concurrent runs
 *       would race on the shared dist/ output and on keys.ts;
 *   (d) one source file per artifact family, named by a deterministic slug, so
 *       regenerating a spec overwrites the same file and Now.ID keeps sys_ids
 *       stable instead of creating duplicates.
 *
 * The CLI is only ever invoked with fixed literal arguments — no user input is
 * ever passed to it — and it is spawned as `node <sdk entry>` rather than
 * through a shell, so there is no command-injection surface. Anything that
 * needs user-supplied values (read-back by name) goes through the REST client.
 */

/* ------------------------------------------------------------------ *
 * SDK process plumbing
 * ------------------------------------------------------------------ */

let sdkEntryCache;

/**
 * Resolve the SDK's JS entry point. On Windows the `now-sdk` binary is a .cmd
 * shim, which Node refuses to execFile (EINVAL) and which would otherwise force
 * `shell: true`. Running the entry with the current Node binary avoids both.
 */
function resolveSdkEntry() {
  if (sdkEntryCache !== undefined) return sdkEntryCache;
  const rel = 'node_modules/@servicenow/sdk/bin/index.js';
  const candidates = [
    process.env.SN_SDK_ENTRY,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', rel),
    '/usr/local/lib/' + rel,
    '/usr/lib/' + rel,
    path.join(WORKSPACE, rel),
    path.join(REPO_ROOT, rel),
  ].filter(Boolean);
  sdkEntryCache = candidates.find((c) => fs.existsSync(c)) || null;
  return sdkEntryCache;
}

const stripAnsi = (s) => String(s || '').replace(/\[[0-9;]*m/g, '');

/** Runs the SDK. Never throws on a non-zero exit — the caller inspects `code`. */
async function runSdk(args, timeout = QUICK_TIMEOUT_MS) {
  const entry = resolveSdkEntry();
  if (!entry) {
    return { ok: false, code: -1, stdout: '', stderr: 'ServiceNow SDK not found. Install it with: npm i -g @servicenow/sdk', missing: true };
  }
  try {
    const { stdout, stderr } = await pexec(process.execPath, [entry, ...args], {
      cwd: WORKSPACE,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, code: 0, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) };
  } catch (err) {
    return {
      ok: false,
      code: err.code ?? -1,
      stdout: stripAnsi(err.stdout),
      stderr: stripAnsi(err.stderr) || err.message,
      timedOut: err.killed === true,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Invariant (c): one build/install at a time
 * ------------------------------------------------------------------ */

let queueTail = Promise.resolve();
let queueDepth = 0;

function serialize(job) {
  queueDepth += 1;
  const run = queueTail.then(job, job);
  queueTail = run.then(
    () => { queueDepth -= 1; },
    () => { queueDepth -= 1; }
  );
  return run;
}

/* ------------------------------------------------------------------ *
 * Persisted state (last install)
 * ------------------------------------------------------------------ */

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

/* ------------------------------------------------------------------ *
 * Source-file helpers — invariant (d)
 * ------------------------------------------------------------------ */

export function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'flow';
}

const sourcePath = (name) => path.join(FLOWS_DIR, `${slugify(name)}.now.ts`);

/**
 * Names/kinds declared in a Fluent source. Convenience only — the instance
 * read-back is the authority for what actually exists.
 */
export function parseArtifacts(source) {
  const out = [];
  const re = /\b(Subflow|Flow)\s*\(/g;
  let m;
  while ((m = re.exec(source))) {
    const window = source.slice(m.index, m.index + 800);
    const name = window.match(/name:\s*['"]([^'"]+)['"]/)?.[1];
    if (name) out.push({ kind: m[1] === 'Subflow' ? 'subflow' : 'flow', name });
  }
  return out;
}

async function listSourceFiles() {
  try {
    const entries = await fsp.readdir(FLOWS_DIR);
    return entries.filter((f) => f.endsWith('.now.ts'));
  } catch { return []; }
}

/* ------------------------------------------------------------------ *
 * capability()
 * ------------------------------------------------------------------ */

function parseAuthList(stdout) {
  // Blocks look like:  *[alias]\n  host = https://...\n  type = basic\n  username = admin
  const creds = [];
  const re = /(\*?)\[([^\]]+)\]([\s\S]*?)(?=\n\s*\*?\[|$)/g;
  let m;
  while ((m = re.exec(stdout))) {
    const body = m[3];
    const field = (k) => body.match(new RegExp(`${k}\\s*=\\s*(\\S+)`))?.[1] || null;
    creds.push({
      alias: m[2],
      isDefault: m[1] === '*' || /default\s*=\s*Yes/i.test(body),
      host: field('host'),
      type: field('type'),
      username: field('username'),
    });
  }
  return creds;
}

let capCache = { at: 0, value: null };
const CAP_TTL_MS = 30_000;

/**
 * Capability probe.
 *
 * Cost note: every `now-sdk` invocation pays ~5s of CLI start-up, so a real
 * authenticated round-trip costs ~8s. The default (shallow) probe therefore
 * avoids the instance entirely:
 *   - CLI presence/version : `now-sdk --version`
 *   - stored credentials   : `now-sdk auth --list`  (reads the local credential
 *                            store; proves a credential EXISTS and which host
 *                            it targets — it does NOT prove it still works)
 * `deep: true` additionally runs `now-sdk query sys_user -q user_name=admin
 * -f sys_id --limit 1`, the cheapest genuinely authenticated SDK command, which
 * is what actually proves the credential is valid.
 */
export async function capability({ deep = false, force = false } = {}) {
  if (!deep && !force && capCache.value && Date.now() - capCache.at < CAP_TTL_MS) {
    return capCache.value;
  }

  const fixes = [];
  const entry = resolveSdkEntry();

  // --- CLI ---
  const cli = { present: Boolean(entry), entry, version: null, error: null };
  if (!entry) {
    cli.error = 'ServiceNow SDK not found on this machine.';
    fixes.push({ problem: 'SDK CLI missing', command: 'npm i -g @servicenow/sdk' });
  } else {
    const v = await runSdk(['--version']);
    if (v.ok) cli.version = v.stdout.trim().split('\n').pop().trim();
    else {
      cli.error = (v.stderr || 'now-sdk --version failed').slice(0, 400);
      fixes.push({ problem: 'SDK CLI not runnable', command: 'npm i -g @servicenow/sdk@latest' });
    }
  }

  // --- auth ---
  const settings = getSettings();
  const nowforgeHost = (settings.connection.instanceUrl || '').replace(/\/+$/, '');
  const auth = {
    credentials: [], alias: null, host: null, username: null,
    verified: 'unknown', matchesNowForgeInstance: null, error: null,
  };
  if (cli.present && !cli.error) {
    const a = await runSdk(['auth', '--list']);
    if (a.ok) {
      auth.credentials = parseAuthList(a.stdout);
      const def = auth.credentials.find((c) => c.isDefault) || auth.credentials[0] || null;
      if (def) {
        auth.alias = def.alias;
        auth.host = def.host;
        auth.username = def.username;
        auth.verified = 'stored';
        if (nowforgeHost && def.host) {
          auth.matchesNowForgeInstance = def.host.replace(/\/+$/, '') === nowforgeHost;
        }
      } else {
        auth.error = 'No stored SDK credentials.';
        fixes.push({
          problem: 'SDK not authenticated',
          command: `now-sdk auth --add ${nowforgeHost || 'https://<instance>.service-now.com'} --type basic --alias nowforge`,
        });
      }
    } else {
      auth.error = (a.stderr || 'now-sdk auth --list failed').slice(0, 400);
    }
  }

  if (deep && auth.alias) {
    const probe = await runSdk(['query', 'sys_user', '-q', 'user_name=admin', '-f', 'sys_id', '--limit', '1', '-o', 'json']);
    if (probe.ok && /"ok"\s*:\s*true/.test(probe.stdout)) {
      auth.verified = 'live';
    } else {
      auth.verified = 'failed';
      auth.error = (probe.stderr || probe.stdout || 'Authenticated probe failed').slice(0, 400);
      fixes.push({
        problem: 'Stored SDK credential rejected by the instance',
        command: `now-sdk auth --add ${auth.host || nowforgeHost} --type basic --alias ${auth.alias}`,
      });
    }
  }

  // --- workspace ---
  const workspace = {
    path: WORKSPACE, exists: fs.existsSync(WORKSPACE),
    scope: null, appName: null, sources: [], staged: [], error: null,
  };
  try {
    const cfg = JSON.parse(await fsp.readFile(path.join(WORKSPACE, 'now.config.json'), 'utf8'));
    workspace.scope = cfg.scope;
    workspace.appName = cfg.name;
  } catch (err) {
    workspace.error = `now.config.json unreadable: ${err.message}`;
    fixes.push({
      problem: 'Fluent workspace missing',
      command: 'now-sdk init --appName "NowForge Flows" --packageName nowforge-flows --scopeName x_2196302_nwforge --template base',
    });
  }
  workspace.sources = await listSourceFiles();
  try { workspace.staged = (await fsp.readdir(STAGED_DIR)).filter((f) => f.endsWith('.now.ts')); } catch { /* optional */ }
  if (!fs.existsSync(path.join(WORKSPACE, 'node_modules'))) {
    workspace.error = (workspace.error ? workspace.error + ' ' : '') + 'Workspace dependencies not installed.';
    fixes.push({ problem: 'Workspace dependencies missing', command: 'npm install --prefix server/fluent-workspace' });
  }

  const cheatsheet = { path: CHEATSHEET, present: fs.existsSync(CHEATSHEET) };
  if (!cheatsheet.present) {
    fixes.push({ problem: 'Codegen cheatsheet missing', command: 'restore docs/fluent-flow-cheatsheet.md' });
  }

  const state = readState();
  const value = {
    ok: Boolean(cli.present && !cli.error && auth.alias && !workspace.error && cheatsheet.present && auth.verified !== 'failed'),
    cli,
    auth,
    workspace,
    cheatsheet,
    llm: { provider: settings.llm.provider, model: settings.llm.model || null },
    lastInstall: state.lastInstall || null,
    queueDepth,
    fixes,
    checkedAt: new Date().toISOString(),
  };
  if (!deep) capCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------------ *
 * generate()
 * ------------------------------------------------------------------ */

const INTENT_SYSTEM = `You extract structured intent from a ServiceNow automation request. Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "name": "short human name for the automation",
  "kind": "flow" | "subflow" | "flow+subflow",
  "trigger_kind": "record_created" | "record_updated" | "record_created_or_updated" | "scheduled" | "none",
  "trigger_table": "servicenow table name, or null for scheduled/subflow",
  "lookups": [ { "table": "sys_user_group|sys_user|sc_category|cmdb_ci|...", "name": "the exact proper noun from the request" } ]
}
"lookups" must list every proper noun the request names that has to become a real record reference (groups, people, categories, CIs). Use [] if there are none.`;

async function extractIntent(spec) {
  // Budgets are deliberately generous: reasoning models bill hidden reasoning
  // tokens against max_tokens, so a tight budget yields an empty completion.
  const raw = await chatOnce({ system: INTENT_SYSTEM, user: spec, maxTokens: 3000 });
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return { name: null, kind: 'flow', trigger_kind: 'record_created', trigger_table: null, lookups: [] };
  }
}

/**
 * Build the live-context block: real field names from the trigger table and
 * real sys_ids for every proper noun the spec named. The model is told to use
 * these and never to invent an identifier.
 */
async function buildLiveContext(intent) {
  const parts = [];
  const resolved = [];

  if (intent.trigger_table) {
    try {
      const schema = await getSchema(intent.trigger_table);
      const interesting = schema.fields
        .filter((f) => !f.name.startsWith('sys_') || ['sys_id', 'sys_created_on'].includes(f.name))
        .slice(0, 120)
        .map((f) => {
          const ref = f.reference ? ` -> ${f.reference}` : '';
          // Choices MUST carry value=label pairs. Emitting bare values lets the
          // model guess the mapping — which produced `risk=4` (Low) for a spec
          // that asked for High risk, on an instance where High is 2.
          const ch = f.choices?.length
            ? ` choices[${f.choices.slice(0, 12).map((c) => `${c.value}=${c.label}`).join(', ')}]`
            : '';
          return `  ${f.name} (${f.type}${ref})${ch}`;
        });
      parts.push(
        `REAL SCHEMA for "${intent.trigger_table}" (hierarchy: ${schema.hierarchy.join(' -> ')}). Use these exact field names.\n` +
        `For any choice field, use the numeric VALUE from choices[...] — never the label, and never assume a conventional ordering:\n${interesting.join('\n')}`
      );
    } catch (err) {
      parts.push(`Schema for "${intent.trigger_table}" could not be read: ${err.message}. Use only field names you are certain of.`);
    }
  }

  for (const l of intent.lookups || []) {
    if (!l?.table || !l?.name) continue;
    try {
      const hits = await referenceLookup(l.table, l.name, 5);
      if (hits.length) {
        resolved.push({ table: l.table, search: l.name, matches: hits });
        parts.push(`RESOLVED REFERENCE "${l.name}" on ${l.table}:\n${hits.map((h) => `  sys_id=${h.sys_id} display=${h.display}`).join('\n')}`);
      } else {
        parts.push(`NO MATCH on ${l.table} for "${l.name}". Do NOT invent a sys_id — match by name in an encoded query instead (e.g. assignment_group.name=${l.name}).`);
      }
    } catch (err) {
      parts.push(`Reference lookup failed for "${l.name}" on ${l.table}: ${err.message}. Match by name in an encoded query instead.`);
    }
  }

  return { text: parts.join('\n\n'), resolved };
}

const HARD_RULES = `HARD RULES — a violation fails the build:
1. Output ONE complete TypeScript source file and NOTHING else. No prose, no markdown fences, no explanation.
2. Every $id must be Now.ID['snake_case_key'], unique within the file. NEVER write a literal sys_id as an $id.
3. NEVER assign a data pill to a variable. wfa.dataPill(...) goes inline in an action parameter. Capturing an ACTION RESULT in a const is required and correct.
4. TemplateValue, Time, Duration and Now.ID are globals — using them is fine, importing them is an error.
5. Conditions are encoded queries inside template literals: \`\${wfa.dataPill(x, 'string')}=1\`. No JavaScript, no ==, no &&.
6. Template literals interpolate ONLY in ah_subject and log_message. Never in ah_body, SMS message, or inside TemplateValue({...}).
7. lookUpRecord outputs .Record/.Table; lookUpRecords outputs .Records/.Count — capitalised. createRecord/updateRecord output lowercase .record.
8. Per-action value keys differ: values (createRecord/updateRecord), field_values (createTask/updateMultipleRecords), fields (createOrUpdateRecord). lookUpRecord(s) take table + conditions.
9. If the body never reads params, declare the callback () => { — noUnusedParameters is enforced (TS6133). Scheduled flows always use () =>.
10. Exactly one wfa.trigger(...) for a Flow; a Subflow has none and must be exported as \`export const\`, with assignSubflowOutputs on every reachable path.
11. waitForCompletion belongs in the subflow INPUTS object (3rd arg), not the instance config (2nd arg).
12. Use the resolved sys_ids given below. If a name was not resolved, match by name in an encoded query — never invent an identifier.`;

async function readCheatsheet() {
  try { return await fsp.readFile(CHEATSHEET, 'utf8'); } catch { return ''; }
}

/**
 * Generate one Fluent source file from a plain-language spec.
 * `priorError` carries build diagnostics back into the prompt on a retry.
 */
export async function generate(spec, { intent, context, priorSource, priorError } = {}) {
  const cheatsheet = await readCheatsheet();
  const system = [
    'You are a ServiceNow Fluent SDK code generator. You emit ServiceNow Flow Designer flows as TypeScript for @servicenow/sdk v4.',
    HARD_RULES,
    '--- SYNTAX REFERENCE (authoritative, build-verified) ---',
    cheatsheet,
  ].join('\n\n');

  const userParts = [`AUTOMATION REQUEST:\n${spec}`];
  if (context?.text) userParts.push(`--- LIVE INSTANCE CONTEXT ---\n${context.text}`);
  if (intent?.name) userParts.push(`Use this as the artifact name: "${intent.name}"`);
  if (priorSource && priorError) {
    userParts.push(
      `YOUR PREVIOUS ATTEMPT FAILED TO COMPILE. Fix it.\n\n--- PREVIOUS SOURCE ---\n${priorSource}\n\n--- COMPILER DIAGNOSTICS ---\n${priorError}\n\nReturn the COMPLETE corrected file, not a patch.`
    );
  }
  userParts.push('Return only the TypeScript source.');

  const raw = await chatOnce({ system, user: userParts.join('\n\n'), maxTokens: 12000 });
  return extractSource(raw);
}

/** Models fence code despite instructions; take the fenced block when present. */
export function extractSource(raw) {
  const text = String(raw || '');
  const fenced = text.match(/```(?:typescript|ts|javascript|js)?\s*\r?\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/* ------------------------------------------------------------------ *
 * validate() + deploy()
 * ------------------------------------------------------------------ */

function extractDiagnostics(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  const lines = text.split('\n').filter((l) => /ERROR|error TS|Build failed|diagnostic/i.test(l));
  return (lines.length ? lines.join('\n') : text).slice(0, 6000).trim();
}

async function build() {
  return serialize(() => runSdk(['build'], BUILD_TIMEOUT_MS));
}

/**
 * Write a candidate into src/ and compile it. Retries with the compiler's own
 * diagnostics fed back to the model. On terminal failure the candidate file is
 * removed and the workspace rebuilt, so a failed generation leaves nothing
 * behind in src/ and never reaches the instance — invariants (a) and (b).
 */
export async function generateAndValidate(spec, emit = () => {}) {
  const settings = getSettings();
  emit({ type: 'generating' });

  const intent = await extractIntent(spec);
  emit({ type: 'intent', intent });

  const context = await buildLiveContext(intent);
  if (context.resolved.length) emit({ type: 'resolved', resolved: context.resolved });

  let source = null;
  let file = null;
  let lastDiagnostics = null;
  const attempts = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    emit({ type: 'attempt', attempt, of: MAX_ATTEMPTS });

    source = await generate(spec, {
      intent,
      context,
      priorSource: attempt > 1 ? source : undefined,
      priorError: attempt > 1 ? lastDiagnostics : undefined,
    });

    const artifacts = parseArtifacts(source);
    const name = intent.name || artifacts[0]?.name || 'Generated Flow';
    // Invariant (d): deterministic filename, so regeneration overwrites in place.
    const nextFile = sourcePath(name);
    if (file && file !== nextFile) { await fsp.rm(file, { force: true }); }
    file = nextFile;

    await fsp.mkdir(FLOWS_DIR, { recursive: true });
    await fsp.writeFile(file, source, 'utf8');

    emit({ type: 'building', attempt, file: path.basename(file) });
    const res = await build();

    if (res.ok) {
      emit({ type: 'built', attempt });
      return { ok: true, source, file, name, artifacts, intent, context, attempts: attempt };
    }

    lastDiagnostics = extractDiagnostics(res);
    attempts.push({ attempt, diagnostics: lastDiagnostics });
    emit({ type: 'build_failed', attempt, diagnostics: lastDiagnostics });
  }

  // Terminal failure — clean up so src/ holds only build-validated sources.
  if (file) await fsp.rm(file, { force: true });
  const cleanup = await build();

  const hint = settings.llm.provider === 'ollama'
    ? 'The configured provider is Ollama. Fluent codegen is demanding; switching to a stronger provider (Anthropic/OpenAI) in Settings is the first lever if generation keeps failing.'
    : null;

  return {
    ok: false,
    attempts: MAX_ATTEMPTS,
    diagnostics: lastDiagnostics,
    history: attempts,
    lastSource: source,
    cleanedUp: cleanup.ok,
    cleanupError: cleanup.ok ? null : extractDiagnostics(cleanup),
    hint,
    message: `Generation failed after ${MAX_ATTEMPTS} attempts. The candidate was removed and nothing was deployed.`,
  };
}

function parseInstall(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  return {
    activation: text.match(/Flow activation complete:\s*(\d+\/\d+)\s*succeeded/i)?.[1] || null,
    rollbackUrl: text.match(/(https?:\/\/\S*sys_rollback_context\.do\?sys_id=\w+)/i)?.[1] || null,
    appUrl: text.match(/(https?:\/\/\S*sys_app\.do\?sys_id=\w+)/i)?.[1] || null,
  };
}

/**
 * Install the workspace and read the result back off the instance.
 * `now-sdk install` ships the WHOLE application, so the returned `shipped` list
 * names every artifact the deploy touched — not just the requested one.
 */
export async function deploy(name, emit = () => {}) {
  emit({ type: 'deploying' });
  const res = await serialize(() => runSdk(['install'], INSTALL_TIMEOUT_MS));
  const parsed = parseInstall(res);

  writeState({
    lastInstall: {
      at: new Date().toISOString(),
      ok: res.ok,
      activation: parsed.activation,
      rollbackUrl: parsed.rollbackUrl,
      requested: name || null,
    },
  });

  if (!res.ok) {
    return { ok: false, message: 'now-sdk install failed.', diagnostics: extractDiagnostics(res), ...parsed };
  }

  emit({ type: 'verifying' });
  const settings = getSettings();
  const base = (settings.connection.instanceUrl || '').replace(/\/+$/, '');

  // Everything currently in src/ shipped — be transparent about whole-app semantics.
  const files = await listSourceFiles();
  const shipped = [];
  for (const f of files) {
    const src = await fsp.readFile(path.join(FLOWS_DIR, f), 'utf8').catch(() => '');
    for (const a of parseArtifacts(src)) shipped.push({ ...a, file: f });
  }

  let verified = null;
  if (name) {
    const hits = await flows.findByName(name);
    const row = hits[0];
    if (row) {
      const sysId = row.sys_id?.value ?? row.sys_id;
      const detail = await flows.detail(sysId);
      verified = {
        sys_id: sysId,
        name: detail.flow.name?.value ?? detail.flow.name,
        type: detail.flow.type?.value ?? detail.flow.type,
        active: (detail.flow.active?.value ?? detail.flow.active) === 'true',
        link: base ? `${base}/nav_to.do?uri=sys_hub_flow.do?sys_id=${sysId}` : null,
        sourceTables: detail.sourceTables,
        triggers: detail.triggers.length,
        actions: detail.actions.length,
        logic: detail.logic.length,
        notes: detail.notes,
      };
    }
  }

  return {
    ok: true,
    ...parsed,
    verified,
    shipped,
    shippedNote: `now-sdk install deploys the whole application: this install shipped ${shipped.length} artifact(s) from ${files.length} source file(s).`,
  };
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

/** Full pipeline: spec → validated source → install → read-back. */
export async function createLiveFlow(spec, emit = () => {}) {
  const cap = await capability();
  if (!cap.ok) {
    return { ok: false, stage: 'capability', message: 'Live Fluent authoring is not available in this environment.', capability: cap };
  }

  const gen = await generateAndValidate(spec, emit);
  if (!gen.ok) return { ok: false, stage: 'validate', ...gen };

  const dep = await deploy(gen.name, emit);
  if (!dep.ok) return { ok: false, stage: 'deploy', ...dep, source: gen.source };

  // No terminal 'done' here — the caller (route) emits it with the full result,
  // and emitting a bare one first would give consumers two terminal events.
  return {
    ok: true,
    name: gen.name,
    file: path.basename(gen.file),
    artifacts: gen.artifacts,
    attempts: gen.attempts,
    source: gen.source,
    ...dep,
  };
}

/** Managed artifacts: the source files, plus their live state on the instance. */
export async function listManaged() {
  const files = await listSourceFiles();
  const out = [];
  for (const f of files) {
    const src = await fsp.readFile(path.join(FLOWS_DIR, f), 'utf8').catch(() => '');
    for (const a of parseArtifacts(src)) {
      let live = null;
      try {
        const hits = await flows.findByName(a.name);
        const row = hits[0];
        if (row) {
          live = {
            sys_id: row.sys_id?.value ?? row.sys_id,
            active: (row.active?.value ?? row.active) === 'true',
            type: row.type?.value ?? row.type,
            updated: row.sys_updated_on?.value ?? row.sys_updated_on,
          };
        }
      } catch (err) { live = { error: err.message }; }
      out.push({ file: f, name: a.name, kind: a.kind, live });
    }
  }
  const staged = await fsp.readdir(STAGED_DIR).catch(() => []);
  return { managed: out, staged: staged.filter((f) => f.endsWith('.now.ts')) };
}

/**
 * Delete a managed artifact. Removing the source is the SDK's own deletion
 * mechanism: the build marks the record `deleted: true` in keys.ts (retaining
 * its sys_id) and the next install removes it from the instance. Now.del() is
 * reserved for out-of-box records the SDK never created.
 */
export async function removeManaged(name, emit = () => {}) {
  const file = sourcePath(name);
  if (!fs.existsSync(file)) {
    return { ok: false, message: `No managed source file for "${name}" (expected ${path.basename(file)}).` };
  }
  const src = await fsp.readFile(file, 'utf8');
  const artifacts = parseArtifacts(src);

  await fsp.rm(file, { force: true });
  emit({ type: 'building' });
  const b = await build();
  if (!b.ok) {
    return { ok: false, message: 'Build failed after removing the source; nothing was deployed.', diagnostics: extractDiagnostics(b) };
  }

  const dep = await deploy(null, emit);
  if (!dep.ok) return { ok: false, ...dep };

  // Confirm removal by read-back rather than trusting the install output.
  const stillThere = [];
  for (const a of artifacts) {
    const hits = await flows.findByName(a.name).catch(() => []);
    if (hits.length) stillThere.push(a.name);
  }

  return {
    ok: stillThere.length === 0,
    removed: artifacts.map((a) => a.name),
    stillPresent: stillThere,
    message: stillThere.length
      ? `Install completed but ${stillThere.join(', ')} is still present on the instance.`
      : `Removed ${artifacts.map((a) => a.name).join(', ')} from the instance.`,
    ...dep,
  };
}

/**
 * Optional smoke run: create a record that should match a flow's trigger, wait
 * for an execution context, then delete the record again.
 *
 * This writes real data to the instance, so it is NEVER run automatically as
 * part of a deploy — the UI exposes it as an explicit button and the agent must
 * request it as its own approved tool call.
 */
export async function smokeRun({ table: tableName, values, waitMs = 45_000 }, emit = () => {}) {
  if (!tableName || !values || typeof values !== 'object') {
    return { ok: false, message: 'table and values are required for a smoke run.' };
  }

  emit({ type: 'smoke_creating', table: tableName });
  const created = await table.create(tableName, values);
  const sysId = created.sys_id?.value ?? created.sys_id;
  const label = created.number?.value ?? created.name?.value ?? sysId;

  const deadline = Date.now() + waitMs;
  let executions = [];
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      executions = await table.query('sys_flow_context', {
        query: `source_record=${sysId}`,
        fields: 'sys_id,name,state,sys_created_on',
        limit: 10,
      });
      if (executions.length) break;
      emit({ type: 'smoke_waiting', elapsedMs: waitMs - (deadline - Date.now()) });
    }

    // Give in-flight actions a moment to land before reading the record back.
    if (executions.length) await new Promise((r) => setTimeout(r, 4000));
    const after = await table.get(tableName, sysId);

    emit({ type: 'smoke_cleanup' });
    return {
      ok: executions.length > 0,
      record: { sys_id: sysId, label },
      executions: executions.map((e) => ({
        name: e.name?.display_value ?? e.name,
        state: e.state?.display_value ?? e.state,
        created: e.sys_created_on?.value ?? e.sys_created_on,
      })),
      recordAfter: after,
      message: executions.length
        ? `Flow executed: ${executions.length} execution context(s) for ${label}.`
        : `No execution context appeared within ${Math.round(waitMs / 1000)}s for ${label}. The trigger condition may not match this record.`,
    };
  } finally {
    // The test record is always removed, even if polling threw.
    await table.remove(tableName, sysId).catch(() => {});
  }
}

export const fluent = {
  capability, createLiveFlow, generateAndValidate, deploy,
  listManaged, removeManaged, smokeRun, slugify, parseArtifacts,
};
