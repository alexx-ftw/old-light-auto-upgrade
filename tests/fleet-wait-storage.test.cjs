'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('// BEGIN FLEET WAIT QUEUE');
const end = source.indexOf('// END FLEET WAIT QUEUE', start);
assert.ok(start >= 0 && end > start, 'fleet wait queue markers exist');
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone });
vm.runInContext(source.slice(start, end) + '\nthis.factory = createFleetWaitQueue;', sandbox);

for (const failure of ['unreadable', 'corrupt']) {
  test(`mounted queue handles ${failure} storage without recursive context reads and recovers`, async () => {
    const context = { scope: 'andromeda/player', originId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      active: true, canAct: true };
    let broken = false, reads = 0, writes = 0, dispatches = 0;
    let contextDepth = 0, maximumDepth = 0, replacements = 0, queue;
    queue = sandbox.factory({
      load() {
        reads++;
        if (broken && failure === 'unreadable') throw new Error('Storage unavailable');
        return broken ? { schemaVersion: 1, jobs: 'invalid' } : {};
      },
      save() { writes++; },
      dispatch() { dispatches++; return { status: 'sent' }; },
      getContext() {
        contextDepth++;
        maximumDepth = Math.max(maximumDepth, contextDepth);
        try {
          // Bound a failing implementation so this regression reports an assertion
          // instead of exhausting the JS stack. Production has no such cutoff.
          if (contextDepth > 8) return { ...context, active: false, canAct: false };
          let job = null;
          try { job = queue?.getJobFor(context) || null; } catch (_) { /* Root currentMissionJob also fails closed. */ }
          // Match the root gate's synchronous currentMissionJob read while the
          // queue renders. No saved job authorizes an actual order in this test.
          return { ...context, canAct: !job?.id.startsWith('retry:') };
        } finally { contextDepth--; }
      },
    });
    const element = () => ({ dataset: {}, setAttribute() {}, append() {},
      replaceChildren() {}, addEventListener() {} });
    // No control has focus in these empty-queue storage cases. Model the
    // document root used by the UI's focus-preservation check nevertheless.
    const document = { createElement: element, activeElement: null };
    const container = { ownerDocument: document,
      getRootNode() { return document; },
      contains(node) { return node === this; },
      replaceChildren() { replacements++; } };
    queue.mount(container);
    const mountedRenders = replacements;
    reads = 0; maximumDepth = 0; broken = true;

    assert.equal(queue.refreshConfig(), false);
    assert.equal(maximumDepth, 1, 'a failed read must not recursively render the queue');
    assert.ok(reads <= 2, 'the outer read and render context read are bounded');
    assert.equal(queue.getDiagnostics().readError, true);
    assert.ok(replacements > mountedRenders, 'the storage error remains visible');
    await queue.tick();
    assert.equal(dispatches, 0);
    assert.equal(writes, 0);

    const failedRenders = replacements;
    broken = false;
    assert.equal(queue.refreshConfig(), true);
    queue.mount(container);
    assert.equal(queue.getDiagnostics().readError, false);
    assert.ok(replacements > failedRenders, 'rendering continues after storage recovers');
    assert.equal(maximumDepth, 1);
    await queue.tick();
    assert.equal(dispatches, 0);
    assert.equal(writes, 0);
    queue.destroy();
  });
}
