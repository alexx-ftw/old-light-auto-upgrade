'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceFile = process.env.QA_ORIGIN_SOURCE
  ? path.resolve(process.env.QA_ORIGIN_SOURCE)
  : path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const begin = source.indexOf('async function verifyAttackRetryOrigin(');
const end = source.indexOf('\n  function missionContext()', begin);
assert.ok(begin >= 0 && end > begin, 'Origin verifier is present in published script');
const factory = source.slice(begin, end);
const ORIGIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const campaign = { originCoordinate: { q: -95, r: 260 }, originName: 'Duplicated system name' };

function harness() {
  let clock = 100_000;
  let current = { scope: `qa/${ACCOUNT_A}`, originId: ORIGIN_A,
    originName: 'Duplicated system name', selectionCount: 1, canAct: true };
  let busy = false;
  let modal = false;
  let activeInspector = true;
  let validInspector = true;
  let resolverError = false;
  let deferred = false;
  let release = null;
  let cleanups = 0;
  const requests = [];
  const cache = new Map();
  const globals = {
    Date: { now: () => clock },
    retryOriginChecks: cache,
    missionAdapter: { isBusy: () => busy },
    document: { querySelector: selector => {
      assert.equal(selector, 'dialog[open]');
      return modal ? {} : null;
    } },
    missionContext: () => clone(current),
    missionTargetResolver: { resolveTarget: async spec => {
      requests.push(clone(spec));
      if (resolverError) throw new Error('Fixture resolver unavailable');
      if (deferred) await new Promise(resolve => { release = resolve; });
      return { inspector: {
        matches: selector => {
          assert.equal(selector, 'dialog.info-modal[data-content-type="inspect"]');
          return validInspector;
        },
        querySelector: selector => {
          assert.equal(selector, '.info-modal-trailing .info-modal-header-btn');
          return activeInspector ? null : { textContent: 'Set active' };
        },
      }, cleanup: async () => { cleanups++; } };
    } },
  };
  const verify = vm.runInNewContext(factory + '\nverifyAttackRetryOrigin;', globals,
    { filename: path.basename(sourceFile) });
  return {
    requests, cache,
    verify: (value = campaign, context = clone(current)) => verify(clone(value), clone(context)),
    get context() { return clone(current); },
    get cleanups() { return cleanups; },
    setContext: extra => { current = { ...current, ...extra }; },
    setBusy: value => { busy = value; },
    setModal: value => { modal = value; },
    setActiveInspector: value => { activeInspector = value; },
    setValidInspector: value => { validInspector = value; },
    setResolverError: value => { resolverError = value; },
    defer: () => { deferred = true; },
    release: () => { release?.(); },
    advance: ms => { clock += ms; },
  };
}

test('Origin verification binds the selected UUID only after native active-system inspection', async () => {
  const h = harness();
  const result = await h.verify();
  assert.deepEqual(clone(result), { originId: ORIGIN_A, coordinate: { q: -95, r: 260 }, name: 'Duplicated system name' });
  assert.deepEqual(h.requests, [{ scope: `qa/${ACCOUNT_A}`, originId: ORIGIN_A,
    target: { coordinate: { q: -95, r: 260 }, label: 'Duplicated system name' } }]);
  assert.equal(h.cleanups, 1);
});

test('Another owned system with the same name is not accepted as the report origin', async () => {
  const h = harness();
  h.setActiveInspector(false);
  assert.equal(await h.verify(), null);
  assert.equal(h.cleanups, 1);
  assert.equal(h.requests.length, 1);
});

test('Account or selected-origin changes during resolution invalidate the result and still clean up', async () => {
  for (const change of [{ scope: `qa/${ACCOUNT_B}` }, { originId: ORIGIN_B }, { selectionCount: 2 }]) {
    const h = harness();
    h.defer();
    const work = h.verify();
    h.setContext(change);
    h.release();
    assert.equal(await work, null);
    assert.equal(h.cleanups, 1);
  }
});

test('Paused context, multiple origins, an open dialog, or busy dispatch prevent map resolution', async () => {
  for (const block of [h => h.setContext({ canAct: false }), h => h.setContext({ selectionCount: 2 }),
    h => h.setModal(true), h => h.setBusy(true)]) {
    const h = harness();
    block(h);
    assert.equal(await h.verify(), null);
    assert.equal(h.requests.length, 0);
    assert.equal(h.cleanups, 0);
  }
});

test('Invalid report coordinates never open the map', async () => {
  for (const coordinate of [null, { q: 1.5, r: 2 }, { q: 1, r: null }, { q: '1', r: 2 }]) {
    const h = harness();
    assert.equal(await h.verify({ originCoordinate: coordinate }), null);
    assert.equal(h.requests.length, 0);
  }
});

test('Resolver failure and malformed inspector leave the origin unverified', async () => {
  const failed = harness();
  failed.setResolverError(true);
  assert.equal(await failed.verify(), null);
  assert.equal(failed.cleanups, 0);
  const malformed = harness();
  malformed.setValidInspector(false);
  assert.equal(await malformed.verify(), null);
  assert.equal(malformed.cleanups, 1);
});

test('Cached origin verification is scoped by account, selected UUID, and report coordinates', async () => {
  const h = harness();
  await h.verify();
  await h.verify();
  assert.equal(h.requests.length, 1);
  h.setContext({ scope: `qa/${ACCOUNT_B}` });
  await h.verify();
  assert.equal(h.requests.length, 2);
  h.setContext({ originId: ORIGIN_B });
  await h.verify();
  assert.equal(h.requests.length, 3);
  await h.verify({ originCoordinate: { q: -94, r: 260 }, originName: 'Duplicated system name' });
  assert.equal(h.requests.length, 4);
  h.advance(60_001);
  await h.verify();
  assert.equal(h.requests.length, 5);
  assert.equal(h.cleanups, 5);
});
