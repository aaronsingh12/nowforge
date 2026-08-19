import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, sse } from '../api.js';
import { useHealth } from '../hooks/useHealth.js';
import Markdown from '../components/Markdown.jsx';
import { confirmDestructive, promptFor, CONSEQUENCE } from '../components/confirm.js';
import { toast } from '../components/toast.js';
import { SkeletonLines, LoadingRegion, EmptyState, DisconnectedBanner } from '../components/states.jsx';

const SAMPLES = [
  'Create a "Laptop Request" catalog item with 6 sensible variables including a reference to sys_user and a model select box',
  'Show me all critical incidents that are assigned to no one',
  'Design a flow: when a P1 incident is created, notify the assignment group manager',
];

const SESSION_KEY = 'nowhelpassist.sessionId';
// Read once, for anyone who had a chat open across the rename. Cleared on the
// first write, so this is not a key the app keeps two of.
const LEGACY_SESSION_KEY = 'nowforge.sessionId';

let nextId = 1;
const uid = () => `m${nextId++}`;

/**
 * Rebuild the visible transcript from persisted messages (A-2).
 *
 * The server stores the NEUTRAL history — the same shape the provider adapters
 * consume — so rehydration reads that rather than a second, UI-shaped copy that
 * could drift out of step with what the model actually saw.
 *
 * Approval cards are deliberately NOT reconstructed: an approval is a live
 * decision on an in-flight turn, and a resolved one is history. What it did is
 * visible in the tool card it gated.
 */
function hydrate(messages) {
  const out = [];
  for (const m of messages) {
    const e = m.entry;
    if (e.role === 'user') {
      out.push({ id: uid(), kind: 'user', text: e.text });
    } else if (e.role === 'assistant') {
      if (e.text) out.push({ id: uid(), kind: 'assistant', text: e.text });
      for (const tc of e.toolCalls || []) {
        out.push({ id: uid(), kind: 'tool', toolId: tc.id, name: tc.name, input: tc.input, status: 'done' });
      }
    } else if (e.role === 'tool') {
      for (const r of e.results || []) {
        // Attach the result to the call card already emitted above.
        const card = [...out].reverse().find((x) => x.kind === 'tool' && x.toolId === r.id);
        if (card) {
          card.output = r.output;
          card.status = r.isError ? 'error' : 'done';
        }
      }
    }
  }
  return out;
}

export default function AgentChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState(null);
  const [autoApprove, setAutoApprove] = useState(false);

  const [sessions, setSessions] = useState(null);   // null = not loaded yet
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY) || crypto.randomUUID()
  );
  const [loadingSession, setLoadingSession] = useState(false);
  const [digestCount, setDigestCount] = useState(0);
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState(null);
  const [memory, setMemory] = useState(null);

  const { connected } = useHealth();
  const msgsRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  }, [sessionId]);

  const refreshSessions = useCallback(async () => {
    try { setSessions(await api.get('/agent/sessions')); }
    catch { setSessions([]); /* the rail is not load-bearing, but it must settle */ }
  }, []);

  useEffect(() => {
    api.get('/system/settings').then((s) => setAutoApprove(s.agent.autoApprove)).catch(() => {});
    api.get('/agent/memory/status').then(setMemory).catch(() => {});
    refreshSessions();
  }, [refreshSessions]);

  // Rehydrate on mount and on every session switch. This is the whole point of
  // A-2: Agent -> Settings -> Agent must lose NOTHING.
  useEffect(() => {
    let alive = true;
    setLoadingSession(true);
    api
      .get(`/agent/sessions/${sessionId}/messages`)
      .then((data) => {
        if (!alive) return;
        setMessages(hydrate(data.messages || []));
        setDigestCount((data.digests || []).length);
      })
      .catch(() => { if (alive) { setMessages([]); setDigestCount(0); } })
      .finally(() => { if (alive) setLoadingSession(false); });
    return () => { alive = false; };
  }, [sessionId]);

  /**
   * Keep the transcript pinned to the newest turn — by scrolling the message
   * COLUMN, never by asking an element to scroll itself into view.
   *
   * `scrollIntoView` walks every scrollable ancestor, so the moment anything
   * above the chat became scrollable it scrolled that too: the page slid down
   * on load and again on every click that touched `messages`, taking the
   * topbar with it. Setting scrollTop on the one container that should move
   * cannot do that, whatever the layout above it is doing.
   */
  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, [messages]);

  const push = (m) => setMessages((ms) => [...ms, { id: uid(), ...m }]);
  const patchMsg = (match, patch) =>
    setMessages((ms) => ms.map((m) => (match(m) ? { ...m, ...patch } : m)));

  const toggleAuto = async (v) => {
    setAutoApprove(v);
    try { await api.post('/system/settings', { agent: { autoApprove: v } }); } catch { /* noop */ }
  };

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || running) return;
    setInput('');
    setRunning(true);
    push({ kind: 'user', text: message });
    try {
      await sse('/agent/chat', { sessionId, message }, (evt) => {
        switch (evt.type) {
          case 'meta': setMeta(evt); break;
          case 'assistant_text': push({ kind: 'assistant', text: evt.text }); break;
          case 'remembered': push({ kind: 'system', text: `Remembered — ${evt.fact.value}` }); break;
          case 'compacted':
            setDigestCount((n) => n + 1);
            push({
              kind: 'system',
              text: `Compacted ${evt.entries} earlier messages into a digest (${evt.tokensBefore} → ${evt.tokensAfter} tokens). Artifacts and sys_ids were carried across.`,
            });
            break;
          case 'tool_use':
            push({ kind: 'tool', toolId: evt.id, name: evt.name, input: evt.input, mutating: evt.mutating, status: 'running' });
            break;
          case 'approval_required':
            push({ kind: 'approval', approvalId: evt.approvalId, name: evt.name, input: evt.input, decided: null });
            break;
          case 'approval_resolved':
            patchMsg((m) => m.kind === 'approval' && m.approvalId === evt.approvalId, { decided: evt.approved });
            break;
          case 'tool_result':
            patchMsg((m) => m.kind === 'tool' && m.toolId === evt.id, { status: evt.isError ? 'error' : 'done', output: evt.output });
            break;
          case 'error': push({ kind: 'error', text: evt.message }); break;
          default: break;
        }
      });
    } catch (e) {
      push({ kind: 'error', text: e.message });
    } finally {
      setRunning(false);
      refreshSessions();
    }
  };

  const decide = async (m, approved) => {
    patchMsg((x) => x.id === m.id, { decided: approved });
    try { await api.post('/agent/approve', { sessionId, approvalId: m.approvalId, approved }); }
    catch { /* server timeout path handles it */ }
  };

  const newChat = async () => {
    if (running) return;
    const id = crypto.randomUUID();
    try { await api.post('/agent/sessions', { id }); } catch { /* created on first message anyway */ }
    setSessionId(id);
    setSearchHits(null);
    setQuery('');
    refreshSessions();
  };

  const rename = async (s) => {
    const title = await promptFor({
      action: 'Rename this chat',
      label: 'Title',
      value: s.title || '',
    });
    if (title === null) return;
    try { await api.patch(`/agent/sessions/${s.id}`, { title }); refreshSessions(); toast.success('Chat renamed.'); }
    catch (e) { toast.error(e.message); }
  };

  const remove = async (s) => {
    const ok = await confirmDestructive({
      action: 'Delete chat',
      subject: s.title || 'this chat',
      sysId: s.id,
      detail: CONSEQUENCE.session,
      confirmLabel: 'Delete chat',
    });
    if (!ok) return;
    try {
      await api.del(`/agent/sessions/${s.id}`);
      if (s.id === sessionId) {
        const id = crypto.randomUUID();
        setSessionId(id);
      }
      refreshSessions();
      toast.success('Chat deleted.');
    } catch (e) { toast.error(e.message); }
  };

  const runSearch = async (e) => {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) { setSearchHits(null); return; }
    try {
      const res = await api.get(`/agent/memory/search?sessions=true&q=${encodeURIComponent(q)}`);
      setSearchHits(res);
      if (res.degraded) setMemory({ mode: 'keyword', degraded: true, command: res.command, reason: res.reason });
    } catch (err) { toast.error(err.message); }
  };

  const railLoading = !searchHits && sessions === null;
  const rail = searchHits ? searchHits.sessions : (sessions || []);

  return (
    <div className="agent-layout">
      <aside className="session-rail">
        <div className="rail-head">
          <button className="btn primary sm" onClick={newChat} disabled={running}>New chat</button>
        </div>

        <form className="rail-search" onSubmit={runSearch}>
          <input
            className="input"
            placeholder="Search all chats…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={runSearch}
          />
          {searchHits && (
            <button type="button" className="btn ghost sm" onClick={() => { setQuery(''); setSearchHits(null); }}>
              Clear
            </button>
          )}
        </form>

        {searchHits && (
          <div className="rail-note">
            {searchHits.sessions.length} match{searchHits.sessions.length === 1 ? '' : 'es'}
            {' · '}
            <span className={searchHits.degraded ? 'rail-mode-warn' : 'rail-mode-ok'}>
              {searchHits.mode}
            </span>
          </div>
        )}

        <div className="rail-list">
          {railLoading && (
            <div style={{ padding: '6px 2px' }}>
              <SkeletonLines lines={4} />
              <LoadingRegion label="Loading chats" />
            </div>
          )}
          {!railLoading && rail.length === 0 && (
            <div className="rail-empty">
              {searchHits ? 'Nothing matched.' : 'No chats yet — say something below and this fills in.'}
            </div>
          )}
          {rail.map((s) => (
            <div
              key={s.id}
              className={`rail-item${s.id === sessionId ? ' active' : ''}`}
              onClick={() => { if (!running) setSessionId(s.id); }}
              title={s.title || 'Untitled chat'}
            >
              <div className="rail-title">{s.title || 'Untitled chat'}</div>
              <div className="rail-meta">
                <span className="mono">{new Date(s.updated).toLocaleDateString()}</span>
                {s.message_count > 0 && <span>{s.message_count} msg</span>}
                {s.mutation_count > 0 && <span className="badge amber">{s.mutation_count}</span>}
              </div>
              {s.snippet && <div className="rail-snippet">{s.snippet}</div>}
              <div className="rail-actions">
                <button className="rail-btn" onClick={(e) => { e.stopPropagation(); rename(s); }} title="Rename">rename</button>
                <button className="rail-btn danger" onClick={(e) => { e.stopPropagation(); remove(s); }} title="Delete">delete</button>
              </div>
            </div>
          ))}
        </div>

        {/* One quiet banner, with the exact command. Never a silent downgrade. */}
        {memory?.degraded && (
          <div className="rail-foot">
            <div className="label">Recall: keyword only</div>
            <div className="rail-foot-body">
              The embedding model isn’t pulled, so search matches words rather than meaning.
              <pre className="mono">{memory.command}</pre>
            </div>
          </div>
        )}
      </aside>

      <div className="chat-wrap">
        <div className="spread" style={{ marginBottom: 10 }}>
          <div className="row">
            {meta && <span className="badge blue">{meta.provider} · <span className="mono">{meta.model}</span></span>}
            {!meta && <span className="badge">provider set in Settings</span>}
            {digestCount > 0 && (
              <span className="badge" title="Older turns were summarised into a digest to stay inside the context budget. Artifacts and sys_ids were carried across.">
                {digestCount} digest{digestCount === 1 ? '' : 's'}
              </span>
            )}
            {meta?.decoding?.reality && !/honoured\./.test(meta.decoding.reality) && (
              <span className="badge amber" title={meta.decoding.reality}>non-reproducible</span>
            )}
          </div>
          <label className="check" title="When off, every create/update/delete pauses for your approval — like Claude Code permissions.">
            <input type="checkbox" checked={autoApprove} onChange={(e) => toggleAuto(e.target.checked)} />
            Auto-approve mutations
          </label>
        </div>

        {/* The agent itself runs disconnected — it just cannot do anything
            useful to an instance, so this is a banner rather than a gate. */}
        <DisconnectedBanner />

        <div className="msgs" ref={msgsRef}>
          {loadingSession && (
            <div className="msg">
              <div className="bubble" style={{ minWidth: 320 }}><SkeletonLines lines={3} /></div>
              <LoadingRegion label="Loading transcript" />
            </div>
          )}

          {!loadingSession && messages.length === 0 && (
            <div className="card" style={{ maxWidth: 780 }}>
              <div className="card-title">NowHelpAssist Agent</div>
              <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--muted)' }}>
                Talks to your bound instance with schema inspection, reference resolution, record CRUD,
                catalog composites, flow reading, blueprint design and live authoring. Every mutation stops
                at the amber gate until you approve it. Conversations are saved — this chat will still be
                here after a restart, and <span className="mono">recall_memory</span> searches all of them.
              </p>
              <div className="chips">
                {SAMPLES.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
              </div>
              {!connected && (
                <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
                  No instance is bound yet, so every one of those needs a PDI first.{' '}
                  <Link to="/">Connect one on the Dashboard</Link>.
                </p>
              )}
            </div>
          )}

          {messages.map((m) => {
            if (m.kind === 'user') {
              // User bubbles stay literal on purpose: what you typed is what you
              // see, and nobody wants their asterisks eaten.
              return <div key={m.id} className="msg user"><div className="bubble">{m.text}</div></div>;
            }
            if (m.kind === 'assistant') {
              return (
                <div key={m.id} className="msg assistant">
                  <div className="bubble md-bubble"><Markdown text={m.text} /></div>
                </div>
              );
            }
            if (m.kind === 'system') {
              return <div key={m.id} className="msg"><div className="system-note">{m.text}</div></div>;
            }
            if (m.kind === 'error') {
              return <div key={m.id} className="msg"><div className="bubble" style={{ borderColor: 'var(--red)' }}><span className="error-text">{m.text}</span></div></div>;
            }
            if (m.kind === 'tool') {
              return (
                <div key={m.id} className="tool-card">
                  <div className="tool-head">
                    <span className={`dot ${m.status === 'done' ? 'on' : ''}`} style={m.status === 'error' ? { background: 'var(--red)' } : {}} />
                    <span className="name">{m.name}</span>
                    {m.mutating && <span className="badge amber">mutation</span>}
                    <span className="badge" style={{ marginLeft: 'auto' }}>{m.status}</span>
                  </div>
                  <div className="tool-body">
                    <pre>{JSON.stringify(m.input, null, 1)}</pre>
                    {m.output && (
                      <>
                        <div className="label" style={{ margin: '8px 0 4px' }}>result</div>
                        <pre style={m.status === 'error' ? { color: 'var(--red)' } : {}}>{m.output}</pre>
                      </>
                    )}
                  </div>
                </div>
              );
            }
            if (m.kind === 'approval') {
              return (
                <div key={m.id} className="approval-card">
                  <div className="title">Approval required — {m.name}</div>
                  <pre>{JSON.stringify(m.input, null, 1)}</pre>
                  {m.decided === null ? (
                    <div className="row">
                      <button className="btn amber sm" onClick={() => decide(m, true)}>Approve &amp; run</button>
                      <button className="btn danger sm" onClick={() => decide(m, false)}>Reject</button>
                    </div>
                  ) : (
                    <span className={`badge ${m.decided ? 'green' : 'red'}`}>{m.decided ? 'approved' : 'rejected'}</span>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>

        <div className="chat-input">
          <textarea
            className="textarea"
            placeholder="Tell the agent what to build or find on your instance…  (start with “remember:” to store a preference)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn primary" onClick={() => send()} aria-busy={running} disabled={running || !input.trim()}>
            {running ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
