import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { SkeletonRows, EmptyState, LoadingRegion } from '../components/states.jsx';
import ScopeBadge from '../components/ScopeBadge.jsx';

/**
 * Transport — the update sets NowHelpAssist created, and what is in them.
 *
 * The copy on this page has one job beyond listing: an update set carries
 * CONFIGURATION and never task data, and a user who assumes otherwise will
 * migrate a catalog item and wonder where the requests went. That sentence is
 * on the page, not in a doc.
 *
 * Download goes through a normal link rather than fetch + blob, because the
 * server verifies parity before it will serve the file and answers 422 with the
 * differences when it does not match. A blob would have to re-implement that
 * check on the client to know whether it was handing over something real.
 */

export default function Transport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [contents, setContents] = useState(null);
  const [loadingContents, setLoadingContents] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await api.get('/transport/sets')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const open = async (set) => {
    setSelected(set); setContents(null);
    if (!set.present) return;
    setLoadingContents(true);
    try { setContents(await api.get(`/transport/sets/${set.setSysId}`)); }
    catch (e) { toast.error(e.message); }
    finally { setLoadingContents(false); }
  };

  /** Confirm the server will actually serve it before sending the browser off. */
  const download = async (set) => {
    try {
      const check = await api.get(`/transport/sets/${set.setSysId}/export?inspect=true`);
      if (!check.parity?.ok) { toast.error('The export did not match the set; it was not downloaded.'); return; }
      window.location.href = `/api/transport/sets/${set.setSysId}/export`;
      toast.success(`${check.filename} — ${check.manifest.count} update${check.manifest.count === 1 ? '' : 's'}, parity verified`);
    } catch (e) { toast.error(e.message); }
  };

  if (error) return <div className="card"><div className="error-text">{error}</div></div>;

  const sets = data?.sets || [];

  return (
    <div className="stack">
      <div className="note">
        <b>Update sets carry configuration, not data.</b> Catalog items, business rules, flows, UI
        policies and SLA definitions travel. Incidents, requests and any other task record do not —
        they are data, and no update set has ever contained them.
      </div>

      <div className="split">
        <div className="card">
          <div className="spread card-title">
            <span>Captured sets</span>
            <button className="btn sm ghost" onClick={load}>Refresh</button>
          </div>
          {loading ? <SkeletonRows rows={4} cols={2} /> : sets.length === 0 ? (
            <EmptyState
              title="Nothing captured yet"
              hint="Turn on Capture changes in an agent session, then make a configuration change. A set is created the first time there is something to put in it."
            />
          ) : (
            <table className="table">
              <thead><tr><th>Set</th><th>Scope</th><th>Updates</th></tr></thead>
              <tbody>
                {sets.map((s) => (
                  <tr
                    key={s.setSysId}
                    className={`click${selected?.setSysId === s.setSysId ? ' selected' : ''}`}
                    onClick={() => open(s)}
                  >
                    <td>
                      {s.setName}
                      <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
                        {s.sessionTitle || 'session removed'}
                        {s.parentSet && ' · batched'}
                      </div>
                    </td>
                    <td><ScopeBadge scope={s.scope} /></td>
                    <td>
                      {s.present
                        ? <span className="mono">{s.updateCount ?? '?'}</span>
                        : <span className="badge red">deleted on instance</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          {!selected ? (
            <EmptyState title="Select a set" hint="Its contents — every update that would travel — are listed here." />
          ) : !selected.present ? (
            <div className="note warn">
              <b>{selected.setName}</b> was created by NowHelpAssist but no longer exists on this
              instance. It was deleted there, not here — nothing was lost locally, and nothing can be exported.
            </div>
          ) : loadingContents ? (
            <LoadingRegion label="Reading the set" />
          ) : contents ? (
            <>
              <div className="spread card-title">
                <span>{contents.set.name}</span>
                <button className="btn sm primary" onClick={() => download(selected)}>Export XML</button>
              </div>
              <dl className="kv" style={{ marginBottom: 14 }}>
                <dt>scope</dt><dd><ScopeBadge scope={contents.set.applicationLabel} /></dd>
                <dt>state</dt><dd className="mono">{contents.set.state}</dd>
                <dt>updates</dt><dd className="mono">{contents.count}</dd>
                <dt>sys_id</dt><dd className="mono">{contents.set.sys_id}</dd>
              </dl>

              {contents.duplicateNames.length > 0 && (
                <div className="note warn">
                  <b>{contents.duplicateNames.length} record{contents.duplicateNames.length === 1 ? ' has' : 's have'} more than one update in this set.</b>{' '}
                  Capture collapses these, so something wrote to the set outside NowHelpAssist:{' '}
                  <span className="mono">{contents.duplicateNames.map((d) => `${d.name} ×${d.count}`).join(', ')}</span>
                </div>
              )}

              {contents.count === 0 ? (
                <EmptyState title="This set is empty" hint="It was created, but nothing has been captured into it yet." />
              ) : (
                <table className="table">
                  <thead><tr><th>Type</th><th>Target</th><th>Action</th><th>Scope</th></tr></thead>
                  <tbody>
                    {contents.updates.map((u) => (
                      <tr key={u.sys_id}>
                        <td>{u.type}</td>
                        <td>
                          {u.target}
                          <div className="mono" style={{ color: 'var(--muted)', fontSize: 10.5 }}>{u.name}</div>
                        </td>
                        <td><span className={`badge${u.action === 'DELETE' ? ' red' : ''}`}>{u.action}</span></td>
                        <td><ScopeBadge scope={u.scope} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
