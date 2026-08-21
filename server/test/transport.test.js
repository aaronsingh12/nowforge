import test from 'node:test';
import assert from 'node:assert/strict';

import { diagnoseFailure } from '../src/servicenow/client.js';
import {
  esc, derivedRemoteSysId, parseUpdateSetXml, verifyExportParity,
} from '../src/servicenow/transport-export.js';
import { listWorkspaces, workspaceForScope, managedScopeNames, refreshWorkspaces } from '../src/servicenow/workspaces.js';

/* ------------------------------------------------------------------ *
 * The 403 that is not an auth failure (§33)
 * ------------------------------------------------------------------ */

test('a business-rule abort is reported as a refused write, not bad credentials', () => {
  const d = diagnoseFailure({
    status: 403,
    detail: "Operation against file 'sys_update_xml' was aborted by Business Rule 'Handle updates moving between sets^0e5b9945'. Business Rule Stack:Handle updates moving between sets",
    host: 'dev442675.service-now.com', username: 'admin', method: 'PATCH', pathname: '/api/now/table/sys_update_xml/abc',
  });
  assert.equal(d.kind, 'business-rule');
  assert.equal(d.rule, 'Handle updates moving between sets');
  assert.match(d.message, /refused by the business rule "Handle updates moving between sets"/);
  // The regression this exists to prevent: sending someone to check a password
  // that was never wrong.
  assert.doesNotMatch(d.message, /password/i);
  assert.doesNotMatch(d.message, /hibernating/i);
});

test('the rule name stops at the caret — the sys_id after it is not part of the name', () => {
  const d = diagnoseFailure({
    status: 403,
    detail: "aborted by Business Rule 'Handle updates moving between sets^0e5b994583764f10b939cc65eeaad3c1'.",
  });
  assert.equal(d.rule, 'Handle updates moving between sets');
});

test('an API-level ACL names the table and says it is a permission, not a password', () => {
  const d = diagnoseFailure({
    status: 403, detail: 'Failed API level ACL Validation',
    host: 'dev442675.service-now.com', username: 'admin', pathname: '/api/now/table/sys_store_app',
  });
  assert.equal(d.kind, 'table-acl');
  assert.equal(d.table, 'sys_store_app');
  assert.match(d.message, /sys_store_app/);
  assert.match(d.message, /not a bad password/);
});

test('a 403 with no recognised detail still reads as a credentials problem', () => {
  const d = diagnoseFailure({ status: 403, detail: 'User Not Authenticated', username: 'admin', host: 'x.service-now.com' });
  assert.equal(d.kind, 'credentials');
  assert.match(d.message, /rejected the credentials/);
});

test('a 401 is always credentials, whatever the detail says', () => {
  const d = diagnoseFailure({ status: 401, detail: 'aborted by Business Rule \'Something\'', username: 'admin' });
  assert.equal(d.kind, 'credentials');
});

test('a non-auth failure keeps the instance message', () => {
  const d = diagnoseFailure({ status: 400, statusText: 'Bad Request', message: 'Invalid table name' });
  assert.equal(d.kind, 'other');
  assert.equal(d.message, 'Invalid table name');
});

/* ------------------------------------------------------------------ *
 * Export format
 * ------------------------------------------------------------------ */

test('the remote set sys_id is derived, so the same set exports identically twice', () => {
  const a = derivedRemoteSysId('238afb0a83b2c750b939cc65eeaad34b');
  const b = derivedRemoteSysId('238afb0a83b2c750b939cc65eeaad34b');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, derivedRemoteSysId('other'));
});

test('escaping is unconditional, so a payload carrying CDATA cannot break the file', () => {
  // The measured hazard: the platform wraps a payload in CDATA unless the
  // payload itself contains one, because CDATA cannot nest. A business rule's
  // payload carries <script><![CDATA[...]]></script>. Always-escape removes the
  // conditional — assert that the sequence that would end a CDATA block is gone.
  const payload = '<script><![CDATA[if (a < b && c > d) {}]]></script>';
  const out = esc(payload);
  assert.ok(!out.includes(']]>'), 'the CDATA terminator survived escaping');
  assert.ok(!out.includes('<script>'), 'a raw tag survived escaping');
  assert.match(out, /&lt;script&gt;/);
});

/** A minimal export in exactly the shape the builder emits. */
function fakeExport(rows, { remoteSysId = 'r'.repeat(32), setSysId = 's'.repeat(32) } = {}) {
  const el = (n, v) => (v === '' || v == null ? `<${n}/>` : `<${n}>${esc(v)}</${n}>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<unload unload_date="2026-01-01 00:00:00">',
    '<sys_remote_update_set action="INSERT_OR_UPDATE">',
    el('name', 'A set'), el('remote_sys_id', setSysId), el('sys_id', remoteSysId),
    el('application', 'global'), el('application_scope', 'global'), el('summary', String(rows.length)),
    '</sys_remote_update_set>',
    ...rows.map((r) => [
      '<sys_update_xml action="INSERT_OR_UPDATE">',
      el('action', 'INSERT_OR_UPDATE'), el('name', r.name), el('payload', r.payload),
      el('payload_hash', r.payloadHash), el('target_name', r.target), el('type', r.type),
      el('remote_update_set', remoteSysId), el('update_set', ''),
      '</sys_update_xml>',
    ].join('\n')),
    '</unload>', '',
  ].join('\n');
}

const ROWS = [
  { name: 'sc_cat_item_aaa', payload: '<?xml version="1.0"?><record_update table="sc_cat_item"><a>1</a></record_update>', payloadHash: '111', target: 'An item', type: 'Catalog Item' },
  { name: 'sys_script_bbb', payload: '<record_update table="sys_script"><script><![CDATA[x < 1 && y > 2;]]></script></record_update>', payloadHash: '222', target: 'A rule', type: 'Business Rule' },
];
const MANIFEST = {
  setSysId: 's'.repeat(32), remoteSysId: 'r'.repeat(32), count: 2,
  rows: ROWS.map((r) => ({ name: r.name, payloadHash: r.payloadHash, target: r.target, type: r.type })),
};

test('a payload survives the round trip byte for byte, CDATA and angle brackets included', () => {
  const parsed = parseUpdateSetXml(fakeExport(ROWS));
  assert.equal(parsed.updates.length, 2);
  for (const src of ROWS) {
    const got = parsed.updates.find((u) => u.name === src.name);
    assert.equal(got.payload, src.payload, `payload differs for ${src.name}`);
  }
});

test('parity passes when the export matches the set it was built from', () => {
  const r = verifyExportParity(fakeExport(ROWS), MANIFEST);
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.reparsed, 2);
  assert.deepEqual(r.problems, []);
});

test('parity FAILS when a row is missing — a name list that is short is caught', () => {
  const r = verifyExportParity(fakeExport([ROWS[0]]), MANIFEST);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /missing from the export: sys_script_bbb/.test(p)), r.problems.join('; '));
});

test('parity FAILS when a payload changed but its name did not', () => {
  // The failure a name-only check would wave through: right count, right names,
  // wrong content.
  const tampered = [{ ...ROWS[0], payloadHash: '999' }, ROWS[1]];
  const r = verifyExportParity(fakeExport(tampered), MANIFEST);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /payload hash differs for sc_cat_item_aaa/.test(p)), r.problems.join('; '));
});

test('parity FAILS when the export carries a row the set does not', () => {
  const extra = [...ROWS, { name: 'sys_ui_policy_ccc', payload: '<x/>', payloadHash: '333', target: 'Stowaway', type: 'UI Policy' }];
  const r = verifyExportParity(fakeExport(extra), MANIFEST);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /sys_ui_policy_ccc, which is not in the set/.test(p)), r.problems.join('; '));
});

test('parity FAILS when the rows are not attached to the exported set', () => {
  const detached = fakeExport(ROWS).replace(/<remote_update_set>r+<\/remote_update_set>/g, '<remote_update_set>deadbeef</remote_update_set>');
  const r = verifyExportParity(detached, MANIFEST);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /not attached to the exported set/.test(p)), r.problems.join('; '));
});

test('parity FAILS when the header points at a different local set', () => {
  const wrong = fakeExport(ROWS, { setSysId: 'f'.repeat(32) });
  const r = verifyExportParity(wrong, MANIFEST);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /header remote_sys_id/.test(p)), r.problems.join('; '));
});

test('an empty element parses as empty, not as null', () => {
  const parsed = parseUpdateSetXml(fakeExport([{ ...ROWS[0], payload: '' }]));
  assert.equal(parsed.updates[0].payload, '');
});

/* ------------------------------------------------------------------ *
 * The workspace registry — filesystem only, no instance
 * ------------------------------------------------------------------ */

test('the registry discovers the fluent workspace and reads its claimed scope', async () => {
  refreshWorkspaces();
  const ws = await listWorkspaces();
  assert.ok(ws.length >= 1, 'no workspace discovered');
  const fluent = ws.find((w) => w.id === 'fluent-workspace');
  assert.ok(fluent, 'fluent-workspace was not discovered');
  assert.equal(fluent.scope, 'x_2196302_nwforge');
  assert.equal(fluent.error, null);
  assert.ok(fluent.sourceCount > 0, 'no managed sources counted');
});

test('a scope resolves by either address — the name or the sys_id', async () => {
  const byName = await workspaceForScope('x_2196302_nwforge');
  const byId = await workspaceForScope('c44f3c6c37c24793be9f8b759c7818e4');
  assert.ok(byName, 'scope name did not resolve');
  assert.equal(byName.id, byId?.id, 'the two addresses resolved differently');
});

test('an unmanaged scope resolves to nothing rather than to the only workspace we have', async () => {
  assert.equal(await workspaceForScope('x_tepv_ts_dms'), null);
  assert.equal(await workspaceForScope('global'), null);
  assert.equal(await workspaceForScope(''), null);
});

test('the managed scope list is what the Applications page flags against', async () => {
  const names = await managedScopeNames();
  assert.ok(names.includes('x_2196302_nwforge'));
  assert.ok(!names.includes('global'));
});
