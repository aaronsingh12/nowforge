import crypto from 'node:crypto';

/**
 * Model-proofing guards A2–A5. Pure functions, no I/O, so the whole set is
 * exercised offline by server/test/model-proofing.test.js.
 *
 * Each one exists because a measured failure of `gpt-oss:120b-cloud` produced a
 * WRONG artifact rather than an error (docs/fluent-research.md §14):
 *
 *   A2  the same spec produced a different flow NAME on all six runs. The
 *       platform matches artifacts by name, so a rename is a duplicate record.
 *   A3  one regeneration silently dropped the `"Vendor issue: "` prefix the
 *       request asked for. It compiled, installed, and did the wrong thing.
 *   A4  nothing set `trigger_strategy`, so the platform's `once` default took
 *       over — fires once EVER per record (trap #10).
 *   A5  three verification attempts re-asked the identical question and got
 *       the identical bad answer back, burning the attempt budget for nothing.
 *
 * The house rule applies throughout: a guard that fires is a LOUD failure with
 * a diagnostic the model can act on, never a silent correction. A2 is the one
 * exception and is deliberate — identity is rewritten mechanically because
 * asking politely for it is exactly what was measured not to work — and even
 * then the rewrite is reported, never hidden.
 */

/* ------------------------------------------------------------------ *
 * A2 — pinned flow identity
 * ------------------------------------------------------------------ */

const ARTIFACT_RE = /\b(Subflow|Flow)\s*\(/g;

/**
 * Locate each Flow(...)/Subflow(...) header and the `name:` string literal
 * inside its FIRST config object, by brace matching rather than by a fixed
 * window — an action parameter further down the file also has a `name:`, and a
 * regex wide enough to catch a long header is wide enough to hit one.
 */
export function findArtifactNames(source) {
  const text = String(source || '');
  const out = [];
  ARTIFACT_RE.lastIndex = 0;
  let m;
  while ((m = ARTIFACT_RE.exec(text))) {
    const open = text.indexOf('{', m.index);
    if (open < 0) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) continue;
    const config = text.slice(open, close + 1);
    const nm = config.match(/\bname\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/);
    if (!nm) continue;
    out.push({
      kind: m[1] === 'Subflow' ? 'subflow' : 'flow',
      name: nm[2],
      // Absolute offsets of the quoted literal, so a rewrite is a string splice
      // and cannot disturb anything else in the file.
      start: open + nm.index + nm[0].indexOf(nm[1]),
      end: open + nm.index + nm[0].length,
      quote: nm[1],
    });
  }
  return out;
}

/**
 * A2 — force the artifact names back to the pinned ones.
 *
 * `pins` is [{kind, name}] in declaration order, taken from the deployed source
 * on a regeneration or from the intent/first attempt on a new request. Pins are
 * matched POSITIONALLY within their kind: a flow+subflow source has one of
 * each, and matching by kind keeps them from swapping.
 *
 * Returns the corrected source plus every rewrite performed, so the caller can
 * warn instead of silently accepting a rename.
 */
export function pinArtifactNames(source, pins = []) {
  const found = findArtifactNames(source);
  if (!pins.length || !found.length) return { source: String(source || ''), rewrites: [] };

  const byKind = { flow: [], subflow: [] };
  for (const f of found) byKind[f.kind].push(f);
  const pinIdx = { flow: 0, subflow: 0 };

  const rewrites = [];
  for (const pin of pins) {
    if (!pin?.name || !pin.kind) continue;
    const slot = byKind[pin.kind]?.[pinIdx[pin.kind]];
    pinIdx[pin.kind] = (pinIdx[pin.kind] ?? 0) + 1;
    if (!slot) continue;
    if (slot.name === pin.name) continue;
    rewrites.push({ kind: pin.kind, from: slot.name, to: pin.name, start: slot.start, end: slot.end, quote: slot.quote });
  }
  if (!rewrites.length) return { source: String(source || ''), rewrites: [] };

  // Splice back-to-front so earlier offsets stay valid.
  let text = String(source);
  for (const r of [...rewrites].sort((a, b) => b.start - a.start)) {
    const literal = `${r.quote}${r.to.replace(/\\/g, '\\\\').replace(new RegExp(r.quote, 'g'), `\\${r.quote}`)}${r.quote}`;
    text = text.slice(0, r.start) + literal + text.slice(r.end);
  }
  return {
    source: text,
    rewrites: rewrites.map(({ kind, from, to }) => ({ kind, from, to })),
  };
}

/* ------------------------------------------------------------------ *
 * A3 — promised literals
 * ------------------------------------------------------------------ */

/**
 * A literal is only enforced when the SPEC ITSELF contains it verbatim.
 *
 * The candidate list comes from the intent extractor, which is the same weak
 * model the guard exists to police, so its output cannot be trusted on its own:
 * a hallucinated "requirement" would block a correct flow, which is the failure
 * mode this repo keeps having to undo. Intersecting against the spec text makes
 * a false requirement structurally impossible — the model can only ever narrow
 * the guard to something the user actually wrote.
 */
export function groundLiterals(spec, claimed = []) {
  const text = String(spec || '');
  const seen = new Set();
  const out = [];
  for (const lit of claimed) {
    if (typeof lit !== 'string') continue;
    // NOT trimmed: for a prefix the trailing space IS the promise. "Vendor
    // issue: " and "Vendor issue:" are different requirements, and the one the
    // request actually wrote is the one to enforce.
    // Two characters is a coin toss against any source file; three is a claim.
    if (lit.trim().length < 3) continue;
    if (!text.includes(lit)) continue;
    if (seen.has(lit)) continue;
    seen.add(lit);
    out.push(lit);
  }
  return out;
}

/**
 * A3 — every grounded literal must survive into the generated source.
 *
 * Catches the measured defect where a regeneration dropped the `"Vendor issue: "`
 * prefix: the flow compiled, installed, activated, and wrote the wrong text.
 * Nothing downstream could see it — the build is green and the verification
 * assertion is written by the same model that dropped it.
 */
export function checkPromisedLiterals(source, literals = []) {
  const text = String(source || '');
  const missing = literals.filter((l) => !text.includes(l));
  return {
    ok: missing.length === 0,
    missing,
    diagnostic: missing.length
      ? `ERROR: promised literal text missing from the generated source.\n` +
        missing
          .map(
            (l) =>
              `ERROR: the request asks for the exact text ${JSON.stringify(l)}, which does not appear ` +
              `anywhere in your source. It is a value the flow must WRITE — a prefix, a note, a subject — ` +
              `not a description of behaviour. Reproduce it character for character, including spacing ` +
              `and punctuation. Do not paraphrase it, translate it, or drop it.`
          )
          .join('\n')
      : null,
  };
}

/* ------------------------------------------------------------------ *
 * A4 — trigger_strategy lint
 * ------------------------------------------------------------------ */

const UPDATE_TRIGGER_RE = /trigger\.record\.(updated|createdOrUpdated)\b/;

/**
 * Language that describes a TRANSITION rather than a standing condition.
 * "when an incident is put On Hold", "when state changes to 3", "once it moves
 * to Awaiting Vendor" — all of them want the flow to fire again the next time
 * the record makes that move, which is `unique_changes`, not `once`.
 */
const TRANSITION_RE = new RegExp(
  [
    // Movement into a state: "updated to", "moves to", "is set to", "put into".
    String.raw`\b(?:updated?|changes?|changed|moves?|moved|transitions?|transitioned|switch(?:es|ed)?|goes|went|set|put|placed|flips?|flipped)\s+(?:in)?to\b`,
    // "becomes 1" takes no preposition, so it cannot share the branch above.
    String.raw`\bbecomes?\b`,
    String.raw`\bbecame\b`,
    String.raw`\btransitions?\b`,
    String.raw`\bre-?enters?\b`,
    // Repetition language — all of it means per-occurrence, i.e. not `once`.
    String.raw`\bwhenever\b`,
    String.raw`\beach time\b`,
    String.raw`\bevery time\b`,
  ].join('|'),
  'i'
);

export function describesTransition(spec) {
  return TRANSITION_RE.test(String(spec || ''));
}

/**
 * A4 — an updated/createdOrUpdated trigger must set `trigger_strategy`, and a
 * spec phrased as a transition must set it to `unique_changes`.
 *
 * Trap #10: omitting it is NOT neutral. The platform default is `once`, and
 * `once` means once EVER for a record — a record that leaves the condition and
 * comes back is never processed again. Nothing in the build, the install, the
 * activation count or a single-shot verification run can see this: the first
 * firing works perfectly. It is only wrong the second time, in production.
 */
export function lintTriggerStrategy(source, spec) {
  const text = String(source || '');
  const trig = text.match(UPDATE_TRIGGER_RE);
  if (!trig) return { ok: true, errors: [], diagnostic: null, applicable: false };

  const errors = [];
  const declared = text.match(/\btrigger_strategy\s*:\s*(['"])([a-z_]+)\1/);
  const wantsTransition = describesTransition(spec);

  if (!declared) {
    errors.push(
      `trigger.record.${trig[1]} is used but trigger_strategy is not set. Omitting it is not neutral: ` +
        `the platform default is 'once', which fires once EVER for a record and never again — not even ` +
        `after the record leaves the trigger condition and comes back. Set it explicitly. ` +
        (wantsTransition
          ? `This request is phrased as a TRANSITION, so it must be trigger_strategy: 'unique_changes'.`
          : `Use 'unique_changes' for a per-transition flow, or 'every' to fire on every save while the ` +
            `condition holds — 'every' duplicates any record the flow creates, so choose it deliberately.`)
    );
  } else if (wantsTransition && declared[2] !== 'unique_changes') {
    errors.push(
      `trigger_strategy is '${declared[2]}', but this request describes a TRANSITION ("...to <state>"), ` +
        `which fires once per transition and must be trigger_strategy: 'unique_changes'. ` +
        (declared[2] === 'once'
          ? `'once' fires once EVER for a record: the second time it makes this transition, nothing happens.`
          : `'every' fires on every save while the condition holds, duplicating any record the flow creates.`)
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    applicable: true,
    strategy: declared?.[2] || null,
    transitionLanguage: wantsTransition,
    diagnostic: errors.length ? `ERROR: trigger strategy lint failed before build.\n${errors.map((e) => `ERROR: ${e}`).join('\n')}` : null,
  };
}

/* ------------------------------------------------------------------ *
 * A5 — retries must add evidence
 * ------------------------------------------------------------------ */

export const promptHash = (text) => crypto.createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16);

/**
 * A5 — makes an identical re-ask structurally impossible.
 *
 * Measured failure: three verification attempts sent the same question and got
 * the same rejected answer, so the attempt budget bought nothing and the run
 * ended "could not produce a spec" without ever having asked a second question.
 *
 * A retry is only allowed to go out if its prompt DIFFERS from every prompt
 * already sent for this request. When it doesn't, that is a bug in the evidence
 * builder, and it fails loudly here rather than quietly wasting an attempt.
 */
export class RetryLedger {
  constructor(label = 'generation') {
    this.label = label;
    this.hashes = [];
  }

  /** Records a prompt about to be sent. Throws if it repeats an earlier one. */
  record(prompt) {
    const h = promptHash(prompt);
    const prior = this.hashes.indexOf(h);
    if (prior >= 0) {
      throw new Error(
        `${this.label} retry ${this.hashes.length + 1} would send a prompt byte-identical to attempt ${prior + 1}. ` +
          `A retry that adds no evidence cannot produce a different answer, so the attempt budget would be ` +
          `spent re-asking a question already answered. This is a defect in the evidence builder, not a ` +
          `model failure.`
      );
    }
    this.hashes.push(h);
    return h;
  }

  get attempts() {
    return this.hashes.length;
  }
}
