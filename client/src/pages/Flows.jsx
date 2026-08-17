import { useEffect, useState } from 'react';
import { api, sse, val, disp } from '../api.js';

/** Green when live authoring is ready; otherwise the exact commands to fix it. */
function CapabilityBanner({ cap }) {
  if (!cap) return null;
  if (cap.ok) {
    return (
      <div className="note" style={{ borderLeftColor: 'var(--verdigris)' }}>
        <b>Live flow authoring ready.</b>{' '}
        ServiceNow SDK {cap.cli?.version} · credential <span className="mono">{cap.auth?.alias}</span>
        {cap.auth?.host ? <> → <span className="mono">{cap.auth.host}</span></> : null}
        {' '}· scope <span className="mono">{cap.workspace?.scope}</span>
        {cap.auth?.matchesNowForgeInstance === false && (
          <div style={{ marginTop: 6, color: 'var(--amber, #b8860b)' }}>
            Warning: the SDK credential points at a different instance than NowForge is connected to.
            Flows would deploy to <span className="mono">{cap.auth.host}</span>.
          </div>
        )}
        {cap.lastInstall && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
            Last install {cap.lastInstall.ok ? 'succeeded' : 'failed'}
            {cap.lastInstall.activation ? ` — flows activated ${cap.lastInstall.activation}` : ''}
            {cap.lastInstall.at ? ` (${new Date(cap.lastInstall.at).toLocaleString()})` : ''}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="note warn">
      <b>Live flow authoring unavailable.</b> NowForge falls back to blueprint + Business Rule until this is fixed.
      {cap.cli && !cap.cli.present && <div style={{ marginTop: 4 }}>ServiceNow SDK not found.</div>}
      {cap.auth?.error && <div style={{ marginTop: 4 }}>{cap.auth.error}</div>}
      {cap.workspace?.error && <div style={{ marginTop: 4 }}>{cap.workspace.error}</div>}
      {cap.fixes?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {cap.fixes.map((f, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12.5 }}>{f.problem}</div>
              <pre className="mono" style={{ margin: '2px 0 0', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{f.command}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PROGRESS_LABEL = {
  generating: 'Reading the request…',
  intent: 'Intent extracted',
  resolved: 'Resolved references on the instance',
  attempt: 'Generating Fluent TypeScript',
  building: 'Compiling (offline — the instance is untouched)',
  built: 'Compiled cleanly',
  build_failed: 'Compile failed — feeding diagnostics back',
  deploying: 'Installing on the instance',
  verifying: 'Reading the result back',
  done: 'Done',
};

function progressLine(e) {
  const base = PROGRESS_LABEL[e.type] || e.type;
  if (e.type === 'attempt') return `${base} (attempt ${e.attempt}/${e.of})`;
  if (e.type === 'building') return `${base} — ${e.file}`;
  if (e.type === 'intent') return `${base}: ${e.intent?.kind} on ${e.intent?.trigger_table || 'n/a'}`;
  if (e.type === 'resolved') {
    return `${base}: ${e.resolved.map((r) => `${r.search}→${r.matches[0]?.sys_id?.slice(0, 8)}…`).join(', ')}`;
  }
  if (e.type === 'build_failed') return `${base} (attempt ${e.attempt})`;
  return base;
}

/** Spec in → streamed build log → result card. */
function LiveBuild({ capOk, seedSpec, onDeployed }) {
  const [spec, setSpec] = useState('');
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => { if (seedSpec) setSpec(seedSpec); }, [seedSpec]);

  const run = async () => {
    setRunning(true); setEvents([]); setResult(null); setFailure(null);
    try {
      await sse('/flows/live', { spec }, (e) => {
        if (e.type === 'done' && e.result) { setResult(e.result); onDeployed?.(); }
        else if (e.type === 'error') setFailure(e);
        else setEvents((prev) => [...prev, e]);
      });
    } catch (e) {
      setFailure({ message: e.message });
    } finally { setRunning(false); }
  };

  return (
    <div className="card">
      <div className="card-title">Live build — deploy a real flow</div>
      <textarea
        className="textarea"
        placeholder="e.g. When a P1 incident is created for the Network group, notify the group manager and add a work note…"
        value={spec}
        onChange={(e) => setSpec(e.target.value)}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn amber" onClick={run} disabled={running || !spec.trim() || !capOk}>
          {running ? 'Building…' : 'Generate & deploy'}
        </button>
        {!capOk && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Unavailable — see the banner above.</span>}
      </div>

      {events.length > 0 && (
        <div className="card" style={{ marginTop: 12, background: 'transparent' }}>
          {events.map((e, i) => (
            <div key={i} style={{ fontSize: 12.5, padding: '2px 0' }}>
              <span className="mono" style={{ color: 'var(--muted)' }}>›</span> {progressLine(e)}
              {e.type === 'build_failed' && (
                <pre className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--muted)', margin: '4px 0 0' }}>
                  {String(e.diagnostics || '').slice(0, 900)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="note" style={{ marginTop: 12, borderLeftColor: 'var(--verdigris)' }}>
          <div className="row">
            <b>{result.name}</b>
            <span className={`badge ${result.verified?.type === 'subflow' ? 'blue' : ''}`}>{result.verified?.type || 'flow'}</span>
            {result.verified?.active && <span className="badge green">active</span>}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            Compiled on attempt {result.attempts} · flows activated {result.activation} ·
            {' '}{result.verified?.triggers ?? 0} trigger, {result.verified?.actions ?? 0} actions, {result.verified?.logic ?? 0} logic
          </div>
          <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>sys_id {result.verified?.sys_id}</div>
          {result.verified?.link && (
            <a className="btn sm" style={{ marginTop: 8, display: 'inline-block' }} href={result.verified.link} target="_blank" rel="noreferrer">
              Open in ServiceNow
            </a>
          )}
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, marginBottom: 0 }}>{result.shippedNote}</p>
          {result.rollbackUrl && (
            <a className="mono" style={{ fontSize: 11 }} href={result.rollbackUrl} target="_blank" rel="noreferrer">rollback this install</a>
          )}
        </div>
      )}

      {failure && (
        <div className="note warn" style={{ marginTop: 12 }}>
          <b>{failure.stage === 'capability' ? 'Live authoring unavailable' : 'Build failed'}</b>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>{failure.message}</div>
          {failure.attempts && <div style={{ fontSize: 12.5 }}>Attempts: {failure.attempts}</div>}
          {failure.diagnostics && (
            <pre className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 6 }}>
              {String(failure.diagnostics).slice(0, 1500)}
            </pre>
          )}
          {failure.cleanedUp && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              The candidate source was removed; nothing was deployed to the instance.
            </div>
          )}
          {failure.hint && <p className="note" style={{ marginTop: 8 }}>{failure.hint}</p>}
        </div>
      )}
    </div>
  );
}

const VERIFY_LABEL = {
  verify_setup: 'Creating a record that matches the trigger…',
  verify_setup_done: 'Test record created',
  verify_waiting: 'Waiting for the flow to run…',
  verify_execution: 'Execution state',
  verify_assert: 'Assertion',
  verify_cleanup: 'Deleting test data…',
};

function verifyLine(e) {
  const base = VERIFY_LABEL[e.type] || e.type;
  if (e.type === 'verify_setup') return `${base} (${e.table})`;
  if (e.type === 'verify_setup_done') return `${base}: ${e.record}`;
  if (e.type === 'verify_waiting') return `${base} (up to ${e.timeoutSec}s)`;
  if (e.type === 'verify_execution') return `${base}: ${e.state}`;
  if (e.type === 'verify_assert') {
    return `${e.pass ? '✓' : '✗'} ${e.field}: expected "${e.expected}"${e.pass ? '' : `, got "${e.actual ?? ''}"`}`;
  }
  return base;
}

/** Streams a verification run for one managed artifact. */
function VerifyPanel({ name, onClose }) {
  const [events, setEvents] = useState([]);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await sse('/flows/live/verify', { name }, (e) => {
          if (!live) return;
          if (e.type === 'done') setResult(e.result);
          else if (e.type === 'error') setError(e.message);
          else setEvents((prev) => [...prev, e]);
        });
      } catch (e) { if (live) setError(e.message); }
      finally { if (live) setRunning(false); }
    })();
    return () => { live = false; };
  }, [name]);

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="spread">
        <div className="card-title" style={{ marginBottom: 0 }}>Verifying “{name}”</div>
        <button className="btn sm" onClick={onClose} disabled={running}>Close</button>
      </div>
      {events.map((e, i) => (
        <div key={i} style={{ fontSize: 12.5, padding: '2px 0' }}>
          <span className="mono" style={{ color: 'var(--muted)' }}>›</span> {verifyLine(e)}
        </div>
      ))}
      {running && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>running…</div>}

      {result && (
        <div className={`note ${result.ok ? '' : 'warn'}`} style={{ marginTop: 10, borderLeftColor: result.ok ? 'var(--verdigris)' : undefined }}>
          <b>{result.ok ? 'Verified' : 'Verification failed'}</b>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>{result.message}</div>
          {result.execution && (
            <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>
              execution {result.execution.name} — {result.execution.state}
            </div>
          )}
          {result.assertions?.length > 0 && (
            <table className="table" style={{ marginTop: 8 }}>
              <thead><tr><th /><th>Field</th><th>Expected</th><th>Actual</th><th>Proves</th></tr></thead>
              <tbody>
                {result.assertions.map((a, i) => (
                  <tr key={i}>
                    <td><span className={`badge ${a.pass ? 'green' : 'red'}`}>{a.pass ? 'pass' : 'fail'}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{a.table}.{a.field}</td>
                    <td style={{ fontSize: 11.5 }}>{String(a.expected ?? '')}</td>
                    <td style={{ fontSize: 11.5 }}>{a.reason || String(a.actual ?? '')}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--muted)' }}>{a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, marginBottom: 0 }}>
            Test data was deleted. Verification proves the asserted effects on a real execution; it cannot prove
            effects nobody asserted.
          </p>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** NowForge-managed Fluent sources and their live state. */
function ManagedArtifacts({ reloadKey, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState('');

  const load = () => api.get('/flows/live').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadKey]);

  const remove = async (name) => {
    if (!window.confirm(`Delete "${name}" from the instance?\n\nIts Fluent source is removed and the app reinstalled, which deletes the record on the instance.`)) return;
    setBusy(name); setError('');
    try {
      await api.del(`/flows/live/${encodeURIComponent(name)}`);
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  if (!data) return null;
  return (
    <div className="card">
      <div className="card-title">NowForge-managed artifacts</div>
      {data.managed.length === 0 && <div className="empty">Nothing managed yet — build one above.</div>}
      {data.managed.length > 0 && (
        <table className="table">
          <thead><tr><th>Name</th><th>Kind</th><th>On instance</th><th>Verification</th><th /></tr></thead>
          <tbody>
            {data.managed.map((m) => (
              <tr key={m.file + m.name}>
                <td>{m.name}<div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{m.file}</div></td>
                <td><span className={`badge ${m.kind === 'subflow' ? 'blue' : ''}`}>{m.kind}</span></td>
                <td>
                  {m.live
                    ? <span className={`badge ${m.live.active ? 'green' : ''}`}>{m.live.active ? 'active' : 'inactive'}</span>
                    : <span className="badge red">not found</span>}
                </td>
                <td>
                  {m.verification?.available
                    ? <span className="badge">{m.verification.assertions} assertion{m.verification.assertions === 1 ? '' : 's'}</span>
                    : <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>—</span>}
                </td>
                <td>
                  <div className="row">
                    {m.verification?.available && (
                      <button className="btn amber sm" onClick={() => setVerifying(m.name)} disabled={Boolean(verifying)}>
                        Verify
                      </button>
                    )}
                    <button className="btn sm" onClick={() => remove(m.name)} disabled={busy === m.name}>
                      {busy === m.name ? 'Removing…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {verifying && <VerifyPanel name={verifying} onClose={() => setVerifying('')} />}
      {data.staged?.length > 0 && (
        <p className="note" style={{ marginTop: 10 }}>
          Staged (build-verified, deliberately not deployed): <span className="mono">{data.staged.join(', ')}</span>
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function KV({ record, keys }) {
  const rows = keys.filter((k) => disp(record, k));
  if (!rows.length) return null;
  return (
    <dl className="kv">
      {rows.map((k) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className={k.includes('sys_') || k === 'condition' ? 'mono' : ''}>{disp(record, k)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Blueprint({ bp, capOk, onDeploy }) {
  const [ruleResult, setRuleResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = () => {
    const blob = new Blob([JSON.stringify(bp, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(bp.name || 'flow-blueprint').replace(/\W+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const createRule = async () => {
    if (!window.confirm('Create an equivalent Business Rule on the instance? It will be created INACTIVE for your review.')) return;
    setBusy(true); setError('');
    try { setRuleResult(await api.post('/flows/blueprint-to-rule', { blueprint: bp })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const recordTriggered = String(bp.trigger?.type || '').startsWith('record');

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="spread">
        <h3 style={{ fontSize: 15 }}>{bp.name}</h3>
        <div className="row">
          <button className="btn sm" onClick={download}>Download JSON</button>
          {capOk && (
            <button className="btn primary sm" onClick={() => onDeploy?.(bp)}>
              Deploy as real flow
            </button>
          )}
          {recordTriggered && (
            <button className="btn amber sm" onClick={createRule} disabled={busy}>
              {busy ? 'Creating…' : 'Business Rule fallback'}
            </button>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--muted)' }}>{bp.description}</p>

      <div className="card-title">Trigger</div>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="badge green">{bp.trigger?.type}</span>
        {bp.trigger?.table && <span className="badge mono">{bp.trigger.table}</span>}
      </div>
      {bp.trigger?.condition_plain && <p style={{ fontSize: 13, margin: '4px 0' }}>{bp.trigger.condition_plain}</p>}
      {bp.trigger?.condition_encoded_query && <p className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{bp.trigger.condition_encoded_query}</p>}

      <div className="card-title" style={{ marginTop: 12 }}>Steps</div>
      {(bp.steps || []).map((s, i) => (
        <div className="step-row" key={i}>
          <div className="step-num">{s.order ?? i + 1}</div>
          <div>
            <div className="row">
              <span className="badge">{s.kind}</span>
              {s.flow_designer_action && <span className="badge blue">{s.flow_designer_action}</span>}
            </div>
            <p style={{ margin: '4px 0', fontSize: 13 }}>{s.summary}</p>
            {s.config && Object.keys(s.config).length > 0 && (
              <pre className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap', margin: 0 }}>
                {Object.entries(s.config).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}
              </pre>
            )}
          </div>
        </div>
      ))}

      {bp.reference_fields_used?.length > 0 && (
        <>
          <div className="card-title" style={{ marginTop: 12 }}>Reference fields involved</div>
          <table className="table">
            <thead><tr><th>Field</th><th>On table</th><th>References</th></tr></thead>
            <tbody>
              {bp.reference_fields_used.map((r, i) => (
                <tr key={i}><td className="mono">{r.field}</td><td className="mono">{r.table}</td><td className="mono">{r.referenced_table}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {bp.test_plan?.length > 0 && (
        <>
          <div className="card-title" style={{ marginTop: 12 }}>Test plan</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--muted)' }}>
            {bp.test_plan.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </>
      )}
      {bp.notes && <p className="note" style={{ marginTop: 12 }}>{bp.notes}</p>}

      {ruleResult?.rule && (
        <div className="note" style={{ marginTop: 12, borderLeftColor: 'var(--verdigris)' }}>
          Created Business Rule <b>{disp(ruleResult.rule, 'name')}</b> on <span className="mono">{disp(ruleResult.rule, 'collection')}</span> —
          created <b>inactive</b>. Review the script on your instance, then activate.
          <span className="mono" style={{ display: 'block', fontSize: 11 }}>sys_id {val(ruleResult.rule, 'sys_id')}</span>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default function Flows() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [execs, setExecs] = useState([]);
  const [designOpen, setDesignOpen] = useState(false);
  const [designText, setDesignText] = useState('');
  const [bp, setBp] = useState(null);
  const [bpError, setBpError] = useState('');
  const [designing, setDesigning] = useState(false);
  const [error, setError] = useState('');
  const [cap, setCap] = useState(null);
  const [seedSpec, setSeedSpec] = useState('');
  const [managedKey, setManagedKey] = useState(0);

  useEffect(() => {
    api.get('/flows/live/capability').then(setCap).catch(() => setCap({ ok: false, fixes: [] }));
  }, []);

  /** Blueprint → live build: flatten the design into a spec and scroll it into view. */
  const deployBlueprint = (b) => {
    const t = b.trigger || {};
    const lines = [
      `Create an automation named "${b.name}".`,
      b.description ? `Purpose: ${b.description}` : null,
      t.type ? `Trigger: ${t.type}${t.table ? ` on the ${t.table} table` : ''}${t.condition_plain ? ` when ${t.condition_plain}` : ''}.` : null,
      t.condition_encoded_query ? `Trigger condition (encoded query): ${t.condition_encoded_query}` : null,
      t.schedule ? `Schedule: ${t.schedule}` : null,
      'Steps:',
      ...(b.steps || []).map((s, i) => `  ${s.order ?? i + 1}. [${s.kind}] ${s.summary}${s.flow_designer_action ? ` (action: ${s.flow_designer_action})` : ''}`),
    ].filter(Boolean);
    setSeedSpec(lines.join('\n'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const load = () =>
    api.get(`/flows?search=${encodeURIComponent(search)}&type=${typeFilter}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter]);

  const open = async (r) => {
    setError('');
    try {
      const d = await api.get(`/flows/${val(r, 'sys_id')}`);
      setDetail(d);
      setExecs(await api.get(`/flows/executions?flow=${val(r, 'sys_id')}`));
    } catch (e) { setError(e.message); }
  };

  const toggleActive = async () => {
    const id = val(detail.flow, 'sys_id');
    const next = val(detail.flow, 'active') !== 'true';
    try {
      await api.post(`/flows/${id}/active`, { active: next });
      const d = await api.get(`/flows/${id}`);
      setDetail(d);
      load();
    } catch (e) { setError(e.message); }
  };

  const design = async () => {
    setDesigning(true); setBp(null); setBpError('');
    try {
      const r = await api.post('/flows/design', { description: designText });
      if (r.blueprint) setBp(r.blueprint);
      else setBpError(r.error + (r.raw ? ` — ${r.raw.slice(0, 400)}` : ''));
    } catch (e) { setBpError(e.message); }
    finally { setDesigning(false); }
  };

  return (
    <div className="stack">
      <div className="note">
        Flows are authored through ServiceNow's own SDK (Fluent): NowForge generates TypeScript, compiles it
        offline — so nothing reaches the instance unless it compiles — then installs it and reads the result back.
        There is still no REST API for writing <span className="mono">sys_hub_*</span> directly, and NowForge never
        attempts it. Blueprint and the inactive Business Rule remain the fallback tier for environments where the
        SDK cannot run.
      </div>

      <CapabilityBanner cap={cap} />

      <LiveBuild capOk={Boolean(cap?.ok)} seedSpec={seedSpec} onDeployed={() => { setManagedKey((k) => k + 1); load(); }} />

      <ManagedArtifacts reloadKey={managedKey} onChanged={() => load()} />

      <div className="card">
        <div className="spread">
          <div className="card-title" style={{ marginBottom: 0 }}>Design a new automation with AI</div>
          <button className="btn primary sm" onClick={() => setDesignOpen(!designOpen)}>{designOpen ? 'Hide designer' : 'Open designer'}</button>
        </div>
        {designOpen && (
          <div style={{ marginTop: 12 }}>
            <textarea className="textarea" placeholder="e.g. When a P1 incident is created for the Network group, notify the group manager and create a problem task…"
              value={designText} onChange={(e) => setDesignText(e.target.value)} />
            <button className="btn primary" style={{ marginTop: 8 }} onClick={design} disabled={designing || !designText.trim()}>
              {designing ? 'Designing…' : 'Generate blueprint'}
            </button>
            {bpError && <p className="error-text">{bpError}</p>}
            {bp && <Blueprint bp={bp} capOk={Boolean(cap?.ok)} onDeploy={deployBlueprint} />}
          </div>
        )}
      </div>

      <div className="split">
        <div className="card">
          <div className="card-title">Flows &amp; subflows on instance</div>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" placeholder="Search…" value={search}
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <select className="input" style={{ maxWidth: 130 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="flow">Flows</option>
              <option value="subflow">Subflows</option>
            </select>
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Active</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={val(r, 'sys_id')} className={`click ${detail && val(detail.flow, 'sys_id') === val(r, 'sys_id') ? 'selected' : ''}`} onClick={() => open(r)}>
                  <td>{disp(r, 'name')}</td>
                  <td><span className={`badge ${val(r, 'type') === 'subflow' ? 'blue' : ''}`}>{val(r, 'type') || 'flow'}</span></td>
                  <td><span className="badge">{disp(r, 'status') || '—'}</span></td>
                  <td><span className={`badge ${val(r, 'active') === 'true' ? 'green' : ''}`}>{val(r, 'active') === 'true' ? 'on' : 'off'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No flows or subflows found (or not connected).</div>}
          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="card">
          {!detail ? (
            <div className="empty">Select a flow to read it top-to-bottom: trigger, actions, logic, executions.</div>
          ) : (
            <>
              <div className="spread">
                <div className="row">
                  <h3 style={{ fontSize: 16, margin: 0 }}>{disp(detail.flow, 'name')}</h3>
                  <span className={`badge ${val(detail.flow, 'type') === 'subflow' ? 'blue' : ''}`}>
                    {val(detail.flow, 'type') || 'flow'}
                  </span>
                </div>
                <button className="btn sm" onClick={toggleActive}>
                  {val(detail.flow, 'active') === 'true' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
              <p style={{ color: 'var(--muted)' }}>{disp(detail.flow, 'description') || 'No description.'}</p>
              <KV record={detail.flow} keys={['status', 'sys_scope', 'sys_created_by', 'sys_updated_on']} />

              {detail.notes?.length > 0 && detail.notes.map((n, i) => (
                <p className="note" key={i} style={{ marginTop: 8 }}>{n}</p>
              ))}

              <div className="card-title" style={{ marginTop: 14 }}>Trigger{detail.triggers.length !== 1 ? 's' : ''}</div>
              {detail.triggers.length === 0 && <div className="empty">No trigger instances.</div>}
              {detail.triggers.map((t) => (
                <div key={val(t, 'sys_id')} style={{ marginBottom: 8 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="badge green">{disp(t, 'trigger_type') || 'trigger'}</span>
                    {disp(t, 'name') && <span className="badge">{disp(t, 'name')}</span>}
                  </div>
                  {disp(t, 'comment') && <p style={{ margin: '2px 0 6px', fontSize: 12.5, color: 'var(--muted)' }}>{disp(t, 'comment')}</p>}
                  {t.config && Object.keys(t.config).length > 0 && (
                    <dl className="kv">
                      {Object.entries(t.config).map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                          <dt>{k}</dt>
                          <dd className={k === 'condition' || k === 'table' ? 'mono' : ''}>{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}

              <div className="card-title" style={{ marginTop: 14 }}>Actions ({detail.actions.length})</div>
              {detail.actions.length === 0 && <div className="empty">No action instances.</div>}
              {detail.actions.map((a) => (
                <div className="step-row" key={val(a, 'sys_id')}>
                  <div className="step-num">{disp(a, 'order') || '·'}</div>
                  <div>
                    <div className="row">
                      <span className="badge blue">{disp(a, 'action_type') || 'action'}</span>
                      {val(a, 'active') === 'false' && <span className="badge red">inactive</span>}
                    </div>
                    {disp(a, 'comment') && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{disp(a, 'comment')}</p>}
                  </div>
                </div>
              ))}

              {detail.logic.length > 0 && (
                <>
                  <div className="card-title" style={{ marginTop: 14 }}>Flow logic</div>
                  {detail.logic.map((l) => (
                    <div className="step-row" key={val(l, 'sys_id')}>
                      <div className="step-num">{disp(l, 'order') || '·'}</div>
                      <div>
                        <span className="badge amber">{disp(l, 'logic_definition') || 'logic'}</span>
                        {disp(l, 'comment') && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>{disp(l, 'comment')}</p>}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {detail.sourceTables && (
                <p className="mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
                  read from {detail.sourceTables.family} tables · {detail.sourceTables.triggers} · {detail.sourceTables.actions} · {detail.sourceTables.logic}
                </p>
              )}

              <div className="card-title" style={{ marginTop: 14 }}>Recent executions</div>
              {execs.length === 0 && <div className="empty">No execution contexts found.</div>}
              {execs.length > 0 && (
                <table className="table">
                  <thead><tr><th>State</th><th>Started</th><th>Context</th></tr></thead>
                  <tbody>
                    {execs.map((e) => (
                      <tr key={val(e, 'sys_id')}>
                        <td><span className={`badge ${disp(e, 'state')?.toLowerCase().includes('complete') ? 'green' : ''}`}>{disp(e, 'state') || '—'}</span></td>
                        <td className="mono" style={{ fontSize: 11.5 }}>{disp(e, 'sys_created_on')}</td>
                        <td className="mono" style={{ fontSize: 11 }}>{val(e, 'sys_id').slice(0, 12)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
