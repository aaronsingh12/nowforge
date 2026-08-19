import { logToServer } from './logging.js';

const BASE = '/api';

/**
 * Every call reports its outcome to the server terminal.
 *
 * Failures are logged with the status and the server's own message, so a
 * 400 the user only saw as a red box is greppable next to the request that
 * caused it. Bodies are NOT logged: this app posts a ServiceNow password
 * and an API key through here.
 */
async function request(method, path, body) {
  const start = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // The server is unreachable — the one failure the server cannot log.
    logToServer('error', `${method} ${path} — network failure: ${err.message}`);
    throw err;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const message = data?.message || `Request failed (${res.status})`;
    logToServer('error', `${method} ${path} → ${res.status}  ${message}`, data?.detail);
    throw new Error(message);
  }
  logToServer('debug', `${method} ${path} → ${res.status}  ${Date.now() - start}ms`);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

/**
 * Send a request and read Server-Sent Events off the response body.
 *
 * `method` exists because deleting a catalog UI policy is also a build and an
 * install — it removes the Fluent source and reinstalls the application — so it
 * streams progress exactly like the create does.
 */
export async function sse(path, body, onEvent, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok || !res.body) {
    let msg = 'Stream failed';
    try { msg = (await res.json()).message || msg; } catch { /* keep default */ }
    logToServer('error', `${method} ${path} (stream) → ${res.status}  ${msg}`);
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          let evt = null;
          try { evt = JSON.parse(line.slice(6)); }
          catch (err) { logToServer('warn', `${path} sent an unparseable SSE frame: ${err.message}`); }
          if (evt) {
            // The failure that started all this arrived here, was rendered as
            // a red box, and was never written down anywhere.
            if (evt.type === 'error') logToServer('error', `${path} stream error: ${evt.message}`, evt.detail);
            try { onEvent(evt); }
            catch (err) { logToServer('error', `handler for ${path} threw on a ${evt.type} event: ${err.message}`, err.stack); }
          }
        }
      }
    }
  }
}

/** ServiceNow display='all' fields come back as {value, display_value}. */
export const val = (r, f) => {
  const v = r?.[f];
  return v && typeof v === 'object' ? v.value : v;
};
export const disp = (r, f) => {
  const v = r?.[f];
  return v && typeof v === 'object' ? (v.display_value ?? v.value ?? '') : (v ?? '');
};
