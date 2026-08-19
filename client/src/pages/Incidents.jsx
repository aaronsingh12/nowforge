import { useEffect, useState } from 'react';
import { api, val, disp } from '../api.js';
import { confirmDestructive, CONSEQUENCE } from '../components/confirm.js';
import { toast } from '../components/toast.js';
import ReferenceField from '../components/ReferenceField.jsx';

const EMPTY = {
  short_description: '', description: '', category: '', state: '1',
  impact: '3', urgency: '3', work_notes: '',
  caller_id: null, assignment_group: null, assigned_to: null,
};

function choicesFor(schema, field) {
  return schema?.fields?.find((f) => f.name === field)?.choices || [];
}

export default function Incidents() {
  const [schema, setSchema] = useState(null);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ search: '', state: '', priority: '' });
  const [form, setForm] = useState(null);      // null = closed, {..EMPTY} or loaded record form
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');
    try {
      const qs = new URLSearchParams({ ...filters, active: '', limit: '30' }).toString();
      setRows(await api.get(`/incidents?${qs}`));
      api.get('/incidents/stats').then(setStats).catch(() => {});
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    api.get('/system/schema/incident').then(setSchema).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.state, filters.priority]);

  const openNew = () => { setForm({ ...EMPTY }); setEditingId(null); setNotice(''); };

  const openEdit = (r) => {
    setEditingId(val(r, 'sys_id'));
    setNotice('');
    setForm({
      short_description: disp(r, 'short_description'),
      description: '',
      category: val(r, 'category') || '',
      state: val(r, 'state') || '1',
      impact: val(r, 'impact') || '3',
      urgency: val(r, 'urgency') || '3',
      work_notes: '',
      caller_id: val(r, 'caller_id') ? { id: val(r, 'caller_id'), label: disp(r, 'caller_id') } : null,
      assignment_group: val(r, 'assignment_group') ? { id: val(r, 'assignment_group'), label: disp(r, 'assignment_group') } : null,
      assigned_to: val(r, 'assigned_to') ? { id: val(r, 'assigned_to'), label: disp(r, 'assigned_to') } : null,
      _number: disp(r, 'number'),
    });
    // Pull the full record so description prefills
    api.get(`/incidents/${val(r, 'sys_id')}`).then((full) => {
      setForm((f) => f ? { ...f, description: disp(full, 'description') } : f);
    }).catch(() => {});
  };

  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    const payload = {
      short_description: form.short_description,
      description: form.description,
      category: form.category,
      state: form.state,
      impact: form.impact,
      urgency: form.urgency,
      caller_id: form.caller_id?.id || '',
      assignment_group: form.assignment_group?.id || '',
      assigned_to: form.assigned_to?.id || '',
    };
    if (editingId && form.work_notes) payload.work_notes = form.work_notes;
    try {
      if (editingId) {
        const r = await api.patch(`/incidents/${editingId}`, payload);
        setNotice(`Updated ${disp(r, 'number')}`);
      } else {
        const r = await api.post('/incidents', payload);
        setNotice(`Created ${disp(r, 'number')}`);
        setForm(null);
      }
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirmDestructive({
      action: 'Delete incident',
      subject: form._number,
      sysId: editingId,
      detail: CONSEQUENCE.incident,
    });
    if (!ok) return;
    setBusy(true); setError('');
    try {
      await api.del(`/incidents/${editingId}`);
      setForm(null); setEditingId(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const stateChoices = choicesFor(schema, 'state');
  const prioChoices = choicesFor(schema, 'priority');
  const catChoices = choicesFor(schema, 'category');
  const impactChoices = choicesFor(schema, 'impact');
  const urgencyChoices = choicesFor(schema, 'urgency');

  const badgeFor = (p) => (p === '1' ? 'red' : p === '2' ? 'amber' : '');

  return (
    <div className="stack">
      {stats && (
        <div className="row">
          <span className="badge">open {stats.open}</span>
          <span className="badge red">P1 {stats.critical}</span>
          <span className="badge amber">unassigned {stats.unassigned}</span>
          <span className="badge blue">new {stats.new}</span>
        </div>
      )}

      <div className="split">
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Incidents</div>
            <button className="btn primary sm" onClick={openNew}>New incident</button>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Search number or description…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && load()} />
            <select className="select" style={{ width: 130 }} value={filters.state}
              onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
              <option value="">All states</option>
              {stateChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select className="select" style={{ width: 120 }} value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
              <option value="">All priority</option>
              {prioChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {error && <p className="error-text">{error}</p>}
          <table className="table">
            <thead><tr><th>Number</th><th>Short description</th><th>State</th><th>Pri</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={val(r, 'sys_id')} className={`click ${editingId === val(r, 'sys_id') ? 'selected' : ''}`} onClick={() => openEdit(r)}>
                  <td className="mono">{disp(r, 'number')}</td>
                  <td>{disp(r, 'short_description')}</td>
                  <td><span className="badge">{disp(r, 'state')}</span></td>
                  <td><span className={`badge ${badgeFor(val(r, 'priority'))}`}>{val(r, 'priority')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !error && <div className="empty">No incidents match. Connect your PDI on the Dashboard first.</div>}
        </div>

        <div className="card">
          {!form ? (
            <div className="empty">Select an incident to edit, or create a new one. Reference fields (caller, group, assignee) resolve live against your instance.</div>
          ) : (
            <>
              <div className="spread" style={{ marginBottom: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {editingId ? <>Edit <span className="mono">{form._number}</span></> : 'New incident'}
                </div>
                {editingId && <button className="btn danger sm" onClick={remove} disabled={busy}>Delete</button>}
              </div>
              <div className="field">
                <label className="label">Short description</label>
                <input className="input" value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Description</label>
                <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Caller · sys_user</label>
                <ReferenceField table="sys_user" value={form.caller_id} onChange={(v) => setForm({ ...form, caller_id: v })} />
              </div>
              <div className="grid2">
                <div className="field">
                  <label className="label">Category</label>
                  <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    <option value="">—</option>
                    {catChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">State</label>
                  <select className="select" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                    {stateChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Impact</label>
                  <select className="select" value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}>
                    {impactChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Urgency</label>
                  <select className="select" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
                    {urgencyChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="label">Assignment group · sys_user_group</label>
                <ReferenceField table="sys_user_group" value={form.assignment_group} onChange={(v) => setForm({ ...form, assignment_group: v })} />
              </div>
              <div className="field">
                <label className="label">Assigned to · sys_user</label>
                <ReferenceField table="sys_user" value={form.assigned_to} onChange={(v) => setForm({ ...form, assigned_to: v })} />
              </div>
              {editingId && (
                <div className="field">
                  <label className="label">Work notes (appended on save)</label>
                  <textarea className="textarea" value={form.work_notes} onChange={(e) => setForm({ ...form, work_notes: e.target.value })} />
                </div>
              )}
              <div className="row">
                <button className="btn primary" onClick={submit} disabled={busy || !form.short_description}>
                  {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create incident'}
                </button>
                <button className="btn ghost" onClick={() => { setForm(null); setEditingId(null); }}>Close</button>
              </div>
              {notice && <p className="ok-text">{notice}</p>}
              {error && <p className="error-text">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
