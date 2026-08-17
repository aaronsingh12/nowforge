import { getSettings } from '../config/store.js';

export class SnowError extends Error {
  constructor(message, status = 500, detail = null) {
    super(message);
    this.name = 'SnowError';
    this.status = status;
    this.detail = detail;
  }
}

let tokenCache = null; // { access_token, expiresAt }

export function resetAuthCache() {
  tokenCache = null;
}

function conn() {
  const { connection } = getSettings();
  if (!connection?.instanceUrl) {
    throw new SnowError('No ServiceNow connection configured. Open Dashboard → Connection and save your PDI details.', 400);
  }
  return connection;
}

async function getAuthHeader() {
  const c = conn();
  if (c.authType === 'oauth') {
    if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
      return `Bearer ${tokenCache.access_token}`;
    }
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      username: c.username,
      password: c.password,
    });
    const res = await fetch(`${c.instanceUrl}/oauth_token.do`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new SnowError(`OAuth token request failed (${res.status}). Check client id/secret and user credentials.`, res.status, (await res.text()).slice(0, 500));
    }
    const tok = await res.json();
    tokenCache = { access_token: tok.access_token, expiresAt: Date.now() + (Number(tok.expires_in) || 1800) * 1000 };
    return `Bearer ${tokenCache.access_token}`;
  }
  const b64 = Buffer.from(`${c.username}:${c.password}`).toString('base64');
  return `Basic ${b64}`;
}

async function snowFetch(pathname, { method = 'GET', body, params } = {}) {
  const c = conn();
  const url = new URL(c.instanceUrl.replace(/\/$/, '') + pathname);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: await getAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new SnowError(`Could not reach ${url.host}: ${err.message}. Is the instance URL correct and the PDI awake?`, 502);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* HTML error pages etc. */ }
  if (!res.ok) {
    const msg = json?.error?.message || `ServiceNow request failed (${res.status} ${res.statusText})`;
    throw new SnowError(msg, res.status, json?.error?.detail || text.slice(0, 500));
  }
  return json;
}

/**
 * Table API wrapper.
 * display: 'all' returns every field as { value, display_value } — this is how
 * reference fields stay usable end-to-end (sys_id for writes, label for humans).
 */
export const table = {
  async query(t, { query, fields, limit = 25, offset = 0, orderBy, orderByDesc, display = 'all' } = {}) {
    let q = query || '';
    if (orderBy) q += `${q ? '^' : ''}ORDERBY${orderBy}`;
    if (orderByDesc) q += `${q ? '^' : ''}ORDERBYDESC${orderByDesc}`;
    const data = await snowFetch(`/api/now/table/${encodeURIComponent(t)}`, {
      params: {
        sysparm_query: q,
        sysparm_fields: fields,
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: display,
        sysparm_exclude_reference_link: 'true',
      },
    });
    return data?.result ?? [];
  },

  async get(t, sysId, display = 'all') {
    const data = await snowFetch(`/api/now/table/${encodeURIComponent(t)}/${encodeURIComponent(sysId)}`, {
      params: { sysparm_display_value: display, sysparm_exclude_reference_link: 'true' },
    });
    return data?.result;
  },

  async create(t, payload, display = 'all') {
    const data = await snowFetch(`/api/now/table/${encodeURIComponent(t)}`, {
      method: 'POST',
      body: payload,
      params: { sysparm_display_value: display, sysparm_exclude_reference_link: 'true' },
    });
    return data?.result;
  },

  async update(t, sysId, payload, display = 'all') {
    const data = await snowFetch(`/api/now/table/${encodeURIComponent(t)}/${encodeURIComponent(sysId)}`, {
      method: 'PATCH',
      body: payload,
      params: { sysparm_display_value: display, sysparm_exclude_reference_link: 'true' },
    });
    return data?.result;
  },

  async remove(t, sysId) {
    await snowFetch(`/api/now/table/${encodeURIComponent(t)}/${encodeURIComponent(sysId)}`, { method: 'DELETE' });
    return { deleted: true, table: t, sys_id: sysId };
  },

  /** Aggregate API — used for dashboard counts. */
  async count(t, query) {
    const data = await snowFetch(`/api/now/stats/${encodeURIComponent(t)}`, {
      params: { sysparm_count: 'true', sysparm_query: query },
    });
    return Number(data?.result?.stats?.count ?? 0);
  },
};

export async function testConnection() {
  resetAuthCache();
  const users = await table.query('sys_user', { limit: 1, fields: 'sys_id,user_name', display: 'false' });
  let build = null;
  try {
    const props = await table.query('sys_properties', {
      query: 'name=glide.buildname.full', fields: 'value', limit: 1, display: 'false',
    });
    build = props[0]?.value ?? null;
  } catch { /* property may be ACL-restricted; connection still fine */ }
  return { ok: true, sampleUser: users[0]?.user_name ?? null, build };
}
