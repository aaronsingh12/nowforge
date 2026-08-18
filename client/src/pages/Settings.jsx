import { useEffect, useState } from 'react';
import { api } from '../api.js';

const HINTS = {
  anthropic: { model: 'claude-sonnet-4-6', baseUrl: 'api.anthropic.com (fixed)', key: true },
  openai: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', key: true },
  ollama: { model: 'llama3.1 (tool-capable model required)', baseUrl: 'http://localhost:11434/v1', key: false },
};

export default function Settings() {
  const [llm, setLlm] = useState({ provider: 'anthropic', apiKey: '', baseUrl: '', model: '', embedModel: '' });
  const [memory, setMemory] = useState(null);
  const [saved, setSaved] = useState(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/system/settings').then((s) => {
      setSaved(s);
      setLlm({ provider: s.llm.provider, apiKey: '', baseUrl: s.llm.baseUrl, model: s.llm.model, embedModel: s.llm.embedModel || '' });
      setAutoApprove(s.agent.autoApprove);
    }).catch((e) => setError(e.message));
    api.get('/agent/memory/status').then(setMemory).catch(() => {});
  }, []);

  const hint = HINTS[llm.provider];

  const save = async () => {
    setNotice(''); setError('');
    try {
      const s = await api.post('/system/settings', { llm, agent: { autoApprove } });
      setSaved(s);
      setLlm((l) => ({ ...l, apiKey: '' }));
      setNotice('Settings saved.');
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <div className="card-title">LLM provider — bring your own model</div>
        <div className="field">
          <label className="label">Provider</label>
          <select className="select" value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.target.value, baseUrl: '', model: '' })}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </div>
        {hint.key && (
          <div className="field">
            <label className="label">API key {saved?.llm.hasApiKey ? '· saved' : ''}</label>
            <input className="input mono" type="password" placeholder={saved?.llm.hasApiKey ? '••••••••••••' : 'sk-…'}
              value={llm.apiKey} onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })} />
          </div>
        )}
        {llm.provider !== 'anthropic' && (
          <div className="field">
            <label className="label">Base URL</label>
            <input className="input mono" placeholder={hint.baseUrl} value={llm.baseUrl}
              onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })} />
          </div>
        )}
        <div className="field">
          <label className="label">Model</label>
          <input className="input mono" placeholder={hint.model} value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">
            Embedding model — semantic recall
            {memory && (
              <span className={`badge ${memory.degraded ? 'amber' : 'green'}`} style={{ marginLeft: 8 }}>
                {memory.degraded ? 'keyword only' : `semantic · ${memory.dim}d`}
              </span>
            )}
          </label>
          <input className="input mono" placeholder="nomic-embed-text" value={llm.embedModel}
            onChange={(e) => setLlm({ ...llm, embedModel: e.target.value })} />
          {memory?.degraded && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              Not pulled, so chat search matches words rather than meaning. Fix with{' '}
              <span className="mono">{memory.command}</span>
            </span>
          )}
        </div>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          Auto-approve agent mutations (skip the amber gate)
        </label>
        <button className="btn primary" onClick={save}>Save settings</button>
        {notice && <p className="ok-text">{notice}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="card">
        <div className="card-title">Notes</div>
        <div className="stack">
          <div className="note">
            Credentials and API keys are stored locally in <span className="mono">server/data/settings.json</span> on
            your machine — never sent anywhere except the instance / provider you configured. Keep that folder out of
            version control (it's gitignored).
          </div>
          <div className="note">
            Ollama runs fully local: point the base URL at <span className="mono">http://localhost:11434/v1</span> and
            pick a tool-capable model (llama3.1, qwen2.5). No API key, no metering — useful for client environments
            where data cannot leave the machine.
          </div>
          <div className="note">
            Conversations, the instance knowledge ledger and recall embeddings live in one SQLite file at{' '}
            <span className="mono">server/data/nowforge.db</span> (gitignored). Chats survive a server restart, and
            the ledger carries what this project has measured about your instance into every new session.
          </div>
          <div className="note warn">
            Auto-approve removes the human gate on create/update/delete. Recommended only on throwaway PDIs.
          </div>
        </div>
      </div>
    </div>
  );
}
