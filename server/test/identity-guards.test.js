/**
 * Regression proof for the CLASS C duplicate-identity failure
 * (docs/fluent-research.md §12). Entirely offline — no instance, no SDK, no LLM.
 *
 *   node --test server/test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  collectElementIds,
  validateCandidateIds,
  sanitizeIds,
  restoreIds,
  sanitizeExampleIds,
  specFingerprint,
  slugify,
  snapshotSources,
  restoreSources,
  diffAgainstSnapshot,
} from '../src/servicenow/fluent.js';

/* ------------------------------------------------------------------ *
 * Fixtures — shaped like the real sources that collided.
 * ------------------------------------------------------------------ */

const DEPLOYED_ESCALATE = `// nowforge-spec: 760d0f37ea51f7e5
import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    { $id: Now.ID['escalate_network_p1_incident_flow'], name: 'Escalate Network P1 Incident', runAs: 'system' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['escalate_network_p1_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.action(action.core.updateRecord, { $id: Now.ID['add_work_note'] }, {
            table_name: 'incident',
            record: wfa.dataPill(params.trigger.current, 'reference'),
        })
    }
)
`;

const DEPLOYED_DEMO = `// nowforge-spec: a761451fbca44f21
import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    { $id: Now.ID['demo_incident_flow_main'], name: 'Demo Incident Flow', runAs: 'system' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['demo_incident_created_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.flowLogic.if({ $id: Now.ID['if_priority_critical'], condition: 'x=1' }, () => {})
    }
)
`;

const PROJECT = [
  { file: 'escalate-network-p1-incident.now.ts', source: DEPLOYED_ESCALATE },
  { file: 'demo-incident-flow.now.ts', source: DEPLOYED_DEMO },
];

/** A candidate that reuses both keys — the exact shape of the live failure. */
const CANDIDATE_CLASS_C = `// nowforge-spec: deadbeefdeadbeef
import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    { $id: Now.ID['vendor_hold_flow'], name: 'Vendor Hold Problem', runAs: 'system' },
    wfa.trigger(trigger.record.updated, { $id: Now.ID['vh_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.action(action.core.updateRecord, { $id: Now.ID['add_work_note'] }, { table_name: 'incident' })
        wfa.flowLogic.if({ $id: Now.ID['if_priority_critical'], condition: 'y=1' }, () => {})
    }
)
`;

/* ------------------------------------------------------------------ *
 * Guard 1 — pre-build static validation
 * ------------------------------------------------------------------ */

test('collectElementIds finds every Now.ID key with its line number', () => {
  const ids = collectElementIds(DEPLOYED_ESCALATE);
  assert.deepEqual(
    ids.map((i) => i.key),
    ['escalate_network_p1_incident_flow', 'escalate_network_p1_trigger', 'add_work_note']
  );
  assert.equal(ids[2].line, 8);
});

test('a candidate with a duplicate $id INSIDE it is rejected, naming both lines', () => {
  const dup = `import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'
Flow(
    { $id: Now.ID['vhp_flow'], name: 'Vendor Hold Problem', runAs: 'system' },
    wfa.trigger(trigger.record.updated, { $id: Now.ID['vhp_trigger'] }, { table: 'incident' }),
    () => {
        wfa.action(action.core.createRecord, { $id: Now.ID['vhp_note'] }, { table_name: 'problem' })
        wfa.action(action.core.updateRecord, { $id: Now.ID['vhp_note'] }, { table_name: 'incident' })
    }
)
`;
  const res = validateCandidateIds(dup, [], { file: 'candidate-deadbeefdeadbeef.now.ts' });

  assert.equal(res.ok, false, 'the duplicate must be rejected');
  assert.equal(res.errors.length, 1);

  const e = res.errors[0];
  assert.match(e, /Now\.ID\['vhp_note'\]/, 'names the duplicated key');
  assert.match(e, /is defined 2 times/, 'uses the wording the SDK itself would use');
  assert.match(e, /line 6 and line 7/, 'names BOTH definition sites');

  // The diagnostic is shaped like compiler output so the retry prompt feeds it
  // back to the model unchanged.
  assert.match(res.diagnostic, /^ERROR: identity validation failed before build\./);
  assert.match(res.diagnostic, /ERROR: Duplicate \$id/);
});

test('CLASS C: a candidate reusing keys owned by OTHER sources is rejected with both sites', () => {
  const res = validateCandidateIds(CANDIDATE_CLASS_C, PROJECT, {
    file: 'candidate-deadbeefdeadbeef.now.ts',
  });

  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 2, 'one error per colliding key');

  const workNote = res.errors.find((e) => e.includes("'add_work_note'"));
  assert.ok(workNote, 'reports the add_work_note collision');
  assert.match(workNote, /candidate-deadbeefdeadbeef\.now\.ts:8/, 'names the candidate site');
  assert.match(workNote, /escalate-network-p1-incident\.now\.ts:8/, 'names the owning source');
  assert.match(workNote, /PROJECT-WIDE namespace/);
  assert.match(workNote, /vhp_add_work_note/, 'suggests a flow-prefixed replacement key');

  const ifCritical = res.errors.find((e) => e.includes("'if_priority_critical'"));
  assert.ok(ifCritical, 'reports the if_priority_critical collision');
  assert.match(ifCritical, /demo-incident-flow\.now\.ts:8/, 'names the owning source');
});

test('a candidate with freshly minted, flow-prefixed keys passes', () => {
  const clean = CANDIDATE_CLASS_C
    .replace("'add_work_note'", "'vhp_add_work_note'")
    .replace("'if_priority_critical'", "'vhp_if_priority_critical'");
  const res = validateCandidateIds(clean, PROJECT, { file: 'candidate-deadbeefdeadbeef.now.ts' });
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
  assert.equal(res.diagnostic, null);
});

test('a source is never judged a collision with itself', () => {
  // Regeneration writes over the artifact's own file; its own keys must not
  // read as duplicates or every update would be rejected.
  const res = validateCandidateIds(DEPLOYED_ESCALATE, PROJECT, {
    file: 'escalate-network-p1-incident.now.ts',
  });
  assert.equal(res.ok, true, res.errors.join('\n'));
});

test('a literal sys_id used as an $id is rejected', () => {
  const bad = `Flow({ $id: '10c0ec9dcf0c486ab1e40f73c0edbe8d', name: 'Bad' })`;
  const res = validateCandidateIds(bad, [], { file: 'c.now.ts' });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Literal sys_id used as an \$id/);
});

test('an unresolved __ID_n__ placeholder is rejected', () => {
  const bad = `Flow({ $id: Now.ID['__ID_1__'], name: 'Leaked placeholder' })`;
  const res = validateCandidateIds(bad, [], { file: 'c.now.ts' });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Unresolved placeholder \$id/);
});

/* ------------------------------------------------------------------ *
 * Guard 2 — retry hygiene: one filename per request
 * ------------------------------------------------------------------ */

test('a retry that renames the flow still writes the SAME candidate filename', () => {
  // The Phase 3 defect: the filename was slugified from the model's chosen
  // artifact name, so a renamed flow on attempt 2 wrote a SECOND file. The
  // candidate name now comes from the spec fingerprint alone.
  const spec =
    'When an incident is updated to state On Hold with hold reason Awaiting Vendor, create a problem record.';

  const attempt1Name = 'Vendor Hold Problem Creation';
  const attempt2Name = 'Create Problem On Vendor Hold'; // model renamed it mid-retry
  const attempt3Name = 'Vendor Hold → Problem';

  const fingerprint = specFingerprint(spec);
  const candidateFor = (fp) => `candidate-${fp}.now.ts`;

  // What the pipeline actually writes on each attempt.
  const written = [attempt1Name, attempt2Name, attempt3Name].map(() => candidateFor(fingerprint));

  assert.equal(new Set(written).size, 1, 'all three attempts target one filename');
  assert.equal(written[0], `candidate-${fingerprint}.now.ts`);
  assert.match(written[0], /^candidate-[0-9a-f]{16}\.now\.ts$/);

  // And prove the old behaviour would NOT have: name-derived paths diverge.
  const nameDerived = [attempt1Name, attempt2Name, attempt3Name].map((n) => `${slugify(n)}.now.ts`);
  assert.equal(new Set(nameDerived).size, 3, 'name-derived filenames diverge — the original bug');
});

test('the fingerprint is stable for one spec and different for another', () => {
  const spec = 'When an incident is updated to state On Hold with hold reason Awaiting Vendor.';
  assert.equal(specFingerprint(spec), specFingerprint(`  ${spec.toUpperCase()}  `),
    'whitespace and case are normalised, so the same request re-finds its own file');
  assert.notEqual(specFingerprint(spec), specFingerprint(`${spec} Also page the on-call.`));
});

test('a failed run restores src/ to its pre-request state, and the diff proves it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nowforge-hygiene-'));
  try {
    await fsp.writeFile(path.join(dir, 'deployed.now.ts'), DEPLOYED_ESCALATE, 'utf8');
    await fsp.writeFile(path.join(dir, 'deployed.verify.json'), '{"assert":[]}', 'utf8');
    const before = await snapshotSources(dir);

    // What a failing run does to src/: it writes a candidate, and on a
    // REGENERATION it overwrites the deployed artifact's own source in place.
    await fsp.writeFile(path.join(dir, 'candidate-deadbeefdeadbeef.now.ts'), CANDIDATE_CLASS_C, 'utf8');
    await fsp.writeFile(path.join(dir, 'deployed.now.ts'), '// clobbered by a failed attempt', 'utf8');

    const dirty = await diffAgainstSnapshot(before, dir);
    assert.deepEqual(
      dirty.sort(),
      ['left behind: candidate-deadbeefdeadbeef.now.ts', 'modified: deployed.now.ts'],
      'the assertion detects both kinds of drift'
    );

    await restoreSources(before, dir);

    assert.deepEqual(await diffAgainstSnapshot(before, dir), [],
      'src/ is byte-identical to its pre-request state');
    assert.equal(fs.existsSync(path.join(dir, 'candidate-deadbeefdeadbeef.now.ts')), false,
      'the candidate is gone');
    assert.equal(await fsp.readFile(path.join(dir, 'deployed.now.ts'), 'utf8'), DEPLOYED_ESCALATE,
      'the deployed source is RESTORED, not deleted — a failed regeneration must not drop a live flow');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Guard 3 — context sanitation
 * ------------------------------------------------------------------ */

test('sanitizeIds hides every live key behind a placeholder', () => {
  const { text, map } = sanitizeIds(DEPLOYED_ESCALATE);
  assert.ok(!text.includes('add_work_note'), 'no live key survives into the prompt');
  assert.ok(!text.includes('escalate_network_p1_trigger'));
  assert.match(text, /Now\.ID\['__ID_1__'\]/);
  assert.equal(map.size, 3);
  assert.equal(map.get('__ID_3__'), 'add_work_note');
  assert.ok(text.includes("name: 'Escalate Network P1 Incident'"),
    'names are NOT touched — the verbatim-name survival mechanism stays');
});

test('restoreIds puts identity back exactly, so regeneration stays idempotent', () => {
  const { text, map } = sanitizeIds(DEPLOYED_ESCALATE);
  assert.equal(restoreIds(text, map), DEPLOYED_ESCALATE, 'a full round trip is lossless');

  // The realistic case: the model keeps the placeholders and adds one new
  // element of its own.
  const edited = text.replace(
    "(params) => {",
    "(params) => {\n        wfa.action(action.core.log, { $id: Now.ID['enp_new_log'] }, { log_level: 'info' })"
  );
  const restored = restoreIds(edited, map);
  assert.ok(restored.includes("Now.ID['add_work_note']"), 'existing records keep their identity');
  assert.ok(restored.includes("Now.ID['enp_new_log']"), 'a freshly minted key is left alone');
  assert.ok(!restored.includes('__ID_'), 'no placeholder leaks into the written source');
});

test('one shared map keeps a record on the same placeholder across both fed-back sources', () => {
  const map = new Map();
  const a = sanitizeIds(DEPLOYED_ESCALATE, map).text;
  const b = sanitizeIds(DEPLOYED_ESCALATE.replace('Escalate Network P1 Incident', 'Renamed'), map).text;
  assert.equal(map.size, 3, 'the second pass reuses the first pass placeholders');
  assert.equal(
    a.match(/__ID_\d+__/g).join(),
    b.match(/__ID_\d+__/g).join(),
    'the deployed source and the retry source agree on every identity'
  );
});

test('cheatsheet example keys are neutralised before the model sees them', () => {
  const cheat = "wfa.action(action.core.log, { $id: Now.ID['log'] }, {})\n{ $id: Now.ID['nm_send_email'] }";
  const out = sanitizeExampleIds(cheat);
  assert.ok(out.includes("Now.ID['ex_log']"));
  assert.ok(out.includes("Now.ID['ex_nm_send_email']"));
  assert.equal(sanitizeExampleIds(out), out, 'already-prefixed keys are left alone');
});
