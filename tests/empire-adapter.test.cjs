'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const adapter = require('../docs/empire-adapter.js');
const core = require('../docs/empire-core.js');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const J = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const S = 'alpha/' + P;
const SHIPS = core.DEFAULT_SHIPS;
const counts = n => Object.fromEntries(SHIPS.map(x => [x, n]));
const time = 1000000;
const iso = ms => new Date(ms).toISOString();
const copy = x => structuredClone(x);
function system(id, q = 0) {
  return { id, q, r: 0, name: id === A ? 'Duplicate name' : 'Duplicate name',
    buildings: [{ type: 'shipyard', level: 1 }],
    fleet: [{ type: 'probe', quantity: 10 }],
    economy: { resources: { palladium: 100, iridium: 200, settledAt: iso(time) }, paCap: 1000, irCap: 2000,
      paRatePerMin: 10, irRatePerMin: 5, energyCap: 30, energyUsed: 10, queue: [] },
    shipyard: { queue: [] } };
}
function transit(extra = {}) {
  return { id: T, fromQ: 0, fromR: 0, toQ: 8, toR: 9, ships: [{ type: 'probe', quantity: 5 }],
    phase: 'outbound', recalledAt: null, arrivesAt: iso(time + 60000), ...extra };
}
function world(ids = [A, B]) {
  return { version: 1, galaxy: 'alpha', selfId: P, scope: S, generation: 1, epoch: 1, revision: 0,
    observedAt: time, connected: true, complete: true, systems: ids.map((id, index) => system(id, index)), transits: [], transitShips: counts(0) };
}
function harness(options = {}) {
  let clock = time, source = world(options.ids), currentId = source.systems[0].id, changes = 0, clicks = 0;
  let allowed = true, hidden = false, modal = null, focus = null, hudOverride = null, customClick = null;
  let ctx = { scope: S, selectionCount: 1, settled: true }, cycle = source.systems.map(x => x.id);
  const listeners = new Map(), scheduled = new Map(); let timerId = 0;
  const next = { disabled: false, hidden: false, isConnected: true, getClientRects: () => [{}], getAttribute: () => null,
    classList: { contains: () => false }, closest: () => null,
    click() { clicks++; if (customClick) customClick(); else currentId = cycle[(cycle.indexOf(currentId) + 1) % cycle.length]; } };
  let buttons = [next];
  const doc = { get hidden() { return hidden; }, get activeElement() { return focus; },
    defaultView: { getComputedStyle() { assert.equal(this, doc.defaultView); return { visibility: 'visible', display: 'block' }; } },
    querySelector: () => modal, querySelectorAll: selector => selector === '[data-field="nameplate-next"]' ? buttons : [],
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  function rawHud() {
    const raw = source.systems.find(x => x.id === currentId); if (!raw) return null;
    const away = adapter.nativeAwayBySystem(source.systems, source.transits)?.[currentId] || counts(null);
    const parked = counts(0), building = counts(0);
    if (!raw.fleet) return null;
    for (const item of raw.fleet) parked[item.type] = item.quantity;
    for (const item of raw.shipyard?.queue || []) if (item.kind !== 'scrap') building[item.type] += item.quantityRemaining;
    const resources = adapter.projectResources(raw.economy, clock);
    for (const value of Object.values(resources)) { value.amount = Math.floor(value.amount); value.cap = Math.floor(value.cap); value.rate = Number(value.rate.toFixed(1)); }
    return { resources, fleet: Object.fromEntries(SHIPS.map(x => [x, { parked: parked[x], away: away[x], building: building[x] }])),
      queue: { buildings: raw.economy?.queue?.length ?? null, ships: raw.shipyard?.queue?.length ?? 0 }, energy: raw.economy?.energyCap - raw.economy?.energyUsed };
  }
  const app = adapter.create({ getWorld: () => source, getContext: () => ({ ...ctx, systemId: currentId }),
    getHudSnapshot: () => hudOverride ? hudOverride(rawHud()) : rawHud(), document: doc, getComputedStyle: options.getComputedStyle,
    canNavigate: () => allowed, onChange: () => changes++, now: () => clock, pollMs: 20, settleMs: 40, hopTimeoutMs: 200,
    setTimeout(fn, ms) { const key = ++timerId; scheduled.set(key, { fn, at: clock + ms }); return key; },
    clearTimeout(key) { scheduled.delete(key); } });
  async function advance(ms = 20) {
    clock += ms;
    for (const [key, job] of [...scheduled]) if (job.at <= clock) { scheduled.delete(key); job.fn(); }
    await Promise.resolve(); await Promise.resolve();
  }
  async function finish(promise) {
    let done = false, result; promise.then(value => { done = true; result = value; });
    for (let i = 0; i < 100 && !done; i++) await advance(20);
    assert.equal(done, true, 'navigation must terminate within its bounded native cycle'); return result;
  }
  return { app, doc, next, advance, finish, rawHud, listeners,
    get source() { return source; }, set source(v) { source = v; },
    get id() { return currentId; }, set id(v) { currentId = v; },
    get context() { return ctx; }, set context(v) { ctx = v; },
    get clock() { return clock; }, set clock(v) { clock = v; },
    get clicks() { return clicks; }, get changes() { return changes; }, get pendingTimers() { return scheduled.size; },
    set allowed(v) { allowed = v; }, set hidden(v) { hidden = v; }, set modal(v) { modal = v; },
    set focus(v) { focus = v; }, set hud(v) { hudOverride = v; }, set cycle(v) { cycle = v; },
    set click(v) { customClick = v; }, set buttons(v) { buttons = v; } };
}
function setTransits(h, transits) {
  h.source.transits = transits; h.source.transitShips = counts(0);
  const unique = new Map(transits.map(x => [x.id, x]));
  for (const t of unique.values()) for (const s of t.ships) h.source.transitShips[s.type] += s.quantity;
}
function job(kind = 'recruit', amount = 3) { return { id: J, type: 'probe', kind, quantityRemaining: amount, quantityTotal: amount }; }

test('UMD exports a frozen API without touching any network or DOM', () => {
  const sandbox = {}; vm.runInNewContext(fs.readFileSync(require.resolve('../docs/empire-adapter.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.OldLightEmpireAdapter.create, 'function');
  assert.equal(Object.isFrozen(sandbox.OldLightEmpireAdapter), true);
});
test('one complete source epoch provides roster, all systems and global transits with one timestamp', () => {
  const h = harness(); setTransits(h, [transit({ toQ: 1, toR: 0 })]);
  h.source.systems[1].shipyard.queue.push(job());
  const roster = h.app.readRoster(), snapshots = h.app.readSnapshots(), census = h.app.readTransitCensus();
  assert.deepEqual(roster.systems.map(x => x.id), [A, B]); assert.equal(roster.complete, true);
  assert.deepEqual(new Set(snapshots.map(x => x.censusId)), new Set(['native:1:1:0']));
  assert.deepEqual(new Set(snapshots.map(x => x.observedAt)), new Set([time]));
  assert.equal(census.censusId, snapshots[0].censusId); assert.equal(census.observedAt, time);
  assert.equal(census.ships.probe, 5); assert.equal(snapshots[0].fleet.probe.away, 0);
  const plan = core.plan({ enabled: true, fleetTargets: { probe: 40 } }, snapshots, { scope: S, now: time, expectedIds: [A, B], transitCensus: census });
  assert.equal(plan.complete, true); assert.equal(plan.summary.totals.fleet.probe.total, 28);
  assert.equal(h.clicks, 0);
});
test('census stays at source observedAt; native resource projection reproduces caps and per-minute rates', () => {
  const h = harness(); h.source.observedAt -= 60000;
  h.source.systems[0].economy.resources.settledAt = iso(h.source.observedAt - 60000);
  const a = h.app.readSnapshots()[0];
  assert.equal(a.resources.palladium.amount, 110);
  assert.equal(a.resources.iridium.amount, 205);
  assert.equal(h.app.readActive().context.settled, true);
  const economy = copy(h.source.systems[0].economy); economy.paCap = 105;
  assert.equal(adapter.projectResources(economy, time).palladium.amount, 105);
  economy.resources.settledAt = iso(time + 60000);
  assert.equal(adapter.projectResources(economy, time).palladium.amount, 100);
});
test('native HUD away includes external outbound and reverses returning/recalled endpoints', () => {
  const systems = [system(A), system(B, 1)];
  assert.equal(adapter.nativeAwayBySystem(systems, [transit()])[A].probe, 5);
  assert.equal(adapter.nativeAwayBySystem(systems, [transit({ fromQ: 8, fromR: 9, toQ: 0, toR: 0, phase: 'returning' })])[A].probe, 5);
  assert.equal(adapter.nativeAwayBySystem(systems, [transit({ fromQ: 8, fromR: 9, toQ: 0, toR: 0, recalledAt: iso(time) })])[A].probe, 5);
  assert.equal(adapter.nativeAwayBySystem(systems, [transit({ toQ: 1, toR: 0 })])[A].probe, 0);
  assert.equal(adapter.nativeAwayBySystem(systems, [transit({ fromQ: 1, fromR: 0, toQ: 0, toR: 0, phase: 'returning' })])[A].probe, 0);
  assert.deepEqual(adapter.nativeAwayBySystem(systems, [transit({ fromQ: 4 })])[A], counts(0));
});
test('global census counts own transits once and never reads hostile incomingTransits', () => {
  const h = harness(); setTransits(h, [transit(), copy(transit())]);
  Object.defineProperty(h.source, 'incomingTransits', { get() { throw new Error('must never read inbound'); } });
  assert.equal(h.app.readTransitCensus().ships.probe, 5);
  assert.equal(h.app.readSnapshots()[0].fleet.probe.away, 5);
});
test('contradictory duplicate transit IDs, including routes, fail closed', () => {
  for (const extra of [{ ships: [{ type: 'probe', quantity: 6 }] }, { toQ: 77 }, { arrivesAt: iso(time + 999999) }]) {
    const h = harness(); delete h.source.transitShips; h.source.transits = [transit(), transit(extra)];
    assert.equal(h.app.readTransitCensus(), null);
    assert.equal(h.app.readSnapshots()[0].fleet.probe.away, null);
    assert.equal(h.app.readActive().context.settled, false);
  }
});
test('scrap does not count as new building ships and remains queue occupancy', () => {
  const h = harness(); h.source.systems[0].shipyard.queue = [job('scrap', 7)];
  const a = h.app.readSnapshots()[0];
  assert.deepEqual(a.fleet.probe, { parked: 10, away: 0, building: 0 }); assert.equal(a.queue.ships, 1);
  assert.equal(h.app.readActive().context.settled, true);
});
test('only an explicitly locked shipyard converts a null yard to a zero queue', () => {
  const h = harness(); h.source.systems[0].shipyard = null;
  assert.equal(h.app.readSnapshots()[0].queue.ships, null);
  h.source.revision++; h.source.systems[0].buildings[0].level = 0;
  assert.equal(h.app.readSnapshots()[0].queue.ships, 0);
  assert.equal(h.app.readSnapshots()[0].fleet.probe.building, 0);
});
test('unknown measurements remain null rather than inventing zeros', () => {
  const h = harness(); const s = h.source.systems[0]; s.fleet = null; s.economy.resources.settledAt = 'unknown'; delete s.economy.energyCap;
  const value = h.app.readSnapshots()[0];
  assert.equal(value.fleet.probe.parked, null); assert.equal(value.resources.palladium.amount, null); assert.equal(value.energy, null);
  assert.equal(h.app.readActive().context.settled, false);
});
test('malformed duplicate fleet or ship queues and unsafe sums remain unknown', () => {
  const h = harness(); h.source.systems[0].fleet.push({ type: 'probe', quantity: 8 });
  h.source.systems[0].shipyard.queue = [job(), job()];
  const a = h.app.readSnapshots()[0]; assert.equal(a.fleet.probe.parked, null); assert.equal(a.fleet.probe.building, null); assert.equal(a.queue.ships, null);
  h.source.revision++; setTransits(h, [transit({ ships: [{ type: 'probe', quantity: Number.MAX_SAFE_INTEGER }] }), transit({ id: J, ships: [{ type: 'probe', quantity: 1 }] })]);
  delete h.source.transitShips; assert.equal(h.app.readTransitCensus(), null);
});
test('mutating returned values cannot mutate subsequent source reads', () => {
  const h = harness(); const roster = h.app.readRoster(); roster.systems[0].id = C;
  const snapshots = h.app.readSnapshots(); snapshots[0].fleet.probe.parked = 999;
  const census = h.app.readTransitCensus(); census.ships.probe = 999;
  assert.equal(h.app.readRoster().systems[0].id, A); assert.equal(h.app.readSnapshots()[0].fleet.probe.parked, 10); assert.equal(h.app.readTransitCensus().ships.probe, 0);
});
test('contradictory data within an unchanged observer revision is poisoned until a new revision', () => {
  const h = harness(); assert.ok(h.app.readRoster()); h.source.systems[0].fleet[0].quantity++;
  assert.equal(h.app.readSnapshots(), null); h.source.systems[0].fleet[0].quantity--;
  assert.equal(h.app.readRoster(), null); h.source.revision++;
  assert.ok(h.app.readRoster());
});
test('stale, foreign, disconnected, duplicate or incomplete sources cannot become action ready', () => {
  for (const mutate of [w => { w.connected = false; }, w => { w.scope = 'beta/' + P; }, w => { w.selfId = C; },
    w => { w.observedAt = time + 1; }, w => { w.generation = 0; }, w => { w.epoch = 0; },
    w => { w.systems.push(copy(w.systems[0])); }, w => { w.systems[1].q = 0; }, w => { w.systems[0].playerId = C; }]) {
    const h = harness(); mutate(h.source); assert.equal(h.app.readRoster(), null); assert.equal(h.app.readActive().context.settled, false);
  }
  const h = harness(); h.source.complete = false; assert.equal(h.app.readRoster().complete, false); assert.equal(h.app.isAvailable(), false);
  assert.equal(h.app.readTransitCensus(), null); assert.equal(h.app.readActive().context.settled, false);
  h.source.complete = true; h.clock += 120001; assert.equal(h.app.readRoster(), null);
});
test('HUD mismatches in any fleet, queue, energy, or resource field fail closed', () => {
  const mutations = [x => { x.fleet.probe.parked++; }, x => { x.fleet.probe.away++; }, x => { x.fleet.probe.building++; },
    x => { x.queue.buildings++; }, x => { x.queue.ships++; }, x => { x.energy++; },
    x => { x.resources.palladium.amount += 2; }, x => { x.resources.iridium.cap++; }, x => { x.resources.iridium.rate++; },
    x => { x.systemId = B; }, x => { x.scope = 'foreign/' + P; }];
  for (const mutate of mutations) { const h = harness(); h.hud = x => { mutate(x); return x; }; assert.equal(h.app.readActive().context.settled, false); }
});
test('HUD accepts only native floor and one-decimal rendering with bounded resource lag', () => {
  const h = harness(); h.source.systems[0].economy.paRatePerMin = 61.249;
  h.source.systems[0].economy.resources.settledAt = iso(time - 60000);
  h.hud = x => { x.resources.palladium.amount--; return x; };
  assert.equal(h.app.readActive().context.settled, true);
  h.hud = x => { x.resources.palladium.amount -= 4; return x; };
  assert.equal(h.app.readActive().context.settled, false);
});
test('active readiness is independent of navigation interlocks, dialogs and document focus', () => {
  const h = harness(); h.allowed = false; h.modal = {}; h.focus = { isContentEditable: true };
  assert.equal(h.app.readActive().context.settled, true); assert.equal(h.app.isAvailable(), true); assert.equal(h.app.canNavigate(), false);
});
test('native cycle traverses frozen order with one confirmed click per hop and duplicate names', async () => {
  const h = harness({ ids: [A, B, C] }); h.cycle = [A, C, B];
  const p = h.app.selectSystem(B, { scope: S });
  assert.equal(h.clicks, 1); assert.equal(h.id, C);
  await h.advance(20); assert.equal(h.clicks, 1);
  assert.equal(await h.finish(p), true); assert.equal(h.id, B); assert.equal(h.clicks, 2); assert.equal(h.changes, 1);
});
test('already-current exact owned target is confirmed without a click', async () => {
  const h = harness(); assert.equal(await h.app.selectSystem(A, { scope: S }), true); assert.equal(h.clicks, 0);
});
test('ambiguous, foreign and multi-selection never click or clear selection', async () => {
  for (const change of [h => { h.context.selectionCount = 2; }, h => { h.context.scope = 'beta/' + P; }, h => { h.context.settled = false; },
    h => { h.id = C; }, h => { h.context.owned = false; }, h => { h.hud = () => null; }]) {
    const h = harness(); change(h); assert.equal(await h.app.selectSystem(B, { scope: S }), false); assert.equal(h.clicks, 0);
  }
});
test('navigation respects pending/loading/manual/modal and explicit canNavigate gates', async () => {
  const block = [h => { h.allowed = false; }, h => { h.hidden = true; }, h => { h.modal = {}; },
    h => { h.focus = { isContentEditable: true }; }, ...['pending', 'loading', 'manual', 'modal'].map(key => h => { h.context[key] = true; })];
  for (const change of block) { const h = harness(); change(h); assert.equal(await h.app.selectSystem(B, { scope: S }), false); assert.equal(h.clicks, 0); }
});
test('native next button must be uniquely present, enabled and visible', async () => {
  for (const change of [h => { h.buttons = []; }, h => { h.buttons = [h.next, h.next]; }, h => { h.next.disabled = true; },
    h => { h.next.hidden = true; }, h => { h.next.isConnected = false; }, h => { h.next.getClientRects = () => []; },
    h => { h.next.getAttribute = key => key === 'aria-disabled' ? 'true' : null; }]) {
    const h = harness(); change(h); assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 0);
  }
});
test('failed native click is bounded and never retried', async () => {
  const h = harness(); h.click = () => {};
  assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 1);
});
test('settled URL alone never confirms stale or mismatched HUD', async () => {
  const h = harness(); h.source.systems[1].fleet[0].quantity = 50;
  const stale = h.rawHud(); h.click = () => { h.id = B; h.hud = () => stale; };
  assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 1);
});
test('scope/epoch/reset/disconnect/ownership changes during a hop abort immediately', async () => {
  for (const change of [h => { h.source.epoch++; }, h => { h.source.generation++; }, h => { h.source.connected = false; },
    h => { h.source.revision++; h.source.systems.pop(); }, h => { h.context.scope = 'beta/' + P; }, h => { h.allowed = false; }]) {
    const h = harness(); h.click = () => { h.id = B; change(h); };
    assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 1);
  }
});
test('normal source revision during a hop is allowed when roster/epoch and latest HUD agree', async () => {
  const h = harness(); h.click = () => { h.id = B; h.source.revision++; h.source.systems[1].fleet[0].quantity++; };
  assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), true);
});
test('trusted manual interaction cancels a hop and blocks later selection temporarily', async () => {
  const h = harness(); const p = h.app.selectSystem(B, { scope: S });
  h.listeners.get('pointerdown')({ isTrusted: true });
  assert.equal(await h.finish(p), false); assert.equal(h.clicks, 1);
  assert.equal(await h.app.selectSystem(A, { scope: S }), false);
  h.clock += 15000; assert.equal(h.app.canNavigate(), true);
});
test('synthetic native click events do not create a manual pause', async () => {
  const h = harness(); h.click = () => { h.listeners.get('pointerdown')({ isTrusted: false }); h.id = B; };
  assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), true);
});
test('concurrent selection and unexpected mid-hop identity transitions abort without a second click', async () => {
  const h = harness({ ids: [A, B, C] }); const p = h.app.selectSystem(C, { scope: S });
  assert.equal(await h.app.selectSystem(A, { scope: S }), false);
  await h.advance(20); h.id = C;
  assert.equal(await h.finish(p), false); assert.equal(h.clicks, 1);
});
test('a native cycle repeating a visited system aborts rather than spinning', async () => {
  const h = harness({ ids: [A, B, C] }); h.cycle = [A, B];
  assert.equal(await h.finish(h.app.selectSystem(C, { scope: S })), false); assert.equal(h.clicks, 2);
});
test('dispose cancels pending waits, unregisters manual listeners and cannot navigate', async () => {
  const h = harness(); const p = h.app.selectSystem(B, { scope: S }); h.app.dispose();
  assert.equal(await h.finish(p), false); assert.equal(h.pendingTimers, 0); assert.equal(h.listeners.size, 0);
  assert.equal(h.app.readRoster(), null); assert.equal(await h.app.selectSystem(A, { scope: S }), false);
});
test('an older observer revision cannot restore stale fleet or ownership after a newer census', () => {
  const h = harness(); const old = copy(h.source);
  h.source.revision = 2; h.source.systems[1].fleet[0].quantity = 15; assert.equal(h.app.readSnapshots()[1].fleet.probe.parked, 15);
  h.source = old; assert.equal(h.app.readSnapshots(), null); assert.equal(h.app.readRoster(), null);
  h.source.revision = 3; assert.equal(h.app.readSnapshots()[1].fleet.probe.parked, 10);
});
test('friendly transfer arrival changes transit to destination parked atomically', () => {
  const h = harness(); h.source.systems[0].fleet[0].quantity = 5;
  setTransits(h, [transit({ toQ: 1, toR: 0 })]);
  const before = core.aggregate(h.app.readSnapshots(), { scope: S, now: time, expectedIds: [A, B], transitCensus: h.app.readTransitCensus() });
  assert.equal(before.totals.fleet.probe.total, 20); assert.equal(before.totals.fleet.probe.transit, 5);
  h.source.revision++; h.source.observedAt++; h.clock++; h.source.systems[1].fleet[0].quantity = 15; setTransits(h, []);
  const after = core.aggregate(h.app.readSnapshots(), { scope: S, now: h.clock, expectedIds: [A, B], transitCensus: h.app.readTransitCensus() });
  assert.equal(after.totals.fleet.probe.total, 20); assert.equal(after.totals.fleet.probe.transit, 0);
  assert.notEqual(before.censusId, after.censusId); assert.equal(after.fleetComplete, true);
});
test('ships in flight remain in the global census after their origin loses ownership', () => {
  const h = harness(); setTransits(h, [transit()]); h.app.readSnapshots();
  h.source.revision++; h.source.systems.shift(); h.id = B;
  assert.deepEqual(h.app.readRoster().systems.map(x => x.id), [B]);
  assert.equal(h.app.readTransitCensus().ships.probe, 5); assert.equal(h.app.readSnapshots()[0].fleet.probe.away, 0);
});
test('single-system multi-selection never relies on a no-op cycle to clear selection', async () => {
  const h = harness({ ids: [A] }); h.context.selectionCount = 2;
  assert.equal(await h.app.selectSystem(A, { scope: S }), false); assert.equal(h.clicks, 0);
});
test('DTO reading never invokes a getter for required fields or unrelated private fields', () => {
  const h = harness(); let reads = 0;
  Object.defineProperty(h.source.systems[0].economy, 'energyCap', { get() { reads++; return 30; } });
  Object.defineProperty(h.source, 'actionToken', { get() { throw new Error('forbidden'); } });
  assert.equal(h.app.readSnapshots()[0].energy, null); assert.equal(reads, 0);
});

test('buttons with layout rectangles remain blocked by hidden/collapsed computed visibility', async () => {
  for (const visibility of ['hidden', 'collapse']) {
    const h = harness(); h.doc.defaultView.getComputedStyle = () => ({ visibility, display: 'block' });
    assert.equal(h.next.getClientRects().length, 1);
    assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 0);
  }
});
test('aria-hidden on the control or an ancestor blocks native navigation', async () => {
  for (const hide of [h => { h.next.getAttribute = name => name === 'aria-hidden' ? 'true' : null; },
    h => { h.next.closest = selector => selector.includes('[aria-hidden="true"]') ? {} : null; }]) {
    const h = harness(); hide(h);
    assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 0);
  }
});
test('hidden computed ancestor cannot be bypassed by a visible button with rectangles', async () => {
  const h = harness(); const parent = {}; h.next.parentElement = parent;
  h.doc.defaultView.getComputedStyle = node => ({ visibility: node === parent ? 'hidden' : 'visible', display: 'block' });
  assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 0);
});
test('computed-style reader is injectable and unavailable/throwing styles fail closed', async () => {
  const visible = harness({ getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) });
  delete visible.doc.defaultView;
  assert.equal(await visible.finish(visible.app.selectSystem(B, { scope: S })), true);
  for (const getComputedStyle of [null, () => null, () => { throw new Error('unavailable'); },
    () => ({ visibility: 'visible', display: 'none' }), () => ({})]) {
    const h = harness({ getComputedStyle });
    assert.equal(await h.finish(h.app.selectSystem(B, { scope: S })), false); assert.equal(h.clicks, 0);
  }
  const missing = harness(); delete missing.doc.defaultView;
  assert.equal(await missing.finish(missing.app.selectSystem(B, { scope: S })), false); assert.equal(missing.clicks, 0);
});
