const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the factory shipped in the userscript, including its real queues,
// persistence, deduplication, callbacks and cross-tab refresh logic.
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('// BEGIN NOTIFIER');
const end = source.indexOf('// END NOTIFIER', start);
assert(start >= 0 && end > start, 'The canonical notifier block must exist');
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const createNotifier = context.createNotifier;
const CONFIG_KEY = 'old-light-notifications:v1';
const SEEN_KEY = 'old-light-notifications:seen:v1';
const TOKEN = '123456:' + 'A'.repeat(35);
const TOKEN_TWO = '789012:' + 'B'.repeat(35);
const BASE = { browserEnabled: true, telegramEnabled: true, botToken: TOKEN, chatId: '-123456' };
const clone = (value) => JSON.parse(JSON.stringify(value));
const event = (id, type = 'building.completed') => ({ id, type, systemName: 'Test System', message: 'Reactor: nivel 3.' });

function make(settings = BASE, sharedStore, factory = createNotifier) {
  const store = sharedStore || new Map();
  if (settings !== null) store.set(CONFIG_KEY, clone(settings));
  let time = 1791748800000;
  let timerSequence = 0;
  let writeFailure = null;
  let readFailure = null;
  let settingsChanges = 0;
  const timers = new Map();
  const requests = [];
  const notifications = [];
  const permissionRequests = [];
  const writes = [];
  class FakeNotification {
    static permission = 'granted';
    static async requestPermission() { permissionRequests.push(true); return 'granted'; }
    constructor(title, options) { this.title = title; this.options = options; this.closed = false; notifications.push(this); }
    close() { this.closed = true; }
  }
  const notifier = factory({
    gmGetValue: (key, fallback) => {
      if (readFailure && key === CONFIG_KEY) throw readFailure;
      return clone(store.has(key) ? store.get(key) : fallback);
    },
    gmSetValue: (key, value) => {
      if (writeFailure && key === CONFIG_KEY) throw writeFailure;
      store.set(key, clone(value));
      writes.push({ key, value: clone(value) });
    },
    gmXmlhttpRequest: (options) => {
      const request = { options, aborted: false };
      requests.push(request);
      return { abort() { request.aborted = true; options.onabort?.({}); } };
    },
    Notification: FakeNotification,
    now: () => time,
    setTimeout: (fn, ms) => { const id = ++timerSequence; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    onSettingsChange: () => { settingsChanges += 1; },
  });
  function tick(ms = 0) {
    const until = time + ms;
    let calls = 0;
    for (;;) {
      const next = [...timers].filter(([, item]) => item.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert(++calls < 10000, 'Notifier timers must settle');
      time = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    time = until;
  }
  return {
    notifier, store, timers, writes, requests, notifications, permissionRequests,
    Notification: FakeNotification, tick,
    settingsChanges: () => settingsChanges,
    failWrites: (enabled = true) => { writeFailure = enabled ? new Error('Storage denied') : null; },
    failReads: (enabled = true) => { readFailure = enabled ? new Error('Storage unreadable') : null; },
    load: (index, status = 200, body = { ok: true }, headers = '') => {
      requests[index].options.onload({ status, response: body, responseHeaders: headers });
    },
    externalChange: (patch) => store.set(CONFIG_KEY, { ...clone(store.get(CONFIG_KEY)), ...clone(patch) }),
  };
}

test('legacy notification preferences gain three unpaused defaults', () => {
  const h = make();
  const saved = h.notifier.exportConfig();
  assert.equal(saved.paused, false);
  assert.equal(saved.browserPaused, false);
  assert.equal(saved.telegramPaused, false);
  assert.equal(saved.browserPauseEpoch, 0);
  assert.equal(saved.telegramPauseEpoch, 0);
});

test('pause API saves immediately and tells its caller whether the save succeeded', () => {
  const h = make();
  assert.equal(typeof h.notifier.setPaused, 'function');
  assert.equal(h.notifier.setPaused('all', true), true);
  assert.equal(h.store.get(CONFIG_KEY).paused, true);
  assert.equal(h.settingsChanges(), 1);
});

test('invalid pause targets and non-boolean values cannot modify settings', () => {
  const h = make();
  assert.equal(typeof h.notifier.setPaused, 'function');
  const before = clone(h.notifier.exportConfig());
  for (const [target, value] of [['email', true], ['', false], [null, true], ['all', 'true'], ['browser', 0], ['telegram', undefined]]) {
    assert.throws(() => h.notifier.setPaused(target, value));
  }
  assert.deepEqual(clone(h.notifier.exportConfig()), before);
  assert.equal(h.writes.length, 0);
});

test('pausing preserves channel enablement, event choices, credentials and unfinished drafts', () => {
  const h = make({ ...BASE, events: { 'building.completed': false, 'settings.minimum': true },
    drafts: { botToken: '123:unfinished', chatId: '@unfinished' }, eventsExpanded: true });
  const before = clone(h.notifier.exportConfig());
  assert.equal(h.notifier.setPaused('all', true), true);
  const after = clone(h.notifier.exportConfig());
  assert.deepEqual(after, { ...before, paused: true,
    browserPauseEpoch: before.browserPauseEpoch + 1, telegramPauseEpoch: before.telegramPauseEpoch + 1 });
  assert.deepEqual(h.store.get(CONFIG_KEY), after);
});

test('global pause silences deliveries while keeping event observation enabled', () => {
  const h = make();
  h.notifier.setPaused('all', true);
  assert.equal(h.notifier.isEnabled(), true);
  assert.equal(h.notifier.isEventEnabled('building.completed'), true);
  assert.equal(h.notifier.emit(event('during-global-pause')), false);
  h.tick(60000);
  assert.equal(h.requests.length, 0);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.notifier.status.browser.queued, 0);
  assert.equal(h.notifier.status.telegram.queued, 0);
});

test('browser pause continues delivering to Telegram', () => {
  const h = make();
  h.notifier.setPaused('browser', true);
  assert.equal(h.notifier.emit(event('telegram-only')), true);
  h.tick();
  assert.equal(h.notifications.length, 0);
  assert.equal(h.requests.length, 1);
  h.load(0);
  assert.equal(h.notifier.status.telegram.enabled, true);
  assert.equal(h.notifier.status.browser.enabled, true);
});

test('Telegram pause continues delivering to the browser', () => {
  const h = make();
  h.notifier.setPaused('telegram', true);
  assert.equal(h.notifier.emit(event('browser-only')), true);
  h.tick();
  assert.equal(h.notifications.length, 1);
  assert.equal(h.requests.length, 0);
});

test('global resume preserves an independent channel pause', () => {
  const h = make();
  h.notifier.setPaused('browser', true);
  h.notifier.setPaused('all', true);
  h.notifier.setPaused('all', false);
  const status = h.notifier.getDiagnostics();
  assert.equal(status.paused, false);
  assert.equal(status.browser.paused, true);
  assert.equal(status.browser.effectivePaused, true);
  assert.equal(status.browser.deliveryEnabled, false);
  assert.equal(status.telegram.paused, false);
  assert.equal(status.telegram.effectivePaused, false);
  assert.equal(status.telegram.deliveryEnabled, true);
  h.notifier.emit(event('after-global-resume'));
  h.tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 0);
});

test('resuming one channel still respects global pause', () => {
  const h = make();
  h.notifier.setPaused('telegram', true);
  h.notifier.setPaused('all', true);
  h.notifier.setPaused('telegram', false);
  const status = h.notifier.getDiagnostics();
  assert.equal(status.telegram.paused, false);
  assert.equal(status.telegram.effectivePaused, true);
  assert.equal(status.telegram.deliveryEnabled, false);
  h.notifier.emit(event('still-globally-paused'));
  h.tick(60000);
  assert.equal(h.requests.length + h.notifications.length, 0);
});

test('pause and resume do not enable unconfigured channels or request browser permission', () => {
  const h = make({ browserEnabled: false, telegramEnabled: false, botToken: '', chatId: '' });
  h.Notification.permission = 'default';
  for (const channel of ['all', 'browser', 'telegram']) {
    h.notifier.setPaused(channel, true);
    h.notifier.setPaused(channel, false);
  }
  assert.equal(h.notifier.isEnabled(), false);
  assert.equal(h.notifier.exportConfig().browserEnabled, false);
  assert.equal(h.notifier.exportConfig().telegramEnabled, false);
  h.tick(60000);
  assert.equal(h.permissionRequests.length, 0);
  assert.equal(h.requests.length + h.notifications.length, 0);
});

test('suppressed events remain remembered after resume and reload', () => {
  const h = make();
  h.notifier.setPaused('all', true);
  assert.equal(h.notifier.emit(event('old-report')), false);
  assert(h.store.get(SEEN_KEY)?.length > 0, 'A suppressed event needs a durable deduplication record');
  h.notifier.destroy();
  const reloaded = make(null, h.store);
  reloaded.notifier.setPaused('all', false);
  assert.equal(reloaded.notifier.emit(event('old-report')), false);
  assert.equal(reloaded.notifier.emit(event('new-report')), true);
  reloaded.tick();
  assert.equal(reloaded.requests.length, 1);
  assert.equal(reloaded.notifications.length, 1);
});

test('events delivered through the other channel cannot replay in a resumed channel', () => {
  const h = make();
  h.notifier.setPaused('telegram', true);
  h.notifier.emit(event('browser-already-saw-this'));
  h.tick();
  h.notifier.setPaused('telegram', false);
  assert.equal(h.notifier.emit(event('browser-already-saw-this')), false);
  h.tick(60000);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.requests.length, 0);
});

test('global pause removes unsent messages and pending delivery timers', () => {
  const h = make();
  h.notifier.emit(event('queued-one'));
  h.notifier.emit(event('queued-two'));
  assert.equal(h.notifier.status.browser.queued, 2);
  assert.equal(h.notifier.status.telegram.queued, 2);
  h.notifier.setPaused('all', true);
  assert.equal(h.notifier.status.browser.queued, 0);
  assert.equal(h.notifier.status.telegram.queued, 0);
  h.notifier.setPaused('all', false);
  h.tick(60000);
  assert.equal(h.requests.length + h.notifications.length, 0);
  assert.equal(h.notifier.emit(event('queued-one')), false);
});

test('browser pause clears its backlog while the Telegram backlog continues', () => {
  const h = make();
  h.notifier.emit(event('first'));
  h.notifier.emit(event('second'));
  h.tick();
  assert.equal(h.notifications.length, 1);
  h.notifier.setPaused('browser', true);
  assert.equal(h.notifier.status.browser.queued, 0);
  assert.equal(h.requests[0].aborted, false);
  h.load(0);
  h.tick(3100);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.requests.length, 2);
});

test('Telegram pause aborts an active send and ignores its late rate-limit callback after resume', () => {
  const h = make();
  h.notifier.emit(event('cancelled-send'));
  h.notifier.emit(event('cancelled-backlog'));
  h.tick();
  h.notifier.setPaused('telegram', true);
  assert.equal(h.requests[0].aborted, true);
  assert.equal(h.notifier.status.telegram.sending, false);
  assert.equal(h.notifier.status.telegram.queued, 0);
  h.notifier.setPaused('telegram', false);
  h.load(0, 429, { ok: false, parameters: { retry_after: 1 } });
  h.tick(60000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifier.status.counters.rateRetries, 0);
  assert.equal(h.notifier.status.counters.telegramFailed, 0);
  assert.equal(h.notifications.length, 2);
});

test('a late success for an aborted send cannot settle a newer request', () => {
  const h = make();
  h.notifier.emit(event('old-send'));
  h.tick();
  h.notifier.setPaused('telegram', true);
  h.notifier.setPaused('telegram', false);
  h.notifier.emit(event('new-send'));
  h.tick(3100);
  assert.equal(h.requests.length, 2);
  h.load(0);
  assert.equal(h.notifier.status.telegram.sending, true);
  assert.equal(h.notifier.status.counters.telegramSent, 0);
  h.load(1);
  assert.equal(h.notifier.status.telegram.sending, false);
  assert.equal(h.notifier.status.counters.telegramSent, 1);
});

test('delivery timers observe a global pause saved by another tab', () => {
  const h = make();
  h.notifier.emit(event('cross-tab-pause'));
  h.externalChange({ paused: true });
  h.tick();
  assert.equal(h.requests.length + h.notifications.length, 0);
  assert.equal(h.notifier.status.paused, true);
  assert.equal(h.notifier.status.browser.queued + h.notifier.status.telegram.queued, 0);
  h.externalChange({ paused: false });
  h.notifier.isEnabled();
  h.tick(60000);
  assert.equal(h.requests.length + h.notifications.length, 0);
});

test('an active Telegram callback observes a channel pause saved by another tab', () => {
  const h = make();
  h.notifier.emit(event('active-cross-tab'));
  h.tick();
  h.externalChange({ telegramPaused: true });
  h.load(0, 429, { ok: false, parameters: { retry_after: 1 } });
  assert.equal(h.requests[0].aborted, true);
  assert.equal(h.notifier.status.counters.rateRetries, 0);
  h.notifier.emit(event('browser-remains-active'));
  h.tick(3100);
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 2);
});

test('a sleeping tab discards both backlogs after another tab globally pauses and resumes', () => {
  const sleeping = make();
  sleeping.notifier.emit(event('sleeping-global-queue'));
  const active = make(null, sleeping.store);
  active.notifier.setPaused('all', true);
  active.notifier.setPaused('all', false);
  assert.equal(sleeping.store.get(CONFIG_KEY).paused, false);
  sleeping.tick(60000);
  assert.equal(sleeping.requests.length + sleeping.notifications.length, 0);
  assert.equal(sleeping.notifier.status.browser.queued + sleeping.notifier.status.telegram.queued, 0);
  assert.equal(sleeping.notifier.emit(event('sleeping-global-queue')), false);
  sleeping.notifier.emit(event('new-global-event'));
  sleeping.tick();
  assert.equal(sleeping.requests.length, 1);
  assert.equal(sleeping.notifications.length, 1);
});

test('a sleeping tab discards only Telegram backlog after another tab pauses and resumes Telegram', () => {
  const sleeping = make();
  sleeping.notifier.emit(event('sleeping-channel-queue'));
  const active = make(null, sleeping.store);
  active.notifier.setPaused('telegram', true);
  active.notifier.setPaused('telegram', false);
  assert.equal(sleeping.store.get(CONFIG_KEY).telegramPaused, false);
  sleeping.tick(60000);
  assert.equal(sleeping.requests.length, 0);
  assert.equal(sleeping.notifications.length, 1);
  assert.equal(sleeping.notifier.status.telegram.queued, 0);
  sleeping.notifier.emit(event('new-channel-event'));
  sleeping.tick();
  assert.equal(sleeping.requests.length, 1);
  assert.equal(sleeping.notifications.length, 2);
});

test('pause saves merge the latest preferences from another tab', () => {
  const h = make();
  const external = { botToken: TOKEN_TWO, chatId: '-654321', browserPaused: true,
    events: { 'building.completed': false, 'settings.minimum': true },
    drafts: { botToken: '789:unfinished', chatId: '@draft' }, eventsExpanded: true };
  h.externalChange(external);
  assert.equal(h.notifier.setPaused('all', true), true);
  const saved = h.store.get(CONFIG_KEY);
  for (const field of ['botToken', 'chatId', 'browserPaused', 'drafts', 'eventsExpanded']) {
    assert.deepEqual(saved[field], external[field], field + ' must survive the pause save');
  }
  assert.equal(saved.events['building.completed'], false);
  assert.equal(saved.events['settings.minimum'], true);
  assert.equal(saved.paused, true);
});

test('an unreadable latest configuration prevents a stale pause write', () => {
  const h = make();
  const before = clone(h.store.get(CONFIG_KEY));
  h.failReads();
  assert.equal(h.notifier.setPaused('all', true), false);
  assert.deepEqual(h.store.get(CONFIG_KEY), before);
  assert.equal(h.writes.length, 0);
  assert.equal(h.notifier.status.paused, false);
  assert(h.notifier.status.storageError);
});

test('credential autosave cannot overwrite another tab pause when its configuration refresh fails', () => {
  // Expose the existing draft-commit callback only inside this test VM. Its
  // implementation and persistence path remain the ones shipped in the script.
  const notifierSource = source.slice(start, end);
  const returnMarker = 'return Object.freeze({ emit,';
  assert.equal(notifierSource.split(returnMarker).length, 2, 'Instrument the single notifier API return');
  const draftContext = vm.createContext({});
  vm.runInContext(notifierSource.replace(returnMarker,
    'return Object.freeze({ __testCommitCredentialDraft: commitCredentialDraft, emit,'), draftContext);
  const h = make({ ...BASE, drafts: { botToken: TOKEN_TWO, chatId: '-222222' } }, undefined, draftContext.createNotifier);
  const otherTab = make(null, h.store);
  otherTab.notifier.setPaused('all', true);
  otherTab.notifier.importConfig({ ...clone(otherTab.notifier.exportConfig()),
    drafts: { botToken: 'unfinished remote token', chatId: '@remote' } });
  const latest = clone(h.store.get(CONFIG_KEY));
  assert.equal(latest.paused, true);
  assert.equal(latest.browserPauseEpoch, 1);
  assert.equal(latest.telegramPauseEpoch, 1);
  h.failReads();
  assert.equal(h.notifier.__testCommitCredentialDraft(), false);
  assert.deepEqual(h.store.get(CONFIG_KEY), latest);
  assert.equal(h.writes.length, 0);
  assert.equal(h.settingsChanges(), 0);
});

test('failed pause persistence preserves active delivery and already queued events', () => {
  const h = make();
  h.notifier.emit(event('save-failed-but-delivery-active'));
  h.failWrites();
  assert.equal(h.notifier.setPaused('all', true), false);
  assert.equal(h.notifier.status.paused, false);
  assert.equal(h.notifier.status.browser.deliveryEnabled, true);
  assert.equal(h.settingsChanges(), 0);
  h.tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 1);
});

test('failed resume persistence leaves delivery paused', () => {
  const h = make({ ...BASE, paused: true });
  h.failWrites();
  assert.equal(h.notifier.setPaused('all', false), false);
  assert.equal(h.notifier.status.paused, true);
  assert.equal(h.store.get(CONFIG_KEY).paused, true);
  h.notifier.emit(event('resume-failed'));
  h.tick(60000);
  assert.equal(h.requests.length + h.notifications.length, 0);
});

test('global and channel pause choices round-trip through export and import', () => {
  const h = make();
  h.notifier.setPaused('all', true);
  h.notifier.setPaused('browser', true);
  h.notifier.setPaused('telegram', false);
  const backup = clone(h.notifier.exportConfig());
  const restored = make();
  assert.equal(restored.notifier.importConfig(backup), true);
  const roundTrip = clone(restored.notifier.exportConfig());
  // Importing a pause is a new pause operation. Its cross-tab cancellation
  // counters stay monotonic while every user preference round-trips exactly.
  for (const key of ['browserPauseEpoch', 'telegramPauseEpoch']) {
    assert(Number.isSafeInteger(roundTrip[key]) && roundTrip[key] >= backup[key]);
    delete roundTrip[key];
    delete backup[key];
  }
  assert.deepEqual(roundTrip, backup);
  assert.equal(restored.notifier.status.paused, true);
  assert.equal(restored.notifier.status.browser.paused, true);
  assert.equal(restored.notifier.status.telegram.paused, false);
  assert.equal(restored.notifier.status.telegram.effectivePaused, true);
});

test('backup validation accepts legacy preferences and rejects malformed pause flags', () => {
  const h = make();
  const legacy = h.notifier.validateConfig(BASE);
  assert.equal(legacy.paused, false);
  assert.equal(legacy.browserPaused, false);
  assert.equal(legacy.telegramPaused, false);
  assert.equal(legacy.browserPauseEpoch, 0);
  assert.equal(legacy.telegramPauseEpoch, 0);
  for (const key of ['paused', 'browserPaused', 'telegramPaused']) {
    for (const value of ['false', 0, 1, null, {}, []]) {
      assert.throws(() => h.notifier.validateConfig({ ...BASE, [key]: value }));
    }
  }
  for (const key of ['browserPauseEpoch', 'telegramPauseEpoch']) {
    for (const value of [-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => h.notifier.validateConfig({ ...BASE, [key]: value }));
    }
  }
});

test('importing a paused configuration cancels active and queued deliveries', () => {
  const h = make();
  h.notifier.emit(event('import-active'));
  h.notifier.emit(event('import-queued'));
  h.tick();
  h.notifier.importConfig({ ...clone(h.notifier.exportConfig()), paused: true });
  assert.equal(h.requests[0].aborted, true);
  assert.equal(h.notifier.status.browser.queued + h.notifier.status.telegram.queued, 0);
  h.notifier.setPaused('all', false);
  h.load(0, 429, { ok: false, parameters: { retry_after: 1 } });
  h.tick(60000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.notifications.length, 1);
});

test('importing and then resuming a previous global pause invalidates another tab backlog', () => {
  const active = make();
  active.notifier.setPaused('all', true);
  const pausedBackup = clone(active.notifier.exportConfig());
  active.notifier.setPaused('all', false);
  const sleeping = make(null, active.store);
  sleeping.notifier.emit(event('queued-before-reimport'));
  active.notifier.importConfig(pausedBackup);
  assert.equal(active.store.get(CONFIG_KEY).paused, true);
  active.notifier.setPaused('all', false);
  sleeping.tick(60000);
  assert.equal(sleeping.requests.length + sleeping.notifications.length, 0);
  assert.equal(sleeping.notifier.status.browser.queued + sleeping.notifier.status.telegram.queued, 0);
  sleeping.notifier.emit(event('new-after-reimport'));
  sleeping.tick();
  assert.equal(sleeping.requests.length, 1);
  assert.equal(sleeping.notifications.length, 1);
});

test('importing a previous channel pause invalidates only that channel backlog in another tab', () => {
  for (const channel of ['browser', 'telegram']) {
    const active = make();
    active.notifier.setPaused(channel, true);
    const pausedBackup = clone(active.notifier.exportConfig());
    active.notifier.setPaused(channel, false);
    const sleeping = make(null, active.store);
    sleeping.notifier.emit(event('queued-before-channel-reimport-' + channel));
    active.notifier.importConfig(pausedBackup);
    assert.equal(active.store.get(CONFIG_KEY)[channel + 'Paused'], true);
    assert.equal(active.store.get(CONFIG_KEY).paused, false);
    active.notifier.setPaused(channel, false);
    sleeping.tick();
    assert.equal(sleeping.requests.length, channel === 'telegram' ? 0 : 1);
    assert.equal(sleeping.notifications.length, channel === 'browser' ? 0 : 1);
  }
});

test('pause actions never emit settings notifications even when those event types are enabled', () => {
  const h = make({ ...BASE, events: { 'settings.minimum': true, 'settings.automation': true } });
  for (const channel of ['all', 'browser', 'telegram']) {
    h.notifier.setPaused(channel, true);
    h.notifier.setPaused(channel, false);
  }
  h.tick(60000);
  assert.equal(h.requests.length + h.notifications.length + h.permissionRequests.length, 0);
  assert.equal(h.notifier.status.counters.accepted, 0);
});

test('delivery diagnostics account for permission and channel configuration as well as pause', () => {
  const h = make({ ...BASE, botToken: '', chatId: '' });
  h.Notification.permission = 'default';
  let status = h.notifier.getDiagnostics();
  assert.equal(status.browser.paused, false);
  assert.equal(status.browser.effectivePaused, false);
  assert.equal(status.browser.deliveryEnabled, false);
  assert.equal(status.telegram.deliveryEnabled, false);
  h.notifier.setPaused('all', true);
  status = h.notifier.getDiagnostics();
  assert.equal(status.browser.effectivePaused, true);
  assert.equal(status.telegram.effectivePaused, true);
  assert.equal(status.browser.enabled, true);
  assert.equal(status.telegram.enabled, true);
});

test('destroyed notifiers reject pause changes without modifying persisted preferences', () => {
  const h = make();
  const before = clone(h.store.get(CONFIG_KEY));
  h.notifier.destroy();
  assert.equal(h.notifier.setPaused('all', true), false);
  assert.deepEqual(h.store.get(CONFIG_KEY), before);
  assert.equal(h.settingsChanges(), 0);
});
