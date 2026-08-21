import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { SkeletonRows, EmptyState } from '../components/states.jsx';
import ScopeBadge from '../components/ScopeBadge.jsx';

/**
 * Applications — every scope on the instance, and which ones we manage.
 *
 * Read-only on purpose. The page exists to answer "what scope is this in", a
 * question that decides where an artifact can travel, and getting that wrong is
 * how a change ends up in a set it cannot be moved out of.
 *
 * Two things it will not do quietly:
 *
 *   - Store applications come from `sys_scope`, not `sys_store_app`, because
 *     that table answers 403 to this user over REST. The footnote says so. An
 *     instance with 739 store apps and a page showing none would otherwise look
 *     exactly like an instance with none.
 *   - A workspace on disk whose scope is not installed here is called out
 *     rather than omitted — that is a real state (built, never deployed) and
 *     omitting it makes the registry look empty.
 */

const KINDS = [
  { key: '', label: 'All' },
  { key: 'custom', label: 'Custom' },
  { key: 'store', label: 'Store' },
  { key: 'scope', label: 'Global' },
];

export default function Applications() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('custom');
  const [search, setSearch] = useState('');
  const [managedOnly, setManagedOnly] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    api.get('/applications')
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  // Filtering is local: the whole list is one read, and 743 rows filter faster
  // in the browser than they round-trip.
  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.applications.filter((a) => {
      if (kind && a.kind !== kind) return false;
      if (managedOnly && !a.managed) return false;
      if (q && !`${a.name} ${a.scope}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, kind, search, managedOnly]);

  if (error) return <div className="card"><div className="error-text">{error}</div></div>;

  return (
    <div className="stack">
      <div className="grid3">
        <div className="card"><div className="stat"><b>{data?.counts?.custom ?? '—'}</b><span>custom applications</span></div></div>
        <div className="card"><div className="stat"><b>{data?.counts?.store ?? '—'}</b><span>store applications</span></div></div>
        <div className="card"><div className="stat"><b>{data?.managedCount ?? '—'}</b><span>managed by NowHelpAssist</span></div></div>
      </div>

      {data?.orphanWorkspaces?.length > 0 && (
        <div className="note warn">
          <b>{data.orphanWorkspaces.length} SDK workspace{data.orphanWorkspaces.length === 1 ? '' : 's'} on disk with no application on this instance.</b>{' '}
          {data.orphanWorkspaces.map((w) => w.scope).join(', ')} — built, but never installed here.
        </div>
      )}

      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {KINDS.map((k) => (
              <button
                key={k.key || 'all'}
                className={`tab${kind === k.key ? ' active' : ''}`}
                onClick={() => setKind(k.key)}
              >
                {k.label}
                {data && k.key && <span className="mono" style={{ marginLeft: 6, opacity: 0.6 }}>{data.counts[k.key] ?? 0}</span>}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={managedOnly} onChange={(e) => setManagedOnly(e.target.checked)} />
              managed only
            </label>
            <input
              className="input" style={{ width: 220 }} placeholder="name or scope"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? <SkeletonRows rows={6} cols={5} /> : rows.length === 0 ? (
          <EmptyState
            title="No applications match"
            hint={search ? `Nothing on this instance matches "${search}".` : 'Try another filter.'}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Scope</th>
                <th>Version</th>
                <th>Vendor</th>
                <th>Managed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.sys_id}>
                  <td>
                    {a.name}
                    {!a.active && <span className="badge amber" style={{ marginLeft: 8 }}>inactive</span>}
                    {a.shortDescription && <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{a.shortDescription}</div>}
                  </td>
                  <td><ScopeBadge scope={a.scope} name={a.name} managed={a.managed} /></td>
                  <td className="mono">{a.version || '—'}</td>
                  <td>{a.vendor || '—'}</td>
                  <td>
                    {a.managed ? (
                      <>
                        <span className="badge green">NowHelpAssist</span>
                        {a.workspace && (
                          <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, marginTop: 3 }}>
                            {a.workspace.id} · {a.workspace.sourceCount} source{a.workspace.sourceCount === 1 ? '' : 's'}
                            {!a.workspace.installable && ' · deps missing'}
                          </div>
                        )}
                      </>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data?.visibility && (
        <div className="note">
          <b>Where this comes from.</b> {data.visibility.note}
          {data.visibility.droppedFields?.length > 0 && (
            <> This instance did not return: <span className="mono">{data.visibility.droppedFields.join(', ')}</span>.</>
          )}
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>
            Anything NowHelpAssist creates over the Table API is born in <span className="mono">global</span> —
            the platform accepts a scope on a REST insert and silently ignores it. Scoped artifacts come from an SDK workspace.
          </div>
        </div>
      )}
    </div>
  );
}
