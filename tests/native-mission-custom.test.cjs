'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// These contract tests use no browser, game account, network or dependencies.
// Native control/dispatch flows are verified separately in Firefox.
const source = fs.readFileSync(process.env.QA_NATIVE_MISSION_SOURCE ||
  path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
function moduleSource(name) {
  const start = source.indexOf('// BEGIN ' + name);
  const end = source.indexOf('// END ' + name, start);
  assert.ok(start >= 0 && end > start, name + ' markers exist');
  return source.slice(start, end);
}
const adapterSource = moduleSource('NATIVE MISSION ADAPTER');
const scope = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fleet = (extra = {}) => ({ probe: 0, marauder: 9, sentinel: 0, vanguard: 1, ...extra });
const customJob = (extra = {}) => ({ id: 'pending-one', scope, originId, originName: 'Origin',
  target: { mode: 'custom', routeKey: '', presetKey: 'Use 9 Marauder, 1 Vanguard',
    label: 'Target', coordinate: { q: 2, r: 1 }, missionAction: 'attack' },
  quantities: fleet(), produce: true, autoSend: true, status: 'sending', createdAt: 1000,
  updatedAt: 2000, claimedAt: 2000, sentAt: null, needsReview: false, message: '', ...extra });

function adapterHarness({ action = 'Attack', zeroStock = false, resolver = true } = {}) {
  class Element {
    constructor() { this.attributes = new Map(); this.isConnected = true; this.hidden = false; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    closest() { return null; }
    remove() { this.isConnected = false; }
  }
  class Button extends Element { constructor() { super(); this.disabled = zeroStock; this.textContent = action; } }
  class Dialog extends Element {}
  class Input extends Element {}
  const nativeAction = new Button();
  const inspector = new Dialog();
  const coord = new Element();
  coord.setAttribute('aria-label', 'Copy coordinates 2, 1');
  inspector.matches = selector => selector === '.info-modal[data-content-type="inspect"]';
  inspector.querySelector = selector => {
    if (selector === '.inspect-copy-coord') return coord;
    if (selector === '.info-modal-trailing .info-modal-header-btn') return new Button();
    if (selector === '.inspect-actions > button.inspect-action-btn') return nativeAction;
    if (selector === '.inspect-system-name-text') return { textContent: 'Target' };
    return null;
  };
  const sandbox = vm.createContext({ AbortController, HTMLElement: Element, HTMLButtonElement: Button,
    HTMLDialogElement: Dialog, HTMLInputElement: Input,
    document: { createElement: () => new Element(), head: { append() {} } },
    window: { addEventListener() {}, removeEventListener() {} } });
  vm.runInContext(adapterSource + '\nthis.factory = createNativeMissionAdapter;', sandbox);
  const adapter = sandbox.factory({
    getContext: () => ({ scope, originId, originName: 'Origin', selectionCount: 1 }),
    getFleet: () => ({ parked: zeroStock ? 0 : 20, away: 0, building: 0 }),
    resolveTarget: resolver ? async () => { throw new Error('No browser resolution in a contract test.'); } : null,
  });
  return { adapter, inspector, nativeAction, destroy: () => adapter.destroy() };
}

for (const missionAction of ['attack', 'send', undefined]) {
  test('custom composition accepts verified ' + (missionAction || 'legacy native') + ' action', () => {
    const h = adapterHarness();
    try {
      const job = customJob();
      if (missionAction === undefined) delete job.target.missionAction;
      else job.target.missionAction = missionAction;
      assert.equal(h.adapter.connected(job), true);
      assert.equal(h.adapter.attach(job.id, { spec: job, handle: null }), true);
    } finally { h.destroy(); }
  });
}

test('a custom composition retains its original route and preset provenance', () => {
  const h = adapterHarness();
  try {
    const job = customJob();
    job.target.routeKey = '<div>original verified route</div>';
    job.quantities = fleet({ marauder: 3, sentinel: 4, vanguard: 0 });
    assert.equal(h.adapter.connected(job), true,
      'a custom fleet no longer needs to match the original preset quantities');
  } finally { h.destroy(); }
});

for (const [name, mutate] of [
  ['unknown mission action', job => { job.target.missionAction = 'transport'; }],
  ['mixed-case mission action', job => { job.target.missionAction = 'Attack'; }],
  ['unrecognized custom mode', job => { job.target.mode = 'custom-attack'; }],
  ['custom origin-coordinate field', job => { job.target.originCoordinate = { q: 0, r: 0 }; }],
  ['no destination coordinates', job => { delete job.target.coordinate; }],
  ['fractional coordinates', job => { job.target.coordinate.q = 1.5; }],
  ['native count overflow', job => { job.quantities.marauder = 50001; }],
  ['fractional ship count', job => { job.quantities.sentinel = 1.5; }],
  ['negative ship count', job => { job.quantities.probe = -1; }],
  ['unknown ship type', job => { job.quantities.cruiser = 1; }],
  ['empty fleet', job => { job.quantities = fleet({ marauder: 0, vanguard: 0 }); }],
]) {
  test('custom composition rejects ' + name, () => {
    const h = adapterHarness();
    try { const job = customJob(); mutate(job); assert.equal(h.adapter.connected(job), false); }
    finally { h.destroy(); }
  });
}

test('custom fleet permits all four native types and the exact native upper bound', () => {
  const h = adapterHarness();
  try {
    const job = customJob({ quantities: { probe: 50000, marauder: 50000, sentinel: 50000, vanguard: 50000 } });
    assert.equal(h.adapter.connected(job), true);
    job.quantities = { probe: 1, marauder: 0, sentinel: 0, vanguard: 0 };
    assert.equal(h.adapter.connected(job), true, 'an ordinary probe mission is a valid nonempty fleet');
  } finally { h.destroy(); }
});

for (const [label, action] of [['Attack', 'attack'], ['Send fleet', 'send']]) {
  for (const zeroStock of [false, true]) {
    test(label + ' capture records mission action with ' + (zeroStock ? 'zero' : 'available') + ' stock', () => {
      const h = adapterHarness({ action: label, zeroStock });
      try {
        const captured = h.adapter.captureInspect(h.inspector, fleet(), 'Use 9 Marauder, 1 Vanguard');
        assert.ok(captured.spec, captured.message);
        assert.equal(captured.spec.target.missionAction, action);
        assert.deepEqual(JSON.parse(JSON.stringify(captured.spec.target.coordinate)), { q: 2, r: 1 });
        assert.equal(Boolean(captured.handle), !zeroStock);
        assert.equal(h.nativeAction.disabled, zeroStock, 'capturing intent never enables a native control');
      } finally { h.destroy(); }
    });
  }
}

test('capture binding cannot be reused with changed quantities, mode or action', () => {
  const h = adapterHarness({ resolver: false });
  try {
    const original = h.adapter.captureInspect(h.inspector, fleet(), 'Use 9 Marauder, 1 Vanguard');
    assert.ok(original.spec, original.message);
    assert.equal(h.adapter.attach('original', original), true);
    for (const mutate of [
      spec => { spec.quantities.marauder++; },
      spec => { spec.target.mode = 'custom'; },
      spec => { spec.target.missionAction = 'send'; },
    ]) {
      const changed = JSON.parse(JSON.stringify(original.spec)); mutate(changed);
      assert.equal(h.adapter.attach('altered', { spec: changed, handle: original.handle }), false);
    }
  } finally { h.destroy(); }
});

function claimHarness(initial) {
  let jobs = structuredClone(initial), reads = 0, readFailure = false;
  const sandbox = vm.createContext({ fleetWait: { list() {
    reads++;
    if (readFailure) throw new Error('Saved queue unavailable');
    return structuredClone(jobs);
  } } });
  vm.runInContext(moduleSource('MISSION CLAIM GUARD') + '\nthis.check = isCurrentMissionClaim;', sandbox);
  return { check: job => sandbox.check(job), get reads() { return reads; },
    set jobs(value) { jobs = structuredClone(value); }, set readFailure(value) { readFailure = value; } };
}

test('native guard accepts only the current saved sending claim and rereads on every call', () => {
  const job = customJob(); const h = claimHarness([job]);
  assert.equal(h.check(job), true);
  assert.equal(h.check(job), true);
  assert.equal(h.reads, 2);
  const next = structuredClone(job); next.quantities.marauder++;
  h.jobs = [next];
  assert.equal(h.check(job), false, 'another tab superseded the fleet while native resolution was pending');
  assert.equal(h.check(next), true, 'the comparison uses fresh persisted quantities');
});

for (const [name, mutate] of [
  ['scope', job => { job.scope = 'different/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; }],
  ['origin ID', job => { job.originId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; }],
  ['origin name', job => { job.originName = 'Another origin'; }],
  ['destination', job => { job.target.coordinate.r++; }],
  ['mode', job => { delete job.target.mode; }],
  ['native action', job => { job.target.missionAction = 'send'; }],
  ['preset provenance', job => { job.target.presetKey = 'Use 1 Probe'; }],
  ['route', job => { job.target.routeKey = '<div>changed</div>'; }],
  ['ship composition', job => { job.quantities.vanguard = 0; job.quantities.sentinel = 1; }],
  ['production authorization', job => { job.produce = false; }],
  ['send authorization', job => { job.autoSend = false; }],
  ['creation identity', job => { job.createdAt--; }],
  ['claim identity', job => { job.claimedAt++; }],
  ['status', job => { job.status = 'paused'; }],
  ['review flag', job => { job.needsReview = true; }],
  ['editing hold', job => { job.fleetEdit = { drafts: { marauder: '12' } }; }],
  ['prior accepted send', job => { job.sentAt = 2000; }],
]) {
  test('native guard rejects a live change to ' + name, () => {
    const claimed = customJob(), changed = structuredClone(claimed); mutate(changed);
    const h = claimHarness([changed]);
    assert.equal(h.check(claimed), false);
  });
}

for (const [name, mutate] of [
  ['waiting', job => { job.status = 'waiting'; }],
  ['uncertain', job => { job.status = 'uncertain'; job.needsReview = true; }],
  ['sent', job => { job.status = 'sent'; job.sentAt = 2000; }],
  ['paused', job => { job.status = 'paused'; }],
  ['edited', job => { job.fleetEdit = {}; }],
  ['missing claim', job => { job.claimedAt = null; }],
  ['unsafe claim', job => { job.claimedAt = Number.MAX_SAFE_INTEGER + 1; }],
  ['fractional claim', job => { job.claimedAt = 2000.5; }],
  ['auto-send disabled', job => { job.autoSend = false; }],
]) {
  test('native guard refuses an ineligible ' + name + ' claim even if storage agrees', () => {
    const job = customJob(); mutate(job); const h = claimHarness([job]);
    assert.equal(h.check(job), false);
  });
}

test('native guard fails closed when a mission is removed or saved state cannot be read', () => {
  const job = customJob(), h = claimHarness([]);
  assert.equal(h.check(job), false);
  h.jobs = [job]; h.readFailure = true;
  assert.equal(h.check(job), false);
});

test('native guard ignores cosmetic status text updates without replacing the claim', () => {
  const job = customJob(), live = structuredClone(job);
  live.message = 'Preparing native controls'; live.updatedAt++;
  assert.equal(claimHarness([live]).check(job), true);
});
