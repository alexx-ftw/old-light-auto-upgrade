(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightMetricsCore', {
    configurable: true, enumerable: true, writable: true, value: api,
  });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const SCHEMA = 1;
  const RETENTION_DAYS = 30;
  const MAX_COUNT = 1000000;
  const DAY_MS = 86400000;
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
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }

  // Never evaluate accessors, toJSON, or object-to-string conversions from storage.
  function valueOf(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
  }

  function safeVersion(version) {
    return typeof version === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version) ? version : 'unknown';
  }

  function dateNumber(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const stamp = Date.parse(value + 'T00:00:00.000Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return null;
    return Math.floor(stamp / DAY_MS);
  }

  function asyncResult(result) {
    if (!result || (typeof result !== 'object' && typeof result !== 'function')) return false;
    // Native rejected promises from an accidentally async adapter must not leak
    // unhandled rejections into the host app. No async result is ever accepted.
    try { Promise.prototype.then.call(result, () => {}, () => {}); return true; } catch (_) { /* Not a native promise. */ }
    return typeof valueOf(result, 'then') === 'function';
  }

  const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const OFF_GENERATION = '00000000-0000-4000-8000-000000000000';

  function empty(version, generation) {
    return { schema: SCHEMA, version, generation, days: [] };
  }

  function sanitize(raw, version, generation, today) {
    const state = empty(version, generation);
    if (raw === null || raw === undefined) return { valid: true, state };
    if (!plain(raw) || valueOf(raw, 'schema') !== SCHEMA) return { valid: false, state };
    // Rotating consent isolates every session. A delayed write from a revoked
    // generation is ignored even after the user opts back in.
    if (valueOf(raw, 'generation') !== generation || valueOf(raw, 'version') !== version) return { valid: true, state };
    const rows = valueOf(raw, 'days');
    if (!Array.isArray(rows) || rows.length > 1000) return { valid: false, state };
    const grouped = new Map();
    for (let index = 0; index < rows.length; index += 1) {
      const row = valueOf(rows, String(index));
      if (!plain(row)) continue;
      const date = valueOf(row, 'date');
      const day = dateNumber(date);
      const counts = valueOf(row, 'counts');
      if (day === null || day > today || day < today - RETENTION_DAYS + 1 || !plain(counts)) continue;
      const aggregate = grouped.get(date) || {};
      for (const event of EVENTS) {
        const count = valueOf(counts, event);
        if (!Number.isSafeInteger(count) || count <= 0) continue;
        aggregate[event] = Math.min(MAX_COUNT, (aggregate[event] || 0) + Math.min(MAX_COUNT, count));
      }
      if (Object.keys(aggregate).length) grouped.set(date, aggregate);
    }
    state.days = [...grouped.keys()].sort().map(date => ({ date, counts: grouped.get(date) }));
    return { valid: true, state };
  }

  // Verification is deliberately stricter than import sanitization. A no-op write
  // must not be mistaken for deletion when the old value contains unknown data.
  function matches(raw, expected) {
    if (!plain(raw) || Object.getOwnPropertySymbols(raw).length) return false;
    const keys = Object.keys(raw).sort();
    if (keys.join('|') !== 'days|generation|schema|version') return false;
    if (valueOf(raw, 'schema') !== expected.schema || valueOf(raw, 'generation') !== expected.generation ||
        valueOf(raw, 'version') !== expected.version) return false;
    const rows = valueOf(raw, 'days');
    if (!Array.isArray(rows) || rows.length !== expected.days.length ||
        Object.keys(rows).length !== rows.length || Object.getOwnPropertySymbols(rows).length) return false;
    for (let i = 0; i < rows.length; i += 1) {
      const row = valueOf(rows, String(i));
      const wanted = expected.days[i];
      if (!plain(row) || Object.getOwnPropertySymbols(row).length || Object.keys(row).sort().join('|') !== 'counts|date' ||
          valueOf(row, 'date') !== wanted.date) return false;
      const counts = valueOf(row, 'counts');
      if (!plain(counts) || Object.getOwnPropertySymbols(counts).length) return false;
      const events = Object.keys(counts).sort();
      if (events.join('|') !== Object.keys(wanted.counts).sort().join('|')) return false;
      for (const event of events) if (valueOf(counts, event) !== wanted.counts[event]) return false;
    }
    return true;
  }

  function strictState(raw, today) {
    if (!plain(raw)) return null;
    const version = valueOf(raw, 'version');
    const generation = valueOf(raw, 'generation');
    if (typeof version !== 'string' || safeVersion(version) !== version ||
        typeof generation !== 'string' || !GENERATION.test(generation)) return null;
    const parsed = sanitize(raw, version, generation, today);
    return parsed.valid && matches(raw, parsed.state) ? parsed.state : null;
  }

  function dominates(actual, expected) {
    if (actual.schema !== expected.schema || actual.version !== expected.version || actual.generation !== expected.generation) return false;
    for (const wanted of expected.days) {
      const row = actual.days.find(item => item.date === wanted.date);
      if (!row) return false;
      for (const event of Object.keys(wanted.counts)) {
        if (!own(row.counts, event) || row.counts[event] < wanted.counts[event]) return false;
      }
    }
    return true;
  }

  /**
   * Synchronous LOCAL adapters; consent and counters MUST use separate storage
   * keys. read/write/remove operate on counters only. readConsent/writeConsent
   * operate only on {enabled, generation}. No adapter may merge the two keys.
   * The optional newGeneration callback must return a fresh cryptographic UUID;
   * Opt-in uses crypto.randomUUID by default, with no insecure fallback. Opt-out
   * never requires randomness: it retains a valid token, or uses a fixed off-only
   * marker. The next opt-in must generate a different cryptographic token.
   *
   * Generations are revocation tokens used only locally, never included in
   * snapshots. record() NEVER writes consent. A stale counter writer cannot
   * reactivate opt-out or restore counters from a previous consent generation.
   * Simultaneous counter writes can still lose increments without storage CAS.
   * No payloads, arbitrary dimensions, network, or precise times are collected.
   */
  function create(options) {
    const config = options && typeof options === 'object' ? options : {};
    const version = safeVersion(config.version);
    const clock = typeof config.now === 'function' ? config.now : Date.now;
    let forcedOff = false;
    let storageError = false;
    let errorCode = null;
    let deletionPending = false;

    function fail(code) {
      forcedOff = true;
      storageError = code !== 'invalid-clock' && code !== 'consent-changed' && code !== 'generation-unavailable';
      errorCode = code;
    }

    function reset() {
      forcedOff = false;
      storageError = false;
      errorCode = null;
      deletionPending = false;
    }

    function dayNow() {
      try {
        const stamp = clock();
        if (typeof stamp === 'number' && Number.isFinite(stamp) && stamp >= 0 && stamp <= 253402300799999) {
          return Math.floor(stamp / DAY_MS);
        }
      } catch (_) { /* Clock failures must not affect the helper. */ }
      fail('invalid-clock');
      return null;
    }

    function readRaw(callback, code) {
      try {
        if (typeof config[callback] !== 'function') { fail(code); return { ok: false }; }
        const raw = config[callback]();
        if (asyncResult(raw)) { fail(code); return { ok: false }; }
        return { ok: true, raw };
      } catch (_) { fail(code); return { ok: false }; }
    }

    function consent() {
      const result = readRaw('readConsent', 'consent-read-failed');
      if (!result.ok) return { ok: false, enabled: false };
      if (result.raw === undefined || result.raw === null) return { ok: true, enabled: false, generation: null };
      try {
        const enabled = valueOf(result.raw, 'enabled');
        const generation = valueOf(result.raw, 'generation');
        if (!plain(result.raw) || typeof enabled !== 'boolean' || typeof generation !== 'string' || !GENERATION.test(generation)) {
          fail('invalid-consent'); return { ok: false, enabled: false };
        }
        return { ok: true, enabled, generation };
      } catch (_) { fail('invalid-consent'); return { ok: false, enabled: false }; }
    }

    function sameConsent(first, second) {
      return first.ok && second.ok && first.enabled === second.enabled && first.generation === second.generation;
    }

    function readState() {
      const permission = consent();
      const today = dayNow();
      const state = empty(version, permission.generation || null);
      if (!permission.ok || today === null) return { ok: false, state, permission };
      if (!permission.enabled) return { ok: true, state, permission, today };
      const result = readRaw('read', 'read-failed');
      if (!result.ok) return { ok: false, state, permission };
      try {
        const parsed = sanitize(result.raw, version, permission.generation, today);
        if (!parsed.valid) { fail('invalid-state'); return { ok: false, state, permission }; }
        const latest = consent();
        if (!sameConsent(permission, latest)) return { ok: false, state, permission: latest };
        return { ok: true, state: parsed.state, permission, today };
      } catch (_) { fail('invalid-state'); return { ok: false, state, permission }; }
    }

    function writeVerified(state, recordDay, beforeState) {
      let failed = false;
      try {
        if (typeof config.write !== 'function') { fail('write-failed'); return false; }
        const result = config.write(JSON.parse(JSON.stringify(state)));
        if (asyncResult(result)) { fail('write-failed'); return false; }
        failed = result === false;
      } catch (_) { failed = true; }
      const persisted = readRaw('read', 'read-failed');
      try {
        if (recordDay !== undefined) {
          if (failed) { fail('write-failed'); return false; }
          if (persisted.ok) {
            // Verification may run after another writer crosses UTC midnight.
            // Either boundary is valid: our own write may retain a day that
            // expires during the write; a newer writer may add the new UTC day.
            const verificationDay = dayNow();
            if (verificationDay === null) return false;
            const actual = strictState(persisted.raw, recordDay) || strictState(persisted.raw, verificationDay);
            if (actual) {
              // A concurrent writer may legitimately add counts before this
              // verification. Dominance confirms our aggregate survived. Other
              // valid snapshots mean contention, not broken storage: do not
              // permanently stop this instance over an approximate lost count.
              if (dominates(actual, state)) return true;
              if (actual.generation === state.generation && actual.version === state.version && beforeState && matches(actual, beforeState)) {
                fail('write-unverified');
              }
              return false;
            }
          }
        } else if (persisted.ok && matches(persisted.raw, state)) return true;
      } catch (_) { /* Untrusted storage. */ }
      fail(failed ? 'write-failed' : (persisted.ok ? 'write-unverified' : 'read-failed'));
      return false;
    }

    function nextGeneration() {
      try {
        const generation = typeof config.newGeneration === 'function' ? config.newGeneration() : globalThis.crypto.randomUUID();
        if (typeof generation === 'string' && GENERATION.test(generation)) return generation;
      } catch (_) { /* Fail closed without cryptographic randomness. */ }
      fail('generation-unavailable');
      return null;
    }

    function writePermission(enabled, previous) {
      const generation = enabled ? nextGeneration() : (previous && previous.ok && previous.generation ? previous.generation : OFF_GENERATION);
      if (!generation) return null;
      if (enabled && previous && previous.generation === generation) { fail('generation-unavailable'); return null; }
      const permission = { enabled, generation };
      try {
        if (typeof config.writeConsent !== 'function') { fail('consent-write-failed'); return null; }
        const result = config.writeConsent({ ...permission });
        if (asyncResult(result)) { fail('consent-write-failed'); return null; }
        const check = consent();
        if (sameConsent({ ok: true, ...permission }, check)) return check;
      } catch (_) { /* Verified below as failure without disclosing error text. */ }
      fail('consent-write-failed');
      return null;
    }

    function erase(generation) {
      deletionPending = true;
      if (writeVerified(empty(version, generation))) { deletionPending = false; return true; }
      try {
        if (typeof config.remove === 'function') {
          if (asyncResult(config.remove())) { fail('remove-failed'); return false; }
          const check = readRaw('read', 'read-failed');
          if (check.ok && (check.raw === null || check.raw === undefined)) { deletionPending = false; return true; }
        }
      } catch (_) { fail('remove-failed'); }
      return false;
    }

    function changePermission(enabled, previous) {
      forcedOff = true;
      const permission = writePermission(enabled, previous);
      if (!permission) return false;
      const erased = erase(permission.generation);
      const latest = consent();
      if (!sameConsent(permission, latest)) { fail('consent-changed'); return false; }
      if (!erased) return false;
      reset();
      return true;
    }

    function setEnabled(enabled) {
      if (typeof enabled !== 'boolean') return false;
      return changePermission(enabled, consent());
    }

    function record(name) {
      if (typeof name !== 'string' || !EVENT_SET.has(name) || forcedOff) return false;
      const current = readState();
      if (!current.ok || !current.permission.enabled || forcedOff) return false;
      const beforeState = JSON.parse(JSON.stringify(current.state));
      const date = new Date(current.today * DAY_MS).toISOString().slice(0, 10);
      let row = current.state.days.find(item => item.date === date);
      if (!row) { row = { date, counts: {} }; current.state.days.push(row); }
      row.counts[name] = Math.min(MAX_COUNT, (row.counts[name] || 0) + 1);
      if (!sameConsent(current.permission, consent())) return false;
      if (!writeVerified(current.state, current.today, beforeState)) return false;
      const latest = consent();
      if (!sameConsent(current.permission, latest)) {
        // A write that raced with opt-out is already invalidated by its old
        // generation. Also remove its bytes best-effort while consent is off.
        if (latest.ok && !latest.enabled) erase(latest.generation);
        return false;
      }
      reset();
      return true;
    }

    function snapshot() {
      const current = readState();
      return { schema: SCHEMA, version, days: !forcedOff && current.ok && current.permission.enabled ? current.state.days : [] };
    }

    function isEnabled() {
      const current = readState();
      return !forcedOff && current.ok && current.permission.enabled === true;
    }

    function clear() {
      // Only an explicit setEnabled(true) may write enabled:true. Clear always
      // turns collection off, so it cannot race with and reverse an opt-out.
      return setEnabled(false);
    }

    function getStatus() {
      const current = readState();
      const enabled = !forcedOff && current.ok && current.permission.enabled === true;
      const days = enabled ? current.state.days : [];
      const total = days.reduce((sum, row) => sum + Object.values(row.counts).reduce((subtotal, count) => subtotal + count, 0), 0);
      return { enabled, storageError, days: days.length, total, deletionPending, errorCode };
    }

    return Object.freeze({ setEnabled, isEnabled, record, snapshot, clear, getStatus });
  }

  return Object.freeze({ create, EVENTS, SCHEMA, RETENTION_DAYS, MAX_COUNT });
});
