import { useEffect, useState } from 'react';
import { api, sse } from '../api.js';
import { TableField } from '../components/ReferenceField.jsx';

/**
 * SLA definitions.
 *
 * Two things on this page exist because of behaviours that produce a wrong
 * result rather than an error, and both are shown before the write rather than
 * explained after it: conditions are checked field-by-field against the target
 * table (a start condition on a field that does not exist attaches the SLA to
 * every record), and a schedule that `schedule_source` does not switch on is
 * marked inert on the definition itself.
 */

const EMPTY = {
  name: '',
  collection: 'incident',
  duration: '4h',
  type: 'SLA',
  target: 'resolution',
  start_condition: '',
  stop_condition: '',
  pause_condition: '',
  schedule: '',
  schedule_source: 'no_schedule',
  duration_type: '',
  timezone_source: 'sla.timezone',
  when_to_cancel: 'no_match',
  retroactive: false,
  active: true,
};

export default function Sla() {
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ search: '', collection: '' });
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [check, setCheck] = useState(null);      // dry-run validation
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);
  const [run, setRun] = useState(null);          // verification events + result

  const load = async () => {
    setError('');
    try {
      const qs = new URLSearchParams({ search: filters.search, collection: filters.collection }).toString();
      setRows(await api.get(`/sla?${qs}`));
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { api.get('/sla/meta').then(setMeta).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.collection]);

  const openNew = () => { setForm({ ...EMPTY }); setEditingId(null); setCheck(null); setNotice(null); };

  const openEdit = (r) => {
    setSelected(r);
    setEditingId(r.sys_id);
    setCheck(null); setNotice(null); setRun(null);
    setForm({
      name: r.name,
      collection: r.collection,
      duration: r.duration.seconds ?? '',
      type: r.type || 'SLA',
      target: r.target || 'resolution',
      start_condition: r.conditions.start,
      stop_condition: r.conditions.stop,
      pause_condition: r.conditions.pause,
      schedule: r.schedule?.sys_id || '',
      schedule_source: r.schedule_source,
      duration_type: r.duration_type?.sys_id || '',
      timezone_source: r.timezone_source || 'sla.timezone',
      when_to_cancel: r.when_to_cancel || 'no_match',
      retroactive: r.retroactive,
      active: r.active,
    });
  };

  /** Dry run: the same checks the write applies, with nothing written. */
  const validate = async () => {
    setBusy(true); setError('');
    try { setCheck(await api.post('/sla/validate', form)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(''); setNotice(null);
    try {
      const result = editingId ? await api.patch(`/sla/${editingId}`, form) : await api.post('/sla', form);
      setNotice(result);
      setEditingId(result.sys_id);
      setCheck(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete SLA definition "${form.name}"? Running clocks on existing records are not removed by this.`)) return;
    setBusy(true); setError('');
    try {
      const out = await api.del(`/sla/${editingId}`);
      setNotice(out);
      setForm(null); setEditingId(null); setSelected(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  /** Verification writes a real record and deletes it again — its own button. */
  const verify = async (name) => {
    setRun({ events: [], result: null });
    setError('');
    try {
      await sse('/sla/verify', { name }, (ev) => {
        setRun((r) => (ev.type === 'done'
          ? { ...r, result: ev.result }
          : ev.type === 'error'
            ? { ...r, result: { ok: false, message: ev.message } }
            : { ...r, events: [...r.events, ev] }));
      });
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="stack">
      <div className="split">
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>SLA definitions</div>
            <button className="btn primary sm" onClick={openNew}>New SLA</button>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Search by name…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && load()} />
            <input className="input mono" style={{ width: 140 }} placeholder="table"
              value={filters.collection}
              onChange={(e) => setFilters({ ...filters, collection: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && load()} />
          </div>
          {error && <p className="error-text">{error}</p>}
          <table className="table">
            <thead><tr><th>Name</th><th>Table</th><th>Duration</th><th>Clock</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sys_id} className={`click ${editingId === r.sys_id ? 'selected' : ''}`} onClick={() => openEdit(r)}>
                  <td>
                    {r.name}
                    {!r.active && <span className="badge" style={{ marginLeft: 6 }}>inactive</span>}
                  </td>
                  <td className="mono">{r.collection}</td>
                  <td className="mono">{r.duration.human || (r.duration_type ? 'relative' : '—')}</td>
                  <td>
                    {r.schedule_effective
                      ? <span className="badge blue" title={r.schedule.name}>{r.schedule.name}</span>
                      : <span className="badge green">24×7</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !error && <div className="empty">No SLA definitions match. Connect your PDI on the Dashboard first.</div>}
        </div>

        <div className="card">
          {!form ? (
            <div className="empty">
              Select a definition to edit, or create one. Conditions are checked against the target table&rsquo;s real
              schema before anything is written.
            </div>
          ) : (
            <>
              <div className="spread" style={{ marginBottom: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {editingId ? <>Edit <span className="mono">{form.name}</span></> : 'New SLA definition'}
                </div>
                {editingId && <button className="btn danger sm" onClick={remove} disabled={busy}>Delete</button>}
              </div>

              <div className="field">
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Table · the SLA runs on records of this table</label>
                <TableField
                  value={form.collection ? { id: form.collection, label: form.collection } : null}
                  onChange={(v) => setForm({ ...form, collection: v?.id || '' })}
                />
              </div>

              <div className="grid2">
                <div className="field">
                  <label className="label">Type</label>
                  <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {(meta?.type || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Target</label>
                  <select className="select" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
                    {(meta?.target || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="label">Duration · &ldquo;4h&rdquo;, &ldquo;90m&rdquo;, &ldquo;2d 4h&rdquo;, &ldquo;4:00:00&rdquo;, or seconds</label>
                <input className="input mono" value={form.duration} disabled={Boolean(form.duration_type)}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Relative duration · replaces the fixed duration entirely</label>
                <select className="select" value={form.duration_type} onChange={(e) => setForm({ ...form, duration_type: e.target.value })}>
                  <option value="">— use the fixed duration above —</option>
                  {(meta?.durationTypes || []).map((d) => <option key={d.sys_id} value={d.sys_id}>{d.name}</option>)}
                </select>
              </div>

              <div className="field">
                <label className="label">Start condition · encoded query, required</label>
                <input className="input mono" placeholder="active=true^priority=1"
                  value={form.start_condition} onChange={(e) => setForm({ ...form, start_condition: e.target.value })} />
              </div>
              <div className="grid2">
                <div className="field">
                  <label className="label">Stop condition</label>
                  <input className="input mono" placeholder="state=6"
                    value={form.stop_condition} onChange={(e) => setForm({ ...form, stop_condition: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label">Pause condition</label>
                  <input className="input mono" placeholder="state=3"
                    value={form.pause_condition} onChange={(e) => setForm({ ...form, pause_condition: e.target.value })} />
                </div>
              </div>

              <div className="grid2">
                <div className="field">
                  <label className="label">Schedule</label>
                  <select className="select" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })}>
                    <option value="">— none (24×7) —</option>
                    {(meta?.schedules || []).map((s) => <option key={s.sys_id} value={s.sys_id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Schedule source</label>
                  <select className="select" value={form.schedule_source} onChange={(e) => setForm({ ...form, schedule_source: e.target.value })}>
                    {(meta?.schedule_source || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              {/* The inert-schedule trap, stated where the mistake is made. */}
              {form.schedule && form.schedule_source !== 'sla_definition' && (
                <div className="note warn" style={{ marginBottom: 11 }}>
                  This schedule is <b>ignored</b> while schedule source is <span className="mono">{form.schedule_source}</span> — the
                  clock runs 24×7. Measured on this instance: the same definition, same 4h duration, elapsed 4.00h at
                  <span className="mono"> no_schedule</span> and 7.84h at <span className="mono">sla_definition</span>.
                </div>
              )}

              <div className="row" style={{ marginBottom: 11 }}>
                <label className="check">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Active
                </label>
                <label className="check">
                  <input type="checkbox" checked={form.retroactive} onChange={(e) => setForm({ ...form, retroactive: e.target.checked })} />
                  Retroactive start
                </label>
              </div>

              <div className="row">
                <button className="btn" onClick={validate} disabled={busy}>Check conditions</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.name || !form.collection}>
                  {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create SLA'}
                </button>
                <button className="btn ghost" onClick={() => { setForm(null); setEditingId(null); setCheck(null); }}>Close</button>
              </div>

              {check && <ValidationPanel check={check} />}
              {notice && <WritePanel notice={notice} />}
              {error && <p className="error-text">{error}</p>}
            </>
          )}
        </div>
      </div>

      {/* Verification is a separate, deliberate action: it writes a real record. */}
      {selected && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Verify &ldquo;{selected.name}&rdquo;</div>
            <button className="btn amber sm" onClick={() => verify(selected.name)} disabled={Boolean(run && !run.result)}>
              {run && !run.result ? 'Running…' : 'Run verification'}
            </button>
          </div>
          <div className="note warn">
            This creates a real <span className="mono">{selected.collection}</span> matching the definition&rsquo;s own start
            condition, waits for the clock to attach, asserts it, then deletes the record and reads back to prove it is
            gone. It writes to the instance, so it is never automatic.
          </div>
          {run && <VerifyPanel run={run} />}
        </div>
      )}
    </div>
  );
}

function ValidationPanel({ check }) {
  return (
    <div className="stack" style={{ marginTop: 12, gap: 8 }}>
      {check.ok && !check.warnings.length && <p className="ok-text">Every condition field exists on the target table.</p>}
      {check.errors.map((e, i) => <div key={i} className="note" style={{ borderLeftColor: 'var(--red)' }}>{e}</div>)}
      {check.warnings.map((w, i) => <div key={i} className="note warn">{w}</div>)}
    </div>
  );
}

function WritePanel({ notice }) {
  const d = notice.definition;
  return (
    <div className="stack" style={{ marginTop: 12, gap: 8 }}>
      <p className={notice.ok ? 'ok-text' : 'error-text'}>{notice.message}</p>
      {/* Read-back: unknown fields are accepted and discarded, so a clean write
          is a claim until the stored record has been compared with what we sent. */}
      {notice.mismatches?.map((m, i) => (
        <div key={i} className="note" style={{ borderLeftColor: 'var(--red)' }}>
          <span className="mono">{m.field}</span> was sent as <span className="mono">{String(m.sent)}</span> but the
          instance stored <span className="mono">{String(m.stored ?? 'nothing')}</span>
          {m.note ? ` — ${m.note}` : ''}.
        </div>
      ))}
      {notice.warnings?.map((w, i) => <div key={i} className="note warn">{w}</div>)}
      {d && (
        <dl className="kv">
          <dt>sys_id</dt><dd className="mono">{notice.sys_id}</dd>
          <dt>duration stored</dt><dd className="mono">{d.duration.raw} → {d.duration.human}</dd>
          <dt>clock</dt><dd>{d.schedule_effective ? `${d.schedule.name} (schedule applies)` : '24×7 (no schedule in effect)'}</dd>
          <dt>start condition</dt><dd className="mono">{d.conditions.start || '—'}</dd>
          {notice.link && <><dt>on the instance</dt><dd><a href={notice.link} target="_blank" rel="noreferrer">open the definition</a></dd></>}
        </dl>
      )}
    </div>
  );
}

function VerifyPanel({ run }) {
  const r = run.result;
  const a = r?.assertion;
  return (
    <div className="stack" style={{ marginTop: 12, gap: 10 }}>
      {run.events.map((ev, i) => <div key={i} className="system-note mono">{describe(ev)}</div>)}
      {r && (
        <>
          <p className={r.ok ? 'ok-text' : 'error-text'}>{r.message}</p>
          {r.errors?.map((e, i) => <div key={i} className="note" style={{ borderLeftColor: 'var(--red)' }}>{e}</div>)}
          {r.setup && (
            <dl className="kv">
              <dt>setup record</dt><dd className="mono">{r.setup.record}</dd>
              <dt>stored as</dt>
              <dd className="mono">{Object.entries(r.setup.observed || {}).map(([k, v]) => `${k}=${v}`).join('  ·  ')}</dd>
            </dl>
          )}
          {a && (
            <>
              <div className="row">
                <span className={`badge ${a.pass ? 'green' : 'red'}`}>{a.attached} attached for this definition</span>
                {/* The whole point: naming which SLA, because others attach too. */}
                {a.others?.length > 0 && (
                  <span className="badge amber" title={a.others.map((o) => o.name).join(', ')}>
                    {a.others.length} other SLA(s) also attached
                  </span>
                )}
              </div>
              {a.clock && (
                <dl className="kv">
                  <dt>clock mode</dt><dd>{a.clock.mode === '24x7' ? '24×7 — planned end is start + duration' : `scheduled (${a.clock.schedule}) — bounds only`}</dd>
                  <dt>start (UTC)</dt><dd className="mono">{a.clock.startUtc}</dd>
                  <dt>planned end (UTC)</dt><dd className="mono">{a.clock.plannedEndUtc}</dd>
                  {a.clock.driftSec !== undefined && (
                    <><dt>drift</dt><dd className="mono">{a.clock.driftSec}s (tolerance {a.clock.toleranceSec}s)</dd></>
                  )}
                  {a.task_sla && (
                    <>
                      <dt>same instant, displayed</dt>
                      <dd className="mono" title="stored in UTC, rendered in the session timezone — asserting against this half fails a correct SLA">
                        {a.task_sla.planned_end_time_display}
                      </dd>
                      <dt>stage</dt><dd className="mono">{a.task_sla.stage} · breached {String(a.task_sla.has_breached)}</dd>
                    </>
                  )}
                </dl>
              )}
              {a.clock?.note && <div className="note">{a.clock.note}</div>}
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {(a.checks || []).map((c, i) => (
                  <li key={i} style={{ color: c.ok ? 'var(--verdigris)' : 'var(--red)' }}>{c.what}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function describe(ev) {
  switch (ev.type) {
    case 'sla_verify_definition': return `definition ${ev.name} on ${ev.collection}`;
    case 'sla_verify_setup': return `setup → ${ev.table} ${JSON.stringify(ev.payload)}${ev.notes?.length ? `\n${ev.notes.join('\n')}` : ''}`;
    case 'sla_verify_setup_done': return `created ${ev.record}`;
    case 'sla_verify_setup_checked': return `the platform ${ev.satisfies ? 'agrees' : 'DISAGREES'} that the record matches the start condition`;
    case 'sla_verify_poll': return `polling · ${ev.attached} task_sla for this definition`;
    case 'sla_verify_cleanup': return 'cleanup →';
    case 'sla_verify_cleanup_done':
      return `cleanup: ${ev.taskSlasAtStart} task_sla row(s) at start, cascaded=${ev.cascaded}, ${ev.taskSlasLeft} left, record left ${ev.recordLeft}`;
    default: return JSON.stringify(ev);
  }
}
