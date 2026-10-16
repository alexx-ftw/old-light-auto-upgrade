/* Provider-independent, explicit telemetry. This module contains no network client. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightTelemetryCore', { configurable: true, value: api });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SCHEMA = 1, POLICY = 1, INTERVAL = 300000, TIMEOUT = 8000, WATCH = 250;
  const HOUR = 3600000, MAX_REQUESTS = 12, MAX_COUNT = 1000000, MAX_BYTES = 8192;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const OFF = '00000000-0000-4000-8000-000000000000';
  const EVENTS = Object.freeze([
    'helper.loaded', 'ui.tab.empire', 'ui.tab.buildings', 'ui.tab.fleet', 'ui.tab.notifications', 'ui.tab.data',
    'ui.fleet.minimums', 'ui.fleet.campaigns', 'ui.fleet.missions', 'settings.changed',
    'backup.exported', 'backup.imported', 'backup.failed', 'automation.sent', 'automation.confirmed',
    'automation.unconfirmed', 'automation.failed', 'automation.rejected', 'automation.paused',
    'mission.sent', 'mission.uncertain', 'drive.connected', 'drive.synced', 'drive.retry', 'drive.error',
    'error.runtime', 'error.storage',
    'empire.observer.installation_failed', 'empire.observer.socket_unobserved',
    'empire.observer.awaiting_init', 'empire.observer.missing_init',
    'empire.observer.format_rejected', 'empire.observer.observation_rejected',
    'empire.observer.census_received', 'empire.observer.connection_lost', 'empire.observer.incomplete',
  ]);
  const EVENT_SET = new Set(EVENTS);
  const BUCKETS = Object.freeze(['lt_1ms', '1_4ms', '4_16ms', '16_50ms', '50_200ms', '200_1000ms', 'gte_1000ms']);
  const BOUNDS = [1, 4, 16, 50, 200, 1000, Infinity];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function get(value, key) {
    if (!value || typeof value !== 'object') return undefined;
    const d = Object.getOwnPropertyDescriptor(value, key);
    return d && own(d, 'value') ? d.value : undefined;
  }
  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const p = Object.getPrototypeOf(value);
    return p === null || p === Object.prototype;
  }
  function asynchronous(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    try { Promise.prototype.then.call(value, () => {}, () => {}); return true; } catch (_) { /* Not a promise. */ }
    return typeof get(value, 'then') === 'function';
  }
  function version(value) { return typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value) ? value : 'unknown'; }
  function destination(value) {
    try {
      const id = get(value, 'id');
      return plain(value) && get(value, 'verified') === true && typeof id === 'string'
        && /^[a-z][a-z0-9_-]{0,39}$/.test(id) ? Object.freeze({ id }) : null;
    } catch (_) { return null; }
  }
  /**
   * destination is trusted application configuration, NOT a storage/UI flag:
   * the integrator must verify it before constructing this adapter. transport
   * is supplied by that same integrator. This module neither verifies a server
   * nor implements a provider protocol. The released integration supplies neither.
   * Consent must use private installation storage, separate from local metrics,
   * settings, backups and Drive. It is bound to destination + policy + generation.
   */
  function create(input = {}) {
    const options = input && typeof input === 'object' ? input : {};
    const target = destination(options.destination), release = version(options.version);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const later = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const cancel = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    let counts = {}, buckets = {}, generation = null, timer = null, active = null, destroyed = false, suspended = false;
    let state = 'unconfigured', forcedOff = false, purging = false, requests = [], lastAttempt = -Infinity;
    let accepted = 0, dropped = 0, listener = null;
    const configured = () => !!target && typeof options.transport === 'function'
      && typeof options.readConsent === 'function' && typeof options.writeConsent === 'function';
    function changed() { try { listener?.(); } catch (_) { /* Presentation never controls collection. */ } }
    function total() { return Object.values(counts).reduce((a, b) => a + b, 0) + Object.values(buckets).reduce((a, b) => a + b, 0); }
    function safeCancel(id) { try { if (id !== null) cancel(id); } catch (_) { /* Cleanup remains fail-closed. */ } }
    function stopTimer() { if (timer !== null) { const old = timer; timer = null; safeCancel(old); } }
    function purge() {
      // Abort dispatches listeners synchronously. No callback may collect,
      // enable or start another delivery while an old generation is discarded.
      if (purging) return;
      purging = true;
      try {
        counts = {}; buckets = {}; stopTimer();
        if (active) {
          const request = active; active = null;
          safeCancel(request.timeout); safeCancel(request.watch);
          try { request.controller.abort(); } catch (_) { /* Still settle our operation. */ }
          request.finish(false);
        }
      } finally { purging = false; }
    }
    function consent() {
      const raw = options.readConsent();
      if (asynchronous(raw)) throw new Error('Asynchronous consent is not accepted');
      if (raw === null || raw === undefined) return { enabled: false, generation: null };
      if (!plain(raw) || get(raw, 'schema') !== SCHEMA || get(raw, 'policy') !== POLICY
        || get(raw, 'destinationId') !== target.id || typeof get(raw, 'enabled') !== 'boolean'
        || typeof get(raw, 'generation') !== 'string' || !UUID.test(get(raw, 'generation'))) throw new Error('Invalid consent');
      return { enabled: get(raw, 'enabled'), generation: get(raw, 'generation') };
    }
    function permission() {
      if (purging) return null;
      if (destroyed || suspended || forcedOff || !configured()) {
        purge(); generation = null;
        if (!forcedOff) state = destroyed || suspended ? 'disabled' : 'unconfigured';
        return null;
      }
      try {
        const value = consent();
        if (!value.enabled) { purge(); generation = null; state = 'disabled'; return null; }
        if (value.generation !== generation) { purge(); generation = value.generation; state = 'ready'; }
        return value;
      } catch (_) { forcedOff = true; purge(); generation = null; state = 'storage_error'; return null; }
    }
    function scheduleFlush(delay = INTERVAL) {
      if (timer !== null || active || !total() || destroyed || forcedOff) return;
      timer = later(() => { timer = null; void flush(); }, delay);
    }
    function record(name) {
      try {
        if (typeof name !== 'string' || !EVENT_SET.has(name) || !permission()) return false;
        counts[name] = Math.min(MAX_COUNT, (counts[name] || 0) + 1); scheduleFlush(); return true;
      } catch (_) { return false; }
    }
    function duration(name, milliseconds) {
      try {
        if (name !== 'helper.step' || typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)
          || milliseconds < 0 || milliseconds > 60000 || !permission()) return false;
        const key = BUCKETS[BOUNDS.findIndex(upper => milliseconds < upper)];
        buckets[key] = Math.min(MAX_COUNT, (buckets[key] || 0) + 1); scheduleFlush(); return true;
      } catch (_) { return false; }
    }
    function payload() {
      return { schema: SCHEMA, helper_version: release, counts: { ...counts }, duration_buckets: { helper_step: { ...buckets } } };
    }
    function snapshot() { permission(); return payload(); }
    function setEnabled(enabled) {
      if (typeof enabled !== 'boolean' || destroyed || suspended || purging) return false;
      // Revocation takes effect locally before attempting any persistence.
      forcedOff = true; generation = null; state = 'disabled'; purge();
      if (!configured()) { state = 'unconfigured'; changed(); return false; }
      try {
        let old = null;
        try { old = consent(); } catch (_) { /* Invalid storage cannot block local revocation. */ }
        let next = old?.generation || OFF;
        if (enabled) {
          next = typeof options.randomUUID === 'function' ? options.randomUUID() : globalThis.crypto?.randomUUID?.();
          if (typeof next !== 'string' || !UUID.test(next) || next === OFF || next === old?.generation) throw new Error('Fresh generation unavailable');
        }
        const result = options.writeConsent({ schema: SCHEMA, policy: POLICY, destinationId: target.id, enabled, generation: next });
        if (result === false || asynchronous(result)) throw new Error('Consent write failed');
        const confirmed = consent();
        if (confirmed.enabled !== enabled || confirmed.generation !== next) throw new Error('Consent write unverified');
        forcedOff = false; state = enabled ? 'ready' : 'disabled';
        if (enabled) generation = next;
        changed(); return true;
      } catch (_) { state = 'storage_error'; changed(); return false; }
    }
    async function flush() {
      let request = null;
      try {
        const allowed = permission();
        if (!allowed || active || !total()) return false;
        const stamp = now();
        if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp < 0 || stamp < lastAttempt) {
          forcedOff = true; purge(); state = 'clock_error'; return false;
        }
        requests = requests.filter(value => stamp - value < HOUR);
        const wait = Math.max(0, INTERVAL - (stamp - lastAttempt),
          requests.length >= MAX_REQUESTS ? HOUR - (stamp - requests[0]) : 0);
        if (wait > 0) { stopTimer(); scheduleFlush(wait); return false; }
        if (typeof options.AbortController !== 'function') { purge(); state = 'transport_unavailable'; return false; }
        const batch = payload(), size = total();
        // The payload alphabet is ASCII and its shape is fixed; character count
        // therefore bounds its UTF-8 bytes. No user strings can enter it.
        if (JSON.stringify(batch).length > MAX_BYTES) { purge(); state = 'payload_error'; return false; }
        const latest = permission();
        if (!latest || latest.generation !== allowed.generation) return false;
        counts = {}; buckets = {}; stopTimer();
        let finish;
        const completed = new Promise(resolve => { finish = resolve; });
        request = { generation: allowed.generation, controller: new options.AbortController(), timeout: null, watch: null, finish, size };
        active = request; lastAttempt = stamp; requests.push(stamp); state = 'sending';
        request.timeout = later(() => {
          if (active === request) {
            try { request.controller.abort(); } catch (_) { /* Timeout must still settle. */ }
            request.finish(false);
          }
        }, TIMEOUT);
        const watch = () => {
          if (active !== request || !permission()) return;
          request.watch = later(watch, WATCH);
        };
        request.watch = later(watch, WATCH);
        // Recheck after setup as supplied adapters may cause reentrant revocation.
        if (!permission() || active !== request || generation !== request.generation) return false;
        Promise.resolve(options.transport(batch, { signal: request.controller.signal, destinationId: target.id }))
          .then(result => {
            try { request.finish(!!result && get(result, 'accepted') === true); }
            catch (_) { request.finish(false); }
          }, () => request.finish(false));
        const ok = await completed;
        if (!permission() || active !== request || generation !== request.generation) return false;
        if (ok) { accepted += size; state = 'accepted'; } else { dropped += size; state = 'send_failed'; }
        return ok;
      } catch (_) {
        if (request && active === request) { dropped += request.size; state = 'send_failed'; }
        return false;
      } finally {
        if (request) { safeCancel(request.timeout); safeCancel(request.watch); }
        if (request && active === request) active = null;
        if (total()) scheduleFlush();
        changed();
      }
    }
    function getStatus() {
      const allowed = permission();
      return { configured: configured(), enabled: !!allowed, state, queued: total(), accepted, dropped,
        inFlight: active !== null, destinationId: target?.id || null };
    }
    return Object.freeze({ record, duration, snapshot, setEnabled, flush, getStatus,
      isEnabled: () => !!permission(), sync() { permission(); changed(); },
      onChange(callback) { listener = typeof callback === 'function' ? callback : null; },
      suspend() { suspended = true; purge(); generation = null; state = 'disabled'; changed(); },
      resume() { if (!destroyed && !purging) { suspended = false; permission(); changed(); } },
      destroy() { destroyed = true; purge(); generation = null; state = 'disabled'; changed(); },
    });
  }
  return Object.freeze({ create, EVENTS, BUCKETS, SCHEMA, POLICY, INTERVAL, TIMEOUT, WATCH, MAX_REQUESTS, MAX_COUNT, MAX_BYTES });
});
