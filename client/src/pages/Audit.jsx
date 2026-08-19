import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { SkeletonRows, LoadingRegion, EmptyState } from '../components/states.jsx';

/**
 * D-5 — the audit page.
 *
 * The acceptance test is a sentence: reconstruct everything a past session did
 * to the instance — with sys_ids and who approved — from this page alone. Three
 * decisions follow directly from that and are worth stating.
 *
 * **Approval is never rounded up.** `auto` means auto-approve was on and no
 * human ever saw the gate. Rendering that as "approved" would describe a
 * decision that did not happen, which on the one page whose job is trust is
 * the worst available lie. It gets its own badge and its own colour.
 *
 * **Rows written before D-5 say so.** `result`, `instance` and `actor` did not
 * exist until migration 5, so older events have no result to show. An empty
 * cell there means "not recorded", not "nothing came back" — and this page
 * prints which, because those are opposite facts (trap #2's shape, again).
 *
 * **The export is what is on screen.** The CSV honours the same filters rather
 * than dumping the table, because an export that silently differs from the
 * page is worse than no export.
 */

const KIND_LABEL = {
  flow_build: 'flow build + install',
  flow_verify: 'flow verification',
  flow_smoke: 'flow smoke test',
  flow_delete: 'flow delete + reinstall',
  sla_verify: 'SLA verification',
  ui_policy_create: 'UI policy build + install',
  ui_policy_update: 'UI policy update + install',
  ui_policy_delete: 'UI policy delete + reinstall',
};

function ApprovalBadge({ row }) {
  if (row.source === 'build' && row.approval === 'ui') {
    return <span className="badge blue" title="Driven by hand from a NowForge module page.">by hand</span>;
  }
  if (!row.mutating) return <span style={{ color: 'var(--muted)' }}>—</span>;
  switch (row.approval) {
    case 'approved':
      return <span className="badge green" title="A human clicked Approve at the amber gate.">approved</span>;
    case 'rejected':
      return <span className="badge red" title="A human clicked Reject; the tool never ran.">rejected</span>;
    case 'auto':
      return (
        <span className="badge amber" title="Auto-approve was on. No human saw this before it ran.">
          auto · ungated
        </span>
      );
    default:
      return <span className="badge">unrecorded</span>;
  }
}

function StatusBadge({ status }) {
  const tone = status === 'ok' ? 'green'
    : status === 'error' ? 'red'
      : status === 'rejected' ? 'red'
        : status === 'running' ? 'amber' : '';
  return <span className={`badge ${tone}`}>{status || '—'}</span>;
}

/** A payload or a result, collapsed by default — these run to thousands of characters. */
function Block({ label, value, missingNote }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined || value === '') {
    return (
      <div className="audit-block">
        <div className="label">{label}</div>
        <p className="audit-missing">{missingNote || 'Not recorded.'}</p>
      </div>
    );
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  const lines = text.split('\n').length;
  return (
    <div className="audit-block">
      <button className="audit-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {label}
        <span className="audit-size">{lines} line{lines === 1 ? '' : 's'} · {text.length} chars</span>
      </button>
      {open && <pre className="audit-dump mono">{text}</pre>}
    </div>
  );
}

/** The streamed evidence behind a build run, fetched only when asked for. */
function BuildEvents({ runId }) {
  const [state, setState] = useState({ loading: false, events: null, error: null });
  const [open, setOpen] = useState(false);

  const load = async () => {
    setOpen(!open);
    if (open || state.events) return;
    setState({ loading: true, events: null, error: null });
    try {
      const r = await api.get(`/audit/runs/${runId}`);
      setState({ loading: false, events: r.events, error: null });
    } catch (e) {
      setState({ loading: false, events: null, error: e.message });
    }
  };

  return (
    <div className="audit-block">
      <button className="audit-toggle" onClick={load} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> streamed events
        {state.events && <span className="audit-size">{state.events.length}</span>}
      </button>
      {open && state.loading && <><SkeletonRows rows={1} cols={1} /><LoadingRegion label="Loading events" /></>}
      {open && state.error && <p className="error-text">{state.error}</p>}
      {open && state.events && (
        <pre className="audit-dump mono">
          {state.events.map((e) => `${e.ts}  ${e.type || '(untyped)'}  ${JSON.stringify(e.payload)}`).join('\n')}
        </pre>
      )}
    </div>
  );
}

function Row({ row, expanded, onToggle }) {
  const when = new Date(row.ts);
  return (
    <>
      <tr className="click" onClick={onToggle}>
        <td className="mono" style={{ whiteSpace: 'nowrap' }}>
          {when.toLocaleDateString()}<br />
          <span style={{ color: 'var(--muted)' }}>{when.toLocaleTimeString()}</span>
        </td>
        <td>
          <span className={`badge ${row.source === 'build' ? 'blue' : ''}`}>{row.source}</span>
        </td>
        <td>
          <span className="mono">{row.name}</span>
          {row.source === 'build' && KIND_LABEL[row.kind] && (
            <div className="audit-sub">{KIND_LABEL[row.kind]}</div>
          )}
          {row.sessionTitle && <div className="audit-sub">{row.sessionTitle}</div>}
        </td>
        <td>{row.mutating ? <span className="badge amber">mutation</span> : <span className="badge">read</span>}</td>
        <td><ApprovalBadge row={row} /></td>
        <td><StatusBadge status={row.status} /></td>
        <td className="mono audit-ids">
          {row.sysIds.length === 0 ? <span style={{ color: 'var(--muted)' }}>—</span> : row.sysIds.join(' ')}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="audit-detail">
            <dl className="kv" style={{ marginBottom: 10 }}>
              <div style={{ display: 'contents' }}><dt>instance</dt>
                <dd className="mono">{row.instance || <span className="audit-missing">not recorded</span>}</dd></div>
              <div style={{ display: 'contents' }}><dt>account</dt>
                <dd className="mono">{row.actor || <span className="audit-missing">not recorded</span>}</dd></div>
              <div style={{ display: 'contents' }}><dt>session</dt>
                <dd className="mono">{row.session || 'none — driven from a module page'}</dd></div>
              {row.source === 'build' && (
                <div style={{ display: 'contents' }}><dt>run</dt><dd className="mono">{row.id}</dd></div>
              )}
            </dl>
            {row.dropped > 0 && (
              <div className="note warn" style={{ marginBottom: 10 }}>
                {row.dropped} event{row.dropped === 1 ? '' : 's'} could not be written to the audit database during this
                run. What is below is incomplete — the server log has the reason.
              </div>
            )}
            <Block label="request" value={row.payload} />
            <Block
              label="result"
              value={row.result}
              missingNote={
                row.source === 'agent'
                  ? 'Not recorded. Results were only stored from D-5 onwards, so this event predates the column — it does not mean the tool returned nothing.'
                  : 'Not recorded.'
              }
            />
            {row.source === 'build' && <BuildEvents runId={row.id} />}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Audit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState('');
  const [mutatingOnly, setMutatingOnly] = useState(false);
  const [open, setOpen] = useState({});

  const query = useCallback(() => {
    const p = new URLSearchParams();
    if (session) p.set('session', session);
    if (mutatingOnly) p.set('mutating', 'true');
    return p.toString();
  }, [session, mutatingOnly]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api.get(`/audit?${query()}`)); }
    catch (e) { setError(e.message); toast.error(e.message); }
    finally { setLoading(false); }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const rows = data?.rows || [];
  const mutations = rows.filter((r) => r.mutating).length;
  const ungated = rows.filter((r) => r.approval === 'auto').length;

  return (
    <div className="stack">
      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Audit</div>
          <div className="row">
            <button className="btn sm" onClick={load} aria-busy={loading} disabled={loading}>Refresh</button>
            {/* Content-Disposition on the server makes this a download; the
                query string is the page's own filters, so the file matches
                what is on screen rather than dumping the whole table. */}
            <a className="btn primary sm" href={`/api/audit/export.csv?${query()}`} download>
              Export CSV
            </a>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <select className="select" style={{ maxWidth: 340 }} value={session} onChange={(e) => setSession(e.target.value)}>
            <option value="">All activity</option>
            <option value="ui">Driven by hand (no agent session)</option>
            {(data?.sessions || []).map((s) => (
              <option key={s.id} value={s.id}>
                {(s.title || s.id).slice(0, 60)} — {s.events} event{s.events === 1 ? '' : 's'}
                {s.mutations > 0 ? `, ${s.mutations} mutating` : ''}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={mutatingOnly} onChange={(e) => setMutatingOnly(e.target.checked)} />
            Mutations only
          </label>
          <span className="badge" style={{ marginLeft: 'auto' }}>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          <span className="badge amber">{mutations} mutating</span>
          {ungated > 0 && (
            <span className="badge red" title="Auto-approve was on: these ran without anyone seeing the gate.">
              {ungated} ungated
            </span>
          )}
        </div>

        <div className="note">
          Every tool the agent ran and every build driven from a module page, against the bound instance. A row is a
          write only if it says <b>mutation</b>; <b>auto · ungated</b> means auto-approve was on and nobody saw the
          amber gate. NowForge has no user accounts, so "who" is recorded as the decision that was made and the
          ServiceNow account the write landed under — it does not invent a person.
        </div>

        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th><th>Source</th><th>What</th><th>Kind</th>
              <th>Approval</th><th>Result</th><th>sys_ids touched</th>
            </tr>
          </thead>
          {loading && <SkeletonRows rows={8} cols={7} />}
          {!loading && (
            <tbody>
              {rows.map((r) => (
                <Row
                  key={`${r.source}:${r.id}`}
                  row={r}
                  expanded={Boolean(open[`${r.source}:${r.id}`])}
                  onToggle={() => setOpen((o) => ({ ...o, [`${r.source}:${r.id}`]: !o[`${r.source}:${r.id}`] }))}
                />
              ))}
            </tbody>
          )}
        </table>
        {loading && <LoadingRegion label="Loading the audit trail" />}
        {!loading && rows.length === 0 && (
          <EmptyState
            title={session || mutatingOnly ? 'Nothing matches this filter.' : 'Nothing has been done to an instance yet.'}
            hint={session || mutatingOnly
              ? 'Clear the session filter or the mutations-only toggle to see the whole trail.'
              : 'Every tool the agent runs and every build driven from a module page is recorded here, with its request, its result and the sys_ids it touched.'}
            actionLabel={session || mutatingOnly ? 'Clear filters' : null}
            onAction={() => { setSession(''); setMutatingOnly(false); }}
          />
        )}
      </div>
    </div>
  );
}
