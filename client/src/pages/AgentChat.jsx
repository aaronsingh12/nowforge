import { useEffect, useRef, useState } from 'react';
import { api, sse } from '../api.js';

const SAMPLES = [
  'Create a "Laptop Request" catalog item with 6 sensible variables including a reference to sys_user and a model select box',
  'Show me all critical incidents that are assigned to no one',
  'Design a flow: when a P1 incident is created, notify the assignment group manager',
];

let nextId = 1;
const uid = () => `m${nextId++}`;

export default function AgentChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const sessionId = useRef(crypto.randomUUID());
  const bottom = useRef(null);

  useEffect(() => {
    api.get('/system/settings').then((s) => setAutoApprove(s.agent.autoApprove)).catch(() => {});
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
      await sse('/agent/chat', { sessionId: sessionId.current, message }, (evt) => {
        switch (evt.type) {
          case 'meta':
            setMeta(evt);
            break;
          case 'assistant_text':
            push({ kind: 'assistant', text: evt.text });
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
          case 'error':
            push({ kind: 'error', text: evt.message });
            break;
          default:
            break;
        }
      });
    } catch (e) {
      push({ kind: 'error', text: e.message });
    } finally {
      setRunning(false);
    }
  };

  const decide = async (m, approved) => {
    patchMsg((x) => x.id === m.id, { decided: approved });
    try { await api.post('/agent/approve', { sessionId: sessionId.current, approvalId: m.approvalId, approved }); }
    catch { /* server timeout path handles it */ }
  };

  return (
    <div className="chat-wrap">
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="row">
          {meta && <span className="badge blue">{meta.provider} · <span className="mono">{meta.model}</span></span>}
          {!meta && <span className="badge">provider set in Settings</span>}
        </div>
        <label className="check" title="When off, every create/update/delete pauses for your approval — like Claude Code permissions.">
          <input type="checkbox" checked={autoApprove} onChange={(e) => toggleAuto(e.target.checked)} />
          Auto-approve mutations
        </label>
      </div>

      <div className="msgs">
        {messages.length === 0 && (
          <div className="card" style={{ maxWidth: 780 }}>
            <div className="card-title">NowForge Agent</div>
            <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--muted)' }}>
              Talks to your bound instance with 15 tools: schema inspection, reference resolution, record CRUD,
              catalog composites, and flow reading + blueprint design. Every mutation stops at the amber gate
              until you approve it.
            </p>
            <div className="chips">
              {SAMPLES.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}

        {messages.map((m) => {
          if (m.kind === 'user' || m.kind === 'assistant') {
            return <div key={m.id} className={`msg ${m.kind}`}><div className="bubble">{m.text}</div></div>;
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
        <div ref={bottom} />
      </div>

      <div className="chat-input">
        <textarea
          className="textarea"
          placeholder="Tell the agent what to build or find on your instance…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn primary" onClick={() => send()} disabled={running || !input.trim()}>
          {running ? 'Working…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
