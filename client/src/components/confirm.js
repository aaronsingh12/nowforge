/**
 * One place destructive confirmation happens.
 *
 * Every delete in the catalog used to call `window.confirm` inline with its own
 * wording, which meant no consistent phrasing and — more to the point — no
 * single seam to replace. Track D's dialog component drops in here and nowhere
 * else: change this file, and every call site upgrades at once.
 *
 * The signature is deliberately promise-based even though window.confirm is
 * synchronous, so swapping in a real dialog later is not also an async
 * refactor of every caller.
 */

/**
 * @param {object} opts
 * @param {string} opts.action   what is about to happen, e.g. "Delete variable"
 * @param {string} opts.subject  what it happens to, e.g. "justification"
 * @param {string} [opts.detail] the consequence a person needs before deciding
 * @returns {Promise<boolean>}
 */
export function confirmDestructive({ action, subject, detail }) {
  const lines = [`${action} "${subject}"?`];
  if (detail) lines.push('', detail);
  // eslint-disable-next-line no-alert
  return Promise.resolve(window.confirm(lines.join('\n')));
}

/**
 * The consequence lines, written once so they read the same everywhere and so
 * the ones that are load-bearing are not left to a caller to remember.
 */
export const CONSEQUENCE = {
  variable:
    'Any UI policy that names this variable in a condition or an action will keep the reference and silently stop matching.',
  policy:
    'This removes the Fluent source and reinstalls the application, so it takes about a minute.',
  item: 'Its variables, choices and UI policies go with it.',
  choice:
    'A UI policy condition comparing against this value can never be true again.',
  guide: 'The guide is removed; the catalog items it referenced are not.',
  producer: 'The producer and its variables are removed; records it already created are not.',
};
