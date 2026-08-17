import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Dashboard() {
  const [conn, setConn] = useState({ instanceUrl: '', authType: 'basic', username: '', password: '', clientId: '', clientSecret: '' });
  const [saved, setSaved] = useState(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const loadStats = () => api.get('/incidents/stats').then(setStats).catch(() => setStats(null));

  useEffect(() => {
    api.get('/system/settings').then((s) => {
      setSaved(s);
      setConn((c) => ({ ...c, instanceUrl: s.connection.instanceUrl, authType: s.connection.authType, username: s.connection.username, clientId: s.connection.clientId }));
      if (s.connection.instanceUrl) loadStats();
    }).catch(() => {});
  }, []);

  const save = async () => {
    setError('');
    try {
      const s = await api.post('/system/settings', { connection: conn });
      setSaved(s);
      setTest(null);
    } catch (e) { setError(e.message); }
  };

  const runTest = async () => {
    setTesting(true); setError(''); setTest(null);
    try {
      const r = await api.post('/system/connection/test');
      setTest(r);
      loadStats();
    } catch (e) { setError(e.message); }
    finally { setTesting(false); }
  };

  return (
    <div className="stack">
      <div className="grid2">
        <div className="card">
          <div className="card-title">PDI connection</div>
          <div className="field">
            <label className="label">Instance URL</label>
            <input className="input mono" placeholder="https://dev12345.service-now.com" value={conn.instanceUrl}
              onChange={(e) => setConn({ ...conn, instanceUrl: e.target.value.trim() })} />
          </div>
          <div className="field">
            <label className="label">Auth type</label>
            <select className="select" value={conn.authType} onChange={(e) => setConn({ ...conn, authType: e.target.value })}>
              <option value="basic">Basic (username + password)</option>
              <option value="oauth">OAuth 2.0 (password grant)</option>
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label className="label">Username</label>
              <input className="input" value={conn.username} onChange={(e) => setConn({ ...conn, username: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Password {saved?.connection.hasPassword ? '· saved' : ''}</label>
              <input className="input" type="password" placeholder={saved?.connection.hasPassword ? '••••••••' : ''} value={conn.password}
                onChange={(e) => setConn({ ...conn, password: e.target.value })} />
            </div>
          </div>
          {conn.authType === 'oauth' && (
            <div className="grid2">
              <div className="field">
                <label className="label">Client ID</label>
                <input className="input mono" value={conn.clientId} onChange={(e) => setConn({ ...conn, clientId: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Client secret {saved?.connection.hasClientSecret ? '· saved' : ''}</label>
                <input className="input" type="password" value={conn.clientSecret} onChange={(e) => setConn({ ...conn, clientSecret: e.target.value })} />
              </div>
            </div>
          )}
          <div className="row">
            <button className="btn primary" onClick={save}>Save connection</button>
            <button className="btn" onClick={runTest} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</button>
          </div>
          {test && <p className="ok-text">Connected. Sample user: <span className="mono">{test.sampleUser || 'n/a'}</span>{test.build ? <> · build <span className="mono">{test.build}</span></> : null}</p>}
          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="card">
          <div className="card-title">Incident pulse</div>
          {stats ? (
            <div className="grid2">
              <div className="stat"><b>{stats.open}</b><span>open incidents</span></div>
              <div className="stat"><b style={{ color: 'var(--red)' }}>{stats.critical}</b><span>priority 1</span></div>
              <div className="stat"><b style={{ color: 'var(--amber)' }}>{stats.unassigned}</b><span>unassigned</span></div>
              <div className="stat"><b>{stats.new}</b><span>state: new</span></div>
            </div>
          ) : (
            <div className="empty">Connect and test your PDI to see live counts.</div>
          )}
          <div className="note" style={{ marginTop: 14 }}>
            Counts come from the Aggregate API on your bound instance. The Agent, Incidents, Catalog, and Flows
            modules all run against this same connection.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">What this platform does</div>
        <div className="grid3">
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>Incidents</h3>
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>Full CRUD with schema-aware choice lists and reference pickers for caller, group, and assignee.</p>
          </div>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>Catalog</h3>
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>Items, all variable types with choices, variable sets, order guides, and record producers.</p>
          </div>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>Flows</h3>
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>Read any flow top-to-bottom, watch executions, and design new automations with AI blueprints.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
