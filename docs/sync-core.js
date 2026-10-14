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
  const EMPIRE_ROLES = new Set(['balanced', 'industry', 'shipyard', 'defense']);
  const MAX_EMPIRE_SYSTEMS = 1024;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EMPIRE_SYSTEM_KEY = /^empire\.systems\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(role|enabled)$/;
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
    ...SHIPS.map(id => `empire.fleetTargets.${id}`),
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
  function dataAt(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) fail('Object accessors and non-JSON keys are not supported.');
    return descriptor.value;
  }
  function empireKey(key) { return key.startsWith('empire.'); }
  function validKey(key) { return ALLOWED.has(key) || EMPIRE_SYSTEM_KEY.test(key); }
  function checkEmpireSystems(...objects) {
    const ids = new Set();
    for (const object of objects) for (const key of Object.keys(object)) {
      const match = EMPIRE_SYSTEM_KEY.exec(key);
      if (match) ids.add(match[1]);
    }
    if (ids.size > MAX_EMPIRE_SYSTEMS) fail('Empire exceeds the 1024 systems limit.');
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
    if (Object.getOwnPropertyNames(value).length !== Object.keys(value).length + (Array.isArray(value) ? 1 : 0)) {
      fail('Non-JSON keys are not supported.');
    }
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = new Array(value.length);
      for (let i = 0; i < value.length; i += 1) {
        if (own(value, i)) result[i] = cloneJson(dataAt(value, String(i)), seen);
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
          parts.push(encode(dataAt(item, String(i))));
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
      dataAt(value, key);
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
    if (!validKey(key)) return false;
    if (value === null) return true;
    if (key.startsWith('empire.fleetTargets.')) return integer(value, 0, 1000000);
    const system = EMPIRE_SYSTEM_KEY.exec(key);
    if (system) return system[2] === 'role' ? EMPIRE_ROLES.has(value) : typeof value === 'boolean';
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
    if (!isRecord(value)) fail(`${label} must be an object.`);
    exactKeys(value, Object.keys(value), label);
    const clean = {};
    for (const key of Object.keys(value)) {
      if (!validKey(key)) fail(`${label} contains an unknown or unsafe key.`);
      const item = copy(value[key]);
      checkedCanonical(item);
      if (!validRegisterValue(key, item)) fail(`${label} contains an invalid value for ${key}.`);
      define(clean, key, item);
    }
    checkEmpireSystems(clean);
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
      if (PROTOTYPE_KEYS.has(key) || !validKey(key)) fail('Sync document contains an unknown or unsafe field key.');
      const entry = document.fields[key];
      exactKeys(entry, ['stamp', 'value'], 'Sync field');
      if (!validStamp(entry.stamp)) fail('Sync document contains an invalid stamp.');
      const value = copy(entry.value);
      if (!validRegisterValue(key, value)) fail(`Sync document contains an invalid value for ${key}.`);
      checkedCanonical(value);
      define(fields, key, { stamp: [...entry.stamp], value });
    }
    checkEmpireSystems(fields);
    const clean = { format: FORMAT, schemaVersion: SCHEMA_VERSION, scope, fields };
    checkSize(clean);
    return clean;
  }
  function validateState(state, scope) {
    if (state === null || state === undefined) return { document: null, observed: {} };
    exactKeys(state, ['document', 'observed'], 'Sync state');
    const document = validateDocument(state.document, scope);
    const observed = validateFlat(state.observed, 'Observed values');
    checkEmpireSystems(document.fields, observed);
    checkSize({ document, observed });
    return { document, observed };
  }

  function pick(object, key) { return isRecord(object) && own(object, key) ? dataAt(object, key) : null; }
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

  // The envelope is account-bound. Names, the global actuator switch and all runtime
  // data remain local; only the explicit per-field policy below reaches the wire.
  function empireConfig(backup) {
    const empire = pick(backup, 'empire');
    if (empire === null) return null;
    if (!isRecord(empire)) fail('Empire backup must be an object.');
    exactKeys(empire, Object.keys(empire), 'Empire backup');
    const scope = pick(backup, 'profile');
    if (!scopeValid(scope) || pick(empire, 'scope') !== scope) fail('Empire backup scope does not match its profile.');
    const config = pick(empire, 'config');
    if (!isRecord(config)) fail('Empire config must be an object.');
    exactKeys(config, Object.keys(config), 'Empire config');
    if (pick(config, 'schemaVersion') !== 1) fail('Unsupported empire config schema.');
    if (own(config, 'enabled') && typeof pick(config, 'enabled') !== 'boolean') fail('Empire enabled must be a boolean.');
    const rawTargets = own(config, 'fleetTargets') ? pick(config, 'fleetTargets') : {};
    if (!isRecord(rawTargets)) fail('Empire fleet targets must be an object.');
    exactKeys(rawTargets, Object.keys(rawTargets), 'Empire fleet targets');
    const targets = {};
    for (const id of SHIPS) {
      const target = own(rawTargets, id) ? pick(rawTargets, id) : 0;
      if (!integer(target, 0, 1000000)) fail(`Empire fleet target ${id} is invalid.`);
      define(targets, id, target);
    }
    const rawSystems = own(config, 'systems') ? pick(config, 'systems') : {};
    if (!isRecord(rawSystems)) fail('Empire systems must be an object.');
    exactKeys(rawSystems, Object.keys(rawSystems), 'Empire systems');
    if (Object.keys(rawSystems).length > MAX_EMPIRE_SYSTEMS) fail('Empire exceeds the 1024 systems limit.');
    const systems = {};
    for (const key of Object.keys(rawSystems)) {
      if (!UUID.test(key)) fail('Empire contains an invalid system UUID.');
      const id = key.toLowerCase();
      if (own(systems, id)) fail('Empire contains colliding system UUIDs.');
      const row = pick(rawSystems, key);
      if (!isRecord(row)) fail('Empire system must be an object.');
      exactKeys(row, Object.keys(row), 'Empire system');
      const role = own(row, 'role') ? pick(row, 'role') : 'balanced';
      const enabled = own(row, 'enabled') ? pick(row, 'enabled') : false;
      if (!EMPIRE_ROLES.has(role) || typeof enabled !== 'boolean') fail('Empire system policy is invalid.');
      define(systems, id, { row, role, enabled });
    }
    return { config, scope, targets, systems };
  }

  function projectEmpire(backup, result) {
    const empire = empireConfig(backup);
    // A not-yet-mounted runtime is not an intentional deletion. A present config
    // always projects all four targets, even when its systems map is empty.
    if (!empire) return;
    for (const id of SHIPS) define(result, `empire.fleetTargets.${id}`, empire.targets[id]);
    for (const [id, row] of Object.entries(empire.systems)) {
      define(result, `empire.systems.${id}.role`, row.role);
      define(result, `empire.systems.${id}.enabled`, row.enabled);
    }
  }

  function overlayEmpire(backup, incoming) {
    const keys = Object.keys(incoming).filter(empireKey);
    if (!keys.length) return;
    if (!scopeValid(pick(backup, 'profile'))) fail('Empire backup requires a valid profile scope.');
    const local = empireConfig(backup);
    let config;
    if (local) {
      config = local.config;
      define(config, 'fleetTargets', copy(local.targets));
      const systems = {};
      for (const [id, { row, role, enabled }] of Object.entries(local.systems)) {
        define(systems, id, { ...row, role, enabled });
      }
      define(config, 'systems', systems);
      if (!own(config, 'enabled')) define(config, 'enabled', false);
    } else {
      config = { schemaVersion: 1, enabled: false,
        fleetTargets: Object.fromEntries(SHIPS.map(id => [id, 0])), systems: {} };
      define(backup, 'empire', { scope: pick(backup, 'profile'), config });
    }
    for (const key of keys) {
      const value = incoming[key];
      const match = EMPIRE_SYSTEM_KEY.exec(key);
      if (match) {
        const [, id, field] = match;
        if (!own(config.systems, id)) define(config.systems, id, { name: '', role: 'balanced', enabled: false });
        define(config.systems[id], field, value === null ? (field === 'role' ? 'balanced' : false) : value);
      } else {
        define(config.fleetTargets, key.slice('empire.fleetTargets.'.length), value === null ? 0 : value);
      }
    }
    if (Object.keys(config.systems).length > MAX_EMPIRE_SYSTEMS) fail('Empire exceeds the 1024 systems limit.');
  }

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
    projectEmpire(backup, result);
    return copy(result);
  }

  function overlay(backup, values) {
    if (!isRecord(backup)) fail('Backup must be an object.');
    const incoming = validateFlat(values);
    const result = copy(backup);
    overlayEmpire(result, incoming);
    for (const [key, value] of Object.entries(incoming)) {
      if (empireKey(key)) continue;
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
    const actor = pick(options, 'actor');
    const scope = pick(options, 'scope');
    if (!actorValid(actor)) fail('Invalid sync actor.');
    if (!scopeValid(scope)) fail('Invalid sync scope.');
    const now = !own(options, 'now') || pick(options, 'now') === undefined ? () => Date.now() : pick(options, 'now');
    if (typeof now !== 'function') fail('now must be a function.');
    const loaded = validateState(own(options, 'state') ? pick(options, 'state') : null, scope);
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
    function transaction(action) {
      const before = { fields, observed, lastMs, lastCounter };
      fields = copy(fields); observed = copy(observed);
      try {
        action();
        checkEmpireSystems(fields, observed);
        const result = makeDocument();
        checkSize({ document: result, observed });
        return result;
      } catch (error) {
        ({ fields, observed, lastMs, lastCounter } = before);
        throw error;
      }
    }
    function capture(flatValues) {
      const incoming = validateFlat(flatValues);
      const hasEmpire = Object.keys(incoming).some(empireKey);
      return transaction(() => {
        const allKeys = new Set([...Object.keys(incoming), ...Object.keys(observed)]);
        for (const key of [...allKeys].sort()) {
          if (!hasEmpire && empireKey(key)) continue;
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
      });
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
      checkEmpireSystems(nextFields, observed);
      checkSize({ document: candidate, observed });
      fields = nextFields;
      for (const entry of Object.values(fields)) {
        const [ms, counter] = entry.stamp;
        if (ms > lastMs || (ms === lastMs && counter > lastCounter)) { lastMs = ms; lastCounter = counter; }
      }
      return copy(candidate);
    }
    function accept(flatValues) {
      const incoming = validateFlat(flatValues, 'Accepted values');
      if (!Object.keys(incoming).some(empireKey)) {
        for (const key of Object.keys(observed).filter(empireKey)) define(incoming, key, copy(observed[key]));
      }
      checkEmpireSystems(fields, incoming);
      checkSize({ document: makeDocument(), observed: incoming });
      observed = incoming;
      return copy(observed);
    }
    function promoteSeeds() {
      return transaction(() => {
        for (const key of Object.keys(fields).sort()) {
          if (fields[key].stamp[0] === 0 && fields[key].stamp[1] === 0) write(key, fields[key].value);
        }
      });
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
