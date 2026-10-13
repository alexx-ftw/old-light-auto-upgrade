// ==UserScript==
// @name         Old Light Auto Upgrade
// @namespace    old-light-auto-upgrade
// @version      1.11.0
// @description  Flota prioritaria con reserva de recursos y ETA, mejoras por prioridad, presets, flotas editables en misiones y campañas, reintentos con +1 Marauder, objetivos de nivel, informes y avisos, autoguardado, copias y sincronización automática bidireccional de ajustes por Drive. Con actualización automática.
// @match        https://oldlight.io/*
// @homepageURL  https://github.com/alexx-ftw/old-light-auto-upgrade
// @supportURL   https://github.com/alexx-ftw/old-light-auto-upgrade/issues
// @updateURL    https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.meta.js
// @downloadURL  https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.telegram.org
// @noframes
// ==/UserScript==

// BEGIN EMBEDDED SYNC CORE
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightSyncCore', {
    configurable: true, enumerable: true, writable: true, value: api,
  });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'old-light-settings-sync';
  const SCHEMA_VERSION = 1;
  const MAX_BYTES = 1024 * 1024;
  const MAX_TIME = 8640000000000000;
  const BUILDINGS = Object.freeze(['command_center', 'reactor', 'palladium_extractor', 'iridium_extractor',
    'warehouse', 'shipyard', 'trade_hub']);
  const SHIPS = Object.freeze(['probe', 'marauder', 'sentinel', 'vanguard']);
  const EVENTS = Object.freeze([
    'request.sent', 'building.queued', 'ships.queued', 'building.completed', 'fleet.changed', 'game.toast',
    'game.reports', 'game.messages', 'game.level_target', 'attack.retry', 'request.failed', 'request.rejected',
    'request.unconfirmed', 'automation.paused', 'settings.buildings', 'settings.minimum', 'settings.fleet_mode',
    'settings.priority', 'settings.depot', 'settings.automation',
  ]);
  const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const ALLOWED = new Set([
    'settings.enabled', 'settings.order', 'settings.excluded', 'settings.shipOrder',
    ...SHIPS.map(id => `settings.shipMinimums.${id}`), 'settings.countAway', 'settings.shiftPresetShortcut',
    'settings.depotFillPercent', 'settings.presetCatalog',
    'notifications.browserEnabled', 'notifications.telegramEnabled', 'notifications.paused',
    'notifications.browserPaused', 'notifications.telegramPaused', 'notifications.credentials',
    ...EVENTS.map(type => `notifications.events.${type}`),
    ...BUILDINGS.map(id => `levelTargets.targets.${id}`),
    'attackRetries.enabled', 'attackRetries.autoMinimums', 'attackRetries.produceMissing', 'attackRetries.maxRetries',
  ]);
  const MISSING = Object.freeze({ missing: true });

  function fail(message) { throw new TypeError(message); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function define(target, key, value) {
    Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value });
  }

  function cloneJson(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('JSON values must contain finite numbers.');
      return value;
    }
    if (typeof value !== 'object') fail('Value is not JSON-compatible.');
    if (seen.has(value)) fail('Circular values are not supported.');
    if (!Array.isArray(value) && !isRecord(value)) fail('Only plain JSON objects are supported.');
    if (Object.getOwnPropertySymbols(value).length) fail('Symbol keys are not supported.');
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = new Array(value.length);
      for (let i = 0; i < value.length; i += 1) {
        if (own(value, i)) result[i] = cloneJson(value[i], seen);
      }
      for (const key of Object.keys(value)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) fail('Arrays cannot have extra properties.');
      }
    } else {
      result = {};
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail('Object accessors are not supported.');
        define(result, key, cloneJson(descriptor.value, seen));
      }
    }
    seen.delete(value);
    return result;
  }

  function canonical(value) {
    const seen = new Set();
    function encode(item) {
      if (item === null) return 'null';
      if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) fail('Canonical JSON requires finite numbers.');
        return JSON.stringify(item);
      }
      if (typeof item !== 'object') fail('Canonical JSON requires JSON-compatible values.');
      if (seen.has(item)) fail('Canonical JSON cannot encode circular values.');
      if (!Array.isArray(item) && !isRecord(item)) fail('Canonical JSON requires plain objects.');
      if (Object.getOwnPropertySymbols(item).length) fail('Canonical JSON does not allow symbol keys.');
      seen.add(item);
      let encoded;
      if (Array.isArray(item)) {
        const parts = [];
        for (let i = 0; i < item.length; i += 1) {
          if (!own(item, i)) fail('Canonical JSON does not allow sparse arrays.');
          parts.push(encode(item[i]));
        }
        encoded = `[${parts.join(',')}]`;
      } else {
        const keys = Object.keys(item).sort();
        const parts = keys.map(key => {
          if (PROTOTYPE_KEYS.has(key)) fail('Prototype keys are not allowed.');
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail('Object accessors are not supported.');
          return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
        });
        encoded = `{${parts.join(',')}}`;
      }
      seen.delete(item);
      return encoded;
    }
    return encode(value);
  }

  function byteLength(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }
  function checkSize(value, message = 'Encoded JSON exceeds the 1 MiB limit.') {
    const size = byteLength(JSON.stringify(value));
    if (size > MAX_BYTES) fail(message);
  }
  function checkedCanonical(value) {
    const encoded = canonical(value);
    if (byteLength(encoded) > MAX_BYTES) fail('Encoded JSON exceeds the 1 MiB limit.');
    return encoded;
  }
  function copy(value) { return cloneJson(value); }
  function equal(a, b) { return canonical(a) === canonical(b); }

  function actorValid(actor) { return typeof actor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(actor); }
  function scopeValid(scope) { return typeof scope === 'string' && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/.test(scope); }
  function validStamp(stamp) {
    return Array.isArray(stamp) && stamp.length === 3 && Number.isSafeInteger(stamp[0]) && stamp[0] >= 0
      && stamp[0] <= MAX_TIME && Number.isSafeInteger(stamp[1]) && stamp[1] >= 0 && actorValid(stamp[2]);
  }
  function compareStamp(a, b) {
    for (let i = 0; i < 2; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a[2] === b[2] ? 0 : a[2] < b[2] ? -1 : 1;
  }
  function exactKeys(value, expected, label) {
    if (!isRecord(value)) fail(`${label} must be an object.`);
    if (Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== Object.keys(value).length) {
      fail(`${label} contains non-JSON keys.`);
    }
    const allowed = new Set(expected);
    for (const key of Object.keys(value)) {
      if (PROTOTYPE_KEYS.has(key) || !allowed.has(key)) fail(`${label} contains an unknown or unsafe key.`);
    }
  }
  function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
  function string(value, max) { return typeof value === 'string' && value.length <= max; }
  function validCatalog(value) {
    if (!isRecord(value)) return false;
    try { exactKeys(value, ['scope', 'records'], 'Preset catalog'); } catch (_) { return false; }
    if (typeof value.scope !== 'string' || (value.scope !== '' && !scopeValid(value.scope))
        || !Array.isArray(value.records) || value.records.length > 64) return false;
    const seen = new Set();
    return value.records.every(record => {
      if (!isRecord(record)) return false;
      try { exactKeys(record, ['key', 'locked'], 'Preset record'); } catch (_) { return false; }
      if (!string(record.key, 500) || !record.key || typeof record.locked !== 'boolean' || seen.has(record.key)) return false;
      seen.add(record.key);
      return true;
    });
  }
  function validPair(value, first, second) {
    if (!isRecord(value)) return false;
    try { exactKeys(value, [first, second], 'Atomic preference'); } catch (_) { return false; }
    return typeof value[first] === 'boolean' && integer(value[second], 0, MAX_TIME);
  }
  function validRegisterValue(key, value) {
    if (!ALLOWED.has(key)) return false;
    if (value === null) return true;
    if (key === 'settings.enabled' || key === 'settings.countAway' || key === 'settings.shiftPresetShortcut'
        || key === 'notifications.browserEnabled' || key === 'notifications.telegramEnabled'
        || key === 'notifications.paused' || key === 'notifications.browserPaused'
        || key === 'notifications.telegramPaused' || key.startsWith('notifications.events.')
        || key === 'attackRetries.produceMissing') return typeof value === 'boolean';
    if (key === 'settings.order' || key === 'settings.shipOrder' || key === 'settings.excluded') {
      const known = key === 'settings.shipOrder' ? SHIPS : BUILDINGS;
      return Array.isArray(value) && value.length <= known.length && value.every(item => typeof item === 'string' && known.includes(item))
        && new Set(value).size === value.length
        && (key === 'settings.excluded' || (value.length === known.length && known.every(id => value.includes(id))));
    }
    if (key.startsWith('settings.shipMinimums.')) return integer(value, 0, 1000000);
    if (key === 'settings.depotFillPercent') return integer(value, 1, 100);
    if (key === 'settings.presetCatalog') return validCatalog(value);
    if (key === 'notifications.credentials') {
      if (!isRecord(value)) return false;
      try { exactKeys(value, ['botToken', 'chatId'], 'Notification credentials'); } catch (_) { return false; }
      return string(value.botToken, 221) && string(value.chatId, 65);
    }
    if (key.startsWith('levelTargets.targets.')) return integer(value, 0, 1000000);
    if (key === 'attackRetries.enabled') return validPair(value, 'enabled', 'enabledAt');
    if (key === 'attackRetries.autoMinimums') return validPair(value, 'autoMinimums', 'minimumsEnabledAt');
    if (key === 'attackRetries.maxRetries') return integer(value, 0, 100);
    return false;
  }
  function validateFlat(value, label = 'Register values') {
    exactKeys(value, [...ALLOWED], label);
    const clean = {};
    for (const key of Object.keys(value)) {
      const item = copy(value[key]);
      checkedCanonical(item);
      if (!validRegisterValue(key, item)) fail(`${label} contains an invalid value for ${key}.`);
      define(clean, key, item);
    }
    checkSize(clean);
    return clean;
  }
  function validateDocument(document, scope) {
    document = copy(document);
    checkSize(document);
    exactKeys(document, ['format', 'schemaVersion', 'scope', 'fields'], 'Sync document');
    if (document.format !== FORMAT || document.schemaVersion !== SCHEMA_VERSION) fail('Unsupported sync document format or schema.');
    if (!scopeValid(document.scope) || document.scope !== scope) fail('Sync document scope does not match.');
    exactKeys(document.fields, Object.keys(document.fields), 'Sync fields');
    const fields = {};
    for (const key of Object.keys(document.fields)) {
      if (PROTOTYPE_KEYS.has(key) || !ALLOWED.has(key)) fail('Sync document contains an unknown or unsafe field key.');
      const entry = document.fields[key];
      exactKeys(entry, ['stamp', 'value'], 'Sync field');
      if (!validStamp(entry.stamp)) fail('Sync document contains an invalid stamp.');
      const value = copy(entry.value);
      if (!validRegisterValue(key, value)) fail(`Sync document contains an invalid value for ${key}.`);
      checkedCanonical(value);
      define(fields, key, { stamp: [...entry.stamp], value });
    }
    const clean = { format: FORMAT, schemaVersion: SCHEMA_VERSION, scope, fields };
    checkSize(clean);
    return clean;
  }
  function validateState(state, scope) {
    if (state === null || state === undefined) return { document: null, observed: {} };
    exactKeys(state, ['document', 'observed'], 'Sync state');
    const document = validateDocument(state.document, scope);
    const observed = validateFlat(state.observed, 'Observed values');
    return { document, observed };
  }

  function pick(object, key) { return isRecord(object) && own(object, key) ? object[key] : null; }
  function getAt(root, path) {
    let value = root;
    for (const part of path) {
      if (!isRecord(value) || !own(value, part)) return MISSING;
      value = value[part];
    }
    return value;
  }
  function setAt(root, path, value) {
    let parent = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      if (!own(parent, key) || !isRecord(parent[key])) define(parent, key, {});
      parent = parent[key];
    }
    define(parent, path[path.length - 1], copy(value));
  }
  const SIMPLE_PATHS = Object.freeze({
    'settings.enabled': ['settings', 'enabled'], 'settings.order': ['settings', 'order'],
    'settings.excluded': ['settings', 'excluded'], 'settings.shipOrder': ['settings', 'shipOrder'],
    'settings.countAway': ['settings', 'countAway'], 'settings.shiftPresetShortcut': ['settings', 'shiftPresetShortcut'],
    'settings.depotFillPercent': ['settings', 'depotFillPercent'], 'settings.presetCatalog': ['settings', 'presetCatalog'],
    'notifications.browserEnabled': ['notifications', 'browserEnabled'],
    'notifications.telegramEnabled': ['notifications', 'telegramEnabled'], 'notifications.paused': ['notifications', 'paused'],
    'notifications.browserPaused': ['notifications', 'browserPaused'],
    'notifications.telegramPaused': ['notifications', 'telegramPaused'],
    'attackRetries.produceMissing': ['attackRetries', 'produceMissing'],
    'attackRetries.maxRetries': ['attackRetries', 'maxRetries'],
  });

  function project(backup) {
    if (!isRecord(backup)) fail('Backup must be an object.');
    const rawSettings = pick(backup, 'settings');
    const rawNotifications = pick(backup, 'notifications');
    const rawTargets = pick(backup, 'levelTargets');
    const rawRetries = pick(backup, 'attackRetries');
    const settings = isRecord(rawSettings) ? rawSettings : {};
    const notifications = isRecord(rawNotifications) ? rawNotifications : {};
    const targets = isRecord(rawTargets) && isRecord(pick(rawTargets, 'targets')) ? pick(rawTargets, 'targets') : {};
    const retries = isRecord(rawRetries) ? rawRetries : {};
    const result = {};
    for (const [key, path] of Object.entries(SIMPLE_PATHS)) define(result, key, pick(path[0] === 'settings' ? settings : path[0] === 'notifications' ? notifications : retries, path[path.length - 1]));
    define(result, 'settings.order', pick(settings, 'order'));
    define(result, 'settings.excluded', pick(settings, 'excluded'));
    define(result, 'settings.shipOrder', pick(settings, 'shipOrder'));
    const minimums = pick(settings, 'shipMinimums');
    for (const id of SHIPS) define(result, `settings.shipMinimums.${id}`, pick(isRecord(minimums) ? minimums : {}, id));
    for (const [key, path] of [
      ['settings.countAway', 'countAway'], ['settings.shiftPresetShortcut', 'shiftPresetShortcut'],
      ['settings.depotFillPercent', 'depotFillPercent'], ['settings.presetCatalog', 'presetCatalog'],
    ]) define(result, key, pick(settings, path));
    for (const key of ['browserEnabled', 'telegramEnabled', 'paused', 'browserPaused', 'telegramPaused']) {
      define(result, `notifications.${key}`, pick(notifications, key));
    }
    define(result, 'notifications.credentials', {
      botToken: pick(notifications, 'botToken'), chatId: pick(notifications, 'chatId'),
    });
    const eventValues = pick(notifications, 'events');
    for (const type of EVENTS) define(result, `notifications.events.${type}`, pick(isRecord(eventValues) ? eventValues : {}, type));
    for (const id of BUILDINGS) define(result, `levelTargets.targets.${id}`, pick(targets, id));
    define(result, 'attackRetries.enabled', { enabled: pick(retries, 'enabled'), enabledAt: pick(retries, 'enabledAt') });
    define(result, 'attackRetries.autoMinimums', {
      autoMinimums: pick(retries, 'autoMinimums'), minimumsEnabledAt: pick(retries, 'minimumsEnabledAt'),
    });
    define(result, 'attackRetries.produceMissing', pick(retries, 'produceMissing'));
    define(result, 'attackRetries.maxRetries', pick(retries, 'maxRetries'));
    return copy(result);
  }

  function overlay(backup, values) {
    if (!isRecord(backup)) fail('Backup must be an object.');
    const incoming = validateFlat(values);
    const result = copy(backup);
    for (const [key, value] of Object.entries(incoming)) {
      let path = SIMPLE_PATHS[key];
      if (key.startsWith('settings.shipMinimums.')) path = ['settings', 'shipMinimums', key.slice('settings.shipMinimums.'.length)];
      else if (key.startsWith('notifications.events.')) path = ['notifications', 'events', key.slice('notifications.events.'.length)];
      else if (key.startsWith('levelTargets.targets.')) path = ['levelTargets', 'targets', key.slice('levelTargets.targets.'.length)];
      else if (key === 'notifications.credentials') {
        const before = getAt(result, ['notifications', 'botToken']);
        const beforeChat = getAt(result, ['notifications', 'chatId']);
        const changed = before === MISSING || beforeChat === MISSING
          || !equal({ botToken: before, chatId: beforeChat }, value);
        setAt(result, ['notifications', 'botToken'], value === null ? '' : value.botToken);
        setAt(result, ['notifications', 'chatId'], value === null ? '' : value.chatId);
        if (changed) setAt(result, ['notifications', 'drafts'], {
          botToken: '', chatId: '', // Active credentials never populate the unfinished editor.
        });
        continue;
      } else if (key === 'attackRetries.enabled') {
        if (value === null) {
          setAt(result, ['attackRetries', 'enabled'], false); setAt(result, ['attackRetries', 'enabledAt'], 0);
        } else {
          setAt(result, ['attackRetries', 'enabled'], value.enabled); setAt(result, ['attackRetries', 'enabledAt'], value.enabledAt);
        }
        continue;
      } else if (key === 'attackRetries.autoMinimums') {
        if (value === null) {
          setAt(result, ['attackRetries', 'autoMinimums'], false); setAt(result, ['attackRetries', 'minimumsEnabledAt'], 0);
        } else {
          setAt(result, ['attackRetries', 'autoMinimums'], value.autoMinimums);
          setAt(result, ['attackRetries', 'minimumsEnabledAt'], value.minimumsEnabledAt);
        }
        continue;
      }
      if (!path) fail('Unknown register key.');
      const before = getAt(result, path);
      const changed = before === MISSING || !equal(before, value);
      setAt(result, path, value);
      if (!changed) continue;
      if (key.startsWith('settings.shipMinimums.')) {
        const id = key.slice('settings.shipMinimums.'.length);
        setAt(result, ['settings', 'numericDrafts', 'ships', id], value === null ? '' : String(value));
      } else if (key === 'settings.depotFillPercent') {
        setAt(result, ['settings', 'numericDrafts', 'depot'], value === null ? '' : String(value));
      } else if (key.startsWith('levelTargets.targets.')) {
        const id = key.slice('levelTargets.targets.'.length);
        setAt(result, ['levelTargets', 'drafts', id], value === null ? '' : String(value));
      } else if (key === 'attackRetries.maxRetries') {
        setAt(result, ['attackRetries', 'maxRetriesDraft'], value === null ? '' : String(value));
      }
    }
    return result;
  }

  function create(options) {
    if (!isRecord(options)) fail('create requires an options object.');
    const actor = options.actor;
    const scope = options.scope;
    if (!actorValid(actor)) fail('Invalid sync actor.');
    if (!scopeValid(scope)) fail('Invalid sync scope.');
    const now = options.now === undefined ? () => Date.now() : options.now;
    if (typeof now !== 'function') fail('now must be a function.');
    const loaded = validateState(options.state === undefined ? null : options.state, scope);
    let fields = loaded.document ? copy(loaded.document.fields) : {};
    let observed = copy(loaded.observed);
    let lastMs = -1;
    let lastCounter = -1;
    for (const entry of Object.values(fields)) {
      const [ms, counter] = entry.stamp;
      if (ms > lastMs || (ms === lastMs && counter > lastCounter)) { lastMs = ms; lastCounter = counter; }
    }

    function makeDocument(nextFields = fields) {
      const cleanFields = {};
      for (const key of Object.keys(nextFields).sort()) {
        const entry = nextFields[key];
        define(cleanFields, key, { stamp: [...entry.stamp], value: copy(entry.value) });
      }
      return { format: FORMAT, schemaVersion: SCHEMA_VERSION, scope, fields: cleanFields };
    }
    function nextStamp() {
      const wall = now();
      if (!Number.isSafeInteger(wall) || wall < 0 || wall > MAX_TIME) fail('now returned an invalid timestamp.');
      if (wall > lastMs) { lastMs = wall; lastCounter = wall === 0 ? 1 : 0; }
      else {
        lastCounter = lastCounter < 0 ? 0 : lastCounter + 1;
        if (!Number.isSafeInteger(lastCounter)) fail('Hybrid logical clock overflow.');
      }
      return [lastMs, lastCounter, actor];
    }
    function write(key, value, stamp = nextStamp()) {
      define(fields, key, { stamp, value: copy(value) });
      if (stamp[0] > lastMs || (stamp[0] === lastMs && stamp[1] > lastCounter)) {
        lastMs = stamp[0]; lastCounter = stamp[1];
      }
    }
    function capture(flatValues) {
      const incoming = validateFlat(flatValues);
      const allKeys = new Set([...Object.keys(incoming), ...Object.keys(observed)]);
      for (const key of [...allKeys].sort()) {
        const present = own(incoming, key);
        if (!present && !own(observed, key)) continue;
        const value = present ? incoming[key] : null;
        const hasObserved = own(observed, key);
        const sameObserved = hasObserved && equal(observed[key], value);
        const current = fields[key];
        const sameRegister = current && equal(current.value, value);
        if (!current) {
          write(key, value, !hasObserved || sameObserved ? [0, 0, actor] : nextStamp());
          define(observed, key, copy(value));
        } else if (!hasObserved) {
          // A loaded remote register without an observation is authoritative until the caller
          // accepts it; the current browser value may just be an old local default.
          define(observed, key, copy(value));
        } else if (sameRegister) {
          define(observed, key, copy(value));
        } else if (sameObserved) {
          // A merge can replace the register before the caller applies it. Retain the observation
          // until the projected backup matches the merged value.
          continue;
        } else {
          write(key, value);
          define(observed, key, copy(value));
        }
      }
      checkSize(makeDocument());
      return makeDocument();
    }
    function merge(documents) {
      const list = Array.isArray(documents) ? documents : [documents];
      if (list.length > 10000) fail('Too many sync documents.');
      const cleanDocuments = list.map(document => validateDocument(document, scope));
      checkSize(cleanDocuments);
      const nextFields = copy(fields);
      for (const document of cleanDocuments) {
        for (const [key, entry] of Object.entries(document.fields)) {
          const current = nextFields[key];
          if (!current) { define(nextFields, key, copy(entry)); continue; }
          const order = compareStamp(entry.stamp, current.stamp);
          if (order === 0 && !equal(entry.value, current.value)) fail(`Conflicting payloads share the same stamp for ${key}.`);
          if (order > 0) define(nextFields, key, copy(entry));
        }
      }
      const candidate = makeDocument(nextFields);
      checkSize(candidate);
      fields = nextFields;
      for (const entry of Object.values(fields)) {
        const [ms, counter] = entry.stamp;
        if (ms > lastMs || (ms === lastMs && counter > lastCounter)) { lastMs = ms; lastCounter = counter; }
      }
      return copy(candidate);
    }
    function accept(flatValues) {
      observed = validateFlat(flatValues, 'Accepted values');
      return copy(observed);
    }
    function promoteSeeds() {
      for (const key of Object.keys(fields).sort()) {
        if (fields[key].stamp[0] === 0 && fields[key].stamp[1] === 0) write(key, fields[key].value);
      }
      checkSize(makeDocument());
      return makeDocument();
    }
    function document() { return copy(makeDocument()); }
    function state() {
      const result = { document: makeDocument(), observed: copy(observed) };
      checkSize(result);
      return copy(result);
    }
    function values() {
      const result = {};
      for (const [key, entry] of Object.entries(fields)) define(result, key, copy(entry.value));
      return copy(result);
    }
    return { capture, merge, document, state, values, accept, promoteSeeds };
  }

  return Object.freeze({ project, overlay, create, canonical });
});
// END EMBEDDED SYNC CORE

(() => {
  'use strict';

  // Usa los controles normales del juego, también cuando la vista estrecha
  // oculta sus paneles en Galaxy o Movements pero mantiene sus datos actualizados.
  // Las mejoras actúan sobre la selección; los mínimos requieren un solo sistema.
  // Ambos paneles se actualizan aunque uno de sus tabs internos esté oculto.
  // Nunca elimina hidden/disabled; la construcción usa los controles nativos.
  // Los informes se consultan mediante GET, sin marcarlos como leídos.

  const SCRIPT_VERSION = '1.11.0';
  const KEY = 'old-light-auto-upgrade:v1';
  const HOST_ID = 'old-light-auto-upgrade-panel';
  const PANEL = '#hud-panel-structures';
  const FLEET_PANEL = '#hud-panel-fleet';
  const BUTTONS = `${PANEL} [data-field="buildings-list"] > .building-row button.b-upgrade[data-tutorial^="upgrade-"]`;
  const BUILDINGS = [
    ['command_center', 'Command Center'],
    ['reactor', 'Reactor'],
    ['palladium_extractor', 'Palladium Extractor'],
    ['iridium_extractor', 'Iridium Extractor'],
    ['warehouse', 'Resource Depot'],
    ['shipyard', 'Shipyard'],
    ['trade_hub', 'Trade Hub'],
  ];
  const DEFAULT_ORDER = BUILDINGS.map(([id]) => id);
  const SHIPS = [['probe', 'Probe'], ['marauder', 'Marauder'], ['sentinel', 'Sentinel'], ['vanguard', 'Vanguard']];
  const DEFAULT_SHIP_ORDER = SHIPS.map(([id]) => id);
  const MAX_SHIP_MINIMUM = 1000000;
  const MAX_AUTOMATIC_MINIMUM_RECEIPTS = 128;
  const MAX_NUMERIC_DRAFT_LENGTH = 32;
  const NUMERIC_DEBOUNCE_MS = 400;
  const UI_SECTION_KEYS = ['telegramConnection', 'notificationDiagnostics', 'driveAdvanced', 'automationDetails', 'buildingHelp', 'fleetHelp', 'backupHelp', 'retryOptions'];
  const PANEL_WIDTH = { min: 300, max: 560, default: 360 };
  const MIN_GAP_MS = 500;
  const RESPONSE_TIMEOUT_MS = 12000;
  const RETRY_GAP_MS = 5000;
  const MAX_UNCONFIRMED = 3;
  const upgradeEta = createUpgradeEtaEstimator();
  const fleetPriority = createFleetPriorityPlanner(upgradeEta.formatDuration);

  if (window.top !== window.self || document.getElementById(HOST_ID)) return;

  let settings = readSettings();
  let missionAdapter = null;
  let fleetWait = null;
  let missionTargetResolver = null;
  let attackRetry = null;
  const retryOriginChecks = new Map();
  const shiftPresets = createShiftPresetMenu({
    isEnabled: () => settings.shiftPresetShortcut && !missionAdapter?.isBusy() && !attackRetry?.isBusy(), onPreset: offerPresetMission,
    readPresetCache: readMissionPresetCache, savePresetCache: saveMissionPresetCache,
    canUseEmptyFleet: () => missionContext().selectionCount === 1 && SHIPS.every(([id]) => fleetCounts(id)?.parked === 0),
    captureEmptyTarget: (button, quantities, key) => missionAdapter?.captureRadial(button, quantities, key),
    onEmptyPreset: offerEmptyPresetMission });
  const notifier = createNotifier({ onSettingsChange: settingsChanged });
  const levelTargets = createLevelTargets({ buildings: BUILDINGS, send: event => notifier.emit(event),
    canNotify: () => notifier.isEventEnabled('game.level_target'),
    getSnapshot: () => readLevelTargetSnapshot(rows()), onSettingsChange: settingsChanged });
  const reports = createReportsWatcher({ send: event => notifier.emit(event),
    getAccount: () => missionContext().scope.split('/')[1] || '',
    getBaselineSince: () => attackRetry?.getObservationSince() ?? null,
    onReport: report => attackRetry?.observeReport(report),
    onRecoverReports: batch => attackRetry?.recoverReports(batch) });
  let driveBackup = null;
  let preferenceSync = null;
  let lastPreferenceEditAt = 0;
  let importingBackup = false;
  const notificationSession = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let eventSequence = 0;
  const observeGameEvents = createGameEventObserver(emitEvent);
  let host;
  let ui;
  let pending = null;
  let upgradeEtaClock = null;
  let unconfirmed = 0;
  let nextClickAt = 0;
  let scheduled = false;
  let wakeTimer = null;
  let wakeDue = 0;
  let lastClick = '';
  let error = '';
  let leader = false;
  let requestingLock = false;
  let releaseLock = null;
  let lockError = false;
  let observingNotifications = false;
  const numericInputs = new Map();
  const numericDraftTimers = new Map();
  const numericErrors = new Map();
  const numericSaved = new Set();
  const numericUnsavedEditors = new Set();
  let numericRevision = 0;

  missionTargetResolver = createMissionTargetResolver({ getContext: missionContext, canAct: canOperateMission });
  missionAdapter = createNativeMissionAdapter({ getContext: missionContext, getFleet: fleetCounts,
    canAct: job => canOperateMission() && isCurrentMissionClaim(job) && isRetryMissionAllowed(job), onBusyChange: schedule, onChange: schedule,
    resolveTarget: (job, options) => missionTargetResolver.resolveTarget(job, options) });
  fleetWait = createFleetWaitQueue({
    getContext: missionQueueContext, getFleet: currentMissionFleet,
    openFleetEditor: openMissionFleetEditor,
    isFleetEditing: id => Boolean(id?.startsWith('retry:') && attackRetry?.exportConfig().campaigns
      .find(value => value.queueJobId === id)?.fleetEdit),
    dispatch: async job => {
      const result = await missionAdapter.dispatch(job);
      if (result.status === 'sent' && !job.id.startsWith('retry:')) emitEvent('request.sent',
        `Misión enviada: ${job.originName} → ${job.target.label}. ` + SHIPS.filter(([id]) => job.quantities[id] > 0)
          .map(([id, name]) => `${job.quantities[id]} ${name}`).join(' · '), `mission:${job.id}`, job.originName);
      else if (result.status === 'uncertain') emitEvent('request.unconfirmed',
        `No se ha podido confirmar la misión a ${job.target.label}. Comprueba las misiones del juego.`,
        `mission-uncertain:${job.id}`, job.originName);
      return result;
    },
    onSettingsChange: () => {
      settingsChanged();
      if (!importingBackup) attackRetry?.cleanupCancelledJobs();
      schedule();
    },
  });

  attackRetry = createAttackRetryController({
    getContext: () => ({ ...missionQueueContext(), canAct: canOperateMission()
      && !missionAdapter?.isBusy() && !document.querySelector('dialog[open]') }),
    verifyOrigin: verifyAttackRetryOrigin,
    getJobs: () => fleetWait.list(),
    queueOnce: (spec, options) => fleetWait.queue(spec, options),
    pauseJob: id => fleetWait.pause(id),
    resumeJob: id => fleetWait.resume(id),
    cancelJob: id => { const result = fleetWait.cancel(id); missionAdapter.detach(id); return result; },
    cancelPreparingJob: id => missionAdapter.cancel(id, 'Campaña cancelada. Cerrando la preparación de su misión.'),
    setJobCampaignOwner: (id, campaignId, options) => fleetWait.setCampaignOwner(id, campaignId, options),
    setJobFleetQuantities: (id, quantities, options) => {
      const job = fleetWait.setFleetQuantities(id, quantities, options);
      missionAdapter.detach(id);
      return job;
    },
    openFleetEditor: id => openFleetCompositionEditor('campaign', id),
    raiseMinimums: raiseShipMinimums,
    send: event => notifier.emit(event),
    onSettingsChange: () => { settingsChanged(); schedule(); },
  });

  function emitEvent(type, message, id, systemName = text(document.querySelector('[data-field="nameplate-name"]'))) {
    notifier.emit({ type, id: id || `${notificationSession}:${++eventSequence}`,
      title: 'Old Light', systemName, message });
  }

  function normalizeOrder(order, defaults = DEFAULT_ORDER) {
    const known = Array.isArray(order) ? order.filter(id => defaults.includes(id)) : [];
    // Conserva las prioridades existentes y añade al final cualquier edificio nuevo.
    return [...new Set([...known, ...defaults])];
  }

  function normalizeMinimum(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(MAX_SHIP_MINIMUM, Math.max(0, Math.floor(value))) : 0;
  }

  function normalizePanelPosition(value) {
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: Math.round(value.x), y: Math.round(value.y) } : null;
  }

  function normalizePanelWidth(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, Math.round(value))) : PANEL_WIDTH.default;
  }

  function normalizeUISections(value) {
    return Object.fromEntries(UI_SECTION_KEYS.filter(key => typeof value?.[key] === 'boolean')
      .map(key => [key, value[key]]));
  }

  function validUISections(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(key => UI_SECTION_KEYS.includes(key) && typeof value[key] === 'boolean');
  }

  function numericDraftText(value) {
    return typeof value === 'string' && value.length <= MAX_NUMERIC_DRAFT_LENGTH ? value : null;
  }

  function normalizeNumericDrafts(value) {
    return { ships: Object.fromEntries(SHIPS.map(([id]) => [id, numericDraftText(value?.ships?.[id])])),
      depot: numericDraftText(value?.depot) };
  }

  function validMissionPresetKey(key) {
    if (typeof key !== 'string' || !key || key.length > 500
        || key !== key.normalize('NFKC').replace(/\s+/g, ' ').trim()) return false;
    const seen = new Set();
    const parts = key.replace(/^Use\s+/i, '').split(/,\s+(?=\d)/);
    return parts.length > 0 && parts.every(part => {
      const match = part.match(/^([\d\s,.'’]+)\s+(Probe|Marauder|Sentinel|Vanguard)$/i);
      const count = match ? Number(match[1].replace(/[^\d]/g, '')) : NaN;
      if (!Number.isSafeInteger(count) || count <= 0 || count > 50000 || seen.has(match[2].toLowerCase())) return false;
      seen.add(match[2].toLowerCase());
      return true;
    });
  }

  function normalizePresetCatalog(value) {
    const scope = typeof value?.scope === 'string' && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/.test(value.scope)
      ? value.scope : '';
    const seen = new Set();
    const records = scope && Array.isArray(value?.records) ? value.records.slice(0, 64).filter(record => {
      if (!validMissionPresetKey(record?.key) || typeof record.locked !== 'boolean' || seen.has(record.key)) return false;
      seen.add(record.key);
      return true;
    }).map(({ key, locked }) => ({ key, locked })) : [];
    return { scope, records };
  }

  function validPresetCatalog(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.scope === 'string' && Array.isArray(value.records) && value.records.length <= 64
      && Object.keys(value).every(key => ['scope', 'records'].includes(key))
      && (value.scope === '' ? value.records.length === 0 : /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/.test(value.scope))
      && value.records.every(record => record && typeof record === 'object' && !Array.isArray(record)
        && Object.keys(record).every(key => ['key', 'locked'].includes(key))
        && validMissionPresetKey(record.key) && typeof record.locked === 'boolean')
      && new Set(value.records.map(record => record.key)).size === value.records.length;
  }

  function readMissionPresetCache() {
    if (settings.presetCatalog.scope !== missionContext().scope) return [];
    return settings.presetCatalog.records.map((record, index) => ({ ...record, index,
      label: record.key.replace(/^Use\s+/i, '') }));
  }

  function saveMissionPresetCache(records) {
    const scope = missionContext().scope;
    if (!scope) return;
    const next = normalizePresetCatalog({ scope, records });
    if (JSON.stringify(next) === JSON.stringify(settings.presetCatalog)) return;
    settings.presetCatalog = next;
    saveSettings();
  }

  function validNumericDrafts(value) {
    const object = item => item && typeof item === 'object' && !Array.isArray(item);
    const draft = item => item === null || (typeof item === 'string' && item.length <= MAX_NUMERIC_DRAFT_LENGTH);
    return object(value) && object(value.ships) && draft(value.depot)
      && Object.keys(value).every(key => ['ships', 'depot'].includes(key))
      && Object.keys(value.ships).every(key => DEFAULT_SHIP_ORDER.includes(key))
      && SHIPS.every(([id]) => draft(value.ships[id]));
  }

  function validAutomaticMinimumReceipt(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(key => ['scope', 'reportId', 'takenAt'].includes(key))
      && typeof value.scope === 'string' && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/.test(value.scope)
      && typeof value.reportId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.reportId)
      && Number.isSafeInteger(value.takenAt) && value.takenAt >= 0 && value.takenAt <= 8640000000000000;
  }

  function normalizeAutomaticMinimumReceipts(value) {
    const recent = new Map();
    for (const item of Array.isArray(value) ? value : []) {
      if (!validAutomaticMinimumReceipt(item)) continue;
      const receipt = { scope: item.scope, reportId: item.reportId.toLowerCase(), takenAt: item.takenAt };
      const key = JSON.stringify([receipt.scope, receipt.reportId]);
      recent.delete(key);
      recent.set(key, receipt);
      if (recent.size > MAX_AUTOMATIC_MINIMUM_RECEIPTS) recent.delete(recent.keys().next().value);
    }
    return [...recent.values()];
  }

  function validAutomaticMinimumReceipts(value) {
    return Array.isArray(value) && value.length <= MAX_AUTOMATIC_MINIMUM_RECEIPTS
      && value.every(validAutomaticMinimumReceipt)
      && new Set(value.map(item => JSON.stringify([item.scope, item.reportId.toLowerCase()]))).size === value.length;
  }

  function normalizeSettings(value) {
      return {
        enabled: value?.enabled !== false,
        excluded: Array.isArray(value?.excluded)
          ? [...new Set(value.excluded.filter(id => DEFAULT_ORDER.includes(id)))] : [],
        order: normalizeOrder(value?.order),
        expanded: value?.expanded === true,
        minimized: value?.minimized === true,
        panelPosition: normalizePanelPosition(value?.panelPosition),
        panelWidth: normalizePanelWidth(value?.panelWidth),
        uiSections: normalizeUISections(value?.uiSections),
        activeTab: ['buildings', 'fleet', 'notifications', 'data'].includes(value?.activeTab) ? value.activeTab : 'buildings',
        conditionsExpanded: value?.conditionsExpanded !== false,
        shipMinimums: Object.fromEntries(SHIPS.map(([id]) => [id, normalizeMinimum(value?.shipMinimums?.[id])])),
        automaticMinimumReceipts: normalizeAutomaticMinimumReceipts(value?.automaticMinimumReceipts),
        shipOrder: normalizeOrder(value?.shipOrder, DEFAULT_SHIP_ORDER),
        countAway: value?.countAway === true,
        shiftPresetShortcut: value?.shiftPresetShortcut !== false,
        presetCatalog: normalizePresetCatalog(value?.presetCatalog),
        fleetExpanded: value?.fleetExpanded === true,
        depotFillPercent: typeof value?.depotFillPercent === 'number' && Number.isFinite(value.depotFillPercent)
          ? Math.min(100, Math.max(1, Math.round(value.depotFillPercent))) : 90,
        numericDrafts: normalizeNumericDrafts(value?.numericDrafts),
      };
  }

  function readSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch {
      return normalizeSettings({});
    }
  }

  function settingsChanged() {
    if (!importingBackup) {
      let sharedChanged = true;
      try { sharedChanged = preferenceSync?.observe() !== false; } catch { /* Retry capture on the next cycle. */ }
      driveBackup?.notifyChanged?.({ sharedChanged });
    }
  }

  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {
      // El script sigue funcionando si el navegador bloquea el almacenamiento.
      return false;
    }
    try { settingsChanged(); } catch { /* El guardado local no depende de Drive. */ }
    return true;
  }

  function raiseShipMinimums(request) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const receipt = { scope: request?.scope, reportId: request?.reportId, takenAt: request?.takenAt };
    if (!object(request) || Object.keys(request).some(key => !['scope', 'reportId', 'takenAt', 'quantities'].includes(key))
        || !validAutomaticMinimumReceipt(receipt) || receipt.takenAt > Date.now()
        || !object(request.quantities) || Object.keys(request.quantities).some(id => !DEFAULT_SHIP_ORDER.includes(id))
        || SHIPS.some(([id]) => !Number.isSafeInteger(request.quantities[id])
          || request.quantities[id] < 0 || request.quantities[id] > MAX_SHIP_MINIMUM)) {
      throw new TypeError('La propuesta de mínimos automáticos no es válida.');
    }
    if (importingBackup) return { status: 'deferred', changed: {}, reason: 'importing' };
    if (missionContext().scope !== receipt.scope) return { status: 'deferred', changed: {}, reason: 'account' };

    // Merge against the latest persisted settings. A failed read must never
    // replace the user's settings or deduplication receipts with defaults.
    const raw = localStorage.getItem(KEY);
    const saved = raw === null ? {} : JSON.parse(raw);
    if (!object(saved) || (saved.automaticMinimumReceipts !== undefined
        && !validAutomaticMinimumReceipts(saved.automaticMinimumReceipts))) {
      throw new TypeError('Los mínimos automáticos guardados no son válidos.');
    }
    const latest = normalizeSettings(saved);
    receipt.reportId = receipt.reportId.toLowerCase();
    // Minimums are shared across routes. An older report must not replace the
    // latest defeat already considered for this account.
    if (latest.automaticMinimumReceipts.some(item => item.scope === receipt.scope
        && (item.reportId === receipt.reportId || item.takenAt >= receipt.takenAt))) {
      settings = latest;
      syncNumericInputs();
      schedule();
      return { status: 'noop', changed: {} };
    }
    const changed = {};
    for (const [id] of SHIPS) {
      const before = latest.shipMinimums[id];
      const after = Math.max(before, request.quantities[id]);
      if (after > before) changed[id] = { before, after };
    }
    // Let an existing edit finish before raising its active value. Otherwise
    // its delayed commit or blur would silently restore the old minimum.
    if (Object.keys(changed).some(id => {
      const input = numericInputs.get(id)?.input;
      return numericDraft(latest, id) !== null || numericUnsavedEditors.has(id)
        || Boolean(input && input.getRootNode().activeElement === input);
    })) return { status: 'deferred', changed: {}, reason: 'editing' };

    const next = normalizeSettings(latest);
    for (const [id, change] of Object.entries(changed)) next.shipMinimums[id] = change.after;
    // The receipt and the minimums share one atomic localStorage write. A
    // replay cannot undo a later manual reduction even if the controller's
    // follow-up checkpoint fails or the page reloads immediately afterwards.
    next.automaticMinimumReceipts = [...next.automaticMinimumReceipts, receipt].slice(-MAX_AUTOMATIC_MINIMUM_RECEIPTS);
    const previous = settings;
    settings = next;
    if (!saveSettings()) {
      settings = previous;
      throw new Error('No se pudieron guardar los mínimos automáticos. Se volverá a intentar.');
    }
    for (const id of Object.keys(changed)) { numericErrors.delete(id); numericSaved.add(id); }
    syncNumericInputs();
    schedule();
    return { status: Object.keys(changed).length ? 'applied' : 'noop', changed };
  }

  function numericDraft(source, id) {
    return id === 'depot' ? source.numericDrafts.depot : source.numericDrafts.ships[id];
  }

  function numericActive(source, id) {
    return id === 'depot' ? source.depotFillPercent : source.shipMinimums[id];
  }

  function setNumericDraft(source, id, value) {
    if (id === 'depot') source.numericDrafts.depot = value;
    else source.numericDrafts.ships[id] = value;
  }

  function parseNumericDraft(raw, id) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
    const value = Number(raw.trim());
    return Number.isSafeInteger(value) && value >= (id === 'depot' ? 1 : 0)
      && value <= (id === 'depot' ? 100 : MAX_SHIP_MINIMUM) ? value : null;
  }

  function cancelNumericDraftTimers() {
    numericRevision += 1;
    for (const timer of numericDraftTimers.values()) clearTimeout(timer);
    numericDraftTimers.clear();
  }

  function syncNumericInputs(force = false) {
    for (const [id, { input, status }] of numericInputs) {
      const draft = numericDraft(settings, id);
      const active = numericActive(settings, id);
      if (force || (input.getRootNode().activeElement !== input && !numericUnsavedEditors.has(id))) {
        const value = draft === null ? String(active) : draft;
        if (input.value !== value) input.value = value;
      }
      const invalid = draft !== null && parseNumericDraft(draft, id) === null;
      input.setAttribute('aria-invalid', String(invalid));
      if (status.dataset) status.dataset.state = numericErrors.has(id) || invalid ? 'error'
        : draft !== null ? 'draft' : numericSaved.has(id) ? 'saved' : '';
      const range = id === 'depot' ? '1 a 100' : '0 a 1.000.000';
      setText(status, numericErrors.get(id) || (draft !== null
        ? invalid ? `Borrador guardado. Introduce un entero de ${range}; sigue activo ${active}.`
          : 'Borrador guardado. Se aplicará al terminar de escribir.'
        : numericSaved.has(id) ? 'Guardado automáticamente.' : ''));
    }
  }

  function promoteNumericDraft(id, revision = numericRevision, expectedRaw = numericDraft(settings, id),
      expectedActive = numericActive(settings, id)) {
    if (revision !== numericRevision) return false;
    if (numericDraftTimers.has(id)) clearTimeout(numericDraftTimers.get(id));
    numericDraftTimers.delete(id);
    const value = parseNumericDraft(expectedRaw, id);
    if (value === null) return false;
    let latest;
    try { latest = normalizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch {
      numericErrors.set(id, 'No se pudo leer el guardado. El valor activo se conserva.');
      syncNumericInputs();
      return false;
    }
    // Recheck storage as well as the timer revision: an import in another tab wins.
    if (numericDraft(latest, id) !== expectedRaw || numericActive(latest, id) !== expectedActive) return false;
    const next = normalizeSettings(latest);
    if (id === 'depot') next.depotFillPercent = value;
    else next.shipMinimums[id] = value;
    setNumericDraft(next, id, null);
    settings = next;
    if (!saveSettings()) {
      settings = latest;
      numericErrors.set(id, 'No se pudo aplicar el cambio. El borrador y el valor activo se conservan.');
      syncNumericInputs();
      return false;
    }
    numericErrors.delete(id);
    numericSaved.add(id);
    syncNumericInputs();
    if (value !== expectedActive) {
      if (id === 'depot') emitEvent('settings.depot', `Resource Depot se mejorará desde el ${value}% de capacidad.`);
      else emitEvent('settings.minimum', `Mínimo de ${SHIPS.find(([key]) => key === id)[1]}: ${value}.`);
    }
    schedule();
    return true;
  }

  function scheduleNumericDraft(id) {
    if (numericDraftTimers.has(id)) clearTimeout(numericDraftTimers.get(id));
    numericDraftTimers.delete(id);
    const raw = numericDraft(settings, id);
    if (parseNumericDraft(raw, id) === null) return;
    const revision = numericRevision;
    const active = numericActive(settings, id);
    numericDraftTimers.set(id, setTimeout(() => promoteNumericDraft(id, revision, raw, active), NUMERIC_DEBOUNCE_MS));
  }

  function saveNumericDraft(id, defer = true) {
    const input = numericInputs.get(id).input;
    const raw = input.value;
    if (numericDraftTimers.has(id)) clearTimeout(numericDraftTimers.get(id));
    numericDraftTimers.delete(id);
    if (raw.length > MAX_NUMERIC_DRAFT_LENGTH) {
      numericErrors.set(id, 'El borrador es demasiado largo para guardarlo.');
      numericUnsavedEditors.add(id);
      syncNumericInputs();
      return false;
    }
    const previous = settings;
    let latest;
    try { latest = normalizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch {
      numericErrors.set(id, 'No se pudo guardar el borrador. Conserva este campo abierto para reintentarlo.');
      numericUnsavedEditors.add(id);
      syncNumericInputs();
      return false;
    }
    const changed = numericDraft(latest, id) !== raw;
    setNumericDraft(latest, id, raw);
    settings = latest;
    if (changed && !saveSettings()) {
      settings = previous;
      numericErrors.set(id, 'No se pudo guardar el borrador. Conserva este campo abierto para reintentarlo.');
      numericUnsavedEditors.add(id);
      syncNumericInputs();
      return false;
    }
    numericErrors.delete(id);
    numericUnsavedEditors.delete(id);
    syncNumericInputs();
    if (defer) scheduleNumericDraft(id);
    return true;
  }

  function restoreNumericInputs() {
    cancelNumericDraftTimers();
    numericErrors.clear();
    numericSaved.clear();
    numericUnsavedEditors.clear();
    syncNumericInputs(true);
    for (const id of numericInputs.keys()) scheduleNumericDraft(id);
  }

  function installNumericInput(id, input, status) {
    numericInputs.set(id, { input, status });
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = MAX_NUMERIC_DRAFT_LENGTH;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => { saveNumericDraft(id); });
    const flush = () => {
      if (numericDraft(settings, id) === null && parseNumericDraft(input.value, id) === numericActive(settings, id)) return;
      if (saveNumericDraft(id, false)) promoteNumericDraft(id);
    };
    input.addEventListener('change', flush);
    input.addEventListener('blur', flush);
    syncNumericInputs();
    scheduleNumericDraft(id);
  }

  function text(node) {
    return node?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  function isVisible(node) {
    return Boolean(node?.isConnected && node.getClientRects().length &&
      !node.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(node).visibility === 'visible');
  }

  // BEGIN NATIVE HUD AVAILABILITY
  function hudBlocked() {
    return !document.body || document.body.matches('.booting, .boot-error, .ui-hidden');
  }

  function mobileHudBlock(block, selector) {
    return Boolean(!hudBlocked() && window.matchMedia('(max-width: 900px)').matches
      && block?.isConnected && block.matches(selector)
      && block.parentElement?.matches('main#app > header#hud > #hud-columns.hud-columns > .hud-stack.hud-stack-left')
      && isVisible(block.parentElement));
  }

  function hudPathAvailable(node, anchor, hiddenTab = null, layoutHidden = null) {
    if (!node?.isConnected || !isVisible(anchor)) return false;
    let item = node;
    for (; item && item !== anchor; item = item.parentElement) {
      const inactiveTab = item === hiddenTab && item.hidden === true;
      const style = getComputedStyle(item);
      if (item.matches('[inert], [aria-hidden="true"]') || style.visibility !== 'visible'
          || (item.hasAttribute('hidden') && !inactiveTab)) return false;
      // Only native responsive CSS may hide the known wrapper. An explicit
      // inline hide or a hidden child still means the game control is unavailable.
      if (style.display === 'none' && !inactiveTab
          && (item !== layoutHidden || item.style.getPropertyValue('display').trim() !== '')) return false;
    }
    return item === anchor;
  }

  function responsiveBuildingsBlock(panel) {
    const block = panel?.parentElement;
    if (!['galaxy', 'move'].includes(document.body?.dataset.mobileMode)
        || !mobileHudBlock(block, '.hud-block.hud-buildings[data-field="buildings-wrap"]')) return null;
    const tabs = [PANEL, FLEET_PANEL].map(selector => document.querySelector(selector));
    if (!tabs.every(tab => tab?.parentElement === block) || !tabs.includes(panel)) return null;
    const active = tabs.filter(tab => !tab.hidden);
    const selected = { structures: PANEL, fleet: FLEET_PANEL }[document.body.dataset.starTab];
    if (active.length !== 1 || !selected || !active[0].matches(selected)) return null;
    return block;
  }

  function hudPanelAvailable(panel) {
    if (hudBlocked()) return false;
    if (isVisible(panel)) return true;
    const block = responsiveBuildingsBlock(panel);
    return Boolean(block && !panel.hidden && hudPathAvailable(panel, block.parentElement, null, block));
  }

  function controlVisible(node, panelSelector) {
    if (hudBlocked()) return false;
    if (isVisible(node)) return true;
    const panel = node?.closest(panelSelector);
    if (!panel || ![PANEL, FLEET_PANEL].some(selector => hudPanelAvailable(document.querySelector(selector)))) return false;
    const block = responsiveBuildingsBlock(panel);
    if (block) return hudPathAvailable(node, block.parentElement, panel.hidden === true ? panel : null, block);
    // The inactive internal tab remains readable when its sibling is visible.
    return panel.hidden === true && hudPathAvailable(node, panel.parentElement, panel);
  }

  function garrisonAvailable(node) {
    if (hudBlocked()) return false;
    if (isVisible(node)) return true;
    const block = node?.closest('.hud-block.hud-active');
    if (!mobileHudBlock(block, '.hud-block.hud-active')) return false;
    const fleetWrap = node.closest('[data-field="active-fleet-wrap"]');
    if (!fleetWrap || fleetWrap.parentElement !== block || !node.matches('[data-field="garrison"]')) return false;
    const mode = document.body.dataset.mobileMode;
    const layoutHidden = mode === 'move' ? block
      : mode === 'star' && document.body.dataset.starTab === 'structures' ? fleetWrap : null;
    return Boolean(layoutHidden && hudPathAvailable(node, block.parentElement, null, layoutHidden));
  }
  // END NATIVE HUD AVAILABILITY

  function isAvailable(button, panelSelector = PANEL) {
    return controlVisible(button, panelSelector) && !button.matches(':disabled') &&
      !button.classList.contains('b-loading') &&
      !button.classList.contains('b-upgrade-error') &&
      button.getAttribute('aria-disabled') !== 'true';
  }

  function systemId() {
    const id = new URL(location.href).searchParams.get('system');
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  }

  function fleetCounts(id) {
    const list = document.querySelector('[data-field="active-fleet-list"]');
    const row = list?.querySelector(`.ship-icon-${id}`)?.closest('li');
    const name = SHIPS.find(([key]) => key === id)?.[1];
    const parts = row?.getAttribute('title')?.split(' · ');
    if (!parts || parts.shift() !== name) return null;
    const counts = { parked: null, away: 0, building: 0 };
    for (const part of parts) {
      const match = /^([\d.,'\s\u202f]+) (parked|away|building)$/.exec(part);
      if (!match) return null; // Incluye «— parked» de la selección múltiple.
      const amount = Number(match[1].replace(/[.,'\s\u202f]/g, ''));
      if (!Number.isSafeInteger(amount) || amount < 0) return null;
      counts[match[2]] = amount;
    }
    if (counts.parked === null) return null;
    return counts;
  }

  function shipRows() {
    return [...document.querySelectorAll(`${FLEET_PANEL} [data-field="ship-list"] > .ship-row`)]
      .map(row => {
        const ship = SHIPS.find(([id]) => row.querySelector(`.ship-icon-${id}`));
        return ship ? { id: ship[0], name: ship[1], row,
          button: row.querySelector('button.ship-build-btn'), input: row.querySelector('input.ship-qty') } : null;
      }).filter(row => row?.button && row.input);
  }

  function fleetEnabled() {
    return SHIPS.some(([id]) => settings.shipMinimums[id] > 0);
  }

  function fleetTotal(counts) {
    return counts.parked + counts.away + counts.building;
  }

  function fleetDeficit(id, counts) {
    return Math.max(0, settings.shipMinimums[id] - counts.parked - counts.building -
      (settings.countAway ? counts.away : 0));
  }

  function exactInteger(value) {
    const raw = String(value || '').trim();
    if (!/^\d[\d.,'\s\u202f]*$/.test(raw)) return null;
    const number = Number(raw.replace(/[.,'\s\u202f]/g, ''));
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function displayedInteger(node) {
    return exactInteger(node?.getAttribute('title')) ?? exactInteger(text(node));
  }

  function shipBatches(id) {
    const name = SHIPS.find(([key]) => key === id)?.[1];
    const pattern = new RegExp(`^${name} (?:×(\\d+)|\\d+/(\\d+))(?:\\b|\\s|$)`);
    return [...document.querySelectorAll(`${FLEET_PANEL} [data-field="ship-queue-list"] .queue-row-text`)]
      .map(node => pattern.exec(text(node))).filter(Boolean).map(match => Number(match[1] || match[2]));
  }

  function shipFeedbackLine() {
    return document.querySelector(`${FLEET_PANEL} .ship-build-feedback-list > .ship-build-feedback-line`);
  }

  function shipAcceptedQuantity(request) {
    const line = shipFeedbackLine();
    const title = document.querySelector(`${FLEET_PANEL} .ship-build-feedback-title`);
    if (!line || line === request.feedbackLine || !controlVisible(line, FLEET_PANEL) ||
        text(title) !== `${request.name} order, ${request.quantity} per system`) return request.quantity;
    const pattern = new RegExp(`^Queued (\\d+) of (\\d+) ${request.name.toLowerCase()}s?\\.$`);
    const match = pattern.exec(text(line));
    const accepted = match ? Number(match[1]) : 0;
    return match && Number(match[2]) === request.quantity && accepted > 0 && accepted <= request.quantity
      ? accepted : request.quantity;
  }

  function shipConfirmed(request, counts) {
    const accepted = shipAcceptedQuantity(request);
    if (fleetTotal(counts) < request.fleetTotal + accepted) return false;
    // Un refuerzo que llegue mientras se retrasa nuestro delta no confirma producción.
    // Las firmas de lote incluyen su cantidad, excluyen Scrap y no usan el numerador
    // como cantidad terminada (el juego le da significados distintos según el estado).
    const newBatch = shipBatches(request.id).filter(amount => amount === accepted).length >
      request.batches.filter(amount => amount === accepted).length;
    return counts.building > request.building || newBatch;
  }

  function readShipUnitCost(row) {
    const maximum = exactInteger(row.input.max) || 1;
    const quantity = Math.max(1, Math.min(maximum, Math.floor(Number(row.input.value)) || 1));
    const visible = controlVisible(row.row.querySelector('.ship-cost'), FLEET_PANEL);
    return Object.fromEntries([['palladium', 'pa'], ['iridium', 'ir']].map(([id, suffix]) => {
      const cost = visible ? displayedInteger(row.row.querySelector(`.ship-cost .b-cost-${suffix}`)) : null;
      return [id, cost === null ? null : Math.ceil(cost / quantity)];
    }));
  }

  function readFleetPrioritySnapshot(ships = shipRows(), resources = readResourceSnapshot()) {
    const maintain = fleetEnabled();
    const job = currentMissionJob();
    const waiting = job?.status === 'waiting' && isRetryMissionAllowed(job);
    const fleet = new Map(settings.shipOrder.map(id => [id, fleetCounts(id)]));
    // Reading the forecast must not finish or persist a mission job. Keep its
    // demand even while a native dialog temporarily prevents acting on it.
    const missionDemand = waiting && job.produce && !job.needsReview
      ? fleetWait.productionPlan(job, fleet)?.production : null;
    const missionCanAct = missionQueueContext().canAct;
    const contextReady = Boolean(systemId()) && settings.shipOrder.every(id =>
      !(settings.shipMinimums[id] > 0 || waiting) || Boolean(fleet.get(id)));
    const byId = new Map(ships.map(row => [row.id, row]));
    const targets = settings.shipOrder.map(id => {
      const counts = fleet.get(id);
      const row = byId.get(id);
      const minimumDeficit = counts && maintain ? fleetDeficit(id, counts) : 0;
      const missionDeficit = missionDemand?.[id] || 0;
      const deficit = counts ? Math.max(minimumDeficit, missionDeficit) : 0;
      const availableDemand = missionCanAct ? deficit : minimumDeficit;
      const nativeReason = row?.button.getAttribute('title') || '';
      let blocker = 'unknown';
      if (!row) blocker = 'unavailable';
      else if (row.row.classList.contains('ship-row-locked') || /^Requires\b/i.test(nativeReason)) blocker = 'locked';
      else if (row.button.classList.contains('b-upgrade-error')) blocker = 'error';
      else if (!controlVisible(row.input, FLEET_PANEL) || row.input.matches(':disabled')
          || !controlVisible(row.button, FLEET_PANEL)) blocker = 'unavailable';
      else if (document.activeElement === row.input) blocker = 'manual';
      else if (isAvailable(row.button, FLEET_PANEL)) blocker = 'ready';
      else if (/^Build queue full\.?$/i.test(nativeReason)) blocker = 'queue';
      else if (/^(?:Not enough resources|No selected system can afford this batch)\.?$/i.test(nativeReason)) blocker = 'resources';
      if (missionDeficit > 0 && !availableDemand && !['locked', 'error', 'unavailable'].includes(blocker)) blocker = 'mission';
      return { id, name: SHIPS.find(([key]) => key === id)[1], deficit, blocker, nativeReason,
        maxBatch: Math.min(row ? exactInteger(row.input.max) || 1 : 1, Math.max(1, availableDemand)),
        unitCost: row ? readShipUnitCost(row) : { palladium: null, iridium: null } };
    });
    const activeTimes = [];
    const identity = [];
    let paused = false;
    for (const node of document.querySelectorAll(`${FLEET_PANEL} [data-field="ship-queue-list"] .queue-row`)) {
      const label = text(node.querySelector('.queue-row-text'));
      const queued = node.classList.contains('queue-row-queued');
      const stopped = node.classList.contains('queue-row-paused');
      identity.push(`${stopped ? 'paused' : queued ? 'queued' : 'active'}:${label.replace(/ · [\d\sdhms]+$/, '')}`);
      if (stopped) paused = true;
      if (queued || stopped) continue;
      activeTimes.push(upgradeEta.parseDuration(label.split(' · ').at(-1)));
    }
    const garrison = document.querySelector('[data-field="garrison"].active-garrison-chip--full');
    const treasuryAlert = document.querySelector(`${FLEET_PANEL} .shipyard-deficit-alert`);
    return { active: maintain || waiting, contextReady, resources, ships: targets,
      cooldownMs: Math.max(0, nextClickAt - Date.now()), docksFull: Boolean(garrison && garrisonAvailable(garrison)),
      treasuryBlocked: Boolean(treasuryAlert && controlVisible(treasuryAlert, FLEET_PANEL))
        || targets.some(row => /^Treasury in deficit:/i.test(row.nativeReason)),
      queue: { full: ships.some(row => /^Build queue full\.?$/i.test(row.button.getAttribute('title') || '')),
        paused, identity,
        waitMs: activeTimes.length && activeTimes.every(value => value !== null) ? Math.min(...activeTimes) : null } };
  }

  function prepareShip(row, deficit) {
    if (row.row.classList.contains('ship-row-locked') ||
        row.button.classList.contains('b-upgrade-error') ||
        !controlVisible(row.input, FLEET_PANEL) || row.input.matches(':disabled') ||
        document.activeElement === row.input) return 0;
    const maximum = exactInteger(row.input.max) || 1;
    let quantity = Math.min(deficit, maximum);
    const pa = displayedInteger(document.querySelector('[data-field="res-palladium"]'));
    const ir = displayedInteger(document.querySelector('[data-field="res-iridium"]'));
    const { palladium: perPa, iridium: perIr } = readShipUnitCost(row);
    if ([pa, ir, perPa, perIr].every(value => value !== null)) {
      // Los costes mostrados son del lote entero, no de una sola nave.
      if (perPa > 0) quantity = Math.min(quantity, Math.floor(pa / perPa));
      if (perIr > 0) quantity = Math.min(quantity, Math.floor(ir / perIr));
    } else {
      // No interpreta K/M como enteros exactos; deja validar una unidad al juego.
      quantity = Math.min(quantity, 1);
    }
    if (quantity < 1) return 0;
    if (row.input.value !== String(quantity)) {
      row.input.value = String(quantity);
      row.input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // El manejador nativo recalcula recursos/cola/bloqueos de forma síncrona.
    return isAvailable(row.button, FLEET_PANEL) ? quantity : 0;
  }

  function rows() {
    return [...document.querySelectorAll(BUTTONS)].map(button => {
      const row = button.closest('.building-row');
      const id = button.dataset.tutorial.slice('upgrade-'.length);
      const target = text(button);
      const level = /^lvl\s+(\d+)\b/i.exec(target);
      return {
        id, button, row,
        name: text(row.querySelector('.b-name')) || id,
        target,
        // Build es el primer nivel. El nivel YA construido puede cambiar por
        // un trabajo anterior y no sirve para confirmar nuestra petición.
        targetLevel: level ? Number(level[1]) : /^Build$/i.test(target) ? 1 : null,
      };
    }).filter(row => BUILDINGS.some(([id]) => id === row.id));
  }

  function queueLength() {
    return document.querySelector(`${PANEL} [data-field="queue-list"]`)?.children.length || 0;
  }

  function queuedBuilding(id) {
    const name = BUILDINGS.find(([key]) => key === id)?.[1];
    return [...document.querySelectorAll(`${PANEL} [data-field="queue-list"] .queue-row-text`)]
      .some(node => text(node).startsWith(`${name} → Lvl `));
  }

  function signedInteger(node) {
    for (const raw of [node?.getAttribute('title'), text(node)]) {
      if (!raw) continue;
      const match = /^([+−-]?)([\d.,'\s\u202f]+)$/.exec(raw.trim());
      if (!match) continue;
      const value = exactInteger(match[2]);
      if (value !== null) return match[1] === '-' || match[1] === '−' ? -value : value;
    }
    return null;
  }

  function upgradeEnergy(row) {
    if (!controlVisible(row.row.querySelector('.b-cost'), PANEL)) return null;
    const wrap = row.row.querySelector('.b-cost-en-wrap');
    if (!wrap) return null;
    // El texto anterior puede quedarse dentro de un wrapper hidden de delta cero.
    return wrap.hidden ? 0 : signedInteger(wrap.querySelector('.b-cost-en'));
  }

  function storageFill() {
    const ratios = ['palladium', 'iridium'].map(resource => {
      const amount = displayedInteger(document.querySelector(`[data-field="res-${resource}"]`));
      const capNode = document.querySelector(`[data-field="res-${resource}-cap"]`);
      const cap = exactInteger(capNode?.getAttribute('title')?.replace(/^\/\s*/, '')) ??
        exactInteger(text(capNode).replace(/^\/\s*/, ''));
      return amount !== null && cap > 0 ? amount / cap * 100 : null;
    }).filter(value => value !== null);
    return ratios.length ? Math.max(...ratios) : null;
  }

  function selectBuilding(current) {
    const byId = new Map(current.map(row => [row.id, row]));
    const fill = storageFill();
    const energy = signedInteger(document.querySelector('[data-field="res-energy"]'));
    const selected = settings.order.map(id => byId.get(id)).filter(row => row &&
      !settings.excluded.includes(row.id) && isAvailable(row.button) &&
      (row.id !== 'warehouse' || (fill !== null && fill >= settings.depotFillPercent && !queuedBuilding('warehouse'))));
    const needsPower = row => {
      const delta = upgradeEnergy(row);
      return energy !== null && delta !== null && delta < 0 && energy + delta < 0;
    };
    // El juego permite déficit energético: este requisito previo lo añade el script.
    // Reactor solo se justifica por otra mejora seleccionada y disponible que consumiría
    // más energía libre de la existente. No se construye por un umbral fijo de energía.
    const reactorNeeded = selected.some(row => row.id !== 'reactor' && needsPower(row));
    return selected.find(row => row.id === 'reactor'
      ? reactorNeeded && !queuedBuilding('reactor') : !needsPower(row));
  }

  function readResourceSnapshot() {
    return Object.fromEntries(['palladium', 'iridium'].map(id => {
      const cap = document.querySelector(`[data-field="res-${id}-cap"]`);
      return [id, {
        amount: displayedInteger(document.querySelector(`[data-field="res-${id}"]`)),
        cap: exactInteger(cap?.getAttribute('title')?.replace(/^\/\s*/, '')) ?? exactInteger(text(cap).replace(/^\/\s*/, '')),
        rate: upgradeEta.parseRate(text(document.querySelector(`[data-field="res-${id}-rate"]`))),
      }];
    }));
  }

  function readUpgradeEtaSnapshot(current, resources = readResourceSnapshot()) {
    const buildings = current.map(row => {
      const nativeReason = row.button.getAttribute('title') || '';
      const visible = controlVisible(row.button, PANEL) && controlVisible(row.row.querySelector('.b-cost'), PANEL);
      let blocker = 'unknown';
      if (/^Maxed$/i.test(row.target)) blocker = 'maxed';
      else if (row.row.classList.contains('building-row-locked') || /^Requires\b/i.test(nativeReason)) blocker = 'locked';
      else if (row.button.classList.contains('b-upgrade-error')) blocker = 'error';
      else if (row.button.classList.contains('b-loading')) blocker = 'loading';
      else if (isAvailable(row.button)) blocker = 'ready';
      else if (/^Build queue full\.?$/i.test(nativeReason)) blocker = 'queue';
      else if (/^Not enough resources\.?$/i.test(nativeReason)) blocker = 'resources';
      else if (/^Cost exceeds Resource Depot capacity\.?$/i.test(nativeReason)) blocker = 'capacity';
      return { id: row.id, name: row.name, targetLevel: row.targetLevel, visible, blocker, nativeReason,
        cost: { palladium: visible ? displayedInteger(row.row.querySelector('.b-cost-pa')) : null,
          iridium: visible ? displayedInteger(row.row.querySelector('.b-cost-ir')) : null },
        energy: visible ? upgradeEnergy(row) : null };
    });
    const queued = {};
    const activeTimes = [];
    const queueIdentity = [];
    for (const node of document.querySelectorAll(`${PANEL} [data-field="queue-list"] .queue-row`)) {
      const label = text(node.querySelector('.queue-row-text'));
      const queuedRow = node.classList.contains('queue-row-queued');
      queueIdentity.push(`${queuedRow ? 'queued' : 'active'}:${label.replace(/ · [\d\sdhms]+$/, '')}`);
      const building = BUILDINGS.find(([, name]) => label.startsWith(`${name} → Lvl `));
      if (building) queued[building[0]] = true;
      if (queuedRow || /^Wealth · ongoing$/i.test(label)) continue;
      activeTimes.push(upgradeEta.parseDuration(label.split(' · ').at(-1)));
    }
    return { resources, buildings, energy: signedInteger(document.querySelector('[data-field="res-energy"]')),
      order: settings.order, excluded: settings.excluded, depotFillPercent: settings.depotFillPercent,
      cooldownMs: Math.max(0, nextClickAt - Date.now()),
      queue: { buildings: queued, full: buildings.some(row => row.blocker === 'queue'),
        identity: queueIdentity,
        waitMs: activeTimes.length && activeTimes.every(value => value !== null) ? Math.min(...activeTimes) : null } };
  }

  function renderUpgradeEta() {
    const state = (status, detail, request = null) => ({ state: status, detail, waitMs: null,
      kind: request?.kind === 'ship' ? 'ship' : request ? 'building' : '',
      name: request?.name || '', shipId: request?.kind === 'ship' ? request.id : '', quantity: request?.quantity || 0,
      buildingId: request?.kind === 'ship' ? '' : request?.id || '', targetLevel: request?.targetLevel ?? null });
    let forecast;
    let clockKey = '';
    if (!settings.enabled) forecast = state('paused', 'Reanuda el helper para continuar con la flota y las mejoras.');
    else if (pending) forecast = state('busy', pending.kind === 'ship' ? 'Esperando confirmación del pedido de naves.'
      : 'Esperando confirmación de la mejora solicitada.', pending);
    else if (document.hidden) forecast = state('blocked', 'Vuelve a esta pestaña para leer los datos actuales.');
    else if (![PANEL, FLEET_PANEL].some(selector => hudPanelAvailable(document.querySelector(selector)))) {
      forecast = state('blocked', 'Abre Structures o Shipyard para calcular la ETA.');
    } else if (!systemId() || SHIPS.some(([id]) => fleetCounts(id) === null)) {
      forecast = state('blocked', 'Selecciona un solo sistema con datos disponibles.');
    }
    else if (importingBackup || missionAdapter?.isBusy() || attackRetry?.isBusy()
        || document.querySelector(`${PANEL} .b-loading, ${FLEET_PANEL} .b-loading`)) {
      forecast = state('busy', 'Se recalculará al terminar la operación en curso.');
    } else if (!leader) forecast = state('blocked', 'Esperando control de esta pestaña.');
    else if (reports.isRecovering()) {
      const reportState = reports.getDiagnostics();
      forecast = { ...state(reportState.lastError ? 'blocked' : 'busy', reportState.lastError
        ? 'Esperando la lectura de los últimos combates para continuar.'
        : 'Comprobando los combates recientes antes de continuar.'),
        label: reportState.lastError ? 'En espera' : 'Comprobando…' };
    }
    else {
      const resources = readResourceSnapshot();
      const snapshot = readUpgradeEtaSnapshot(rows(), resources);
      const fleetSnapshot = readFleetPrioritySnapshot(shipRows(), resources);
      const fleetPlan = fleetPriority.select(fleetSnapshot);
      if (fleetPlan.reserve) forecast = fleetPriority.estimate(fleetSnapshot, fleetPlan);
      else {
        forecast = upgradeEta.estimate(snapshot);
        if (fleetPlan.target) {
          if (['ready', 'waiting'].includes(forecast.state)) {
            forecast.detail = `${fleetPlan.notice} ${forecast.detail}`;
          } else forecast = fleetPriority.estimate(fleetSnapshot, fleetPlan);
        }
      }
      clockKey = JSON.stringify({ ...snapshot, system: systemId(), nextClickAt, cooldownMs: 0,
        queue: { ...snapshot.queue, waitMs: null }, fleet: { ...fleetSnapshot, cooldownMs: 0,
          queue: { ...fleetSnapshot.queue, waitMs: null } } });
    }
    // The HUD floors resource amounts. Keep a running clock between native
    // changes instead of freezing until the next whole unit is produced.
    // A new quote, target, queue, system or setting always replaces this clock.
    if (clockKey && forecast.waitMs > 0) {
      const now = Date.now();
      const actionId = forecast.shipId ? `ship:${forecast.shipId}` : `building:${forecast.buildingId}`;
      if (!upgradeEtaClock || upgradeEtaClock.key !== clockKey || upgradeEtaClock.id !== actionId
          || forecast.waitMs > upgradeEtaClock.rawMs + 1) {
        upgradeEtaClock = { key: clockKey, id: actionId, readyAt: now + forecast.waitMs };
      }
      upgradeEtaClock.rawMs = forecast.waitMs;
      upgradeEtaClock.readyAt = Math.min(upgradeEtaClock.readyAt, now + forecast.waitMs);
      forecast.waitMs = Math.max(0, upgradeEtaClock.readyAt - now);
      if (!forecast.waitMs) {
        forecast = { ...forecast, state: 'blocked', waitMs: null,
          detail: 'Esperando a que el juego confirme los recursos y la disponibilidad.' };
      }
    } else upgradeEtaClock = null;
    const numeric = Number.isFinite(forecast.waitMs);
    const duration = numeric ? (forecast.waitMs > 0 ? `≈${upgradeEta.formatDuration(forecast.waitMs)}` : 'Disponible')
      : forecast.label || (forecast.state === 'paused' ? 'En pausa' : forecast.state === 'busy' ? 'Confirmando…' : 'Sin ETA');
    const target = forecast.name ? forecast.kind === 'ship' ? `${forecast.name} ×${forecast.quantity}`
      : `${forecast.name}${forecast.targetLevel !== null ? ` · nivel ${forecast.targetLevel}` : ''}`
      : 'Próximo pedido automático';
    const explanation = 'Tiempo estimado hasta poder encolar el siguiente pedido de flota o mejora, con la producción actual. '
      + 'Se recalcula al cambiar recursos, costes, cola o prioridades. Otros gastos y las construcciones que terminen pueden cambiar la previsión.';
    ui.eta.dataset.state = forecast.state;
    ui.eta.dataset.kind = forecast.kind || (forecast.buildingId ? 'building' : '');
    ui.eta.dataset.shipId = forecast.shipId || '';
    ui.eta.dataset.buildingId = forecast.buildingId || '';
    if (numeric) ui.etaTime.dataset.seconds = String(Math.ceil(forecast.waitMs / 1000));
    else delete ui.etaTime.dataset.seconds;
    setText(ui.etaTime, duration);
    setText(ui.etaTarget, target);
    setText(ui.etaDetail, forecast.detail);
    setText(ui.etaCompact, forecast.name ? `${duration} · ${forecast.name}` : duration);
    const readyAt = numeric ? new Date(Date.now() + forecast.waitMs) : null;
    ui.eta.title = explanation + (readyAt && Number.isFinite(readyAt.getTime())
      ? ` Hora aproximada: ${readyAt.toLocaleString(undefined, { hour12: false })}.` : '');
    ui.etaCompact.title = `${target}: ${duration}. ${forecast.detail} ${explanation}`;
  }

  function batchSummary() {
    return document.querySelector(`${PANEL} .b-batch-report .b-batch-summary`);
  }

  function batchApplied(request) {
    const summary = batchSummary();
    // El juego crea un nodo nuevo por respuesta, aunque repita el mismo texto.
    if (!summary || summary === request.batchSummary || !controlVisible(summary, PANEL)) return null;
    const prefix = `Queued ${request.name} at `;
    const message = text(summary);
    if (!message.startsWith(prefix)) return null;
    const match = /^(?:all )?(\d+)(?: of \d+)? systems?\.$/.exec(message.slice(prefix.length));
    return match ? Number(match[1]) : null;
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function mount() {
    if (host?.isConnected) return;
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all:initial; position:fixed; right:12px; bottom:12px; z-index:2147483000; color-scheme:dark;
            font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            --ol-bg:#0c141d; --ol-surface:#131f2b; --ol-surface-raised:#192939; --ol-border:#2b4053;
            --ol-border-strong:#456177; --ol-text:#e5eef6; --ol-muted:#a2b5c6; --ol-dim:#8097aa;
            --ol-accent:#7de2c2; --ol-accent-bg:#183c36; --ol-warning:#f3cb80; --ol-danger:#f4a8a8;
            --ol-focus:#8bc7ff; --ol-radius:10px; }
          :host([hidden]), [hidden] { display:none !important; }
          * { box-sizing:border-box; }
          .helper-shell { position:relative; display:flex; flex-direction:column; container-type:inline-size; container-name:helper;
            width:var(--helper-width,360px); max-width:calc(100vw - 24px); height:min(720px,calc(100dvh - 24px));
            color:var(--ol-text); background:var(--ol-bg); border:1px solid var(--ol-border-strong);
            border-radius:14px; box-shadow:0 12px 48px #0007,0 1px 4px #0005; overflow:hidden; }
          .helper-header { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-shrink:0;
            padding:12px; background:var(--ol-bg); cursor:grab; touch-action:none; user-select:none; }
          .helper-header.is-dragging { cursor:grabbing; }
          .helper-title { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
          .helper-title-copy { flex:1; min-width:0; }
          .helper-title-line { display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 6px; }
          .helper-title-line strong { font-size:14px; font-weight:650; letter-spacing:.01em; }
          .helper-version { font-size:10.5px; line-height:1.3; color:var(--ol-muted); white-space:nowrap;
            font-variant-numeric:tabular-nums; }
          .helper-grip { width:22px; height:26px; flex-shrink:0; color:var(--ol-accent); display:grid; place-items:center; }
          .helper-grip svg { width:22px; height:22px; }
          .helper-eta-compact { display:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            font-size:11px; line-height:1.4; color:var(--ol-muted); font-variant-numeric:tabular-nums; }
          .helper-shell.minimized { width:280px; height:auto; min-height:54px; }
          .helper-shell.minimized > :not(header) { display:none !important; }
          .helper-shell.minimized .helper-header { padding:8px 10px; gap:6px; }
          .helper-shell.minimized .helper-grip { display:none; }
          .helper-shell.minimized .helper-title-line strong { font-size:12px; }
          .helper-shell.minimized .helper-version { font-size:10px; }
          .helper-shell.minimized .helper-eta-compact { display:block; }
          button, input { font:inherit; }
          button { min-height:32px; cursor:pointer; color:var(--ol-text); background:var(--ol-surface-raised);
            border:1px solid var(--ol-border-strong); border-radius:7px; padding:6px 10px; line-height:1.3;
            transition:background-color .12s,border-color .12s; }
          button:hover:not(:disabled) { background:#23394b; border-color:#65869f; }
          button:disabled { opacity:.42; cursor:default; }
          button:focus-visible, summary:focus-visible, input:focus-visible, a:focus-visible {
            outline:2px solid var(--ol-focus); outline-offset:2px; }
          [data-action="automation-toggle"] { min-width:68px; font-size:12px; color:var(--ol-accent);
            background:var(--ol-accent-bg); border-color:#356959; }
          [data-action="automation-toggle"][aria-pressed="false"] { color:var(--ol-warning); background:#352d20; border-color:#806b40; }
          .helper-minimize { width:32px; height:32px; flex-shrink:0; padding:0; font-size:19px; color:var(--ol-muted); }
          .settings-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; flex-shrink:0;
            margin:0 12px 10px; padding:4px; border:1px solid var(--ol-border); border-radius:10px; background:#080f17; }
          .settings-tabs button { min-height:35px; min-width:0; padding:5px 3px; border-color:transparent;
            color:var(--ol-muted); background:transparent; font-size:12px; font-weight:550; }
          .settings-tabs button[aria-selected="true"] { color:#d7fff0; background:var(--ol-accent-bg); border-color:#356959; }
          .helper-scroll { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain;
            padding:0 12px 12px; scrollbar-width:thin; scrollbar-color:var(--ol-border-strong) transparent; scroll-padding:12px; }
          p { margin:8px 0 0; overflow-wrap:anywhere; }
          small { display:block; color:var(--ol-muted); margin-top:5px; overflow-wrap:anywhere; }
          small:empty, p:empty { display:none; }
          strong { color:var(--ol-text); }
          h3 { margin:0; font-size:13px; font-weight:650; }
          .upgrade-eta { margin:0 0 14px; padding:12px; border:1px solid var(--ol-border); border-radius:var(--ol-radius);
            background:var(--ol-surface); border-left:3px solid var(--ol-border-strong); }
          .upgrade-eta[data-state="ready"], .upgrade-eta[data-state="waiting"] { border-left-color:var(--ol-accent); }
          .upgrade-eta[data-state="blocked"] { border-left-color:var(--ol-warning); }
          .upgrade-eta-heading { display:flex; align-items:baseline; justify-content:space-between; gap:8px;
            color:var(--ol-muted); font-size:11.5px; }
          .upgrade-eta-time { flex-shrink:0; color:var(--ol-accent); font-size:17px; line-height:1.2;
            font-weight:650; font-variant-numeric:tabular-nums; }
          .upgrade-eta-target { margin-top:6px; color:var(--ol-text); font-size:14px; font-weight:600; overflow-wrap:anywhere; }
          .upgrade-eta-detail { margin-top:6px; font-size:11.5px; line-height:1.45; }
          .upgrade-eta[data-state="paused"] .upgrade-eta-target { display:none; }
          .upgrade-eta[data-state="blocked"] .upgrade-eta-time { color:var(--ol-warning); font-size:14px; }
          .upgrade-eta[data-state="paused"] .upgrade-eta-time, .upgrade-eta[data-state="idle"] .upgrade-eta-time { color:var(--ol-muted); font-size:14px; }
          .helper-alert { margin:0 0 12px; padding:10px; border:1px solid #87555a; border-radius:8px;
            color:var(--ol-danger); background:#2e1d25; font-size:12px; }
          details { margin-top:10px; border:1px solid var(--ol-border); border-radius:var(--ol-radius); padding:10px 12px;
            background:var(--ol-surface); }
          summary { cursor:pointer; color:var(--ol-text); font-size:12px; font-weight:600; min-height:22px; }
          summary::marker { color:var(--ol-muted); font-size:10px; }
          .settings-page { margin:0; padding:0; border:0; background:transparent; }
          .settings-page > summary, .settings-page > .notifications-details > summary { display:none; }
          .settings-page > .notifications-details { margin:0; padding:0; border:0; background:transparent; }
          .page-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; }
          .count-badge { display:inline-flex; align-items:center; padding:2px 7px; border:1px solid var(--ol-border);
            border-radius:999px; color:var(--ol-muted); background:var(--ol-surface); font-size:11px; font-variant-numeric:tabular-nums; }
          .page-intro, .hint { margin:5px 0 9px; color:var(--ol-muted); font-size:11.5px; line-height:1.5; }
          .choices { display:grid; gap:5px; margin-top:10px; }
          .priority-row { display:grid; grid-template-columns:24px 16px minmax(0,1fr) 64px; align-items:center;
            gap:5px; min-height:55px; padding:7px 6px; border:1px solid var(--ol-border); border-radius:8px; background:var(--ol-surface); }
          .priority-row[data-state="off"] { background:transparent; }
          .priority-row[data-state="off"] .building-copy { color:var(--ol-muted); }
          .priority-row[data-state="next"], .fleet-row[data-state="next"] { border-color:#3c826c; background:#112c29; }
          .priority-drag { width:24px; height:34px; min-height:34px; padding:0; color:var(--ol-muted); background:transparent;
            border-color:transparent; font-size:18px; cursor:grab; touch-action:none; user-select:none; }
          .priority-drag:hover:not(:disabled) { border-color:var(--ol-border); background:var(--ol-surface-raised); }
          .priority-row.is-dragging, .fleet-row.is-dragging { opacity:.55; }
          .priority-row.drop-before, .fleet-row.drop-before { box-shadow:0 -2px 0 var(--ol-accent); }
          .priority-row.drop-after, .fleet-row.drop-after { box-shadow:0 2px 0 var(--ol-accent); }
          .is-sorting, .is-sorting .priority-drag { cursor:grabbing; }
          .priority-position { color:var(--ol-dim); text-align:center; font-size:11px; font-variant-numeric:tabular-nums; }
          .priority-actions { display:flex; gap:4px; }
          .priority-actions button { width:30px; height:32px; padding:0; color:var(--ol-muted); background:transparent; border-color:var(--ol-border); }
          label { display:flex; align-items:center; gap:8px; cursor:pointer; min-width:0; }
          input { accent-color:var(--ol-accent); margin:0; flex-shrink:0; }
          input[type="checkbox"] { width:16px; height:16px; }
          .building-copy { min-width:0; font-size:12px; font-weight:550; }
          .building-name { display:block; overflow-wrap:anywhere; }
          .building-meta { display:block; color:var(--ol-muted); font-size:11px; line-height:1.35; font-weight:400; margin-top:2px; }
          .priority-tools { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; }
          .priority-tools .hint { margin:0; font-size:11px; }
          .reset-order, .reset-ships { color:var(--ol-muted); background:transparent; border-color:transparent; font-size:11.5px; padding:5px; }
          .conditions-details .hint { margin:9px 0; }
          .depot-threshold { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; font-size:12px; }
          .depot-threshold input { width:59px; min-height:34px; padding:5px 7px; border:1px solid var(--ol-border-strong);
            border-radius:6px; color:var(--ol-text); background:var(--ol-bg); }
          .fleet-choices { display:grid; gap:7px; margin-top:10px; }
          .fleet-row { display:grid; grid-template-columns:24px 16px minmax(0,1fr) 70px; gap:6px; align-items:center;
            padding:9px 7px; border:1px solid var(--ol-border); border-radius:9px; background:var(--ol-surface); }
          .fleet-row > .priority-drag { grid-column:1; grid-row:1 / 3; align-self:center; }
          .fleet-row > .priority-position { grid-column:2; grid-row:1; }
          .fleet-row > label { grid-column:3; grid-row:1; font-size:13px; font-weight:600; }
          .fleet-row > input { grid-column:4; grid-row:1; width:70px; min-width:0; min-height:34px; padding:5px 7px;
            border:1px solid var(--ol-border-strong); border-radius:6px; background:var(--ol-bg); color:var(--ol-text); font-variant-numeric:tabular-nums; }
          .fleet-row > .priority-actions { grid-column:4; grid-row:2; justify-content:flex-end; }
          .fleet-counts { grid-column:2 / 4; grid-row:2; display:flex; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--ol-muted); }
          .fleet-stat { display:inline-flex; align-items:baseline; gap:3px; }
          .fleet-stat b { color:var(--ol-text); font-weight:600; font-variant-numeric:tabular-nums; }
          .fleet-stat[data-count-kind="building"] b { color:var(--ol-accent); }
          .count-away { margin-top:12px; font-size:12px; }
          .fleet-shortcut { margin-top:12px; padding:12px; border:1px solid var(--ol-border); border-radius:var(--ol-radius); background:var(--ol-surface); font-size:12px; }
          .fleet-shortcut .hint { margin:7px 0 0; }
          kbd { font:inherit; font-size:11px; color:var(--ol-text); background:var(--ol-bg); padding:1px 4px; border:1px solid var(--ol-border-strong); border-radius:4px; }
          .numeric-autosave { grid-column:2 / -1; margin:0; font-size:11px; line-height:1.45; }
          .numeric-autosave[data-state="error"] { color:var(--ol-danger); }
          .numeric-autosave[data-state="draft"] { color:var(--ol-warning); }
          .numeric-autosave[data-state="saved"] { color:var(--ol-accent); }
          .backup-card { border:1px solid var(--ol-border); border-radius:var(--ol-radius); padding:12px; background:var(--ol-surface); margin-top:10px; }
          .backup-card:first-child { margin-top:0; }
          .settings-page > [data-field="drive-backup"] { margin-top:12px; }
          .backup-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0 0; }
          .backup-actions button { min-height:36px; padding:7px; }
          .backup-status { white-space:pre-line; font-size:12px; color:var(--ol-muted); }
          .backup-warning { margin-top:8px; font-size:11.5px; color:var(--ol-muted); }
          .backup-help { display:inline-block; margin-top:10px; font-size:11.5px; color:var(--ol-focus); }
          .panel-width-label { justify-content:space-between; font-size:12px; margin-top:10px; }
          .panel-width-label output { color:var(--ol-muted); font-variant-numeric:tabular-nums; }
          .panel-width-input { width:100%; min-height:30px; margin:6px 0; cursor:ew-resize; }
          .panel-reset { width:100%; color:var(--ol-muted); background:transparent; }
          .helper-activity { margin-top:14px; padding:9px 11px; background:transparent; }
          .helper-activity summary { color:var(--ol-muted); font-size:11.5px; }
          .helper-status, .helper-last { font-size:11.5px; color:var(--ol-muted); }
          .helper-footer { display:flex; justify-content:space-between; gap:8px; flex-shrink:0; padding:7px 12px;
            border-top:1px solid var(--ol-border); color:var(--ol-dim); font-size:10.5px; }
          .helper-save-state::before { content:''; display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--ol-accent); margin-right:5px; vertical-align:middle; }
          .helper-resize { position:absolute; inset:54px auto 28px 0; width:9px; min-height:0; padding:0; border:0; border-radius:0;
            background:transparent; cursor:ew-resize; touch-action:none; }
          .helper-resize::after { content:''; display:block; width:2px; height:32px; border-radius:2px; background:var(--ol-border-strong); margin:auto; }
          .helper-resize:hover:not(:disabled), .helper-resize:focus-visible { background:#7de2c21a; outline-offset:-2px; }
          .helper-resize:hover::after, .helper-resize:focus-visible::after { background:var(--ol-accent); }
          .sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
          @container helper (min-width:350px) {
            .fleet-row { grid-template-columns:24px 16px minmax(0,1fr) 70px 64px; }
            .fleet-row > .priority-actions { grid-column:5; grid-row:1; }
            .fleet-counts { grid-column:3 / -1; }
          }
          @media (max-width:350px) { .helper-header { padding:10px; gap:5px; } .helper-grip { display:none; }
            .settings-tabs { margin-left:10px; margin-right:10px; } .helper-scroll { padding-left:10px; padding-right:10px; }
            .priority-row { grid-template-columns:20px 13px minmax(0,1fr) 64px; gap:4px; padding-left:4px; padding-right:4px; }
            .fleet-row { grid-template-columns:20px 13px minmax(0,1fr) 68px; padding-left:4px; padding-right:4px; gap:4px; }
            .fleet-row > input { width:68px; } .helper-footer { font-size:10px; } }
          @media (prefers-reduced-motion:reduce) { button { transition:none; } }
        </style>
        <section class="helper-shell" aria-label="Old Light Helper">
          <header class="helper-header" title="Arrastra la cabecera para mover el helper">
            <div class="helper-title"><span class="helper-grip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.3"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-40 12 12)" stroke="currentColor" stroke-width="1.2"/><circle cx="19.3" cy="6" r="1.5" fill="currentColor"/></svg></span><div class="helper-title-copy"><div class="helper-title-line"><strong>Old Light</strong><span class="helper-version" data-field="script-version" title="Versión del helper">v${SCRIPT_VERSION}</span></div><span class="helper-eta-compact" data-field="upgrade-eta-compact"></span></div></div>
            <button type="button" data-action="automation-toggle" aria-pressed="true"></button>
            <button type="button" class="helper-minimize" data-action="helper-minimize" aria-expanded="true" aria-label="Minimizar helper" title="Minimizar helper">−</button>
          </header>
          <nav class="settings-tabs" role="tablist" aria-label="Ajustes del helper">
            <button type="button" role="tab" id="oldlight-tab-buildings" data-settings-tab="buildings" aria-controls="oldlight-settings-buildings" aria-selected="true">Edificios</button>
            <button type="button" role="tab" id="oldlight-tab-fleet" data-settings-tab="fleet" aria-controls="oldlight-settings-fleet" aria-selected="false" tabindex="-1">Flota</button>
            <button type="button" role="tab" id="oldlight-tab-notifications" data-settings-tab="notifications" aria-controls="oldlight-settings-notifications" aria-selected="false" tabindex="-1">Avisos</button>
            <button type="button" role="tab" id="oldlight-tab-data" data-settings-tab="data" aria-controls="oldlight-settings-data" aria-selected="false" tabindex="-1">Datos</button>
          </nav>
          <div class="helper-scroll">
            <div class="upgrade-eta" data-field="upgrade-eta" aria-label="Tiempo hasta el siguiente pedido automático de flota o mejora">
              <div class="upgrade-eta-heading"><span>Siguiente acción</span><strong class="upgrade-eta-time" data-field="upgrade-eta-time"></strong></div>
              <div class="upgrade-eta-target" data-field="upgrade-eta-target"></div>
              <small class="upgrade-eta-detail" data-field="upgrade-eta-detail"></small>
            </div>
            <p class="helper-alert" role="alert" hidden></p>
            <details class="settings-page building-page" data-page="buildings" id="oldlight-settings-buildings" role="tabpanel" aria-labelledby="oldlight-tab-buildings" open><summary>Edificios</summary>
              <div class="page-heading"><h3>Prioridades de mejora</h3><span class="count-badge" data-field="building-count"></span></div>
              <p class="page-intro">Se mejora el primer edificio disponible que tengas marcado.</p>
              <div class="choices" role="list" aria-label="Prioridad de edificios"></div>
              <div class="priority-tools"><span class="hint">Arrastra ⠿ o usa las flechas</span><button type="button" class="reset-order">Restablecer orden</button></div>
              <details class="conditions-details" open><summary>Reactor y almacenamiento</summary>
                <p class="hint">Reactor solo cuando otra mejora marcada necesita energía. Cada Reactor o Depot espera al anterior en cola.</p>
                <label class="depot-threshold">Mejorar Depot desde <input type="text" inputmode="numeric" maxlength="32" data-setting="depot-fill-percent" aria-label="Porcentaje de capacidad para mejorar Resource Depot" aria-describedby="depot-numeric-status">% de capacidad</label>
                <small class="numeric-autosave" id="depot-numeric-status" data-numeric-status="depot" aria-live="polite"></small>
              </details>
              <div data-field="level-targets"></div>
            </details>
            <details class="settings-page fleet-details" data-page="fleet" id="oldlight-settings-fleet" role="tabpanel" aria-labelledby="oldlight-tab-fleet" open hidden><summary>Flota</summary>
              <div class="page-heading"><h3>Flota mínima</h3><span class="count-badge">Prioridad sobre edificios</span></div>
              <p class="page-intro">Ordena las naves e indica cuántas mantener. 0 desactiva su reposición.</p>
              <div class="fleet-choices" role="list" aria-label="Mínimos y prioridad de naves"></div>
              <label class="count-away"><input type="checkbox">Contar también las naves en misión</label>
              <div class="priority-tools"><span class="hint">Se descuenta la producción en cola</span><button type="button" class="reset-ships">Restablecer orden</button></div>
              <div data-field="attack-retry"></div>
              <div data-field="fleet-wait"></div>
              <div class="fleet-shortcut"><label><input type="checkbox" data-setting="shift-preset-shortcut"><span><kbd>Shift</kbd> + clic para mostrar presets</span></label>
                <p class="hint">Selecciona un preset junto al sector para enviarlo. Si faltan naves, puedes esperar o producirlas.</p>
              </div>
            </details>
            <div class="settings-page" data-page="notifications" id="oldlight-settings-notifications" role="tabpanel" aria-labelledby="oldlight-tab-notifications" hidden></div>
            <div class="settings-page" data-page="data" id="oldlight-settings-data" role="tabpanel" aria-labelledby="oldlight-tab-data" hidden>
              <div class="backup-card"><h3>Copias de seguridad</h3>
                <p class="page-intro">Los cambios se guardan automáticamente en este navegador.</p>
                <div class="backup-actions"><button type="button" data-action="export-settings">Exportar todo</button><button type="button" data-action="choose-import-settings">Importar copia</button></div>
                <input type="file" data-action="import-settings" accept=".json,application/json" hidden>
                <p class="backup-warning">La copia incluye tus credenciales de Telegram. Importar sustituye la configuración actual.</p>
                <p class="backup-status" data-field="backup-status" role="status" aria-live="polite"></p>
              </div>
              <div data-field="drive-backup"></div>
              <div class="backup-card"><h3>Ventana del helper</h3>
                <label class="panel-width-label" for="helper-panel-width">Ancho <output data-field="panel-width-value">360 px</output></label>
                <input id="helper-panel-width" class="panel-width-input" data-setting="panel-width" type="range" min="300" max="560" step="1" value="360" aria-label="Ancho del helper en píxeles">
                <button type="button" class="panel-reset" data-action="helper-reset-window">Restablecer tamaño y posición</button>
                <p class="hint">Arrastra la cabecera para moverlo y el borde izquierdo para ajustar el ancho.</p>
              </div>
            </div>
            <details class="helper-activity" data-ui-section="automationDetails"><summary>Actividad del helper</summary><p class="helper-status" role="status"></p><small class="helper-last"></small></details>
          </div>
          <footer class="helper-footer"><span class="helper-save-state">Autoguardado local</span><span>Arrastra para mover</span></footer>
          <button type="button" class="helper-resize" data-action="helper-resize" role="separator" aria-orientation="vertical" aria-label="Ajustar ancho del helper" aria-valuemin="300" aria-valuemax="560" aria-valuenow="360" title="Arrastra hacia la izquierda para ampliar. Usa las flechas para ajustar; doble clic para restablecer."></button>
          <span class="sr-only" data-field="reorder-status" role="status" aria-live="polite"></span>
        </section>`;
      ui = {
        section: shadow.querySelector('section'),
        header: shadow.querySelector('header'),
        minimize: shadow.querySelector('[data-action="helper-minimize"]'),
        toggle: shadow.querySelector('[data-action="automation-toggle"]'),
        status: shadow.querySelector('.helper-status'),
        last: shadow.querySelector('.helper-last'),
        alert: shadow.querySelector('.helper-alert'),
        scroll: shadow.querySelector('.helper-scroll'),
        resize: shadow.querySelector('[data-action="helper-resize"]'),
        panelWidth: shadow.querySelector('[data-setting="panel-width"]'),
        panelWidthValue: shadow.querySelector('[data-field="panel-width-value"]'),
        resetWindow: shadow.querySelector('[data-action="helper-reset-window"]'),
        buildingCount: shadow.querySelector('[data-field="building-count"]'),
        reorderStatus: shadow.querySelector('[data-field="reorder-status"]'),
        pageScroll: new Map(),
        eta: shadow.querySelector('[data-field="upgrade-eta"]'),
        etaTime: shadow.querySelector('[data-field="upgrade-eta-time"]'),
        etaTarget: shadow.querySelector('[data-field="upgrade-eta-target"]'),
        etaDetail: shadow.querySelector('[data-field="upgrade-eta-detail"]'),
        etaCompact: shadow.querySelector('[data-field="upgrade-eta-compact"]'),
        details: shadow.querySelector('.building-page'),
        tabs: [...shadow.querySelectorAll('[data-settings-tab]')],
        pages: [...shadow.querySelectorAll('[data-page]')],
        notificationContainer: shadow.querySelector('[data-page="notifications"]'),
        levelTargetContainer: shadow.querySelector('[data-field="level-targets"]'),
        conditionsDetails: shadow.querySelector('.conditions-details'),
        backupStatus: shadow.querySelector('[data-field="backup-status"]'),
        exportSettings: shadow.querySelector('[data-action="export-settings"]'),
        importSettings: shadow.querySelector('[data-action="import-settings"]'),
        chooseImport: shadow.querySelector('[data-action="choose-import-settings"]'),
        driveContainer: shadow.querySelector('[data-field="drive-backup"]'),
        choices: shadow.querySelector('.choices'),
        resetOrder: shadow.querySelector('.reset-order'),
        depotThreshold: shadow.querySelector('[data-setting="depot-fill-percent"]'),
        depotStatus: shadow.querySelector('[data-numeric-status="depot"]'),
        items: new Map(),
        fleetDetails: shadow.querySelector('.fleet-details'),
        fleetChoices: shadow.querySelector('.fleet-choices'),
        attackRetryContainer: shadow.querySelector('[data-field="attack-retry"]'),
        fleetWaitContainer: shadow.querySelector('[data-field="fleet-wait"]'),
        countAway: shadow.querySelector('.count-away input'),
        shiftPresetShortcut: shadow.querySelector('[data-setting="shift-preset-shortcut"]'),
        resetShips: shadow.querySelector('.reset-ships'),
        shipItems: new Map(),
      };
      for (const [id, name] of BUILDINGS) {
        const item = document.createElement('div');
        item.className = 'priority-row';
        item.dataset.buildingId = id;
        item.setAttribute('role', 'listitem');
        const drag = document.createElement('button');
        drag.type = 'button';
        drag.className = 'priority-drag';
        drag.dataset.action = 'priority-drag';
        drag.textContent = '⠿';
        drag.title = `Arrastrar prioridad de ${name}`;
        drag.setAttribute('aria-label', drag.title);
        const position = document.createElement('span');
        position.className = 'priority-position';
        position.setAttribute('aria-hidden', 'true');
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = id;
        const copy = document.createElement('span');
        copy.className = 'building-copy';
        const buildingName = document.createElement('span');
        buildingName.className = 'building-name';
        buildingName.textContent = name;
        const meta = document.createElement('span');
        meta.className = 'building-meta';
        meta.id = `building-meta-${id}`;
        input.setAttribute('aria-label', name);
        input.setAttribute('aria-describedby', meta.id);
        copy.append(buildingName, meta);
        label.append(input, copy);
        installPriorityKeys(drag, id);
        const actions = document.createElement('div');
        actions.className = 'priority-actions';
        const up = document.createElement('button');
        const down = document.createElement('button');
        for (const [button, delta, symbol, action] of [
          [up, -1, '↑', 'Subir'], [down, 1, '↓', 'Bajar'],
        ]) {
          button.type = 'button';
          button.textContent = symbol;
          button.dataset.action = delta < 0 ? 'priority-up' : 'priority-down';
          button.title = `${action} prioridad de ${name}`;
          button.setAttribute('aria-label', button.title);
          button.addEventListener('click', () => movePriority(id, delta));
          actions.append(button);
        }
        item.append(drag, position, label, actions);
        ui.choices.append(item);
        ui.items.set(id, { item, position, input, up, down, drag, name, meta });
        input.addEventListener('change', () => {
          settings.excluded = BUILDINGS.map(([key]) => key).filter(key =>
            ![...ui.choices.querySelectorAll('input')].some(item => item.value === key && item.checked));
          saveSettings();
          emitEvent('settings.buildings', `${name}: mejora automática ${input.checked ? 'activada' : 'desactivada'}.`);
          schedule();
        });
      }
      for (const [id, name] of SHIPS) {
        const item = document.createElement('div');
        item.className = 'fleet-row';
        item.dataset.shipId = id;
        item.setAttribute('role', 'listitem');
        const drag = document.createElement('button');
        drag.type = 'button';
        drag.className = 'priority-drag';
        drag.dataset.action = 'ship-drag';
        drag.textContent = '⠿';
        drag.title = `Arrastrar prioridad de ${name}`;
        drag.setAttribute('aria-label', drag.title);
        installPriorityKeys(drag, id, true);
        const position = document.createElement('span');
        position.className = 'priority-position';
        position.setAttribute('aria-hidden', 'true');
        const label = document.createElement('label');
        label.textContent = name;
        label.htmlFor = `minimum-${id}`;
        const input = document.createElement('input');
        input.id = `minimum-${id}`;
        input.type = 'number';
        input.min = '0';
        input.max = String(MAX_SHIP_MINIMUM);
        input.step = '1';
        input.inputMode = 'numeric';
        input.setAttribute('aria-label', `Mínimo de ${name}`);
        const actions = document.createElement('div');
        actions.className = 'priority-actions';
        const up = document.createElement('button');
        const down = document.createElement('button');
        for (const [button, delta, symbol, action] of [
          [up, -1, '↑', 'Subir'], [down, 1, '↓', 'Bajar'],
        ]) {
          button.type = 'button';
          button.textContent = symbol;
          button.dataset.action = delta < 0 ? 'ship-up' : 'ship-down';
          button.title = `${action} prioridad de ${name}`;
          button.setAttribute('aria-label', button.title);
          button.addEventListener('click', () => movePriority(id, delta, true));
          actions.append(button);
        }
        const counts = document.createElement('span');
        counts.className = 'fleet-counts';
        const countValues = new Map();
        for (const [kind, caption] of [['parked', 'base'], ['away', 'misión'], ['building', 'cola']]) {
          const stat = document.createElement('span');
          stat.className = 'fleet-stat';
          stat.dataset.countKind = kind;
          const value = document.createElement('b');
          value.textContent = '—';
          stat.append(value, document.createTextNode(caption));
          counts.append(stat);
          countValues.set(kind, value);
        }
        const status = document.createElement('small');
        status.className = 'numeric-autosave';
        status.dataset.numericStatus = id;
        status.id = `minimum-${id}-status`;
        status.setAttribute('aria-live', 'polite');
        input.setAttribute('aria-describedby', status.id);
        item.append(drag, position, label, input, actions, counts, status);
        ui.fleetChoices.append(item);
        ui.shipItems.set(id, { item, position, input, up, down, counts, countValues, drag });
        installNumericInput(id, input, status);
      }
      ui.countAway.addEventListener('change', () => {
        settings.countAway = ui.countAway.checked;
        saveSettings();
        emitEvent('settings.fleet_mode', settings.countAway
          ? 'Los mínimos cuentan naves en base y en misión.' : 'Los mínimos cuentan las naves en base.');
        schedule();
      });
      ui.shiftPresetShortcut.addEventListener('change', () => {
        settings.shiftPresetShortcut = ui.shiftPresetShortcut.checked;
        shiftPresets.cancel();
        saveSettings();
        schedule();
      });
      ui.resetShips.addEventListener('click', () => {
        settings.shipOrder = [...DEFAULT_SHIP_ORDER];
        saveSettings();
        emitEvent('settings.priority', 'Prioridad de naves restablecida.');
        syncFleetChoices();
        schedule();
      });
      ui.resetOrder.addEventListener('click', () => {
        settings.order = [...DEFAULT_ORDER];
        saveSettings();
        emitEvent('settings.priority', 'Prioridad de edificios restablecida.');
        syncChoices();
        schedule();
      });
      installNumericInput('depot', ui.depotThreshold, ui.depotStatus);
      ui.toggle.addEventListener('click', () => {
        settings.enabled = !settings.enabled;
        if (settings.enabled) { error = ''; unconfirmed = 0; }
        saveSettings();
        emitEvent('settings.automation',
          settings.enabled ? 'Mejoras y reposición reanudadas.' : 'Mejoras y reposición pausadas.');
        schedule();
      });
      ui.minimize.addEventListener('click', () => {
        ui.cancelPriorityDrag?.();
        ui.cancelPanelDrag?.();
        ui.cancelResize?.();
        settings.minimized = !settings.minimized;
        layoutHelper();
        saveSettings();
        schedule();
      });
      installHelperDragging();
      installHelperResizing();
      installPriorityDragging();
      installLocalBackups();
      ui.conditionsDetails.addEventListener('toggle', () => {
        if (settings.conditionsExpanded === ui.conditionsDetails.open) return;
        settings.conditionsExpanded = ui.conditionsDetails.open;
        saveSettings();
      });
      if (typeof ResizeObserver === 'function') new ResizeObserver(layoutHelper).observe(ui.section);
      for (const [index, tab] of ui.tabs.entries()) {
        const select = () => {
          ui.cancelPriorityDrag?.();
          ui.cancelResize?.();
          ui.pageScroll.set(settings.activeTab, ui.scroll.scrollTop);
          settings.activeTab = tab.dataset.settingsTab;
          syncSettingsTabs();
          ui.scroll.scrollTop = ui.pageScroll.get(settings.activeTab) || 0;
          layoutHelper();
          saveSettings();
        };
        tab.addEventListener('click', select);
        tab.addEventListener('keydown', event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % ui.tabs.length
            : event.key === 'ArrowLeft' ? (index + ui.tabs.length - 1) % ui.tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? ui.tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          ui.tabs[next].click();
          ui.tabs[next].focus();
        });
      }
      notifier.mount(ui.notificationContainer);
      levelTargets.mount(ui.levelTargetContainer);
      attackRetry.mount(ui.attackRetryContainer);
      fleetWait.mount(ui.fleetWaitContainer);
      if (driveBackup) driveBackup.mount(ui.driveContainer);
      else {
        const unavailable = document.createElement('p');
        unavailable.className = 'hint';
        unavailable.textContent = 'Google Drive requiere un gestor de userscripts con almacenamiento GM disponible.';
        ui.driveContainer.append(unavailable);
      }
      const backupHelp = document.createElement('a');
      backupHelp.className = 'backup-help';
      backupHelp.textContent = 'Ayuda sobre las copias en Google Drive';
      backupHelp.href = 'https://github.com/alexx-ftw/old-light-auto-upgrade#copias-en-google-drive';
      backupHelp.target = '_blank';
      backupHelp.rel = 'noopener noreferrer';
      ui.driveContainer.append(backupHelp);
      ui.reportsStatus = document.createElement('p');
      ui.reportsStatus.className = 'hint';
      ui.reportsStatus.dataset.field = 'reports-status';
      ui.reportsStatus.setAttribute('role', 'status');
      (ui.notificationContainer.querySelector('[data-notification-diagnostics]') || ui.notificationContainer).append(ui.reportsStatus);
      const notificationDetails = ui.notificationContainer.querySelector('.notifications-details');
      if (notificationDetails) notificationDetails.open = true;
      installPresentationPreferences(shadow);
      syncSettingsTabs();
    }
    document.body.append(host);
    layoutHelper();
  }

  function createBackup() {
    return {
      format: 'old-light-auto-upgrade-backup',
      schemaVersion: 1,
      scriptVersion: SCRIPT_VERSION,
      profile: missionContext().scope,
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(settings),
      notifications: notifier.exportConfig(),
      levelTargets: levelTargets.exportConfig(),
      fleetMissions: fleetWait.exportConfig(),
      attackRetries: attackRetry.exportConfig(),
      drive: driveBackup?.exportConfig?.() || { clientId: '', autoBackup: false },
    };
  }

  function backupError(message) {
    const cause = new Error(message);
    cause.name = 'BackupError';
    return cause;
  }

  function validateBackup(value) {
    const object = item => item && typeof item === 'object' && !Array.isArray(item);
    if (!object(value) || value.format !== 'old-light-auto-upgrade-backup' || value.schemaVersion !== 1
        || !object(value.settings) || !object(value.notifications)) {
      throw backupError('El archivo no es una copia compatible de Old Light Auto Upgrade.');
    }
    const next = value.settings;
    const list = (items, known) => Array.isArray(items) && items.length <= known.length
      && items.every(id => typeof id === 'string' && known.includes(id));
    const booleanKeys = ['enabled', 'expanded', 'minimized', 'countAway', 'fleetExpanded', 'conditionsExpanded', 'shiftPresetShortcut'];
    if (typeof next.enabled !== 'boolean' || !list(next.order, DEFAULT_ORDER) || !list(next.excluded, DEFAULT_ORDER)
        || !list(next.shipOrder, DEFAULT_SHIP_ORDER) || !object(next.shipMinimums)
        || booleanKeys.some(key => next[key] !== undefined && typeof next[key] !== 'boolean')
        || SHIPS.some(([id]) => !Number.isInteger(next.shipMinimums[id])
          || next.shipMinimums[id] < 0 || next.shipMinimums[id] > MAX_SHIP_MINIMUM)
        || !Number.isInteger(next.depotFillPercent) || next.depotFillPercent < 1 || next.depotFillPercent > 100
        || (next.numericDrafts !== undefined && !validNumericDrafts(next.numericDrafts))
        || (next.automaticMinimumReceipts !== undefined && !validAutomaticMinimumReceipts(next.automaticMinimumReceipts))
        || (next.presetCatalog !== undefined && !validPresetCatalog(next.presetCatalog))
        || (next.panelPosition != null && !normalizePanelPosition(next.panelPosition))
        || (next.panelWidth !== undefined && (!Number.isInteger(next.panelWidth)
          || next.panelWidth < PANEL_WIDTH.min || next.panelWidth > PANEL_WIDTH.max))
        || (next.uiSections !== undefined && !validUISections(next.uiSections))
        || (next.activeTab !== undefined && !['buildings', 'fleet', 'notifications', 'data'].includes(next.activeTab))) {
      throw backupError('La copia contiene ajustes del helper inválidos.');
    }
    let notifications;
    let drive;
    try { notifications = notifier.validateConfig(value.notifications); }
    catch { throw backupError('La copia contiene ajustes de notificaciones inválidos.'); }
    try {
      if (driveBackup) drive = driveBackup.validateConfig(value.drive || { clientId: '', autoBackup: false });
      else {
        if (value.drive?.clientId || value.drive?.autoBackup) throw new Error('Drive no disponible');
        drive = { clientId: '', autoBackup: false };
      }
    } catch { throw backupError('La copia contiene una configuración de Drive incompatible.'); }
    let targets;
    try { targets = levelTargets.validateConfig(value.levelTargets === undefined ? {} : value.levelTargets); }
    catch { throw backupError('La copia contiene objetivos de nivel inválidos.'); }
    let missions;
    try { missions = fleetWait.validateConfig(value.fleetMissions === undefined ? {} : value.fleetMissions); }
    catch { throw backupError('La copia contiene misiones pendientes inválidas.'); }
    let retries;
    try { retries = attackRetry.validateConfig(value.attackRetries === undefined ? {} : value.attackRetries); }
    catch { throw backupError('La copia contiene reintentos de ataques inválidos.'); }
    return { settings: normalizeSettings(next), notifications, drive, levelTargets: targets, fleetMissions: missions, attackRetries: retries };
  }

  function applyBackup(value) {
    if (missionAdapter.isBusy() || attackRetry.isBusy()) throw backupError('Espera a que termine la preparación o el intento de envío antes de importar una copia.');
    const next = validateBackup(value);
    shiftPresets.cancel();
    cancelNumericDraftTimers();
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    ui?.cancelResize?.();
    const previous = { settings, raw: localStorage.getItem(KEY), notifications: notifier.exportConfig(),
      drive: driveBackup?.exportConfig?.(), levelTargets: levelTargets.exportConfig(), fleetMissionsCheckpoint: fleetWait.backupCheckpoint(),
      attackRetriesCheckpoint: attackRetry.backupCheckpoint() };
    importingBackup = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(next.settings));
      notifier.importConfig(next.notifications);
      levelTargets.importConfig(next.levelTargets);
      if (driveBackup) driveBackup.importConfig(next.drive);
      fleetWait.importConfig(next.fleetMissions);
      attackRetry.importConfig(next.attackRetries);
      settings = next.settings;
      restoreNumericInputs();
      if (settings.enabled) { error = ''; unconfirmed = 0; }
      syncSettingsTabs();
      layoutHelper();
    } catch {
      let restored = true;
      try {
        if (previous.raw === null) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, previous.raw);
      } catch { restored = false; }
      try { notifier.importConfig(previous.notifications); } catch { restored = false; }
      try { levelTargets.importConfig(previous.levelTargets); } catch { restored = false; }
      try { if (driveBackup && previous.drive) driveBackup.importConfig(previous.drive); } catch { restored = false; }
      try { fleetWait.restoreCheckpoint(previous.fleetMissionsCheckpoint); } catch { restored = false; }
      try { attackRetry.restoreCheckpoint(previous.attackRetriesCheckpoint); } catch { restored = false; }
      settings = previous.settings;
      restoreNumericInputs();
      syncSettingsTabs();
      layoutHelper();
      if (!restored) {
        settings.enabled = false;
        error = 'La importación no pudo restaurar todos los ajustes. Revisa la configuración.';
      }
      throw backupError(restored
        ? 'No se pudo guardar la copia. Se han conservado los ajustes anteriores.'
        : 'La importación falló y no pudo restaurar todos los ajustes. Automatización pausada.');
    } finally {
      importingBackup = false;
      attackRetry.cleanupCancelledJobs();
      schedule();
    }
    settingsChanged();
    return true;
  }

  // BEGIN SHARED PREFERENCES INTEGRATION
  function applySyncedPreferences(value) {
    const editor = host?.shadowRoot?.activeElement;
    if (missionAdapter.isBusy() || attackRetry.isBusy() ||
        (editor?.matches('input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable="true"]')
          && Date.now() - lastPreferenceEditAt < 1500) || host?.shadowRoot?.querySelector('.is-sorting')) {
      const cause = new Error('La sincronización espera a que termine la edición o el envío actual.');
      cause.code = 'busy'; throw cause;
    }
    const next = validateBackup(value);
    const previous = { settings, raw: localStorage.getItem(KEY), notifications: notifier.exportConfig(),
      targets: levelTargets.exportConfig(), retries: attackRetry.backupCheckpoint(), missions: fleetWait.backupCheckpoint() };
    importingBackup = true;
    try {
      if (JSON.stringify(settings) !== JSON.stringify(next.settings)) {
        localStorage.setItem(KEY, JSON.stringify(next.settings));
        settings = next.settings;
        cancelNumericDraftTimers();
        restoreNumericInputs();
      }
      if (JSON.stringify(previous.notifications) !== JSON.stringify(next.notifications)) notifier.importConfig(next.notifications);
      if (JSON.stringify(previous.targets) !== JSON.stringify(next.levelTargets)) levelTargets.importConfig(next.levelTargets);
      attackRetry.importPreferences(next.attackRetries);
      if (settings.enabled && !previous.settings.enabled) { error = ''; unconfirmed = 0; }
      syncSettingsTabs();
    } catch (caught) {
      let restored = true;
      try { if (previous.raw === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, previous.raw); } catch { restored = false; }
      try { notifier.importConfig(previous.notifications); } catch { restored = false; }
      try { levelTargets.importConfig(previous.targets); } catch { restored = false; }
      try { fleetWait.restoreCheckpoint(previous.missions); } catch { restored = false; }
      try { attackRetry.restoreCheckpoint(previous.retries); } catch { restored = false; }
      settings = previous.settings;
      if (!restored) { settings.enabled = false; error = 'Falló la recuperación de ajustes. Automatización pausada.'; }
      restoreNumericInputs();
      const cause = new Error('No se pudieron guardar los ajustes sincronizados. Se reintentará.');
      cause.code = 'storage_error'; throw cause;
    } finally {
      importingBackup = false;
      schedule();
    }
  }

  function createPreferenceSync(options) {
    const core = globalThis.OldLightSyncCore;
    const { getBackup, applyPreferences, getScope, getClientId, gmGetValue: read, gmSetValue: write } = options;
    const PREFIX = 'old-light-preferences-sync:v1:';
    const ACCOUNT = /^(?:id:[A-Za-z0-9_-]{1,200}|email:[^\s]{1,254})$/;
    const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
    let observing = false;
    const actor = crypto.randomUUID(); // Unique writer even across simultaneous tabs/cloned profiles.
    function fail(code) { const cause = new Error(code); cause.code = code; throw cause; }
    function scopeNow() { const scope = getScope(); if (!SCOPE.test(scope || '')) fail('busy'); return scope; }
    function keyFor(scope, account, client) { return PREFIX + JSON.stringify([scope, client, account]); }
    function activeFor(scope) {
      const active = read(PREFIX + 'active', null);
      return active?.scope === scope && active.client === getClientId() && ACCOUNT.test(active.account || '') ? active : null;
    }
    function load(key, scope, fallback = null) {
      const state = read(key, fallback);
      if (state && typeof state.then === 'function') fail('storage_error');
      return core.create({ state, scope, actor });
    }
    function save(key, engine) {
      const result = write(key, engine.state());
      if (result && typeof result.then === 'function') fail('storage_error');
    }
    function observe() {
      if (observing) return false;
      observing = true;
      try {
        const scope = scopeNow();
        const active = activeFor(scope);
        const key = active ? keyFor(scope, active.account, active.client) : keyFor(scope, '', '');
        const engine = load(key, scope);
        const before = core.canonical(engine.state());
        engine.capture(core.project(getBackup()));
        const changed = core.canonical(engine.state()) !== before;
        if (changed) save(key, engine);
        return changed;
      } finally { observing = false; }
    }
    function open(account) {
      if (!ACCOUNT.test(account || '')) fail('sync_account');
      observe();
      const scope = scopeNow(), client = getClientId();
      const key = keyFor(scope, account, client);
      const saved = read(key, null);
      const fallback = !read(PREFIX + 'active', null) ? read(keyFor(scope, '', ''), null) : null;
      const engine = load(key, scope, saved || fallback);
      engine.capture(core.project(getBackup()));
      save(key, engine);
      write(PREFIX + 'active', { scope, client, account });
      return { engine, key, scope };
    }
    function get(account) { return { document: open(account).engine.document() }; }
    function merge({ account, scope, documents, legacy }) {
      const current = open(account);
      if (scope !== current.scope || !Array.isArray(documents) || documents.length > 1000) fail('invalid_sync');
      const engine = current.engine;
      if (!documents.length && legacy) {
        if (legacy.backup?.profile && legacy.backup.profile !== scope) fail('invalid_sync');
        const legacySafe = validateBackup(legacy.backup);
        const seed = core.create({ scope, actor: '00000000-0000-4000-8000-000000000001',
          now: () => Math.max(1, Math.min(Date.now(), Date.parse(legacy.createdAt) || 1)) });
        seed.capture(core.project(legacySafe)); seed.promoteSeeds();
        documents = [seed.document()];
      }
      engine.merge(documents);
      save(current.key, engine);
      const backup = getBackup();
      const next = core.overlay(backup, engine.values());
      const changed = core.canonical(core.project(backup)) !== core.canonical(core.project(next));
      if (changed) applyPreferences(next);
      engine.accept(core.project(getBackup()));
      engine.promoteSeeds();
      save(current.key, engine);
      return { document: engine.document(), changed };
    }
    return { observe, get, merge };
  }
  // END SHARED PREFERENCES INTEGRATION

  function installLocalBackups() {
    ui.exportSettings.addEventListener('click', event => {
      if (!event.isTrusted) return;
      try {
        const blob = new Blob([JSON.stringify(createBackup(), null, 2) + '\n'], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'old-light-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setText(ui.backupStatus, 'Copia exportada. Incluye toda la configuración guardada.');
      } catch { setText(ui.backupStatus, 'No se pudo exportar la configuración.'); }
    });
    ui.chooseImport.addEventListener('click', event => {
      if (event.isTrusted) ui.importSettings.click();
    });
    ui.importSettings.addEventListener('change', async () => {
      const file = ui.importSettings.files?.[0];
      if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw backupError('La copia supera el tamaño máximo de 1 MiB.');
        let value;
        try { value = JSON.parse(await file.text()); }
        catch { throw backupError('El archivo no contiene JSON válido.'); }
        applyBackup(value);
        setText(ui.backupStatus, 'Copia importada. Preferencias y credenciales restauradas.');
      } catch (cause) {
        setText(ui.backupStatus, cause?.name === 'BackupError' ? cause.message : 'No se pudo importar la copia.');
      } finally { ui.importSettings.value = ''; }
    });
  }

  function syncSettingsTabs() {
    if (!ui) return;
    for (const tab of ui.tabs) {
      const active = tab.dataset.settingsTab === settings.activeTab;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const page of ui.pages) {
      page.hidden = page.dataset.page !== settings.activeTab;
      if (page.tagName === 'DETAILS') page.open = true;
    }
    if (ui.conditionsDetails.open !== settings.conditionsExpanded) ui.conditionsDetails.open = settings.conditionsExpanded;
    syncPresentationSections();
  }

  function presentationFailure(message) {
    ui.presentationError = message;
    ui.alert.hidden = false;
    setText(ui.alert, error || message);
  }

  function persistPresentation(patch) {
    let latest;
    try { latest = normalizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch {
      presentationFailure('No se pudo leer la configuración. El ajuste de la ventana se conserva.');
      return false;
    }
    const previous = settings;
    settings = normalizeSettings({ ...latest, ...patch,
      uiSections: patch.uiSections ? { ...latest.uiSections, ...patch.uiSections } : latest.uiSections });
    if (!saveSettings()) {
      settings = previous;
      presentationFailure('No se pudo guardar este ajuste de la ventana. Inténtalo de nuevo.');
      return false;
    }
    ui.presentationError = '';
    syncPresentationSections();
    layoutHelper();
    return true;
  }

  function syncPresentationSections() {
    if (!ui?.presentationDefaults) return;
    const signature = JSON.stringify(settings.uiSections);
    if (ui.presentationSignature === signature) return;
    ui.presentationSignature = signature;
    for (const [node, initial] of ui.presentationDefaults) {
      const desired = settings.uiSections[node.dataset.uiSection] ?? initial;
      ui.presentationState.set(node, desired);
      if (node.open !== desired) node.open = desired;
    }
  }

  function setPanelWidth(value) {
    const width = normalizePanelWidth(value);
    const rect = ui.section.getBoundingClientRect();
    const rendered = Math.min(width, innerWidth - 24);
    const panelPosition = settings.panelPosition
      ? { x: Math.max(12, rect.right - rendered), y: rect.top } : null;
    const saved = persistPresentation({ panelWidth: width, panelPosition });
    layoutHelper();
    return saved;
  }

  function installPresentationPreferences(root) {
    const sections = [...root.querySelectorAll('details[data-ui-section]')]
      .filter(node => UI_SECTION_KEYS.includes(node.dataset.uiSection));
    ui.presentationDefaults = new Map(sections.map(node => [node, node.open]));
    ui.presentationState = new Map(ui.presentationDefaults);
    ui.presentationSignature = null;
    syncPresentationSections();
    root.addEventListener('toggle', event => {
      const node = event.target;
      if (!ui.presentationState.has(node)) return;
      const previous = ui.presentationState.get(node);
      if (previous === node.open) return;
      if (!persistPresentation({ uiSections: { [node.dataset.uiSection]: node.open } })) {
        ui.presentationState.set(node, previous);
        node.open = previous;
      }
    }, true);
    ui.panelWidth.addEventListener('input', () => setPanelWidth(Number(ui.panelWidth.value)));
    ui.resetWindow.addEventListener('click', () => {
      ui.cancelPanelDrag?.();
      ui.cancelPriorityDrag?.();
      ui.cancelResize?.();
      persistPresentation({ panelWidth: PANEL_WIDTH.default, panelPosition: null });
    });
  }

  function layoutHelper() {
    if (!ui || !host?.isConnected) return;
    const width = String(settings.panelWidth);
    if (ui.section.style.getPropertyValue('--helper-width') !== width + 'px') {
      ui.section.style.setProperty('--helper-width', width + 'px');
    }
    if (ui.panelWidth.value !== width) ui.panelWidth.value = width;
    setText(ui.panelWidthValue, width + ' px');
    ui.resize.setAttribute('aria-valuenow', width);
    ui.resize.setAttribute('aria-valuetext', width + ' píxeles');
    ui.section.classList.toggle('minimized', settings.minimized);
    setText(ui.minimize, settings.minimized ? '+' : '−');
    ui.minimize.setAttribute('aria-expanded', String(!settings.minimized));
    ui.minimize.title = settings.minimized ? 'Restaurar helper' : 'Minimizar helper';
    ui.minimize.setAttribute('aria-label', ui.minimize.title);
    const setStyle = (name, value) => {
      if (host.style.getPropertyValue(name) !== value) host.style.setProperty(name, value);
    };
    if (!settings.panelPosition) {
      for (const name of ['left', 'top', 'right', 'bottom']) {
        if (host.style.getPropertyValue(name)) host.style.removeProperty(name);
      }
      return;
    }
    const rect = ui.section.getBoundingClientRect();
    const x = Math.max(12, Math.min(settings.panelPosition.x, innerWidth - rect.width - 12));
    const y = Math.max(12, Math.min(settings.panelPosition.y, innerHeight - rect.height - 12));
    settings.panelPosition = { x: Math.round(x), y: Math.round(y) };
    setStyle('right', 'auto');
    setStyle('bottom', 'auto');
    setStyle('left', settings.panelPosition.x + 'px');
    setStyle('top', settings.panelPosition.y + 'px');
  }


  function bindPointerDrag(target, handlers) {
    let state = null;
    function finish(commit, event) {
      if (!state || (event?.pointerId !== undefined && event.pointerId !== state.pointerId)) return;
      const previous = state;
      state = null;
      try {
        if (target.hasPointerCapture(previous.pointerId)) target.releasePointerCapture(previous.pointerId);
      } catch { /* El navegador puede haber liberado el puntero al cancelar. */ }
      handlers.end(previous, commit, event);
    }
    target.addEventListener('pointerdown', event => {
      if (state || !event.isPrimary || event.button !== 0) return;
      const initial = handlers.start(event);
      if (!initial) return;
      state = { ...initial, pointerId: event.pointerId, moved: false };
      event.preventDefault();
      event.stopPropagation();
      try { target.setPointerCapture(event.pointerId); }
      catch { finish(false, event); }
    });
    target.addEventListener('pointermove', event => {
      if (!state || event.pointerId !== state.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.move(state, event);
    });
    target.addEventListener('pointerup', event => finish(true, event));
    target.addEventListener('pointercancel', event => finish(false, event));
    target.addEventListener('lostpointercapture', event => finish(false, event));
    document.addEventListener('keydown', event => {
      if (state && event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(false); });
    window.addEventListener('blur', () => finish(false));
    return () => finish(false);
  }

  function installHelperDragging() {
    ui.cancelPanelDrag = bindPointerDrag(ui.header, {
      start(event) {
        if (event.target.closest('button, input, a')) return null;
        ui.cancelPriorityDrag?.();
        ui.cancelResize?.();
        const rect = ui.section.getBoundingClientRect();
        return { startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top,
          original: settings.panelPosition ? { ...settings.panelPosition } : null };
      },
      move(state, event) {
        const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < 4) return;
        state.moved = true;
        ui.header.classList.add('is-dragging');
        settings.panelPosition = { x: state.x + dx, y: state.y + dy };
        layoutHelper();
      },
      end(state, commit) {
        ui.header.classList.remove('is-dragging');
        if (!commit) settings.panelPosition = state.original;
        layoutHelper();
        if (commit && state.moved) saveSettings();
      },
    });
  }

  function installHelperResizing() {
    ui.cancelResize = bindPointerDrag(ui.resize, {
      start(event) {
        ui.cancelPanelDrag?.();
        ui.cancelPriorityDrag?.();
        const rect = ui.section.getBoundingClientRect();
        return { startX: event.clientX, width: settings.panelWidth, right: rect.right, top: rect.top,
          position: settings.panelPosition ? { ...settings.panelPosition } : null };
      },
      move(state, event) {
        const dx = event.clientX - state.startX;
        if (!state.moved && Math.abs(dx) < 3) return;
        state.moved = true;
        settings.panelWidth = normalizePanelWidth(state.width - dx);
        settings.panelPosition = { x: state.right - Math.min(settings.panelWidth, innerWidth - 24), y: state.top };
        layoutHelper();
      },
      end(state, commit) {
        if (!commit || !state.moved || !persistPresentation({ panelWidth: settings.panelWidth, panelPosition: settings.panelPosition })) {
          settings.panelWidth = state.width;
          settings.panelPosition = state.position;
        }
        layoutHelper();
      },
    });
    ui.resize.addEventListener('keydown', event => {
      const next = event.key === 'ArrowLeft' ? settings.panelWidth - 20
        : event.key === 'ArrowRight' ? settings.panelWidth + 20
          : event.key === 'Home' ? PANEL_WIDTH.min : event.key === 'End' ? PANEL_WIDTH.max : null;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      ui.cancelResize?.();
      setPanelWidth(next);
    });
    ui.resize.addEventListener('dblclick', event => {
      event.preventDefault();
      ui.cancelResize?.();
      setPanelWidth(PANEL_WIDTH.default);
    });
  }

  function installPriorityKeys(handle, id, ship = false) {
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      movePriority(id, event.key === 'ArrowUp' ? -1 : 1, ship);
      handle.focus({ preventScroll: true });
    });
  }

  function installPriorityDragging() {
    function bindList(list, items, key, ship) {
      const clearMarkers = () => {
        list.classList.remove('is-sorting');
        for (const { item } of items.values()) item.classList.remove('is-dragging', 'drop-before', 'drop-after');
      };
      return bindPointerDrag(list, {
        start(event) {
          const handle = event.target.closest(`[data-action="${ship ? 'ship-drag' : 'priority-drag'}"]`);
          if (!handle) return null;
          ui.cancelPanelDrag?.();
          ui.cancelResize?.();
          handle.focus({ preventScroll: true });
          const id = handle.closest(ship ? '[data-ship-id]' : '[data-building-id]').dataset[ship ? 'shipId' : 'buildingId'];
          return { id, startY: event.clientY, order: [...settings[key]], index: settings[key].indexOf(id) };
        },
        move(state, event) {
          if (state.order.join() !== settings[key].join()) { ui.cancelPriorityDrag(); return; }
          if (!state.moved && Math.abs(event.clientY - state.startY) < 4) return;
          state.moved = true;
          const viewport = ui.scroll.getBoundingClientRect();
          if (event.clientY < viewport.top + 35) ui.scroll.scrollTop -= 18;
          else if (event.clientY > viewport.bottom - 30) ui.scroll.scrollTop += 18;
          const others = state.order.filter(id => id !== state.id);
          const before = others.findIndex(id => {
            const rect = items.get(id).item.getBoundingClientRect();
            return event.clientY < rect.top + rect.height / 2;
          });
          state.index = before < 0 ? others.length : before;
          clearMarkers();
          list.classList.add('is-sorting');
          items.get(state.id).item.classList.add('is-dragging');
          if (before < 0) items.get(others.at(-1)).item.classList.add('drop-after');
          else items.get(others[before]).item.classList.add('drop-before');
        },
        end(state, commit, event) {
          clearMarkers();
          const rect = list.getBoundingClientRect();
          const viewport = ui.scroll.getBoundingClientRect();
          const inside = event && event.clientX >= rect.left - 24 && event.clientX <= rect.right + 24
            && event.clientY >= viewport.top && event.clientY <= viewport.bottom;
          if (!commit || !state.moved || !inside || state.order.join() !== settings[key].join()) return;
          const order = state.order.filter(id => id !== state.id);
          order.splice(state.index, 0, state.id);
          if (order.join() === settings[key].join()) return;
          settings[key] = order;
          saveSettings();
          notifyPriorityOrder(ship);
          if (ship) syncFleetChoices(); else syncChoices();
          items.get(state.id).drag.focus({ preventScroll: true });
          announcePriority(state.id, ship);
          schedule();
        },
      });
    }
    const cancelBuildings = bindList(ui.choices, ui.items, 'order', false);
    const cancelShips = bindList(ui.fleetChoices, ui.shipItems, 'shipOrder', true);
    ui.cancelPriorityDrag = () => { cancelBuildings(); cancelShips(); };
  }

  function announcePriority(id, ship) {
    const names = ship ? SHIPS : BUILDINGS;
    const order = ship ? settings.shipOrder : settings.order;
    setText(ui.reorderStatus, `${names.find(([key]) => key === id)?.[1] || id}: prioridad ${order.indexOf(id) + 1} de ${order.length}.`);
  }

  function notifyPriorityOrder(ship = false) {
    const order = ship ? settings.shipOrder : settings.order;
    const names = ship ? SHIPS : BUILDINGS;
    emitEvent('settings.priority', 'Prioridad de ' + (ship ? 'naves' : 'edificios') + ': '
      + order.map(key => names.find(([known]) => known === key)?.[1] || key).join(' → ') + '.');
  }

  function movePriority(id, delta, ship = false) {
    const order = ship ? settings.shipOrder : settings.order;
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    saveSettings();
    const names = ship ? SHIPS : BUILDINGS;
    emitEvent('settings.priority', `Prioridad de ${ship ? 'naves' : 'edificios'}: ${order.map(key => names.find(([known]) => known === key)?.[1] || key).join(' → ')}.`);
    if (ship) syncFleetChoices(); else syncChoices();
    const controls = (ship ? ui.shipItems : ui.items).get(id);
    const movedButton = delta < 0 ? controls.up : controls.down;
    announcePriority(id, ship);
    // Mantén el foco en el elemento movido, incluso al llegar a un extremo.
    (movedButton.disabled ? (delta < 0 ? controls.down : controls.up) : movedButton)
      .focus({ preventScroll: true });
    schedule();
  }

  function syncFleetChoices() {
    if (!ui) return;
    const focused = ui.fleetChoices.getRootNode().activeElement;
    const hadFocus = focused && ui.fleetChoices.contains(focused);
    for (const [index, id] of settings.shipOrder.entries()) {
      const controls = ui.shipItems.get(id);
      const atPosition = ui.fleetChoices.children[index];
      if (atPosition !== controls.item) ui.fleetChoices.insertBefore(controls.item, atPosition || null);
      setText(controls.position, String(index + 1));
      controls.up.disabled = index === 0;
      controls.down.disabled = index === settings.shipOrder.length - 1;
      const counts = fleetCounts(id);
      for (const [kind, value] of controls.countValues) setText(value, counts ? counts[kind].toLocaleString() : '?');
      controls.counts.title = counts
        ? `${counts.parked.toLocaleString()} en base · ${counts.away.toLocaleString()} en misión · ${counts.building.toLocaleString()} en construcción`
        : 'Selecciona un solo sistema para leer la flota';
      controls.counts.setAttribute('aria-label', controls.counts.title);
      controls.item.dataset.state = ui.eta.dataset.shipId === id ? 'next' : '';
    }
    ui.countAway.checked = settings.countAway;
    ui.shiftPresetShortcut.checked = settings.shiftPresetShortcut;
    syncNumericInputs();
    ui.resetShips.disabled = settings.shipOrder.every((id, index) => id === DEFAULT_SHIP_ORDER[index]);
    if (hadFocus && focused.isConnected && !focused.disabled &&
        ui.fleetChoices.getRootNode().activeElement !== focused) focused.focus({ preventScroll: true });
  }

  function syncChoices() {
    if (!ui) return;
    const root = ui.choices.getRootNode();
    const focused = root.activeElement;
    const hadFocus = focused && ui.choices.contains(focused);
    const current = new Map(rows().map(row => [row.id, row]));
    const canRead = !!systemId() && [PANEL, FLEET_PANEL].some(selector => hudPanelAvailable(document.querySelector(selector)));
    setText(ui.buildingCount, `${BUILDINGS.length - settings.excluded.length} / ${BUILDINGS.length} activos`);
    for (const [index, id] of settings.order.entries()) {
      const controls = ui.items.get(id);
      const atPosition = ui.choices.children[index];
      // Solo mueve nodos cuando cambie el orden, sin reconstruir los controles.
      if (atPosition !== controls.item) ui.choices.insertBefore(controls.item, atPosition || null);
      setText(controls.position, String(index + 1));
      controls.input.checked = !settings.excluded.includes(id);
      const level = canRead ? /^Lvl\s+(\d+)$/i.exec(text(current.get(id)?.row.querySelector('.b-level'))) : null;
      const next = ui.eta.dataset.buildingId === id;
      const queued = canRead && queuedBuilding(id);
      controls.item.dataset.state = !controls.input.checked ? 'off' : next ? 'next' : queued ? 'queued' : '';
      const details = [level ? `Nivel ${Number(level[1])}` : 'Nivel no disponible'];
      if (!controls.input.checked) details.push('Desactivado');
      else if (queued) details.push('En cola');
      else if (next) details.push('Siguiente');
      else if (id === 'reactor') details.push('Según energía');
      else if (id === 'warehouse') details.push(`Desde ${settings.depotFillPercent}%`);
      setText(controls.meta, details.join(' · '));
      controls.up.disabled = index === 0;
      controls.down.disabled = index === settings.order.length - 1;
    }
    ui.resetOrder.disabled = settings.order.every((id, index) => id === DEFAULT_ORDER[index]);
    if (hadFocus && focused.isConnected && !focused.disabled && root.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  }

  function show(message) {
    if (!ui) return;
    setText(ui.toggle, settings.enabled ? 'Pausar' : 'Reanudar');
    ui.toggle.setAttribute('aria-pressed', String(settings.enabled));
    ui.toggle.title = settings.enabled ? 'Pausar automatización' : 'Reanudar automatización';
    ui.toggle.setAttribute('aria-label', ui.toggle.title);
    setText(ui.status, message);
    setText(ui.last, lastClick ? `Última solicitud: ${lastClick}` : '');
    const reportState = reports.getDiagnostics();
    const reportAlert = reportState.enabled && reportState.active && (reportState.lastError || reportState.storageError)
      ? reportState.status : '';
    const alert = error || ui.presentationError || reportAlert;
    ui.alert.hidden = !alert;
    setText(ui.alert, alert);
    renderUpgradeEta();
    syncSettingsTabs();
    layoutHelper();
    syncChoices();
    syncFleetChoices();
  }

  // Solo una pestaña controla los clics por origen cuando Web Locks está disponible.
  // La pestaña de reserva toma el relevo al cerrar la que tiene el control.
  function acquireLeadership() {
    if (leader || requestingLock || lockError) return;
    if (!navigator.locks?.request) { leader = true; return; }
    requestingLock = true;
    navigator.locks.request(KEY, { ifAvailable: true }, async lock => {
      if (!lock) return;
      leader = true;
      const lifetime = new Promise(resolve => { releaseLock = resolve; });
      schedule();
      await lifetime;
      releaseLock = null;
      leader = false;
    }).catch(() => {
      lockError = true;
      show('El navegador no permite coordinar pestañas. Recarga para reintentar.');
    }).finally(() => { requestingLock = false; });
  }

  function releaseLeadership() {
    if (pending || observingNotifications || missionAdapter?.isBusy() || attackRetry?.isBusy()) return;
    if (releaseLock) releaseLock();
    else leader = false;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // No depende de requestAnimationFrame para comprobar respuestas y plazos.
    queueMicrotask(() => { scheduled = false; step(); });
  }

  function wakeAt(time) {
    if (wakeTimer !== null && wakeDue <= time) return;
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeDue = time;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      wakeDue = 0;
      schedule();
    }, Math.max(0, time - Date.now()));
  }

  function step() {
    const panel = document.querySelector(PANEL);
    const fleetPanel = document.querySelector(FLEET_PANEL);
    if ((!panel && !fleetPanel) || !document.body) {
      observingNotifications = false;
      reports.tick({ active: false, enabled: notifier.isEventEnabled('game.reports') || attackRetry.isObservingReports() });
      observeGameEvents([], false);
      // Si la página desmonta el panel durante una petición, conserva el bloqueo
      // hasta que se agote su plazo para no enviar otro clic desde otra pestaña.
      if (pending && Date.now() - pending.started >= RESPONSE_TIMEOUT_MS) {
        if (pending.kind === 'ship') {
          settings.enabled = false;
          error = `Sin confirmación de ${pending.name}. Comprueba la cola y reanuda.`;
          saveSettings();
          emitEvent('automation.paused', error, `timeout:${pending.operation}`, pending.systemName);
        }
        pending = null;
      }
      releaseLeadership();
      if (host && !host.hidden) host.hidden = true;
      return;
    }
    mount();
    if (host.hidden) host.hidden = false;
    const current = rows();
    const ships = shipRows();
    const now = Date.now();
    const observeNotifications = notifier.isEnabled() && !document.hidden &&
      (hudPanelAvailable(panel) || hudPanelAvailable(fleetPanel));
    const watchAttacks = attackRetry.isObservingReports();
    const visibleHud = !document.hidden && (hudPanelAvailable(panel) || hudPanelAvailable(fleetPanel));
    observingNotifications = visibleHud && (observeNotifications || watchAttacks);
    if (observeNotifications || (watchAttacks && visibleHud)) acquireLeadership();
    const reportsState = reports.tick({ active: leader && visibleHud && (observeNotifications || watchAttacks),
      enabled: notifier.isEventEnabled('game.reports') || watchAttacks, unread: readUnread('reports') });
    setText(ui.reportsStatus, reportsState.status);
    observeGameEvents(current, leader && observeNotifications, reportsState.apiAvailable);

    // Updating a saved minimum is independent of permission to build or send.
    // Finish recovery first so an older defeat cannot replace the latest one.
    if (leader && visibleHud && !importingBackup && !reports.isRecovering()) {
      try { attackRetry.flushMinimums(); }
      catch (_) { wakeAt(Date.now() + RETRY_GAP_MS); }
    }

    if (pending) {
      const requestSystemName = pending.systemName;
      const ship = pending.kind === 'ship';
      const row = (ship ? ships : current).find(item => item.id === pending.id);
      const sameSystem = !pending.system || pending.system === systemId();
      const loading = !row || row.button.classList.contains('b-loading') ||
        pending.button.classList.contains('b-loading');
      const failed = ship && sameSystem && (row?.button.classList.contains('b-upgrade-error') ||
        pending.button.classList.contains('b-upgrade-error'));
      const counts = ship && sameSystem ? fleetCounts(pending.id) : null;
      const applied = ship || loading || !sameSystem ? null : batchApplied(pending);
      const targetAdvanced = !ship && row?.targetLevel !== null && pending.targetLevel !== null &&
        row?.targetLevel > pending.targetLevel;
      // Terminar una nave anterior mueve building -> parked sin aumentar el total.
      // Build habilitado o una cola nueva por sí solos no autorizan otro pedido:
      // esperamos también el delta de flota para no repetir sobre cifras antiguas.
      const confirmed = ship ? counts && shipConfirmed(pending, counts)
        : applied > 0 || (applied === null && (targetAdvanced || queueLength() > pending.queueLength));
      if (sameSystem && !loading && !failed && confirmed) {
        const message = ship ? `Pedido confirmado: ${shipAcceptedQuantity(pending)} ${pending.name} en construcción.`
          : `Mejora confirmada en cola: ${pending.name} · ${pending.target}.`;
        emitEvent(ship ? 'ships.queued' : 'building.queued', message, `confirmed:${pending.operation}`, requestSystemName);
        pending = null;
        unconfirmed = 0;
        nextClickAt = Math.max(nextClickAt, now + MIN_GAP_MS);
      } else if (failed) {
        const name = pending.name;
        emitEvent('request.failed', `El juego rechazó el pedido de ${name}. ${pending.button.getAttribute('title') || ''}`,
          `failed:${pending.operation}`, requestSystemName);
        pending = null;
        unconfirmed += 1;
        nextClickAt = now + RETRY_GAP_MS;
        if (unconfirmed >= MAX_UNCONFIRMED) {
          settings.enabled = false;
          error = `El juego rechazó el pedido de ${name}. Comprueba el astillero y reanuda.`;
          saveSettings();
          emitEvent('automation.paused', error, undefined, requestSystemName);
        }
      } else if (applied === 0) {
        // Una respuesta de lote sin mejoras no es una confirmación de éxito.
        // Da tiempo a actualizar recursos/colas y sigue esperando disponibilidad.
        emitEvent('request.rejected', `Ningún sistema aceptó la mejora de ${pending.name}.`, `rejected:${pending.operation}`, requestSystemName);
        pending = null;
        nextClickAt = now + RETRY_GAP_MS;
      } else if (now - pending.started >= RESPONSE_TIMEOUT_MS) {
        const name = pending.name;
        emitEvent('request.unconfirmed', `Sin confirmación del pedido de ${name}.`, `unconfirmed:${pending.operation}`, requestSystemName);
        pending = null;
        unconfirmed += 1;
        nextClickAt = now + RETRY_GAP_MS;
        if (ship || unconfirmed >= MAX_UNCONFIRMED) {
          settings.enabled = false;
          error = ship ? `Sin confirmación de ${name}. Comprueba la cola y reanuda.`
            : `Sin confirmación de ${name}. Reanuda para reintentar.`;
          saveSettings();
          emitEvent('automation.paused', error, undefined, requestSystemName);
        }
      } else {
        show(settings.enabled ? `Esperando respuesta: ${pending.name}…` : 'Pausado. Último clic enviado.');
        wakeAt(pending.started + RESPONSE_TIMEOUT_MS);
        return;
      }
    }

    if (!settings.enabled) {
      if (!observingNotifications) releaseLeadership();
      show(error || 'Automatización pausada'); return;
    }
    if (document.hidden) {
      releaseLeadership();
      show('Esperando datos actuales en una pestaña visible del juego');
      return;
    }
    if (!hudPanelAvailable(panel) && !hudPanelAvailable(fleetPanel)) {
      releaseLeadership(); show('Abre Structures o Shipyard para continuar'); return;
    }
    if (!current.length && !ships.length) { releaseLeadership(); show('Selecciona uno de tus sistemas'); return; }
    const maintainFleet = fleetEnabled();
    const waitingMission = currentMissionJob();
    const hasWaitingMission = waitingMission?.status === 'waiting';
    if (settings.excluded.length === BUILDINGS.length && !maintainFleet && !hasWaitingMission && !watchAttacks) {
      if (observeNotifications) acquireLeadership(); else releaseLeadership();
      show('Marca un edificio o configura un mínimo de naves'); return;
    }
    acquireLeadership();
    if (!leader) {
      show(lockError ? 'No se pudo coordinar esta pestaña. Recarga para reintentar.' : 'Esperando control de esta pestaña');
      return;
    }
    // Finish reading the latest outcomes before spending resources on an old
    // fleet minimum or allowing an already queued retry to leave.
    if (reports.isRecovering()) {
      show(reportsState.lastError ? reportsState.status : 'Comprobando los últimos combates antes de continuar…');
      return;
    }
    if (missionAdapter.isBusy()) { show('Preparando la misión pendiente…'); return; }
    void attackRetry.tick().catch(() => wakeAt(Date.now() + RETRY_GAP_MS));
    if (attackRetry.isBusy()) { show('Comprobando el origen del reintento de ataque…'); return; }
    if (hasWaitingMission && !document.querySelector('dialog[open]')) {
      void fleetWait.tick();
      if (missionAdapter.isBusy()) { show('Preparando la misión pendiente…'); return; }
    }
    if (now < nextClickAt) {
      show(unconfirmed ? 'Sin respuesta; reintentando en unos segundos…' : 'Esperando actualización del juego…');
      wakeAt(nextClickAt);
      return;
    }
    if (document.querySelector(`${PANEL} .b-loading, ${FLEET_PANEL} .b-loading`)) {
      show('Esperando una petición del juego en curso…');
      return;
    }

    let fleetCandidate = null;
    const activeSystem = systemId();
    const fleetSnapshot = readFleetPrioritySnapshot(ships);
    const fleetPlan = fleetPriority.select(fleetSnapshot);
    if (fleetPlan.reserve && fleetPlan.target) {
      const row = ships.find(item => item.id === fleetPlan.target.id);
      const quantity = row && fleetPlan.target.blocker !== 'mission' ? prepareShip(row, fleetPlan.target.quantity) : 0;
      if (!quantity) {
        show(`Flota prioritaria: ${fleetPlan.target.name} ×${fleetPlan.target.quantity}.`);
        return;
      }
      // Changing the native quantity can synchronously update selection, counts,
      // resources or mission demand. Revalidate the same priority before clicking.
      const latestSnapshot = readFleetPrioritySnapshot(shipRows());
      const latestPlan = fleetPriority.select(latestSnapshot);
      const latest = fleetCounts(row.id);
      if (activeSystem !== systemId() || !latest || !latestPlan.reserve
          || latestPlan.target?.id !== row.id || latestPlan.target.deficit < quantity
          || latestPlan.target.quantity < quantity
          || !isAvailable(row.button, FLEET_PANEL)) {
        show('La flota ha cambiado; recalculando su prioridad.');
        return;
      }
      fleetCandidate = { ...row, kind: 'ship', quantity, system: activeSystem,
        fleetTotal: fleetTotal(latest), building: latest.building, batches: shipBatches(row.id),
        feedbackLine: shipFeedbackLine(), target: `×${quantity}` };
    }

    const candidate = fleetCandidate || selectBuilding(current);
    if (!candidate) { show(fleetPlan.notice || 'Esperando recursos o hueco en la cola…'); return; }

    // Registra la petición ANTES del clic: el juego puede actualizarse de forma síncrona.
    const request = { ...candidate, system: activeSystem, systemName: text(document.querySelector('[data-field="nameplate-name"]')),
      started: now, operation: `${notificationSession}:${++eventSequence}`,
      queueLength: queueLength(), batchSummary: batchSummary() };
    pending = request;
    nextClickAt = now + MIN_GAP_MS;
    lastClick = `${candidate.name} · ${candidate.target}`;
    show(candidate.kind === 'ship' ? `Encargando ${candidate.quantity} ${candidate.name}…` : `Mejorando ${candidate.name}…`);
    try {
      candidate.button.click();
      emitEvent('request.sent', candidate.kind === 'ship'
        ? `Pedido enviado: ${candidate.quantity} ${candidate.name}.`
        : `Mejora solicitada: ${candidate.name} · ${candidate.target}.`, `sent:${request.operation}`, request.systemName);
    } catch (cause) {
      pending = null;
      settings.enabled = false;
      error = 'No se pudo enviar la petición. Reanuda para reintentar.';
      saveSettings();
      emitEvent('automation.paused', error, undefined, request.systemName);
      releaseLeadership();
      show(error);
      console.warn('[Old Light Auto Upgrade]', cause);
    }
  }

  // BEGIN FLEET PRIORITY PLANNER
  function createFleetPriorityPlanner(formatDuration) {
    const RESOURCES = ['palladium', 'iridium'];
    const NAMES = { palladium: 'Palladium', iridium: 'Iridium' };
    const finiteAmount = value => Number.isFinite(value) && value >= 0;
    const costKnown = ship => RESOURCES.every(id => finiteAmount(ship.unitCost?.[id]));

    function select(snapshot) {
      const none = (notice = '', blocker = '') => ({ target: null, reserve: false, notice, blocker });
      if (!snapshot.active) return none();
      if (!snapshot.contextReady) return none('Naves: selecciona un solo sistema con recuentos disponibles.', 'context');
      const ships = (snapshot.ships || []).filter(ship => Number.isSafeInteger(ship.deficit) && ship.deficit > 0);
      if (!ships.length) return none('Mínimos de naves cubiertos o ya en construcción.', 'satisfied');
      const resources = snapshot.resources || {};
      let firstBlocked = null;
      for (const ship of ships) {
        let blocker = '';
        let notice = '';
        if (snapshot.docksFull) {
          blocker = 'docks'; notice = `${ship.name}: esperando espacio en los muelles.`;
        } else if (snapshot.treasuryBlocked) {
          blocker = 'treasury'; notice = `${ship.name}: la tesorería bloquea la producción de naves.`;
        } else if (snapshot.queue?.paused) {
          blocker = 'paused-queue'; notice = `${ship.name}: la cola de naves está detenida.`;
        } else if (ship.blocker === 'locked') {
          blocker = 'locked'; notice = `${ship.name}: requisito pendiente${ship.nativeReason ? ` (${ship.nativeReason})` : ''}.`;
        } else if (['error', 'unavailable'].includes(ship.blocker)) {
          blocker = ship.blocker; notice = `${ship.name}: el juego no permite producirla ahora${ship.nativeReason ? ` (${ship.nativeReason})` : ''}.`;
        } else if (costKnown(ship) && RESOURCES.some(id => Number.isFinite(resources[id]?.cap)
            && resources[id].cap > 0 && ship.unitCost[id] > resources[id].cap)) {
          blocker = 'capacity'; notice = `${ship.name}: una nave supera la capacidad actual del Resource Depot.`;
        } else if (costKnown(ship)) {
          const missing = RESOURCES.find(id => finiteAmount(resources[id]?.amount)
            && ship.unitCost[id] > resources[id].amount && Number.isFinite(resources[id]?.rate) && resources[id].rate <= 0);
          if (missing) {
            blocker = 'production'; notice = `${ship.name}: falta ${NAMES[missing]} y su producción no es positiva.`;
          }
        }

        const maximum = Number.isSafeInteger(ship.maxBatch) && ship.maxBatch > 0 ? ship.maxBatch : 1;
        let quantity = Math.min(ship.deficit, maximum);
        if (costKnown(ship) && RESOURCES.every(id => finiteAmount(resources[id]?.amount))) {
          for (const id of RESOURCES) if (ship.unitCost[id] > 0) {
            quantity = Math.min(quantity, Math.floor(resources[id].amount / ship.unitCost[id]));
          }
        } else quantity = 1;
        // The next order may be a partial batch. If even one ship is unaffordable,
        // reserve for one instead of forecasting the cost of the entire minimum.
        quantity = Math.max(1, quantity);
        const target = { ...ship, quantity, cost: Object.fromEntries(RESOURCES.map(id =>
          [id, finiteAmount(ship.unitCost?.[id]) ? ship.unitCost[id] * quantity : null])) };
        if (blocker) {
          if (!firstBlocked) firstBlocked = { target, reserve: false, blocker, notice };
          continue;
        }
        return { target, reserve: true, blocker: '', notice: `Flota prioritaria: ${ship.name}. Reservando recursos antes de mejorar edificios.` };
      }
      return firstBlocked || none();
    }

    function estimate(snapshot, plan = select(snapshot)) {
      const ship = plan.target;
      const result = (state, detail, waitMs = null, reason = '') => ({ state, detail, waitMs, reason,
        kind: ship ? 'ship' : '', shipId: ship?.id || '', buildingId: '', name: ship?.name || '',
        quantity: ship?.quantity || 0, targetLevel: null });
      if (!ship) return result(plan.blocker === 'context' ? 'blocked' : 'idle', plan.notice);
      const reservation = 'Se reservan recursos para la flota; los edificios esperan.';
      if (!plan.reserve) return result('blocked', plan.notice, null, plan.blocker);
      const resources = snapshot.resources || {};
      if (!costKnown(ship) || RESOURCES.some(id => !finiteAmount(resources[id]?.amount)
          || !Number.isFinite(resources[id]?.cap) || resources[id].cap <= 0)) {
        return result('blocked', `Esperando recursos, capacidad y costes exactos de ${ship.name}. ${reservation}`, null, 'data');
      }
      if (ship.blocker === 'manual') {
        return result('blocked', `Termina de editar la cantidad de ${ship.name} en el astillero. ${reservation}`, null, 'manual');
      }
      if (ship.blocker === 'mission') {
        return result('blocked', `La producción de la misión espera a que se cierren los diálogos y el juego permita actuar. ${reservation}`, null, 'mission');
      }
      if (!['ready', 'resources', 'queue'].includes(ship.blocker)) {
        return result('blocked', `Esperando disponibilidad de ${ship.name} en el juego. ${reservation}`, null, 'native');
      }
      const queue = snapshot.queue || {};
      const full = queue.full || ship.blocker === 'queue';
      if (full && (!Number.isFinite(queue.waitMs) || queue.waitMs < 0)) {
        return result('blocked', `Cola de naves llena: el juego no muestra cuándo se libera un hueco. ${reservation}`, null, 'queue');
      }
      if (full && queue.waitMs === 0) {
        return result('blocked', `Esperando a que el juego confirme el hueco libre en la cola de naves. ${reservation}`, null, 'refresh');
      }
      let waitMs = Math.max(0, snapshot.cooldownMs || 0, full ? queue.waitMs : 0);
      for (const id of RESOURCES) {
        const resource = resources[id];
        if (ship.cost[id] > resource.cap) return result('blocked', `El pedido de ${ship.name} supera la capacidad del Depot.`, null, 'capacity');
        if (ship.cost[id] <= resource.amount) continue;
        if (!Number.isFinite(resource.rate) || resource.rate <= 0) {
          return result('blocked', `No se puede estimar la producción de ${NAMES[id]}. ${reservation}`, null, 'rate');
        }
        waitMs = Math.max(waitMs, (ship.cost[id] - resource.amount) / resource.rate * 60000);
      }
      if (!Number.isFinite(waitMs)) return result('blocked', `Esperando una estimación válida para ${ship.name}. ${reservation}`, null, 'data');
      for (const id of RESOURCES) {
        const resource = resources[id];
        if (waitMs > 0 && !Number.isFinite(resource.rate)) {
          return result('blocked', `Producción de ${NAMES[id]} no disponible. ${reservation}`, null, 'rate');
        }
        const projected = Math.min(resource.cap, Math.max(0, resource.amount + (resource.rate || 0) * waitMs / 60000));
        if (projected + 1e-7 < ship.cost[id]) {
          return result('blocked', `El ${NAMES[id]} disponible disminuye durante la espera. ${reservation}`, null, 'production');
        }
      }
      // A funds title can describe an oversized native input batch. The main
      // controller will normalize that input and revalidate before sending.
      const notes = [`Flota primero. Pendientes de encargar: ${ship.deficit} ${ship.name}.`];
      const missing = RESOURCES.filter(id => ship.cost[id] > resources[id].amount)
        .map(id => `${Math.ceil(ship.cost[id] - resources[id].amount).toLocaleString()} ${NAMES[id]}`);
      if (missing.length) notes.push(`Faltan ${missing.join(' y ')} para ${ship.quantity === 1 ? 'la siguiente nave' : 'el siguiente lote'}.`);
      if (full) notes.push(`Hueco en la cola de naves en ≈${formatDuration(queue.waitMs)}.`);
      notes.push(reservation);
      return result(waitMs > 0 ? 'waiting' : 'ready', notes.join(' '), waitMs);
    }

    return { select, estimate };
  }
  // END FLEET PRIORITY PLANNER

  // BEGIN UPGRADE ETA ESTIMATOR
  function createUpgradeEtaEstimator() {
    const RESOURCES = ['palladium', 'iridium'];
    const RESOURCE_NAMES = { palladium: 'Palladium', iridium: 'Iridium' };
    const EPSILON = 1e-7;

    function parseRate(value) {
      // The native HUD uses toFixed(1), not locale grouping or compact notation.
      const match = /^([+\-−]?\d+(?:\.\d+)?)\/min$/.exec(String(value || '').trim());
      const number = match ? Number(match[1].replace('−', '-')) : NaN;
      return Number.isFinite(number) ? number : null;
    }

    function parseDuration(value) {
      const input = String(value || '').trim();
      if (!/^(?:\d+[dhms]\s*)+$/.test(input)) return null;
      const units = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
      const seen = new Set();
      let total = 0;
      for (const [, count, unit] of input.matchAll(/(\d+)([dhms])/g)) {
        if (seen.has(unit)) return null;
        seen.add(unit);
        total += Number(count) * units[unit];
      }
      return Number.isSafeInteger(total) ? total : null;
    }

    function formatDuration(ms) {
      const seconds = Math.max(0, Math.ceil(ms / 1000));
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor(seconds / 3600) % 24;
      const minutes = Math.floor(seconds / 60) % 60;
      const rest = seconds % 60;
      if (days) return `${days}d ${hours}h ${minutes}m`;
      if (seconds >= 3600) return `${hours}h ${minutes}m ${rest}s`;
      return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
    }

    function estimate(snapshot) {
      const excluded = new Set(snapshot.excluded || []);
      const byId = new Map((snapshot.buildings || []).map(row => [row.id, row]));
      const selected = (snapshot.order || []).filter(id => !excluded.has(id)).map(id => byId.get(id)).filter(Boolean);
      const result = (state, detail, row = null, waitMs = null, reason = '') => ({ state, detail, waitMs, reason,
        buildingId: row?.id || '', name: row?.name || '', targetLevel: row?.targetLevel ?? null });
      if (!selected.length) return result('idle', 'Marca los edificios que quieras mejorar.');
      const resources = snapshot.resources || {};
      if (RESOURCES.some(id => !Number.isFinite(resources[id]?.amount) || resources[id].amount < 0
          || !Number.isFinite(resources[id]?.cap) || resources[id].cap <= 0)) {
        return result('blocked', 'Selecciona un solo sistema con recursos y capacidad disponibles.', null, null, 'data');
      }
      const queue = snapshot.queue || {};
      const queued = queue.buildings || {};
      const queueWait = queue.full ? queue.waitMs : 0;
      if (queue.full && (!Number.isFinite(queueWait) || queueWait < 0)) {
        return result('blocked', 'Cola llena: el juego no muestra cuándo se libera un hueco.', null, null, 'queue');
      }
      if (queue.full && queueWait === 0) {
        return result('blocked', 'Esperando a que el juego confirme el hueco libre en la cola.', null, null, 'refresh');
      }
      const notBefore = Math.max(0, snapshot.cooldownMs || 0, queueWait || 0);
      const threshold = Math.min(100, Math.max(1, snapshot.depotFillPercent || 90));
      const costKnown = row => RESOURCES.every(id => Number.isFinite(row.cost?.[id]) && row.cost[id] >= 0);
      const capacityFits = row => costKnown(row) && RESOURCES.every(id => row.cost[id] <= resources[id].cap);
      const powerKnown = row => Number.isFinite(row.energy) && Number.isFinite(snapshot.energy);
      const needsPower = row => row.energy < 0 && snapshot.energy + row.energy < 0;
      const models = selected.filter(row => row.visible && Number.isSafeInteger(row.targetLevel) && row.targetLevel > 0 && costKnown(row)
        && powerKnown(row) && capacityFits(row) && ['ready', 'resources', 'queue'].includes(row.blocker)
        && !(['reactor', 'warehouse'].includes(row.id) && queued[row.id]));
      const project = (id, ms) => {
        const { amount, cap, rate } = resources[id];
        if (ms > 0 && !Number.isFinite(rate)) return null;
        return Math.min(cap, Math.max(0, amount + (rate || 0) * ms / 60000));
      };
      const events = new Set([notBefore]);
      const addThreshold = (id, amount) => {
        const resource = resources[id];
        if (resource.rate > 0 && amount <= resource.cap && amount > resource.amount) {
          const ms = (amount - resource.amount) / resource.rate * 60000;
          if (Number.isFinite(ms)) events.add(Math.max(notBefore, ms));
        }
      };
      for (const row of models) for (const id of RESOURCES) addThreshold(id, row.cost[id]);
      if (models.some(row => row.id === 'warehouse')) {
        for (const id of RESOURCES) addThreshold(id, resources[id].cap * threshold / 100);
      }

      // Eligibility can begin only at a resource threshold, the Depot threshold,
      // a free queue slot or the end of the helper's cooldown. Re-evaluate the
      // actual priority policy at each event, including decreasing resources.
      for (const ms of [...events].sort((a, b) => a - b)) {
        const amounts = Object.fromEntries(RESOURCES.map(id => [id, project(id, ms)]));
        if (RESOURCES.some(id => amounts[id] === null)) continue;
        const fill = Math.max(...RESOURCES.map(id => amounts[id] / resources[id].cap * 100));
        const available = models.filter(row =>
          (ms > 0 || row.blocker === 'ready') &&
          RESOURCES.every(id => amounts[id] + EPSILON >= row.cost[id]) &&
          (row.id !== 'warehouse' || fill + EPSILON >= threshold));
        const consumer = available.find(row => row.id !== 'reactor' && needsPower(row));
        const candidate = available.find(row => row.id === 'reactor' ? Boolean(consumer) : !needsPower(row));
        if (!candidate) continue;
        const notes = [];
        if (candidate.id === 'reactor') notes.push(`Energía necesaria para ${consumer.name}.`);
        if (candidate.id === 'warehouse') notes.push(`Depot al ${threshold}% de capacidad.`);
        if (queue.full) notes.push(`Hueco en cola en ≈${formatDuration(queueWait)}.`);
        const missing = RESOURCES.filter(id => candidate.cost[id] > resources[id].amount)
          .map(id => `${Math.ceil(candidate.cost[id] - resources[id].amount).toLocaleString()} ${RESOURCE_NAMES[id]}`);
        if (missing.length) notes.push(`Faltan ${missing.join(' y ')}.`);
        if (snapshot.fleetPriority) notes.push('La producción de naves tiene prioridad.');
        if (!notes.length) notes.push(ms > 0 ? 'Esperando el siguiente pedido del helper.' : 'Lista para encolar.');
        return result(ms > 0 ? 'waiting' : 'ready', notes.join(' '), candidate, ms);
      }

      // Give a concrete blocker instead of displaying infinity, zero, or a
      // countdown inferred from the duration of a job that has not been queued.
      for (const row of selected) {
        if (row.id === 'reactor') continue;
        if (queued[row.id] && row.id === 'warehouse') {
          return result('blocked', 'Resource Depot ya está en cola; se recalculará cuando termine.', row, null, 'queued');
        }
        if (!row.visible || row.targetLevel === null || !['ready', 'resources', 'queue', 'capacity'].includes(row.blocker)) continue;
        if (!costKnown(row) || !powerKnown(row)) return result('blocked', 'Esperando costes y energía exactos del juego.', row, null, 'data');
        if (!capacityFits(row)) return result('blocked', 'El coste supera la capacidad actual del Resource Depot.', row, null, 'capacity');
        if (needsPower(row)) {
          const detail = queued.reactor ? 'Esperando el Reactor en cola; se recalculará cuando termine.'
            : excluded.has('reactor') ? 'Necesita más energía. Reactor está desmarcado.'
              : 'Necesita más energía; esperando una mejora de Reactor disponible.';
          return result('blocked', detail, row, null, 'energy');
        }
        for (const id of RESOURCES) {
          const resource = resources[id];
          if (!Number.isFinite(resource.rate)) return result('blocked', `Producción de ${RESOURCE_NAMES[id]} no disponible.`, row, null, 'rate');
          if (resource.rate <= 0 && row.cost[id] > resource.amount) {
            return result('blocked', `Falta ${RESOURCE_NAMES[id]} y su producción no es positiva.`, row, null, 'production');
          }
          if (resource.rate < 0) return result('blocked', `El ${RESOURCE_NAMES[id]} disponible disminuye durante la espera.`, row, null, 'production');
        }
        if (row.id === 'warehouse') return result('blocked', `Esperando que un recurso alcance el ${threshold}% del Depot.`, row, null, 'threshold');
        return result('blocked', 'Esperando disponibilidad actualizada del juego.', row, null, 'refresh');
      }
      const locked = selected.find(row => row.id !== 'reactor');
      if (locked) return result('blocked', locked.blocker === 'maxed' ? `${locked.name} ha alcanzado su máximo.`
        : locked.blocker === 'locked' ? `Requisito pendiente: ${locked.nativeReason || locked.name}.`
          : 'Esperando que el juego permita la siguiente mejora.', locked, null, locked.blocker);
      return result('idle', 'Reactor solo se mejora cuando otra mejora marcada necesita energía.', null, null, 'demand');
    }

    return { estimate, parseRate, parseDuration, formatDuration };
  }
  // END UPGRADE ETA ESTIMATOR

  // BEGIN SHIFT PRESETS
  function createShiftPresetMenu({ isEnabled = () => true, onPreset = null,
    readPresetCache = () => [], savePresetCache = () => {}, canUseEmptyFleet = () => false,
    captureEmptyTarget = null, onEmptyPreset = null } = {}) {
    const MENU_ID = 'oldlight-shift-presets-menu';
    const NATIVE_GUARD_MS = 130;
    const MASK_ATTRIBUTE = 'data-oldlight-preset-preparing';
    const scope = new AbortController();
    const maskStyle = document.createElement('style');
    maskStyle.textContent = '#dispatch-dialog[' + MASK_ATTRIBUTE + '] { display:none!important; }'
      + '#dispatch-dialog[' + MASK_ATTRIBUTE + ']::backdrop { display:none!important; background:transparent!important; }';
    document.head.appendChild(maskStyle);
    let gesture = null;
    let flow = null;
    let replaying = false;
    let suppressClick = null;
    let destroyed = false;

    const enabled = () => !destroyed && isEnabled() !== false;
    const on = (target, name, handler, options = {}) => target.addEventListener(name, handler,
      { ...options, signal: scope.signal });
    const visible = element => Boolean(element?.isConnected && !element.hidden
      && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && element.getClientRects().length && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden');
    const one = selector => {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 ? matches[0] : null;
    };
    const inMenu = event => Boolean(flow?.host && event.composedPath().includes(flow.host));
    const plain = event => !event.altKey && !event.ctrlKey && !event.metaKey;
    const dialogElement = () => one('#dispatch-dialog');
    const anchor = radial => radial.style.left + '|' + radial.style.top;
    const routeElement = dialog => dialog?.querySelector('[data-field="dispatch-route-slot"] .route-header');
    const routeKey = route => {
      const cols = route?.querySelectorAll(':scope > .route-header-tile-col');
      // Include the native star geometry, origin stack and labels. Names alone can collide.
      return cols?.length === 2 ? [...cols].map(col => col.innerHTML).join('\n') : null;
    };
    const unavailable = button => button.disabled || button.getAttribute('aria-disabled') === 'true'
      || Boolean(button.closest('.dispatch-preset-tile-locked'));
    const presetKey = button => (button.getAttribute('aria-label') || button.textContent || '')
      .normalize('NFKC').replace(/\s+/g, ' ').trim();
    function presetQuantities(button) {
      const result = { probe: 0, marauder: 0, sentinel: 0, vanguard: 0 };
      const label = presetKey(button).replace(/^Use\s+/i, '');
      if (!label) return null;
      for (const part of label.split(/,\s+(?=\d)/)) {
        const match = part.match(/^([\d\s,.'’]+)\s+(Probe|Marauder|Sentinel|Vanguard)$/i);
        const value = match ? Number(match[1].replace(/[^\d]/g, '')) : NaN;
        if (!Number.isSafeInteger(value) || value <= 0) return null;
        const type = match[2].toLowerCase();
        if (result[type]) return null;
        result[type] = value;
      }
      return result;
    }
    function quantitiesMatch(dialog, expected) {
      if (!expected) return false;
      const inputs = [...dialog.querySelectorAll('[data-field="dispatch-quantities"] input.dispatch-step-input')];
      for (const [type, amount] of Object.entries(expected)) {
        const matches = inputs.filter(input => input.getAttribute('aria-label')?.toLowerCase() === 'number of ' + type + ' to send');
        if (matches.length !== 1 || Number(matches[0].value) !== amount) return false;
      }
      return true;
    }

    function stockComplete(dialog, expected) {
      if (!expected) return false;
      const inputs = [...dialog.querySelectorAll('[data-field="dispatch-quantities"] input.dispatch-step-input')];
      return Object.entries(expected).every(([type, amount]) => {
        if (amount === 0) return true;
        const input = inputs.find(node => node.getAttribute('aria-label')?.toLowerCase() === 'number of ' + type + ' to send');
        const value = input?.closest('.dispatch-ship-row')?.querySelector('.dispatch-ship-avail')?.textContent
          ?.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!value || !/^[\d\s,.'’]+(?: to [\d\s,.'’]+)? available$/.test(value)) return false;
        const minimum = Number(value.replace(/ available$/, '').split(' to ')[0].replace(/[^\d]/g, ''));
        return Number.isSafeInteger(minimum) && minimum >= amount;
      });
    }

    function readPresets() {
      const dialog = dialogElement();
      const list = dialog?.querySelector('[data-field="dispatch-presets"]');
      const buttons = [...list?.querySelectorAll('.dispatch-preset-apply') || []]
        .filter(button => button instanceof HTMLButtonElement);
      const known = buttons.length > 0 || Boolean(list?.querySelector('.dispatch-preset-add, .dispatch-preset-save-text'));
      const records = buttons.map((button, index) => ({
          key: presetKey(button), label: presetKey(button).replace(/^Use\s+/i, ''),
          locked: unavailable(button), index,
        })).filter(record => record.key);
      if (known) {
        try { savePresetCache(records); } catch { /* The native menu still works if local saving fails. */ }
        return { known, records };
      }
      let cached = [];
      try { cached = readPresetCache(); } catch { /* No cache is safer than an unknown preset. */ }
      return { known: false, records: Array.isArray(cached) ? cached : [] };
    }

    function nativeAction(action) {
      const previous = replaying;
      replaying = true;
      try { return action(); } finally { replaying = previous; }
    }
    function nativeEvent(target, event) { return nativeAction(() => target.dispatchEvent(event)); }
    function escapeNativeMenus() {
      nativeEvent(document, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    function pointer(target, name, source, modifiers = false) {
      nativeEvent(target, new PointerEvent(name, {
        bubbles: true, cancelable: true, composed: true, pointerId: source.pointerId,
        pointerType: 'mouse', isPrimary: true, button: 0, buttons: name === 'pointerdown' ? 1 : 0,
        clientX: source.clientX, clientY: source.clientY,
        shiftKey: modifiers && source.shiftKey, altKey: modifiers && source.altKey,
        ctrlKey: modifiers && source.ctrlKey, metaKey: modifiers && source.metaKey,
      }));
    }
    function replayClick(start, end, modifiers) {
      pointer(start.canvas, 'pointerdown', start, modifiers);
      pointer(start.canvas, 'pointerup', end, modifiers);
    }
    function unmask(current) {
      if (!current.maskedDialog) return;
      const dialog = current.maskedDialog;
      current.maskedDialog = null;
      if (current.previousMask === null) dialog.removeAttribute(MASK_ATTRIBUTE);
      else dialog.setAttribute(MASK_ATTRIBUTE, current.previousMask);
    }
    function mask(current, dialog) {
      current.maskedDialog = dialog;
      current.previousMask = dialog.getAttribute(MASK_ATTRIBUTE);
      dialog.setAttribute(MASK_ATTRIBUTE, '');
    }
    function cancel() {
      gesture = null;
      const current = flow;
      flow = null;
      if (!current) return;
      clearTimeout(current.timer);
      cancelAnimationFrame(current.frame);
      current.observer?.disconnect();
      current.host?.remove();
      if (current.confirmGuard) window.removeEventListener('click', current.confirmGuard, true);
      if (current.dialog && current.maskedDialog && current.dialog.open && !current.confirmed) {
        nativeAction(() => current.dialog.close());
      }
      unmask(current);
    }
    function handToNative(current, message) {
      if (flow !== current) return;
      if (message && current.dialog?.open) {
        const error = current.dialog.querySelector('[data-field="dispatch-error"]');
        if (error) { error.textContent = message; error.hidden = false; }
      }
      unmask(current);
      cancel();
    }
    function validRadial(current) {
      return enabled() && flow === current && !document.querySelector('dialog[open]')
        && visible(current.radial) && current.radial.contains(current.fleet)
        && current.fleet.dataset.actionKey === 'fleet'
        && (current.emptyFleet ? canUseEmptyFleet() && current.radial.contains(current.inspect)
          && current.inspect.dataset.enabled === 'true' && !current.inspect.disabled
          : current.fleet.dataset.enabled === 'true' && !current.fleet.disabled);
    }
    function validDialog(current) {
      return enabled() && flow === current && current.dialog?.isConnected && current.dialog.open
        && current.dialog.dataset.mode === 'dispatch' && current.dialog.dataset.direction === 'forward'
        && current.route?.isConnected && routeElement(current.dialog) === current.route;
    }
    function freshRadial(start, end) {
      if (document.querySelector('dialog[open]') || !start.canvas.isConnected) return null;
      escapeNativeMenus();
      const context = one('#app > .selection-menu');
      const markers = context?.querySelector('.selection-menu-markers');
      const previous = one('#app > .star-actions');
      if (!context?.hidden || !markers || visible(previous)) return null;
      nativeEvent(start.canvas, new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true, button: 2,
        clientX: end.clientX, clientY: end.clientY,
      }));
      const hasStar = visible(context) && !markers.hidden;
      escapeNativeMenus();
      if (!hasStar || !context.hidden || visible(previous)) return null;
      replayClick({ ...start, clientX: end.clientX, clientY: end.clientY }, end, false);
      const radial = one('#app > .star-actions');
      const fleet = radial?.querySelector('button.star-action-btn[data-action-key="fleet"]');
      const inspect = radial?.querySelector('button.star-action-btn[data-action-key="inspect"]');
      return visible(radial) && fleet instanceof HTMLButtonElement ? { radial, fleet, inspect } : null;
    }

    function place(current) {
      if (!current.host?.isConnected || !visible(current.radial)) return;
      const origin = current.radial.getBoundingClientRect();
      const rects = [...current.radial.querySelectorAll(':scope > .star-action-btn')]
        .filter(visible).map(button => button.getBoundingClientRect());
      if (!rects.length) return;
      const width = current.host.getBoundingClientRect().width;
      const height = current.host.getBoundingClientRect().height;
      const leftEdge = Math.min(...rects.map(rect => rect.left));
      const rightEdge = Math.max(...rects.map(rect => rect.right));
      let x = rightEdge + 10;
      if (x + width > innerWidth - 8) x = leftEdge - width - 10;
      x = Math.max(8, Math.min(x, innerWidth - width - 8));
      const y = Math.max(8, Math.min(origin.top - height / 2, innerHeight - height - 8));
      const left = (x - origin.left) + 'px';
      const top = (y - origin.top) + 'px';
      // This function also runs from the style observer. Avoid observing our
      // own identical writes indefinitely when the native ticker moves a menu.
      if (current.host.style.left !== left) current.host.style.left = left;
      if (current.host.style.top !== top) current.host.style.top = top;
    }
    function renderPresets(current, records, pending = false) {
      if (flow !== current || !current.host) return;
      const signature = JSON.stringify(records.map(record => [record.key, record.locked]));
      if (signature === current.signature && pending === current.pending) return;
      current.signature = signature;
      current.pending = pending;
      current.records = records;
      const focused = current.items?.indexOf(current.shadow.activeElement) ?? -1;
      current.items = records.map(record => {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        const name = document.createElement('span');
        name.className = 'preset-name';
        name.textContent = record.label;
        const action = document.createElement('span');
        action.className = 'preset-action';
        action.setAttribute('aria-hidden', 'true');
        action.textContent = record.locked ? 'No disponible' : '→';
        item.append(name, action);
        item.setAttribute('aria-label', record.label + (record.locked ? ', no disponible' : ''));
        item.disabled = record.locked || pending;
        item.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation(); choosePreset(current, record);
        });
        return item;
      });
      current.list.replaceChildren(...current.items);
      current.note.textContent = pending ? 'Comprobando ruta y presets…' : current.emptyMessage || (records.length
        ? current.emptyFleet ? 'Elige un preset para esperar o producir las naves que faltan.' : 'Un clic envía la flota del preset. Esc para cerrar.'
        : current.emptyFleet ? 'Abre una vez los presets de flota con naves disponibles para recordarlos aquí.' : 'No hay presets guardados.');
      place(current);
      if (focused >= 0) current.items[focused]?.focus({ preventScroll: true });
    }
    function showMenu(current) {
      const host = document.createElement('div');
      host.id = MENU_ID;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host{position:absolute;display:block;pointer-events:auto;width:236px;max-width:calc(100vw - 16px);box-sizing:border-box;border:1px solid var(--ol-border-strong,#456177);border-radius:var(--ol-radius,10px);background:var(--ol-bg,#0c141d);color:var(--ol-text,#e5eef6);box-shadow:0 12px 32px #0008;font:13px/1.45 system-ui,sans-serif;padding:10px;z-index:1;color-scheme:dark}
        *{box-sizing:border-box}h2{margin:0 0 8px;font-size:12px;color:var(--ol-muted,#a2b5c6);font-weight:600}
        [role=menu]{display:grid;gap:6px;max-height:min(280px,55vh);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--ol-border-strong,#456177) transparent}
        button{display:flex;align-items:center;justify-content:space-between;gap:9px;min-height:38px;font:inherit;color:inherit;text-align:left;border:1px solid var(--ol-border,#2b4053);border-radius:7px;background:var(--ol-surface,#131f2b);padding:8px 10px;cursor:pointer}
        button:hover:not(:disabled){border-color:var(--ol-accent,#7de2c2);background:var(--ol-accent-bg,#183c36)}
        button:focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:-2px;border-color:var(--ol-focus,#8bc7ff)}
        button:disabled{opacity:.5;cursor:default}.preset-name{min-width:0;overflow-wrap:anywhere}.preset-action{flex:none;color:var(--ol-accent,#7de2c2);font-size:15px}
        button:disabled .preset-action{font-size:11.5px;color:var(--ol-muted,#a2b5c6);max-width:72px}
        p{margin:8px 1px 0;color:var(--ol-muted,#a2b5c6);font-size:11.5px;overflow-wrap:anywhere}
      </style><h2>Presets de flota</h2><div role="menu" aria-label="Presets de flota"></div><p role="status"></p>`;
      current.host = host;
      current.shadow = shadow;
      current.list = shadow.querySelector('[role="menu"]');
      current.note = shadow.querySelector('[role="status"]');
      current.items = [];
      shadow.addEventListener('keydown', event => {
        if (/^[1-8]$/.test(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const items = current.items.filter(item => !item.disabled);
        const index = items.indexOf(shadow.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true });
        items[next]?.scrollIntoView({ block: 'nearest' });
      });
      current.radial.appendChild(host);
      const presets = readPresets();
      // Cached tiles describe quantities, not their destination. Prepare the
      // native route for every opening before a preset can be selected.
      renderPresets(current, presets.records, true);
      current.phase = 'loading';
      current.frame = requestAnimationFrame(() => {
        if (flow !== current) return;
        current.anchor = anchor(current.radial);
        place(current);
      });
      current.timer = setTimeout(() => preparePresets(current), NATIVE_GUARD_MS);
    }

    function preparePresets(current) {
      if (!validRadial(current) || current.phase !== 'loading') { cancel(); return; }
      if (current.emptyFleet) { prepareEmptyFleet(current); return; }
      const dialog = dialogElement();
      if (!(dialog instanceof HTMLDialogElement) || dialog.open) { cancel(); return; }
      current.phase = 'preparing';
      let prepared = false;
      mask(current, dialog);
      try {
        // Native Fn returns for an already-open, nonmodal dialog outside its stack.
        // This prepares the real controls without showModal, focus or a backdrop.
        dialog.setAttribute('open', '');
        nativeAction(() => current.fleet.click());
        if (dialog.open && !dialog.matches(':modal') && dialog.dataset.mode === 'dispatch'
            && dialog.dataset.direction === 'forward') {
          current.expectedRoute = routeKey(routeElement(dialog));
          const presets = readPresets();
          prepared = Boolean(current.expectedRoute && presets.known);
        }
      } catch {
        prepared = false;
      } finally {
        if (dialog.matches(':modal')) {
          nativeAction(() => dialog.close());
          prepared = false;
        } else {
          dialog.removeAttribute('open');
          // Run the native close cleanup synchronously. There was no native open/close
          // operation and no queued close event that could erase a later session's origins.
          nativeEvent(dialog, new Event('close'));
        }
        unmask(current);
      }
      if (!prepared || !enabled() || flow !== current) { cancel(); return; }
      const restored = freshRadial(current.start, current.end);
      if (!restored) { cancel(); return; }
      Object.assign(current, restored);
      current.readyAt = performance.now() + NATIVE_GUARD_MS;
      current.anchor = null;
      current.phase = 'menu';
      current.radial.appendChild(current.host);
      renderPresets(current, readPresets().records);
      current.frame = requestAnimationFrame(() => {
        if (flow !== current) return;
        current.anchor = anchor(current.radial);
        place(current);
      });
    }

    function prepareEmptyFleet(current) {
      const records = readPresets().records;
      const seed = records.find(record => !record.locked);
      const quantities = seed && presetQuantities({ getAttribute: () => seed.key });
      current.phase = 'preparing';
      if (quantities && typeof captureEmptyTarget === 'function') {
        try { current.emptyCapture = nativeAction(() => captureEmptyTarget(current.inspect, quantities, seed.key)); }
        catch { current.emptyCapture = null; }
      }
      if (!enabled() || flow !== current) { cancel(); return; }
      if (seed && !current.emptyCapture?.spec) {
        current.emptyMessage = current.emptyCapture?.message || 'No se pudo identificar el destino. Vuelve a seleccionarlo.';
      }
      const restored = freshRadial(current.start, current.end);
      if (!restored) { cancel(); return; }
      Object.assign(current, restored);
      current.phase = 'menu';
      current.radial.appendChild(current.host);
      current.readyAt = performance.now() + NATIVE_GUARD_MS;
      renderPresets(current, records);
      if (!current.emptyCapture?.spec) for (const item of current.items) item.disabled = true;
      current.frame = requestAnimationFrame(() => {
        if (flow === current) { current.anchor = anchor(current.radial); place(current); }
      });
    }

    function choosePreset(current, record) {
      if (!validRadial(current) || current.phase !== 'menu' || record.locked
          || !current.records.includes(record)) return;
      const selected = readPresets().records[record.index];
      if (!selected || selected.key !== record.key || selected.locked) { cancel(); return; }
      if (current.emptyFleet) {
        const quantities = presetQuantities({ getAttribute: () => record.key });
        if (!current.emptyCapture?.spec || !quantities || typeof onEmptyPreset !== 'function') return;
        const capture = { spec: { ...current.emptyCapture.spec, quantities,
          target: { ...current.emptyCapture.spec.target, presetKey: record.key } }, handle: null };
        cancel();
        nativeAction(() => onEmptyPreset({ quantities, presetKey: record.key, capture, shortage: true }));
        return;
      }
      current.phase = 'choosing';
      current.selected = record;
      for (const item of current.items) item.disabled = true;
      current.note.textContent = 'Preparando envío…';
      current.timer = setTimeout(() => openForSend(current), Math.max(0, current.readyAt - performance.now()));
    }
    function openForSend(current) {
      if (!validRadial(current) || current.phase !== 'choosing') { cancel(); return; }
      const dialog = dialogElement();
      if (!(dialog instanceof HTMLDialogElement) || dialog.open) { cancel(); return; }
      current.phase = 'opening';
      current.dialog = dialog;
      mask(current, dialog);
      try { nativeAction(() => current.fleet.click()); } catch { cancel(); return; }
      current.host.remove();
      current.route = routeElement(dialog);
      if (!validDialog(current) || document.querySelectorAll('dialog[open]').length !== 1) { cancel(); return; }
      if (current.expectedRoute && routeKey(current.route) !== current.expectedRoute) {
        handToNative(current, 'El destino o los sistemas de origen han cambiado. Revisa la ruta antes de enviar.');
        return;
      }
      current.phase = 'ready';
      current.openedRoute = routeKey(current.route);
      if (!current.openedRoute) { handToNative(current); return; }
      current.timer = setTimeout(() => sendPreset(current), NATIVE_GUARD_MS);
    }
    function sendPreset(current) {
      if (!validDialog(current) || current.phase !== 'ready'
          || document.querySelectorAll('dialog[open]').length !== 1) { cancel(); return; }
      const buttons = [...current.dialog.querySelectorAll('[data-field="dispatch-presets"] .dispatch-preset-apply')];
      const preset = buttons[current.selected.index];
      const confirm = current.dialog.querySelector('[data-field="dispatch-confirm"]');
      if (!(preset instanceof HTMLButtonElement) || presetKey(preset) !== current.selected.key || unavailable(preset)
          || !(confirm instanceof HTMLButtonElement) || confirm.hidden) {
        handToNative(current, 'Ese preset ya no está disponible. Elige uno de los presets actuales.'); return;
      }
      const expectedQuantities = presetQuantities(preset);
      if (!expectedQuantities) { handToNative(current); return; }
      current.confirmGuard = event => {
        if (event.target !== confirm) return;
        if (current.permitConfirm && !current.confirmed) { current.confirmed = true; return; }
        event.preventDefault(); event.stopImmediatePropagation();
      };
      window.addEventListener('click', current.confirmGuard, true);
      current.phase = 'applying';
      try { nativeAction(() => preset.click()); } catch { handToNative(current); return; }
      current.route = routeElement(current.dialog);
      if (!validDialog(current)) { cancel(); return; }
      if (routeKey(current.route) !== current.openedRoute) {
        handToNative(current, 'La ruta ha cambiado. Revisa el destino y los sistemas de origen antes de enviar.'); return;
      }
      const error = current.dialog.querySelector('[data-field="dispatch-error"]');
      const shortage = !quantitiesMatch(current.dialog, expectedQuantities) || !stockComplete(current.dialog, expectedQuantities);
      if (typeof onPreset === 'function') {
        let offered = false;
        try { offered = nativeAction(() => onPreset({ dialog: current.dialog, quantities: expectedQuantities,
          presetKey: presetKey(preset), shortage })) === true; } catch { /* Preserve the native dialog. */ }
        if (offered) { handToNative(current); return; }
      }
      if (confirm.disabled || (error && !error.hidden && error.textContent.trim())) {
        handToNative(current); return;
      }
      if (shortage) {
        handToNative(current, 'No hay suficientes naves para este preset. Revisa las cantidades antes de enviar.'); return;
      }
      current.phase = 'submitted';
      current.permitConfirm = true;
      try { nativeAction(() => confirm.click()); } finally { current.permitConfirm = false; }
      if (!current.confirmed) { handToNative(current); return; }
      // Special native confirmations (e.g. ending beginner protection) remain in charge.
      if (document.querySelectorAll('dialog[open]').length > 1) handToNative(current);
      else current.timer = setTimeout(() => handToNative(current), 4000);
    }

    function begin(start, end) {
      if (!enabled() || document.querySelector('dialog[open]')) return;
      const found = freshRadial(start, end);
      if (!found) return;
      const emptyFleet = (found.fleet.disabled || found.fleet.dataset.enabled !== 'true')
        && typeof captureEmptyTarget === 'function' && typeof onEmptyPreset === 'function' && canUseEmptyFleet();
      const current = { ...found, emptyFleet, start, end: { pointerId: end.pointerId, clientX: end.clientX, clientY: end.clientY },
        phase: 'radial', readyAt: performance.now() + NATIVE_GUARD_MS, anchor: null, timer: null, frame: null,
        host: null, observer: null, dialog: null, maskedDialog: null, confirmed: false };
      flow = current;
      if (!validRadial(current)) { cancel(); return; }
      current.observer = new MutationObserver(() => {
        if (flow !== current || !enabled()) { cancel(); return; }
        if (['loading', 'menu', 'choosing'].includes(current.phase)) {
          if (!validRadial(current)) {
            cancel(); return;
          }
          // Pixi can position the radial after our first animation frame, or
          // continue a small camera animation without changing its target.
          // Position is presentation; the prepared route identifies the target.
          const nextAnchor = anchor(current.radial);
          if (nextAnchor !== current.anchor) {
            current.anchor = nextAnchor;
            place(current);
          }
          if (current.phase === 'menu') {
            renderPresets(current, readPresets().records);
            if (current.emptyFleet && !current.emptyCapture?.spec) for (const item of current.items) item.disabled = true;
          }
        } else if (['ready', 'submitted'].includes(current.phase)) {
          if (!validDialog(current)) { cancel(); return; }
          const error = current.dialog.querySelector('[data-field="dispatch-error"]');
          const batch = current.dialog.querySelector('.dispatch-batch-report');
          if (document.querySelectorAll('dialog[open]').length > 1
              || (current.phase === 'submitted' && ((error && !error.hidden && error.textContent.trim())
                || (batch && !batch.hidden)))) handToNative(current);
        }
      });
      current.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['open', 'hidden', 'disabled', 'aria-disabled', 'data-mode', 'data-direction',
          'data-action-key', 'data-enabled', 'class', 'style'] });
      showMenu(current);
    }

    on(window, 'pointerdown', event => {
      if (replaying) return;
      if (inMenu(event)) return;
      cancel();
      const canvas = event.target;
      if (!enabled() || !(canvas instanceof HTMLCanvasElement) || canvas.id !== 'stage'
          || event.button !== 0 || event.pointerType !== 'mouse' || !event.shiftKey || !plain(event)
          || document.querySelector('dialog[open]') || document.body.classList.contains('ui-hidden')) return;
      gesture = { canvas, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
        shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
      // Pixi receives down on the canvas but up on window capture. Retain down so
      // its earlier up handler cannot toggle native multiselection for this shortcut.
      event.stopImmediatePropagation();
    }, { capture: true });
    on(window, 'pointermove', event => {
      if (replaying || !gesture || event.pointerId !== gesture.pointerId) return;
      if (Math.abs(event.clientX - gesture.clientX) + Math.abs(event.clientY - gesture.clientY) <= 4) return;
      const start = gesture;
      gesture = null;
      pointer(start.canvas, 'pointerdown', start, true);
      // The current move then reaches Pixi normally, preserving shift-drag/panning.
    }, { capture: true });
    on(window, 'pointerup', event => {
      if (replaying || !gesture || event.pointerId !== gesture.pointerId || event.button !== 0) return;
      const start = gesture;
      gesture = null;
      event.stopImmediatePropagation();
      if (!enabled() || !event.shiftKey || !plain(event)) { replayClick(start, event, true); return; }
      if (event.target !== start.canvas) return;
      suppressClick = { x: event.clientX, y: event.clientY, until: performance.now() + 500 };
      begin(start, event);
    }, { capture: true });
    on(window, 'click', event => {
      if (replaying) return;
      if (suppressClick && event.target instanceof HTMLCanvasElement && event.target.id === 'stage'
          && event.shiftKey && performance.now() < suppressClick.until
          && Math.hypot(event.clientX - suppressClick.x, event.clientY - suppressClick.y) < 8) {
        suppressClick = null;
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (flow && !inMenu(event)) cancel();
    }, { capture: true });
    on(window, 'keydown', event => {
      if (replaying) return;
      if (event.key === 'Escape' && flow?.host) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel(); escapeNativeMenus(); return;
      }
      if (!inMenu(event) && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) cancel();
    }, { capture: true });
    on(window, 'pointercancel', () => { gesture = null; }, { capture: true });
    for (const name of ['scroll', 'wheel']) on(window, name, event => { if (!inMenu(event)) cancel(); }, { capture: true });
    for (const name of ['resize', 'pagehide', 'popstate', 'hashchange']) on(window, name, () => cancel(), { capture: true });
    on(window, 'blur', () => cancel());
    return { cancel, destroy() { cancel(); destroyed = true; scope.abort(); maskStyle.remove(); } };
  }
  // END SHIFT PRESETS

  // BEGIN NATIVE MISSION ADAPTER
  // Native UI adapter for a single-origin deferred fleet mission.
  // No network methods are used: all dispatches pass through the game's buttons.
  function createNativeMissionAdapter({
    getContext, getFleet, canAct = () => true, onBusyChange = () => {},
    onChange = () => {}, resolveTarget = null,
  } = {}) {
    const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const MASK = 'data-oldlight-mission-preparing';
    const GUARD_MS = 130;
    const SETTLE_MS = 8000;
    const QUIET_MS = 1500;
    const WAIT_CODE = 'OLDLIGHT_MISSION_WAIT';
    const waitError = message => Object.assign(new Error(message), { code: WAIT_CODE });
    const captures = new WeakMap();
    const attached = new Map();
    const attempted = new Set();
    const lifetime = new AbortController();
    const style = document.createElement('style');
    style.textContent = `dialog[${MASK}] {display:none!important}dialog[${MASK}]::backdrop {display:none!important;background:transparent!important}`;
    document.head.append(style);
    let active = null;
    let capturing = false;
    let destroyed = false;
    let quietUntil = 0;

    const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const keyOf = button => clean(button?.getAttribute('aria-label') || button?.textContent);
    const unavailable = button => !(button instanceof HTMLButtonElement) || button.disabled
      || button.getAttribute('aria-disabled') === 'true'
      || Boolean(button.closest('.dispatch-preset-tile-locked'));
    const nativeDialog = () => {
      const nodes = document.querySelectorAll('#dispatch-dialog');
      return nodes.length === 1 && nodes[0] instanceof HTMLDialogElement ? nodes[0] : null;
    };
    const route = dialog => dialog?.querySelector('[data-field="dispatch-route-slot"] .route-header');
    const columns = dialog => [...route(dialog)?.querySelectorAll(':scope > .route-header-tile-col') || []];
    const routeKey = dialog => {
      const cols = columns(dialog);
      return cols.length === 2 ? cols.map(col => col.innerHTML).join('\n') : null;
    };
    const inform = value => { try { onChange(value); } catch (_) {} };
    const busyChanged = () => { try { onBusyChange(Boolean(active || capturing)); } catch (_) {} };

    function context() {
      let value;
      try { value = getContext?.(); } catch (_) { return null; }
      if (!value || !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '')
          || value.selectionCount !== 1) return null;
      const originName = clean(value.originName);
      if (!originName || originName.length > 400 || /^\d+ systems selected$/i.test(originName)) return null;
      return { scope: value.scope, originId: value.originId.toLowerCase(), originName, selectionCount: 1 };
    }

    function quantities(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).some(key => !SHIPS.includes(key))) return null;
      const result = {};
      for (const type of SHIPS) {
        const amount = value[type] ?? 0;
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 50000) return null;
        result[type] = amount;
      }
      return SHIPS.some(type => result[type] > 0) ? result : null;
    }

    function presetAmounts(button) {
      const result = Object.fromEntries(SHIPS.map(type => [type, 0]));
      const label = keyOf(button).replace(/^Use\s+/i, '');
      if (!label) return null;
      for (const part of label.split(/,\s+(?=\d)/)) {
        const match = /^([\d\s,.'’]+)\s+(Probe|Marauder|Sentinel|Vanguard)$/i.exec(part);
        const amount = match ? Number(match[1].replace(/[^\d]/g, '')) : NaN;
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 50000) return null;
        const type = match[2].toLowerCase();
        if (result[type]) return null;
        result[type] = amount;
      }
      return quantities(result);
    }

    function sameAmounts(left, right) {
      return Boolean(left && right && SHIPS.every(type => left[type] === right[type]));
    }

    function exactCounts() {
      const result = {};
      for (const type of SHIPS) {
        let value;
        try { value = getFleet?.(type); } catch (_) { return null; }
        if (!value || !['parked', 'away', 'building'].every(key =>
          Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
        result[type] = { parked: value.parked, away: value.away, building: value.building };
      }
      return result;
    }

    function enough(expected) {
      const counts = exactCounts();
      return Boolean(counts && SHIPS.every(type => counts[type].parked >= expected[type]));
    }

    function coordinate(value) {
      return value && Number.isSafeInteger(value.q) && Number.isSafeInteger(value.r)
        && Math.abs(value.q) <= 10000000 && Math.abs(value.r) <= 10000000
        ? { q: value.q, r: value.r } : null;
    }

    const sameCoordinate = (left, right) => Boolean(left && right && left.q === right.q && left.r === right.r);

    function inspectCoordinate(inspector) {
      if (!(inspector instanceof HTMLDialogElement)
          || !inspector.matches('.info-modal[data-content-type="inspect"]')) return null;
      const copy = inspector.querySelector('.inspect-copy-coord');
      let text = copy?.getAttribute('aria-label')?.replace(/^(?:Copy|Copied) coordinates\s+/i, '')
        || copy?.textContent || '';
      if (!text) {
        const label = [...inspector.querySelectorAll('.inspect-facts dt')]
          .find(node => clean(node.textContent) === 'Coordinates');
        text = label?.nextElementSibling?.textContent || '';
      }
      const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(text);
      return match ? coordinate({ q: Number(match[1]), r: Number(match[2]) }) : null;
    }

    function specOf(job) {
      const value = job?.spec || job;
      const requested = quantities(value?.quantities);
      const point = coordinate(value?.target?.coordinate);
      const key = clean(value?.target?.presetKey);
      const routeSignature = value?.target?.routeKey;
      const amountsMode = value?.target?.mode === 'amounts';
      const customMode = value?.target?.mode === 'custom';
      const missionAction = value?.target?.missionAction;
      const originPoint = coordinate(value?.target?.originCoordinate);
      if (!value || !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '')
          || !requested || !point || key.length > 2000
          || typeof routeSignature !== 'string' || routeSignature.length > 200000) return null;
      if (amountsMode) {
        if (!originPoint || sameCoordinate(originPoint, point) || key || routeSignature !== '' || missionAction !== undefined) return null;
      } else if ((!customMode && value.target.mode !== undefined) || value.target.originCoordinate !== undefined || !key
          || (missionAction !== undefined && !['attack', 'send'].includes(missionAction))) return null;
      return { scope: value.scope, originId: value.originId.toLowerCase(),
        originName: clean(value.originName).slice(0, 400),
        target: { coordinate: point, routeKey: routeSignature, presetKey: key,
          label: clean(value.target.label).slice(0, 400),
          ...(amountsMode ? { mode: 'amounts', originCoordinate: originPoint } : {}),
          ...(customMode ? { mode: 'custom' } : {}),
          ...(missionAction ? { missionAction } : {}) }, quantities: requested };
    }

    function signature(spec) {
      const parts = [spec.scope, spec.originId, spec.target.coordinate,
        spec.target.routeKey, spec.target.presetKey, spec.quantities];
      if (spec.target.mode === 'amounts') parts.push(spec.target.mode, spec.target.originCoordinate);
      if (spec.target.mode === 'custom') parts.push(spec.target.mode);
      if (spec.target.missionAction) parts.push(spec.target.missionAction);
      return JSON.stringify(parts);
    }

    function attemptKey(job) {
      const claimedAt = Number.isSafeInteger(job?.claimedAt) && job.claimedAt >= 0
        ? job.claimedAt : null;
      // The durable queue creates a fresh claim only after an explicit review of
      // an uncertain send. Retrying that same claim must never send twice.
      return JSON.stringify([job?.id, claimedAt]);
    }

    function sameContext(spec) {
      const current = context();
      return Boolean(current && current.scope === spec.scope && current.originId === spec.originId);
    }

    function result(status, message) { return { status, message }; }
    function failure(message) { return { spec: null, handle: null, message }; }
  function readyToAct(job = active?.job) { try { return !destroyed && canAct(job) !== false; } catch (_) { return false; } }

    function resetPreparedDialog(dialog) {
      // A prepared dialog never entered the native modal stack. Do not queue a
      // delayed close event that could erase a later dispatch's native origins.
      if (dialog.open) dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }

    function maskedInspector(click, allowedDialog = null) {
      const modals = [...document.querySelectorAll('dialog.info-modal')];
      if (!modals.length || modals.some(modal => modal.open)
          || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== allowedDialog)) {
        throw new Error('Cierra los diálogos del juego antes de preparar esta misión.');
      }
      const previousFocus = document.activeElement;
      const saved = modals.map(modal => ({ modal, mask: modal.getAttribute(MASK),
        content: modal.dataset.contentType, body: modal.querySelector('.info-modal-body')?.firstChild }));
      let opened = null;
      try {
        for (const { modal } of saved) { modal.setAttribute(MASK, 'inspect'); modal.setAttribute('open', ''); }
        click();
        const changed = saved.filter(({ modal, content, body }) => modal.dataset.contentType === 'inspect'
          && (content !== 'inspect' || modal.querySelector('.info-modal-body')?.firstChild !== body));
        if (changed.length !== 1) throw new Error('No se pudo identificar el destino del despacho.');
        opened = changed[0].modal;
        const point = inspectCoordinate(opened);
        if (!point) throw new Error('El juego no ha mostrado unas coordenadas válidas para el destino.');
        const action = opened.querySelector('.inspect-actions > button.inspect-action-btn');
        return { coordinate: point, label: clean(opened.querySelector('.inspect-system-name-text')?.textContent),
          isActive: !opened.querySelector('.info-modal-trailing .info-modal-header-btn'),
          missionAction: inspectorMissionAction(action),
          action: unavailable(action) ? null : action };
      } finally {
        for (const { modal, mask, content, body } of saved) {
          modal.removeAttribute('open');
          const changed = modal === opened || modal.dataset.contentType !== content
            || modal.querySelector('.info-modal-body')?.firstChild !== body;
          if (changed) modal.dispatchEvent(new Event('close'));
          if (mask === null) modal.removeAttribute(MASK); else modal.setAttribute(MASK, mask);
        }
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected && document.activeElement !== previousFocus) {
          try { previousFocus.focus({ preventScroll: true }); } catch (_) {}
        }
      }
    }

    function makeCapture(current, requested, presetKey, target, binding) {
      const spec = specOf({ ...current, quantities: requested,
        target: { ...target, presetKey: clean(presetKey) } });
      if (!spec || !sameContext(spec) || !exactCounts()) return failure('El sistema de origen ha cambiado. Selecciona un solo sistema y vuelve a intentarlo.');
      const handle = binding ? {} : null;
      if (handle) captures.set(handle, { spec, ...binding });
      inform({ type: 'captured', spec });
      return { spec, handle };
    }

    function capture(dialog, requestedInput, presetKey) {
      if (destroyed || active || capturing) return failure('Ya hay una misión en preparación.');
      const current = context(), requested = quantities(requestedInput);
      if (!current || !requested || !exactCounts()) return failure('La misión diferida necesita un único sistema de origen con recuentos exactos.');
      const cols = columns(dialog), originalRoute = routeKey(dialog);
      if (!(dialog instanceof HTMLDialogElement) || dialog !== nativeDialog() || !dialog.open
          || dialog.dataset.mode !== 'dispatch' || dialog.dataset.direction !== 'forward'
          || cols.length !== 2 || !originalRoute
          || /^\d+ systems selected$/i.test(clean(cols[0].querySelector('.route-header-tile-name')?.textContent))) {
        return failure('Abre un despacho desde un único sistema antes de guardar la misión.');
      }
      const sourceButton = cols[0].querySelector('button.route-header-hex-clickable');
      const button = cols[1].querySelector('button.route-header-hex-clickable');
      const preset = [...dialog.querySelectorAll('[data-field="dispatch-presets"] .dispatch-preset-apply')]
        .find(node => keyOf(node) === clean(presetKey) && sameAmounts(presetAmounts(node), requested));
      if (unavailable(sourceButton) || unavailable(button) || unavailable(preset)) return failure('El preset o el destino ya no está disponible.');
      capturing = true; busyChanged();
      try {
        const source = maskedInspector(() => sourceButton.click(), dialog);
        if (!source.isActive) return failure('El origen del despacho ya no es tu sistema activo. Vuelve a abrir el preset.');
        const endpoint = maskedInspector(() => button.click(), dialog);
        if (routeKey(dialog) !== originalRoute) return failure('La ruta ha cambiado durante la preparación.');
        return makeCapture(current, requested, presetKey, { routeKey: originalRoute,
          label: endpoint.label || clean(cols[1].querySelector('.route-header-tile-name')?.textContent),
          ...(endpoint.missionAction ? { missionAction: endpoint.missionAction } : {}),
          coordinate: endpoint.coordinate }, { kind: 'inspect', button });
      } catch (error) { return failure(error.message || 'No se pudo preparar el destino de la misión.'); }
      finally { capturing = false; busyChanged(); }
    }

    function captureInspect(inspector, requestedInput, presetKey) {
      if (destroyed || active || capturing) return failure('Ya hay una misión en preparación.');
      const current = context(), requested = quantities(requestedInput), point = inspectCoordinate(inspector);
      if (!current || !requested || !point || !exactCounts()) return failure('La misión diferida necesita un único origen y las coordenadas del destino.');
      if (!inspector.querySelector('.info-modal-trailing .info-modal-header-btn')) return failure('El destino es tu sistema activo. Elige otro sistema para enviar la misión.');
      const action = inspector.querySelector('.inspect-actions > button.inspect-action-btn');
      return makeCapture(current, requested, presetKey, { routeKey: '', coordinate: point,
        ...(inspectorMissionAction(action) ? { missionAction: inspectorMissionAction(action) } : {}),
        label: clean(inspector.querySelector('.inspect-system-name-text')?.textContent) },
      unavailable(action) ? null : { kind: 'dispatch', button: action });
    }

    function captureRadial(inspectButton, requestedInput, presetKey) {
      if (destroyed || active || capturing) return failure('Ya hay una misión en preparación.');
      const current = context(), requested = quantities(requestedInput);
      const radial = inspectButton?.closest('.star-actions');
      if (!current || !requested || !exactCounts()) return failure('La misión diferida necesita un único sistema de origen con recuentos exactos.');
      if (unavailable(inspectButton) || !radial?.isConnected || inspectButton.dataset.actionKey !== 'inspect'
          || inspectButton.dataset.enabled !== 'true' || getComputedStyle(radial).display === 'none') {
        return failure('Vuelve a seleccionar el destino en el mapa.');
      }
      capturing = true; busyChanged();
      try {
        const endpoint = maskedInspector(() => inspectButton.click());
        if (endpoint.isActive) return failure('El destino es tu sistema activo. Elige otro sistema para enviar la misión.');
        // The radial button reads the current radial target on every invocation.
        // Keep only the coordinates, never retain this mutable button as a handle.
        // This identity-only capture can be paired with another cached preset.
        return makeCapture(current, requested, presetKey, { routeKey: '',
          ...(endpoint.missionAction ? { missionAction: endpoint.missionAction } : {}),
          label: endpoint.label, coordinate: endpoint.coordinate }, null);
      } catch (error) { return failure(error.message || 'No se pudo identificar el destino del mapa.'); }
      finally { capturing = false; busyChanged(); }
    }

    function attach(jobId, captured) {
      if (destroyed || typeof jobId !== 'string' || !jobId || jobId.length > 128) return false;
      const spec = specOf(captured?.spec), binding = captured?.handle ? captures.get(captured.handle) : null;
      if (!spec || (binding && signature(binding.spec) !== signature(spec))) return false;
      if (binding) attached.set(jobId, binding); else attached.delete(jobId);
      inform({ type: 'attached', jobId, connected: Boolean(binding) });
      return true;
    }

    function connected(job) {
      const spec = specOf(job), binding = attached.get(job?.id);
      return Boolean(!destroyed && spec && !attempted.has(attemptKey(job))
        && ((binding && signature(binding.spec) === signature(spec)) || typeof resolveTarget === 'function'));
    }

    function delay(ms, operation) {
      return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(operation.controller.signal.reason
          || waitError(operation.reason || 'Esperando para continuar la preparación.')); };
        const timer = setTimeout(() => { operation.controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
        if (operation.controller.signal.aborted) abort();
        else operation.controller.signal.addEventListener('abort', abort, { once: true });
      });
    }

    function validOperation(operation) {
      return active === operation && !operation.controller.signal.aborted && readyToAct() && sameContext(operation.spec);
    }

    function assertOperation(operation) {
      if (!validOperation(operation)) throw operation.controller.signal.reason
        || waitError(operation.reason || 'Esperando a que el origen, la selección y el helper estén disponibles.');
    }

    function readError(dialog) {
      const error = dialog?.querySelector('[data-field="dispatch-error"]');
      return error && !error.hidden ? clean(error.textContent) : '';
    }

    function singleNativeRoute(dialog) {
      const cols = columns(dialog);
      return cols.length === 2 && !/^\d+ systems selected$/i.test(clean(cols[0].querySelector('.route-header-tile-name')?.textContent));
    }

    function inputsMatch(dialog, requested) {
      const inputs = [...dialog.querySelectorAll('[data-field="dispatch-quantities"] input.dispatch-step-input')];
      return SHIPS.every(type => {
        const matches = inputs.filter(input => clean(input.getAttribute('aria-label')).toLowerCase() === `number of ${type} to send`);
        return matches.length === 1 && Number(matches[0].value) === requested[type];
      });
    }

    function applyAmounts(operation) {
      const dialog = operation.dialog, requested = operation.spec.quantities;
      const inputs = [...dialog.querySelectorAll('[data-field="dispatch-quantities"] input.dispatch-step-input')];
      const disabled = input => input.matches(':disabled') || input.getAttribute('aria-disabled') === 'true';
      const withinBounds = (input, amount) => amount === 0 || (input.max !== '' &&
        Number.isSafeInteger(Number(input.max)) && Number(input.max) >= amount &&
        (input.min === '' || (Number.isSafeInteger(Number(input.min)) && Number(input.min) <= amount)));
      if (inputs.length !== SHIPS.length) return false;
      const byType = new Map();
      for (const type of SHIPS) {
        const matches = inputs.filter(input => clean(input.getAttribute('aria-label')).toLowerCase() === `number of ${type} to send`);
        if (matches.length !== 1 || !(matches[0] instanceof HTMLInputElement) || matches[0].type !== 'number') return false;
        const input = matches[0];
        // A locked zero row stays untouched. Never enable a native control or
        // exceed a native clamp merely to match the requested attack size.
        if (disabled(input) && (requested[type] !== 0 || Number(input.value) !== 0)) return false;
        if (!withinBounds(input, requested[type])) return false;
        byType.set(type, input);
      }
      for (const type of SHIPS) {
        const input = byType.get(type);
        if (disabled(input) || Number(input.value) === requested[type]) continue;
        input.value = String(requested[type]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        assertOperation(operation);
        if (!input.isConnected) return false;
        // Native typing updates the route on input and clamps the count on blur.
        // Commit that normal blur path before comparing the final full fleet.
        input.dispatchEvent(new Event('blur'));
        assertOperation(operation);
        if (!input.isConnected || Number(input.value) !== requested[type] || !withinBounds(input, requested[type])) return false;
      }
      return inputsMatch(dialog, requested);
    }

    function isAttackAction(button) {
      return button instanceof HTMLButtonElement && clean(button.textContent) === 'Attack';
    }

    function inspectorMissionAction(button) {
      if (!(button instanceof HTMLButtonElement)) return null;
      const name = clean(button.textContent);
      return name === 'Attack' ? 'attack' : name === 'Send fleet' ? 'send' : null;
    }

    function confirmationMissionAction(button) {
      if (!(button instanceof HTMLButtonElement)) return null;
      const name = clean(button.textContent);
      return name === 'Attack' ? 'attack' : name === 'Send' ? 'send' : null;
    }

    function restoreMask(operation) {
      if (!operation.dialog) return;
      if (operation.previousMask === null) operation.dialog.removeAttribute(MASK);
      else operation.dialog.setAttribute(MASK, operation.previousMask);
    }

    function expose(operation, message) {
      operation.keepDialog = true;
      restoreMask(operation);
      if (message && operation.dialog?.open && !readError(operation.dialog)) {
        const error = operation.dialog.querySelector('[data-field="dispatch-error"]');
        if (error) { error.textContent = message; error.hidden = false; }
      }
    }

    async function actionFor(operation, binding) {
      if (binding?.kind === 'inspect') {
        const endpoint = maskedInspector(() => binding.button.click());
        if (!sameCoordinate(endpoint.coordinate, operation.spec.target.coordinate)) throw new Error('El destino ya no coincide con la misión guardada.');
        return endpoint.action;
      }
      if (binding?.kind === 'dispatch') return unavailable(binding.button) ? null : binding.button;
      if (typeof resolveTarget !== 'function') return null;
      const resolved = await resolveTarget(operation.job, { signal: operation.controller.signal });
      try {
        assertOperation(operation);
        const inspector = resolved?.inspector;
        if (!sameCoordinate(inspectCoordinate(inspector), operation.spec.target.coordinate)) throw new Error('No se ha podido recuperar el destino guardado.');
        const action = inspector.querySelector('.inspect-actions > button.inspect-action-btn');
        return unavailable(action) ? null : action;
      } finally { if (typeof resolved?.cleanup === 'function') await resolved.cleanup(); }
    }

    async function dispatch(job) {
      const spec = specOf(job), jobId = job?.id;
      if (destroyed || !spec || typeof jobId !== 'string') return result('paused', 'La misión guardada no tiene un origen, destino o preset válido.');
      const claim = attemptKey(job);
      if (attempted.has(claim)) return result('uncertain', 'Esta misión ya pasó al juego. Comprueba sus movimientos antes de volver a enviarla.');
      if (active || capturing) return result('waiting', 'Hay otra misión en preparación.');
      if (!readyToAct(job)) return result('waiting', 'Esperando a que el helper pueda actuar.');
      if (quietUntil > 0 && performance.now() < quietUntil) return result('waiting', 'Esperando a que termines de interactuar con el juego.');
      if (!sameContext(spec)) return result('waiting', `Selecciona ${spec.originName || 'el sistema de origen'} para continuar esta misión.`);
      if (!enough(spec.quantities)) return result('waiting', 'Esperando a que todas las naves del preset estén en base.');
      const customMode = spec.target.mode === 'custom';
      let binding = attached.get(jobId);
      if (binding && signature(binding.spec) !== signature(spec)) {
        if (customMode && typeof resolveTarget === 'function') { attached.delete(jobId); binding = null; }
        else return result('paused', 'La misión ha cambiado. Reconecta el preset y el destino antes de continuar.');
      }
      if (!binding && typeof resolveTarget !== 'function') return result('paused', 'Misión guardada. Reconecta su destino con Shift + clic y el mismo preset para reanudarla.');
      if (document.querySelector('dialog[open]')) return result('waiting', 'Cierra los diálogos del juego para continuar la misión.');
      const operation = { job, jobId, spec, controller: new AbortController(), dialog: null,
        previousMask: null, confirmed: false, permitConfirm: false, keepDialog: false,
        closed: false, reason: '', guard: null, missionAction: spec.target.missionAction || null };
      active = operation; busyChanged();
      let outcome;
      try {
        const action = await actionFor(operation, binding);
        if (spec.target.mode === 'amounts' && action && !isAttackAction(action)) {
          throw new Error('El destino ya no ofrece la acción Attack. El reintento se ha pausado.');
        }
        if (customMode && action) {
          const missionAction = inspectorMissionAction(action);
          if (!missionAction || (operation.missionAction && missionAction !== operation.missionAction)) {
            throw new Error('El tipo de misión del destino ha cambiado. Revisa el despacho antes de continuar.');
          }
          // Legacy preset jobs have no saved action. Resolve it from the verified
          // native Inspector, then require the same action throughout this send.
          operation.missionAction = missionAction;
        }
        // Let previously queued native close handlers finish before opening a new
        // dispatch session, otherwise they may clear the new native origin list.
        await delay(0, operation);
        assertOperation(operation);
        if (unavailable(action) || !enough(spec.quantities)) return outcome = result('waiting', 'El juego todavía no permite preparar la flota completa.');
        const dialog = nativeDialog();
        if (!dialog) throw new Error('El despacho del juego no está disponible.');
        if (document.querySelector('dialog[open]')) throw waitError('Cierra los diálogos del juego para continuar la misión.');
        operation.dialog = dialog; operation.previousMask = dialog.getAttribute(MASK);
        const oldRoute = route(dialog);
        dialog.setAttribute(MASK, 'dispatch'); dialog.setAttribute('open', '');
        action.click();
        if (!dialog.open || dialog.dataset.mode !== 'dispatch' || dialog.dataset.direction !== 'forward'
            || route(dialog) === oldRoute || !singleNativeRoute(dialog)) throw new Error('El juego no ha abierto un despacho de un único origen.');
        await delay(GUARD_MS, operation);
        assertOperation(operation);
        const openedRoute = routeKey(dialog);
        if (!openedRoute || (spec.target.routeKey && openedRoute !== spec.target.routeKey)) throw new Error('La ruta ha cambiado. Reconecta el destino antes de enviar.');
        if (spec.target.mode === 'amounts') {
          const source = columns(dialog)[0].querySelector('button.route-header-hex-clickable');
          if (unavailable(source)) throw new Error('No se puede comprobar el origen del ataque.');
          const identity = maskedInspector(() => source.click(), dialog);
          if (!identity.isActive || !sameCoordinate(identity.coordinate, spec.target.originCoordinate)) {
            throw new Error('Las coordenadas del origen no coinciden con el ataque guardado.');
          }
          assertOperation(operation);
        }
        const endpoint = columns(dialog)[1].querySelector('button.route-header-hex-clickable');
        if (unavailable(endpoint)) throw new Error('No se puede comprobar el destino del despacho.');
        const identity = maskedInspector(() => endpoint.click(), dialog);
        if (!sameCoordinate(identity.coordinate, spec.target.coordinate)) throw new Error('Las coordenadas del destino no coinciden con la misión.');
        if (spec.target.mode === 'amounts' && (identity.isActive || !isAttackAction(identity.action))) {
          throw new Error('El destino ya no permite un ataque. El reintento se ha pausado.');
        }
        if (customMode && (identity.isActive || !operation.missionAction || identity.missionAction !== operation.missionAction)) {
          throw new Error('El destino o su tipo de misión ha cambiado. Se ha pausado la preparación.');
        }
        assertOperation(operation);
        if (!enough(spec.quantities)) return outcome = result('waiting', 'Las naves disponibles han cambiado; se esperará al preset completo.');
        const amountsMode = spec.target.mode === 'amounts';
        const directAmounts = amountsMode || customMode;
        const preset = directAmounts ? null : [...dialog.querySelectorAll('[data-field="dispatch-presets"] .dispatch-preset-apply')]
          .find(button => keyOf(button) === spec.target.presetKey && sameAmounts(presetAmounts(button), spec.quantities));
        const confirm = dialog.querySelector('[data-field="dispatch-confirm"]');
        if ((!directAmounts && unavailable(preset)) || !(confirm instanceof HTMLButtonElement) || confirm.hidden) throw new Error('El despacho guardado ya no está disponible. Vuelve a seleccionarlo.');
        if (amountsMode && !isAttackAction(confirm)) throw new Error('El juego ya no ofrece la confirmación Attack para este destino.');
        if (customMode && confirmationMissionAction(confirm) !== operation.missionAction) throw new Error('La confirmación del juego no coincide con el tipo de misión preparado.');
        operation.guard = event => {
          if (event.target !== confirm) return;
          // Other capture listeners can change saved intent or the native form
          // during click(). Recheck the exact fleet before accepting that click.
          let allowed = false;
          try {
            allowed = operation.permitConfirm && !operation.confirmed && validOperation(operation)
              && dialog.open && confirm.isConnected && dialog.querySelector('[data-field="dispatch-confirm"]') === confirm
              && routeKey(dialog) === openedRoute && singleNativeRoute(dialog)
              && inputsMatch(dialog, spec.quantities) && enough(spec.quantities)
              && (!amountsMode || isAttackAction(confirm))
              && (!customMode || confirmationMissionAction(confirm) === operation.missionAction)
              && !confirm.disabled && !readError(dialog);
          } catch (_) { /* A failed check must also prevent the native send. */ }
          if (allowed) {
            operation.confirmed = true; attempted.add(claim); return;
          }
          event.preventDefault(); event.stopImmediatePropagation();
        };
        window.addEventListener('click', operation.guard, true);
        if (directAmounts) {
          if (!applyAmounts(operation)) return outcome = result('waiting', 'El juego ha ajustado las cantidades. Se esperará a la flota completa sin enviar una misión parcial.');
        } else preset.click();
        assertOperation(operation);
        if (routeKey(dialog) !== openedRoute || !singleNativeRoute(dialog)) throw new Error('La ruta ha cambiado al aplicar el preset.');
        if (!enough(spec.quantities) || !inputsMatch(dialog, spec.quantities)) return outcome = result('waiting', 'El preset aún no está completo. Se esperará sin enviar una flota parcial.');
        if (amountsMode && !isAttackAction(confirm)) throw new Error('El destino ha cambiado y ya no permite Attack.');
        if (customMode && confirmationMissionAction(confirm) !== operation.missionAction) throw new Error('El tipo de misión ha cambiado al ajustar la flota. Se ha pausado el envío.');
        const error = readError(dialog);
        if (confirm.disabled || error) { expose(operation); return outcome = result('paused', error || 'El juego no permite enviar esta misión. Revisa el despacho.'); }
        const onClose = () => { operation.closed = true; };
        dialog.addEventListener('close', onClose, { once: true, signal: operation.controller.signal });
        operation.permitConfirm = true;
        try { confirm.click(); } finally { operation.permitConfirm = false; }
        if (!operation.confirmed) {
          // A context change in another capture listener can block this click
          // before it reaches the game. Retry only with the same verified form;
          // route, action and composition changes still require review.
          if (!validOperation(operation) && routeKey(dialog) === openedRoute && singleNativeRoute(dialog)
              && inputsMatch(dialog, spec.quantities) && (!amountsMode || isAttackAction(confirm))
              && (!customMode || confirmationMissionAction(confirm) === operation.missionAction)) {
            throw operation.controller.signal.reason || waitError('El origen o el helper cambió antes del envío. Esperando para continuar.');
          }
          throw new Error('El juego no aceptó el clic de envío.');
        }
        const started = performance.now();
        while (performance.now() - started < SETTLE_MS) {
          if (operation.controller.signal.aborted) throw new Error(operation.reason || 'Se ha interrumpido la espera de confirmación.');
          const other = [...document.querySelectorAll('dialog[open]')].find(node => node !== dialog);
          const nativeError = readError(dialog);
          if (other || nativeError) {
            expose(operation);
            return outcome = result('uncertain', other
              ? 'El juego requiere una confirmación especial. Resuélvela en su diálogo; la misión no se reenviará automáticamente.'
              : `${nativeError} Comprueba la misión en el juego antes de reintentar.`);
          }
          if (!dialog.open && operation.closed) return outcome = result('sent', 'El juego ha aceptado el envío de la misión.');
          await delay(25, operation);
        }
        expose(operation);
        return outcome = result('uncertain', 'No se ha recibido una confirmación clara del juego. Comprueba sus movimientos antes de volver a enviar.');
      } catch (error) {
        if (operation.confirmed) {
          expose(operation);
          return outcome = result('uncertain', `${error.message || 'Envío sin confirmar.'} Comprueba sus movimientos antes de reintentar.`);
        }
        // Only known, pre-send interruptions may retry automatically. Unknown
        // errors and identity/action mismatches remain paused for review.
        return outcome = result(error?.code === WAIT_CODE ? 'waiting' : 'paused', error?.message || 'No se pudo preparar la misión.');
      } finally {
        if (operation.guard) window.removeEventListener('click', operation.guard, true);
        if (operation.dialog && !operation.keepDialog && operation.dialog.open) resetPreparedDialog(operation.dialog);
        restoreMask(operation);
        operation.controller.abort();
        if (active === operation) active = null;
        busyChanged(); inform({ type: 'dispatch', jobId, result: outcome });
      }
    }

    function cancel(jobId = null, message = 'Preparación cancelada.') {
      if (!active || (jobId !== null && active.jobId !== jobId)) return false;
      active.reason = message;
      active.controller.abort(waitError(message));
      return true;
    }

    function detach(jobId) {
      cancel(jobId, 'Se ha retirado esta misión de la cola.');
      const removed = attached.delete(jobId);
      inform({ type: 'detached', jobId });
      return removed;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true; cancel(null, 'El helper se ha detenido.');
      attached.clear(); lifetime.abort(); style.remove();
    }

    for (const eventName of ['pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(eventName, event => {
        if (!event.isTrusted) return;
        quietUntil = performance.now() + QUIET_MS;
        if (active) cancel(active.jobId, 'Esperando a que termines de interactuar con el juego.');
      }, { capture: true, signal: lifetime.signal });
    }
    return { capture, captureInspect, captureRadial, attach, dispatch, connected, detach, cancel, destroy,
      isBusy: () => Boolean(active || capturing) };
  }
  // END NATIVE MISSION ADAPTER

  // BEGIN MISSION TARGET RESOLVER
// Recover a saved destination through the native map and Inspector controls.
// This resolver never builds ships, changes the active system, or submits fleets.
function createMissionTargetResolver({ getContext, canAct = () => true } = {}) {
  const WAIT_CODE = 'OLDLIGHT_MISSION_WAIT';
  const waitError = message => Object.assign(new Error(message), { code: WAIT_CODE });
  const MASK = 'data-oldlight-target-preparing';
  const POINTER_ID = 2147483647;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let current = null;
  let destroyed = false;
  const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const one = selector => {
    const nodes = document.querySelectorAll(selector);
    return nodes.length === 1 ? nodes[0] : null;
  };
  const displayed = element => Boolean(element?.isConnected && !element.hidden
    && !element.closest('[hidden]') && element.getClientRects().length
    && getComputedStyle(element).display !== 'none');
  const enabledButton = element => element instanceof HTMLButtonElement && !element.disabled
    && element.getAttribute('aria-disabled') !== 'true';
  const sameCoordinate = (left, right) => Boolean(left && right && left.q === right.q && left.r === right.r);
  function coordinate(value) {
    return value && Number.isSafeInteger(value.q) && Number.isSafeInteger(value.r)
      && Math.abs(value.q) <= 10000000 && Math.abs(value.r) <= 10000000
      ? { q: value.q, r: value.r } : null;
  }
  function inspectCoordinate(root) {
    const copy = root?.querySelector('.inspect-copy-coord');
    let value = copy?.getAttribute('aria-label')?.replace(/^(?:Copy|Copied) coordinates\s+/i, '')
      || copy?.textContent || '';
    if (!value) {
      const label = [...root?.querySelectorAll('.inspect-facts dt') || []]
        .find(node => clean(node.textContent) === 'Coordinates');
      value = label?.nextElementSibling?.textContent || '';
    }
    const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(value);
    return match ? coordinate({ q: Number(match[1]), r: Number(match[2]) }) : null;
  }
  function jobSpec(job) {
    const value = job?.spec || job;
    const point = coordinate(value?.target?.coordinate);
    return value && SCOPE.test(value.scope || '') && UUID.test(value.originId || '') && point
      ? { scope: value.scope, originId: value.originId.toLowerCase(), coordinate: point } : null;
  }
  function contextMatches(spec) {
    let value;
    try { value = getContext?.(); } catch (_) { return false; }
    return Boolean(value && value.scope === spec.scope && UUID.test(value.originId || '')
      && value.originId.toLowerCase() === spec.originId && value.selectionCount === 1);
  }
  function assertOperation(operation) {
    if (destroyed || current !== operation || operation.controller.signal.aborted) {
      throw operation.controller.signal.reason || waitError(operation.reason || 'Esperando para recuperar el destino.');
    }
    let permitted = false;
    try { permitted = canAct() !== false; } catch (_) {}
    if (!permitted) throw waitError('Esperando a que el helper pueda recuperar el destino.');
    if (!contextMatches(operation.spec)) {
      throw waitError('El origen, la cuenta o la selección han cambiado. Selecciona el sistema de origen para continuar.');
    }
    if (performance.now() > operation.deadline) throw waitError('Esperando a que el mapa termine de cargar el destino.');
    const foreign = [...document.querySelectorAll('dialog[open]')].find(dialog => !operation.dialogs.has(dialog));
    if (foreign) throw waitError('El juego ha abierto otro diálogo. Ciérralo para continuar esta misión.');
  }
  function mask(operation, node) {
    if (!operation.masks.has(node)) operation.masks.set(node, {
      value: node.getAttribute(MASK), inert: node.getAttribute('inert'),
    });
    node.setAttribute(MASK, '');
    node.setAttribute('inert', '');
  }
  function restoreMask(operation, node) {
    const saved = operation.masks.get(node);
    if (!saved) return;
    if (saved.value === null) node.removeAttribute(MASK); else node.setAttribute(MASK, saved.value);
    if (saved.inert === null) node.removeAttribute('inert'); else node.setAttribute('inert', saved.inert);
    operation.masks.delete(node);
  }
  function prepareDialog(operation, dialog) {
    assertOperation(operation);
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('El diálogo del juego no está disponible.');
    if (dialog.open) throw waitError('Cierra los diálogos del juego para continuar la misión.');
    operation.dialogs.set(dialog, { content: dialog.dataset.contentType,
      body: dialog.querySelector('.info-modal-body')?.firstChild, used: false });
    mask(operation, dialog);
    // Native Fn leaves an already-open nonmodal dialog outside its stack.
    dialog.setAttribute('open', '');
  }
  function releaseDialog(operation, dialog) {
    const saved = operation.dialogs.get(dialog);
    if (!saved) return;
    operation.dialogs.delete(dialog);
    // The normal path never invokes showModal/close, so no delayed close event
    // can clear the native state of the adapter's next dispatch.
    if (dialog.matches(':modal')) {
      const settled = new Promise(resolve => {
        const finish = () => { clearTimeout(timer); dialog.removeEventListener('close', finish); resolve(); };
        const timer = setTimeout(finish, 1000);
        dialog.addEventListener('close', finish, { once: true });
        dialog.close();
      });
      operation.closeWaits.push(settled);
    } else {
      dialog.removeAttribute('open');
      const changed = saved.used || dialog.dataset.contentType !== saved.content
        || dialog.querySelector('.info-modal-body')?.firstChild !== saved.body;
      if (changed) dialog.dispatchEvent(new Event('close'));
    }
    restoreMask(operation, dialog);
  }
  function finish(operation) {
    if (operation.finished) return operation.finished;
    // Cleanup is synchronous on the regular nonmodal path and starts before a
    // trusted user event continues to the game's own event handlers.
    operation.listeners.abort();
    operation.observer?.disconnect();
    for (const dialog of [...operation.dialogs.keys()]) releaseDialog(operation, dialog);
    if (operation.nativeMenus) {
      const foreign = document.querySelector('dialog[open]');
      if (!foreign) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    for (const node of [...operation.masks.keys()]) restoreMask(operation, node);
    operation.style.remove();
    if (operation.previousFocus instanceof HTMLElement && operation.previousFocus.isConnected
        && document.activeElement !== operation.previousFocus) {
      try { operation.previousFocus.focus({ preventScroll: true }); } catch (_) {}
    }
    if (current === operation) current = null;
    operation.finished = Promise.all(operation.closeWaits).then(() => undefined);
    return operation.finished;
  }
  function abort(operation, reason) {
    if (operation.controller.signal.aborted) return;
    const error = reason instanceof Error ? reason : waitError(reason);
    operation.reason = error.message;
    operation.controller.abort(error);
    void finish(operation);
  }
  function waitFor(operation, read, message, timeout = 5000) {
    const until = Math.min(operation.deadline, performance.now() + timeout);
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = (error, value) => {
        clearTimeout(timer);
        operation.controller.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve(value);
      };
      const aborted = () => done(operation.controller.signal.reason || waitError(operation.reason || 'Esperando para recuperar el destino.'));
      const check = () => {
        try {
          assertOperation(operation);
          const value = read();
          if (value) { done(null, value); return; }
          if (performance.now() >= until) { done(waitError(message)); return; }
          timer = setTimeout(check, 25);
        } catch (error) { done(error); }
      };
      operation.controller.signal.addEventListener('abort', aborted, { once: true });
      check();
    });
  }
  function pause(operation, milliseconds) {
    const until = performance.now() + milliseconds;
    return waitFor(operation, () => performance.now() >= until, 'La recuperación del destino se ha interrumpido.', milliseconds + 100);
  }
  function center(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw waitError('Esperando a que el mapa tenga una superficie disponible.');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  function pointerClick(operation, element, point, captureCompatibility = false) {
    assertOperation(operation);
    const descriptor = Object.getOwnPropertyDescriptor(element, 'setPointerCapture');
    const realCapture = element.setPointerCapture;
    let patched = false;
    if (captureCompatibility) {
      if (typeof realCapture !== 'function' || (descriptor && descriptor.configurable === false)) {
        throw new Error('El mapa no admite la selección automática. Reconecta el destino desde el juego.');
      }
      // A synthetic pointer has no OS capture record. Only this element and
      // this synchronous helper gesture tolerate that one browser exception.
      Object.defineProperty(element, 'setPointerCapture', { configurable: true, writable: true,
        value(pointerId) {
          try { return Reflect.apply(realCapture, this, [pointerId]); }
          catch (error) {
            if (this === element && pointerId === POINTER_ID && error?.name === 'NotFoundError') return;
            throw error;
          }
        } });
      patched = true;
    }
    try {
      for (const type of ['pointerdown', 'pointerup']) element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: POINTER_ID,
        pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
        clientX: point.x, clientY: point.y,
      }));
    } finally {
      if (patched) {
        if (descriptor) Object.defineProperty(element, 'setPointerCapture', descriptor);
        else delete element.setPointerCapture;
      }
    }
    assertOperation(operation);
  }
  function escapeMenus(operation) {
    assertOperation(operation);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
  function freshRadial(operation, stage) {
    assertOperation(operation);
    if (!(stage instanceof HTMLCanvasElement) || !stage.isConnected) throw new Error('El mapa principal ya no está disponible.');
    const menu = one('#app > .selection-menu');
    const markers = menu?.querySelector('.selection-menu-markers');
    const radial = one('#app > .star-actions');
    if (!menu || !markers || !radial) throw new Error('El juego no ofrece los controles nativos para recuperar el destino.');
    mask(operation, menu); mask(operation, radial);
    escapeMenus(operation);
    const point = center(stage);
    stage.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true,
      button: 2, clientX: point.x, clientY: point.y }));
    operation.nativeMenus = true;
    const hasStar = displayed(menu) && !markers.hidden;
    escapeMenus(operation);
    if (!hasStar) return null;
    pointerClick(operation, stage, point);
    const inspect = radial.querySelector('button.star-action-btn[data-action-key="inspect"]');
    return displayed(radial) && enabledButton(inspect) && inspect.dataset.enabled === 'true' ? { radial, inspect } : null;
  }
  async function openInspector(operation, button) {
    assertOperation(operation);
    const candidates = [...document.querySelectorAll('dialog.info-modal')];
    if (!candidates.length) throw waitError('Esperando a que el juego prepare el Inspector.');
    for (const dialog of candidates) prepareDialog(operation, dialog);
    button.click();
    assertOperation(operation);
    const opened = candidates.filter(dialog => {
      const saved = operation.dialogs.get(dialog);
      return dialog.dataset.contentType === 'inspect'
        && (dialog.dataset.contentType !== saved.content || dialog.querySelector('.info-modal-body')?.firstChild !== saved.body);
    });
    if (opened.length !== 1 || opened[0].matches(':modal')) throw new Error('No se pudo abrir el Inspector del destino sin interferir con el juego.');
    const inspector = opened[0];
    operation.dialogs.get(inspector).used = true;
    for (const dialog of candidates) if (dialog !== inspector) releaseDialog(operation, dialog);
    await waitFor(operation, () => inspectCoordinate(inspector), 'Esperando las coordenadas del Inspector del destino.', 2000);
    return inspector;
  }
  async function resolveTarget(job, { signal } = {}) {
    if (destroyed) throw new Error('El helper se ha detenido.');
    if (current) throw waitError('Esperando a que termine la preparación de otra misión.');
    const spec = jobSpec(job);
    if (!spec) throw new Error('La misión no tiene un origen y destino válidos.');
    if (!contextMatches(spec)) throw waitError('Selecciona el único sistema de origen de la misión para continuar.');
    if (signal?.aborted) throw signal.reason || waitError('Esperando para recuperar el destino.');
    if (document.querySelector('dialog[open]')) throw waitError('Cierra los diálogos del juego para continuar la misión.');
    if (displayed(one('#app > .star-actions')) || displayed(one('#app > .selection-menu'))) {
      throw waitError('Cierra el menú del mapa para continuar esta misión.');
    }
    const operation = { spec, controller: new AbortController(), listeners: new AbortController(),
      masks: new Map(), dialogs: new Map(), closeWaits: [], previousFocus: document.activeElement,
      deadline: performance.now() + 15000, reason: '', nativeMenus: false, finished: null,
      style: document.createElement('style'), observer: null };
    operation.style.textContent = `[${MASK}] {opacity:0!important;pointer-events:none!important}[${MASK}]::backdrop{opacity:0!important;background:transparent!important}`;
    document.head.append(operation.style);
    current = operation;
    const options = { capture: true, signal: operation.listeners.signal };
    for (const name of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(name, event => {
      if (event.isTrusted) abort(operation, 'Esperando a que termines de interactuar con el juego.');
    }, options);
    for (const name of ['resize', 'pagehide', 'blur', 'popstate', 'hashchange']) window.addEventListener(name,
      event => { if (name !== 'blur' || event.target === window) abort(operation,
        'La vista del juego ha cambiado. Esperando para continuar la misión.'); }, options);
    if (signal) signal.addEventListener('abort', () => abort(operation, signal.reason || waitError('Esperando para recuperar el destino.')),
      { once: true, signal: operation.listeners.signal });
    operation.observer = new MutationObserver(() => {
      try { assertOperation(operation); } catch (error) { abort(operation, error); }
    });
    operation.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['open'] });
    try {
      assertOperation(operation);
      const mapButton = one('#galaxy-map-btn');
      const mapDialog = one('#galaxy-map-modal');
      const viewport = one('#galaxy-map-viewport');
      if (!enabledButton(mapButton) || !(mapDialog instanceof HTMLDialogElement) || !(viewport instanceof HTMLElement)) {
        throw new Error('El mapa global no está disponible. Reconecta el destino desde el juego.');
      }
      prepareDialog(operation, mapDialog);
      operation.dialogs.get(mapDialog).used = true;
      mapButton.click();
      if (mapDialog.matches(':modal')) throw new Error('No se pudo preparar el mapa sin abrir un diálogo visible.');
      const input = await waitFor(operation, () => {
        const node = viewport.querySelector('input.gmap-search-input');
        return node instanceof HTMLInputElement && !node.disabled ? node : null;
      }, 'Esperando a que termine de cargar el mapa global.', 7000);
      input.value = `${spec.coordinate.q}, ${spec.coordinate.r}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const text = `Go to ${spec.coordinate.q}, ${spec.coordinate.r}`;
      const matches = [...viewport.querySelectorAll('.gmap-search-item[role="option"]')]
        .filter(node => clean(node.textContent) === text);
      if (matches.length !== 1) throw new Error('El buscador del mapa no ha reconocido las coordenadas guardadas.');
      assertOperation(operation); matches[0].click();
      pointerClick(operation, viewport, center(viewport), true);
      const info = mapDialog.querySelector('.galaxy-map-info');
      if (!displayed(info) || !sameCoordinate(inspectCoordinate(info), spec.coordinate)) {
        throw new Error('No hay una estrella verificable en las coordenadas guardadas. No se ha preparado ninguna misión.');
      }
      const jump = info.querySelector('button.galaxy-map-info-jump');
      if (!enabledButton(jump)) throw new Error('El mapa no permite volver al destino guardado.');
      assertOperation(operation); jump.click();
      // The prepared map was outside Fn's stack, so native In() deliberately
      // has nothing to close. Release only our own nonmodal preparation.
      releaseDialog(operation, mapDialog);
      const stage = one('#stage');
      const locateDeadline = Math.min(operation.deadline, performance.now() + 6000);
      while (performance.now() < locateDeadline) {
        const found = freshRadial(operation, stage);
        if (!found) { await pause(operation, 150); continue; }
        let anchor = '', stableAt = performance.now();
        await waitFor(operation, () => {
          const next = found.radial.style.left + '|' + found.radial.style.top;
          if (next !== anchor) { anchor = next; stableAt = performance.now(); }
          return displayed(found.radial) && performance.now() - stableAt >= 170;
        }, 'Esperando a que la cámara del mapa termine de moverse.', Math.max(100, locateDeadline - performance.now()));
        // Re-hit-test after the camera settles; the first selected star may
        // have been underneath the centre while the camera was still moving.
        const settled = freshRadial(operation, stage);
        if (!settled) { await pause(operation, 150); continue; }
        await pause(operation, 130);
        const inspector = await openInspector(operation, settled.inspect);
        if (sameCoordinate(inspectCoordinate(inspector), spec.coordinate)) {
          assertOperation(operation);
          return { inspector, cleanup: () => finish(operation) };
        }
        releaseDialog(operation, inspector);
        await pause(operation, 100);
      }
      throw new Error('El Inspector no coincide con las coordenadas guardadas. Reconecta el destino para continuar.');
    } catch (error) {
      await finish(operation);
      throw error;
    }
  }
  function cancel(message = 'Se ha cancelado la recuperación del destino.') {
    if (!current) return false;
    abort(current, message); return true;
  }
  function destroy() { destroyed = true; cancel('El helper se ha detenido.'); }
  return { resolveTarget, cancel, destroy, isBusy: () => Boolean(current) };
}
  // END MISSION TARGET RESOLVER

  // BEGIN FLEET WAIT QUEUE
  // Adapters own all game interaction. This module only persists intent and plans deficits.
  function createFleetWaitQueue(deps = {}) {
    const KEY = 'old-light-fleet-wait:v1';
    const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
    const NAMES = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };
    const STATES = ['waiting', 'paused', 'sending', 'sent', 'uncertain'];
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
    const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
    const MAX_JOBS = 32;
    const MAX_BYTES = 160 * 1024;
    const MAX_QUANTITY = 1000000;
    const MAX_TIME = 8640000000000000;
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const copy = value => JSON.parse(JSON.stringify(value));
    const zeros = () => Object.fromEntries(SHIPS.map(id => [id, 0]));
    const defaults = () => ({ schemaVersion: 1, jobs: [] });
    const now = () => {
      const value = deps.now ? deps.now() : Date.now();
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME) throw new Error('Reloj no válido.');
      return value;
    };
    const gmGet = deps.gmGetValue || (typeof GM_getValue === 'function' ? GM_getValue : null);
    const gmSet = deps.gmSetValue || (typeof GM_setValue === 'function' ? GM_setValue : null);
    const checkpoints = new WeakMap();
    const retryAfter = new Map();
    const encoder = typeof globalThis.TextEncoder === 'function' ? new globalThis.TextEncoder() : null;
    let config = null;
    let readError = false;
    let storageError = false;
    let notice = '';
    let mounted = null;
    let renderKey = '';
    let rendering = false;
    let destroyed = false;
    let running = false;
    let idSequence = 0;

    function keys(value, allowed) {
      return object(value) && Object.keys(value).every(key => allowed.includes(key));
    }

    function label(value, maximum, optional = false) {
      if (optional && value === undefined) return '';
      if (typeof value !== 'string' || value.length > maximum || (!optional && !value.trim()) ||
          /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Texto de misión no válido.');
      return value;
    }

    function quantities(value, allowZero = false) {
      if (!keys(value, SHIPS)) throw new TypeError('Tipos de nave no válidos.');
      const result = zeros();
      for (const id of SHIPS) {
        const amount = value[id] === undefined ? 0 : value[id];
        if (!Number.isInteger(amount) || amount < 0 || amount > MAX_QUANTITY) {
          throw new TypeError('Cantidades de nave no válidas.');
        }
        result[id] = amount;
      }
      if (!allowZero && !SHIPS.some(id => result[id] > 0)) throw new TypeError('El preset está vacío.');
      return result;
    }

    function target(value) {
      if (!keys(value, ['routeKey', 'label', 'coordinate', 'presetKey', 'mode', 'originCoordinate', 'missionAction']) || typeof value.routeKey !== 'string' ||
          (value.routeKey !== '' && !value.routeKey.trim()) || value.routeKey.length > 32768 || /[\u0000\u007f]/.test(value.routeKey)) {
        throw new TypeError('Destino de misión no válido.');
      }
      const amountsMode = value.mode === 'amounts', customMode = value.mode === 'custom';
      if (amountsMode) {
        if (value.routeKey !== '' || value.presetKey !== '' || !keys(value.originCoordinate, ['q', 'r']) ||
            !['q', 'r'].every(key => Number.isSafeInteger(value.originCoordinate[key]) &&
              Math.abs(value.originCoordinate[key]) <= 10000000) || value.missionAction !== undefined) throw new TypeError('Origen de ataque no válido.');
      } else if ((!customMode && value.mode !== undefined) || value.originCoordinate !== undefined ||
          (value.missionAction !== undefined && !['attack', 'send'].includes(value.missionAction))) {
        throw new TypeError('Modo de misión no válido.');
      }
      const result = { routeKey: value.routeKey, label: label(value.label, 500),
        presetKey: amountsMode ? '' : label(label(value.presetKey, 500).normalize('NFKC').replace(/\s+/g, ' ').trim(), 500) };
      if (value.coordinate !== undefined) {
        if (!keys(value.coordinate, ['q', 'r']) || !['q', 'r'].every(key =>
          Number.isSafeInteger(value.coordinate[key]) && Math.abs(value.coordinate[key]) <= 1000000000)) {
          throw new TypeError('Coordenadas de misión no válidas.');
        }
        result.coordinate = { q: value.coordinate.q, r: value.coordinate.r };
      }
      if (value.routeKey === '' && !result.coordinate) throw new TypeError('Faltan las coordenadas del destino.');
      if (amountsMode) {
        if (!result.coordinate || ['q', 'r'].some(key => Math.abs(result.coordinate[key]) > 10000000) ||
            (result.coordinate.q === value.originCoordinate.q && result.coordinate.r === value.originCoordinate.r)) {
          throw new TypeError('El destino del ataque no es válido.');
        }
        result.mode = 'amounts';
        result.originCoordinate = { q: value.originCoordinate.q, r: value.originCoordinate.r };
      }
      if (customMode) result.mode = 'custom';
      if (value.missionAction !== undefined) result.missionAction = value.missionAction;
      return result;
    }

    function spec(value) {
      if (!keys(value, ['scope', 'originId', 'originName', 'target', 'quantities', 'produce', 'autoSend']) ||
          !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '') ||
          typeof value.produce !== 'boolean' || typeof value.autoSend !== 'boolean') {
        throw new TypeError('Configuración de misión no válida.');
      }
      const destination = target(value.target), requested = quantities(value.quantities);
      if (['amounts', 'custom'].includes(destination.mode) && SHIPS.some(id => requested[id] > 50000)) {
        throw new TypeError('La misión supera el límite nativo de naves por tipo.');
      }
      return { scope: value.scope, originId: value.originId.toLowerCase(),
        originName: label(value.originName, 400), target: destination,
        quantities: requested, produce: value.produce, autoSend: value.autoSend };
    }

    function fleetEdit(value) {
      if (!keys(value, ['drafts', 'resumeStatus', 'message']) || !keys(value.drafts, SHIPS) ||
          !['waiting', 'paused'].includes(value.resumeStatus) || !SHIPS.every(id =>
            typeof value.drafts[id] === 'string' && value.drafts[id].length <= 32 &&
            !/[\u0000-\u001f\u007f]/.test(value.drafts[id]))) {
        throw new TypeError('El borrador de flota no es válido.');
      }
      return { drafts: Object.fromEntries(SHIPS.map(id => [id, value.drafts[id]])),
        resumeStatus: value.resumeStatus, message: label(value.message, 500, true) };
    }

    function draftQuantities(value) {
      const requested = zeros();
      for (const id of SHIPS) {
        const draft = value[id];
        if (typeof draft !== 'string' || !/^\d{1,6}$/.test(draft) || Number(draft) > 50000) {
          throw new TypeError('Escribe una cantidad entera de 0 a 50.000 para cada nave.');
        }
        requested[id] = Number(draft);
      }
      return quantities(requested);
    }

    function campaignOwner(value, id) {
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || !value.startsWith('attack:') || !UUID.test(value.slice(7)) ||
          typeof id !== 'string' || !id.startsWith('retry:') || !UUID.test(id.slice(6))) {
        throw new TypeError('El vínculo de la misión con su campaña no es válido.');
      }
      return 'attack:' + value.slice(7).toLowerCase();
    }

    function validateConfig(value = {}) {
      if (!keys(value, ['schemaVersion', 'jobs']) ||
          (value.schemaVersion !== undefined && value.schemaVersion !== 1) ||
          (value.jobs !== undefined && (!Array.isArray(value.jobs) || value.jobs.length > MAX_JOBS))) {
        throw new TypeError('La cola de misiones no es válida.');
      }
      const identities = new Set();
      const ids = new Set();
      const jobs = (value.jobs || []).map(item => {
        if (!keys(item, ['id', 'scope', 'originId', 'originName', 'target', 'quantities', 'produce',
          'autoSend', 'status', 'createdAt', 'updatedAt', 'claimedAt', 'sentAt', 'message', 'needsReview', 'fleetEdit', 'campaignId']) ||
            !ID.test(item.id || '') || ids.has(item.id) || !STATES.includes(item.status) ||
            (item.needsReview !== undefined && typeof item.needsReview !== 'boolean')) {
          throw new TypeError('Un pendiente de misión no es válido.');
        }
        const clean = spec({ scope: item.scope, originId: item.originId, originName: item.originName,
          target: item.target, quantities: item.quantities, produce: item.produce, autoSend: item.autoSend });
        const identity = clean.scope + '/' + clean.originId;
        if (identities.has(identity)) throw new TypeError('Hay más de una misión pendiente para el mismo origen.');
        for (const field of ['createdAt', 'updatedAt']) {
          if (!Number.isSafeInteger(item[field]) || item[field] < 0 || item[field] > MAX_TIME) {
            throw new TypeError('Fecha de misión no válida.');
          }
        }
        if (item.updatedAt < item.createdAt) throw new TypeError('Fechas de misión desordenadas.');
        for (const field of ['claimedAt', 'sentAt']) {
          if (item[field] !== null && (!Number.isSafeInteger(item[field]) || item[field] < item.createdAt ||
              item[field] > item.updatedAt)) throw new TypeError('Fecha de envío no válida.');
        }
        if (['sending', 'sent', 'uncertain'].includes(item.status) && item.claimedAt === null) {
          throw new TypeError('Falta la marca de intento de envío.');
        }
        if ((item.status === 'sent') !== (item.sentAt !== null)) throw new TypeError('Confirmación de misión no válida.');
        if (item.needsReview && !['paused', 'sending', 'uncertain'].includes(item.status)) {
          throw new TypeError('El envío sin confirmar necesita revisión antes de reanudar.');
        }
        const editing = item.fleetEdit === undefined ? null : fleetEdit(item.fleetEdit);
        if (editing && (item.status !== 'paused' || item.needsReview || item.id.startsWith('retry:'))) {
          throw new TypeError('La edición de flota necesita una misión en pausa y sin envíos pendientes de revisión.');
        }
        const owner = campaignOwner(item.campaignId, item.id);
        ids.add(item.id);
        identities.add(identity);
        return { id: item.id, ...clean, status: item.status, createdAt: item.createdAt,
          updatedAt: item.updatedAt, claimedAt: item.claimedAt, sentAt: item.sentAt,
          message: label(item.message, 500, true), needsReview: item.needsReview === true || item.status === 'uncertain',
          ...(editing ? { fleetEdit: editing } : {}), ...(owner ? { campaignId: owner } : {}) };
      });
      const normalized = { schemaVersion: 1, jobs };
      const serialized = JSON.stringify(normalized);
      let bytes = encoder ? encoder.encode(serialized).byteLength : 0;
      if (!encoder) for (const character of serialized) {
          const code = character.codePointAt(0);
          bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
          if (bytes > MAX_BYTES) break;
      }
      if (bytes > MAX_BYTES) throw new TypeError('La cola de misiones es demasiado grande para incluirla en una copia.');
      return normalized;
    }

    function syncResult(value) {
      if (value && typeof value.then === 'function') throw new Error('El guardado local debe ser síncrono.');
      return value;
    }

    function cloneRaw(value) {
      if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(cloneRaw);
      const result = {};
      for (const key of Object.keys(value)) Object.defineProperty(result, key,
        { value: cloneRaw(value[key]), enumerable: true, writable: true, configurable: true });
      return result;
    }

    function readRaw() {
      if (typeof deps.load === 'function') return { kind: 'value', value: cloneRaw(syncResult(deps.load())) };
      if (typeof gmGet === 'function' && typeof gmSet === 'function') {
        return { kind: 'value', value: cloneRaw(syncResult(gmGet(KEY, defaults()))) };
      }
      if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
      return { kind: 'text', value: globalThis.localStorage.getItem(KEY) };
    }

    function configFromRaw(raw) {
      return validateConfig(raw.kind === 'text' ? raw.value === null ? {} : JSON.parse(raw.value) : raw.value ?? {});
    }

    function readStored() { return configFromRaw(readRaw()); }

    function writeRaw(raw) {
      if (raw.kind === 'text') {
        if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
        if (raw.value === null) globalThis.localStorage.removeItem(KEY);
        else globalThis.localStorage.setItem(KEY, raw.value);
        return;
      }
      const safe = cloneRaw(raw.value);
      if (typeof deps.save === 'function') {
        if (syncResult(deps.save(safe)) === false) throw new Error('No se pudo confirmar el guardado.');
      } else if (typeof gmGet === 'function' && typeof gmSet === 'function') {
        if (syncResult(gmSet(KEY, safe)) === false) throw new Error('No se pudo confirmar el guardado.');
      } else {
        if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
        globalThis.localStorage.setItem(KEY, JSON.stringify(safe));
      }
    }

    function writeStored(next) {
      writeRaw({ kind: 'value', value: copy(next) });
    }

    function refreshConfig() {
      if (destroyed) return false;
      try {
        const next = readStored();
        const changed = JSON.stringify(next) !== JSON.stringify(config);
        config = next;
        readError = false;
        if (changed) render();
        return true;
      } catch (_) {
        readError = true;
        storageError = true;
        notice = 'No se pudo leer la cola guardada. Las misiones pendientes están detenidas.';
        render();
        return false;
      }
    }

    function ensureReady() {
      if (destroyed) throw new Error('La cola de misiones está cerrada.');
      if (!refreshConfig() || !config) throw new Error('No se puede usar una cola guardada inválida.');
    }

    function commit(value) {
      if (destroyed) throw new Error('La cola de misiones está cerrada.');
      const next = validateConfig(value);
      try { writeStored(next); }
      catch (_) {
        storageError = true;
        notice = 'No se pudo guardar el cambio. No se enviará ninguna misión sin guardar antes su estado.';
        render();
        throw new Error('No se pudo guardar la cola de misiones.');
      }
      config = next;
      const retainedIds = new Set(next.jobs.map(job => job.id));
      for (const id of retryAfter.keys()) if (!retainedIds.has(id)) retryAfter.delete(id);
      readError = false;
      storageError = false;
      notice = '';
      render();
      try { deps.onSettingsChange?.(); } catch (_) { /* Intent is already persisted. */ }
      return copy(next);
    }

    function timestamp(job) { return Math.max(now(), job?.updatedAt || 0); }

    function changeJob(id, transform) {
      ensureReady();
      const job = config.jobs.find(item => item.id === id);
      if (!job) throw new Error('La misión pendiente ya no existe.');
      const result = transform(copy(job));
      if (result === null) return commit({ ...config, jobs: config.jobs.filter(item => item.id !== id) });
      result.updatedAt = timestamp(job);
      return commit({ ...config, jobs: config.jobs.map(item => item.id === id ? result : item) });
    }

    function queue(value, options = {}) {
      ensureReady();
      const clean = spec(value);
      if (!keys(options, ['id', 'campaignId']) || (options.id !== undefined && (typeof options.id !== 'string' || !ID.test(options.id)))) {
        throw new TypeError('Identificador de misión no válido.');
      }
      const owner = campaignOwner(options.campaignId, options.id);
      if (options.id !== undefined) {
        const sameId = config.jobs.find(item => item.id === options.id);
        if (sameId) {
          const existingSpec = spec({ scope: sameId.scope, originId: sameId.originId, originName: sameId.originName,
            target: sameId.target, quantities: sameId.quantities, produce: sameId.produce, autoSend: sameId.autoSend });
          if (JSON.stringify(existingSpec) !== JSON.stringify(clean) || (sameId.campaignId && sameId.campaignId !== owner)) {
            throw new Error('Este identificador ya pertenece a otra misión o campaña.');
          }
          if (owner && !sameId.campaignId) return setCampaignOwner(sameId.id, owner, { expected: sameId });
          return copy(sameId);
        }
      }
      if (!clean.produce && !clean.autoSend) throw new Error('Activa la producción o el envío cuando se complete la flota.');
      const existing = config.jobs.find(item => item.scope === clean.scope && item.originId === clean.originId);
      if (existing && existing.status !== 'sent') throw new Error('Este origen ya tiene una misión pendiente. Cancélala antes de sustituirla.');
      const retained = config.jobs.filter(item => item !== existing);
      if (retained.length >= MAX_JOBS) throw new Error('Se ha alcanzado el límite de misiones pendientes.');
      const time = now();
      const random = globalThis.crypto?.randomUUID?.();
      let id = options.id || random || 'fleet-' + time.toString(36) + '-' + (++idSequence).toString(36);
      while (config.jobs.some(item => item.id === id)) id = 'fleet-' + time.toString(36) + '-' + (++idSequence).toString(36);
      const job = { id, ...clean, status: 'waiting', createdAt: time, updatedAt: time,
        claimedAt: null, sentAt: null, message: '', needsReview: false, ...(owner ? { campaignId: owner } : {}) };
      commit({ ...config, jobs: [...retained, job] });
      return copy(job);
    }

    function getSavedJob(id) {
      ensureReady();
      const job = config.jobs.find(item => item.id === id);
      if (!job) throw new Error('La misión pendiente ya no existe.');
      return copy(job);
    }

    function sameJob(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

    function expectSavedJob(job, options, allowed = ['expected']) {
      if (!keys(options, allowed) || !object(options.expected)) {
        throw new TypeError('Falta el estado guardado que se está editando.');
      }
      const expected = validateConfig({ schemaVersion: 1, jobs: [options.expected] }).jobs[0];
      if (!sameJob(job, expected)) throw new Error('La misión ha cambiado. Revisa la flota actual antes de continuar la edición.');
    }

    function requireEditableJob(job, ordinary = false) {
      if (ordinary && job.id.startsWith('retry:')) throw new Error('Edita esta flota desde su campaña de reintentos.');
      if (!['waiting', 'paused'].includes(job.status) || job.needsReview) {
        throw new Error('No se puede editar un envío iniciado o pendiente de confirmación. Comprueba primero las misiones del juego.');
      }
    }

    function changedJob(id, transform) {
      const result = changeJob(id, transform);
      return copy(result.jobs.find(item => item.id === id));
    }

    function setCampaignOwner(id, value, options = {}) {
      const owner = campaignOwner(value, id);
      if (!owner) throw new TypeError('Falta la campaña de esta misión.');
      return changedJob(id, job => {
        expectSavedJob(job, options);
        if (job.campaignId && job.campaignId !== owner) throw new Error('La misión pertenece a otra campaña.');
        return { ...job, campaignId: owner };
      });
    }

    function beginFleetEdit(id) {
      const current = getSavedJob(id);
      requireEditableJob(current, true);
      if (current.fleetEdit) return current;
      return changedJob(id, job => {
        if (!sameJob(job, current)) throw new Error('La misión ha cambiado. Vuelve a abrir la edición de flota.');
        requireEditableJob(job, true);
        return { ...job, status: 'paused', message: 'Editando la flota. La misión esperará hasta terminar la edición.',
          fleetEdit: { drafts: Object.fromEntries(SHIPS.map(ship => [ship, String(job.quantities[ship])])),
            resumeStatus: job.status, message: job.message } };
      });
    }

    function getFleetEdit(id) {
      const job = getSavedJob(id);
      if (job.id.startsWith('retry:')) throw new Error('Edita esta flota desde su campaña de reintentos.');
      return job;
    }

    function setFleetDraft(id, ship, value, options = {}) {
      if (!SHIPS.includes(ship) || typeof value !== 'string' || value.length > 32 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError('El tipo de nave o su borrador de cantidad no es válido.');
      }
      return changedJob(id, job => {
        expectSavedJob(job, options);
        requireEditableJob(job, true);
        if (!job.fleetEdit) throw new Error('Abre la edición de flota antes de cambiar cantidades.');
        return { ...job, fleetEdit: { ...job.fleetEdit, drafts: { ...job.fleetEdit.drafts, [ship]: value } } };
      });
    }

    function finishFleetEdit(id, options, apply) {
      return changedJob(id, job => {
        expectSavedJob(job, options);
        requireEditableJob(job, true);
        if (!job.fleetEdit) throw new Error('Esta misión ya no tiene una edición de flota pendiente.');
        const edit = job.fleetEdit;
        const requested = apply ? draftQuantities(edit.drafts) : job.quantities;
        const destination = apply && job.target.mode !== 'amounts' ? { ...job.target, mode: 'custom' } : job.target;
        const next = { ...job, quantities: requested, target: destination,
          status: edit.resumeStatus === 'waiting' && (job.produce || job.autoSend) ? 'waiting' : 'paused',
          message: edit.message };
        delete next.fleetEdit;
        return next;
      });
    }

    function applyFleetEdit(id, options = {}) { return finishFleetEdit(id, options, true); }
    function cancelFleetEdit(id, options = {}) { return finishFleetEdit(id, options, false); }

    function setFleetQuantities(id, values, options = {}) {
      const requested = quantities(values);
      if (SHIPS.some(ship => requested[ship] > 50000)) throw new TypeError('Las cantidades de nave deben estar entre 0 y 50.000.');
      return changedJob(id, job => {
        expectSavedJob(job, options, ['expected', 'target']);
        requireEditableJob(job);
        if (job.fleetEdit) throw new Error('Termina la edición de flota antes de sustituir sus cantidades.');
        const destination = options.target === undefined ? job.target : target(options.target);
        const identity = value => [value.routeKey, value.label, value.presetKey, value.coordinate || null, value.originCoordinate || null];
        const validMode = destination.mode === job.target.mode || (job.target.mode === undefined && destination.mode === 'custom');
        if (!validMode || JSON.stringify(identity(destination)) !== JSON.stringify(identity(job.target)) ||
            (job.target.missionAction !== undefined && destination.missionAction !== job.target.missionAction)) {
          throw new Error('Editar la flota no permite cambiar el origen, el destino o el tipo de misión.');
        }
        return { ...job, quantities: requested, target: destination };
      });
    }

    function update(id, patch) {
      if (!keys(patch, ['produce', 'autoSend']) || Object.values(patch).some(value => typeof value !== 'boolean')) {
        throw new TypeError('Opciones de misión no válidas.');
      }
      return changeJob(id, job => {
        if (['sending', 'sent'].includes(job.status)) throw new Error('El envío de esta misión ya se ha iniciado.');
        const next = { ...job, ...patch };
        if (!next.produce && !next.autoSend && next.status === 'waiting') next.status = 'paused';
        return next;
      });
    }

    function reconnect(id, value) {
      const refreshedTarget = target(value);
      return changeJob(id, job => {
        if (!['waiting', 'paused'].includes(job.status) || job.needsReview) {
          throw new Error('Comprueba primero si esta misión llegó a enviarse.');
        }
        if (job.fleetEdit) throw new Error('Termina la edición de flota antes de reconectar la misión.');
        const previous = job.target.coordinate;
        const next = refreshedTarget.coordinate;
        if (!previous || !next || previous.q !== next.q || previous.r !== next.r ||
            job.target.presetKey !== refreshedTarget.presetKey || job.target.mode !== refreshedTarget.mode ||
            (job.target.missionAction !== undefined && job.target.missionAction !== refreshedTarget.missionAction) ||
            (job.target.mode === 'amounts' && (job.target.originCoordinate.q !== refreshedTarget.originCoordinate.q ||
              job.target.originCoordinate.r !== refreshedTarget.originCoordinate.r))) {
          throw new Error('El destino o el preset no coincide con la misión guardada.');
        }
        return { ...job, target: refreshedTarget };
      });
    }

    function pause(id, message = '') {
      const cleanMessage = label(message, 500, true);
      return changeJob(id, job => {
        if (['sending', 'sent'].includes(job.status)) throw new Error('El envío de esta misión ya se ha iniciado.');
        if (job.status === 'uncertain') throw new Error('Comprueba primero si esta misión llegó a enviarse.');
        return { ...job, status: 'paused', message: cleanMessage };
      });
    }

    function resume(id) {
      return changeJob(id, job => {
        if (!['waiting', 'paused'].includes(job.status) || job.needsReview) throw new Error('Comprueba primero si esta misión llegó a enviarse.');
        if (job.fleetEdit) throw new Error('Termina o cancela la edición de flota antes de reanudar.');
        if (!job.produce && !job.autoSend) throw new Error('Activa la producción o el envío antes de reanudar.');
        return { ...job, status: 'waiting', message: '' };
      });
    }

    function acknowledge(id, { notSent = false } = {}) {
      if (notSent !== true) throw new Error('Debes confirmar que la misión no se envió antes de reintentar.');
      return changeJob(id, job => {
        if (job.status !== 'uncertain' && !job.needsReview) throw new Error('La misión no tiene un envío sin confirmar.');
        if (!job.produce && !job.autoSend) throw new Error('Activa la producción o el envío antes de reanudar.');
        return { ...job, status: 'waiting', message: '', needsReview: false };
      });
    }

    function cancel(id) {
      return changeJob(id, job => {
        if (job.status === 'sending') throw new Error('Espera a que termine el intento de envío.');
        return null;
      });
    }

    function productionPlan(job, fleet) {
      const required = quantities(job?.quantities);
      if (!fleet || typeof fleet !== 'object') return null;
      const parked = zeros(), away = zeros(), building = zeros(), missing = zeros(), production = zeros();
      for (const id of SHIPS) {
        const counts = typeof fleet.get === 'function' ? fleet.get(id) : fleet[id];
        if (!object(counts) || !['parked', 'away', 'building'].every(key =>
          Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
            !Number.isSafeInteger(counts.parked + counts.away + counts.building)) return null;
        parked[id] = counts.parked;
        away[id] = counts.away;
        building[id] = counts.building;
        missing[id] = Math.max(0, required[id] - counts.parked);
        production[id] = Math.max(0, required[id] - counts.parked - counts.away - counts.building);
      }
      return { ready: SHIPS.every(id => missing[id] === 0), missing, production, parked, away, building };
    }

    function context(value) {
      if (!object(value) || !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '')) return null;
      return { scope: value.scope, originId: value.originId.toLowerCase(), active: value.active === true, canAct: value.canAct === true };
    }

    function currentContext() {
      try { return context(deps.getContext?.()); } catch (_) { return null; }
    }

    function currentFleet(job) {
      try { return deps.getFleet?.(copy(job)); } catch (_) { return null; }
    }

    function matches(job, value) { return value && job.scope === value.scope && job.originId === value.originId; }

    function getJobFor(value) {
      ensureReady();
      const current = context(value);
      const job = config.jobs.find(item => matches(item, current));
      return job ? copy(job) : null;
    }

    function productionDemand(value, fleet) {
      if (destroyed || !refreshConfig()) return null;
      const current = context(value);
      if (!current?.active || !current.canAct) return null;
      const job = config.jobs.find(item => matches(item, current) && item.status === 'waiting' && item.produce && !item.needsReview && !item.fleetEdit);
      if (!job) return null;
      const plan = productionPlan(job, fleet);
      if (plan?.ready && !job.autoSend) {
        try { finishPreparation(job.id); } catch (_) { /* No side effect after failed persistence. */ }
        return null;
      }
      return plan ? { ...plan.production } : null;
    }

    function finishPreparation(id) {
      return changeJob(id, job => {
        if (job.status !== 'waiting' || job.fleetEdit || job.needsReview || !job.produce || job.autoSend) {
          throw new Error('La preparación de esta misión ha cambiado.');
        }
        return { ...job, produce: false, status: 'paused', message: 'Flota completa; preparada para envío manual.' };
      });
    }

    async function tick() {
      if (destroyed || running || !refreshConfig()) return null;
      const current = currentContext();
      if (!current?.active || !current.canAct) { render(); return null; }
      const job = config.jobs.find(item => matches(item, current) && item.status === 'waiting' && !item.fleetEdit);
      if (!job || !productionPlan(job, currentFleet(job))?.ready) { render(); return null; }
      if (!job.autoSend) {
        if (job.produce) try { finishPreparation(job.id); } catch (_) { /* Keep intent paused on save failure. */ }
        return null;
      }
      if ((retryAfter.get(job.id) || 0) > now()) return null;
      if (typeof deps.dispatch !== 'function' || job.needsReview) return null;
      running = true;
      let claim;
      try {
        // Reading fleet/context can notify other controllers. Never claim an old
        // snapshot after an editor or another tab has durably changed its intent.
        if (!refreshConfig() || !sameJob(config.jobs.find(item => item.id === job.id), job)) return null;
        const claimTime = Math.max(timestamp(job), (job.claimedAt ?? -1) + 1);
        claim = { ...job, status: 'sending', updatedAt: claimTime, claimedAt: claimTime, message: '' };
        commit({ ...config, jobs: config.jobs.map(item => item.id === job.id ? claim : item) });
        // A settings callback, another tab, or an origin change can invalidate the claim.
        if (destroyed || !refreshConfig()) return null;
        const saved = config.jobs.find(item => item.id === claim.id);
        if (saved?.status !== 'sending' || saved.claimedAt !== claim.claimedAt) return null;
        const latestContext = currentContext();
        if (!matches(saved, latestContext) || !latestContext.active || !latestContext.canAct ||
            !productionPlan(saved, currentFleet(saved))?.ready) {
          retryAfter.set(saved.id, now() + 1000);
          changeJob(saved.id, item => ({ ...item, status: 'waiting', message: 'Esperando la flota y el origen correctos.' }));
          return null;
        }
        let result;
        try { result = await deps.dispatch(copy(saved)); }
        catch (_) { result = { status: 'uncertain', message: 'No se pudo confirmar el envío. Comprueba las misiones del juego.' }; }
        if (destroyed || !refreshConfig()) return null;
        const active = config.jobs.find(item => item.id === claim.id);
        if (active?.status !== 'sending' || active.claimedAt !== claim.claimedAt) return null;
        const status = ['sent', 'waiting', 'paused', 'uncertain'].includes(result?.status) ? result.status : 'uncertain';
        let message = '';
        try { message = label(result?.message, 500, true); } catch (_) { /* Do not persist unbounded adapter data. */ }
        if (status === 'uncertain' && !message) message = 'No se pudo confirmar el envío. Comprueba las misiones del juego.';
        const finishedAt = timestamp(active);
        const finished = { ...active, status, updatedAt: finishedAt, message,
          sentAt: status === 'sent' ? finishedAt : null, needsReview: status === 'uncertain' };
        // Autosave schedules another core pass. A known no-order result must
        // wait for the regular observer/interval instead of spinning microtasks.
        if (status === 'waiting') retryAfter.set(active.id, now() + 1000);
        else retryAfter.delete(active.id);
        commit({ ...config, jobs: config.jobs.map(item => item.id === active.id ? finished : item) });
        return copy(finished);
      } catch (_) {
        // In particular, a failed final save leaves the durable sending claim in place.
        render();
        return null;
      } finally { running = false; }
    }

    function exportConfig() { ensureReady(); return copy(config); }

    function backupCheckpoint() {
      if (destroyed) throw new Error('La cola de misiones está cerrada.');
      const raw = readRaw();
      let valid = null;
      try { valid = configFromRaw(raw); } catch (_) { /* Explicit backup import can repair corrupt storage. */ }
      const token = Object.freeze({});
      checkpoints.set(token, { raw, valid });
      return token;
    }

    function restoreCheckpoint(token) {
      if (destroyed) throw new Error('La cola de misiones está cerrada.');
      const checkpoint = token && checkpoints.get(token);
      if (!checkpoint) throw new TypeError('El punto de recuperación de misiones no es válido.');
      if (checkpoint.valid) importConfig(checkpoint.valid, { source: 'rollback' });
      else {
        // Only opaque snapshots created by this instance can restore invalid raw data.
        // The invalid queue is restored intact and remains unable to dispatch or produce.
        writeRaw(checkpoint.raw);
        config = null;
        readError = true;
        storageError = true;
        notice = 'Se ha restaurado la cola anterior, que no se puede leer. Las misiones pendientes están detenidas.';
        render();
        try { deps.onSettingsChange?.(); } catch (_) { /* Original raw data is already restored. */ }
      }
      checkpoints.delete(token);
      return true;
    }

    function importConfig(value, { source = 'import' } = {}) {
      if (!['import', 'rollback'].includes(source)) throw new TypeError('Origen de restauración no válido.');
      const next = validateConfig(value);
      const time = now();
      for (const job of next.jobs) {
        if (job.status === 'sent') continue;
        job.updatedAt = Math.max(time, job.updatedAt);
        if (source === 'import') {
          job.needsReview = job.needsReview || ['sending', 'uncertain'].includes(job.status);
          job.status = 'paused';
          if (job.fleetEdit) job.fleetEdit.resumeStatus = 'paused';
          job.message = job.needsReview ? 'Importada en pausa con un posible envío anterior. Comprueba las misiones del juego.'
            : 'Importada en pausa. Revisa origen, destino y flota antes de reanudar.';
        } else if (job.status === 'sending') {
          job.status = 'uncertain';
          job.needsReview = true;
          job.message = 'El envío quedó sin confirmar. Comprueba las misiones del juego.';
        }
      }
      return commit(next);
    }

    function fleetText(amounts) { return SHIPS.filter(id => amounts[id] > 0).map(id => amounts[id] + ' ' + NAMES[id]).join(' · '); }

    function render() {
      if (!mounted || destroyed || rendering) return;
      rendering = true;
      try {
        const current = currentContext();
        const jobs = (config?.jobs || []).map(job => {
          let editing = Boolean(job.fleetEdit);
          try { editing ||= deps.isFleetEditing?.(job.id) === true; } catch (_) { /* The owner displays its own storage errors. */ }
          return { job, editing, plan: matches(job, current) ? productionPlan(job, currentFleet(job)) : null };
        });
        const key = JSON.stringify({ jobs, context: current, notice, readError, storageError });
        if (key === renderKey) return;
        renderKey = key;
        const active = mounted.getRootNode().activeElement;
        const focus = mounted.contains(active) ? {
          job: active.closest('[data-fleet-wait-job]')?.dataset.fleetWaitJob,
          option: active.dataset.fleetWaitOption, action: active.dataset.fleetWaitAction,
        } : null;
        const doc = mounted.ownerDocument;
        const el = (tag, text, className) => {
          const element = doc.createElement(tag);
          if (text !== undefined) element.textContent = text;
          if (className) element.className = className;
          return element;
        };
        const section = el('section', undefined, 'oldlight-fleet-wait');
        section.setAttribute('aria-label', 'Misiones pendientes');
        section.hidden = !jobs.length && !notice;
        const style = el('style');
        style.textContent = `
          .oldlight-fleet-wait{font:inherit;color:var(--ol-text,#e5eef6);max-width:100%;min-width:0;margin-top:16px}
          .oldlight-fleet-wait .fw-heading,.oldlight-fleet-wait .fw-card-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px}
          .oldlight-fleet-wait h4{font-size:13px;margin:0;font-weight:650}
          .oldlight-fleet-wait .fw-count,.oldlight-fleet-wait .fw-badge{font-size:11.5px;line-height:1.35;border:1px solid var(--ol-border,#2b4053);border-radius:999px;padding:3px 7px;color:var(--ol-muted,#a2b5c6);background:var(--ol-surface-raised,#192939)}
          .oldlight-fleet-wait article{padding:12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);margin:8px 0;background:var(--ol-surface,#131f2b);min-width:0;overflow-wrap:anywhere}
          .oldlight-fleet-wait .fw-card-heading strong{flex:1;min-width:0;font-size:13px;color:var(--ol-text,#e5eef6)}
          .oldlight-fleet-wait p{font-size:12px;line-height:1.5;margin:6px 0;overflow-wrap:anywhere}
          .oldlight-fleet-wait .fw-muted{color:var(--ol-muted,#a2b5c6)}
          .oldlight-fleet-wait .fw-ships{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0}
          .oldlight-fleet-wait .fw-ship{font-size:12px;padding:3px 7px;border-radius:5px;background:var(--ol-surface-raised,#192939);font-variant-numeric:tabular-nums}
          .oldlight-fleet-wait .fw-state{padding-top:7px;border-top:1px solid var(--ol-border,#2b4053)}
          .oldlight-fleet-wait [data-tone=ready]{color:var(--ol-accent,#7de2c2)}
          .oldlight-fleet-wait [data-tone=warning],.oldlight-fleet-wait .fw-error{color:var(--ol-warning,#f3cb80)}
          .oldlight-fleet-wait .fw-options{display:grid;gap:7px;padding:9px 0 2px}
          .oldlight-fleet-wait label{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.45;cursor:pointer}
          .oldlight-fleet-wait input{width:15px;height:15px;margin:1px 0 0;accent-color:var(--ol-accent,#7de2c2);flex:none}
          .oldlight-fleet-wait .fw-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
          .oldlight-fleet-wait button{font:inherit;font-size:12px;min-height:34px;padding:6px 10px;max-width:100%;white-space:normal;border-radius:7px;border:1px solid var(--ol-border-strong,#456177);background:var(--ol-surface-raised,#192939);color:var(--ol-text,#e5eef6);cursor:pointer}
          .oldlight-fleet-wait button:hover:not(:disabled){border-color:var(--ol-accent,#7de2c2)}
          .oldlight-fleet-wait button[data-fleet-wait-action=cancel]{background:transparent;color:var(--ol-muted,#a2b5c6);border-color:var(--ol-border,#2b4053)}
          .oldlight-fleet-wait button[data-fleet-wait-action=cancel]:hover:not(:disabled){color:var(--ol-danger,#f4a8a8);border-color:var(--ol-danger,#f4a8a8)}
          .oldlight-fleet-wait button:disabled{opacity:.5;cursor:default}
          .oldlight-fleet-wait button:focus-visible,.oldlight-fleet-wait input:focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:3px}
        `;
        const heading = el('div', undefined, 'fw-heading');
        const pending = jobs.filter(({ job }) => job.status !== 'sent').length;
        heading.append(el('h4', 'Misiones pendientes'), el('span', pending ? pending + (pending === 1 ? ' pendiente' : ' pendientes') : 'Al día', 'fw-count'));
        section.append(style, heading);
        if (notice) {
          const warning = el('p', notice, 'fw-error');
          warning.setAttribute('role', 'status');
          section.append(warning);
        }
        const actionError = error => { notice = error?.message || 'No se pudo abrir la edición de flota.'; renderKey = ''; render(); };
        const safeAction = action => {
          try { const result = action(); if (result && typeof result.then === 'function') Promise.resolve(result).catch(actionError); }
          catch (error) { actionError(error); }
        };
        for (const { job, plan, editing } of jobs) {
          const article = el('article');
          article.dataset.fleetWaitJob = job.id;
          const statuses = { paused: 'Pausada', sending: 'Enviando…', sent: 'Enviada',
            uncertain: 'Envío sin confirmar. Comprueba las misiones del juego.' };
          let state = statuses[job.status];
          if (job.status === 'waiting') {
            state = plan?.ready ? (job.autoSend ? 'Flota completa; lista para enviar.' : 'Flota completa. Envío automático desactivado.')
              : plan ? 'Esperando: ' + fleetText(plan.missing) : 'Selecciona este origen para comprobar su flota.';
          }
          if (editing) state = 'Edición de flota pendiente. La producción y el envío esperan hasta terminarla.';
          const tone = job.status === 'uncertain' || job.needsReview || editing ? 'warning'
            : job.status === 'sent' || job.status === 'waiting' && plan?.ready ? 'ready' : '';
          const cardHeading = el('div', undefined, 'fw-card-heading');
          const badge = el('span', editing ? 'Editando flota' : { waiting: plan?.ready ? 'Lista' : 'Esperando flota', paused: 'En pausa',
            sending: 'Enviando', sent: 'Enviada', uncertain: 'Revisar envío' }[job.status], 'fw-badge');
          badge.dataset.tone = tone;
          cardHeading.append(el('strong', job.target.label), badge);
          article.append(cardHeading, el('p', 'Desde ' + job.originName, 'fw-muted'));
          const ships = el('div', undefined, 'fw-ships');
          ships.setAttribute('aria-label', 'Flota de la misión');
          for (const id of SHIPS) if (job.quantities[id] > 0) ships.append(el('span', job.quantities[id] + ' ' + NAMES[id], 'fw-ship'));
          article.append(ships);
          const status = el('p', state, 'fw-state');
          status.dataset.tone = tone;
          status.setAttribute('role', 'status');
          article.append(status);
          if (!editing && job.message && job.message !== state) article.append(el('p', job.message, 'fw-muted'));
          if (job.produce && job.status === 'waiting' && plan && fleetText(plan.production)) {
            article.append(el('p', 'Por producir: ' + fleetText(plan.production), 'fw-muted'));
          }
          if (['waiting', 'paused', 'uncertain'].includes(job.status)) {
            const options = el('div', undefined, 'fw-options');
            for (const [field, text] of [['produce', 'Producir las naves que faltan'], ['autoSend', 'Enviar cuando la flota esté completa']]) {
              const row = el('label');
              const input = el('input');
              input.type = 'checkbox';
              input.checked = job[field];
              input.disabled = readError;
              input.dataset.fleetWaitOption = field;
              input.addEventListener('change', () => safeAction(() => update(job.id, { [field]: input.checked })));
              row.append(input, el('span', text));
              options.append(row);
            }
            article.append(options);
          }
          const actions = el('div', undefined, 'fw-actions');
          const button = (text, action, actionId, disabled = false) => {
            const control = el('button', text);
            control.type = 'button';
            control.dataset.fleetWaitAction = actionId;
            control.disabled = disabled || readError;
            control.addEventListener('click', () => safeAction(action));
            actions.append(control);
          };
          if (job.status !== 'sent' && typeof deps.openFleetEditor === 'function') {
            button(editing ? 'Continuar edición' : 'Editar flota', () => deps.openFleetEditor(job.id), 'edit-fleet',
              !['waiting', 'paused'].includes(job.status) || job.needsReview);
          }
          if (job.status === 'waiting') button('Pausar', () => pause(job.id), 'pause');
          if (job.status === 'paused' && !job.needsReview && !editing) button('Reanudar', () => resume(job.id), 'resume');
          if (job.status === 'uncertain' || job.needsReview) button('He comprobado que no se envió: reanudar', () => acknowledge(job.id, { notSent: true }), 'acknowledge');
          button(job.status === 'sent' ? 'Quitar' : 'Cancelar pendiente', () => cancel(job.id), 'cancel', job.status === 'sending');
          article.append(actions);
          section.append(article);
        }
        if (jobs.some(({ job }) => job.produce && job.status !== 'sent')) {
          section.append(el('p', 'Pausar o cancelar detiene este pendiente. Las naves ya encargadas siguen en la cola del juego.', 'fw-muted'));
        }
        mounted.replaceChildren(section);
        if (focus?.job) {
          const card = [...mounted.querySelectorAll('[data-fleet-wait-job]')].find(node => node.dataset.fleetWaitJob === focus.job);
          const control = focus.option ? [...card?.querySelectorAll('[data-fleet-wait-option]') || []].find(node => node.dataset.fleetWaitOption === focus.option)
            : [...card?.querySelectorAll('[data-fleet-wait-action]') || []].find(node => node.dataset.fleetWaitAction === focus.action);
          if (control && !control.disabled) control.focus({ preventScroll: true });
        }
      } finally { rendering = false; }
    }
    function mount(root) {
      if (destroyed || !root?.ownerDocument || typeof root.replaceChildren !== 'function') {
        throw new TypeError('Contenedor de misiones no válido.');
      }
      if (mounted && mounted !== root) mounted.replaceChildren();
      mounted = root;
      renderKey = '';
      render();
    }

    function destroy() { destroyed = true; mounted?.replaceChildren(); mounted = null; }

    try {
      config = readStored();
      if (config.jobs.some(job => job.status === 'sending')) {
        const recovered = copy(config);
        for (const job of recovered.jobs) if (job.status === 'sending') {
          job.status = 'uncertain';
          job.needsReview = true;
          job.updatedAt = timestamp(job);
          job.message = 'Se interrumpió un envío. Comprueba las misiones del juego antes de reintentar.';
        }
        commit(recovered);
      }
    } catch (_) {
      readError = true;
      storageError = true;
      notice = 'No se pudo leer o recuperar la cola guardada. Las misiones pendientes están detenidas.';
    }

    return { queue, update, reconnect, cancel, pause, resume, acknowledge, productionPlan, productionDemand, setCampaignOwner,
      beginFleetEdit, getFleetEdit, setFleetDraft, applyFleetEdit, cancelFleetEdit, setFleetQuantities,
      getJobFor, tick, exportConfig, validateConfig, importConfig, backupCheckpoint, restoreCheckpoint,
      refreshConfig, mount, destroy,
      list: () => exportConfig().jobs,
      getDiagnostics: () => ({ storageError, readError, running, count: config?.jobs.length ?? null }) };
  }
  // END FLEET WAIT QUEUE

  // BEGIN ATTACK RETRY CONTROLLER
  // Reports establish intent; the existing native mission queue owns every game order.
  function createAttackRetryController(deps = {}) {
    const KEY = 'old-light-attack-retry:v1';
    const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
    const NAMES = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };
    const STATES = ['waiting_origin', 'waiting_slot', 'queued', 'awaiting_report', 'paused', 'uncertain', 'completed', 'cancelled', 'limit'];
    const ACTIVE = ['waiting_origin', 'waiting_slot', 'queued', 'awaiting_report'];
    const TERMINAL = ['completed', 'cancelled', 'limit'];
    const FLEET_EDITABLE = ['waiting_origin', 'waiting_slot', 'queued'];
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
    const MAX_TIME = 8640000000000000;
    const MAX_QUANTITY = 50000;
    const MAX_CAMPAIGNS = 32;
    const MAX_HISTORY = 512;
    const MAX_BYTES = 300 * 1024;
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const copy = value => JSON.parse(JSON.stringify(value));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const zeros = () => Object.fromEntries(SHIPS.map(id => [id, 0]));
    const defaults = () => ({ schemaVersion: 1, enabled: false, enabledAt: 0, autoMinimums: false,
      minimumsEnabledAt: 0, minimumUpdates: [], minimumOutcomes: [], produceMissing: true,
      maxRetries: 3, maxRetriesDraft: '3', expanded: true, campaigns: [], processed: [], outcomes: [], floorAt: 0 });
    const gmGet = deps.gmGetValue || (typeof GM_getValue === 'function' ? GM_getValue : null);
    const gmSet = deps.gmSetValue || (typeof GM_setValue === 'function' ? GM_setValue : null);
    const checkpoints = new WeakMap();
    const retryAfter = new Map();
    let config = null;
    let readError = false;
    let storageError = false;
    let notice = '';
    let minimumNotice = '';
    let lastReportDecision = null;
    let destroyed = false;
    let running = false;
    let mounted = null;
    let ui = null;
    let cardsKey = '';
    let epoch = 0;
    let cleaningCancelled = false;
    const CLEANUP_PENDING = 'Campaña cancelada. Esperando a que termine el envío en curso para retirar su registro.';
    const CLEANUP_ERROR = 'La campaña está cancelada. No se pudieron retirar sus misiones; se volverá a intentar.';

    function keys(value, allowed) {
      return object(value) && Object.keys(value).every(key => allowed.includes(key));
    }
    function text(value, maximum, optional = false) {
      if (optional && value === undefined) return '';
      if (typeof value !== 'string' || value.length > maximum || (!optional && !value.trim()) ||
          /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Texto de reintento no válido.');
      return value;
    }
    function time(value) {
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME) throw new TypeError('Fecha de reintento no válida.');
      return value;
    }
    function stamp(value) {
      if (typeof value === 'string' && value.length <= 80 && value.trim()) value = Date.parse(value);
      try { return time(value); } catch (_) { return null; }
    }
    function now() { return time(deps.now ? deps.now() : Date.now()); }
    function coordinate(value) {
      if (!keys(value, ['q', 'r']) || !['q', 'r'].every(key =>
        Number.isSafeInteger(value[key]) && Math.abs(value[key]) <= 10000000)) {
        throw new TypeError('Coordenadas de reintento no válidas.');
      }
      return { q: value.q, r: value.r };
    }
    function sameCoordinate(a, b) { return Boolean(a && b && a.q === b.q && a.r === b.r); }
    function quantities(value) {
      if (!keys(value, SHIPS)) throw new TypeError('Tipos de nave de reintento no válidos.');
      const result = zeros();
      for (const id of SHIPS) {
        const amount = value[id] === undefined ? 0 : value[id];
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_QUANTITY) {
          throw new TypeError('Cantidades de nave de reintento no válidas.');
        }
        result[id] = amount;
      }
      if (result.marauder === 0 && result.sentinel === 0) throw new TypeError('Faltan naves de combate en el ataque.');
      return result;
    }
    function sameQuantities(a, b) { return Boolean(a && b && SHIPS.every(id => a[id] === b[id])); }
    function fleetDrafts(value) {
      if (!keys(value, SHIPS) || !SHIPS.every(id => typeof value[id] === 'string' && value[id].length <= 16 &&
          !/[\u0000-\u001f\u007f]/.test(value[id]))) throw new TypeError('El borrador de flota no es válido.');
      return Object.fromEntries(SHIPS.map(id => [id, value[id]]));
    }
    function parseFleetDrafts(value) {
      const drafts = fleetDrafts(value), amounts = zeros();
      for (const id of SHIPS) {
        if (!/^\d{1,5}$/.test(drafts[id]) || Number(drafts[id]) > MAX_QUANTITY) {
          throw new TypeError('Escribe una cantidad entera de 0 a 50.000 para cada tipo de nave.');
        }
        amounts[id] = Number(drafts[id]);
      }
      return quantities(amounts);
    }
    function validateFleetEdit(value, campaign) {
      if (value === undefined || value === null) return null;
      if (!keys(value, ['drafts', 'baseQuantities', 'pendingQuantities'])) throw new TypeError('La edición de flota no es válida.');
      const clean = { drafts: fleetDrafts(value.drafts), baseQuantities: quantities(value.baseQuantities),
        pendingQuantities: value.pendingQuantities === null ? null : quantities(value.pendingQuantities) };
      if (!sameQuantities(clean.baseQuantities, campaign.quantities) ||
          (clean.pendingQuantities && !sameQuantities(clean.pendingQuantities, parseFleetDrafts(clean.drafts)))) {
        throw new TypeError('La edición de flota guardada no coincide con la campaña.');
      }
      return clean;
    }
    function routeKey(value) {
      return JSON.stringify([value.scope, value.originCoordinate.q, value.originCoordinate.r,
        value.targetCoordinate.q, value.targetCoordinate.r]);
    }
    function validateConfig(value = {}) {
      if (!keys(value, ['schemaVersion', 'enabled', 'enabledAt', 'autoMinimums', 'minimumsEnabledAt', 'minimumUpdates', 'minimumOutcomes', 'produceMissing', 'maxRetries', 'maxRetriesDraft',
        'expanded', 'campaigns', 'processed', 'outcomes', 'floorAt'])) throw new TypeError('Los reintentos guardados no son válidos.');
      const next = { ...defaults(), ...value };
      if (value.maxRetriesDraft === undefined) next.maxRetriesDraft = String(next.maxRetries);
      if (next.schemaVersion !== 1 || !['enabled', 'autoMinimums', 'produceMissing', 'expanded'].every(key => typeof next[key] === 'boolean') ||
          !Number.isSafeInteger(next.maxRetries) || next.maxRetries < 0 || next.maxRetries > 100 ||
          typeof next.maxRetriesDraft !== 'string' || next.maxRetriesDraft.length > 16 || /[\u0000-\u001f\u007f]/.test(next.maxRetriesDraft)) {
        throw new TypeError('Los ajustes de reintento no son válidos.');
      }
      time(next.enabledAt); time(next.minimumsEnabledAt); time(next.floorAt);
      if (next.enabled && next.enabledAt === 0) throw new TypeError('Falta la fecha de activación de los reintentos.');
      if (next.autoMinimums && next.minimumsEnabledAt === 0) throw new TypeError('Falta la fecha de activación de los mínimos automáticos.');
      if (!Array.isArray(next.minimumUpdates) || next.minimumUpdates.length > MAX_CAMPAIGNS) {
        throw new TypeError('Hay demasiados mínimos automáticos pendientes.');
      }
      const minimumScopes = new Set();
      next.minimumUpdates = next.minimumUpdates.map(item => {
        if (!keys(item, ['scope', 'reportId', 'takenAt', 'quantities']) || !SCOPE.test(item.scope || '') ||
            !UUID.test(item.reportId || '') || minimumScopes.has(item.scope)) throw new TypeError('Un mínimo automático pendiente no es válido.');
        minimumScopes.add(item.scope);
        return { scope: item.scope, reportId: item.reportId.toLowerCase(), takenAt: time(item.takenAt), quantities: quantities(item.quantities) };
      });
      if (!Array.isArray(next.minimumOutcomes) || next.minimumOutcomes.length > MAX_CAMPAIGNS) {
        throw new TypeError('El historial de mínimos automáticos no es válido.');
      }
      const minimumOutcomeScopes = new Set();
      next.minimumOutcomes = next.minimumOutcomes.map(item => {
        if (!keys(item, ['scope', 'reportId', 'takenAt']) || !SCOPE.test(item.scope || '') ||
            !UUID.test(item.reportId || '') || minimumOutcomeScopes.has(item.scope)) throw new TypeError('Un resultado de mínimos automáticos no es válido.');
        minimumOutcomeScopes.add(item.scope);
        return { scope: item.scope, reportId: item.reportId.toLowerCase(), takenAt: time(item.takenAt) };
      });
      if (!Array.isArray(next.campaigns) || next.campaigns.length > MAX_CAMPAIGNS ||
          !Array.isArray(next.processed) || next.processed.length > MAX_HISTORY ||
          !Array.isArray(next.outcomes) || next.outcomes.length > MAX_HISTORY) throw new TypeError('Hay demasiados reintentos guardados.');
      const ids = new Set(), activeRoutes = new Set();
      next.campaigns = next.campaigns.map(item => {
        if (!keys(item, ['id', 'scope', 'originId', 'originName', 'originCoordinate', 'targetName', 'targetCoordinate',
          'status', 'resumeStatus', 'createdAt', 'updatedAt', 'lastOutcomeAt', 'triggerReportId', 'retries', 'quantities',
          'lastSentQuantities', 'sentAt', 'queueJobId', 'queueConfirmed', 'produce', 'message', 'fleetEdit']) ||
            typeof item.id !== 'string' || !item.id.startsWith('attack:') || !UUID.test(item.id.slice(7)) || ids.has(item.id.toLowerCase()) ||
            !SCOPE.test(item.scope || '') || (item.originId !== null && !UUID.test(item.originId || '')) ||
            !STATES.includes(item.status) || (item.resumeStatus !== null && !ACTIVE.includes(item.resumeStatus)) ||
            !UUID.test(item.triggerReportId || '') || !Number.isSafeInteger(item.retries) || item.retries < 0 || item.retries > MAX_QUANTITY ||
            typeof item.queueConfirmed !== 'boolean' || typeof item.produce !== 'boolean') throw new TypeError('Una campaña de reintentos no es válida.');
        const clean = { id: 'attack:' + item.id.slice(7).toLowerCase(), scope: item.scope,
          originId: item.originId === null ? null : item.originId.toLowerCase(), originName: text(item.originName, 400),
          originCoordinate: coordinate(item.originCoordinate), targetName: text(item.targetName, 500),
          targetCoordinate: coordinate(item.targetCoordinate), status: item.status, resumeStatus: item.resumeStatus,
          createdAt: time(item.createdAt), updatedAt: time(item.updatedAt), lastOutcomeAt: time(item.lastOutcomeAt),
          triggerReportId: item.triggerReportId.toLowerCase(), retries: item.retries, quantities: quantities(item.quantities),
          lastSentQuantities: item.lastSentQuantities === null ? null : quantities(item.lastSentQuantities),
          sentAt: item.sentAt === null ? null : time(item.sentAt), queueJobId: item.queueJobId,
          queueConfirmed: item.queueConfirmed, produce: item.produce, message: text(item.message, 600, true) };
        clean.fleetEdit = validateFleetEdit(item.fleetEdit, clean);
        if (clean.updatedAt < clean.createdAt || clean.lastOutcomeAt > clean.updatedAt ||
            (clean.sentAt !== null && (clean.sentAt > clean.updatedAt || clean.lastSentQuantities === null)) ||
            (clean.queueJobId !== null && clean.queueJobId !== 'retry:' + clean.triggerReportId) ||
            (clean.queueJobId !== null && clean.originId === null) || (clean.queueConfirmed && !clean.queueJobId) ||
            (clean.status === 'queued' && !clean.queueJobId) ||
            (clean.status === 'awaiting_report' && (clean.sentAt === null || clean.retries < 1)) ||
            (clean.status !== 'paused' && clean.resumeStatus !== null) ||
            sameCoordinate(clean.originCoordinate, clean.targetCoordinate)) throw new TypeError('El estado de una campaña no es coherente.');
        const route = routeKey(clean);
        if (!TERMINAL.includes(clean.status)) {
          if (activeRoutes.has(route)) throw new TypeError('Hay dos campañas activas para el mismo destino y origen.');
          activeRoutes.add(route);
        }
        ids.add(clean.id);
        return clean;
      });
      const processedIds = new Set();
      next.processed = next.processed.map(item => {
        if (!keys(item, ['scope', 'id', 'takenAt']) || !SCOPE.test(item.scope || '') || !UUID.test(item.id || '')) {
          throw new TypeError('El historial de informes no es válido.');
        }
        const id = item.scope + '/' + item.id.toLowerCase();
        if (processedIds.has(id)) throw new TypeError('El historial contiene informes repetidos.');
        processedIds.add(id);
        return { scope: item.scope, id: item.id.toLowerCase(), takenAt: time(item.takenAt) };
      });
      const routes = new Set();
      next.outcomes = next.outcomes.map(item => {
        if (!keys(item, ['scope', 'originCoordinate', 'targetCoordinate', 'takenAt', 'reportId', 'verdict']) ||
            !SCOPE.test(item.scope || '') || !UUID.test(item.reportId || '') ||
            !['Defeat', 'Victory', 'Captured', 'Draw'].includes(item.verdict)) throw new TypeError('El historial de resultados no es válido.');
        const clean = { scope: item.scope, originCoordinate: coordinate(item.originCoordinate),
          targetCoordinate: coordinate(item.targetCoordinate), takenAt: time(item.takenAt),
          reportId: item.reportId.toLowerCase(), verdict: item.verdict };
        const route = routeKey(clean);
        if (routes.has(route)) throw new TypeError('El historial contiene rutas repetidas.');
        routes.add(route);
        return clean;
      });
      const json = JSON.stringify(next);
      const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(json).byteLength : unescape(encodeURIComponent(json)).length;
      if (bytes > MAX_BYTES) throw new TypeError('Los reintentos guardados ocupan demasiado espacio.');
      return next;
    }
    function syncResult(value) {
      if (value && typeof value.then === 'function') throw new Error('El guardado local debe ser síncrono.');
      return value;
    }
    function cloneRaw(value) {
      if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(cloneRaw);
      const out = {};
      for (const key of Object.keys(value)) Object.defineProperty(out, key,
        { value: cloneRaw(value[key]), enumerable: true, writable: true, configurable: true });
      return out;
    }
    function readRaw() {
      if (typeof deps.load === 'function') return { kind: 'value', value: cloneRaw(syncResult(deps.load())) };
      if (typeof gmGet === 'function' && typeof gmSet === 'function') return { kind: 'value', value: cloneRaw(syncResult(gmGet(KEY, defaults()))) };
      if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
      return { kind: 'text', value: globalThis.localStorage.getItem(KEY) };
    }
    function configFromRaw(raw) { return validateConfig(raw.kind === 'text' ? raw.value === null ? {} : JSON.parse(raw.value) : raw.value ?? {}); }
    function writeRaw(raw) {
      if (raw.kind === 'text') {
        if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
        if (raw.value === null) globalThis.localStorage.removeItem(KEY);
        else globalThis.localStorage.setItem(KEY, raw.value);
      } else if (typeof deps.save === 'function') {
        if (syncResult(deps.save(cloneRaw(raw.value))) === false) throw new Error('No se pudo confirmar el guardado.');
      } else if (typeof gmGet === 'function' && typeof gmSet === 'function') {
        if (syncResult(gmSet(KEY, cloneRaw(raw.value))) === false) throw new Error('No se pudo confirmar el guardado.');
      } else {
        if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
        globalThis.localStorage.setItem(KEY, JSON.stringify(raw.value));
      }
    }
    function refreshConfig() {
      if (destroyed) return false;
      try {
        const next = configFromRaw(readRaw());
        if (!same(next, config)) { config = next; epoch += 1; }
        readError = false;
        render();
        return true;
      } catch (_) {
        readError = true; storageError = true;
        notice = 'No se pueden leer los reintentos guardados. El envío automático está detenido.';
        render();
        return false;
      }
    }
    function ensureReady() {
      if (destroyed) throw new Error('Los reintentos están cerrados.');
      if (!refreshConfig() || !config) throw new Error('No se puede usar una configuración de reintentos inválida.');
    }
    function commit(value) {
      if (destroyed) throw new Error('Los reintentos están cerrados.');
      const next = validateConfig(value);
      try { writeRaw({ kind: 'value', value: next }); }
      catch (_) {
        storageError = true;
        notice = 'No se pudo guardar el cambio. Los reintentos necesitan guardar su estado antes de preparar una misión.';
        render();
        throw new Error('No se pudieron guardar los reintentos.');
      }
      config = next; epoch += 1; readError = false; storageError = false; notice = '';
      render();
      try { deps.onSettingsChange?.(); } catch (_) { /* Intent is already persisted. */ }
      return copy(next);
    }
    function updateCampaign(id, transform) {
      ensureReady();
      const previous = config.campaigns.find(item => item.id === id);
      if (!previous) throw new Error('La campaña ya no existe.');
      const next = transform(copy(previous));
      if (same(previous, next)) return copy(previous);
      next.updatedAt = Math.max(now(), previous.updatedAt, next.updatedAt || 0);
      commit({ ...config, campaigns: config.campaigns.map(item => item.id === id ? next : item) });
      return copy(next);
    }
    function emit(campaign, stage, message) {
      try { deps.send?.({ type: 'attack.retry', id: 'attack-retry:' + campaign.id + ':' + campaign.triggerReportId + ':' + stage,
        title: 'Old Light', systemName: campaign.originName, message }); } catch (_) { /* Notifications do not change mission intent. */ }
    }
    function fleetText(value) { return SHIPS.filter(id => value[id] > 0).map(id => value[id] + ' ' + NAMES[id]).join(' · '); }
    function currentContext() {
      try {
        const value = deps.getContext?.();
        if (!object(value) || !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '')) return null;
        return { scope: value.scope, originId: value.originId.toLowerCase(), originName: value.originName,
          selectionCount: value.selectionCount, active: value.active === true, canAct: value.canAct === true };
      } catch (_) { return null; }
    }
    function mayAct(value) { return Boolean(value?.active && value.canAct && value.selectionCount === 1); }
    function jobs() {
      const value = syncResult(deps.getJobs?.());
      if (!Array.isArray(value)) throw new Error('No se puede comprobar la cola de misiones.');
      return value;
    }
    function specFor(campaign) {
      return { scope: campaign.scope, originId: campaign.originId, originName: campaign.originName,
        target: { mode: 'amounts', routeKey: '', presetKey: '', label: campaign.targetName,
          coordinate: copy(campaign.targetCoordinate), originCoordinate: copy(campaign.originCoordinate) },
        quantities: copy(campaign.quantities), produce: campaign.produce, autoSend: true };
    }
    function jobMatches(campaign, job) {
      return Boolean(job && job.id === campaign.queueJobId && job.scope === campaign.scope && job.originId === campaign.originId &&
        (job.campaignId === undefined || job.campaignId === campaign.id) &&
        job.originName === campaign.originName && job.target?.mode === 'amounts' && job.target.routeKey === '' &&
        job.target.presetKey === '' && job.target.label === campaign.targetName &&
        sameCoordinate(job.target.coordinate, campaign.targetCoordinate) && sameCoordinate(job.target.originCoordinate, campaign.originCoordinate) &&
        sameQuantities(job.quantities, campaign.quantities) && job.produce === campaign.produce && job.autoSend === true);
    }
    function jobOwned(campaign, job) {
      return Boolean(job && (job.campaignId === undefined ? job.id === campaign.queueJobId : job.campaignId === campaign.id) &&
        job.scope === campaign.scope && job.originId === campaign.originId &&
        sameCoordinate(job.target?.coordinate, campaign.targetCoordinate) &&
        sameCoordinate(job.target?.originCoordinate, campaign.originCoordinate));
    }
    function cancelOwnJobs(campaign) {
      let complete = true;
      for (const job of jobs().filter(item => jobOwned(campaign, item))) {
        // Keep an active claim until the adapter records its outcome. Closing the
        // campaign already revokes its authorization before the native send guard.
        if (job.status === 'sending') {
          syncResult(deps.cancelPreparingJob?.(job.id));
          complete = false;
          continue;
        }
        if (typeof deps.cancelJob !== 'function') throw new Error('La cola de misiones no está disponible.');
        syncResult(deps.cancelJob(job.id));
      }
      return complete && !jobs().some(item => jobOwned(campaign, item));
    }
    function cleanupCancelledJobs() {
      if (destroyed || cleaningCancelled || !refreshConfig()) return false;
      cleaningCancelled = true;
      let complete = true;
      try {
        for (const campaign of config.campaigns.filter(item => item.status === 'cancelled')) {
          try {
            const removed = cancelOwnJobs(campaign);
            complete &&= removed;
            const message = removed ? 'Campaña cancelada. Sus misiones se han retirado del helper.' : CLEANUP_PENDING;
            if (campaign.message !== message) updateCampaign(campaign.id, item => item.status === 'cancelled'
              ? { ...item, message } : item);
          } catch (_) {
            complete = false;
            notice = CLEANUP_ERROR;
          }
        }
        if (complete && notice === CLEANUP_ERROR) notice = '';
        render();
        return complete;
      } finally { cleaningCancelled = false; }
    }
    function controlOwnJob(campaign, action) {
      if (!campaign.queueJobId) return true;
      const job = jobs().find(item => item.id === campaign.queueJobId);
      if (!job || !jobOwned(campaign, job)) return !job;
      if (['sending', 'sent', 'uncertain'].includes(job.status) || job.needsReview) return false;
      if ((action === 'pause' && job.status === 'paused') || (action === 'resume' && job.status === 'waiting')) return true;
      const fn = action === 'cancel' ? deps.cancelJob : action === 'resume' ? deps.resumeJob : deps.pauseJob;
      if (typeof fn !== 'function') return false;
      syncResult(fn(job.id));
      return true;
    }
    function canRunJob(job) {
      // Ordinary preset missions retain their existing authorization. A retry must have
      // current persisted authorization, including during the native adapter's final guard.
      if (typeof job?.id !== 'string' || !job.id.startsWith('retry:')) return true;
      if (destroyed) return false;
      try {
        const saved = configFromRaw(readRaw());
        if (!saved.enabled) return false;
        const campaign = saved.campaigns.find(item => item.queueJobId === job.id);
        if (!campaign || campaign.status !== 'queued' || campaign.fleetEdit ||
            (saved.maxRetries !== 0 && campaign.retries >= saved.maxRetries) ||
            !['waiting', 'sending'].includes(job.status) || job.needsReview || !jobMatches(campaign, job)) return false;
        const live = jobs().find(item => item.id === job.id);
        return Boolean(live && live.status === job.status && live.claimedAt === job.claimedAt &&
          live.createdAt === job.createdAt && !live.needsReview && jobMatches(campaign, live));
      } catch (_) { return false; }
    }
    function uncertain(campaign, message) {
      return { ...campaign, status: 'uncertain', resumeStatus: null, message };
    }
    function jobMessage(job, fallback) {
      try { return text(job?.message, 500, true).trim() || fallback; }
      catch (_) { return fallback; }
    }
    function reconcileOne(campaign, queue) {
      if (!campaign.queueJobId || TERMINAL.includes(campaign.status)) return campaign;
      // Pausing a queue job does not resolve an ambiguous attack. Preserve its
      // explanation, including an imported pause that explicitly needs review.
      if (campaign.status === 'uncertain' || (campaign.status === 'paused' && campaign.resumeStatus === null)) return campaign;
      const job = queue.find(item => item.id === campaign.queueJobId);
      if (!job) {
        if (campaign.sentAt !== null && campaign.lastSentQuantities) return campaign;
        return uncertain(campaign, 'La misión pendiente ya no está en la cola. Comprueba si se envió o se canceló; no se recreará automáticamente.');
      }
      if (campaign.fleetEdit) {
        // A draft holds both production and dispatch. The two durable stores may
        // temporarily contain the old and explicitly staged new fleet; neither
        // version is authorized until an explicit Apply or Cancel completes.
        if (job.needsReview || !['waiting', 'paused'].includes(job.status)) return uncertain(campaign,
          'La misión cambió de estado durante la edición. Comprueba si se envió antes de continuar.');
        const pendingFleet = campaign.fleetEdit.pendingQuantities;
        if (!jobMatches(campaign, job) && !(pendingFleet && jobMatches({ ...campaign, quantities: pendingFleet }, job))) {
          return uncertain(campaign, 'La misión pendiente cambió durante la edición. Revisa su destino y su flota antes de continuar.');
        }
        if (job.status === 'paused' && campaign.status !== 'paused') return { ...campaign, status: 'paused',
          resumeStatus: 'queued', queueConfirmed: true, message: jobMessage(job, 'La misión pendiente está en pausa.') };
        return campaign;
      }
      if (!jobMatches(campaign, job)) return uncertain(campaign, 'La misión guardada cambió. Comprueba su destino y su flota antes de continuar.');
      if (job.status === 'uncertain' || job.needsReview) return uncertain(campaign, 'El envío no está confirmado. Comprueba las misiones del juego antes de volver a atacar.');
      if (job.status === 'sent') {
        const sentAt = stamp(job.sentAt);
        if (sentAt === null || sentAt <= campaign.lastOutcomeAt) return uncertain(campaign, 'La confirmación de envío no tiene una fecha válida.');
        if (campaign.sentAt !== null && campaign.sentAt !== sentAt) return uncertain(campaign, 'Hay dos confirmaciones distintas para el mismo reintento.');
        const paused = campaign.status === 'paused';
        return { ...campaign, status: paused ? 'paused' : 'awaiting_report', resumeStatus: paused ? 'awaiting_report' : null,
          queueConfirmed: true, sentAt, lastSentQuantities: copy(campaign.quantities),
          retries: campaign.sentAt === null ? campaign.retries + 1 : campaign.retries,
          updatedAt: Math.max(campaign.updatedAt, sentAt), message: 'Ataque enviado. Esperando su resultado.' };
      }
      if (campaign.sentAt !== null) return uncertain(campaign, 'El estado del envío retrocedió. Comprueba las misiones del juego.');
      if (job.status === 'paused' && campaign.status !== 'paused') return { ...campaign, status: 'paused',
        resumeStatus: 'queued', queueConfirmed: true, message: jobMessage(job, 'La misión pendiente está en pausa.') };
      if (!['waiting', 'paused', 'sending'].includes(job.status)) return uncertain(campaign, 'El estado de la misión no se reconoce.');
      // Older versions hid the child's pause reason behind this generic text.
      // Restore the explanation without resuming any previously paused intent.
      const pausedMessage = campaign.message === 'La misión pendiente está en pausa.' && job.status === 'paused'
        ? jobMessage(job, campaign.message) : campaign.message;
      return { ...campaign, queueConfirmed: true, message: job.status === 'sending' ? 'Confirmando el envío del reintento…'
        : campaign.status === 'paused' ? pausedMessage : jobMessage(job, 'Esperando la flota completa para atacar.') };
    }
    function reconcile() {
      ensureReady();
      const queue = jobs();
      const sent = [];
      const campaigns = config.campaigns.map(previous => {
        const next = reconcileOne(previous, queue);
        if (previous.sentAt === null && next.sentAt !== null) sent.push(next);
        return next;
      });
      if (!same(campaigns, config.campaigns)) commit({ ...config, campaigns });
      for (const campaign of sent) emit(campaign, 'sent', 'Reintento ' + campaign.retries + ' enviado a ' + campaign.targetName + '.\n' + fleetText(campaign.quantities));
      return queue;
    }
    function parseReport(value, onReject, allowUnknownDefeatFleet = false) {
      const reject = message => { onReject?.(message); return null; };
      if (!object(value) || !SCOPE.test(value.scope || '') || !object(value.item) || !object(value.detail)) {
        return reject('Falta el detalle del combate o la identidad de la cuenta.');
      }
      const { item, detail } = value;
      if (!UUID.test(item.id || '') || !UUID.test(detail.id || '') || item.id.toLowerCase() !== detail.id.toLowerCase()) {
        return reject('El identificador del detalle no coincide con el informe.');
      }
      // The native list and detail carry independent timestamps. Use the list
      // outcome time, as the report formatter does, and fall back to the detail
      // only when the list has no usable date. Report UUIDs bind both payloads.
      const takenAt = stamp(item.takenAt) ?? stamp(detail.createdAt);
      if (takenAt === null || takenAt > now()) return reject('La fecha del combate falta, no es válida o está en el futuro.');
      const route = detail.route, sections = detail.sections, variant = detail.variant;
      if (!object(route) || !object(route.from) || !object(route.to) || !object(sections) || !object(sections.battle) ||
          route.from.ownerKind !== 'owned' || !['human', 'npc', 'dormant'].includes(route.to.ownerKind) ||
          sections.incoming != null || sections.probe != null || item.verdict === 'Probed' ||
          sections.battle.targetOwnerKind === 'owned' || (variant != null && !object(variant)) ||
          (variant?.kind && variant.kind !== 'capture_success')) return reject('El informe no identifica un combate de salida compatible.');
      let originCoordinate, targetCoordinate;
      try { originCoordinate = coordinate({ q: route.from.q, r: route.from.r }); targetCoordinate = coordinate({ q: route.to.q, r: route.to.r }); }
      catch (_) { return reject('El informe no incluye coordenadas exactas de origen y destino.'); }
      if (sameCoordinate(originCoordinate, targetCoordinate)) return reject('El origen y el destino del combate coinciden.');
      let verdict = item.verdict;
      if (variant?.kind === 'capture_success' || sections.battle.loyaltyChange?.captured === true) verdict = 'Captured';
      if (!['Defeat', 'Victory', 'Captured', 'Draw'].includes(verdict)) return reject('El resultado del combate no está reconocido.');
      let amounts = null;
      if (Array.isArray(sections.battle.attackerShips) && sections.battle.attackerShips.length <= SHIPS.length) {
        const out = zeros(), found = new Set();
        let valid = true;
        for (const entry of sections.battle.attackerShips) {
          if (!object(entry) || !SHIPS.includes(entry.type) || found.has(entry.type) || (entry.kind !== undefined && entry.kind !== 'exact') ||
              entry.approximate === true || !Number.isSafeInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > MAX_QUANTITY) { valid = false; break; }
          found.add(entry.type); out[entry.type] = entry.quantity;
        }
        if (valid && out.marauder === 0 && out.sentinel === 0 && (verdict === 'Defeat' || verdict === 'Draw')) {
          return reject('El informe no contiene naves de combate atacantes.');
        }
        if (valid) try { amounts = quantities(out); } catch (_) { /* No exact offensive fleet. */ }
      }
      if ((verdict === 'Defeat' || verdict === 'Draw') && !amounts && !(verdict === 'Defeat' && allowUnknownDefeatFleet)) {
        return reject('Falta una flota atacante exacta: cantidades enteras conocidas y al menos un Marauder o Sentinel.');
      }
      let originName, targetName;
      try { originName = text(route.from.name, 400); targetName = text(route.to.name, 500); }
      catch (_) { return reject('Falta un nombre válido para el origen o el destino.'); }
      return { scope: value.scope, id: item.id.toLowerCase(), takenAt, verdict, originCoordinate, targetCoordinate, originName, targetName, quantities: amounts };
    }
    function reportDecision(value, message) {
      lastReportDecision = { scope: value?.scope || '', reportId: UUID.test(value?.item?.id || '') ? value.item.id.toLowerCase() : '',
        receivedAt: now(), message };
      render();
    }
    function observationSince(value = config) {
      if (!value) return null;
      const dates = [];
      if (value.enabled) dates.push(value.enabledAt);
      if (value.autoMinimums) dates.push(value.minimumsEnabledAt);
      return dates.length ? Math.min(...dates) : null;
    }
    function rememberMinimum(value, report, ambiguous = false) {
      if (!value.autoMinimums || report.verdict !== 'Defeat' ||
          report.takenAt <= Math.max(value.minimumsEnabledAt, value.floorAt)) return value;
      const previous = value.minimumOutcomes.find(item => item.scope === report.scope);
      if (previous && previous.takenAt > report.takenAt) return value;
      if (previous && previous.takenAt === report.takenAt) {
        if (previous.reportId === report.id && !ambiguous) return value;
        // Equal-time defeats have no reliable ordering. Retain their boundary
        // but never apply one of the competing fleets automatically.
        return { ...value, minimumUpdates: value.minimumUpdates.filter(item => item.scope !== report.scope) };
      }
      const next = { ...value,
        minimumOutcomes: [...value.minimumOutcomes.filter(item => item.scope !== report.scope),
          { scope: report.scope, reportId: report.id, takenAt: report.takenAt }].slice(-MAX_CAMPAIGNS),
        minimumUpdates: value.minimumUpdates.filter(item => item.scope !== report.scope) };
      // Unknown attackers and quantity overflow supersede an older defeat but
      // cannot authorize any increase. The boundary survives later victories.
      if (ambiguous || !report.quantities || report.quantities.marauder >= MAX_QUANTITY) return next;
      next.minimumUpdates = [...next.minimumUpdates, { scope: report.scope, reportId: report.id, takenAt: report.takenAt,
        quantities: { ...report.quantities, marauder: report.quantities.marauder + 1 } }].slice(-MAX_CAMPAIGNS);
      return next;
    }
    function flushMinimums() {
      if (destroyed) return 0;
      ensureReady();
      if (!config.autoMinimums || !config.minimumUpdates.length) return 0;
      let acknowledged = 0;
      for (const request of copy(config.minimumUpdates)) {
        ensureReady();
        if (!config.autoMinimums) break;
        if (!config.minimumUpdates.some(item => same(item, request))) continue;
        try {
          if (typeof deps.raiseMinimums !== 'function') throw new Error('No está disponible el guardado de mínimos.');
          // Intent was committed with the report before touching fleet settings.
          // The writer saves a receipt with its update, making a failed ack safe.
          const result = syncResult(deps.raiseMinimums(copy(request)));
          if (!object(result) || !['applied', 'noop', 'deferred'].includes(result.status) || !keys(result.changed, SHIPS) ||
              !Object.values(result.changed).every(change => keys(change, ['before', 'after']) &&
                Number.isSafeInteger(change.before) && change.before >= 0 &&
                Number.isSafeInteger(change.after) && change.after > change.before)) {
            throw new Error('No se pudo confirmar el guardado de los mínimos.');
          }
          if (result.status === 'deferred') {
            minimumNotice = result.reason === 'editing' ? 'Mínimos pendientes: termina de editar las cantidades de flota.'
              : result.reason === 'account' ? 'Hay mínimos pendientes de otra cuenta.'
                : 'Mínimos pendientes. Se aplicarán cuando termine la operación actual.';
            continue;
          }
          ensureReady();
          const remaining = config.minimumUpdates.filter(item => !same(item, request));
          if (remaining.length !== config.minimumUpdates.length) commit({ ...config, minimumUpdates: remaining });
          acknowledged += 1;
          const changes = Object.entries(result.changed).map(([id, change]) => NAMES[id] + ': ' + change.before + ' → ' + change.after);
          minimumNotice = changes.length ? 'Mínimos guardados. ' + changes.join(' · ') + '.' : 'Mínimos revisados: se conservan las cantidades actuales.';
        } catch (error) {
          minimumNotice = 'No se pudieron actualizar los mínimos. La derrota queda guardada para volver a intentarlo.';
          render();
          throw error;
        }
      }
      render();
      return acknowledged;
    }
    function recoverReports(batch) {
      if (destroyed) return 0;
      ensureReady();
      if (observationSince() === null) return 0;
      if (!object(batch) || !SCOPE.test(batch.scope || '') || !Array.isArray(batch.reports) || batch.reports.length > 20) {
        throw new TypeError('La recuperación de combates no es válida.');
      }
      const latest = new Map();
      let latestMinimum = null;
      const cutoff = Math.max(observationSince(), config.floorAt);
      const incomplete = (entry, message) => {
        reportDecision({ scope: batch.scope, item: entry?.item }, 'La recuperación sigue pendiente. ' + message);
        throw new Error(message);
      };
      for (const entry of batch.reports) {
        if (!object(entry) || !object(entry.item) || !object(entry.detail)) {
          incomplete(entry, 'Falta el detalle completo de un combate reciente.');
        }
        const { item, detail } = entry;
        if (!UUID.test(item.id || '') || !UUID.test(detail.id || '') || item.id.toLowerCase() !== detail.id.toLowerCase() ||
            !['Defeat', 'Victory', 'Captured', 'Draw'].includes(item.verdict)) {
          incomplete(entry, 'No se puede confirmar la identidad o el resultado de un combate reciente.');
        }
        const takenAt = stamp(item.takenAt) ?? stamp(detail.createdAt);
        if (takenAt === null) incomplete(entry, 'No se puede confirmar la fecha de un combate reciente.');
        if (takenAt <= cutoff) continue;
        let originCoordinate, targetCoordinate;
        try {
          originCoordinate = coordinate({ q: detail.route?.from?.q, r: detail.route?.from?.r });
          targetCoordinate = coordinate({ q: detail.route?.to?.q, r: detail.route?.to?.r });
        } catch (_) { incomplete(entry, 'Faltan coordenadas exactas en un combate reciente. No se reactivará una derrota anterior.'); }
        if (sameCoordinate(originCoordinate, targetCoordinate)) {
          incomplete(entry, 'Un combate reciente identifica el mismo punto como origen y destino.');
        }
        const value = { scope: batch.scope, item, detail };
        const minimumReport = parseReport(value, null, true);
        if (minimumReport?.verdict === 'Defeat') {
          if (!latestMinimum || takenAt > latestMinimum.report.takenAt) latestMinimum = { report: minimumReport, ambiguous: false };
          else if (takenAt === latestMinimum.report.takenAt && minimumReport.id !== latestMinimum.report.id) latestMinimum.ambiguous = true;
        }
        const route = routeKey({ scope: batch.scope, originCoordinate, targetCoordinate });
        const previous = latest.get(route);
        // Select using identity and outcome time before validating the fleet.
        // A newer malformed result must never revive an older defeat.
        if (!previous || takenAt > previous.takenAt) latest.set(route, {
          value, takenAt, originCoordinate, targetCoordinate, ambiguous: false });
        else if (takenAt === previous.takenAt && item.id.toLowerCase() !== previous.value.item.id.toLowerCase()) previous.ambiguous = true;
      }
      // Minimums use the latest defeat in the batch, even if a later victory
      // on that route means there is no attack left to retry.
      if (latestMinimum) {
        ensureReady();
        const next = rememberMinimum(copy(config), latestMinimum.report, latestMinimum.ambiguous);
        if (!same(next, config)) commit(next);
      }
      let accepted = 0;
      for (const [route, entry] of [...latest].sort((a, b) => b[1].takenAt - a[1].takenAt)) {
        ensureReady();
        if (observationSince() === null) break;
        const value = entry.value;
        const known = config.processed.some(item => item.scope === batch.scope && item.id === value.item.id.toLowerCase());
        const outcome = config.outcomes.find(item => routeKey(item) === route);
        if (!entry.ambiguous && (known || (outcome && outcome.takenAt >= entry.takenAt))) continue;
        if (entry.ambiguous && outcome && outcome.takenAt > entry.takenAt) continue;
        let reason = '';
        const parsed = parseReport(value, message => { reason = message; });
        if (entry.ambiguous || !parsed) {
          const message = entry.ambiguous ? 'Hay dos combates de esta ruta con la misma fecha. Revisa sus resultados antes de reintentar.'
            : 'El último combate no se pudo usar para reintentar. ' + reason;
          const campaign = config.enabled && entry.takenAt > config.enabledAt
            ? config.campaigns.find(item => routeKey(item) === route && !TERMINAL.includes(item.status)) : null;
          // Keep the outcome boundary even when no fleet can be authorized.
          // The normal watcher may still have older reports pending after this
          // batch; neither they nor a reload may turn them into a stale attack.
          const boundary = { scope: batch.scope, id: value.item.id.toLowerCase(), takenAt: entry.takenAt,
            verdict: value.item.verdict, originCoordinate: entry.originCoordinate, targetCoordinate: entry.targetCoordinate };
          let next = known ? copy(config) : remember(copy(config), boundary);
          if (campaign) next.campaigns = next.campaigns.map(item => item.id === campaign.id
            ? { ...uncertain(item, message), updatedAt: Math.max(now(), item.updatedAt) } : item);
          commit(next);
          if (campaign) try { controlOwnJob(campaign, 'pause'); } catch (_) { /* The persisted review state blocks dispatch. */ }
          reportDecision(value, message);
          continue;
        }
        if (parsed.verdict === 'Defeat' && !config.campaigns.some(item => routeKey(item) === route && !TERMINAL.includes(item.status))
            && config.campaigns.some(item => routeKey(item) === route && TERMINAL.includes(item.status))) {
          // Backfilling history cannot reopen a campaign the user already
          // cancelled, completed or stopped at its configured limit.
          commit(remember(copy(config), parsed));
          continue;
        }
        if (observeReport(value)) accepted += 1;
      }
      return accepted;
    }
    function remember(value, report) {
      const route = routeKey(report);
      const next = { ...value,
        processed: [...value.processed, { scope: report.scope, id: report.id, takenAt: report.takenAt }],
        outcomes: [...value.outcomes.filter(item => routeKey(item) !== route), { scope: report.scope,
          originCoordinate: copy(report.originCoordinate), targetCoordinate: copy(report.targetCoordinate),
          takenAt: report.takenAt, reportId: report.id, verdict: report.verdict }] };
      for (const field of ['processed', 'outcomes']) {
        next[field].sort((a, b) => a.takenAt - b.takenAt);
        const removed = next[field].splice(0, Math.max(0, next[field].length - MAX_HISTORY));
        for (const item of removed) next.floorAt = Math.max(next.floorAt, item.takenAt);
      }
      return next;
    }
    function observeReport(value) {
      if (destroyed) return false;
      if (!refreshConfig()) throw new Error('No se pudieron leer los reintentos guardados. El informe sigue pendiente.');
      if (observationSince() === null) return false;
      // Store minimum intent independently of the mission queue and its report
      // deduplication. A queue read error must still leave this work durable.
      const minimumReport = config.autoMinimums ? parseReport(value, null, true) : null;
      if (minimumReport) {
        const next = rememberMinimum(copy(config), minimumReport);
        if (!same(next, config)) commit(next);
      }
      let reason = '';
      const report = parseReport(value, message => { reason = message; });
      if (!report) {
        if (value?.item?.verdict === 'Defeat' && (value.detail?.route?.from?.ownerKind === 'owned' || /^You attacked\b/i.test(value.item.title || ''))) {
          reportDecision(value, 'No se pudo usar la última derrota. ' + reason);
        }
        return false;
      }
      if (report.takenAt <= Math.max(observationSince(), config.floorAt) ||
          config.processed.some(item => item.scope === report.scope && item.id === report.id)) return false;
      const route = routeKey(report);
      const outcome = config.outcomes.find(item => routeKey(item) === route);
      if (outcome && report.takenAt <= outcome.takenAt) return false;
      if (!config.enabled || report.takenAt <= config.enabledAt) {
        commit(remember(copy(config), report));
        lastReportDecision = null;
        render();
        return true;
      }
      try { reconcile(); } catch (_) {
        notice = 'No se puede comprobar la cola. El informe esperará antes de preparar otro ataque.'; render();
        throw new Error(notice);
      }
      const previous = config.campaigns.find(item => routeKey(item) === route && !TERMINAL.includes(item.status));
      let next = remember(copy(config), report), campaign = previous ? copy(previous) : null;
      let stage = '', message = '';
      if (report.verdict === 'Victory' || report.verdict === 'Captured') {
        if (campaign) {
          campaign.status = 'completed'; campaign.resumeStatus = null; campaign.lastOutcomeAt = report.takenAt;
          campaign.updatedAt = Math.max(now(), campaign.updatedAt, report.takenAt);
          campaign.message = report.verdict === 'Captured' ? 'Sistema capturado. No habrá más reintentos.' : 'Victoria confirmada. No habrá más reintentos.';
          next.campaigns = next.campaigns.map(item => item.id === campaign.id ? campaign : item);
          stage = 'completed'; message = campaign.message + '\nDestino: ' + campaign.targetName;
        }
      } else if (report.verdict === 'Draw') {
        if (campaign) {
          campaign.status = 'paused'; campaign.resumeStatus = null; campaign.lastOutcomeAt = report.takenAt;
          campaign.updatedAt = Math.max(now(), campaign.updatedAt, report.takenAt);
          campaign.message = 'Empate. Revisa este resultado antes de preparar otro ataque.';
          next.campaigns = next.campaigns.map(item => item.id === campaign.id ? campaign : item);
          stage = 'draw'; message = 'Reintentos en pausa tras un empate en ' + campaign.targetName + '.';
        }
      } else {
        const stopped = !campaign && next.campaigns.find(item => routeKey(item) === route && TERMINAL.includes(item.status) &&
          (sameQuantities(report.quantities, item.quantities) || sameQuantities(report.quantities, item.lastSentQuantities)));
        if (stopped) { commit(next); return true; }
        const continuing = campaign && (campaign.status === 'awaiting_report' || (campaign.status === 'paused' && campaign.resumeStatus === 'awaiting_report'));
        if (campaign && (!continuing || campaign.sentAt === null || report.takenAt <= campaign.sentAt ||
            !sameQuantities(report.quantities, campaign.lastSentQuantities))) {
          campaign = uncertain(campaign, 'Otro informe de esta ruta no coincide con la flota del reintento esperado. Revisa los ataques antes de continuar.');
          campaign.lastOutcomeAt = report.takenAt; campaign.updatedAt = Math.max(now(), campaign.updatedAt, report.takenAt);
          next.campaigns = next.campaigns.map(item => item.id === campaign.id ? campaign : item);
          stage = 'ambiguous'; message = 'Reintentos detenidos en ' + campaign.targetName + ': el resultado no coincide con el ataque esperado.';
        } else if (!campaign && next.campaigns.length >= MAX_CAMPAIGNS) {
          // Retain history even at capacity; otherwise the same report could create a delayed surprise attack.
          commit(next); notice = 'Se alcanzó el límite de 32 campañas. Quita una campaña terminada antes de añadir más reintentos.'; render(); return false;
        } else {
          const paused = campaign?.status === 'paused';
          const retries = campaign?.retries || 0;
          const reached = config.maxRetries !== 0 && retries >= config.maxRetries;
          const overflow = report.quantities.marauder >= MAX_QUANTITY;
          const amounts = { ...report.quantities, marauder: report.quantities.marauder + (overflow || reached ? 0 : 1) };
          campaign = { id: campaign?.id || 'attack:' + report.id, scope: report.scope,
            originId: campaign?.originId || null, originName: campaign?.originName || report.originName,
            originCoordinate: copy(report.originCoordinate), targetName: report.targetName, targetCoordinate: copy(report.targetCoordinate),
            status: reached || overflow ? 'limit' : paused ? 'paused' : 'waiting_origin',
            resumeStatus: paused && !reached && !overflow ? 'waiting_origin' : null,
            createdAt: campaign?.createdAt || now(), updatedAt: Math.max(now(), campaign?.updatedAt || 0, report.takenAt),
            lastOutcomeAt: report.takenAt, triggerReportId: report.id, retries, quantities: amounts,
            lastSentQuantities: campaign?.lastSentQuantities || null, sentAt: null, queueJobId: null, queueConfirmed: false,
            produce: config.produceMissing, message: reached ? 'Se alcanzó el máximo de reintentos configurado.'
              : overflow ? 'Se alcanzó el límite de 50.000 Marauder. No se incrementará automáticamente.'
                : paused ? 'Nueva derrota registrada. La campaña sigue en pausa.' : 'Selecciona el sistema de origen para preparar el siguiente ataque.' };
          next.campaigns = previous ? next.campaigns.map(item => item.id === previous.id ? campaign : item) : [...next.campaigns, campaign];
          stage = reached || overflow ? 'limit' : 'planned';
          message = reached || overflow ? campaign.message + '\nDestino: ' + campaign.targetName
            : 'Derrota en ' + campaign.targetName + '.\nSiguiente intento: ' + fleetText(campaign.quantities) + '.\n+1 Marauder respecto al ataque perdido.';
        }
      }
      // Older jobs did not record their campaign. Preserve that ownership before
      // a new defeat replaces queueJobId, including when the next save fails.
      if (previous?.queueJobId && campaign && campaign.queueJobId !== previous.queueJobId &&
          typeof deps.setJobCampaignOwner === 'function') {
        const job = jobs().find(item => item.id === previous.queueJobId);
        if (job && jobOwned(previous, job) && !job.campaignId) {
          syncResult(deps.setJobCampaignOwner(job.id, previous.id, { expected: job }));
        }
      }
      commit(next);
      lastReportDecision = null;
      render();
      if (previous && campaign && ['completed', 'paused', 'uncertain'].includes(campaign.status)) {
        try { controlOwnJob(previous, campaign.status === 'completed' ? 'cancel' : 'pause'); }
        catch (_) { notice = 'No se pudo detener la misión pendiente. Comprueba la cola de misiones.'; render(); }
      }
      if (campaign && stage) emit(campaign, stage, message);
      return true;
    }
    async function tick() {
      if (destroyed || running || !refreshConfig()) return null;
      cleanupCancelledJobs();
      let queue;
      try { queue = reconcile(); } catch (_) { render(); return null; }
      if (!config.enabled) {
        for (const campaign of config.campaigns.filter(item => item.queueJobId && !TERMINAL.includes(item.status))) {
          try { controlOwnJob(campaign, 'pause'); } catch (_) { /* Keep disabled even if native queue is unavailable. */ }
        }
        return null;
      }
      for (const campaign of config.campaigns) {
        if (campaign.status === 'completed') {
          try { controlOwnJob(campaign, 'cancel'); } catch (_) { /* Authorization gate remains closed until cleanup succeeds. */ }
        }
        if (campaign.status === 'paused' || campaign.status === 'uncertain' || campaign.status === 'limit') {
          try { controlOwnJob(campaign, 'pause'); } catch (_) { /* Never create another order here. */ }
        }
      }
      const current = currentContext();
      if (!mayAct(current)) return null;
      const candidate = config.campaigns.find(item => !item.fleetEdit && ['waiting_origin', 'waiting_slot'].includes(item.status) &&
        item.scope === current.scope && (!item.originId || item.originId === current.originId) &&
        (retryAfter.get(item.id) || 0) <= now());
      if (!candidate || typeof deps.verifyOrigin !== 'function' || typeof deps.queueOnce !== 'function') return null;
      if (config.maxRetries !== 0 && candidate.retries >= config.maxRetries) {
        updateCampaign(candidate.id, item => ({ ...item, status: 'limit', message: 'Se alcanzó el máximo de reintentos configurado.' }));
        return null;
      }
      if (queue.some(item => item.scope === current.scope && item.originId === current.originId && item.status !== 'sent')) {
        updateCampaign(candidate.id, item => ({ ...item, status: 'waiting_slot', message: 'Este origen ya tiene una misión pendiente. El reintento esperará su turno.' }));
        retryAfter.set(candidate.id, now() + 1000); return null;
      }
      running = true;
      const token = epoch;
      try {
        const verified = await deps.verifyOrigin(copy(candidate), copy(current));
        if (destroyed || !refreshConfig() || token !== epoch || !config.enabled) return null;
        const latestContext = currentContext();
        const saved = config.campaigns.find(item => item.id === candidate.id);
        if (!saved || !['waiting_origin', 'waiting_slot'].includes(saved.status) || !mayAct(latestContext) ||
            latestContext.scope !== current.scope || latestContext.originId !== current.originId ||
            !verified || verified.originId?.toLowerCase() !== current.originId ||
            !sameCoordinate(verified.coordinate, saved.originCoordinate)) {
          retryAfter.set(candidate.id, now() + 2000); return null;
        }
        queue = jobs();
        if (queue.some(item => item.scope === current.scope && item.originId === current.originId && item.status !== 'sent')) {
          updateCampaign(saved.id, item => ({ ...item, status: 'waiting_slot', message: 'Este origen ya tiene una misión pendiente. El reintento esperará su turno.' }));
          retryAfter.set(saved.id, now() + 1000); return null;
        }
        const originName = text(verified.name || saved.originName, 400);
        const claimed = updateCampaign(saved.id, item => ({ ...item, originId: current.originId, originName,
          status: 'queued', queueJobId: 'retry:' + item.triggerReportId, queueConfirmed: false,
          produce: config.produceMissing, message: 'Guardando el siguiente ataque…' }));
        // The claim is durable before the existing queue can create any mission or production demand.
        if (destroyed || !refreshConfig() || !config.enabled) return null;
        const live = config.campaigns.find(item => item.id === claimed.id);
        const beforeQueue = currentContext();
        if (!live || !same(live, claimed) || !mayAct(beforeQueue) || beforeQueue.scope !== current.scope ||
            beforeQueue.originId !== current.originId) return null;
        let created;
        try { created = syncResult(deps.queueOnce(specFor(claimed), { id: claimed.queueJobId, campaignId: claimed.id })); }
        catch (_) {
          try {
            const existing = jobs().find(item => item.id === claimed.queueJobId);
            if (!jobMatches(claimed, existing)) updateCampaign(claimed.id, item => uncertain(item,
              'No se pudo confirmar que la misión quedara guardada. Comprueba la cola antes de volver a atacar.'));
          } catch (_) { /* Durable claim prevents an automatic second enqueue. */ }
          return null;
        }
        if (destroyed || !refreshConfig()) return null;
        const active = config.campaigns.find(item => item.id === claimed.id);
        if (!active || active.queueJobId !== claimed.queueJobId || active.status !== 'queued' || !config.enabled) {
          try { controlOwnJob(claimed, 'pause'); } catch (_) { /* No new mission is created on invalidated intent. */ }
          return null;
        }
        if (!jobMatches(claimed, created)) {
          updateCampaign(claimed.id, item => uncertain(item, 'La cola no confirmó exactamente el destino y la flota previstos.'));
          try { controlOwnJob(claimed, 'pause'); } catch (_) { /* Preserve the uncertainty. */ }
          return null;
        }
        const result = updateCampaign(claimed.id, item => ({ ...item, queueConfirmed: true,
          message: 'Esperando la flota completa para atacar.' }));
        emit(result, 'queued', 'Reintento ' + (result.retries + 1) + ' preparado para ' + result.targetName + '.\n' + fleetText(result.quantities)
          + (result.produce ? '\nSe producirán las naves necesarias y se enviará la flota cuando esté completa.' : '\nEsperando a que la flota completa esté en base.'));
        return result;
      } catch (_) {
        retryAfter.set(candidate.id, now() + 2000); return null;
      } finally { running = false; render(); }
    }
    function setConfig(patch) {
      ensureReady();
      if (!keys(patch, ['enabled', 'autoMinimums', 'produceMissing', 'maxRetries', 'maxRetriesDraft', 'expanded'])) throw new TypeError('Ajustes de reintento no válidos.');
      const next = { ...config, ...patch };
      if (patch.enabled === true && !config.enabled) next.enabledAt = Math.max(1, now());
      if (patch.autoMinimums === true && !config.autoMinimums) next.minimumsEnabledAt = Math.max(1, now());
      if (patch.autoMinimums === false) next.minimumUpdates = [];
      if (patch.maxRetries !== undefined && patch.maxRetriesDraft === undefined) next.maxRetriesDraft = String(patch.maxRetries);
      const previous = copy(config);
      if (patch.enabled === false) next.campaigns = next.campaigns.map(item => ACTIVE.includes(item.status)
        ? { ...item, status: 'paused', resumeStatus: item.status, updatedAt: Math.max(now(), item.updatedAt), message: 'Reintentos desactivados. La campaña está en pausa.' } : item);
      if (patch.maxRetries !== undefined && next.maxRetries !== 0) next.campaigns = next.campaigns.map(item =>
        ACTIVE.includes(item.status) && item.sentAt === null && item.retries >= next.maxRetries
          ? { ...item, status: 'limit', resumeStatus: null, updatedAt: Math.max(now(), item.updatedAt),
            message: 'Se alcanzó el máximo de reintentos configurado.' } : item);
      const saved = commit(next);
      if (patch.autoMinimums !== undefined) { minimumNotice = ''; render(); }
      if (patch.enabled === false) for (const campaign of previous.campaigns) {
        if (!TERMINAL.includes(campaign.status)) try { controlOwnJob(campaign, 'pause'); } catch (_) { /* State remains disabled. */ }
      }
      if (patch.maxRetries !== undefined) for (const campaign of saved.campaigns.filter(item => item.status === 'limit')) {
        try { controlOwnJob(campaign, 'pause'); } catch (_) { /* Authorization gate enforces the new limit. */ }
      }
      return saved;
    }
    function fleetEditable(campaign) {
      return Boolean(campaign && campaign.sentAt === null && (FLEET_EDITABLE.includes(campaign.status) ||
        (campaign.status === 'paused' && FLEET_EDITABLE.includes(campaign.resumeStatus))));
    }
    function requireFleetEditable(campaign) {
      if (!fleetEditable(campaign)) throw new Error('La flota de esta campaña ya se envió o necesita revisión. Solo se puede editar un ataque pendiente.');
    }
    function editableFleetJob(campaign) {
      requireFleetEditable(campaign);
      if (!campaign.queueJobId) return null;
      const job = jobs().find(item => item.id === campaign.queueJobId);
      if (!job || !['waiting', 'paused'].includes(job.status) || job.needsReview) {
        throw new Error('La misión ya se está enviando, no está confirmada o ya no existe. Revisa su estado antes de editarla.');
      }
      const pendingFleet = campaign.fleetEdit?.pendingQuantities;
      if (!jobMatches(campaign, job) && !(pendingFleet && jobMatches({ ...campaign, quantities: pendingFleet }, job))) {
        throw new Error('La misión pendiente cambió. Actualiza la campaña antes de editar su flota.');
      }
      return job;
    }
    function expectedFleetCampaign(id, expected, requireEdit = true) {
      ensureReady();
      const campaign = config.campaigns.find(item => item.id === id);
      if (!campaign) throw new Error('La campaña ya no existe.');
      if (!object(expected) || !same(campaign, expected)) throw new Error('La campaña cambió en otra ventana. Revisa sus datos actualizados antes de continuar.');
      requireFleetEditable(campaign);
      if (requireEdit && !campaign.fleetEdit) throw new Error('Abre el editor de flota antes de cambiar las naves.');
      return copy(campaign);
    }
    function commitFleetCampaign(expected, transform) {
      return updateCampaign(expected.id, item => {
        if (!same(item, expected)) throw new Error('La campaña cambió. El borrador más reciente sigue guardado.');
        requireFleetEditable(item);
        return transform(item);
      });
    }
    function getFleetEdit(id) {
      ensureReady();
      const campaign = config.campaigns.find(item => item.id === id);
      return campaign ? copy(campaign) : null;
    }
    function beginFleetEdit(id) {
      const campaign = getFleetEdit(id);
      if (!campaign) throw new Error('La campaña ya no existe.');
      editableFleetJob(campaign);
      if (campaign.fleetEdit) return campaign;
      return commitFleetCampaign(campaign, item => ({ ...item, fleetEdit: {
        drafts: Object.fromEntries(SHIPS.map(ship => [ship, String(item.quantities[ship])])),
        baseQuantities: copy(item.quantities), pendingQuantities: null,
      } }));
    }
    function setFleetDraft(id, ship, value, options = {}) {
      const campaign = expectedFleetCampaign(id, options.expected);
      if (!SHIPS.includes(ship) || typeof value !== 'string' || value.length > 16 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError('El borrador de naves no es válido.');
      }
      if (campaign.fleetEdit.pendingQuantities) throw new Error('Confirma o descarta el cambio pendiente antes de editar de nuevo.');
      editableFleetJob(campaign);
      return commitFleetCampaign(campaign, item => ({ ...item,
        fleetEdit: { ...item.fleetEdit, drafts: { ...item.fleetEdit.drafts, [ship]: value } } }));
    }
    function changeFleetJob(campaign, nextQuantities) {
      const job = editableFleetJob(campaign);
      if (!job) return null;
      if (!sameQuantities(job.quantities, nextQuantities)) {
        if (typeof deps.setJobFleetQuantities !== 'function') throw new Error('No está disponible la edición de la misión pendiente.');
        syncResult(deps.setJobFleetQuantities(job.id, copy(nextQuantities), { expected: copy(job) }));
      }
      const confirmed = editableFleetJob(campaign);
      if (!confirmed || !jobMatches({ ...campaign, quantities: nextQuantities }, confirmed)) {
        throw new Error('No se pudo confirmar la nueva flota en la cola. La campaña sigue detenida con su borrador guardado.');
      }
      return confirmed;
    }
    function applyFleetEdit(id, options = {}) {
      let campaign = expectedFleetCampaign(id, options.expected);
      const amounts = parseFleetDrafts(campaign.fleetEdit.drafts);
      editableFleetJob(campaign);
      if (campaign.queueJobId && !campaign.fleetEdit.pendingQuantities) {
        // Persist the only alternate fleet that a partial transaction may leave
        // in the queue. A reload can finish it without accepting arbitrary edits.
        campaign = commitFleetCampaign(campaign, item => ({ ...item,
          fleetEdit: { ...item.fleetEdit, pendingQuantities: copy(amounts) } }));
      }
      changeFleetJob(campaign, amounts);
      return commitFleetCampaign(campaign, item => ({ ...item, quantities: copy(amounts), fleetEdit: null }));
    }
    function cancelFleetEdit(id, options = {}) {
      const campaign = expectedFleetCampaign(id, options.expected);
      editableFleetJob(campaign);
      // Cancel also recovers a queue write whose final campaign save failed.
      // Restore only the known original fleet with a fresh queue CAS; unrelated
      // external edits and in-flight claims are never overwritten.
      changeFleetJob(campaign, campaign.fleetEdit.baseQuantities);
      return commitFleetCampaign(campaign, item => ({ ...item, fleetEdit: null }));
    }
    function pause(id) {
      const saved = updateCampaign(id, item => {
        if (!ACTIVE.includes(item.status)) throw new Error('Esta campaña no está activa.');
        return { ...item, status: 'paused', resumeStatus: item.status, message: 'Campaña en pausa.' };
      });
      try { controlOwnJob(saved, 'pause'); } catch (_) { notice = 'Comprueba que la misión pendiente esté en pausa.'; render(); }
      return saved;
    }
    function resume(id) {
      ensureReady();
      if (!config.enabled) throw new Error('Activa los reintentos antes de reanudar una campaña.');
      const campaign = config.campaigns.find(item => item.id === id);
      if (!campaign || campaign.status !== 'paused' || !campaign.resumeStatus) throw new Error('Esta campaña necesita revisión y no puede reanudarse automáticamente.');
      if (campaign.fleetEdit) throw new Error('Aplica o descarta la edición de flota antes de reanudar la campaña.');
      const queue = jobs();
      if (campaign.queueJobId && campaign.sentAt === null) {
        const job = queue.find(item => item.id === campaign.queueJobId);
        if (!jobMatches(campaign, job) || !['waiting', 'paused'].includes(job.status) || job.needsReview) {
          throw new Error('No hay una misión pendiente confirmada que se pueda reanudar.');
        }
      }
      if (config.maxRetries !== 0 && campaign.retries >= config.maxRetries && campaign.resumeStatus !== 'awaiting_report') {
        throw new Error('Aumenta el máximo de reintentos antes de continuar.');
      }
      const saved = updateCampaign(id, item => ({ ...item, status: item.resumeStatus, resumeStatus: null, message: 'Campaña reanudada.' }));
      if (saved.queueJobId && saved.sentAt === null) {
        try { if (!controlOwnJob(saved, 'resume')) throw new Error('Misión no disponible.'); }
        catch (_) {
          updateCampaign(id, item => ({ ...item, status: 'paused', resumeStatus: saved.status, message: 'No se pudo reanudar la misión pendiente.' }));
          throw new Error('No se pudo reanudar la misión pendiente.');
        }
      }
      return saved;
    }
    function cancel(id) {
      const saved = updateCampaign(id, item => ({ ...item, status: 'cancelled', resumeStatus: null, fleetEdit: null, message: 'Campaña cancelada. No se prepararán más ataques.' }));
      cleanupCancelledJobs();
      return copy(config.campaigns.find(item => item.id === saved.id) || saved);
    }
    function remove(id) {
      ensureReady();
      const campaign = config.campaigns.find(item => item.id === id);
      if (!campaign || !TERMINAL.includes(campaign.status)) throw new Error('Cancela la campaña antes de quitarla.');
      if (!cancelOwnJobs(campaign)) throw new Error('La misión todavía está cerrando su envío. Se retirará automáticamente cuando termine; después podrás quitar la campaña.');
      commit({ ...config, campaigns: config.campaigns.filter(item => item.id !== id) });
      return true;
    }
    function exportConfig() { ensureReady(); return copy(config); }
    function importPreferences(value) {
      ensureReady();
      const next = validateConfig(value);
      const patch = Object.fromEntries(['enabled', 'autoMinimums', 'produceMissing', 'maxRetries']
        .filter(key => next[key] !== config[key]).map(key => [key, next[key]]));
      if (Object.keys(patch).length) setConfig(patch);
      if (config.enabledAt !== next.enabledAt || config.minimumsEnabledAt !== next.minimumsEnabledAt) {
        commit({ ...config, enabledAt: next.enabledAt, minimumsEnabledAt: next.minimumsEnabledAt });
      }
      return exportConfig();
    }
    function importConfig(value) {
      const next = validateConfig(value);
      let previous = [];
      try { previous = configFromRaw(readRaw()).campaigns; } catch (_) { /* Explicit import can repair corrupt configuration. */ }
      next.enabled = false; next.enabledAt = 0;
      next.autoMinimums = false; next.minimumsEnabledAt = 0; next.minimumUpdates = []; next.minimumOutcomes = [];
      next.campaigns = next.campaigns.map(item => TERMINAL.includes(item.status) ? item : { ...item,
        status: 'paused', resumeStatus: item.status === 'uncertain' ? null : item.status === 'paused' ? item.resumeStatus : item.status,
        updatedAt: Math.max(now(), item.updatedAt), message: item.status === 'uncertain'
          ? 'Importada en pausa con un envío sin confirmar. Comprueba las misiones del juego.'
          : 'Importada en pausa. Revisa el origen, el destino y la flota antes de reanudar.' });
      const saved = commit(next);
      minimumNotice = ''; render();
      for (const campaign of previous) {
        try { controlOwnJob(campaign, 'pause'); } catch (_) { /* Imports never authorize outstanding old retry jobs. */ }
      }
      return saved;
    }
    function backupCheckpoint() {
      if (destroyed) throw new Error('Los reintentos están cerrados.');
      const token = Object.freeze({});
      checkpoints.set(token, readRaw());
      return token;
    }
    function restoreCheckpoint(token) {
      if (destroyed) throw new Error('Los reintentos están cerrados.');
      const raw = token && checkpoints.get(token);
      if (!raw) throw new TypeError('El punto de recuperación de reintentos no es válido.');
      writeRaw(raw); checkpoints.delete(token); epoch += 1;
      refreshConfig();
      try { deps.onSettingsChange?.(); } catch (_) { /* Exact original raw data is already restored. */ }
      return true;
    }
    function showError(error) { notice = error?.message || 'No se pudo guardar el cambio.'; render(); }
    function render() {
      if (!mounted || !ui || destroyed) return;
      const value = config || defaults();
      ui.enable.checked = value.enabled;
      ui.minimums.checked = value.autoMinimums;
      ui.produce.checked = value.produceMissing;
      ui.details.open = value.expanded;
      ui.mode.textContent = value.enabled || value.autoMinimums ? 'Activo' : 'Desactivado';
      ui.mode.dataset.active = String(value.enabled || value.autoMinimums);
      const pending = value.campaigns.filter(campaign => !TERMINAL.includes(campaign.status)).length;
      ui.count.textContent = pending ? pending + (pending === 1 ? ' campaña' : ' campañas') : '';
      ui.count.hidden = !pending;
      if (ui.limit !== ui.limit.getRootNode().activeElement) ui.limit.value = value.maxRetriesDraft;
      ui.limit.setAttribute('aria-invalid', /^(?:0|[1-9]\d{0,2})$/.test(value.maxRetriesDraft) && Number(value.maxRetriesDraft) <= 100 ? 'false' : 'true');
      ui.limitHint.textContent = ui.limit.getAttribute('aria-invalid') === 'true'
        ? 'Escribe un número de 0 a 100. Sigue vigente: ' + (value.maxRetries === 0 ? 'sin límite' : value.maxRetries) + '.'
        : value.maxRetries === 0 ? 'Sin límite: seguirá sumando 1 Marauder tras cada derrota hasta ganar o pausar la campaña.'
          : 'Como máximo ' + value.maxRetries + ' reintentos por campaña. 0 significa sin límite.';
      ui.limitHint.dataset.invalid = ui.limit.getAttribute('aria-invalid');
      ui.status.textContent = notice || lastReportDecision?.message || (value.enabled
        ? value.autoMinimums ? 'Activos: reintentos y aumento de mínimos tras nuevas derrotas.' : 'Reintentos activos para nuevos ataques fallidos.'
        : value.autoMinimums ? 'Mínimos automáticos activos. El reenvío de ataques está desactivado.'
          : 'Elige qué hacer tras las próximas derrotas. Las opciones funcionan por separado.');
      ui.status.dataset.error = String(Boolean(notice || readError || storageError));
      ui.minimumStatus.hidden = !value.autoMinimums;
      ui.minimumStatus.textContent = minimumNotice || (value.minimumUpdates.length
        ? 'Hay mínimos pendientes de guardar a partir de la última derrota.' : 'Esperando la próxima derrota para revisar los mínimos.');
      for (const input of [ui.enable, ui.minimums, ui.produce, ui.limit]) input.disabled = readError;
      const key = JSON.stringify([value.campaigns, value.enabled, readError]);
      if (key === cardsKey) return;
      cardsKey = key;
      const active = mounted.getRootNode().activeElement;
      const focus = ui.cards.contains(active) ? { campaign: active.closest('[data-attack-retry-campaign]')?.dataset.attackRetryCampaign,
        action: active.dataset.attackRetryAction } : null;
      const doc = mounted.ownerDocument;
      const el = (tag, content, className) => { const result = doc.createElement(tag); if (content !== undefined) result.textContent = content; if (className) result.className = className; return result; };
      const labels = { waiting_origin: 'Esperando el origen', waiting_slot: 'Esperando turno', queued: 'Preparando flota',
        awaiting_report: 'Esperando resultado', paused: 'En pausa', uncertain: 'Revisión necesaria', completed: 'Completada', cancelled: 'Cancelada', limit: 'Límite alcanzado' };
      const cards = value.campaigns.map(campaign => {
        const card = el('article'); card.dataset.attackRetryCampaign = campaign.id;
        const heading = el('div', undefined, 'ar-card-heading');
        const editing = Boolean(campaign.fleetEdit && fleetEditable(campaign));
        const badge = el('span', editing ? 'Edición pendiente' : labels[campaign.status], 'ar-badge');
        badge.dataset.tone = campaign.status === 'completed' ? 'ready' : ['uncertain', 'limit'].includes(campaign.status) ? 'warning' : '';
        heading.append(el('strong', campaign.targetName), badge);
        card.append(heading, el('p', 'Desde ' + campaign.originName + ' · (' + campaign.originCoordinate.q + ', ' + campaign.originCoordinate.r + ')', 'ar-muted'),
          el('p', 'Destino: (' + campaign.targetCoordinate.q + ', ' + campaign.targetCoordinate.r + ')', 'ar-muted'));
        const ships = el('div', undefined, 'ar-ships');
        ships.setAttribute('aria-label', 'Flota del reintento');
        for (const id of SHIPS) if (campaign.quantities[id] > 0) ships.append(el('span', campaign.quantities[id] + ' ' + NAMES[id], 'ar-ship'));
        card.append(ships, el('p', 'Reintentos enviados: ' + campaign.retries, 'ar-attempts'));
        if (editing) card.append(el('p', 'Borrador guardado. La preparación y el envío esperan a que apliques o descartes la edición.', 'ar-muted'));
        else if (campaign.status === 'awaiting_report' || campaign.sentAt !== null) card.append(el('p',
          'La flota enviada ya no se puede editar. Podrás cambiar la del siguiente ataque cuando esté preparado.', 'ar-muted'));
        if (campaign.message) card.append(el('p', campaign.message, 'ar-muted'));
        const actions = el('div', undefined, 'ar-actions');
        const button = (label, action, actionId, disabled = false) => { const control = el('button', label); control.type = 'button'; control.disabled = disabled || readError;
          control.dataset.attackRetryAction = actionId;
          control.addEventListener('click', () => { try { action(); } catch (error) { showError(error); } }); actions.append(control); };
        if (fleetEditable(campaign)) button(editing ? 'Continuar edición' : 'Editar flota', () => {
          if (typeof deps.openFleetEditor !== 'function') throw new Error('No está disponible el editor de flota.');
          deps.openFleetEditor(campaign.id);
        }, 'edit-fleet');
        if (ACTIVE.includes(campaign.status)) button('Pausar', () => pause(campaign.id), 'pause');
        if (campaign.status === 'paused' && campaign.resumeStatus) button('Reanudar', () => resume(campaign.id), 'resume', !value.enabled || editing);
        if (!TERMINAL.includes(campaign.status)) button('Cancelar campaña', () => cancel(campaign.id), 'cancel');
        else button('Quitar', () => remove(campaign.id), 'remove', campaign.status === 'cancelled' && campaign.message === CLEANUP_PENDING);
        card.append(actions); return card;
      });
      ui.cards.replaceChildren(...cards);
      if (focus?.campaign) {
        const card = [...ui.cards.querySelectorAll('[data-attack-retry-campaign]')].find(node => node.dataset.attackRetryCampaign === focus.campaign);
        const control = [...card?.querySelectorAll('[data-attack-retry-action]') || []].find(node => node.dataset.attackRetryAction === focus.action);
        if (control && !control.disabled) control.focus({ preventScroll: true });
      }
    }
    function mount(container) {
      if (destroyed || !container?.ownerDocument || typeof container.replaceChildren !== 'function') throw new TypeError('Contenedor de reintentos no válido.');
      if (mounted === container && ui) { render(); return; }
      if (mounted) mounted.replaceChildren();
      mounted = container; cardsKey = '';
      const doc = container.ownerDocument;
      const el = (tag, content, className) => { const result = doc.createElement(tag); if (content !== undefined) result.textContent = content; if (className) result.className = className; return result; };
      const details = el('details', undefined, 'oldlight-attack-retry');
      details.dataset.attackRetry = '';
      const style = el('style');
      style.textContent = `
        .oldlight-attack-retry{font:inherit;color:var(--ol-text,#e5eef6);min-width:0;max-width:100%;margin:14px 0 0;padding:12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b)}
        .oldlight-attack-retry>summary{font-size:13px;font-weight:650;cursor:pointer;color:var(--ol-text,#e5eef6);line-height:1.5}
        .oldlight-attack-retry .ar-mode,.oldlight-attack-retry .ar-badge{display:inline-block;font-size:11.5px;font-weight:500;line-height:1.35;border:1px solid var(--ol-border,#2b4053);border-radius:999px;padding:3px 7px;color:var(--ol-muted,#a2b5c6);background:var(--ol-surface-raised,#192939)}
        .oldlight-attack-retry .ar-mode{margin-left:7px}.oldlight-attack-retry .ar-mode[data-active=true]{background:var(--ol-accent-bg,#183c36);color:var(--ol-accent,#7de2c2);border-color:var(--ol-accent-bg,#183c36)}
        .oldlight-attack-retry .ar-count{display:inline-block;font-size:11.5px;font-weight:400;color:var(--ol-muted,#a2b5c6);margin-left:7px}
        .oldlight-attack-retry p{font-size:12px;line-height:1.5;margin:7px 0;overflow-wrap:anywhere}
        .oldlight-attack-retry .ar-setting{display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.4;margin:0;padding:12px 0;cursor:pointer}
        .oldlight-attack-retry .ar-setting+.ar-setting{border-top:1px solid var(--ol-border,#2b4053)}
        .oldlight-attack-retry .ar-setting-copy{display:grid;gap:4px;min-width:0}.oldlight-attack-retry .ar-setting-copy strong{font-size:13px;font-weight:550;color:var(--ol-text,#e5eef6)}
        .oldlight-attack-retry .ar-setting-copy>span{font-size:11.5px;color:var(--ol-muted,#a2b5c6)}
        .oldlight-attack-retry input[type=checkbox]{width:15px;height:15px;margin:2px 0 0;accent-color:var(--ol-accent,#7de2c2);flex:none}
        .oldlight-attack-retry input[type=text]{font:inherit;width:72px;min-height:34px;max-width:100%;background:var(--ol-bg,#0c141d);color:var(--ol-text,#e5eef6);border:1px solid var(--ol-border-strong,#456177);border-radius:7px;padding:6px 8px;font-variant-numeric:tabular-nums;text-align:right}
        .oldlight-attack-retry input[aria-invalid=true]{border-color:var(--ol-warning,#f3cb80)}
        .oldlight-attack-retry .ar-muted{color:var(--ol-muted,#a2b5c6)}
        .oldlight-attack-retry .ar-options{padding:10px;margin-top:8px;background:var(--ol-bg,#0c141d);border:1px solid var(--ol-border,#2b4053);border-radius:8px}
        .oldlight-attack-retry .ar-options>summary{font-size:12px;margin:0;color:var(--ol-muted,#a2b5c6);font-weight:600;cursor:pointer}
        .oldlight-attack-retry .ar-options .ar-setting{font-size:12px;padding:10px 0}
        .oldlight-attack-retry .ar-limit-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;margin:4px 0}
        .oldlight-attack-retry .ar-limit-hint{font-size:11.5px;margin:6px 0 0;color:var(--ol-muted,#a2b5c6)}
        .oldlight-attack-retry .ar-limit-hint[data-invalid=true],.oldlight-attack-retry .ar-status[data-error=true]{color:var(--ol-warning,#f3cb80)}
        .oldlight-attack-retry .ar-status{color:var(--ol-muted,#a2b5c6);font-size:11.5px}.oldlight-attack-retry .ar-status:empty{display:none}
        .oldlight-attack-retry article{padding:11px;border:1px solid var(--ol-border,#2b4053);border-radius:8px;margin:10px 0 0;min-width:0;overflow-wrap:anywhere;background:var(--ol-bg,#0c141d)}
        .oldlight-attack-retry .ar-card-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 9px}.oldlight-attack-retry .ar-card-heading strong{font-size:13px;flex:1;min-width:0;color:var(--ol-text,#e5eef6)}
        .oldlight-attack-retry [data-tone=ready]{color:var(--ol-accent,#7de2c2)}.oldlight-attack-retry [data-tone=warning]{color:var(--ol-warning,#f3cb80)}
        .oldlight-attack-retry .ar-ships{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0}.oldlight-attack-retry .ar-ship{font-size:12px;padding:3px 7px;border-radius:5px;background:var(--ol-surface-raised,#192939);font-variant-numeric:tabular-nums}
        .oldlight-attack-retry .ar-attempts{font-size:11.5px;color:var(--ol-muted,#a2b5c6);font-variant-numeric:tabular-nums}
        .oldlight-attack-retry .ar-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
        .oldlight-attack-retry button{font:inherit;font-size:12px;min-height:34px;padding:6px 10px;max-width:100%;white-space:normal;border-radius:7px;border:1px solid var(--ol-border-strong,#456177);background:var(--ol-surface-raised,#192939);color:var(--ol-text,#e5eef6);cursor:pointer}
        .oldlight-attack-retry button:hover:not(:disabled){border-color:var(--ol-accent,#7de2c2)}.oldlight-attack-retry button[data-attack-retry-action=cancel]{background:transparent;color:var(--ol-muted,#a2b5c6);border-color:var(--ol-border,#2b4053)}
        .oldlight-attack-retry button[data-attack-retry-action=cancel]:hover:not(:disabled){color:var(--ol-danger,#f4a8a8);border-color:var(--ol-danger,#f4a8a8)}
        .oldlight-attack-retry button:disabled{opacity:.5;cursor:default}.oldlight-attack-retry [hidden]{display:none!important}
        .oldlight-attack-retry button:focus-visible,.oldlight-attack-retry input:focus-visible,.oldlight-attack-retry summary:focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:3px}
      `;
      const summary = el('summary', 'Tras una derrota');
      const mode = el('span', '', 'ar-mode'), count = el('span', '', 'ar-count');
      summary.append(mode, count);
      details.append(style, summary);
      const checkbox = (label, field, description, parent = details) => {
        const row = el('label', undefined, 'ar-setting'), input = el('input'); input.type = 'checkbox'; input.dataset.attackRetryOption = field;
        input.addEventListener('change', () => { try { setConfig({ [field]: input.checked }); } catch (error) { showError(error); } });
        const copy = el('span', undefined, 'ar-setting-copy'); copy.append(el('strong', label));
        if (description) copy.append(el('span', description));
        row.append(input, copy); parent.append(row); return input;
      };
      const enable = checkbox('Reintentar ataques', 'enabled', 'Suma 1 Marauder al ataque perdido y espera a tener la flota completa.');
      const minimums = checkbox('Aumentar mínimos de flota', 'autoMinimums', 'Flota del último ataque +1 Marauder. Conserva los mínimos que ya sean mayores.');
      const minimumStatus = el('p', '', 'ar-status'); minimumStatus.setAttribute('role', 'status'); details.append(minimumStatus);
      const options = el('details', undefined, 'ar-options');
      options.dataset.uiSection = 'retryOptions';
      options.append(el('summary', 'Preparación y límites'));
      const produce = checkbox('Producir las naves que falten', 'produceMissing', '', options);
      const row = el('label', undefined, 'ar-limit-row'), limit = el('input'); limit.type = 'text'; limit.inputMode = 'numeric'; limit.maxLength = 16;
      limit.dataset.attackRetryOption = 'maxRetries'; limit.setAttribute('aria-label', 'Máximo de reintentos; cero significa sin límite');
      limit.setAttribute('aria-describedby', 'oldlight-attack-retry-limit-hint');
      limit.addEventListener('input', () => {
        const draft = limit.value.slice(0, 16); const patch = { maxRetriesDraft: draft };
        if (/^(?:0|[1-9]\d{0,2})$/.test(draft) && Number(draft) <= 100) patch.maxRetries = Number(draft);
        try { setConfig(patch); } catch (error) { showError(error); }
      });
      row.append(el('span', 'Máximo de reintentos'), limit); options.append(row);
      const limitHint = el('p', '', 'ar-limit-hint'), status = el('p', '', 'ar-status'), cards = el('div');
      limitHint.id = 'oldlight-attack-retry-limit-hint';
      status.setAttribute('role', 'status'); limitHint.setAttribute('role', 'status');
      options.append(limitHint, el('p', 'Se aplican a derrotas posteriores a su activación. Los mínimos usan el sistema seleccionado y respetan la prioridad de flota y la pausa del helper.', 'ar-muted'),
        el('p', 'Los reintentos conservan las demás naves y se detienen al ganar, capturar el sistema o necesitar revisión.', 'ar-muted'));
      details.append(options, status, cards);
      details.addEventListener('toggle', () => {
        if (config && details.open !== config.expanded) try { setConfig({ expanded: details.open }); } catch (error) { showError(error); }
      });
      ui = { details, mode, count, enable, minimums, minimumStatus, produce, limit, limitHint, status, cards }; mounted.replaceChildren(details); render();
    }
    function destroy() { destroyed = true; epoch += 1; mounted?.replaceChildren(); mounted = null; ui = null; }
    refreshConfig();
    cleanupCancelledJobs();
    return { observeReport, recoverReports, flushMinimums, tick, canRunJob, setConfig, pause, resume, cancel, remove, cleanupCancelledJobs, mount, exportConfig, validateConfig,
      beginFleetEdit, getFleetEdit, setFleetDraft, applyFleetEdit, cancelFleetEdit,
      importConfig, importPreferences, backupCheckpoint, restoreCheckpoint, refreshConfig, destroy,
      isEnabled: () => !destroyed && refreshConfig() && config.enabled,
      getEnabledAt: () => !destroyed && refreshConfig() ? config.enabledAt : 0,
      isObservingReports: () => !destroyed && refreshConfig() && observationSince() !== null,
      getObservationSince: () => !destroyed && refreshConfig() ? observationSince() : null,
      isBusy: () => running,
      getDiagnostics: () => ({ enabled: config?.enabled ?? false, enabledAt: config?.enabledAt ?? 0,
        autoMinimums: config?.autoMinimums ?? false, minimumsEnabledAt: config?.minimumsEnabledAt ?? 0,
        minimumUpdates: config ? copy(config.minimumUpdates) : [], minimumOutcomes: config ? copy(config.minimumOutcomes) : [], minimumNotice,
        running, readError, storageError, notice, lastReportDecision: lastReportDecision ? copy(lastReportDecision) : null, count: config?.campaigns.length ?? null,
        campaigns: config ? copy(config.campaigns) : [] }) };
  }
  // END ATTACK RETRY CONTROLLER

  // BEGIN FLEET WAIT INTEGRATION
  async function verifyAttackRetryOrigin(campaign, context) {
    const point = campaign?.originCoordinate;
    if (!point || !Number.isSafeInteger(point.q) || !Number.isSafeInteger(point.r)
        || !context?.canAct || context.selectionCount !== 1 || missionAdapter.isBusy()
        || document.querySelector('dialog[open]')) return null;
    const key = `${context.scope}/${context.originId}/${point.q},${point.r}`;
    const previous = retryOriginChecks.get(key);
    if (previous && Date.now() < previous.until) return previous.value;
    let resolved = null;
    let value = null;
    try {
      resolved = await missionTargetResolver.resolveTarget({ scope: context.scope, originId: context.originId,
        target: { coordinate: point, label: campaign.originName || 'Origen del ataque' } });
      const inspector = resolved?.inspector;
      const current = missionContext();
      // The native resolver already checks the exact point. An active-system
      // Inspector has no Set active / Jump to button. Names are never identities.
      if (current.scope === context.scope && current.originId === context.originId && current.selectionCount === 1
          && inspector?.matches('dialog.info-modal[data-content-type="inspect"]')
          && !inspector.querySelector('.info-modal-trailing .info-modal-header-btn')) {
        value = { originId: current.originId, coordinate: { q: point.q, r: point.r }, name: current.originName };
      }
    } catch { /* The controller keeps the attack waiting for its verified origin. */ }
    finally { if (typeof resolved?.cleanup === 'function') await resolved.cleanup(); }
    if (retryOriginChecks.size >= 128) retryOriginChecks.delete(retryOriginChecks.keys().next().value);
    retryOriginChecks.set(key, { value, until: Date.now() + (value ? 60000 : 15000) });
    return value;
  }

  function missionContext() {
    const galaxy = location.pathname.match(/^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/)?.[1] || '';
    let player = '';
    try { player = localStorage.getItem('oldlight.playerId') || ''; } catch { /* No actions without identity. */ }
    const exactFleet = SHIPS.every(([id]) => fleetCounts(id) !== null);
    return { scope: galaxy && /^[A-Za-z0-9_-]{1,96}$/.test(player) ? `${galaxy}/${player}` : '',
      originId: systemId() || '', originName: text(document.querySelector('[data-field="nameplate-name"]')),
      selectionCount: exactFleet ? 1 : null };
  }

  function currentMissionFleet() {
    return new Map(SHIPS.map(([id]) => [id, fleetCounts(id)]));
  }

  function canOperateMission() {
    const context = missionContext();
    return Boolean(leader && settings.enabled && !importingBackup && !pending && !document.hidden
      && !reports.isRecovering()
      && context.scope && context.originId && context.selectionCount === 1
      && !document.querySelector(`${PANEL} .b-loading, ${FLEET_PANEL} .b-loading`)
      && (hudPanelAvailable(document.querySelector(PANEL)) || hudPanelAvailable(document.querySelector(FLEET_PANEL))));
  }

  function missionQueueContext() {
    return { ...missionContext(), active: canOperateMission(),
      canAct: canOperateMission() && !missionAdapter?.isBusy() && !attackRetry?.isBusy()
        && isRetryMissionAllowed(currentMissionJob()) && !document.querySelector('dialog[open]') };
  }

  function isRetryMissionAllowed(job) {
    if (!job?.id?.startsWith('retry:')) return true;
    try { return Boolean(attackRetry?.canRunJob(job)); }
    catch { return false; }
  }

  // BEGIN MISSION CLAIM GUARD
  function isCurrentMissionClaim(job) {
    const eligible = value => value && value.status === 'sending' && value.autoSend === true
      && Number.isSafeInteger(value.claimedAt) && value.claimedAt >= 0
      && value.sentAt === null && !value.needsReview && !value.fleetEdit;
    if (!eligible(job)) return false;
    try {
      const current = fleetWait.list().find(value => value.id === job.id);
      if (!eligible(current)) return false;
      const claim = value => [value.id, value.scope, value.originId, value.originName,
        value.target, value.quantities, value.produce, value.autoSend, value.createdAt, value.claimedAt];
      return JSON.stringify(claim(current)) === JSON.stringify(claim(job));
    } catch { return false; }
  }
  // END MISSION CLAIM GUARD

  function currentMissionJob() {
    try { return fleetWait?.getJobFor(missionContext()) || null; } catch { return null; }
  }

  function sameMissionPreset(job, capture) {
    const spec = capture.spec;
    return Boolean(spec && job.scope === spec.scope && job.originId === spec.originId
      && job.target.mode === spec.target.mode
      && (job.target.missionAction === undefined || job.target.missionAction === spec.target.missionAction)
      && job.target.presetKey === spec.target.presetKey
      && job.target.coordinate?.q === spec.target.coordinate?.q
      && job.target.coordinate?.r === spec.target.coordinate?.r
      && SHIPS.every(([id]) => job.quantities[id] === spec.quantities[id]));
  }

  function openMissionFleetEditor(id) {
    if (id?.startsWith('retry:')) {
      const campaign = attackRetry.exportConfig().campaigns.find(value => value.queueJobId === id);
      if (!campaign) throw new Error('No se encuentra la campaña de esta misión. Revisa su estado en Flota.');
      return openFleetCompositionEditor('campaign', campaign.id);
    }
    return openFleetCompositionEditor('mission', id);
  }

  function openFleetCompositionEditor(kind, id) {
    const previous = document.getElementById('oldlight-fleet-editor-dialog');
    if (previous?.dataset.kind === kind && previous.dataset.entityId === id) {
      previous.querySelector('[data-fleet-editor-root]')?.shadowRoot?.querySelector('input')?.focus();
      return true;
    }
    if (previous) previous.close();
    const service = kind === 'campaign' ? attackRetry : fleetWait;
    let expected = service.beginFleetEdit(id);
    if (!expected?.fleetEdit) throw new Error('Esta flota no se puede editar en su estado actual.');
    if (kind === 'mission') missionAdapter.detach(id);
    else if (expected.queueJobId) missionAdapter.detach(expected.queueJobId);
    const focused = ui?.section.getRootNode().activeElement || document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.id = 'oldlight-fleet-editor-dialog';
    dialog.dataset.kind = kind;
    dialog.dataset.entityId = id;
    dialog.setAttribute('aria-label', kind === 'campaign' ? 'Editar flota de la campaña' : 'Editar flota de la misión');
    dialog.style.cssText = 'width:400px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;'
      + 'box-sizing:border-box;padding:0;border:1px solid #456177;border-radius:12px;background:#0c141d;color:#e5eef6;color-scheme:dark;box-shadow:0 16px 48px #0009';
    const backdrop = document.createElement('style');
    backdrop.textContent = '#oldlight-fleet-editor-dialog::backdrop{background:#03080dcc}';
    const card = document.createElement('div');
    card.dataset.fleetEditorRoot = '';
    const root = card.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial;display:block;font:13px/1.45 system-ui,sans-serif;color:#e5eef6;color-scheme:dark}
      *{box-sizing:border-box}form{margin:0;padding:16px}header{display:flex;align-items:center;justify-content:space-between;gap:10px}
      h2{font-size:16px;line-height:1.3;margin:0}p{margin:8px 0;overflow-wrap:anywhere}.muted{color:#a2b5c6;font-size:12px}
      .route{margin-top:5px;color:#a2b5c6;font-size:12px}.hold{padding:10px;border:1px solid #456177;border-radius:8px;background:#131f2b;font-size:12px;margin:12px 0}
      .ships{display:grid;gap:8px;margin:12px 0}.ship{padding:10px;border:1px solid #2b4053;border-radius:8px;background:#131f2b}
      label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:600}
      input{font:inherit;min-height:36px;width:96px;max-width:42%;padding:6px 8px;border:1px solid #456177;border-radius:7px;background:#0c141d;color:#e5eef6;text-align:right;font-variant-numeric:tabular-nums}
      input[aria-invalid=true]{border-color:#f3cb80}.stock{margin-top:5px;font-size:11.5px;color:#a2b5c6;font-variant-numeric:tabular-nums}
      .ship-error{margin:5px 0 0;font-size:11.5px;color:#f3cb80}.plan{font-size:12px;padding:10px;border:1px solid #2b4053;border-radius:8px;background:#131f2b}
      .status{font-size:12px;color:#7de2c2;min-height:18px}.status[data-error=true]{color:#f3cb80}
      .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.actions button{flex:1}
      button{font:inherit;font-size:12px;min-height:36px;padding:7px 11px;border-radius:7px;border:1px solid #456177;background:#192939;color:#e5eef6;cursor:pointer;white-space:normal}
      button:hover:not(:disabled){border-color:#7de2c2}button:disabled,input:disabled{opacity:.5;cursor:default}
      .close{width:32px;min-height:32px;padding:0;background:transparent;color:#a2b5c6;font-size:18px}
      .primary{border-color:#356959;background:#183c36;color:#7de2c2;font-weight:600}.secondary{background:transparent;color:#a2b5c6}
      button:focus-visible,input:focus-visible{outline:2px solid #8bc7ff;outline-offset:2px}[hidden]{display:none!important}
      @media(max-width:350px){form{padding:12px}input{width:82px}.actions{gap:6px}.actions button{padding:7px}}
    </style><form novalidate>
      <header><h2>Editar flota</h2><button type="button" class="close" data-action="close" aria-label="Cerrar editor y conservar el borrador" title="Cerrar y conservar el borrador">×</button></header>
      <p class="route" data-field="route"></p>
      <p class="hold" data-field="hold"></p>
      <p class="muted" id="fleet-editor-help">0 excluye ese tipo. Hasta 50.000 naves por tipo.</p>
      <div class="ships">${SHIPS.map(([ship, name]) => `<div class="ship"><label for="fleet-edit-${ship}">${name}<input id="fleet-edit-${ship}" type="text" inputmode="numeric" autocomplete="off" maxlength="16" data-fleet-edit-ship="${ship}" aria-label="${name} a enviar" aria-describedby="fleet-editor-help fleet-edit-${ship}-error"></label><div class="stock" data-fleet-edit-stock="${ship}"></div><p class="ship-error" id="fleet-edit-${ship}-error" hidden></p></div>`).join('')}</div>
      <p class="plan" data-field="plan"></p>
      <p class="status" data-field="status" role="status" aria-live="polite"></p>
      <button type="button" data-action="reload" hidden>Recargar valores guardados</button>
      <div class="actions"><button type="button" class="secondary" data-action="discard">Descartar edición</button><button type="submit" class="primary" data-action="done">Listo</button></div>
      <p class="muted">Cerrar conserva el borrador y la espera. Listo aplica la flota completa y mantiene la pausa que ya tuviera.</p>
    </form>`;
    const fields = new Map(SHIPS.map(([ship]) => [ship, root.querySelector(`[data-fleet-edit-ship="${ship}"]`)]));
    const status = root.querySelector('[data-field="status"]');
    const plan = root.querySelector('[data-field="plan"]');
    const done = root.querySelector('[data-action="done"]');
    const discard = root.querySelector('[data-action="discard"]');
    const reload = root.querySelector('[data-action="reload"]');
    let failed = false;
    let lastError = '';
    let finished = false;
    const canonical = value => JSON.stringify(value);
    const say = (message, isError = false) => { status.textContent = message; status.dataset.error = String(isError); };
    const refreshInputs = () => {
      for (const [ship, input] of fields) input.value = expected.fleetEdit.drafts[ship];
    };
    const isCombat = kind === 'campaign' || expected.target?.mode === 'amounts';
    const readDraft = () => {
      const quantities = {};
      let valid = true;
      for (const [ship, input] of fields) {
        const value = input.value;
        const good = /^\d{1,5}$/.test(value) && Number(value) <= 50000;
        const hint = root.querySelector(`#fleet-edit-${ship}-error`);
        input.setAttribute('aria-invalid', String(!good));
        hint.hidden = good;
        hint.textContent = good ? '' : 'Introduce un entero entre 0 y 50.000.';
        if (!good) valid = false;
        quantities[ship] = good ? Number(value) : 0;
      }
      const total = Object.values(quantities).reduce((sum, amount) => sum + amount, 0);
      const error = !valid ? 'Completa las cantidades para terminar la edición.' : !total ? 'Incluye al menos una nave.'
        : isCombat && quantities.marauder + quantities.sentinel === 0 ? 'Un reintento necesita al menos un Marauder o Sentinel.' : '';
      return { quantities, error };
    };
    const render = () => {
      if (finished || !dialog.isConnected) return;
      const draft = readDraft();
      done.disabled = failed || Boolean(draft.error);
      discard.disabled = failed;
      reload.hidden = !failed;
      for (const input of fields.values()) input.disabled = failed || Boolean(expected.fleetEdit.pendingQuantities);
      const targetName = expected.targetName || expected.target?.label || 'Destino';
      const point = expected.targetCoordinate || expected.target?.coordinate;
      root.querySelector('[data-field="route"]').textContent = `${expected.originName} → ${targetName}`
        + (point ? ` · (${point.q}, ${point.r})` : '');
      root.querySelector('[data-field="hold"]').textContent = kind === 'campaign'
        ? 'La campaña y su misión esperan mientras editas. Los cambios se guardan al escribir.'
        : 'Esta misión espera mientras editas. Los cambios se guardan al escribir.';
      const current = missionContext();
      const sameOrigin = current.scope === expected.scope && current.originId === expected.originId && current.selectionCount === 1;
      const fleet = sameOrigin ? currentMissionFleet() : null;
      for (const [ship] of fields) {
        const counts = fleet?.get(ship);
        root.querySelector(`[data-fleet-edit-stock="${ship}"]`).textContent = counts
          ? `${counts.parked} en base · ${counts.away} en misión · ${counts.building} en cola`
          : 'Selecciona el origen para ver las naves disponibles.';
      }
      const production = !draft.error && fleet ? fleetWait.productionPlan({ quantities: draft.quantities }, fleet) : null;
      plan.textContent = draft.error || (!production ? 'La disponibilidad se comprobará al seleccionar el sistema de origen.'
        : 'Por producir con esta flota: ' + (SHIPS.filter(([ship]) => production.production[ship] > 0)
          .map(([ship, name]) => `${production.production[ship]} ${name}`).join(' · ') || 'ninguna nave.')
          + (production.ready ? ' Todas están en base.' : ' El envío esperará a reunirlas todas en base.'));
      if (failed) say(lastError, true);
      else say(draft.error ? 'Borrador guardado. ' + draft.error : 'Borrador guardado automáticamente.', Boolean(draft.error));
    };
    const fail = cause => {
      failed = true;
      lastError = cause?.message || 'No se pudo guardar el cambio. La flota sigue en espera.';
      render();
    };
    for (const [ship, input] of fields) input.addEventListener('input', () => {
      if (failed) { render(); return; }
      try { expected = service.setFleetDraft(id, ship, input.value, { expected }); }
      catch (cause) { fail(cause); }
      render();
    });
    reload.addEventListener('click', () => {
      try {
        const fresh = service.getFleetEdit(id);
        if (!fresh?.fleetEdit) throw new Error('Esta edición ya no está activa. Cierra el editor y revisa la misión.');
        const unchanged = canonical(fresh) === canonical(expected);
        expected = fresh;
        failed = false;
        lastError = '';
        if (unchanged) {
          for (const [ship, input] of fields) if (input.value !== expected.fleetEdit.drafts[ship]) {
            expected = service.setFleetDraft(id, ship, input.value, { expected });
          }
        }
        refreshInputs();
        render();
      } catch (cause) { fail(cause); }
    });
    const finish = action => {
      if (failed || (action === 'applyFleetEdit' && readDraft().error)) return;
      try {
        const result = service[action](id, { expected });
        if (kind === 'mission') missionAdapter.detach(id);
        else if (expected.queueJobId) missionAdapter.detach(expected.queueJobId);
        expected = result;
        finished = true;
        dialog.close();
        schedule();
      } catch (cause) { fail(cause); }
    };
    root.querySelector('form').addEventListener('submit', event => { event.preventDefault(); finish('applyFleetEdit'); });
    discard.addEventListener('click', () => finish('cancelFleetEdit'));
    root.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
    dialog.append(backdrop, card);
    document.body.append(dialog);
    refreshInputs();
    render();
    const poll = setInterval(() => {
      if (finished || failed) { render(); return; }
      try {
        const fresh = service.getFleetEdit(id);
        if (!fresh?.fleetEdit || canonical(fresh) !== canonical(expected)) {
          fail(new Error('La flota ha cambiado desde otra vista. Recarga los valores guardados antes de continuar.'));
        } else render();
      } catch (cause) { fail(cause); }
    }, 1000);
    dialog.addEventListener('close', () => {
      clearInterval(poll);
      dialog.remove();
      if (focused?.isConnected && !focused.disabled) focused.focus({ preventScroll: true });
      else ui?.tabs.find(tab => tab.dataset.settingsTab === 'fleet')?.focus({ preventScroll: true });
      schedule();
    }, { once: true });
    try { dialog.showModal(); fields.values().next().value?.focus(); }
    catch (cause) { clearInterval(poll); dialog.remove(); throw cause; }
    return true;
  }

  function offerEmptyPresetMission(options) {
    if (!options.capture?.spec || document.querySelector('dialog[open]')) return false;
    document.getElementById('oldlight-preset-shortage-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'oldlight-preset-shortage-dialog';
    dialog.setAttribute('aria-label', 'Preparar misión pendiente');
    dialog.style.cssText = 'width:420px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;'
      + 'box-sizing:border-box;padding:14px;border:1px solid #456177;border-radius:12px;background:#0c141d;color:#e5eef6;font:13px/1.45 system-ui,sans-serif;color-scheme:dark;box-shadow:0 16px 48px #0009';
    const style = document.createElement('style');
    style.textContent = '#oldlight-preset-shortage-dialog::backdrop{background:#03080dcc}#oldlight-preset-shortage-dialog>button:focus-visible{outline:2px solid #8bc7ff;outline-offset:3px}';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.style.cssText = 'display:block;min-height:34px;margin-left:auto;padding:6px 10px;font:inherit;color:#a2b5c6;background:#131f2b;border:1px solid #2b4053;border-radius:7px;cursor:pointer';
    close.addEventListener('click', () => dialog.close());
    dialog.append(style, close);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    if (!offerPresetMission({ ...options, dialog })) { dialog.remove(); return false; }
    dialog.showModal();
    return true;
  }

  function offerPresetMission({ dialog, quantities, presetKey, shortage = true, capture: knownCapture = null }) {
    if (!fleetWait || !missionAdapter || !(dialog instanceof HTMLDialogElement)) return false;
    const existing = currentMissionJob();
    if (!shortage && (!existing || existing.status === 'sent')) return false;
    let capture = knownCapture;
    let captureError = '';
    try { capture ||= missionAdapter.capture(dialog, quantities, presetKey); }
    catch (cause) { captureError = cause?.message || 'No se pudo identificar el origen y el destino de esta misión.'; }
    if (!capture?.spec) {
      captureError ||= capture?.message || 'No se pudo identificar el origen y el destino de esta misión.';
      capture = null;
    }
    const matching = capture && existing && sameMissionPreset(existing, capture);
    if (!shortage && !matching) return false;
    dialog.querySelector('[data-oldlight-fleet-offer]')?.remove();
    const card = document.createElement('div');
    card.dataset.oldlightFleetOffer = '';
    const shadow = card.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{display:block;margin:12px 0;color:var(--ol-text,#e5eef6);font:13px/1.45 system-ui,sans-serif;color-scheme:dark}
      *{box-sizing:border-box}.card{padding:14px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b)}
      .eyebrow{display:block;margin-bottom:5px;font-size:11.5px;font-weight:600;color:var(--ol-accent,#7de2c2)}
      h3{font-size:15px;line-height:1.35;margin:0 0 9px;color:var(--ol-text,#e5eef6)}
      p{margin:7px 0;color:var(--ol-muted,#a2b5c6)}p,li{overflow-wrap:anywhere}
      .route{padding-bottom:10px;border-bottom:1px solid var(--ol-border,#2b4053)}
      ul{list-style:none;padding:0;margin:10px 0 14px;display:grid;gap:7px}
      li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;padding:9px 10px;border:1px solid var(--ol-border,#2b4053);border-radius:7px;background:var(--ol-bg,#0c141d)}
      li strong{font-size:12px;font-weight:600}li .fleet-available{font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
      li small{grid-column:1/-1;color:var(--ol-muted,#a2b5c6);font-size:11.5px}
      label{display:flex;align-items:flex-start;gap:9px;margin:12px 0 6px;cursor:pointer}input{width:15px;height:15px;accent-color:var(--ol-accent,#7de2c2);margin:2px 0 0;flex:none}
      .option-copy{display:grid;gap:3px}.option-copy strong{font-size:13px;font-weight:550}.option-copy span,.hint,.production{font-size:11.5px;color:var(--ol-muted,#a2b5c6)}
      .production{margin-left:24px}.hint{margin:12px 0}
      button{font:inherit;min-height:38px;padding:8px 12px;border-radius:7px;border:1px solid var(--ol-accent,#7de2c2);background:var(--ol-accent-bg,#183c36);color:var(--ol-accent,#7de2c2);font-weight:600;cursor:pointer;max-width:100%;white-space:normal}
      button:hover:not(:disabled){background:#214f46}button:disabled{opacity:.5;cursor:default}.error{color:var(--ol-warning,#f3cb80)}
      button:focus-visible,input:focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:3px}
      .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.actions button{flex:1}
      [data-field=status]:empty{display:none}
    </style><section class="card"><span class="eyebrow">Preparar flota</span><h3></h3><p class="route" data-field="route"></p><ul aria-label="Naves del preset y disponibilidad"></ul>
      <label><input type="checkbox" data-option="produce"><span class="option-copy"><strong>Producir las naves que faltan</strong></span></label>
      <p class="production" data-field="production"></p>
      <label><input type="checkbox" data-option="auto-send" checked><span class="option-copy"><strong>Enviar cuando la flota esté completa</strong><span>La misión saldrá cuando todas sus naves estén en base.</span></span></label>
      <p class="hint">Las naves en misión o en construcción se descuentan de la producción necesaria.</p>
      <div class="actions"><button type="button" data-action="queue">Guardar misión pendiente</button></div>
      <p data-field="status" role="status" aria-live="polite"></p></section>`;
    const title = shadow.querySelector('h3');
    title.textContent = shortage ? 'Faltan naves para este preset' : 'Esta misión ya está pendiente';
    const route = shadow.querySelector('[data-field="route"]');
    route.textContent = capture ? `${capture.spec.originName} → ${capture.spec.target.label}` : 'Misión pendiente';
    const list = shadow.querySelector('ul');
    const status = shadow.querySelector('[data-field="status"]');
    const produce = shadow.querySelector('[data-option="produce"]');
    const autoSend = shadow.querySelector('[data-option="auto-send"]');
    const button = shadow.querySelector('[data-action="queue"]');
    const production = shadow.querySelector('[data-field="production"]');
    const plan = capture ? fleetWait.productionPlan(capture.spec, currentMissionFleet()) : null;
    for (const [id, name] of SHIPS) {
      if (!quantities[id]) continue;
      const line = document.createElement('li');
      const ship = document.createElement('strong'); ship.textContent = name;
      const count = document.createElement('span'); count.className = 'fleet-available';
      count.textContent = plan ? `${plan.parked[id]} / ${quantities[id]} en base` : `${quantities[id]} necesarias`;
      line.append(ship, count);
      if (plan) {
        const detail = document.createElement('small');
        detail.textContent = `${plan.away[id]} en misión · ${plan.building[id]} en construcción`;
        line.append(detail);
      }
      list.append(line);
    }
    production.textContent = plan ? 'Producción pendiente: ' + (SHIPS.filter(([id]) => plan.production[id] > 0)
      .map(([id, name]) => `${plan.production[id]} ${name}`).join(' · ') || 'ninguna; basta esperar a las naves existentes.')
      : 'Selecciona un único sistema de origen para disponer de recuentos exactos.';
    if (matching) {
      produce.checked = existing.produce;
      autoSend.checked = existing.autoSend;
      button.textContent = 'Reconectar y reanudar esta misión';
    }
    const available = Boolean(capture && plan && (!existing || existing.status === 'sent' || matching)
      && existing?.status !== 'sending' && !existing?.needsReview && !existing?.fleetEdit && existing?.status !== 'uncertain');
    const syncButton = () => { button.disabled = !available || (!produce.checked && !autoSend.checked); };
    produce.addEventListener('change', syncButton);
    autoSend.addEventListener('change', syncButton);
    syncButton();
    if (!available) {
      status.className = 'error';
      status.textContent = captureError || (existing?.fleetEdit
        ? 'Esta misión tiene una edición pendiente. Usa Continuar edición en Flota para terminarla.'
        : existing?.needsReview || existing?.status === 'uncertain'
        ? 'Esta misión tiene un envío sin confirmar. Compruébalo primero desde Flota.'
        : existing && !matching && existing.status !== 'sent'
          ? 'Este origen ya tiene otra misión pendiente. Puedes cancelarla desde Flota antes de programar otra.'
          : 'La espera y la producción requieren un único sistema de origen con recuentos disponibles.');
      produce.disabled = autoSend.disabled = true;
    }
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        const context = missionContext();
        if (context.scope !== capture.spec.scope || context.originId !== capture.spec.originId || context.selectionCount !== 1) {
          throw new Error('El origen ha cambiado. Vuelve a elegir el preset desde ese sistema.');
        }
        let job;
        if (matching) {
          const fresh = fleetWait.getJobFor(context);
          if (!fresh || fresh.id !== existing.id || !sameMissionPreset(fresh, capture) || fresh.needsReview) {
            throw new Error('La misión pendiente ha cambiado. Revisa su estado en Flota.');
          }
          fleetWait.reconnect(fresh.id, capture.spec.target);
          fleetWait.update(fresh.id, { produce: produce.checked, autoSend: autoSend.checked });
          missionAdapter.attach(fresh.id, capture);
          fleetWait.resume(fresh.id);
          job = fresh;
        } else {
          job = fleetWait.queue({ ...capture.spec, produce: produce.checked, autoSend: autoSend.checked });
          missionAdapter.attach(job.id, capture);
        }
        settings.activeTab = 'fleet';
        settings.minimized = false;
        saveSettings();
        syncSettingsTabs();
        layoutHelper();
        dialog.close();
        card.remove();
        schedule();
      } catch (cause) {
        status.className = 'error';
        status.textContent = cause?.message || 'No se pudo guardar la misión pendiente.';
        syncButton();
      }
    });
    const actions = dialog.querySelector('.app-dialog-actions');
    if (actions) actions.before(card); else dialog.append(card);
    dialog.addEventListener('close', () => card.remove(), { once: true });
    return true;
  }
  // END FLEET WAIT INTEGRATION

  // BEGIN NOTIFIER
  /* Paste createNotifier inside the userscript's IIFE. Required metadata:
   * @grant GM_xmlhttpRequest
   * @grant GM_getValue
   * @grant GM_setValue
   * @connect api.telegram.org
   * All credentials and notification preferences use userscript storage only.
   */
  function createNotifier(deps = {}) {
    const own = (key) => Object.prototype.hasOwnProperty.call(deps, key);
    const gmGet = own('gmGetValue') ? deps.gmGetValue
      : (typeof GM_getValue === 'function' ? GM_getValue : null);
    const gmSet = own('gmSetValue') ? deps.gmSetValue
      : (typeof GM_setValue === 'function' ? GM_setValue : null);
    const gmRequest = own('gmXmlhttpRequest') ? deps.gmXmlhttpRequest
      : (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null);
    const NativeNotification = own('Notification') ? deps.Notification
      : (typeof Notification === 'function' ? Notification : null);
    const now = deps.now || (() => Date.now());
    const later = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancelTimer = deps.clearTimeout || ((id) => clearTimeout(id));
    const CONFIG_KEY = 'old-light-notifications:v1';
    const SEEN_KEY = 'old-light-notifications:seen:v1';
    const MAX_QUEUE = 100;
    const MAX_SEEN = 512;
    const SEEN_TTL = 24 * 60 * 60 * 1000;
    const TELEGRAM_GAP = 3100; // Also stays below Telegram's 20 messages/minute group limit.
    const BROWSER_GAP = 3100;
    const REQUEST_TIMEOUT = 15000;
    const MAX_429_RETRIES = 4;
    const CREDENTIAL_DEBOUNCE = 400;
    const EMPTY_DRAFTS = { botToken: '', chatId: '' };
    const EVENT_GROUPS = [
      { label: 'Actividad', enabled: true, entries: [
        ['request.sent', 'Solicitud enviada', '📤'],
        ['building.queued', 'Mejora en cola', '🏗️'],
        ['ships.queued', 'Naves en construcción', '🚀'],
        ['building.completed', 'Mejora completada', '✅'],
        ['fleet.changed', 'Flota actualizada', '🛸'],
        ['game.toast', 'Aviso del juego', '🔔'],
        ['game.reports', 'Informe del juego', '📋'],
        ['game.messages', 'Mensajes sin leer', '💬'],
        ['game.level_target', 'Objetivo de nivel alcanzado', '🎯'],
        ['attack.retry', 'Reintentos de ataque', '🔁'],
      ] },
      { label: 'Problemas', enabled: true, entries: [
        ['request.failed', 'Pedido fallido', '❌'],
        ['request.rejected', 'Mejora rechazada', '🚫'],
        ['request.unconfirmed', 'Pedido sin confirmación', '⚠️'],
        ['automation.paused', 'Pausa automática', '⏸️'],
      ] },
      { label: 'Ajustes', enabled: false, entries: [
        ['settings.buildings', 'Ajustes de edificios', '⚙️'],
        ['settings.minimum', 'Mínimos de naves', '⚙️'],
        ['settings.fleet_mode', 'Recuento de naves', '⚙️'],
        ['settings.priority', 'Prioridades', '⚙️'],
        ['settings.depot', 'Umbral del Depot', '⚙️'],
        ['settings.automation', 'Pausa o reanudación manual', '⏯️'],
      ] },
    ];
    const EVENT_TYPES = EVENT_GROUPS.flatMap((group) => group.entries.map(([type]) => type));
    const EVENT_META = new Map(EVENT_GROUPS.flatMap((group) =>
      group.entries.map(([type, label, icon]) => [type, { label, icon }])));
    // Report subtypes change presentation only; all share the existing reports filter.
    const REPORT_META = new Map([
      ['probe', { label: 'Sondeo', icon: '🔎' }],
      ['probe_failed', { label: 'Sondeo fallido', icon: '⚠️' }],
      ['probe_incoming', { label: 'Sondeo recibido', icon: '📡' }],
      ['battle', { label: 'Combate', icon: '⚔️' }],
      ['defense', { label: 'Defensa', icon: '🛡️' }],
      ['capture_success', { label: 'Sistema capturado', icon: '🚩' }],
      ['capture_loss', { label: 'Sistema perdido', icon: '⚠️' }],
      ['colonisation', { label: 'Colonización', icon: '🌌' }],
      ['colonisation_failed', { label: 'Colonización abortada', icon: '⚠️' }],
      ['hostility', { label: 'Hostilidad reducida', icon: '⚔️' }],
      ['salvage', { label: 'Recursos recuperados', icon: '📦' }],
      ['shipment_delivered', { label: 'Cargamento entregado', icon: '📦' }],
      ['shipment_received', { label: 'Cargamento recibido', icon: '📦' }],
      ['territory_raid', { label: 'Incursión en tu territorio', icon: '⚔️' }],
    ]);
    const DEFAULT_EVENTS = Object.fromEntries(EVENT_GROUPS.flatMap((group) =>
      group.entries.map(([type]) => [type, group.enabled])));
    const storageAvailable = typeof gmGet === 'function' && typeof gmSet === 'function';
    const telegramAvailable = storageAvailable && typeof gmRequest === 'function';
    const defaults = { browserEnabled: false, telegramEnabled: false,
      paused: false, browserPaused: false, telegramPaused: false, browserPauseEpoch: 0, telegramPauseEpoch: 0, botToken: '', chatId: '',
      drafts: EMPTY_DRAFTS, events: DEFAULT_EVENTS, eventsExpanded: false };
    let config = { ...defaults };
    let destroyed = false;
    let storageError = '';
    let browserStatus = '';
    let telegramStatus = '';
    let telegramBlocked = false;
    let consecutiveFailures = 0;
    let permissionBusy = false;
    let mounted = null;
    let browserTimer = null;
    let telegramTimer = null;
    let nextBrowserAt = 0;
    let nextTelegramAt = 0;
    let activeRequest = null;
    let testSequence = 0;
    let lastTestAt = -Infinity;
    let draftTimer = null;
    let autosaveStatus = 'Los ajustes se guardan automáticamente.';
    const browserQueue = [];
    const telegramQueue = [];
    const openNotifications = [];
    const seen = new Map();
    const counters = {
      accepted: 0, duplicates: 0, browserSent: 0, telegramSent: 0,
      browserFailed: 0, telegramFailed: 0, browserDropped: 0, telegramDropped: 0,
      rateRetries: 0, filtered: 0, suppressed: 0,
    };
  
    function validToken(value) {
      return typeof value === 'string' && /^\d{1,20}:[A-Za-z0-9_-]{20,200}$/.test(value);
    }
  
    function validChat(value) {
      return typeof value === 'string'
        && (/^-?[1-9]\d{0,19}$/.test(value) || /^@[A-Za-z0-9_]{5,64}$/.test(value));
    }
  
    function permission() {
      try { return NativeNotification ? NativeNotification.permission || 'default' : 'unsupported'; }
      catch { return 'unsupported'; }
    }
  
    function configured() {
      return telegramAvailable && validToken(config.botToken) && validChat(config.chatId);
    }
  
    function validDrafts(value) {
      return value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.botToken === 'string' && value.botToken.length <= 221
        && typeof value.chatId === 'string' && value.chatId.length <= 65;
    }
  
    function normalizeConfig(saved) {
      if (!saved || typeof saved !== 'object') return { ...defaults, events: { ...DEFAULT_EVENTS }, drafts: { ...EMPTY_DRAFTS } };
      if (['paused', 'browserPaused', 'telegramPaused'].some(key => saved[key] !== undefined && typeof saved[key] !== 'boolean') ||
          ['browserPauseEpoch', 'telegramPauseEpoch'].some(key => saved[key] !== undefined &&
            (!Number.isSafeInteger(saved[key]) || saved[key] < 0))) throw new TypeError('Las pausas guardadas no son válidas.');
      return {
        browserEnabled: saved.browserEnabled === true,
        telegramEnabled: saved.telegramEnabled === true,
        paused: saved.paused === true,
        browserPaused: saved.browserPaused === true,
        telegramPaused: saved.telegramPaused === true,
        browserPauseEpoch: saved.browserPauseEpoch ?? 0,
        telegramPauseEpoch: saved.telegramPauseEpoch ?? 0,
        eventsExpanded: saved.eventsExpanded === true,
        botToken: validToken(saved.botToken) ? saved.botToken : '',
        chatId: validChat(saved.chatId) ? saved.chatId : '',
        drafts: validDrafts(saved.drafts)
          ? { botToken: saved.drafts.botToken, chatId: saved.drafts.chatId } : { ...EMPTY_DRAFTS },
        events: Object.fromEntries(EVENT_TYPES.map((type) => [type,
          typeof saved.events?.[type] === 'boolean' ? saved.events[type] : DEFAULT_EVENTS[type]])),
      };
    }
  
    function sameDrafts(a, b) {
      return a.botToken === b.botToken && a.chatId === b.chatId;
    }
  
    function credentialDraftState() {
      const draftToken = config.drafts.botToken.trim();
      const draftChat = config.drafts.chatId.trim();
      const botToken = draftToken || config.botToken;
      const chatId = draftChat || config.chatId;
      const pending = Boolean(config.drafts.botToken || config.drafts.chatId);
      let message = '';
      if (pending) {
        if (draftToken && !validToken(draftToken)) message = 'Borrador guardado. El token todavía no tiene un formato válido.';
        else if (draftChat && !validChat(draftChat)) message = 'Borrador guardado. Revisa el Chat ID: número o @canal.';
        else if (!validToken(botToken) && !validChat(chatId)) message = 'Borrador guardado. Faltan el token y el Chat ID.';
        else if (!validToken(botToken)) message = 'Borrador guardado. Falta un token válido.';
        else if (!validChat(chatId)) message = 'Borrador guardado. Falta un Chat ID válido.';
        else message = 'Borrador guardado. Se aplicará automáticamente al terminar de escribir.';
      }
      return { pending, botToken, chatId, valid: validToken(botToken) && validChat(chatId), message };
    }
  
    function cancelDraftTimer() {
      if (draftTimer !== null) cancelTimer(draftTimer);
      draftTimer = null;
    }
  
    function restoreDraftFields(force = false) {
      if (!mounted || (!force && (mounted.editing.size || mounted.editorDirty))) return;
      // Only unapplied drafts are restored. Saved active credentials never populate inputs.
      mounted.token.value = config.drafts.botToken;
      mounted.chat.value = config.drafts.chatId;
      mounted.editorDirty = false;
    }
  
    function eventAllowed(type) {
      return EVENT_TYPES.includes(type) && config.events[type] === true;
    }
  
    function queuedEventAllowed(item) {
      return item.test === true || eventAllowed(item.type);
    }
  
    function dropFilteredQueueItems() {
      for (let index = browserQueue.length - 1; index >= 0; index -= 1) {
        if (!queuedEventAllowed(browserQueue[index])) {
          browserQueue.splice(index, 1);
          counters.browserDropped += 1;
        }
      }
      for (let index = telegramQueue.length - 1; index >= 0; index -= 1) {
        if (!queuedEventAllowed(telegramQueue[index])) {
          telegramQueue.splice(index, 1);
          counters.telegramDropped += 1;
        }
      }
      if (!browserQueue.length && browserTimer !== null) {
        cancelTimer(browserTimer);
        browserTimer = null;
      }
      if (!telegramQueue.length && telegramTimer !== null) {
        cancelTimer(telegramTimer);
        telegramTimer = null;
      }
      // A filter only removes unsent items; it never aborts an in-flight request.
    }
  
    function refreshSeen() {
      if (!storageAvailable) return;
      try {
        const savedSeen = gmGet(SEEN_KEY, []);
        if (Array.isArray(savedSeen)) {
          for (const entry of savedSeen.slice(-MAX_SEEN)) {
            if (Array.isArray(entry) && /^[a-f0-9]{16}$/.test(entry[0])
                && Number.isFinite(entry[1]) && entry[1] <= now()
                && entry[1] > now() - SEEN_TTL) seen.set(entry[0], entry[1]);
          }
        }
        while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      } catch { /* Keep this tab's deduplication if the manager cannot be read. */ }
    }
  
    try {
      if (storageAvailable) {
        config = normalizeConfig(gmGet(CONFIG_KEY, null));
          autosaveStatus = credentialDraftState().message || autosaveStatus;
        refreshSeen();
      }
    } catch {
      config = { ...defaults };
      storageError = 'No se pudo leer la configuración de avisos del gestor.';
    }
  
    // Conservative UTF-16 length limit, preserving complete Unicode code points.
    function plain(value, limit) {
      let text = typeof value === 'string' ? value : '';
      if (config.botToken) text = text.split(config.botToken).join('[token oculto]');
      text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
      text = typeof text.toWellFormed === 'function' ? text.toWellFormed()
        : Array.from(text, (char) => char.length === 1 && /[\uD800-\uDFFF]/.test(char) ? '\uFFFD' : char).join('');
      if (text.length <= limit) return text;
      let end = limit - 1;
      if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end -= 1;
      return text.slice(0, end) + '…';
    }
  
    function keyFor(text) {
      let a = 0x811c9dc5;
      let b = 0x9e3779b9;
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x85ebca6b);
      }
      return (a >>> 0).toString(16).padStart(8, '0')
        + (b >>> 0).toString(16).padStart(8, '0');
    }
  
    function remember(key) {
      const timestamp = now();
      for (const [oldKey, at] of seen) {
        if (at <= timestamp - SEEN_TTL) seen.delete(oldKey);
      }
      seen.set(key, timestamp);
      while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      try { if (storageAvailable) gmSet(SEEN_KEY, [...seen]); }
      catch { storageError = 'No se pudo guardar la deduplicación; se conserva en esta pestaña.'; }
    }
  
    function closeBrowserNotifications() {
      for (const notification of openNotifications.splice(0)) {
        try { notification.close(); } catch { /* Native implementations may omit close. */ }
      }
    }
  
    function clearBrowserQueue() {
      if (browserTimer !== null) cancelTimer(browserTimer);
      browserTimer = null;
      counters.browserDropped += browserQueue.length;
      browserQueue.length = 0;
      closeBrowserNotifications();
    }
  
    function clearTelegramQueue() {
      if (telegramTimer !== null) cancelTimer(telegramTimer);
      telegramTimer = null;
      counters.telegramDropped += telegramQueue.length;
      telegramQueue.length = 0;
      const request = activeRequest;
      activeRequest = null;
      if (request) {
        request.settled = true;
        cancelTimer(request.watchdog);
        counters.telegramDropped += 1;
        try { request.control?.abort(); } catch { /* Never expose a token-bearing transport error. */ }
      }
    }

    function channelPaused(channel, value = config) {
      return value.paused || value[channel + 'Paused'];
    }
  
    function writeConfig(next) {
      if (!storageAvailable) {
        storageError = 'Faltan GM_getValue/GM_setValue. Revisa los permisos del userscript.';
        updateUI();
        return false;
      }
      next = normalizeConfig(next);
      // Invalidations belong to a new pause, not to the age of a backup.
      // Keep them monotonic when restoring older saved pause preferences.
      for (const channel of ['browser', 'telegram']) {
        const epoch = channel + 'PauseEpoch';
        const enteringPause = (next.paused && !config.paused) || (next[channel + 'Paused'] && !config[channel + 'Paused']);
        next[epoch] = Math.max(config[epoch], next[epoch]) + (enteringPause ? 1 : 0);
        if (!Number.isSafeInteger(next[epoch])) {
          storageError = 'No se pudo guardar el estado de pausa.';
          updateUI();
          return false;
        }
      }
      try {
        const saved = gmSet(CONFIG_KEY, { ...next });
        if (saved === false || saved && typeof saved.then === 'function') throw new Error('El guardado debe ser síncrono.');
      }
      catch {
        storageError = 'No se pudo guardar en el gestor. La configuración no ha cambiado.';
        updateUI();
        return false;
      }
      const destinationChanged = next.botToken !== config.botToken || next.chatId !== config.chatId;
      if (destinationChanged || (config.telegramEnabled && !next.telegramEnabled) || channelPaused('telegram', next)
          || next.telegramPauseEpoch !== config.telegramPauseEpoch) clearTelegramQueue();
      if (!next.browserEnabled || channelPaused('browser', next)
          || next.browserPauseEpoch !== config.browserPauseEpoch) clearBrowserQueue();
      config = { ...next };
      dropFilteredQueueItems();
      storageError = '';
      autosaveStatus = credentialDraftState().message || 'Guardado automáticamente.';
      updateUI();
      try { deps.onSettingsChange?.(); } catch { /* Los avisos no dependen de la copia de seguridad. */ }
      return true;
    }
  
    function refreshConfig() {
      if (destroyed || !storageAvailable) return false;
      try {
        const saved = gmGet(CONFIG_KEY, null);
        if (saved && typeof saved.then === 'function') throw new Error('La lectura debe ser síncrona.');
        const next = normalizeConfig(saved);
        const destinationChanged = next.botToken !== config.botToken || next.chatId !== config.chatId;
        const telegramChanged = next.telegramEnabled !== config.telegramEnabled;
        const browserChanged = next.browserEnabled !== config.browserEnabled;
        const eventsChanged = EVENT_TYPES.some((type) => next.events[type] !== config.events[type]);
        const draftsChanged = !sameDrafts(next.drafts, config.drafts);
        const pausesChanged = ['paused', 'browserPaused', 'telegramPaused', 'browserPauseEpoch', 'telegramPauseEpoch']
          .some(key => next[key] !== config[key]);
        if (!destinationChanged && !telegramChanged && !browserChanged && !eventsChanged
            && !draftsChanged && !pausesChanged && next.eventsExpanded === config.eventsExpanded) return true;
        if (destinationChanged || (config.telegramEnabled && !next.telegramEnabled) || channelPaused('telegram', next)
            || next.telegramPauseEpoch !== config.telegramPauseEpoch) clearTelegramQueue();
        if ((config.browserEnabled && !next.browserEnabled) || channelPaused('browser', next)
            || next.browserPauseEpoch !== config.browserPauseEpoch) clearBrowserQueue();
        config = next;
        dropFilteredQueueItems();
        if (draftsChanged || destinationChanged) {
          cancelDraftTimer();
          restoreDraftFields();
        }
        if (destinationChanged || (telegramChanged && next.telegramEnabled)) {
          telegramBlocked = false;
          consecutiveFailures = 0;
          telegramStatus = 'Configuración actualizada desde el gestor.';
        }
        storageError = '';
        autosaveStatus = credentialDraftState().message || 'Guardado automáticamente.';
        updateUI();
        return true;
      } catch {
        storageError = 'No se pudo actualizar la configuración desde el gestor.';
        updateUI();
        return false;
      }
    }

    function setPaused(target, value) {
      if (!['all', 'browser', 'telegram'].includes(target) || typeof value !== 'boolean') {
        throw new TypeError('La pausa debe indicar todos los avisos, navegador o Telegram y un valor booleano.');
      }
      if (!refreshConfig()) return false;
      const field = target === 'all' ? 'paused' : target + 'Paused';
      if (config[field] === value) return true;
      const next = { ...config, [field]: value };
      return writeConfig(next);
    }
  
    function isEnabled() {
      refreshConfig();
      // Observation keeps running while delivery is paused, so reports and
      // level crossings are consumed without a burst of old alerts on resume.
      return !destroyed && (config.browserEnabled || config.telegramEnabled)
        && EVENT_TYPES.some((type) => config.events[type]);
    }
  
    function armBrowser() {
      if (destroyed || browserTimer !== null || !browserQueue.length) return;
      browserTimer = later(() => {
        browserTimer = null;
        pumpBrowser();
      }, Math.max(0, nextBrowserAt - now()));
    }
  
    function pumpBrowser() {
      if (!refreshConfig()) { clearBrowserQueue(); return; }
      dropFilteredQueueItems();
      if (destroyed || !browserQueue.length) return;
      if (channelPaused('browser')) { clearBrowserQueue(); updateUI(); return; }
      if (!config.browserEnabled || permission() !== 'granted') {
        clearBrowserQueue();
        browserStatus = permission() === 'denied'
          ? 'Permiso bloqueado: habilítalo en los ajustes del sitio.' : 'Navegador sin permiso para avisar.';
        updateUI();
        return;
      }
      const item = browserQueue.shift();
      nextBrowserAt = now() + BROWSER_GAP;
      try {
        const notification = new NativeNotification(plain(item.title, 160), {
          body: plain(item.message, 1200), tag: 'old-light-' + item.key,
        });
        openNotifications.push(notification);
        if (openNotifications.length > 5) {
          try { openNotifications.shift()?.close(); } catch { /* Best effort. */ }
        }
        counters.browserSent += 1;
        browserStatus = 'Último aviso mostrado.';
      } catch {
        counters.browserFailed += 1;
        clearBrowserQueue();
        browserStatus = 'El navegador no pudo mostrar el aviso. Revisa sus permisos y compatibilidad.';
      }
      updateUI();
      armBrowser();
    }
  
    function armTelegram() {
      if (destroyed || telegramTimer !== null || activeRequest || !telegramQueue.length) return;
      telegramTimer = later(() => {
        telegramTimer = null;
        pumpTelegram();
      }, Math.min(60 * 60 * 1000, Math.max(0, nextTelegramAt - now())));
    }
  
    function retryDelay(response, payload, attempts) {
      let delay = 0;
      const seconds = Number(payload?.parameters?.retry_after);
      if (Number.isFinite(seconds) && seconds >= 0) delay = seconds * 1000;
      const headers = typeof response?.responseHeaders === 'string' ? response.responseHeaders : '';
      const header = headers.match(/^retry-after:\s*([^\r\n]+)/im)?.[1]?.trim();
      if (header) {
        const headerDelay = /^\d+(?:\.\d+)?$/.test(header)
          ? Number(header) * 1000 : Date.parse(header) - now();
        if (Number.isFinite(headerDelay)) delay = Math.max(delay, headerDelay);
      }
      // Never retry sooner than a server-provided delay. Invalid/absent delays back off.
      return Math.max(TELEGRAM_GAP, delay || 5000 * (2 ** attempts)) + 250;
    }
  
    function failTelegram(code, transport) {
      counters.telegramFailed += 1;
      consecutiveFailures += 1;
      const messages = {
        400: 'Telegram rechazó el mensaje. Revisa el chat ID y la configuración del chat.',
        401: 'Telegram rechazó el token. Guarda un token válido.',
        403: 'El bot no puede escribir en ese chat. Revisa su acceso.',
        404: 'Telegram no encontró el bot o el método. Revisa el token.',
      };
      telegramStatus = transport === 'timeout'
        ? 'Telegram no confirmó el envío a tiempo; no se repite para evitar duplicados.'
        : transport === 'network' || transport === 'abort'
          ? 'Envío sin confirmación de red; no se repite para evitar duplicados.'
          : messages[code] || 'Telegram no confirmó el envío' + (code ? ' (HTTP/API ' + code + ')' : '') + '.';
      if ([400, 401, 403, 404].includes(code) || consecutiveFailures >= 3) {
        telegramBlocked = true;
        counters.telegramDropped += telegramQueue.length;
        telegramQueue.length = 0;
        telegramStatus += ' Guarda la configuración o usa Enviar prueba para reanudar los avisos.';
      }
    }
  
    function pumpTelegram() {
      if (!refreshConfig()) { clearTelegramQueue(); return; }
      dropFilteredQueueItems();
      if (destroyed || activeRequest || !telegramQueue.length) return;
      if (channelPaused('telegram')) { clearTelegramQueue(); updateUI(); return; }
      if (now() < nextTelegramAt) { armTelegram(); return; }
      if (telegramBlocked || !configured()) return;
      const item = telegramQueue.shift();
      if (!config.telegramEnabled && !item.test) {
        counters.telegramDropped += 1;
        armTelegram();
        updateUI();
        return;
      }
      const request = { item, control: null, watchdog: null, settled: false };
      activeRequest = request;
      nextTelegramAt = now() + TELEGRAM_GAP;
      telegramStatus = item.test ? 'Enviando la prueba solicitada…' : 'Enviando aviso…';
      updateUI();
  
      function finish(kind, response) {
        if (destroyed || request.settled || activeRequest !== request) return;
        if (!refreshConfig()) { clearTelegramQueue(); return; }
        if (destroyed || request.settled || activeRequest !== request) return;
        request.settled = true;
        cancelTimer(request.watchdog);
        activeRequest = null;
        nextTelegramAt = Math.max(nextTelegramAt, now() + TELEGRAM_GAP);
        let payload = null;
        let status = 0;
        if (kind === 'load') {
          try {
            status = Number.isInteger(response?.status) ? response.status : 0;
            payload = response?.response;
            if (!payload || typeof payload !== 'object') {
              const raw = typeof payload === 'string' ? payload : response?.responseText;
              payload = typeof raw === 'string' ? JSON.parse(raw) : null;
            }
          } catch { payload = null; }
        }
        const apiCode = Number.isInteger(payload?.error_code) ? payload.error_code : 0;
        if (kind === 'load' && (status === 429 || apiCode === 429)) {
          const delay = retryDelay(response, payload, item.retries);
          nextTelegramAt = Math.max(nextTelegramAt, now() + delay);
          if (!queuedEventAllowed(item)) {
            counters.telegramDropped += 1;
            telegramStatus = 'Aviso descartado por su filtro; no se reintentará.';
          } else if (item.retries < MAX_429_RETRIES && Number.isFinite(nextTelegramAt)) {
            item.retries += 1;
            counters.rateRetries += 1;
            telegramQueue.unshift(item);
            telegramStatus = 'Límite de Telegram: se respetará su espera antes de reintentar.';
          } else {
            counters.telegramFailed += 1;
            telegramBlocked = true;
            counters.telegramDropped += telegramQueue.length;
            telegramQueue.length = 0;
            telegramStatus = 'Telegram sigue limitando los envíos. Usa Enviar prueba más tarde para reanudar.';
          }
        } else if (kind === 'load' && status >= 200 && status < 300 && payload?.ok === true) {
          counters.telegramSent += 1;
          consecutiveFailures = 0;
          telegramStatus = item.test ? 'Prueba enviada a Telegram.' : 'Último aviso enviado a Telegram.';
        } else {
          failTelegram(apiCode || status, kind === 'load' ? '' : kind);
        }
        updateUI();
        armTelegram();
      }
  
      // Tampermonkey's fetch mode can ignore its native timeout: keep our own watchdog.
      request.watchdog = later(() => {
        finish('timeout', null);
        try { request.control?.abort(); } catch { /* The error can contain the token-bearing URL. */ }
      }, REQUEST_TIMEOUT);
      try {
        request.control = gmRequest({
          method: 'POST',
          url: 'https://api.telegram.org/bot' + config.botToken + '/sendMessage',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({
            chat_id: config.chatId,
            text: item.text,
            disable_web_page_preview: true,
            link_preview_options: { is_disabled: true },
          }),
          anonymous: true,
          redirect: 'error',
          responseType: 'json',
          timeout: REQUEST_TIMEOUT,
          onload: (response) => finish('load', response),
          onerror: () => finish('network', null),
          ontimeout: () => finish('timeout', null),
          onabort: () => finish('abort', null),
        });
      } catch {
        finish('network', null);
      }
    }
  
    function emit(event) {
      try {
        if (destroyed || !event || typeof event !== 'object') return false;
        if (!refreshConfig()) return false;
        const type = typeof event.type === 'string' ? event.type : '';
        if (!eventAllowed(type)) { counters.filtered += 1; return false; }
        const meta = (type === 'game.reports' ? REPORT_META.get(event.reportKind) : null)
          || EVENT_META.get(type);
        const title = `${meta.icon} Old Light · ${meta.label}`;
        const systemName = plain(typeof event.systemName === 'string'
          ? event.systemName.replace(/\s+/g, ' ').trim() : '', 400);
        const detail = plain(event.message || '', 4096);
        const message = (systemName ? `Sistema: ${systemName}\n\n` : '') + detail;
        const formatted = plain(title + (systemName ? '\n' : '\n\n') + message, 4096);
        const identity = typeof event.id === 'string' && event.id ? event.id.slice(0, 8192)
          : typeof event.id === 'number' ? String(event.id) : title + '\n' + message;
        const key = keyFor(type + '\0' + identity);
        const browserConfigured = config.browserEnabled && permission() === 'granted';
        const telegramConfigured = config.telegramEnabled && configured();
        const browserOn = browserConfigured && !channelPaused('browser');
        const telegramOn = telegramConfigured && !channelPaused('telegram') && !telegramBlocked;
        const suppressed = (browserConfigured && channelPaused('browser')) || (telegramConfigured && channelPaused('telegram'));
        if (!browserOn && !telegramOn && !suppressed) return false;
        refreshSeen();
        if (seen.has(key) && seen.get(key) > now() - SEEN_TTL) {
          counters.duplicates += 1;
          return false;
        }
        remember(key);
        if (suppressed) counters.suppressed += 1;
        const item = { key, type, title, message, text: formatted, retries: 0 };
        let accepted = false;
        if (browserOn) {
          if (browserQueue.length < MAX_QUEUE) { browserQueue.push(item); accepted = true; armBrowser(); }
          else counters.browserDropped += 1;
        }
        if (telegramOn) {
          if (telegramQueue.length + (activeRequest ? 1 : 0) < MAX_QUEUE) {
            telegramQueue.push({ ...item }); accepted = true; armTelegram();
          } else counters.telegramDropped += 1;
        }
        if (accepted) counters.accepted += 1;
        updateUI();
        return accepted;
      } catch {
        // Notifications must never interrupt a game observer, click, or pending action.
        return false;
      }
    }
  
    function commitCredentialDraft(clearFields = false, expectedDrafts = null) {
      if (destroyed) return false;
      cancelDraftTimer();
      if (!refreshConfig()) return false;
      // A remote import or another tab supersedes the draft captured by an older timer.
      if (expectedDrafts && !sameDrafts(expectedDrafts, config.drafts)) return false;
      const draft = credentialDraftState();
      if (draft.pending && !draft.valid) {
        autosaveStatus = draft.message;
        updateUI();
        return false;
      }
      if (draft.pending) {
        const destinationChanged = draft.botToken !== config.botToken || draft.chatId !== config.chatId;
        if (!writeConfig({ ...config, botToken: draft.botToken, chatId: draft.chatId, drafts: EMPTY_DRAFTS })) return false;
        if (destinationChanged) {
          telegramBlocked = false;
          consecutiveFailures = 0;
          telegramStatus = config.telegramEnabled ? 'Activado.' : 'Credenciales listas; Telegram está desactivado.';
        }
      }
      if (clearFields && mounted) {
        mounted.token.value = '';
        mounted.chat.value = '';
        mounted.editorDirty = false;
      }
      autosaveStatus = 'Guardado automáticamente.';
      updateUI();
      return true;
    }
  
    function scheduleCredentialCommit() {
      cancelDraftTimer();
      if (destroyed || !credentialDraftState().pending) return;
      const expectedDrafts = { ...config.drafts };
      draftTimer = later(() => {
        draftTimer = null;
        commitCredentialDraft(false, expectedDrafts);
      }, CREDENTIAL_DEBOUNCE);
    }
  
    function saveEditorDraft(schedule = true) {
      if (destroyed || !mounted) return false;
      const drafts = { botToken: mounted.token.value, chatId: mounted.chat.value };
      mounted.editorDirty = true;
      cancelDraftTimer();
      if (!refreshConfig()) return false;
      if (!validDrafts(drafts)) {
        storageError = 'El borrador supera la longitud permitida. Acorta el campo para guardarlo.';
        updateUI();
        return false;
      }
      // Store unfinished credentials before scheduling promotion. The active pair is untouched.
      if (!sameDrafts(drafts, config.drafts) && !writeConfig({ ...config, drafts })) return false;
      if (schedule) scheduleCredentialCommit();
      return true;
    }
  
    function flushEditorDraft(clearFields) {
      if (destroyed || !mounted) return false;
      if (!refreshConfig()) return false;
      const tokenValue = mounted.token.value.trim();
      const chatValue = mounted.chat.value.trim();
      const alreadyApplied = !credentialDraftState().pending
        && (!tokenValue || tokenValue === config.botToken) && (!chatValue || chatValue === config.chatId);
      if (!alreadyApplied && !saveEditorDraft(false)) return false;
      return commitCredentialDraft(clearFields, { ...config.drafts });
    }
  
    function getDiagnostics() {
      return {
        destroyed,
        paused: config.paused,
        storageAvailable,
        storageError,
        autosave: { status: autosaveStatus, draftStored: credentialDraftState().pending, pending: draftTimer !== null },
        events: { ...config.events },
        browser: {
          enabled: config.browserEnabled, permission: permission(),
          paused: config.browserPaused, effectivePaused: channelPaused('browser'),
          deliveryEnabled: config.browserEnabled && permission() === 'granted' && !channelPaused('browser'),
          queued: browserQueue.length, status: browserStatus,
        },
        telegram: {
          available: telegramAvailable, enabled: config.telegramEnabled,
          paused: config.telegramPaused, effectivePaused: channelPaused('telegram'),
          deliveryEnabled: config.telegramEnabled && configured() && !telegramBlocked && !channelPaused('telegram'),
          configured: configured(), blocked: telegramBlocked,
          queued: telegramQueue.length, sending: !!activeRequest,
          retryAfterMs: Math.max(0, nextTelegramAt - now()), status: telegramStatus,
        },
        counters: { ...counters },
      };
    }
  
    function updateUI() {
      if (!mounted) return;
      const { root, browser, telegram, permit, token, chat, test, status, eventInputs, eventCount } = mounted;
      const p = permission();
      browser.checked = config.browserEnabled;
      browser.disabled = !storageAvailable || p === 'unsupported' || (p !== 'granted' && !config.browserEnabled);
      telegram.checked = config.telegramEnabled;
      telegram.disabled = !telegramAvailable;
      permit.disabled = !storageAvailable || p === 'unsupported' || p === 'denied' || permissionBusy;
      permit.hidden = p === 'granted';
      const permitText = p === 'granted' ? 'Activar avisos del navegador' : 'Permitir avisos del navegador';
      if (permit.textContent !== permitText) permit.textContent = permitText;
      token.placeholder = config.botToken ? 'Token guardado; vacío lo conserva' : 'Token del bot';
      chat.placeholder = config.chatId ? 'Chat guardado; vacío lo conserva' : 'ID numérico o @canal';
      token.disabled = chat.disabled = !storageAvailable;
      test.disabled = config.paused || config.telegramPaused || !configured() || credentialDraftState().pending
        || !!activeRequest || telegramQueue.some((item) => item.test);
      for (const [target, button] of mounted.pauseButtons) {
        const paused = target === 'all' ? config.paused : config[target + 'Paused'];
        const label = target === 'all' ? paused ? 'Reanudar avisos' : 'Pausar todos los avisos'
          : paused ? 'Reanudar' : 'Pausar';
        const channel = target === 'browser' ? 'del navegador' : 'por Telegram';
        if (button.textContent !== label) button.textContent = label;
        button.disabled = !storageAvailable;
        button.setAttribute('aria-pressed', String(!!paused));
        button.setAttribute('aria-label', target === 'all' ? label : `${paused ? 'Reanudar' : 'Pausar'} avisos ${channel}`);
      }
      const channelStates = {
        browser: config.paused ? config.browserPaused ? 'Pausa global y del canal' : 'Pausa global'
          : config.browserPaused ? 'Pausado en este canal' : !config.browserEnabled ? 'Desactivado'
            : p === 'denied' ? 'Permiso bloqueado' : p === 'unsupported' ? 'No disponible'
              : p !== 'granted' ? 'Falta permiso' : 'Activo',
        telegram: config.paused ? config.telegramPaused ? 'Pausa global y del canal' : 'Pausa global'
          : config.telegramPaused ? 'Pausado en este canal' : !config.telegramEnabled ? 'Desactivado'
            : !configured() ? 'Faltan credenciales' : telegramBlocked ? 'Revisa la conexión' : 'Activo',
      };
      for (const [channel, state] of mounted.channelStates) {
        if (state.textContent !== channelStates[channel]) state.textContent = channelStates[channel];
        state.dataset.paused = String(!!(config.paused || config[channel + 'Paused']));
        state.dataset.tone = config.paused || config[channel + 'Paused'] ? 'paused'
          : channelStates[channel] === 'Activo' ? 'active' : 'muted';
      }
      mounted.pauseState.textContent = config.paused ? 'Pausa global activa'
        : config.browserPaused && config.telegramPaused ? 'Ambos canales están pausados'
          : config.browserPaused ? 'Navegador pausado' : config.telegramPaused ? 'Telegram pausado'
            : 'Sin pausas activas';
      for (const [type, input] of eventInputs) {
        input.checked = config.events[type];
        input.disabled = !storageAvailable;
      }
      const enabledEvents = EVENT_TYPES.filter((type) => config.events[type]).length;
      const eventCountText = `${enabledEvents} / ${EVENT_TYPES.length}`;
      if (eventCount.textContent !== eventCountText) eventCount.textContent = eventCountText;
      eventCount.setAttribute('aria-label', `${enabledEvents} de ${EVENT_TYPES.length} tipos activados`);
      mounted.eventsAll.disabled = !storageAvailable || enabledEvents === EVENT_TYPES.length;
      mounted.eventsNone.disabled = !storageAvailable || enabledEvents === 0;
      if (mounted.eventsDetails.open !== config.eventsExpanded) mounted.eventsDetails.open = config.eventsExpanded;
      const browserLine = config.paused || config.browserPaused ? 'Navegador: ' + channelStates.browser.toLowerCase() + '.'
        : p === 'denied' ? 'Navegador: permiso bloqueado en los ajustes del sitio.'
        : p === 'unsupported' ? 'Este navegador no admite avisos de escritorio.'
          : 'Navegador: ' + (config.browserEnabled ? browserStatus || 'activado.' : 'desactivado.');
      const telegramLine = 'Telegram: ' + (config.paused || config.telegramPaused
        ? channelStates.telegram.toLowerCase() + '.' : telegramStatus || (config.telegramEnabled ? 'activado.' : 'desactivado.'));
      const pendingLine = 'En cola: ' + browserQueue.length + ' navegador / ' + telegramQueue.length + ' Telegram.';
      const dropped = counters.browserDropped + counters.telegramDropped;
      const content = [storageError, storageError ? '' : autosaveStatus, browserLine, telegramLine, pendingLine,
        dropped ? 'Avisos descartados o cancelados: ' + dropped + '.' : ''].filter(Boolean).join('\n');
      if (status.textContent !== content) status.textContent = content;
      const draft = credentialDraftState();
      const attention = [storageError, draft.pending && !draft.valid ? draft.message : '',
        p === 'denied' ? 'Navegador: permite las notificaciones desde los ajustes del sitio.' : '',
        config.browserEnabled && /no pudo|no se pudo/i.test(browserStatus) ? browserStatus : '',
        telegramBlocked ? 'Telegram: ' + (telegramStatus || 'Revisa la conexión y envía una prueba.') : '']
        .filter(Boolean).join('\n');
      if (mounted.alert.textContent !== attention) mounted.alert.textContent = attention;
      mounted.alert.hidden = !attention;
      const connectionLabel = draft.pending ? 'Borrador de conexión' : configured() ? 'Conexión y prueba' : 'Configurar Telegram';
      if (mounted.connectionLabel.textContent !== connectionLabel) mounted.connectionLabel.textContent = connectionLabel;
      const connectionStatus = /prueba|no se pudo|espera|límite|limitando|cola está llena/i.test(telegramStatus)
        ? telegramStatus : '';
      if (mounted.connectionStatus.textContent !== connectionStatus) mounted.connectionStatus.textContent = connectionStatus;
      mounted.connectionStatus.hidden = !connectionStatus;
      if (root.dataset.telegramBlocked !== String(telegramBlocked)) root.dataset.telegramBlocked = String(telegramBlocked);
    }
  
    function mount(container) {
      refreshConfig();
      if (destroyed || !container?.appendChild) return null;
      if (mounted) {
        if (mounted.root.parentNode !== container) container.appendChild(mounted.root);
        updateUI();
        return mounted.root;
      }
      const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc) return null;
      const root = doc.createElement('details');
      root.className = 'notifications-details';
      // Static markup only. Event content and API data never become HTML.
      root.innerHTML = `
        <style>
          .notifications-details{border:0;padding:0;margin:0;max-width:100%;min-width:0;font:inherit;color:var(--ol-text,#e5eef6);overflow-wrap:anywhere}
          .notifications-details [hidden]{display:none!important}
          .notifications-details summary{cursor:pointer;font-weight:600;padding:4px 0;color:var(--ol-text,#e5eef6)}
          .notifications-details .notify-body{display:grid;gap:10px;padding-top:0;min-width:0}
          .notifications-details label{display:flex;align-items:center;gap:8px;font:inherit;min-width:0;cursor:pointer}
          .notifications-details .notify-field{display:grid;gap:6px;font-size:12px;cursor:default}
          .notifications-details input[type="text"],.notifications-details input[type="password"]{box-sizing:border-box;width:100%;min-width:0;min-height:36px;padding:8px 10px;border:1px solid var(--ol-border-strong,#456177);border-radius:7px;background:var(--ol-bg,#0c141d);color:inherit;font:inherit}
          .notifications-details input[type="checkbox"]{flex:0 0 auto;width:16px;height:16px;margin:0;accent-color:var(--ol-accent,#7de2c2)}
          .notifications-details button{box-sizing:border-box;max-width:100%;min-height:34px;padding:7px 10px;border:1px solid var(--ol-border-strong,#456177);border-radius:7px;background:var(--ol-surface-raised,#192939);color:var(--ol-text,#e5eef6);cursor:pointer;font:inherit;white-space:normal}
          .notifications-details button:hover:not(:disabled){border-color:var(--ol-accent,#7de2c2)}
          .notifications-details button:disabled{opacity:.45;cursor:default}
          .notifications-details .notify-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
          .notifications-details .notify-pause-controls{display:grid;gap:8px;padding:12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b);min-width:0}
          .notifications-details .notify-pause-controls>button{width:100%;min-height:36px;font-weight:600;background:var(--ol-accent-bg,#183c36);color:var(--ol-accent,#7de2c2)}
          .notifications-details [data-notification-pause][aria-pressed="true"]{border-color:var(--ol-warning,#f3cb80);color:var(--ol-warning,#f3cb80);background:var(--ol-surface-raised,#192939)}
          .notifications-details .notify-pause-state{font-size:12px;font-weight:600;line-height:1.4}
          .notifications-details .notify-channel{display:grid;gap:10px;min-width:0;padding:12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b)}
          .notifications-details .notify-channel-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;min-width:0}
          .notifications-details .notify-channel-info{display:grid;gap:5px;min-width:0}
          .notifications-details .notify-channel-info>label{font-weight:600;min-height:24px}
          .notifications-details .notify-channel-state{font-size:11.5px;line-height:1.4;color:var(--ol-muted,#a2b5c6)}
          .notifications-details .notify-channel-state::before{content:'●';font-size:9px;margin-right:6px}
          .notifications-details .notify-channel-state[data-tone="active"]{color:var(--ol-accent,#7de2c2)}
          .notifications-details .notify-channel-state[data-paused="true"]{color:var(--ol-warning,#f3cb80)}
          .notifications-details .notify-channel-row>button{min-width:76px}
          .notifications-details .notification-events-details,.notifications-details .notification-diagnostics-details{min-width:0;margin:0;padding:10px 12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b)}
          .notifications-details .notify-summary-content{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;width:calc(100% - 18px)}
          .notifications-details .notification-events-count{font-size:11.5px;font-weight:500;padding:2px 7px;border-radius:12px;background:var(--ol-surface-raised,#192939);color:var(--ol-muted,#a2b5c6);white-space:nowrap;font-variant-numeric:tabular-nums}
          .notifications-details .notification-event-groups{display:grid;gap:10px;margin-top:12px;min-width:0}
          .notifications-details .notify-event-group{display:grid;gap:0;min-width:0;margin:0;padding:6px 0 0;border:0;border-top:1px solid var(--ol-border,#2b4053)}
          .notifications-details .notify-event-group legend{padding:0 8px 0 0;font-size:12px;font-weight:600;color:var(--ol-muted,#a2b5c6)}
          .notifications-details .notify-event-group label{align-items:center;min-height:32px;padding:5px 0;font-size:12px;line-height:1.4}
          .notifications-details .notification-connection-details{min-width:0;margin:0;padding-top:8px;border-top:1px solid var(--ol-border,#2b4053)}
          .notifications-details .notification-connection-details>summary{font-size:12px;color:var(--ol-muted,#a2b5c6)}
          .notifications-details .notify-connection-body{display:grid;gap:10px;padding-top:10px}
          .notifications-details .notification-clear{background:transparent;color:var(--ol-muted,#a2b5c6);border-color:var(--ol-border,#2b4053);font-size:12px}
          .notifications-details .notification-clear:hover:not(:disabled){border-color:var(--ol-danger,#f4a8a8);color:var(--ol-danger,#f4a8a8)}
          .notifications-details .notify-note{margin:0;font-size:11.5px;line-height:1.5;color:var(--ol-muted,#a2b5c6)}
          .notifications-details .notification-events-details>p{margin-top:8px}
          .notifications-details .notify-status,.notifications-details .notification-connection-status{margin:0;white-space:pre-line;font-size:11.5px;line-height:1.5;color:var(--ol-muted,#a2b5c6)}
          .notifications-details [data-notification-diagnostics]{display:grid;gap:8px;margin-top:10px}
          .notifications-details .notify-alert{margin:0;padding:10px 12px;white-space:pre-line;font-size:12px;line-height:1.5;border:1px solid var(--ol-warning,#f3cb80);border-radius:var(--ol-radius,10px);color:var(--ol-warning,#f3cb80);background:var(--ol-surface,#131f2b)}
          .notifications-details :focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:3px}
        </style>
        <summary>Notificaciones</summary>
        <div class="notify-body">
          <div class="notify-pause-controls">
            <button type="button" data-notification-pause="all">Pausar todos los avisos</button>
            <span class="notify-pause-state"></span>
            <p class="notify-note">La automatización continúa. Los avisos detectados durante la pausa se descartan.</p>
          </div>
          <p class="notify-alert" role="status" aria-live="polite" aria-atomic="true" hidden></p>
          <div class="notify-channel">
            <div class="notify-channel-row">
              <div class="notify-channel-info">
                <label><input class="notification-browser-toggle" type="checkbox"> Navegador</label>
                <span class="notify-channel-state" data-notification-channel-state="browser"></span>
              </div>
              <button type="button" data-notification-pause="browser">Pausar</button>
            </div>
            <button class="notification-permission" type="button">Permitir avisos del navegador</button>
          </div>
          <div class="notify-channel">
            <div class="notify-channel-row">
              <div class="notify-channel-info">
                <label><input class="notification-telegram-toggle" type="checkbox"> Telegram</label>
                <span class="notify-channel-state" data-notification-channel-state="telegram"></span>
              </div>
              <button type="button" data-notification-pause="telegram">Pausar</button>
            </div>
            <details class="notification-connection-details" data-ui-section="telegramConnection">
              <summary><span class="notification-connection-label">Configurar Telegram</span></summary>
              <div class="notify-connection-body">
                <label class="notify-field">Token del bot<input class="notification-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="221"></label>
                <label class="notify-field">Chat ID<input class="notification-chat-id" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="65"></label>
                <p class="notify-note">Se guardan al escribir. Deja un campo vacío para conservar su valor guardado.</p>
                <button class="notification-test" type="button">Enviar prueba a Telegram</button>
                <p class="notification-connection-status" role="status" aria-live="polite" hidden></p>
                <button class="notification-clear" type="button">Borrar credenciales de Telegram</button>
              </div>
            </details>
          </div>
          <details class="notification-events-details">
            <summary><span class="notify-summary-content"><span>Tipos de notificación</span><span class="notification-events-count"></span></span></summary>
            <p class="notify-note">Los mismos filtros para ambos canales.</p>
            <div class="notify-actions"><button class="notification-events-all" type="button">Todos</button><button class="notification-events-none" type="button">Ninguno</button></div>
            <div class="notification-event-groups">${EVENT_GROUPS.map((group) =>
              `<fieldset class="notify-event-group"><legend>${group.label}</legend>${group.entries.map(([type, label]) =>
                `<label><input class="notification-event-toggle" type="checkbox" data-notification-event="${type}"> ${label}</label>`
              ).join('')}</fieldset>`
            ).join('')}</div>
          </details>
          <details class="notification-diagnostics-details" data-ui-section="notificationDiagnostics">
            <summary>Estado y diagnóstico</summary>
            <div data-notification-diagnostics><p class="notify-status" role="status" aria-live="polite" aria-atomic="true"></p></div>
          </details>
        </div>`;
      const query = (selector) => root.querySelector(selector);
      mounted = {
        root, browser: query('.notification-browser-toggle'), telegram: query('.notification-telegram-toggle'),
        permit: query('.notification-permission'), token: query('.notification-token'),
        chat: query('.notification-chat-id'), test: query('.notification-test'), status: query('.notify-status'),
        eventInputs: new Map(EVENT_TYPES.map((type) => [type, query(`[data-notification-event="${type}"]`)])),
        eventCount: query('.notification-events-count'), eventsAll: query('.notification-events-all'),
        eventsNone: query('.notification-events-none'), eventsDetails: query('.notification-events-details'),
        editing: new Set(), editorDirty: false,
        pauseButtons: new Map(['all', 'browser', 'telegram'].map(target => [target, query(`[data-notification-pause="${target}"]`)])),
        channelStates: new Map(['browser', 'telegram'].map(channel => [channel, query(`[data-notification-channel-state="${channel}"]`)])),
        pauseState: query('.notify-pause-state'), alert: query('.notify-alert'),
        connectionDetails: query('.notification-connection-details'), connectionLabel: query('.notification-connection-label'),
        connectionStatus: query('.notification-connection-status'),
      };
      const ui = mounted;
      ui.connectionDetails.open = !configured() || credentialDraftState().pending;
      for (const [target, button] of ui.pauseButtons) {
        button.addEventListener('click', () => {
          if (!refreshConfig()) return;
          setPaused(target, !(target === 'all' ? config.paused : config[target + 'Paused']));
        });
      }
      ui.eventsDetails.addEventListener('toggle', () => {
        const open = ui.eventsDetails.open;
        if (open === config.eventsExpanded) return;
        if (!refreshConfig()) return;
        writeConfig({ ...config, eventsExpanded: open });
      });
  
      for (const field of [ui.token, ui.chat]) {
        field.addEventListener('focus', () => ui.editing.add(field));
        field.addEventListener('input', () => { saveEditorDraft(); });
        field.addEventListener('change', () => { flushEditorDraft(false); });
        field.addEventListener('blur', (event) => {
          ui.editing.delete(field);
          // Moving to the other credential field should not empty the editor.
          const leavingEditor = event.relatedTarget !== ui.token && event.relatedTarget !== ui.chat;
          flushEditorDraft(leavingEditor);
        });
      }
      for (const [type, input] of ui.eventInputs) {
        input.addEventListener('change', () => {
          const enabled = input.checked;
          if (!refreshConfig()) return;
          writeConfig({ ...config, events: { ...config.events, [type]: enabled } });
        });
      }
      function setAllEvents(enabled) {
        if (!refreshConfig()) return;
        writeConfig({ ...config, events: Object.fromEntries(EVENT_TYPES.map((type) => [type, enabled])) });
      }
      ui.eventsAll.addEventListener('click', () => setAllEvents(true));
      ui.eventsNone.addEventListener('click', () => setAllEvents(false));
      ui.telegram.addEventListener('change', () => {
        const desired = ui.telegram.checked;
        if (!refreshConfig()) return;
        if (writeConfig({ ...config, telegramEnabled: desired })) {
          telegramStatus = desired ? configured() ? 'Activado.' : 'Activado; completa las credenciales para recibir avisos.' : 'Desactivado.';
          if (desired) armTelegram();
          updateUI();
        }
      });
      ui.browser.addEventListener('change', () => {
        const desired = ui.browser.checked && permission() === 'granted';
        if (!refreshConfig()) return;
        if (writeConfig({ ...config, browserEnabled: desired })) browserStatus = desired ? 'Activado.' : 'Desactivado.';
        updateUI();
      });
      ui.permit.addEventListener('click', async () => {
        if (destroyed || permissionBusy || permission() === 'denied' || !NativeNotification) return;
        permissionBusy = true;
        updateUI();
        try {
          // The only requestPermission call is inside this explicit button's click handler.
          const result = permission() === 'granted' ? 'granted' : await NativeNotification.requestPermission();
          if (destroyed) return;
          if (!refreshConfig()) return;
          if (result === 'granted') {
            writeConfig({ ...config, browserEnabled: true });
            browserStatus = 'Permiso concedido; avisos activados.';
          } else {
            writeConfig({ ...config, browserEnabled: false });
            browserStatus = result === 'denied' ? 'Permiso denegado.' : 'No se concedió permiso.';
          }
        } catch { browserStatus = 'No se pudo solicitar permiso en este navegador.'; }
        finally { permissionBusy = false; updateUI(); }
      });
      ui.test.addEventListener('click', () => {
        if (!refreshConfig()) return;
        if (destroyed || config.paused || config.telegramPaused || !configured()
            || activeRequest || telegramQueue.some((item) => item.test)) return;
        if (now() - lastTestAt < 10000) {
          telegramStatus = 'Espera unos segundos antes de volver a enviar una prueba.';
          updateUI();
          return;
        }
        if (credentialDraftState().pending
            || (ui.token.value.trim() && ui.token.value.trim() !== config.botToken)
            || (ui.chat.value.trim() && ui.chat.value.trim() !== config.chatId)) {
          telegramStatus = 'Completa el borrador y espera a que se guarde automáticamente antes de enviar la prueba.';
          updateUI();
          return;
        }
        if (telegramQueue.length >= MAX_QUEUE) {
          telegramStatus = 'La cola está llena. Espera antes de enviar una prueba.';
          updateUI();
          return;
        }
        lastTestAt = now();
        telegramBlocked = false;
        consecutiveFailures = 0;
        telegramQueue.push({
          key: 'test-' + (++testSequence), test: true, retries: 0,
          text: '🧪 Old Light · Prueba de notificaciones\n\nTelegram está configurado para recibir tus avisos.',
        });
        telegramStatus = 'Prueba solicitada en cola.';
        updateUI();
        armTelegram();
      });
      query('.notification-clear').addEventListener('click', () => {
        if (!refreshConfig()) return;
        cancelDraftTimer();
        if (writeConfig({ ...config, botToken: '', chatId: '', drafts: EMPTY_DRAFTS, telegramEnabled: false })) {
          ui.token.value = '';
          ui.chat.value = '';
          ui.editorDirty = false;
          telegramBlocked = false;
          consecutiveFailures = 0;
          telegramStatus = 'Credenciales borradas; Telegram desactivado.';
          updateUI();
        }
      });
      container.appendChild(root);
      restoreDraftFields(true);
      if (credentialDraftState().pending) scheduleCredentialCommit();
      updateUI();
      return root;
    }
  
    function isEventEnabled(type) {
      refreshConfig();
      return !destroyed && eventAllowed(type)
        && ((config.browserEnabled && permission() === 'granted') || (config.telegramEnabled && configured()));
    }
  
    function exportConfig() {
      refreshConfig();
      return { ...config, events: { ...config.events }, drafts: { ...config.drafts } };
    }
  
    function validateConfig(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || typeof value.browserEnabled !== 'boolean' || typeof value.telegramEnabled !== 'boolean'
          || ['paused', 'browserPaused', 'telegramPaused'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')
          || ['browserPauseEpoch', 'telegramPauseEpoch'].some(key => value[key] !== undefined &&
            (!Number.isSafeInteger(value[key]) || value[key] < 0))
          || typeof value.botToken !== 'string' || typeof value.chatId !== 'string'
          || (value.botToken && !validToken(value.botToken)) || (value.chatId && !validChat(value.chatId))
          || (value.drafts !== undefined && !validDrafts(value.drafts))
          || (value.events !== undefined && (!value.events || typeof value.events !== 'object' || Array.isArray(value.events)))
          || EVENT_TYPES.some(type => value.events?.[type] !== undefined && typeof value.events[type] !== 'boolean')
          || (value.eventsExpanded !== undefined && typeof value.eventsExpanded !== 'boolean')) {
        throw new Error('La configuración de avisos de la copia no es válida.');
      }
      return normalizeConfig(value);
    }
  
    function importConfig(value) {
      const next = validateConfig(value);
      // A restore can introduce a new pause. Use the latest invalidations
      // when available; explicit imports can still repair unreadable storage.
      refreshConfig();
      if (!writeConfig(next)) throw new Error('No se pudo guardar la configuración de avisos.');
      cancelDraftTimer();
      restoreDraftFields(true);
      if (mounted && credentialDraftState().pending) scheduleCredentialCommit();
      return true;
    }
  
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelDraftTimer();
      clearBrowserQueue();
      clearTelegramQueue();
      mounted?.root.remove();
      mounted = null;
    }
  
    return Object.freeze({ emit, isEnabled, isEventEnabled, setPaused, mount, getDiagnostics, exportConfig, validateConfig, importConfig,
      destroy, get status() { return getDiagnostics(); } });
  }
  // END NOTIFIER

  // BEGIN REPORTS
  /* Paste this factory inside the userscript IIFE. It only reads the native API:
   * GET https://api.oldlight.io/api/galaxy/{slug}/reports?limit=20[&before=cursor]
   * GET https://api.oldlight.io/api/galaxy/{slug}/reports/{UUID}
   * Verified in galaxy-CRpoK2yj.js and base-DKX6or_P.js supplied with this task.
   * No UI clicks, POST /read, action tokens, or mutation endpoints are used.
   *
   * createReportsWatcher({ send, onReport?, onRecoverReports?, fetch?, gmGetValue?, gmSetValue?, now?,
   *   getPathname?, getHidden?, getAccount?, getBaselineSince?, AbortController?, setTimeout?, clearTimeout? })
   * .tick({ active, enabled = true, unread }) is synchronous and never awaits I/O.
   * active must mean: this tab holds the root Web Lock, visible HUD, visible tab.
   * enabled must reflect report notifications or an enabled automation consumer,
   * even while inactive. Explicitly disabling it starts a new silent baseline.
   * Recovery reads at most 20 recent combat details across five native pages,
   * without notifying them again. Its callback must persist its decision synchronously.
   * .getDiagnostics() exposes status only; .destroy() cancels timers and GETs.
   * The old unread-count notification should be used only as an API fallback.
   * Runtime checkpoints are not settings and should not be imported/exported.
   */
  function createReportsWatcher(deps = {}) {
    const own = (key) => Object.prototype.hasOwnProperty.call(deps, key);
    const fetchRead = own('fetch') ? deps.fetch
      : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const gmGet = own('gmGetValue') ? deps.gmGetValue
      : (typeof GM_getValue === 'function' ? GM_getValue : null);
    const gmSet = own('gmSetValue') ? deps.gmSetValue
      : (typeof GM_setValue === 'function' ? GM_setValue : null);
    const Controller = own('AbortController') ? deps.AbortController
      : (typeof AbortController === 'function' ? AbortController : null);
    const send = typeof deps.send === 'function' ? deps.send : null;
    const onReport = typeof deps.onReport === 'function' ? deps.onReport : null;
    const onRecoverReports = typeof deps.onRecoverReports === 'function' ? deps.onRecoverReports : null;
    const now = deps.now || (() => Date.now());
    const later = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancelTimer = deps.clearTimeout || ((id) => clearTimeout(id));
    const getPathname = deps.getPathname || (() => globalThis.location?.pathname || '');
    const getHidden = deps.getHidden || (() => typeof document !== 'undefined' && document.hidden);
    const getAccount = deps.getAccount || (() => '');
    const getBaselineSince = deps.getBaselineSince || (() => null);
    const PREFIX = 'old-light-reports:runtime:v1:';
    const API = 'https://api.oldlight.io/api/galaxy/';
    const POLL_MS = 25000;
    const WAKE_GAP_MS = 3000;
    const TIMEOUT_MS = 10000;
    const PAGE_SIZE = 20;
    const PAGES_PER_CYCLE = 5;
    const DETAILS_PER_CYCLE = 20;
    const MAX_PENDING = 100;
    const MAX_SEEN = 512;
    const RECOVERY_VERSION = 1;
    const RECOVERY_VERDICTS = new Set(['defeat', 'victory', 'draw', 'captured']);
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const shipNames = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };
    const buildingNames = {
      command_center: 'Command Center', reactor: 'Reactor',
      palladium_extractor: 'Palladium Extractor', iridium_extractor: 'Iridium Extractor',
      warehouse: 'Resource Depot', shipyard: 'Shipyard', trade_hub: 'Trade Hub',
    };
    let active = false;
    let enabled = true;
    let destroyed = false;
    let slug = '';
    let account = '';
    let epoch = 0;
    let checkpoint = blankCheckpoint();
    let pollTimer = null;
    let request = null;
    let running = null;
    let lastUnread = null;
    let lastCycleAt = -Infinity;
    let nextPollAt = 0;
    let retryAt = 0;
    let wakeRequested = false;
    let failures = 0;
    let lastError = '';
    let storageError = false;
    let lastListAt = null;
    let phase = 'idle';
    let recoveringSince = null;
    const counters = { polls: 0, pages: 0, details: 0, recovered: 0, emitted: 0, fallbacks: 0, invalidItems: 0, errors: 0 };

    function blankCheckpoint() {
      return { version: 1, initialized: false, suspended: false, watermark: null,
        seen: [], pending: [], scan: null, recovery: null };
    }

    function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
    function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
    function stamp(value) {
      if (finite(value)) return value >= 0 && value <= 8640000000000000 ? value : null;
      if (typeof value !== 'string' || value.length > 80 || !value.trim()) return null;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    function maxStamp(a, b) { return b === null ? a : a === null ? b : Math.max(a, b); }
    function clean(value, limit = 240) {
      if (typeof value !== 'string') return '';
      const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
      return Array.from(text).slice(0, limit).join('');
    }
    function cursor(value) {
      return typeof value === 'string' && value.length > 0 && value.length <= 2048
        && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
    }
    function pathSlug() {
      try {
        const match = String(getPathname()).match(/^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/);
        return match ? match[1] : '';
      } catch { return ''; }
    }
    function canRead() {
      return !!slug && typeof fetchRead === 'function' && typeof Controller === 'function'
        && !!(send || onReport || onRecoverReports);
    }
    function accountId() {
      try { const value = getAccount(); return typeof value === 'string' && UUID.test(value) ? value : ''; }
      catch { return ''; }
    }
    function checkpointKey() {
      return PREFIX + slug + (account ? `:${account}` : '');
    }
    function recoveryBaseline() {
      try {
        const value = getBaselineSince();
        return finite(value) && value > 0 && stamp(value) === value ? value : null;
      } catch { return null; }
    }
    function recoveryPending() {
      const since = recoveryBaseline();
      return !!onRecoverReports && since !== null
        && !(checkpoint.recovery?.version === RECOVERY_VERSION && checkpoint.recovery.since === since);
    }
    function isRecovering() {
      // Keep the gate through the entire live batch too. A defeat callback may
      // precede a newer victory in pending, or on the next backlog page.
      return !destroyed && enabled && active && canRead() && recoveryBaseline() !== null
        && !!(recoveryPending() || request || running || checkpoint.pending.length || checkpoint.scan);
    }
    function current(token) {
      try { return !destroyed && active && enabled && token === epoch && pathSlug() === slug
        && accountId() === account && !getHidden()
        && (recoveringSince === null || recoveryBaseline() === recoveringSince); }
      catch { return false; }
    }
    function fault(kind, status = 0, waitMs = 0) {
      const result = new Error(kind);
      result.kind = kind; result.status = status; result.waitMs = waitMs;
      return result;
    }
    function assertCurrent(token) { if (!current(token)) throw fault('interrupted'); }

    function summary(value) {
      if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id)) return null;
      return { id: value.id.toLowerCase(), takenAt: stamp(value.takenAt),
        title: clean(value.title), verdict: clean(value.verdict, 80),
        attempts: Number.isInteger(value.attempts) ? Math.min(3, Math.max(0, value.attempts)) : 0 };
    }

    function normalize(saved) {
      const out = blankCheckpoint();
      if (!object(saved) || saved.version !== 1) return out;
      out.initialized = saved.initialized === true;
      out.suspended = saved.suspended === true;
      out.watermark = stamp(saved.watermark);
      if (object(saved.recovery) && saved.recovery.version === RECOVERY_VERSION
          && finite(saved.recovery.since) && saved.recovery.since > 0
          && stamp(saved.recovery.since) === saved.recovery.since) {
        const floor = saved.recovery.floor === undefined ? saved.recovery.since : saved.recovery.floor;
        if (finite(floor) && floor >= saved.recovery.since && stamp(floor) === floor) {
          out.recovery = { version: RECOVERY_VERSION, since: saved.recovery.since, floor };
        }
      }
      if (Array.isArray(saved.seen)) {
        const unique = new Map();
        for (const pair of saved.seen.slice(-MAX_SEEN)) {
          if (Array.isArray(pair) && typeof pair[0] === 'string' && UUID.test(pair[0])) {
            unique.set(pair[0].toLowerCase(), stamp(pair[1]));
          }
        }
        out.seen = Array.from(unique);
      }
      if (Array.isArray(saved.pending)) {
        const unique = new Map();
        for (const value of saved.pending.slice(0, MAX_PENDING)) {
          const item = summary(value);
          if (item) unique.set(item.id, item);
        }
        out.pending = Array.from(unique.values());
      }
      if (object(saved.scan) && (saved.scan.before === null || cursor(saved.scan.before))) {
        const anchors = Array.isArray(saved.scan.anchors) ? saved.scan.anchors : [];
        out.scan = { before: cursor(saved.scan.before), floor: stamp(saved.scan.floor),
          high: stamp(saved.scan.high), anchors: anchors.filter((id) => typeof id === 'string' && UUID.test(id))
            .slice(0, MAX_SEEN + MAX_PENDING).map((id) => id.toLowerCase()) };
        if (saved.scan.baseline === true && out.scan.floor !== null) out.scan.baseline = true;
      }
      if (!out.initialized || out.suspended) { out.pending = []; out.scan = null; }
      return out;
    }

    function loadCheckpoint() {
      if (!slug) { checkpoint = blankCheckpoint(); return; }
      if (typeof gmGet !== 'function') return;
      try { checkpoint = normalize(gmGet(checkpointKey(), null)); storageError = false; }
      catch { storageError = true; }
    }

    function saveCheckpoint() {
      if (!slug || typeof gmSet !== 'function') return false;
      try {
        gmSet(checkpointKey(), { ...checkpoint,
          seen: checkpoint.seen.map((pair) => [...pair]),
          pending: checkpoint.pending.map((item) => ({ ...item })),
          scan: checkpoint.scan ? { ...checkpoint.scan, anchors: [...checkpoint.scan.anchors] } : null,
          recovery: checkpoint.recovery ? { ...checkpoint.recovery } : null });
        storageError = false;
        return true;
      } catch { storageError = true; return false; }
    }

    function remember(item) {
      checkpoint.seen = checkpoint.seen.filter(([id]) => id !== item.id);
      checkpoint.seen.push([item.id, item.takenAt]);
      if (checkpoint.seen.length > MAX_SEEN) checkpoint.seen.splice(0, checkpoint.seen.length - MAX_SEEN);
    }

    function stop() {
      epoch++;
      if (pollTimer !== null) { cancelTimer(pollTimer); pollTimer = null; }
      if (request) request.cancel();
    }

    function retryDelay(response) {
      let value = '';
      try { value = response.headers?.get('Retry-After') || ''; } catch { /* Optional HTTP header. */ }
      const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
      // Respect the server's delay; use the browser's maximum safe timer range.
      return Number.isFinite(delay) ? Math.min(2147483647, Math.max(0, delay)) : 0;
    }

    async function readJSON(url, token) {
      assertCurrent(token);
      const controller = new Controller();
      let timer = null;
      let settled = false;
      let activeRead;
      try {
        return await new Promise((resolve, reject) => {
          const finish = (error, value) => {
            if (settled) return;
            settled = true;
            if (timer !== null) cancelTimer(timer);
            error ? reject(error) : resolve(value);
          };
          activeRead = { cancel() {
            finish(fault('interrupted'));
            try { controller.abort(); } catch { /* The generation guard also ignores late responses. */ }
          } };
          request = activeRead;
          timer = later(() => {
            finish(fault('timeout'));
            try { controller.abort(); } catch { /* Do not hold the watcher on a broken transport. */ }
          }, TIMEOUT_MS);
          Promise.resolve().then(() => {
            assertCurrent(token);
            return fetchRead(url, { method: 'GET', credentials: 'include', cache: 'no-store',
              redirect: 'error', signal: controller.signal });
          }).then(async (response) => {
            assertCurrent(token);
            if (!response || typeof response.json !== 'function') throw fault('schema');
            if (!response.ok) throw fault('http', Number(response.status) || 0, retryDelay(response));
            let data;
            try { data = await response.json(); }
            catch { throw fault('schema'); }
            assertCurrent(token);
            finish(null, data);
          }).catch((error) => finish(error?.kind ? error : fault('network')));
        });
      } finally {
        if (timer !== null) cancelTimer(timer);
        if (request === activeRead) request = null;
      }
    }

    async function readPage(before, token) {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before !== null) params.set('before', before);
      const payload = await readJSON(`${API}${slug}/reports?${params}`, token);
      assertCurrent(token);
      if (!object(payload) || !Array.isArray(payload.items)
        || !(payload.nextCursor === null || cursor(payload.nextCursor))) throw fault('schema');
      // A native page has at most 20 rows. A larger, changed schema is not silently truncated.
      if (payload.items.length > PAGE_SIZE) throw fault('schema');
      const items = payload.items.map(summary).filter(Boolean);
      counters.invalidItems += payload.items.length - items.length;
      if (payload.items.length && !items.length) throw fault('schema');
      counters.pages++;
      lastListAt = now();
      return { items, nextCursor: cursor(payload.nextCursor) };
    }

    async function scanList(token) {
      phase = 'list';
      if (!checkpoint.initialized || checkpoint.suspended) {
        const page = await readPage(null, token);
        assertCurrent(token);
        const recovery = checkpoint.recovery;
        checkpoint = blankCheckpoint();
        checkpoint.recovery = recovery;
        checkpoint.initialized = true;
        let since = null;
        try { since = stamp(getBaselineSince()); } catch { /* The normal silent baseline still applies. */ }
        let boundary = false;
        for (const item of page.items) {
          // A just-enabled retry rule must see reports that arrived after it was
          // enabled, even if this is the first page ever read in this account.
          if (onReport && since !== null && item.takenAt !== null && item.takenAt > since) checkpoint.pending.push(item);
          else remember(item);
          if (since !== null && item.takenAt !== null && item.takenAt <= since) boundary = true;
          checkpoint.watermark = maxStamp(checkpoint.watermark, item.takenAt);
        }
        // A first-page watermark alone would permanently hide fresh reports on
        // later pages. Continue the bounded scan from its cursor, preserving the
        // strict enable-time boundary across reloads until it reaches history.
        if (onReport && since !== null && !boundary && page.nextCursor !== null) {
          checkpoint.scan = { before: page.nextCursor, floor: since, high: checkpoint.watermark,
            anchors: [...checkpoint.seen.map(([id]) => id), ...checkpoint.pending.map(item => item.id)],
            baseline: true };
        }
        saveCheckpoint();
        return;
      }
      if (!checkpoint.scan) {
        checkpoint.scan = { before: null, floor: checkpoint.watermark, high: checkpoint.watermark,
          anchors: [...checkpoint.seen.map(([id]) => id), ...checkpoint.pending.map((item) => item.id)] };
      }
      const scan = checkpoint.scan;
      const anchors = new Set(scan.anchors);
      const visited = new Set();
      for (let pageNumber = 0; pageNumber < PAGES_PER_CYCLE; pageNumber++) {
        if (checkpoint.pending.length >= MAX_PENDING) break;
        const before = scan.before;
        if (visited.has(before)) throw fault('schema');
        visited.add(before);
        const page = await readPage(before, token);
        assertCurrent(token);
        let boundary = false;
        let full = false;
        const known = new Set([...checkpoint.seen.map(([id]) => id), ...checkpoint.pending.map((item) => item.id)]);
        for (const item of page.items) {
          // Native pagination is newest first. Existing IDs or an older timestamp
          // delimit the preceding scan, regardless of changing read/unread flags.
          if (anchors.has(item.id) || (scan.floor !== null && item.takenAt !== null
              && (scan.baseline ? item.takenAt <= scan.floor : item.takenAt < scan.floor))) {
            boundary = true; break;
          }
          scan.high = maxStamp(scan.high, item.takenAt);
          if (known.has(item.id)) continue;
          if (scan.baseline && item.takenAt === null) { remember(item); known.add(item.id); continue; }
          if (checkpoint.pending.length >= MAX_PENDING) { full = true; break; }
          checkpoint.pending.push(item);
          known.add(item.id);
        }
        if (full) { saveCheckpoint(); break; } // Re-read this page after draining the bounded queue.
        if (boundary || page.nextCursor === null) {
          checkpoint.watermark = maxStamp(checkpoint.watermark, scan.high);
          checkpoint.scan = null;
          saveCheckpoint();
          break;
        }
        if (page.nextCursor === before || visited.has(page.nextCursor)) throw fault('schema');
        scan.before = page.nextCursor;
        saveCheckpoint();
      }
    }

    async function recoverReports(token) {
      if (!recoveryPending()) return;
      const since = recoveryBaseline();
      if (since === null) return;
      recoveringSince = since;
      try {
        assertCurrent(token);
        phase = 'recovery-list';
        const selected = new Map();
        const visited = new Set();
        let before = null;
        let truncated = false;
        let newestRead = null;
        for (let pageNumber = 0; pageNumber < PAGES_PER_CYCLE; pageNumber++) {
          if (visited.has(before)) throw fault('schema');
          visited.add(before);
          const invalidBefore = counters.invalidItems;
          const page = await readPage(before, token);
          assertCurrent(token);
          // A skipped malformed row could be a newer victory for a route. Do
          // not reconstruct an attack from an incomplete recovery timeline.
          if (counters.invalidItems !== invalidBefore) throw fault('schema');
          for (const item of page.items) newestRead = maxStamp(newestRead, item.takenAt);
          let boundary = false;
          for (const [index, item] of page.items.entries()) {
            if (item.takenAt !== null && item.takenAt <= since) { boundary = true; break; }
            if (!RECOVERY_VERDICTS.has(item.verdict.toLowerCase())) continue;
            if (item.takenAt === null) throw fault('schema');
            const duplicate = selected.get(item.id);
            if (duplicate) {
              if (duplicate.takenAt !== item.takenAt || duplicate.verdict !== item.verdict) throw fault('schema');
              continue;
            }
            selected.set(item.id, item);
            if (selected.size >= DETAILS_PER_CYCLE) {
              truncated = index < page.items.length - 1 || page.nextCursor !== null;
              break;
            }
          }
          if (boundary || selected.size >= DETAILS_PER_CYCLE || page.nextCursor === null) break;
          if (page.nextCursor === before || visited.has(page.nextCursor)) throw fault('schema');
          if (pageNumber === PAGES_PER_CYCLE - 1) { truncated = true; break; }
          before = page.nextCursor;
        }
        // Reports outside this bounded recovery window can still be pending
        // from an earlier scan. Persist a floor so their normal notifications
        // cannot later activate an older defeat without its newer outcome.
        if (truncated && !selected.size && newestRead === null) throw fault('schema');
        const floor = truncated ? Math.max(since, selected.size
          ? Math.min(...Array.from(selected.values(), item => item.takenAt)) : newestRead) : since;
        const reports = [];
        phase = 'recovery-detail';
        for (const item of selected.values()) {
          const detail = await readJSON(`${API}${slug}/reports/${item.id}`, token);
          assertCurrent(token);
          if (!object(detail) || typeof detail.id !== 'string' || detail.id.toLowerCase() !== item.id
              || !(object(detail.sections) || object(detail.route) || object(detail.variant))) throw fault('schema');
          counters.details++;
          reports.push({ item: { ...item }, detail });
        }
        assertCurrent(token);
        try {
          const accepted = onRecoverReports({ scope: `${slug}/${account}`, reports });
          if (accepted && typeof accepted.then === 'function') {
            accepted.catch?.(() => {});
            throw new Error('La recuperación debe guardarse antes de continuar.');
          }
        } catch { throw fault('recovery-callback'); }
        assertCurrent(token);
        const previous = checkpoint.recovery;
        checkpoint.recovery = { version: RECOVERY_VERSION, since, floor };
        if (!saveCheckpoint()) {
          checkpoint.recovery = previous;
          throw fault('recovery-storage');
        }
        counters.recovered += reports.length;
      } finally {
        recoveringSince = null;
      }
    }

    function number(value, round = false) {
      if (!finite(value)) return '';
      // Group four-digit values too; es-ES otherwise starts grouping at 10 000.
      return (round ? Math.round(value) : value).toLocaleString('en-US', { maximumFractionDigits: 2 })
        .replace(/[.,]/g, (separator) => separator === ',' ? '.' : ',');
    }
    function unknownCount(value) {
      return !object(value) || !finite(value.quantity)
        || (value.kind !== undefined && value.kind !== 'exact' && value.kind !== 'approximate');
    }
    function exactZero(value) {
      return object(value) && !unknownCount(value) && value.quantity === 0
        && value.kind !== 'approximate' && value.approximate !== true;
    }
    function emptyFleet(values) {
      return Array.isArray(values) && values.every(exactZero);
    }
    function fleet(values) {
      if (!Array.isArray(values)) return '';
      if (!values.length) return 'ninguna';
      const entries = values.slice(0, 16).filter(object);
      if (!entries.length) return 'sin datos';
      const visible = entries.filter((entry) => !exactZero(entry));
      if (!visible.length) return 'ninguna';
      const known = visible.filter((entry) => !unknownCount(entry));
      const unknown = visible.filter(unknownCount);
      const names = [...new Set(unknown.map((entry) => Object.hasOwn(shipNames, entry.type)
        ? shipNames[entry.type] : clean(entry.type, 40) || 'tipo desconocido'))];
      if (!known.length && Object.keys(shipNames).every((type) => unknown.some((entry) => entry.type === type))
          && unknown.every((entry) => Object.hasOwn(shipNames, entry.type))) return 'desconocida';
      const parts = known.map((entry) => {
        const name = Object.hasOwn(shipNames, entry.type) ? shipNames[entry.type] : clean(entry.type, 40) || 'Tipo desconocido';
        const approximate = entry.kind === 'approximate' || entry.approximate === true;
        return `${approximate ? '~' : ''}${number(entry.quantity)} ${name}`;
      });
      if (names.length) parts.push(`sin datos: ${names.join(', ')}`);
      return parts.join(' · ');
    }
    function resources(value, fields, omitZero = false) {
      if (!object(value)) return '';
      return fields.filter(([key]) => finite(value[key]) && (!omitZero || value[key] !== 0))
        .map(([key, label]) => `${label} ${number(value[key], true)}`).join(' · ');
    }
    function locationText(value, includeOwner = true) {
      if (!object(value)) return '';
      const name = clean(value.name, 150);
      const coordinates = finite(value.q) && finite(value.r) ? `(${value.q}, ${value.r})` : '';
      const owner = includeOwner ? clean(value.ownerName, 100) : '';
      return [name || (coordinates ? '' : 'Desconocido'), coordinates, owner ? `Propietario: ${owner}` : '']
        .filter(Boolean).join(' · ');
    }
    function knownLocation(value) {
      return object(value) && (Boolean(clean(value.name, 150)) || (finite(value.q) && finite(value.r)));
    }
    function dateText(item, detail) {
      const time = item.takenAt ?? stamp(detail?.createdAt);
      if (time === null) return '';
      const date = new Date(time);
      const pad = (value) => String(value).padStart(2, '0');
      // Date's offset is evaluated at the report time, including daylight saving.
      const offset = -date.getTimezoneOffset();
      const absolute = Math.abs(offset);
      const zone = offset === 0 ? 'UTC' : `UTC${offset > 0 ? '+' : '-'}${Math.floor(absolute / 60)}${absolute % 60 ? `:${pad(absolute % 60)}` : ''}`;
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)} · ${pad(date.getHours())}:${pad(date.getMinutes())} ${zone}`;
    }
    function reportKind(item, sections, variant) {
      if (object(sections.probe) || item.verdict === 'Probed') {
        if (object(sections.incoming)) return 'probe_incoming';
        return sections.probe?.tier === 0 ? 'probe_failed' : 'probe';
      }
      const variants = {
        capture_success: 'capture_success', capture_loss: 'capture_loss',
        colonise_success: 'colonisation', colonise_abort: 'colonisation_failed',
        hostility_damage: 'hostility', dormant_salvage: 'salvage',
        shipment_delivered: variant.shipmentRole === 'recipient' ? 'shipment_received' : 'shipment_delivered',
        territory_raid: 'territory_raid',
      };
      if (Object.hasOwn(variants, variant.kind)) return variants[variant.kind];
      if (variant.kind) return 'report'; // Preserve the native title for a new, unknown variant.
      if (object(sections.battle)) return object(sections.incoming) || sections.battle.targetOwnerKind === 'owned' ? 'defense' : 'battle';
      return 'report';
    }

    function reportEvent(item, detail = null, unavailable = '') {
      const route = object(detail?.route) ? detail.route : {};
      const sections = object(detail?.sections) ? detail.sections : {};
      const battle = object(sections.battle) ? sections.battle : null;
      const probe = object(sections.probe) ? sections.probe : null;
      const variant = object(detail?.variant) ? detail.variant : {};
      const kind = reportKind(item, sections, variant);
      const probing = ['probe', 'probe_failed', 'probe_incoming'].includes(kind);
      const lines = [];
      // Structured endpoints replace the English activity sentence when known.
      if (item.title && (kind === 'report' || !knownLocation(route.from) || !knownLocation(route.to))) lines.push(item.title);
      const to = locationText(route.to, false);
      const from = locationText(route.from, route.from?.ownerKind !== 'owned');
      if (to) lines.push(`📍 Destino: ${to}`);
      const owner = clean(route.to?.ownerName, 100);
      if (owner) lines.push(`Propietario: ${owner}`);
      if (from) lines.push(`Origen: ${from}`);
      const date = dateText(item, detail);
      if (date) lines.push(`🕒 ${date}`);
      const verdicts = { Victory: 'Victoria', Defeat: 'Derrota', Draw: 'Empate', Probed: 'Sondeo', Captured: 'Capturado' };
      if (item.verdict && !(probing && item.verdict === 'Probed')
          && !(['capture_success', 'capture_loss'].includes(kind) && item.verdict === 'Captured')) {
        lines.push(`Resultado: ${Object.hasOwn(verdicts, item.verdict) ? verdicts[item.verdict] : item.verdict}`);
      }
      if (battle) {
        const battleLines = [];
        for (const [field, label] of [
          ['attackerShips', probing && kind !== 'probe_incoming' ? 'Enviadas' : 'Flota atacante'],
          ['defenderShips', probing ? 'Defensa' : 'Flota defensora'],
        ]) {
          const text = fleet(battle[field]);
          if (text) battleLines.push(`${label}: ${text}`);
        }
        const noAttackerLosses = emptyFleet(battle.attackerLost);
        const noDefenderLosses = emptyFleet(battle.defenderLost);
        if (!probing && noAttackerLosses && noDefenderLosses) battleLines.push('Bajas: ninguna.');
        else {
          for (const [field, label] of [['attackerLost', 'Bajas atacantes'], ['defenderLost', 'Bajas defensoras']]) {
            if (probing && emptyFleet(battle[field])) continue;
            const text = fleet(battle[field]);
            if (text) battleLines.push(`${label}: ${text}`);
          }
        }
        const loot = resources(battle.plundered, [['pa', 'Palladium'], ['ir', 'Iridium'], ['credits', 'Créditos']], true);
        if (loot) battleLines.push(`Botín: ${loot}`);
        else if (!probing) {
          const knownLoot = resources(battle.plundered, [['pa', 'Palladium'], ['ir', 'Iridium'], ['credits', 'Créditos']]);
          if (knownLoot) battleLines.push(`Botín: ${knownLoot}`);
        }
        const loyalty = battle.loyaltyChange;
        if (object(loyalty)) {
          if (finite(loyalty.before) && finite(loyalty.after)) {
            battleLines.push(`Lealtad: ${number(loyalty.before)} → ${number(loyalty.after)}`);
          } else if (finite(loyalty.after)) battleLines.push(`Lealtad final: ${number(loyalty.after)}`);
          if (finite(loyalty.damageDealt) && loyalty.damageDealt !== 0) battleLines.push(`Daño a la lealtad: ${number(loyalty.damageDealt)}`);
          if (loyalty.captured === true) battleLines.push(battle.targetOwnerKind === 'owned' ? 'Sistema perdido.' : 'Sistema capturado.');
        }
        if (battle.combatDeficit === true) battleLines.push('Fuerza de combate reducida por déficit de créditos.');
        if (finite(battle.defenderSectorBonusPct) && battle.defenderSectorBonusPct > 0) {
          battleLines.push(`Bonificación del defensor: ${number(battle.defenderSectorBonusPct)}%.`);
        }
        if (battleLines.length) lines.push('', ...battleLines);
      }
      if (probe) {
        lines.push('');
        if (probe.tier === 0) lines.push('Todas las sondas perdidas. No se recuperó información.');
        else {
          lines.push(finite(probe.tier) ? `📊 Inteligencia · nivel ${number(probe.tier)}` : '📊 Inteligencia obtenida');
          const intel = resources(probe, [['palladium', 'Palladium'], ['iridium', 'Iridium']]);
          if (intel) lines.push(intel);
          if (Array.isArray(probe.buildings) && probe.buildings.length) {
            const buildings = probe.buildings.slice(0, 20).filter(object).map((entry) => {
              const name = Object.hasOwn(buildingNames, entry.type) ? buildingNames[entry.type] : clean(entry.type, 40) || 'Edificio desconocido';
              const level = finite(entry.level) ? `${entry.approximate === true ? '~' : ''}${number(entry.level)}` : 'desconocido';
              return `• ${name} ${level}`;
            });
            if (buildings.length) lines.push('', '🏗 Edificios (nivel)', ...buildings);
          }
          if (Array.isArray(probe.inTransit) && probe.inTransit.length && !emptyFleet(probe.inTransit)) lines.push(`En tránsito: ${fleet(probe.inTransit)}`);
          if (finite(probe.loyalty) && !battle?.loyaltyChange) lines.push(`Lealtad: ${number(probe.loyalty)}`);
        }
      }
      if (object(sections.incoming) && finite(sections.incoming.attackerIntelTier) && sections.incoming.attackerIntelTier > 0) {
        lines.push('', `Información obtenida por el atacante: nivel ${number(sections.incoming.attackerIntelTier)}.`);
      }
      const variantLines = [];
      if (variant.kind === 'capture_success' && battle?.loyaltyChange?.captured !== true) variantLines.push('Sistema capturado.');
      if (variant.kind === 'capture_loss') {
        if (battle?.loyaltyChange?.captured !== true) variantLines.push('Sistema perdido.');
        if (finite(variant.creditsLost)) variantLines.push(`Créditos perdidos: ${number(variant.creditsLost, true)}`);
      }
      if (finite(variant.creditsSeized)) variantLines.push(`Créditos capturados: ${number(variant.creditsSeized, true)}`);
      if (variant.kind === 'colonise_success') variantLines.push(`Colonización completada${clean(variant.targetLabel) ? `: ${clean(variant.targetLabel)}` : ''}.`);
      if (variant.kind === 'colonise_abort') {
        variantLines.push(variant.reason === 'spacing' ? 'Colonización abortada: el destino está demasiado cerca de un sistema existente.'
          : variant.reason === 'no_vanguard' ? 'La flota llegó a un sistema inactivo sin nada que combatir, reclamar o saquear. Regresa al origen.'
            : 'Colonización abortada.');
      }
      if (variant.kind === 'hostility_damage') {
        if (finite(variant.damageDealt)) variantLines.push(`Hostilidad reducida: ${number(variant.damageDealt)}`);
        if (finite(variant.hostilityRemaining)) variantLines.push(`Hostilidad restante: ${number(variant.hostilityRemaining)}`);
      }
      if (variant.kind === 'dormant_salvage') {
        const salvage = resources(variant, [['salvagePa', 'Palladium'], ['salvageIr', 'Iridium']]);
        if (salvage) variantLines.push(`Recuperado: ${salvage}`);
      }
      if (variant.kind === 'shipment_delivered') {
        const cargo = resources(variant, [['deliveredPa', 'Palladium'], ['deliveredIr', 'Iridium']]);
        if (cargo) variantLines.push(`${variant.shipmentRole === 'recipient' ? 'Cargamento recibido' : 'Cargamento entregado'}: ${cargo}`);
        if (variant.deliveredPa === 0 && variant.deliveredIr === 0) variantLines.push('No había espacio para el cargamento en el depósito de destino.');
      }
      if (variant.kind === 'territory_raid') {
        variantLines.push(`Incursión en tu territorio${clean(variant.raiderName) ? ` por ${clean(variant.raiderName)}` : ''}.`);
      }
      if (variantLines.length) lines.push('', ...variantLines);
      if (unavailable) lines.push('', `Detalle no disponible: ${unavailable}.`);
      if (!lines.some(Boolean)) lines.push('Se recibió un nuevo informe.');
      let message = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      // Leave room for the notifier heading and preserve complete Unicode points.
      if (message.length > 3600) {
        let clipped = message.slice(0, 3560);
        if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
        message = `${clipped}\n[Resumen recortado]`;
      }
      return { type: 'game.reports', id: `report:${item.id}`, title: 'Old Light',
        reportKind: kind, systemName: '', message };
    }

    function errorLabel(error) {
      if (error?.kind === 'http') return `HTTP ${error.status || 'desconocido'}`;
      if (error?.kind === 'timeout') return 'tiempo de espera agotado';
      if (error?.kind === 'schema') return 'formato de respuesta no compatible';
      if (error?.kind === 'callback') return 'el canal no pudo aceptar el informe';
      if (error?.kind === 'recovery-callback') return 'no se pudo completar la recuperación de ataques';
      if (error?.kind === 'recovery-storage') return 'no se pudo guardar el progreso de recuperación';
      return 'conexión no disponible';
    }

    function dispatch(item, detail, token, unavailable = '') {
      assertCurrent(token);
      try {
        const since = recoveryBaseline();
        const outsideRecoveryWindow = since !== null && checkpoint.recovery?.since === since
          && (item.takenAt === null || item.takenAt <= checkpoint.recovery.floor);
        if (onReport && !outsideRecoveryWindow) {
          const observed = onReport({ scope: `${slug}/${account}`, item: { ...item }, detail });
          if (observed && typeof observed.then === 'function') {
            observed.catch?.(() => {});
            throw new Error('La decisión del informe debe guardarse antes de continuar.');
          }
        }
        assertCurrent(token);
        const result = send?.(reportEvent(item, detail, unavailable));
        // emit() is normally synchronous. Do not create unhandled rejections if
        // an integration supplies a promise, and never await its Telegram queue.
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch { throw fault('callback'); }
      assertCurrent(token);
      checkpoint.pending = checkpoint.pending.filter((candidate) => candidate.id !== item.id);
      remember(item);
      saveCheckpoint();
      counters.emitted++;
      if (unavailable) counters.fallbacks++;
    }

    async function drainDetails(token) {
      phase = 'detail';
      checkpoint.pending.sort((a, b) => (a.takenAt ?? Infinity) - (b.takenAt ?? Infinity));
      for (let count = 0; count < DETAILS_PER_CYCLE && checkpoint.pending.length; count++) {
        const item = checkpoint.pending[0];
        try {
          const detail = await readJSON(`${API}${slug}/reports/${item.id}`, token);
          assertCurrent(token);
          if (!object(detail) || typeof detail.id !== 'string' || detail.id.toLowerCase() !== item.id
            || !(object(detail.sections) || object(detail.route) || object(detail.variant))) throw fault('schema');
          counters.details++;
          dispatch(item, detail, token);
        } catch (error) {
          assertCurrent(token);
          if (error?.kind === 'callback') throw error;
          if (error?.kind === 'http' && error.status === 404) {
            dispatch(item, null, token, 'el informe ya no está disponible');
            continue;
          }
          // Authentication and rate limiting affect the whole API, not a report.
          if (!(error?.kind === 'http' && [401, 403, 429].includes(error.status))) {
            item.attempts++;
            if (item.attempts >= 3) dispatch(item, null, token, errorLabel(error));
            else saveCheckpoint();
          }
          throw error;
        }
      }
    }

    function recordFailure(error) {
      failures++;
      counters.errors++;
      lastError = errorLabel(error);
      const auth = error?.kind === 'http' && [401, 403].includes(error.status);
      const backoff = auth ? 300000 : Math.min(300000, 5000 * (2 ** Math.min(failures - 1, 6)));
      retryAt = now() + Math.max(backoff, error?.waitMs || 0);
      nextPollAt = retryAt;
      phase = 'error';
    }

    async function cycle(token) {
      lastCycleAt = now();
      wakeRequested = false;
      counters.polls++;
      try {
        await scanList(token);
        assertCurrent(token);
        await recoverReports(token);
        assertCurrent(token);
        await drainDetails(token);
        assertCurrent(token);
        failures = 0; lastError = ''; retryAt = 0; phase = 'ready';
        nextPollAt = wakeRequested ? Math.max(now(), lastCycleAt + WAKE_GAP_MS) : now() + POLL_MS;
      } catch (error) {
        if (current(token) && error?.kind !== 'interrupted') recordFailure(error);
      }
    }

    function arm() {
      if (pollTimer !== null) { cancelTimer(pollTimer); pollTimer = null; }
      if (!active || !enabled || destroyed || !canRead() || running) return;
      const due = Math.max(nextPollAt, retryAt, lastCycleAt + WAKE_GAP_MS);
      pollTimer = later(() => { pollTimer = null; kick(); }, Math.max(0, due - now()));
    }

    function kick() {
      if (running || !current(epoch) || !canRead()) return;
      if (now() < Math.max(nextPollAt, retryAt, lastCycleAt + WAKE_GAP_MS)) { arm(); return; }
      if (pollTimer !== null) { cancelTimer(pollTimer); pollTimer = null; }
      const work = cycle(epoch);
      running = work;
      work.finally(() => { if (running === work) running = null; arm(); }).catch(() => {});
    }

    function tick(input = {}) {
      if (destroyed) return getDiagnostics();
      const nextSlug = pathSlug();
      const nextAccount = accountId();
      const nextEnabled = input.enabled !== false;
      let nextActive = nextEnabled && input.active === true;
      try { if (getHidden()) nextActive = false; } catch { nextActive = false; }
      const changedSlug = nextSlug !== slug || nextAccount !== account;
      if (recoveringSince !== null && recoveryBaseline() !== recoveringSince) {
        active = false;
        stop();
        nextPollAt = now(); retryAt = 0; failures = 0; lastError = '';
      }
      if (changedSlug) {
        active = false;
        stop();
        slug = nextSlug;
        account = nextAccount;
        checkpoint = blankCheckpoint();
        loadCheckpoint();
        lastUnread = null; lastListAt = null; lastCycleAt = -Infinity;
        nextPollAt = now(); retryAt = 0; failures = 0; lastError = '';
      }
      if (!nextEnabled) {
        if (active || enabled) { active = false; stop(); }
        if (enabled || changedSlug) {
          checkpoint = blankCheckpoint(); checkpoint.suspended = true; saveCheckpoint();
        }
        enabled = false; phase = 'disabled'; lastUnread = null;
        retryAt = 0; failures = 0; lastError = '';
        return getDiagnostics();
      }
      const becameEnabled = !enabled;
      enabled = true;
      if (!nextActive || !canRead()) {
        if (active) { active = false; stop(); }
        phase = canRead() ? 'idle' : 'unsupported';
        lastUnread = null;
        return getDiagnostics();
      }
      if (!active) {
        stop();
        loadCheckpoint(); // The previous leader may have advanced the shared cache.
        active = true;
        nextPollAt = now();
        if (becameEnabled) { retryAt = 0; failures = 0; lastError = ''; }
      }
      const unread = Number.isSafeInteger(input.unread) && input.unread >= 0 ? input.unread : null;
      if (unread !== null && lastUnread !== null && unread > lastUnread) {
        wakeRequested = true;
        nextPollAt = Math.min(nextPollAt, Math.max(now(), lastCycleAt + WAKE_GAP_MS));
      }
      lastUnread = unread;
      kick();
      if (!running) arm();
      return getDiagnostics();
    }

    function getDiagnostics() {
      let status;
      if (destroyed) status = 'Informes: detenido.';
      else if (!enabled) status = 'Informes: lectura automática desactivada.';
      else if (!canRead()) status = 'Informes: lectura automática no disponible en esta página.';
      else if (!active) status = 'Informes: esperando una pestaña visible con el control.';
      else if (phase === 'error') status = `Informes: ${lastError}; se reintentará automáticamente.`;
      else if (!checkpoint.initialized) status = 'Informes: preparando la referencia inicial, sin enviar historial.';
      else if (isRecovering()) status = 'Informes: recuperando los combates recientes antes de reanudar los ataques.';
      else if (request) status = `Informes: leyendo ${phase === 'detail' ? 'el contenido' : 'la lista'}.`;
      else if (checkpoint.pending.length || checkpoint.scan) status = `Informes: ${checkpoint.pending.length} pendientes; se continuará automáticamente.`;
      else status = 'Informes: al día; comprobación cada 25 segundos.';
      if (storageError) status += ' No se pudo guardar la referencia entre pestañas.';
      return { status, phase, active, enabled, apiAvailable: canRead(),
        baselineReady: checkpoint.initialized, inFlight: !!request, pending: checkpoint.pending.length,
        scanningBacklog: !!checkpoint.scan, recovering: isRecovering(), slug, lastListAt, nextPollAt: Math.max(nextPollAt, retryAt),
        lastError, failures, storageAvailable: typeof gmGet === 'function' && typeof gmSet === 'function',
        storageError, counters: { ...counters } };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true; active = false; stop(); phase = 'destroyed';
    }

    return { tick, getDiagnostics, isRecovering, destroy };
  }
  // END REPORTS

  // BEGIN LEVEL TARGETS
  // Constructed levels only. The caller reuses the HUD observer's .b-level snapshot.
  function createLevelTargets(deps = {}) {
    const CONFIG_KEY = 'old-light-level-targets:v1';
    const MAX_LEVEL = 1000000;
    const MAX_DRAFT = 32;
    const MAX_ACKNOWLEDGED = 4096;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const GALAXY = /^[A-Za-z0-9_-]{1,64}$/;
    const buildings = (deps.buildings || []).map(([id, name]) => [id, name]);
    if (!buildings.length || buildings.some(([id, name]) =>
      typeof id !== 'string' || !/^[a-z_]{1,40}$/.test(id) || typeof name !== 'string')) {
      throw new TypeError('Falta la lista de estructuras para los objetivos.');
    }
    const ids = buildings.map(([id]) => id);
    const send = typeof deps.send === 'function' ? deps.send : () => false;
    const canNotify = typeof deps.canNotify === 'function' ? deps.canNotify : () => false;
    const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : () => null;
    const gmGet = deps.gmGetValue || (typeof GM_getValue === 'function' ? GM_getValue : null);
    const gmSet = deps.gmSetValue || (typeof GM_setValue === 'function' ? GM_setValue : null);
    const later = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancel = deps.clearTimeout || (id => clearTimeout(id));
    const timers = new Map();
    const unsavedDrafts = new Map();
    let mounted = null;
    let baseline = null;
    let latest = null;
    let destroyed = false;
    let storageError = false;
    let emitted = 0;
    let fieldStatus = '';
    let config;

    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validLevel = value => Number.isInteger(value) && value >= 0 && value <= MAX_LEVEL;
    const defaults = () => ({ schemaVersion: 1, targets: Object.fromEntries(ids.map(id => [id, 0])),
      drafts: Object.fromEntries(ids.map(id => [id, null])), expanded: true, acknowledged: [] });

    function validKey(key) {
      if (typeof key !== 'string' || key.length > 180) return false;
      const [galaxy, system, id, goal, ...rest] = key.split('/');
      return rest.length === 0 && GALAXY.test(galaxy || '') && UUID.test(system || '') &&
        ids.includes(id) && /^[1-9]\d{0,6}$/.test(goal || '') && Number(goal) <= MAX_LEVEL;
    }

    function validateConfig(value = {}) {
      if (!object(value) || (value.schemaVersion !== undefined && value.schemaVersion !== 1) ||
          (value.targets !== undefined && !object(value.targets)) ||
          (value.drafts !== undefined && !object(value.drafts)) ||
          (value.expanded !== undefined && typeof value.expanded !== 'boolean') ||
          (value.acknowledged !== undefined && (!Array.isArray(value.acknowledged) ||
            value.acknowledged.length > MAX_ACKNOWLEDGED || !value.acknowledged.every(validKey)))) {
        throw new TypeError('La configuración de objetivos de nivel no es válida.');
      }
      const next = defaults();
      for (const id of ids) {
        const target = value.targets?.[id] === undefined ? 0 : value.targets[id];
        const draft = value.drafts?.[id] === undefined ? null : value.drafts[id];
        if (!validLevel(target) || (draft !== null && (typeof draft !== 'string' ||
            draft.length > MAX_DRAFT || /[\u0000-\u001f\u007f]/.test(draft)))) {
          throw new TypeError('Un objetivo o su borrador no tiene un formato válido.');
        }
        next.targets[id] = target;
        next.drafts[id] = draft;
      }
      next.expanded = value.expanded !== false;
      next.acknowledged = [...new Set((value.acknowledged || []).map(key => {
        const parts = key.split('/'); parts[1] = parts[1].toLowerCase(); return parts.join('/');
      }))];
      return next;
    }

    function readStored() {
      if (typeof gmGet === 'function' && typeof gmSet === 'function') {
        const value = gmGet(CONFIG_KEY, defaults());
        if (value && typeof value.then === 'function') throw new TypeError('Se necesita almacenamiento GM síncrono.');
        return validateConfig(value);
      }
      const value = globalThis.localStorage?.getItem(CONFIG_KEY);
      return validateConfig(value ? JSON.parse(value) : {});
    }

    function writeStored(next) {
      if (typeof gmGet === 'function' && typeof gmSet === 'function') {
        const result = gmSet(CONFIG_KEY, next);
        if (result && typeof result.then === 'function') throw new TypeError('Se necesita almacenamiento GM síncrono.');
      } else {
        if (!globalThis.localStorage) throw new Error('No hay almacenamiento local disponible.');
        globalThis.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      }
    }

    try { config = readStored(); }
    catch (_) { config = defaults(); storageError = true; }

    function normalizedSnapshot(value) {
      if (!value || !GALAXY.test(value.galaxy || '') || !UUID.test(value.system || '')) return null;
      const levels = new Map(ids.map(id => {
        const level = value.levels?.get?.(id);
        return [id, validLevel(level) ? level : null];
      }));
      return { identity: `${value.galaxy}/${value.system.toLowerCase()}`,
        systemName: typeof value.systemName === 'string'
          ? value.systemName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) : '',
        levels };
    }

    function keyFor(snapshot, id, target) { return `${snapshot.identity}/${id}/${target}`; }
    function cancelDrafts() {
      for (const timer of timers.values()) cancel(timer);
      timers.clear();
    }

    function refreshConfig() {
      if (destroyed) return;
      try {
        const next = readStored();
        if (JSON.stringify(next) === JSON.stringify(config)) return;
        for (const id of ids) {
          if (next.targets[id] !== config.targets[id] || next.drafts[id] !== config.drafts[id]) {
            if (timers.has(id)) { cancel(timers.get(id)); timers.delete(id); }
          }
          if (next.targets[id] !== config.targets[id]) baseline?.entries.delete(id);
        }
        config = next;
        render();
      } catch (_) { storageError = true; }
    }

    function exportConfig() {
      refreshConfig();
      return { ...config, targets: { ...config.targets }, drafts: { ...config.drafts, ...Object.fromEntries(unsavedDrafts) },
        acknowledged: [...config.acknowledged] };
    }

    function addAcknowledged(list, key) {
      if (list.includes(key)) return false;
      list.push(key);
      if (list.length > MAX_ACKNOWLEDGED) list.splice(0, list.length - MAX_ACKNOWLEDGED);
      return true;
    }

    function commit(value, { restoring = false, notifyChange = true } = {}) {
      if (destroyed) throw new Error('Los objetivos de nivel están cerrados.');
      const next = validateConfig(value);
      const changed = ids.filter(id => next.targets[id] !== config.targets[id]);
      let fresh = null;
      if (!restoring && changed.length) {
        try { fresh = normalizedSnapshot(getSnapshot()); } catch (_) { /* no current HUD */ }
        if (fresh) for (const id of changed) {
          const target = next.targets[id];
          const level = fresh.levels.get(id);
          if (target > 0 && level !== null && level >= target) addAcknowledged(next.acknowledged, keyFor(fresh, id, target));
        }
      }
      try { writeStored(next); }
      catch (_) { storageError = true; render(); throw new Error('No se pudieron guardar los objetivos de nivel.'); }
      storageError = false;
      config = next;
      for (const [id, draft] of unsavedDrafts) {
        if (next.drafts[id] === draft) unsavedDrafts.delete(id);
      }
      if (restoring) resetObservation();
      else if (changed.length) {
        if (fresh && baseline?.identity === fresh.identity) {
          for (const id of changed) baseline.entries.set(id, { target: next.targets[id], level: fresh.levels.get(id) });
        } else for (const id of changed) baseline?.entries.delete(id);
      }
      render();
      if (notifyChange) {
        try { deps.onSettingsChange?.(); } catch (_) { /* settings are already saved */ }
      }
      return { ...next, targets: { ...next.targets }, drafts: { ...next.drafts }, acknowledged: [...next.acknowledged] };
    }

    function importConfig(value) {
      const next = validateConfig(value);
      cancelDrafts();
      fieldStatus = '';
      const saved = commit(next, { restoring: true });
      unsavedDrafts.clear();
      render();
      return saved;
    }

    function resetObservation() { baseline = null; latest = null; }

    function observe(value, active) {
      if (destroyed) return;
      refreshConfig();
      const next = normalizedSnapshot(value);
      latest = next;
      let enabled = false;
      try { enabled = canNotify() === true; } catch (_) { /* unavailable notifier */ }
      if (!active || !enabled || !next) { baseline = null; render(); return; }
      const nextBaseline = { identity: next.identity,
        entries: baseline?.identity === next.identity ? new Map(baseline.entries) : new Map() };
      const seen = new Set(config.acknowledged);
      const acknowledged = [...config.acknowledged];
      const events = [];
      for (const [id, name] of buildings) {
        const target = config.targets[id];
        const level = next.levels.get(id);
        const previous = nextBaseline.entries.get(id);
        nextBaseline.entries.set(id, { target, level });
        if (target === 0 || level === null) continue;
        const key = keyFor(next, id, target);
        if (seen.has(key)) continue;
        const first = !previous || previous.target !== target || previous.level === null;
        if (level < target) continue;
        // Initial snapshots and newly configured, already completed goals are silent.
        addAcknowledged(acknowledged, key);
        seen.add(key);
        if (!first && previous.level < target) events.push({ type: 'game.level_target',
          id: `level-target:${key}`, title: 'Old Light', systemName: next.systemName,
          message: `${name}: objetivo de nivel ${target} alcanzado.\nNivel construido: ${previous.level} → ${level}.` });
      }
      if (acknowledged.length !== config.acknowledged.length ||
          acknowledged.some((key, index) => key !== config.acknowledged[index])) {
        try { commit({ ...config, acknowledged }, { notifyChange: false }); }
        catch (_) { return; } // Keep the previous levels so recovery can retry the crossing.
      }
      baseline = nextBaseline;
      for (const event of events) {
        try { if (send(event) !== false) emitted += 1; } catch (_) { /* notifier cannot interrupt observation */ }
      }
      render();
    }

    function parseDraft(value) {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      if (!/^\d+$/.test(trimmed)) return null;
      const level = Number(trimmed);
      return validLevel(level) ? level : null;
    }

    function promoteDraft(id) {
      if (timers.has(id)) { cancel(timers.get(id)); timers.delete(id); }
      refreshConfig();
      const draft = unsavedDrafts.has(id) ? unsavedDrafts.get(id) : config.drafts[id];
      if (draft === null) return;
      const target = parseDraft(draft);
      if (target === null && !unsavedDrafts.has(id)) return;
      try {
        const next = exportConfig();
        if (target !== null) { next.targets[id] = target; next.drafts[id] = null; }
        commit(next);
        unsavedDrafts.delete(id);
        fieldStatus = target === null ? `Borrador guardado. Escribe un nivel entero entre 0 y ${MAX_LEVEL}.`
          : 'Objetivos guardados automáticamente.';
      } catch (_) {
        unsavedDrafts.set(id, draft);
        fieldStatus = 'No se pudo guardar el cambio. El borrador sigue en esta ventana; vuelve a editar el campo o sal de él para reintentar.';
      }
      render();
    }

    function render() {
      if (!mounted) return;
      if (mounted.root.open !== config.expanded) mounted.root.open = config.expanded;
      const count = ids.filter(id => config.targets[id] > 0).length;
      mounted.count.textContent = count ? count + (count === 1 ? ' activo' : ' activos') : 'Sin objetivos';
      mounted.count.dataset.active = String(count > 0);
      for (const id of ids) {
        const input = mounted.inputs.get(id);
        const draft = unsavedDrafts.has(id) ? unsavedDrafts.get(id) : config.drafts[id];
        const value = draft === null ? (config.targets[id] ? String(config.targets[id]) : '') : draft;
        if (input.value !== value) input.value = value;
        input.setAttribute('aria-invalid', String(draft !== null && parseDraft(draft) === null));
        const level = latest?.levels.get(id);
        const current = level !== null && level !== undefined ? `Nivel actual: ${level}` : 'Nivel actual no disponible';
        mounted.labels.get(id).textContent = current + (config.targets[id] ? ` · Aviso al ${config.targets[id]}` : ' · Sin aviso');
        mounted.labels.get(id).dataset.active = String(config.targets[id] > 0);
      }
      mounted.status.textContent = unsavedDrafts.size
        ? 'El borrador sigue en esta ventana y todavía no se ha guardado. Edita el campo o sal de él para reintentar.'
        : storageError ? 'No se pudieron guardar los objetivos. Comprueba el almacenamiento local.' : fieldStatus;
      mounted.status.dataset.error = String(Boolean(unsavedDrafts.size || storageError));
    }

    function mount(container) {
      if (destroyed) throw new Error('Los objetivos de nivel están cerrados.');
      mounted?.root.remove();
      const root = document.createElement('details');
      root.className = 'level-targets-details';
      const style = document.createElement('style');
      style.textContent = `
        .level-targets-details{font:inherit;margin-top:14px;padding:12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b);color:var(--ol-text,#e5eef6)}
        .level-targets-details summary{font-size:13px;font-weight:650;cursor:pointer;line-height:1.5;color:var(--ol-text,#e5eef6)}
        .level-targets-details .level-target-count{display:inline-block;margin-left:7px;padding:3px 7px;border:1px solid var(--ol-border,#2b4053);border-radius:999px;background:var(--ol-surface-raised,#192939);color:var(--ol-muted,#a2b5c6);font-size:11.5px;font-weight:500;line-height:1.35}
        .level-targets-details .level-target-count[data-active=true]{background:var(--ol-accent-bg,#183c36);border-color:var(--ol-accent-bg,#183c36);color:var(--ol-accent,#7de2c2)}
        .level-targets-details p{font-size:11.5px;line-height:1.5;color:var(--ol-muted,#a2b5c6);margin:9px 0;overflow-wrap:anywhere}
        .level-targets-details .level-target-columns,.level-target-row{display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:3px 10px;align-items:center}
        .level-targets-details .level-target-columns{font-size:11.5px;color:var(--ol-muted,#a2b5c6);padding:9px 0 4px}
        .level-targets-details .level-target-columns span:last-child{text-align:right}
        .level-target-row{padding:9px 0;border-bottom:1px solid var(--ol-border,#2b4053)}
        .level-target-row label{min-width:0;font-size:12px;line-height:1.4;color:var(--ol-text,#e5eef6);overflow-wrap:anywhere}
        .level-target-row input{box-sizing:border-box;width:100%;min-width:0;min-height:34px;grid-column:2;grid-row:1 / span 2;padding:6px 8px;border:1px solid var(--ol-border-strong,#456177);border-radius:7px;background:var(--ol-bg,#0c141d);color:var(--ol-text,#e5eef6);font:inherit;text-align:right;font-variant-numeric:tabular-nums}
        .level-target-row input::placeholder{color:var(--ol-dim,#8097aa)}
        .level-target-row input[aria-invalid=true]{border-color:var(--ol-warning,#f3cb80)}
        .level-target-row small{grid-column:1;grid-row:2;font-size:11.5px;line-height:1.45;color:var(--ol-muted,#a2b5c6);margin:0;overflow-wrap:anywhere}
        .level-target-row small[data-active=true]{color:var(--ol-accent,#7de2c2)}
        .level-targets-details input:focus-visible,.level-targets-details summary:focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:3px}
        .level-targets-details .level-targets-status[data-error=true]{color:var(--ol-warning,#f3cb80)}
        .level-targets-status:empty{display:none}
      `;
      const summary = document.createElement('summary');
      summary.append(document.createTextNode('Objetivos de nivel'));
      const count = document.createElement('span');
      count.className = 'level-target-count';
      summary.append(count);
      const help = document.createElement('p');
      help.textContent = 'Recibe un aviso cuando una estructura del sistema observado alcance el nivel elegido.';
      const columns = document.createElement('div');
      columns.className = 'level-target-columns';
      columns.setAttribute('aria-hidden', 'true');
      const structureColumn = document.createElement('span'); structureColumn.textContent = 'Estructura';
      const targetColumn = document.createElement('span'); targetColumn.textContent = 'Avisar al nivel';
      columns.append(structureColumn, targetColumn);
      root.append(style, summary, help, columns);
      const inputs = new Map();
      const labels = new Map();
      for (const [id, name] of buildings) {
        const row = document.createElement('div');
        row.className = 'level-target-row';
        const label = document.createElement('label');
        label.textContent = name;
        const input = document.createElement('input');
        input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = MAX_DRAFT;
        input.pattern = '[0-9]*'; input.placeholder = '0'; input.autocomplete = 'off';
        input.id = `oldlight-level-target-${id}`;
        input.dataset.levelTarget = id;
        input.setAttribute('aria-label', `Objetivo de nivel de ${name}`);
        input.setAttribute('aria-describedby', `oldlight-level-target-state-${id}`);
        label.htmlFor = input.id;
        const active = document.createElement('small');
        active.id = `oldlight-level-target-state-${id}`;
        active.dataset.levelTargetStatus = id;
        input.addEventListener('input', () => {
          if (timers.has(id)) { cancel(timers.get(id)); timers.delete(id); }
          const draft = input.value;
          try {
            const next = exportConfig();
            next.drafts[id] = draft;
            commit(next);
            fieldStatus = parseDraft(draft) === null
              ? `Borrador guardado. Escribe un nivel entero entre 0 y ${MAX_LEVEL}.`
              : 'Borrador guardado; aplicando el objetivo…';
            if (parseDraft(draft) !== null) timers.set(id, later(() => promoteDraft(id), 400));
          } catch (_) {
            unsavedDrafts.set(id, draft);
            fieldStatus = 'No se pudo guardar el borrador. Se conserva el objetivo anterior.';
          }
          render();
        });
        input.addEventListener('blur', () => promoteDraft(id));
        inputs.set(id, input); labels.set(id, active);
        row.append(label, input, active); root.append(row);
      }
      const footnote = document.createElement('p');
      footnote.textContent = 'Vacío o 0 desactiva el aviso. Solo se notifican niveles alcanzados después de activar el objetivo.';
      const status = document.createElement('p');
      status.className = 'level-targets-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      root.append(footnote, status);
      root.addEventListener('toggle', () => {
        if (root.open === config.expanded) return;
        try { commit({ ...exportConfig(), expanded: root.open }); }
        catch (_) { render(); }
      });
      mounted = { root, inputs, labels, count, status };
      container.append(root);
      render();
      return root;
    }
    function getDiagnostics() {
      return { configured: ids.filter(id => config.targets[id] > 0).length,
        acknowledged: config.acknowledged.length, emitted, storageError, observing: !!baseline };
    }

    function destroy() {
      if (destroyed) return;
      cancelDrafts(); resetObservation(); destroyed = true;
      unsavedDrafts.clear();
      mounted?.root.remove(); mounted = null;
    }

    return { mount, observe, exportConfig, validateConfig, importConfig, resetObservation, getDiagnostics, destroy };
  }
  // END LEVEL TARGETS

  // BEGIN DRIVE BACKUP
  /*
   * Optional userscript fragment. GIS runs only on the companion page.
   * No OAuth token is returned to or stored by this module.
   * gmGetValue is the synchronous GM_getValue API used by the main userscript.
   * gmSetValue is the synchronous GM_setValue API used by the main userscript.
   */
  function createDriveBackup(options) {
    'use strict';
    const { getBackup, applyBackup, onStatus, gmGetValue, gmSetValue } = options;

    const PROTOCOL = 'old-light-drive-v1';
    const STORAGE_KEY = 'old-light-auto-upgrade:drive:v1';
    const HELPER_URL = 'https://alexx-ftw.github.io/old-light-auto-upgrade/drive.html';
    const HELPER_ORIGIN = 'https://alexx-ftw.github.io';
    const MAX_BYTES = 1024 * 1024;
    const HEARTBEAT_TIMEOUT = 60000;
    const OPEN_TIMEOUT = 20000;
    const CLIENT_ID = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
    const ACCOUNT_EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
    const CAPABILITIES = ['oauth-config', 'account-hint', 'settings-sync-v1'];
    const encoder = new TextEncoder();
    const LABELS = {
      disconnected: 'Google Drive desconectado. Los cambios quedan guardados en local.',
      syncing: 'Sincronizando ajustes entre dispositivos…',
      synced: 'Ajustes sincronizados automáticamente.',
      sync_pending: 'Cambios pendientes de sincronizar.',
      sync_waiting: 'Sincronización pendiente. Abre Google Drive y conecta tu cuenta.',
      sync_account: 'No se pudo identificar la cuenta para sincronizar con seguridad.',
      invalid_sync: 'No se pudieron validar los datos de sincronización. No se ha sustituido tu configuración.',
      sync_retry: 'Sincronización interrumpida. Se reintentará automáticamente.',
      missing_client: 'Añade tu Client ID de Google para habilitar las copias en Drive.',
      opening: 'Abriendo la página de copias…',
      bridge_ready: 'Ventana conectada. Autoriza Google Drive desde esa ventana.',
      connecting: 'Esperando tu autorización de Google…',
      connected: 'Google Drive conectado durante esta sesión.',
      listing: 'Buscando copias en Drive…',
      saving: 'Guardando una copia en Drive…',
      saved: 'Copia guardada en Drive.',
      unchanged: 'La configuración ya tiene una copia idéntica.',
      restoring: 'Restaurando la copia seleccionada…',
      restored: 'Configuración restaurada.',
      expired: 'Autorización caducada. Vuelve a conectar Google Drive desde su ventana.',
      denied: 'No se concedió el permiso de datos de la aplicación.',
      popup_blocked: 'El navegador bloqueó la ventana. Vuelve a pulsar Abrir Google Drive.',
      auth_closed: 'Se cerró la autorización de Google.',
      auth_error: 'No se pudo autorizar Google Drive. Comprueba el Client ID y su origen.',
      library_error: 'No se pudo cargar Google Identity Services en la página de copias.',
      library_loading: 'Cargando la conexión con Google…',
      library_timeout: 'Google no terminó de cargar. Reintenta desde la ventana de Drive.',
      auth_timeout: 'La autorización tardó demasiado. Puedes volver a intentarlo.',
      auth_cancelled: 'Autorización cancelada.',
      permission_missing: 'Falta conceder el permiso para las copias de esta aplicación.',
      invalid_client: 'El Client ID de Google no es válido. Revisa la configuración.',
      auth_origin: 'El Client ID debe autorizar el origen de la página de copias.',
      renewing: 'Renovando la conexión con Google Drive…',
      renew_soon: 'La conexión con Google caduca pronto. Puedes renovarla desde su ventana.',
      switching_account: 'Elige la cuenta de Google que quieres usar.',
      revoking: 'Retirando el permiso de Google…',
      revoked: 'Permiso de Google retirado.',
      revoke_failed: 'No se pudo confirmar la retirada del permiso de Google.',
      bridge_lost: 'Se perdió la conexión con la ventana. Vuelve a abrir Google Drive.',
      timeout: 'La operación tardó demasiado. Comprueba la lista antes de repetir una copia.',
      rate_limit: 'Google ha limitado las solicitudes. La copia automática está detenida.',
      api_denied: 'Google rechazó la petición. Comprueba que Drive API esté activada y que el permiso siga concedido.',
      upload_uncertain: 'No se confirmó la copia. Actualiza la lista de Drive antes de repetir.',
      invalid_backup: 'La copia no es válida o supera 1 MiB.',
      busy: 'Espera a que termine la operación actual.',
      failed: 'No se pudo completar la operación. Revisa la ventana de Drive.',
      config_saved: 'Ajustes guardados automáticamente.',
      draft_saved: 'Borrador guardado. La conexión conserva el Client ID activo hasta que completes uno válido.',
      invalid_config: 'El ajuste no tiene un formato válido.',
      storage_error: 'No se pudo guardar la configuración de Drive.',
    };

    if (typeof getBackup !== 'function' || typeof applyBackup !== 'function' ||
        typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function') {
      throw new TypeError('Faltan las funciones de almacenamiento o copia.');
    }

    // This public Web Client ID is supplied by the application maintainer.
    // It is adopted only after the user opens Drive; stored/imported clients keep priority.
    const defaultClientId = validateConfig({
      clientId: options.defaultClientId === undefined ? '' : options.defaultClientId,
    }).clientId;

    let config;
    try {
      const stored = gmGetValue(STORAGE_KEY, { clientId: '', autoBackup: false,
        rememberAccount: true, accountHint: '', clientIdDraft: null });
      if (stored && typeof stored.then === 'function') {
        throw new TypeError('createDriveBackup necesita GM_getValue síncrono.');
      }
      config = validateConfig(stored);
    } catch (error) {
      if (error instanceof TypeError && /síncrono/.test(error.message)) throw error;
      config = { clientId: '', autoBackup: false, rememberAccount: true, accountHint: '', clientIdDraft: null };
    }

    let destroyed = false;
    let session = null;
    let mountNode = null;
    let inputs = null;
    let statusCode = config.clientId || defaultClientId ? 'disconnected' : 'missing_client';
    let applying = false;
    let configDeferred = false;
    let suppressChangedUntil = 0;
    let configRevision = 0;
    let draftTimer = null;

    function validateAccountHint(value) {
      if (typeof value !== 'string') throw new TypeError('La cuenta recordada debe ser un correo.');
      const email = value.trim();
      if (email && (email.length > 254 || !ACCOUNT_EMAIL.test(email))) {
        throw new TypeError('La cuenta recordada no tiene un formato válido.');
      }
      return email;
    }

    function validateConfig(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('La configuración de Drive debe ser un objeto.');
      }
      const clientId = value.clientId === undefined ? '' : value.clientId;
      const autoBackup = value.autoBackup === undefined ? false : value.autoBackup;
      const autoSync = value.autoSync === undefined ? true : value.autoSync;
      const rememberAccount = value.rememberAccount === undefined ? true : value.rememberAccount;
      const accountHint = validateAccountHint(value.accountHint === undefined ? '' : value.accountHint);
      const clientIdDraft = value.clientIdDraft === undefined ? null : value.clientIdDraft;
      if (typeof clientId !== 'string' || typeof autoBackup !== 'boolean' || typeof autoSync !== 'boolean' ||
          typeof rememberAccount !== 'boolean' ||
          (clientIdDraft !== null && (typeof clientIdDraft !== 'string' || clientIdDraft.length > 300))) {
        throw new TypeError('La configuración de Google Drive no tiene un formato válido.');
      }
      const trimmed = clientId.trim();
      if (trimmed && (trimmed.length > 300 || !CLIENT_ID.test(trimmed))) {
        throw new TypeError('El Client ID de Google no tiene un formato válido.');
      }
      return { clientId: trimmed, autoBackup, autoSync, rememberAccount,
        accountHint: rememberAccount ? accountHint : '', clientIdDraft };
    }

    function exportConfig() {
      return { ...config };
    }

    function report(code) {
      if (destroyed) return;
      if (['config_saved', 'draft_saved', 'invalid_config', 'storage_error'].includes(code)) {
        inputStatus(code);
        return;
      }
      statusCode = Object.hasOwn(LABELS, code) ? code : 'failed';
      if (inputs) inputs.status.textContent = LABELS[statusCode];
      try { onStatus?.({ code: statusCode, message: LABELS[statusCode] }); } catch (_) { /* caller UI */ }
    }

    function refreshControls() {
      if (!inputs) return;
      inputs.client.value = config.clientIdDraft === null ? config.clientId : config.clientIdDraft;
      inputs.auto.checked = config.autoBackup;
      inputs.sync.checked = config.autoSync;
      inputs.remember.checked = config.rememberAccount;
      inputs.open.disabled = false;
      inputs.open.textContent = config.clientId || defaultClientId ? 'Abrir Google Drive' : 'Configurar Google Drive';
      inputs.close.disabled = !session;
      inputs.close.hidden = !session;
      inputs.clear.disabled = !config.clientId && config.clientIdDraft === null;
      inputs.status.textContent = LABELS[statusCode];
      inputs.active.textContent = config.clientId ? `Client ID activo: ${config.clientId}`
        : defaultClientId ? 'Se utilizará la conexión integrada al abrir Google Drive.' : 'Todavía no hay un Client ID activo.';
      inputs.account.textContent = config.rememberAccount && config.accountHint
        ? `Cuenta recordada: ${config.accountHint}` : '';
    }

    function send(current, message) {
      if (destroyed || current !== session || !current?.port || !current.ready) return false;
      try {
        current.port.postMessage({ protocol: PROTOCOL, ...message });
        return true;
      } catch (_) {
        closeSession('bridge_lost');
        return false;
      }
    }

    function sendConfig() {
      if (applying) { configDeferred = true; return; }
      configDeferred = false;
      send(session, { type: 'config', config: exportConfig(), revision: configRevision,
        capabilities: [...CAPABILITIES] });
    }

    function storeConfig(value, { fromBackup = false } = {}) {
      const next = validateConfig(value);
      if (destroyed) throw new Error('El módulo de Drive está cerrado.');
      if (!fromBackup && next.clientId !== config.clientId) next.accountHint = '';
      const written = gmSetValue(STORAGE_KEY, { ...next });
      if (written && typeof written.then === 'function') {
        throw new TypeError('createDriveBackup necesita GM_setValue síncrono.');
      }
      const changed = Object.keys(next).some(key => next[key] !== config[key]);
      if (next.clientId !== config.clientId) configRevision += 1;
      config = next;
      if (!session) report(config.clientId || defaultClientId ? 'disconnected' : 'missing_client');
      refreshControls();
      if (changed) sendConfig();
      return exportConfig();
    }

    // This public API restores an explicit backup, including its optional account hint.
    // Interactive changes always use storeConfig and clear hints when switching clients.
    function importConfig(value) {
      clearTimeout(draftTimer);
      draftTimer = null;
      return storeConfig(value, { fromBackup: true });
    }

    function inputStatus(code) {
      if (inputs) inputs.inputStatus.textContent = LABELS[code] || LABELS.invalid_config;
    }

    function parseBackup(json) {
      if (typeof json !== 'string' || json.length > MAX_BYTES || encoder.encode(json).byteLength > MAX_BYTES) {
        throw new Error('invalid_backup');
      }
      const value = JSON.parse(json);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_backup');
      return value;
    }

    async function handlePortMessage(current, message) {
      if (destroyed || current !== session || !message || message.protocol !== PROTOCOL) return;
      current.lastSeen = Date.now();
      if (message.type === 'port-ready' && !current.ready) {
        current.ready = true;
        clearTimeout(current.openTimeout);
        sendConfig();
        report('bridge_ready');
        return;
      }
      if (!current.ready) return;
      if (message.type === 'ping') { send(current, { type: 'pong' }); return; }
      if (message.type === 'pong') return;
      if (message.type === 'bye') { closeSession(message.code === 'bridge_lost' ? 'bridge_lost' : 'disconnected'); return; }
      if (message.type === 'status') {
        if (message.code === 'bridge_lost') { closeSession('bridge_lost'); return; }
        if (typeof message.code === 'string' && Object.hasOwn(LABELS, message.code)) report(message.code);
        return;
      }
      if (!['get-backup', 'apply-backup', 'get-sync', 'merge-sync', 'set-config', 'remember-account'].includes(message.type)) return;
      if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(message.id)) return;
      if (message.revision !== configRevision) {
        send(current, { type: 'reply', id: message.id, ok: false, error: 'expired' });
        return;
      }
      if (message.type === 'set-config' || message.type === 'remember-account') {
        if (applying) {
          send(current, { type: 'reply', id: message.id, ok: false, error: 'busy' });
          return;
        }
        let next;
        try {
          if (message.type === 'set-config') next = validateConfig(message.config);
          else {
            const email = validateAccountHint(message.email);
            if (!email) throw new TypeError('Falta la cuenta que se quiere recordar.');
            if (!config.rememberAccount) {
              send(current, { type: 'reply', id: message.id, ok: true, remembered: false,
                config: exportConfig(), revision: configRevision, capabilities: [...CAPABILITIES] });
              return;
            }
            next = { ...exportConfig(), accountHint: email };
          }
        } catch (_) {
          send(current, { type: 'reply', id: message.id, ok: false, error: 'invalid_config' });
          inputStatus('invalid_config');
          return;
        }
        try {
          // A pending backup snapshot can be invalidated by an intentional client change.
          // apply-backup remains exclusive so restoration and interactive writes cannot mix.
          if (message.type === 'set-config') {
            clearTimeout(draftTimer);
            draftTimer = null;
          }
          storeConfig(next);
          send(current, { type: 'reply', id: message.id, ok: true,
            ...(message.type === 'remember-account' ? { remembered: true } : {}),
            config: exportConfig(), revision: configRevision, capabilities: [...CAPABILITIES] });
          if (message.type === 'set-config') inputStatus(next.clientIdDraft === null ? 'config_saved' : 'draft_saved');
        } catch (_) {
          send(current, { type: 'reply', id: message.id, ok: false, error: 'storage_error' });
          inputStatus('storage_error');
        }
        return;
      }
      if (current.serving) {
        send(current, { type: 'reply', id: message.id, ok: false, error: 'busy' });
        return;
      }
      current.serving = true;
      try {
        if (message.type === 'get-sync' || message.type === 'merge-sync') {
          if (!config.autoSync || !preferenceSync) throw Object.assign(new Error('busy'), { code: 'busy' });
          const result = message.type === 'get-sync' ? preferenceSync.get(message.account) : preferenceSync.merge(message);
          send(current, { type: 'reply', id: message.id, ok: true, ...result });
        } else if (message.type === 'get-backup') {
          const value = await getBackup();
          if (message.revision !== configRevision) {
            send(current, { type: 'reply', id: message.id, ok: false, error: 'expired' });
            return;
          }
          const json = JSON.stringify(value);
          parseBackup(json);
          send(current, { type: 'reply', id: message.id, ok: true, json });
        } else {
          const value = parseBackup(message.json);
          if (current !== session || destroyed) return;
          applying = true;
          await applyBackup(value);
          suppressChangedUntil = Date.now() + 1000;
          send(current, { type: 'reply', id: message.id, ok: true });
          report('restored');
        }
      } catch (cause) {
        const syncRequest = ['get-sync', 'merge-sync'].includes(message.type);
        const code = Object.hasOwn(LABELS, cause?.code) ? cause.code : syncRequest ? 'invalid_sync' : 'invalid_backup';
        send(current, { type: 'reply', id: message.id, ok: false, error: code });
        report(code);
      } finally {
        current.serving = false;
        applying = false;
        if (configDeferred) sendConfig();
      }
    }

    function closeSession(code = 'disconnected') {
      const current = session;
      if (current) {
        session = null;
        try { current.port?.postMessage({ protocol: PROTOCOL, type: 'disconnect' }); } catch (_) { /* closed */ }
        clearTimeout(current.openTimeout);
        clearInterval(current.closedCheck);
        try { current.port?.close(); } catch (_) { /* already closed */ }
      }
      if (!destroyed) { report(code); refreshControls(); }
    }

    function onWindowMessage(event) {
      const current = session;
      const message = event.data;
      if (!current || destroyed || current.port || event.origin !== HELPER_ORIGIN ||
          event.source !== current.popup || !message || message.protocol !== PROTOCOL ||
          message.type !== 'ready' || message.nonce !== current.nonce) return;
      const channel = new MessageChannel();
      current.port = channel.port1;
      channel.port1.onmessage = event => { void handlePortMessage(current, event.data); };
      channel.port1.onmessageerror = () => { if (session === current) closeSession('bridge_lost'); };
      channel.port1.start();
      try {
        // Only the public bootstrap and a private port cross window.postMessage.
        // No backup, credentials, OAuth token, or configuration is sent this way.
        current.popup.postMessage({ protocol: PROTOCOL, type: 'port', nonce: current.nonce },
          HELPER_ORIGIN, [channel.port2]);
      } catch (_) {
        channel.port2.close();
        closeSession('bridge_lost');
      }
    }

    function openCompanion() {
      if (destroyed) return;
      if (!config.clientId && defaultClientId) {
        // Keep explicit clears/imports intact until the user chooses to open Drive.
        // Persist before opening, so exports retain the actual app whose backups are used.
        if (applying) { report('busy'); return; }
        try {
          storeConfig({ ...exportConfig(), clientId: defaultClientId });
        } catch (_) {
          inputStatus('storage_error');
          return;
        }
      }
      const previous = session;
      const age = previous ? Date.now() - (previous.ready ? previous.lastSeen : previous.openedAt) : Infinity;
      if (previous?.popup && !previous.popup.closed &&
          age <= (previous.ready ? HEARTBEAT_TIMEOUT : OPEN_TIMEOUT)) {
        try { previous.popup.focus(); } catch (_) { /* focus is best effort */ }
        return;
      }
      closeSession();
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const nonce = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      // The nonce is public session routing data. Settings never enter this URL.
      const current = { nonce, popup: null, port: null, ready: false, serving: false,
        openedAt: Date.now(), lastSeen: Date.now() };
      session = current;
      try {
        current.popup = window.open(`${HELPER_URL}#bridge=${nonce}`, '_blank',
          'popup,width=720,height=820,resizable=yes,scrollbars=yes');
      } catch (_) { /* blocked */ }
      if (!current.popup) { closeSession('popup_blocked'); return; }
      current.openTimeout = setTimeout(() => {
        if (session === current && !current.ready) closeSession('bridge_lost');
      }, OPEN_TIMEOUT);
      current.closedCheck = setInterval(() => {
        if (session !== current) return;
        if (current.popup.closed) closeSession('disconnected');
        else if (current.ready && Date.now() - current.lastSeen > HEARTBEAT_TIMEOUT) closeSession('bridge_lost');
      }, 1000);
      report('opening');
      refreshControls();
    }

    function notifyChanged({ sharedChanged = true, backupChange = true } = {}) {
      if (!destroyed && !applying && Date.now() >= suppressChangedUntil && (config.autoBackup && backupChange || config.autoSync && sharedChanged)) {
        send(session, { type: 'settings-changed', sharedChanged, backupChange });
      }
    }

    function element(tag, text, attrs = {}) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      Object.assign(node, attrs);
      return node;
    }

    function mount(container) {
      if (destroyed) throw new Error('El módulo de Drive está cerrado.');
      clearTimeout(draftTimer);
      draftTimer = null;
      mountNode?.remove();
      const box = element('section', undefined, { className: 'oldlight-drive-config' });
      box.append(element('style', `
        .oldlight-drive-config{min-width:0;padding:12px;border:1px solid var(--ol-border,#2b4053);border-radius:var(--ol-radius,10px);background:var(--ol-surface,#131f2b);color:var(--ol-text,#e5eef6)}
        .oldlight-drive-config [hidden]{display:none!important}
        .oldlight-drive-config h4{margin:0;font-size:13px;font-weight:600;color:var(--ol-text,#e5eef6)}
        .oldlight-drive-config p{margin:8px 0 0;font-size:11.5px;line-height:1.5;color:var(--ol-muted,#a2b5c6)}
        .oldlight-drive-config .oldlight-drive-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
        .oldlight-drive-config .oldlight-drive-controls button{min-height:36px;flex:1;padding:8px 10px;border:1px solid var(--ol-border-strong,#456177);border-radius:7px;font:inherit;color:var(--ol-text,#e5eef6);background:var(--ol-surface-raised,#192939)}
        .oldlight-drive-config .oldlight-drive-controls button:first-child{flex-basis:100%;font-weight:600;color:var(--ol-accent,#7de2c2);background:var(--ol-accent-bg,#183c36)}
        .oldlight-drive-config .drive-toggle{display:flex;gap:8px;align-items:center;min-height:34px;margin:6px 0 0;font-size:12px;line-height:1.4}
        .oldlight-drive-config .drive-toggle input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--ol-accent,#7de2c2)}
        .oldlight-drive-config .drive-advanced{min-width:0;margin-top:12px;padding-top:10px;border-top:1px solid var(--ol-border,#2b4053)}
        .oldlight-drive-config .drive-advanced summary{cursor:pointer;min-height:24px;font-size:12px;font-weight:600;color:var(--ol-muted,#a2b5c6)}
        .oldlight-drive-config .drive-advanced label{display:grid;gap:6px;margin-top:10px;font-size:12px}
        .oldlight-drive-config .drive-advanced input[type="text"]{box-sizing:border-box;width:100%;min-width:0;min-height:36px;padding:8px 10px;border:1px solid var(--ol-border-strong,#456177);border-radius:7px;background:var(--ol-bg,#0c141d);color:var(--ol-text,#e5eef6);font:inherit}
        .oldlight-drive-config .drive-advanced button{min-height:34px;margin-top:10px;padding:7px 10px;border:1px solid var(--ol-border,#2b4053);border-radius:7px;font:inherit;font-size:12px;background:transparent;color:var(--ol-muted,#a2b5c6)}
        .oldlight-drive-config button:hover:not(:disabled){border-color:var(--ol-accent,#7de2c2)}
        .oldlight-drive-config .drive-advanced button:hover:not(:disabled){border-color:var(--ol-danger,#f4a8a8);color:var(--ol-danger,#f4a8a8)}
        .oldlight-drive-config .drive-active-client,.oldlight-drive-config .drive-account{overflow-wrap:anywhere}
        .oldlight-drive-config .drive-account{color:var(--ol-text,#e5eef6)}
        .oldlight-drive-config .drive-active-client{font-size:11.5px}
        .oldlight-drive-config .drive-field-status:empty,.oldlight-drive-config .drive-account:empty{display:none}
        .oldlight-drive-config :focus-visible{outline:2px solid var(--ol-focus,#8bc7ff);outline-offset:3px}
      `));
      box.append(element('h4', 'Google Drive'));
      const controls = element('div', undefined, { className: 'oldlight-drive-controls' });
      const open = element('button', 'Configurar Google Drive', { type: 'button' });
      const close = element('button', 'Desconectar', { type: 'button' });
      controls.append(open, close);
      const status = element('p', undefined, { className: 'drive-connection-status' });
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const autoLabel = element('label', undefined, { className: 'drive-toggle' });
      const auto = element('input', undefined, { type: 'checkbox' });
      autoLabel.append(auto, document.createTextNode(' Copia automática de cada cambio'));
      const syncLabel = element('label', undefined, { className: 'drive-toggle' });
      const sync = element('input', undefined, { type: 'checkbox' });
      syncLabel.append(sync, document.createTextNode(' Sincronizar ajustes automáticamente entre dispositivos'));
      const rememberLabel = element('label', undefined, { className: 'drive-toggle' });
      const remember = element('input', undefined, { type: 'checkbox' });
      rememberLabel.append(remember, document.createTextNode(' Recordar mi cuenta'));
      const note = element('p', 'Los ajustes se envían y reciben automáticamente con Drive conectado. Las misiones en ejecución y la posición de esta ventana permanecen locales. La conexión actual necesita la ventana de Drive abierta y autorización vigente.');
      const advanced = element('details', undefined, { className: 'drive-advanced' });
      advanced.dataset.uiSection = 'driveAdvanced';
      advanced.open = config.clientIdDraft !== null;
      advanced.append(element('summary', 'Conexión avanzada'));
      const clientLabel = element('label', 'Client ID de Google OAuth');
      const client = element('input', undefined, { type: 'text', maxLength: 300,
        autocomplete: 'off', spellcheck: false, placeholder: '…apps.googleusercontent.com' });
      clientLabel.append(client);
      const active = element('p', undefined, { className: 'drive-active-client' });
      const account = element('p', undefined, { className: 'drive-account' });
      const setupNote = element('p', 'Solo para tu propio proyecto de Google: utiliza un Client ID Web con el origen ' + HELPER_ORIGIN +
        '. Los pasos están en la ventana de Drive.');
      const clear = element('button', 'Borrar Client ID', { type: 'button' });
      const inputNote = element('p', 'El borrador se guarda al escribir y se aplica cuando está completo. ' +
        'Un campo vacío conserva la conexión actual.');
      const fieldStatus = element('p', undefined, { className: 'drive-field-status' });
      fieldStatus.setAttribute('role', 'status');
      fieldStatus.setAttribute('aria-live', 'polite');
      advanced.append(clientLabel, inputNote, active, setupNote, clear);
      box.append(status, account, controls, syncLabel, autoLabel, rememberLabel, note, fieldStatus, advanced);

      function flushClientDraft() {
        clearTimeout(draftTimer);
        draftTimer = null;
        const value = client.value.trim();
        if (!value || value.length > 300 || !CLIENT_ID.test(value)) return;
        if (config.clientId === value && config.clientIdDraft === null) return;
        try {
          storeConfig({ ...exportConfig(), clientId: value, clientIdDraft: null });
          inputStatus('config_saved');
        } catch (_) {
          inputStatus('storage_error');
        }
      }

      client.addEventListener('input', () => {
        clearTimeout(draftTimer);
        draftTimer = null;
        const draft = client.value;
        try {
          storeConfig({ ...exportConfig(), clientIdDraft: draft });
          inputStatus('draft_saved');
          if (CLIENT_ID.test(draft.trim())) {
            draftTimer = setTimeout(() => {
              if (!destroyed && inputs?.client === client && client.value === draft) flushClientDraft();
            }, 400);
          }
        } catch (_) { inputStatus('storage_error'); }
      });
      client.addEventListener('blur', flushClientDraft);
      function saveToggles() {
        try {
          storeConfig({ ...exportConfig(), autoBackup: auto.checked, autoSync: sync.checked, rememberAccount: remember.checked });
          inputStatus('config_saved');
        } catch (_) {
          refreshControls();
          inputStatus('storage_error');
        }
      }
      sync.addEventListener('change', saveToggles);
      auto.addEventListener('change', saveToggles);
      remember.addEventListener('change', saveToggles);
      clear.addEventListener('click', () => {
        clearTimeout(draftTimer);
        draftTimer = null;
        try {
          storeConfig({ ...exportConfig(), clientId: '', clientIdDraft: null, accountHint: '' });
          inputStatus('config_saved');
        } catch (_) { inputStatus('storage_error'); }
      });
      open.addEventListener('click', () => { flushClientDraft(); openCompanion(); });
      close.addEventListener('click', () => closeSession());
      inputs = { client, auto, sync, remember, open, close, clear, active, account, status, inputStatus: fieldStatus };
      mountNode = box;
      container.append(box);
      refreshControls();
      return box;
    }

    function destroy() {
      if (destroyed) return;
      clearTimeout(draftTimer);
      draftTimer = null;
      closeSession();
      destroyed = true;
      window.removeEventListener('message', onWindowMessage);
      mountNode?.remove();
      inputs = null;
      mountNode = null;
    }

    window.addEventListener('message', onWindowMessage);
    return { mount, notifyChanged, exportConfig, importConfig, validateConfig, destroy };
  }
  // END DRIVE BACKUP

  function readUnread(kind) {
    const button = document.querySelector(`#${kind}-btn`);
    const label = button?.getAttribute('aria-label') || button?.getAttribute('title') || '';
    const match = new RegExp(`^Open ${kind}(?:, (\\d+) unread)?$`).exec(label);
    return match ? Number(match[1] || 0) : null;
  }

  function readLevelTargetSnapshot(current) {
    return {
      galaxy: location.pathname.match(/^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/)?.[1] || '',
      system: systemId(),
      systemName: text(document.querySelector('[data-field="nameplate-name"]')),
      levels: new Map(current.map(row => {
        const match = /^Lvl\s+(\d+)$/i.exec(text(row.row.querySelector('.b-level')));
        return [row.id, match ? Number(match[1]) : null];
      })),
    };
  }

  // Observa eventos nuevos del HUD; no reenvía historial al cargar/cambiar de pestaña.
  function createGameEventObserver(send) {
    let observing = false;
    let baseline = null;
    let seenToasts = new WeakSet();
    let unread = new Map();

    function snapshot(current) {
      return {
        ...readLevelTargetSnapshot(current),
        fleet: new Map(SHIPS.map(([id]) => [id, fleetCounts(id)])),
      };
    }

    return function observe(current, active, reportApiAvailable = false) {
      if (!active) { levelTargets.observe(null, false); observing = false; baseline = null; return; }
      const next = snapshot(current);
      levelTargets.observe(next, !importingBackup);
      const toasts = [...document.querySelectorAll('.toast')];
      if (!observing) {
        observing = true;
        baseline = next;
        seenToasts = new WeakSet(toasts);
        unread = new Map(['reports', 'messages'].map(kind => [kind, readUnread(kind)]));
        return;
      }
      for (const toast of toasts) {
        if (seenToasts.has(toast)) continue;
        seenToasts.add(toast);
        if (toast.dataset.dismissed === '1') continue;
        const message = text(toast);
        if (message) send('game.toast', `Aviso del juego: ${message}`);
      }
      for (const kind of ['reports', 'messages']) {
        const count = readUnread(kind);
        const previous = unread.get(kind);
        if (count !== null) {
          if (previous !== null && previous !== undefined && count > previous
              && !(kind === 'reports' && reportApiAvailable)) {
            const label = kind === 'reports' ? 'informes' : 'mensajes';
            send(`game.${kind}`, `${count - previous} ${label} más sin leer (${count} en total).`);
          }
          unread.set(kind, count);
        }
      }
      if (next.system && baseline?.system === next.system) {
        for (const [id, level] of next.levels) {
          const previous = baseline.levels.get(id);
          if (level !== null && previous !== null && previous !== undefined && level > previous) {
            const name = BUILDINGS.find(([key]) => key === id)?.[1] || id;
            send('building.completed', `${name} terminado: nivel ${previous} → ${level}.`,
              `level:${next.system}:${id}:${level}`);
          }
        }
        for (const [id, counts] of next.fleet) {
          const previous = baseline.fleet.get(id);
          if (!counts || !previous || ['parked', 'away', 'building'].every(key => counts[key] === previous[key])) continue;
          const name = SHIPS.find(([key]) => key === id)?.[1] || id;
          send('fleet.changed', `${name}: ${counts.parked} en base, ${counts.away} en misión y ${counts.building} en construcción.`);
        }
      }
      baseline = next;
    };
  }

  if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
    try {
      driveBackup = createDriveBackup({ getBackup: createBackup, applyBackup,
        gmGetValue: GM_getValue, gmSetValue: GM_setValue,
        // Public Google Web client registered for the companion's GitHub Pages origin.
        defaultClientId: '418130838768-qhd4o520fhi8hojd6t3g43luesr8v0n9.apps.googleusercontent.com' });
      preferenceSync = createPreferenceSync({ getBackup: createBackup, applyPreferences: applySyncedPreferences,
        getScope: () => missionContext().scope, getClientId: () => driveBackup.exportConfig().clientId,
        gmGetValue: GM_getValue, gmSetValue: GM_setValue });
      try { preferenceSync.observe(); } catch { /* Game identity may not be ready yet. */ }
    } catch { /* La copia local y la automatización funcionan aunque GM no esté disponible. */ }
  }

  // Los cambios en disabled disparan una revisión inmediata. También cubre
  // el reemplazo completo del panel y los cambios de nivel/precio de los botones.
  new MutationObserver(records => {
    // El relleno de la cola se anima cada frame; no cambia la disponibilidad.
    if (records.every(record => record.type === 'attributes' && record.attributeName === 'style' &&
        record.target.classList.contains('queue-row-fill'))) return;
    schedule();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'aria-hidden', 'aria-label', 'hidden', 'inert', 'class', 'style', 'title', 'data-tutorial', 'data-mobile-mode', 'data-star-tab'],
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    shiftPresets.cancel();
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    ui?.cancelResize?.();
    settings = readSettings();
    restoreNumericInputs();
    if (settings.enabled) { error = ''; unconfirmed = 0; }
    schedule();
  });
  window.addEventListener('resize', () => {
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    ui?.cancelResize?.();
    layoutHelper();
    schedule();
  });
  document.addEventListener('input', event => {
    if (event.composedPath().includes(host)) lastPreferenceEditAt = Date.now();
  }, true);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('focus', schedule);
  // Respaldo para carga tardía, plazos de respuesta y recuperación de pestañas.
  setInterval(() => {
    schedule();
    if (!importingBackup) try {
      if (preferenceSync?.observe()) driveBackup?.notifyChanged?.({ sharedChanged: true, backupChange: false });
    } catch { /* Retry after game identity/storage recovers. */ }
  }, 1000);
  schedule();
})();
