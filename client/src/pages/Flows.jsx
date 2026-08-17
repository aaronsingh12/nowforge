import { useEffect, useState } from 'react';
import { api, val, disp } from '../api.js';

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

function Blueprint({ bp }) {
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
          {recordTriggered && (
            <button className="btn amber sm" onClick={createRule} disabled={busy}>
              {busy ? 'Creating…' : 'Create Business Rule fallback'}
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
      <div className="note warn">
        ServiceNow exposes no public API for authoring Flow Designer flows — definitions are compiled snapshots.
        NowForge reads flows fully, and for new automations the AI designer produces an exact build spec; record-triggered
        specs can be materialized as a classic Business Rule (created inactive). Direct flow writes are deliberately not shipped.
      </div>

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
            {bp && <Blueprint bp={bp} />}
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
