'use strict';
// Actual production button/callback/core/queue/adapter, with existing offline VM fixtures.
// No native game or Google requests. No assertion equates queue preparation with a real send.
const fs = require('node:fs'), assert = require('node:assert/strict'), path = require('node:path');
const { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.join(__dirname, '..');
function fixture(name, end, names) {
  const file = path.join(__dirname, name), text = fs.readFileSync(file, 'utf8').split(end)[0];
  return new Function('require', '__dirname', text + '\nreturn {' + names + '};')(createRequire(file), __dirname);
}
const p = fixture('reinforcement-panel.test.cjs', "test('", 'harness,byButton,visibleGestureNotice');
const n = fixture('reinforcement-approval-review.test.cjs', 'const unavailable =', 'harness,core,clone,SCOPE,SELF,ORIGIN,DESTINATION');
const d = fixture('reinforcement-diagnostics.test.cjs', "test('", 'harness');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const expression = source.match(/onSendNow: (changed\(id => \{[\s\S]*?\n      \}\)),\n/)[1];
test('manual send button reports preparation or cause visibly and reaches simulated dispatch only when eligible', async () => {
  for (const scenario of ['valid', 'hud', 'paused', 'empty', 'stale', 'untrusted']) {
    const h = n.harness({ parked: 107 }), outer = d.harness(); let routeStore, queueStore = {}, queue;
    const world = { scope: n.SCOPE, galaxy: 'alpha', selfId: n.SELF, connected: true, complete: true, observedAt: h.at,
      systems: [{ id: n.ORIGIN, q: 0, r: 0, name: 'Origin', fleet: [{ type: 'marauder', quantity: scenario === 'empty' ? 0 : 107 }] },
        { id: n.DESTINATION, q: 2, r: 3, name: 'Destination', fleet: [] }], transits: [] };
    queue = h.realm.queueFactory({ load: () => n.clone(queueStore), save: value => { queueStore = n.clone(value); }, now: () => h.at,
      getContext: h.context, getRouteState: job => engine.jobState(job),
      getFleet: () => new Map(n.core.SHIPS.map(type => [type, { parked: type === 'marauder' ? 107 : 0, away: 0, building: 0 }])),
      dispatch: job => h.adapter.dispatch(job) });
    const engine = n.core.create({ read: () => routeStore, write: (_, value) => { routeStore = n.clone(value); }, now: () => h.at,
      getContext: h.context, getWorld: () => world, getJobs: () => queue.list(), queue: (settings, options) => queue.queue(settings, options), cancel: id => queue.cancel(id) });
    h.canAct = job => engine.canRunJob(job);
    engine.save({ id: 'north', originId: n.ORIGIN, destinationId: n.DESTINATION, intervalMinutes: 15,
      ships: { marauder: { mode: 'excess', reserve: 0 } }, paused: scenario === 'paused' });
    if (scenario === 'hud') outer.hud.available = false;
    if (scenario === 'stale') world.observedAt -= 120001;
    const onSendNow = new Function('changed', 'reinforcementDispatchBlock', 'reinforcementRoutes', 'return ' + expression)(fn => fn, outer.check, engine);
    const ui = p.harness({ getScope: () => n.SCOPE, getWorld: () => world, getRoutes: () => engine.list(), onSendNow });
    ui.container.scrollTop = 1000; // Header feedback alone can be outside a long scrolled list.
    p.byButton(ui.container, 'Enviar ahora').dispatch('click', { isTrusted: scenario !== 'untrusted' });
    if (scenario === 'valid') {
      assert.equal(queue.list().length, 1); assert.ok(engine.list()[0].ticket);
      const notice = p.visibleGestureNotice(ui); assert.match(notice.textContent, /preparada.*cola/i);
      assert.match(notice.textContent, /no confirma|aún no|todavía no/i); assert.equal(h.sends, 0);
    } else {
      assert.equal(queue.list().length, 0);
      if (!['paused', 'untrusted'].includes(scenario)) {
        const notice = p.visibleGestureNotice(ui); assert.ok(ui.error.length > 10, scenario); assert.equal(notice.textContent, ui.error);
      }
    }
    await queue.tick();
    if (scenario === 'valid') { engine.tick(); assert.equal(h.sends, 1); assert.equal(engine.list()[0].ticket, null); }
    else assert.equal(h.sends, 0, scenario);
    ui.app.destroy(); h.destroy(); queue.destroy();
  }
});
