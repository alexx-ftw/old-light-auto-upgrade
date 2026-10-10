// ==UserScript==
// @name         Old Light Auto Upgrade
// @namespace    old-light-auto-upgrade
// @version      1.5.0
// @description  Mejoras por prioridad, mínimos de naves, presets y misiones pendientes, objetivos de nivel, informes y avisos, autoguardado y copias locales/Drive. Con actualización automática.
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

(() => {
  'use strict';

  // Usa los controles normales del juego, con Structures o Shipyard abierto.
  // Las mejoras actúan sobre la selección; los mínimos requieren un solo sistema.
  // Ambos paneles se actualizan aunque uno de sus tabs internos esté oculto.
  // Nunca elimina hidden/disabled; la construcción usa los controles nativos.
  // Los informes se consultan mediante GET, sin marcarlos como leídos.

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
  const MAX_NUMERIC_DRAFT_LENGTH = 32;
  const NUMERIC_DEBOUNCE_MS = 400;
  const MIN_GAP_MS = 500;
  const RESPONSE_TIMEOUT_MS = 12000;
  const RETRY_GAP_MS = 5000;
  const MAX_UNCONFIRMED = 3;

  if (window.top !== window.self || document.getElementById(HOST_ID)) return;

  let settings = readSettings();
  let missionAdapter = null;
  let fleetWait = null;
  let missionTargetResolver = null;
  const shiftPresets = createShiftPresetMenu({
    isEnabled: () => settings.shiftPresetShortcut && !missionAdapter?.isBusy(), onPreset: offerPresetMission,
    readPresetCache: readMissionPresetCache, savePresetCache: saveMissionPresetCache,
    canUseEmptyFleet: () => missionContext().selectionCount === 1 && SHIPS.every(([id]) => fleetCounts(id)?.parked === 0),
    captureEmptyTarget: (button, quantities, key) => missionAdapter?.captureRadial(button, quantities, key),
    onEmptyPreset: offerEmptyPresetMission });
  const notifier = createNotifier({ onSettingsChange: settingsChanged });
  const levelTargets = createLevelTargets({ buildings: BUILDINGS, send: event => notifier.emit(event),
    canNotify: () => notifier.isEventEnabled('game.level_target'),
    getSnapshot: () => readLevelTargetSnapshot(rows()), onSettingsChange: settingsChanged });
  const reports = createReportsWatcher({ send: event => notifier.emit(event) });
  let driveBackup = null;
  let importingBackup = false;
  const notificationSession = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let eventSequence = 0;
  const observeGameEvents = createGameEventObserver(emitEvent);
  let host;
  let ui;
  let pending = null;
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
    canAct: canOperateMission, onBusyChange: schedule, onChange: schedule,
    resolveTarget: (job, options) => missionTargetResolver.resolveTarget(job, options) });
  fleetWait = createFleetWaitQueue({
    getContext: missionQueueContext, getFleet: currentMissionFleet,
    dispatch: async job => {
      const result = await missionAdapter.dispatch(job);
      if (result.status === 'sent') emitEvent('request.sent',
        `Misión enviada: ${job.originName} → ${job.target.label}. ` + SHIPS.filter(([id]) => job.quantities[id] > 0)
          .map(([id, name]) => `${job.quantities[id]} ${name}`).join(' · '), `mission:${job.id}`, job.originName);
      else if (result.status === 'uncertain') emitEvent('request.unconfirmed',
        `No se ha podido confirmar la misión a ${job.target.label}. Comprueba las misiones del juego.`,
        `mission-uncertain:${job.id}`, job.originName);
      return result;
    },
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

  function normalizeSettings(value) {
      return {
        enabled: value?.enabled !== false,
        excluded: Array.isArray(value?.excluded)
          ? [...new Set(value.excluded.filter(id => DEFAULT_ORDER.includes(id)))] : [],
        order: normalizeOrder(value?.order),
        expanded: value?.expanded === true,
        minimized: value?.minimized === true,
        panelPosition: normalizePanelPosition(value?.panelPosition),
        activeTab: ['buildings', 'fleet', 'notifications', 'data'].includes(value?.activeTab) ? value.activeTab : 'buildings',
        conditionsExpanded: value?.conditionsExpanded !== false,
        shipMinimums: Object.fromEntries(SHIPS.map(([id]) => [id, normalizeMinimum(value?.shipMinimums?.[id])])),
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
    if (!importingBackup) driveBackup?.notifyChanged?.();
  }

  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {
      // El script sigue funcionando si el navegador bloquea el almacenamiento.
      return false;
    }
    try { settingsChanged(); } catch { /* El guardado local no depende de Drive. */ }
    return true;
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

  function controlVisible(node, panelSelector) {
    if (isVisible(node)) return true;
    const panel = node?.closest(panelSelector);
    // La única excepción es hidden en el tab interno inactivo del juego.
    if (!panel?.hidden || ![PANEL, FLEET_PANEL].some(selector => isVisible(document.querySelector(selector)))) return false;
    if (!isVisible(panel.parentElement)) return false;
    for (let item = node; item && item !== panel.parentElement; item = item.parentElement) {
      const style = getComputedStyle(item);
      if (item.matches('[inert], [aria-hidden="true"]') || style.visibility !== 'visible' ||
          (item !== panel && (item.hidden || style.display === 'none'))) return false;
    }
    return true;
  }

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

  function prepareShip(row, deficit) {
    if (row.row.classList.contains('ship-row-locked') ||
        row.button.classList.contains('b-upgrade-error') ||
        !controlVisible(row.input, FLEET_PANEL) || row.input.matches(':disabled') ||
        document.activeElement === row.input) return 0;
    const maximum = exactInteger(row.input.max) || 1;
    const currentQuantity = Math.max(1, Math.min(maximum, Math.floor(Number(row.input.value)) || 1));
    let quantity = Math.min(deficit, maximum);
    const pa = displayedInteger(document.querySelector('[data-field="res-palladium"]'));
    const ir = displayedInteger(document.querySelector('[data-field="res-iridium"]'));
    const costPa = displayedInteger(row.row.querySelector('.ship-cost .b-cost-pa'));
    const costIr = displayedInteger(row.row.querySelector('.ship-cost .b-cost-ir'));
    if ([pa, ir, costPa, costIr].every(value => value !== null)) {
      // Los costes mostrados son del lote entero, no de una sola nave.
      const perPa = Math.ceil(costPa / currentQuantity);
      const perIr = Math.ceil(costIr / currentQuantity);
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
          :host { all:initial; position:fixed; right:12px; bottom:12px;
            z-index:2147483000; color-scheme:dark; font:12px/1.45 system-ui,sans-serif; }
          :host([hidden]) { display:none !important; }
          * { box-sizing:border-box; }
          .helper-shell { width:300px; max-width:calc(100vw - 24px); max-height:calc(100dvh - 24px);
            overflow-y:auto; padding:11px 12px;
            color:#d8e5ef; background:#101923; border:1px solid #40566b;
            border-radius:10px; box-shadow:0 5px 24px #0005; }
          header { display:flex; align-items:center; justify-content:space-between; gap:7px;
            position:sticky; top:0; z-index:2; background:#101923; cursor:grab; touch-action:none; user-select:none; }
          header::before { content:''; position:absolute; inset:-12px -12px -3px;
            background:#101923; z-index:-1; pointer-events:none; }
          header.is-dragging { cursor:grabbing; }
          .helper-title { display:flex; align-items:center; gap:5px; flex:1; min-width:0; }
          .helper-grip { color:#8298aa; font-size:16px; }
          .helper-minimize { width:27px; height:27px; padding:0; color:#b8cddd;
            background:#1c2a36; border-color:#40576b; flex-shrink:0; }
          .helper-shell.minimized { width:210px; padding:7px 9px; overflow:hidden; }
          .helper-shell.minimized > :not(header) { display:none !important; }
          strong { color:#f2f7fa; font-size:13px; }
          button { font:inherit; cursor:pointer; color:#9ce9b9; background:#21382c;
            border:1px solid #426a51; border-radius:6px; padding:3px 9px; }
          button[aria-pressed="false"] { color:#cbd5df; background:#263340; border-color:#566575; }
          button:disabled { opacity:.35; cursor:default; }
          button:focus-visible, summary:focus-visible, input:focus-visible { outline:2px solid #8cc8ff; outline-offset:3px; }
          p { margin:8px 0 0; overflow-wrap:anywhere; }
          small { display:block; color:#93a9bb; margin-top:5px; overflow-wrap:anywhere; }
          small:empty { display:none; }
          details { margin-top:8px; border-top:1px solid #304252; padding-top:7px; }
          summary { cursor:pointer; color:#aebfd0; }
          .choices { display:grid; gap:5px; padding-top:8px; }
          .priority-row { display:grid; grid-template-columns:27px 12px minmax(0,1fr) auto;
            align-items:center; gap:6px; }
          .priority-drag { width:27px; height:27px; padding:0; color:#92a9bc; background:transparent;
            border-color:transparent; font-size:17px; cursor:grab; touch-action:none; user-select:none; }
          .priority-drag:hover { border-color:#40576b; background:#1c2a36; }
          .priority-row.is-dragging { opacity:.5; background:#253b4b; border-radius:4px; }
          .priority-row.drop-before { box-shadow:0 -2px 0 #80ccab; }
          .priority-row.drop-after { box-shadow:0 2px 0 #80ccab; }
          .choices.is-sorting, .choices.is-sorting .priority-drag { cursor:grabbing; }
          .settings-tabs { display:flex; gap:4px; margin-top:10px; padding:3px; border-radius:7px; background:#09121b; }
          .settings-tabs button { flex:1; min-width:0; padding:5px 3px; border-color:transparent;
            color:#92a9bc; background:transparent; font-size:11px; }
          .settings-tabs button[aria-selected="true"] { color:#def6e8; background:#254235; border-color:#446c56; }
          .settings-page { margin-top:10px; padding-top:0; border-top:0; }
          .settings-page[hidden] { display:none !important; }
          .settings-page > summary, .settings-page > .notifications-details > summary { display:none; }
          .settings-page > .notifications-details { margin-top:0; padding-top:0; border-top:0; }
          .page-intro { margin:0 0 6px; color:#aebfd0; font-size:11px; }
          .conditions-details { padding:8px; border:1px solid #304252; border-radius:6px; background:#15222d; }
          .backup-actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin:10px 0; }
          .backup-actions button { padding:8px 5px; color:#d8e5ef; background:#23344d; border-color:#52657f; }
          .backup-status { white-space:pre-line; font-size:11px; color:#aebfd0; }
          .backup-card { border:1px solid #304252; border-radius:6px; padding:9px; }
          .oldlight-drive-config { margin-top:10px; padding:9px; border:1px solid #304252; border-radius:6px; }
          .oldlight-drive-config h4 { margin:0 0 8px; font-size:13px; color:#f2f7fa; }
          .oldlight-drive-config label { margin-top:8px; font-size:11px; }
          .oldlight-drive-config .drive-advanced label { display:grid; gap:5px; }
          .oldlight-drive-config input[type="text"] { width:100%; min-width:0; padding:7px;
            font:inherit; color:#e1edf4; background:#172632; border:1px solid #40576b; border-radius:5px; }
          .oldlight-drive-config p { font-size:11px; color:#aebfd0; }
          .oldlight-drive-controls { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
          .oldlight-drive-controls button { padding:6px; flex:1; }
          .oldlight-drive-controls button:first-child { flex-basis:100%; }
          .backup-help { display:inline-block; margin-top:8px; font-size:11px; color:#8cc8ff; }
          .priority-position { color:#8298aa; text-align:right; font-variant-numeric:tabular-nums; }
          .priority-actions { display:flex; gap:3px; }
          .priority-actions button { width:27px; height:27px; padding:0; color:#b8cddd;
            background:#1c2a36; border-color:#40576b; }
          label { display:flex; align-items:center; gap:7px; cursor:pointer; min-width:0; }
          input { accent-color:#80ccab; margin:0; flex-shrink:0; }
          .reset-order, .reset-ships { margin-top:8px; color:#aebfd0; background:transparent;
            border-color:#40576b; font-size:11px; }
          .fleet-choices { display:grid; gap:8px; margin-top:9px; }
          .fleet-row { display:grid; grid-template-columns:12px minmax(0,1fr) 66px auto;
            gap:4px 6px; align-items:center; }
          .fleet-row input { width:66px; min-width:0; padding:4px; font:inherit;
            border:1px solid #40576b; border-radius:5px; background:#172632; color:#e1edf4; }
          .fleet-counts { grid-column:2 / -1; color:#93a9bb; font-size:11px; }
          .count-away { margin-top:10px; font-size:11px; }
          .fleet-shortcut { margin-top:12px; padding-top:10px; border-top:1px solid #304252; font-size:11px; }
          .depot-threshold { display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; font-size:11px; }
          .depot-threshold input { width:51px; padding:3px; border:1px solid #40576b;
            border-radius:5px; color:#e1edf4; background:#172632; font:inherit; }
          .numeric-autosave { grid-column:2 / -1; margin-top:3px; font-size:10px; line-height:1.35; }
          .hint { color:#8298aa; font-size:11px; margin-top:8px; }
        </style>
        <section class="helper-shell" aria-label="Mejoras automáticas de Old Light">
          <header title="Arrastra la cabecera para mover el helper">
            <strong class="helper-title"><span class="helper-grip" aria-hidden="true">⠿</span>Auto ↑</strong>
            <button type="button" data-action="automation-toggle" aria-pressed="true"></button>
            <button type="button" class="helper-minimize" data-action="helper-minimize" aria-expanded="true" aria-label="Minimizar helper" title="Minimizar helper">−</button>
          </header>
          <p role="status"></p><small></small>
          <nav class="settings-tabs" role="tablist" aria-label="Ajustes del helper">
            <button type="button" role="tab" id="oldlight-tab-buildings" data-settings-tab="buildings" aria-controls="oldlight-settings-buildings" aria-selected="true">Edificios</button>
            <button type="button" role="tab" id="oldlight-tab-fleet" data-settings-tab="fleet" aria-controls="oldlight-settings-fleet" aria-selected="false" tabindex="-1">Flota</button>
            <button type="button" role="tab" id="oldlight-tab-notifications" data-settings-tab="notifications" aria-controls="oldlight-settings-notifications" aria-selected="false" tabindex="-1">Avisos</button>
            <button type="button" role="tab" id="oldlight-tab-data" data-settings-tab="data" aria-controls="oldlight-settings-data" aria-selected="false" tabindex="-1">Datos</button>
          </nav>
          <details class="settings-page building-page" data-page="buildings" id="oldlight-settings-buildings" role="tabpanel" aria-labelledby="oldlight-tab-buildings" open><summary>Edificios</summary>
            <p class="page-intro">Marca qué mejorar y ordena sus prioridades.</p>
            <div class="choices" role="list" aria-label="Prioridad de edificios"></div>
            <button type="button" class="reset-order">Restablecer orden</button>
            <p class="hint">Arrastra el asa ⠿ o usa ↑ / ↓. Se mejora el primero disponible entre los marcados.</p>
            <details class="conditions-details" open><summary>Condiciones de construcción</summary>
              <p class="hint">Reactor solo si otra mejora marcada necesita más energía. Cada Reactor o Depot espera al anterior en cola.</p>
              <label class="depot-threshold">Depot al alcanzar <input type="text" inputmode="numeric" maxlength="32"
                data-setting="depot-fill-percent" aria-label="Porcentaje de capacidad para mejorar Resource Depot" aria-describedby="depot-numeric-status">% de capacidad</label>
              <small class="numeric-autosave" id="depot-numeric-status" data-numeric-status="depot" aria-live="polite"></small>
            </details>
            <div data-field="level-targets"></div>
          </details>
          <details class="settings-page fleet-details" data-page="fleet" id="oldlight-settings-fleet" role="tabpanel" aria-labelledby="oldlight-tab-fleet" open hidden><summary>Mínimos de naves</summary>
            <p class="page-intro">Mínimo por tipo en el sistema seleccionado. 0 desactiva su reposición.</p>
            <div class="fleet-choices" role="list" aria-label="Mínimos y prioridad de naves"></div>
            <label class="count-away"><input type="checkbox">Contar también las naves en misión</label>
            <button type="button" class="reset-ships">Restablecer orden de naves</button>
            <p class="hint">Se descuentan las naves ya en construcción. La reposición disponible tiene prioridad sobre las mejoras.</p>
            <div data-field="fleet-wait"></div>
            <div class="fleet-shortcut">
              <label><input type="checkbox" data-setting="shift-preset-shortcut">Shift + clic: mostrar presets de flota</label>
              <p class="hint">Los presets aparecen junto al menú circular del hexágono. Un clic envía el preset completo; si faltan naves, puedes esperar o encargar su producción. Desactiva este atajo para usar la multiselección con Shift.</p>
            </div>
          </details>
          <div class="settings-page" data-page="notifications" id="oldlight-settings-notifications" role="tabpanel" aria-labelledby="oldlight-tab-notifications" hidden></div>
          <div class="settings-page" data-page="data" id="oldlight-settings-data" role="tabpanel" aria-labelledby="oldlight-tab-data" hidden>
            <div class="backup-card">
              <strong>Copia local</strong>
              <p class="page-intro">La configuración y la posición del helper se guardan automáticamente en este navegador.</p>
              <div class="backup-actions">
                <button type="button" data-action="export-settings">Exportar todo</button>
                <button type="button" data-action="choose-import-settings">Importar copia</button>
              </div>
              <input type="file" data-action="import-settings" accept=".json,application/json" hidden>
              <p class="hint">El archivo incluye prioridades, mínimos, panel, filtros y las credenciales guardadas de Telegram. Importar sustituye esos ajustes.</p>
              <p class="backup-status" data-field="backup-status" role="status" aria-live="polite"></p>
            </div>
            <div data-field="drive-backup"></div>
          </div>
        </section>`;
      ui = {
        section: shadow.querySelector('section'),
        header: shadow.querySelector('header'),
        minimize: shadow.querySelector('[data-action="helper-minimize"]'),
        toggle: shadow.querySelector('[data-action="automation-toggle"]'),
        status: shadow.querySelector('[role="status"]'),
        last: shadow.querySelector('small'),
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
        label.append(input, document.createTextNode(name));
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
        ui.items.set(id, { item, position, input, up, down, drag, name });
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
        const status = document.createElement('small');
        status.className = 'numeric-autosave';
        status.dataset.numericStatus = id;
        status.id = `minimum-${id}-status`;
        status.setAttribute('aria-live', 'polite');
        input.setAttribute('aria-describedby', status.id);
        item.append(position, label, input, actions, counts, status);
        ui.fleetChoices.append(item);
        ui.shipItems.set(id, { item, position, input, up, down, counts });
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
        settings.minimized = !settings.minimized;
        layoutHelper();
        saveSettings();
        schedule();
      });
      installHelperDragging();
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
          settings.activeTab = tab.dataset.settingsTab;
          syncSettingsTabs();
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
      ui.notificationContainer.append(ui.reportsStatus);
      const notificationDetails = ui.notificationContainer.querySelector('.notifications-details');
      if (notificationDetails) notificationDetails.open = true;
      syncSettingsTabs();
    }
    document.body.append(host);
    layoutHelper();
  }

  function createBackup() {
    return {
      format: 'old-light-auto-upgrade-backup',
      schemaVersion: 1,
      scriptVersion: '1.5.0',
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(settings),
      notifications: notifier.exportConfig(),
      levelTargets: levelTargets.exportConfig(),
      fleetMissions: fleetWait.exportConfig(),
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
        || (next.presetCatalog !== undefined && !validPresetCatalog(next.presetCatalog))
        || (next.panelPosition != null && !normalizePanelPosition(next.panelPosition))
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
    return { settings: normalizeSettings(next), notifications, drive, levelTargets: targets, fleetMissions: missions };
  }

  function applyBackup(value) {
    if (missionAdapter.isBusy()) throw backupError('Espera a que termine el intento de envío antes de importar una copia.');
    const next = validateBackup(value);
    shiftPresets.cancel();
    cancelNumericDraftTimers();
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    const previous = { settings, raw: localStorage.getItem(KEY), notifications: notifier.exportConfig(),
      drive: driveBackup?.exportConfig?.(), levelTargets: levelTargets.exportConfig(), fleetMissionsCheckpoint: fleetWait.backupCheckpoint() };
    importingBackup = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(next.settings));
      notifier.importConfig(next.notifications);
      levelTargets.importConfig(next.levelTargets);
      if (driveBackup) driveBackup.importConfig(next.drive);
      fleetWait.importConfig(next.fleetMissions);
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
      schedule();
    }
    settingsChanged();
    return true;
  }

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
  }

  function layoutHelper() {
    if (!ui || !host?.isConnected) return;
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

  function installPriorityDragging() {
    const clearMarkers = () => {
      ui.choices.classList.remove('is-sorting');
      for (const { item } of ui.items.values()) item.classList.remove('is-dragging', 'drop-before', 'drop-after');
    };
    ui.cancelPriorityDrag = bindPointerDrag(ui.choices, {
      start(event) {
        const handle = event.target.closest('[data-action="priority-drag"]');
        if (!handle) return null;
        ui.cancelPanelDrag?.();
        handle.focus({ preventScroll: true });
        const id = handle.closest('[data-building-id]').dataset.buildingId;
        return { id, startY: event.clientY, order: [...settings.order], index: settings.order.indexOf(id) };
      },
      move(state, event) {
        if (state.order.join() !== settings.order.join()) { ui.cancelPriorityDrag(); return; }
        if (!state.moved && Math.abs(event.clientY - state.startY) < 4) return;
        state.moved = true;
        const section = ui.section.getBoundingClientRect();
        if (event.clientY < section.top + 45) ui.section.scrollTop -= 18;
        else if (event.clientY > section.bottom - 30) ui.section.scrollTop += 18;
        const others = state.order.filter(id => id !== state.id);
        const before = others.findIndex(id => {
          const rect = ui.items.get(id).item.getBoundingClientRect();
          return event.clientY < rect.top + rect.height / 2;
        });
        state.index = before < 0 ? others.length : before;
        clearMarkers();
        ui.choices.classList.add('is-sorting');
        ui.items.get(state.id).item.classList.add('is-dragging');
        if (before < 0) ui.items.get(others.at(-1)).item.classList.add('drop-after');
        else ui.items.get(others[before]).item.classList.add('drop-before');
      },
      end(state, commit, event) {
        clearMarkers();
        const rect = ui.choices.getBoundingClientRect();
        const section = ui.section.getBoundingClientRect();
        const inside = event && event.clientX >= rect.left - 24 && event.clientX <= rect.right + 24
          && event.clientY >= section.top && event.clientY <= section.bottom;
        if (!commit || !state.moved || !inside || state.order.join() !== settings.order.join()) return;
        const order = state.order.filter(id => id !== state.id);
        order.splice(state.index, 0, state.id);
        if (order.join() === settings.order.join()) return;
        settings.order = order;
        saveSettings();
        notifyPriorityOrder();
        syncChoices();
        ui.items.get(state.id).drag.focus({ preventScroll: true });
        schedule();
      },
    });
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
    // Mantén el foco en el edificio movido, incluso al llegar a un extremo.
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
      setText(controls.counts, counts
        ? `${counts.parked.toLocaleString()} en base · ${counts.away.toLocaleString()} en misión · +${counts.building.toLocaleString()} en cola`
        : 'Selecciona un solo sistema para leer la flota');
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
    for (const [index, id] of settings.order.entries()) {
      const controls = ui.items.get(id);
      const atPosition = ui.choices.children[index];
      // Solo mueve nodos cuando cambie el orden, sin reconstruir los controles.
      if (atPosition !== controls.item) ui.choices.insertBefore(controls.item, atPosition || null);
      setText(controls.position, String(index + 1));
      controls.input.checked = !settings.excluded.includes(id);
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
    setText(ui.toggle, settings.enabled ? 'Activo' : 'Pausado');
    ui.toggle.setAttribute('aria-pressed', String(settings.enabled));
    ui.toggle.title = settings.enabled ? 'Pausar automatización' : 'Reanudar automatización';
    setText(ui.status, message);
    setText(ui.last, lastClick ? `Último clic: ${lastClick}` : '');
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
    if (pending || observingNotifications || missionAdapter?.isBusy()) return;
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
      reports.tick({ active: false, enabled: notifier.isEventEnabled('game.reports') });
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
      (isVisible(panel) || isVisible(fleetPanel));
    observingNotifications = observeNotifications;
    if (observeNotifications) acquireLeadership();
    const reportsState = reports.tick({ active: leader && observeNotifications,
      enabled: notifier.isEventEnabled('game.reports'), unread: readUnread('reports') });
    setText(ui.reportsStatus, reportsState.status);
    observeGameEvents(current, leader && observeNotifications, reportsState.apiAvailable);

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
      if (!observeNotifications) releaseLeadership();
      show(error || 'Automatización pausada'); return;
    }
    if (document.hidden) {
      releaseLeadership();
      show('Esperando datos actuales en una pestaña visible del juego');
      return;
    }
    if (!isVisible(panel) && !isVisible(fleetPanel)) {
      releaseLeadership(); show('Abre Structures o Shipyard para continuar'); return;
    }
    if (!current.length && !ships.length) { releaseLeadership(); show('Selecciona uno de tus sistemas'); return; }
    const maintainFleet = fleetEnabled();
    const waitingMission = currentMissionJob();
    const hasWaitingMission = waitingMission?.status === 'waiting';
    if (settings.excluded.length === BUILDINGS.length && !maintainFleet && !hasWaitingMission) {
      if (observeNotifications) acquireLeadership(); else releaseLeadership();
      show('Marca un edificio o configura un mínimo de naves'); return;
    }
    acquireLeadership();
    if (!leader) {
      show(lockError ? 'No se pudo coordinar esta pestaña. Recarga para reintentar.' : 'Esperando control de esta pestaña');
      return;
    }
    if (missionAdapter.isBusy()) { show('Preparando la misión pendiente…'); return; }
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

    let fleetNotice = '';
    let fleetCandidate = null;
    const activeSystem = systemId();
    if (maintainFleet || hasWaitingMission) {
      const fleet = new Map(settings.shipOrder.map(id => [id, fleetCounts(id)]));
      const missionDemand = fleetWait.productionDemand(missionQueueContext(), fleet);
      const needed = (id, counts) => Math.max(maintainFleet ? fleetDeficit(id, counts) : 0, missionDemand?.[id] || 0);
      const unknown = !activeSystem || settings.shipOrder.some(id =>
        (settings.shipMinimums[id] > 0 || hasWaitingMission) && !fleet.get(id));
      const full = document.querySelector('[data-field="garrison"].active-garrison-chip--full');
      if (unknown) {
        fleetNotice = 'Naves: selecciona un solo sistema con recuentos disponibles';
      } else if (full && isVisible(full)) {
        fleetNotice = 'Naves: esperando espacio en los muelles';
      } else {
        const byId = new Map(ships.map(row => [row.id, row]));
        for (const id of settings.shipOrder) {
          if (!settings.shipMinimums[id] && !missionDemand?.[id]) continue;
          const counts = fleet.get(id);
          const deficit = needed(id, counts);
          if (deficit === 0) continue;
          fleetNotice = 'Naves: esperando recursos, desbloqueo o hueco en la cola';
          const row = byId.get(id);
          const quantity = row ? prepareShip(row, deficit) : 0;
          if (!quantity) continue;
          const latest = fleetCounts(id);
          const latestDemand = fleetWait.productionDemand(missionQueueContext(), currentMissionFleet());
          const latestNeed = latest ? Math.max(maintainFleet ? fleetDeficit(id, latest) : 0, latestDemand?.[id] || 0) : 0;
          if (activeSystem !== systemId() || !latest || latestNeed < quantity) break;
          fleetCandidate = { ...row, kind: 'ship', quantity, system: activeSystem,
            fleetTotal: fleetTotal(latest), building: latest.building, batches: shipBatches(id),
            feedbackLine: shipFeedbackLine(), target: `×${quantity}` };
          break;
        }
        if (!fleetNotice) fleetNotice = 'Mínimos de naves cubiertos o ya en construcción';
      }
    }

    const candidate = fleetCandidate || selectBuilding(current);
    if (!candidate) { show(fleetNotice || 'Esperando recursos o hueco en la cola…'); return; }

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
        item.textContent = record.label;
        item.disabled = record.locked || pending;
        item.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation(); choosePreset(current, record);
        });
        return item;
      });
      current.list.replaceChildren(...current.items);
      current.note.textContent = pending ? 'Cargando presets…' : current.emptyMessage || (records.length
        ? current.emptyFleet ? 'Clic para preparar la espera o producción' : 'Clic para enviar'
        : current.emptyFleet ? 'Abre una vez los presets de flota con naves disponibles para recordarlos aquí.' : 'No hay presets guardados.');
      place(current);
      if (focused >= 0) current.items[focused]?.focus({ preventScroll: true });
    }
    function showMenu(current) {
      const host = document.createElement('div');
      host.id = MENU_ID;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>'
        + ':host{position:absolute;display:block;pointer-events:auto;width:192px;max-width:calc(100vw - 16px);'
        + 'box-sizing:border-box;border:1px solid #3c5368;border-radius:10px;background:#101b27;'
        + 'color:#e8f0f7;box-shadow:0 8px 24px #0009;font:12px/1.35 system-ui,sans-serif;padding:8px;z-index:1}'
        + '*{box-sizing:border-box}h2{margin:0 0 6px;font-size:11px;color:#aabfd0;font-weight:600}'
        + '[role=menu]{display:grid;gap:4px;max-height:240px;overflow:auto}'
        + 'button{font:inherit;color:inherit;text-align:left;border:1px solid transparent;border-radius:6px;'
        + 'background:#1c2e40;padding:7px 9px;cursor:pointer}button:hover,button:focus-visible{outline:0;'
        + 'border-color:#78b2dc;background:#28465d}button:disabled{opacity:.4;cursor:default}'
        + 'p{margin:6px 1px 0;color:#9fb5c7;font-size:10px}</style>'
        + '<h2>Presets de flota</h2><div role="menu" aria-label="Presets de flota"></div><p role="status"></p>';
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
    if (!value || !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '')
        || !requested || !point || !key || key.length > 2000
        || typeof routeSignature !== 'string' || routeSignature.length > 200000) return null;
    return { scope: value.scope, originId: value.originId.toLowerCase(),
      originName: clean(value.originName).slice(0, 400),
      target: { coordinate: point, routeKey: routeSignature, presetKey: key,
        label: clean(value.target.label).slice(0, 400) }, quantities: requested };
  }

  function signature(spec) {
    return JSON.stringify([spec.scope, spec.originId, spec.target.coordinate,
      spec.target.routeKey, spec.target.presetKey, spec.quantities]);
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
  function readyToAct() { try { return !destroyed && canAct() !== false; } catch (_) { return false; } }

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
      const abort = () => { clearTimeout(timer); reject(new Error(operation.reason || 'Preparación cancelada.')); };
      const timer = setTimeout(() => { operation.controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
      if (operation.controller.signal.aborted) abort();
      else operation.controller.signal.addEventListener('abort', abort, { once: true });
    });
  }

  function validOperation(operation) {
    return active === operation && !operation.controller.signal.aborted && readyToAct() && sameContext(operation.spec);
  }

  function assertOperation(operation) {
    if (!validOperation(operation)) throw new Error(operation.reason || 'El origen, la selección o el estado del helper ha cambiado.');
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
    if (!readyToAct()) return result('waiting', 'Esperando a que el helper pueda actuar.');
    if (!sameContext(spec)) return result('waiting', `Selecciona ${spec.originName || 'el sistema de origen'} para continuar esta misión.`);
    if (!enough(spec.quantities)) return result('waiting', 'Esperando a que todas las naves del preset estén en base.');
    let binding = attached.get(jobId);
    if (binding && signature(binding.spec) !== signature(spec)) return result('paused', 'La misión ha cambiado. Reconecta el preset y el destino antes de continuar.');
    if (!binding && typeof resolveTarget !== 'function') return result('paused', 'Misión guardada. Reconecta su destino con Shift + clic y el mismo preset para reanudarla.');
    if (document.querySelector('dialog[open]')) return result('waiting', 'Cierra los diálogos del juego para continuar la misión.');
    const operation = { job, jobId, spec, controller: new AbortController(), dialog: null,
      previousMask: null, confirmed: false, permitConfirm: false, keepDialog: false,
      closed: false, reason: '', guard: null };
    active = operation; busyChanged();
    let outcome;
    try {
      const action = await actionFor(operation, binding);
      // Let previously queued native close handlers finish before opening a new
      // dispatch session, otherwise they may clear the new native origin list.
      await delay(0, operation);
      assertOperation(operation);
      if (unavailable(action) || !enough(spec.quantities)) return outcome = result('waiting', 'El juego todavía no permite preparar la flota completa.');
      const dialog = nativeDialog();
      if (!dialog || document.querySelector('dialog[open]')) throw new Error('Hay otro diálogo del juego abierto. Se ha pausado la preparación.');
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
      const endpoint = columns(dialog)[1].querySelector('button.route-header-hex-clickable');
      if (unavailable(endpoint)) throw new Error('No se puede comprobar el destino del despacho.');
      const identity = maskedInspector(() => endpoint.click(), dialog);
      if (!sameCoordinate(identity.coordinate, spec.target.coordinate)) throw new Error('Las coordenadas del destino no coinciden con la misión.');
      assertOperation(operation);
      if (!enough(spec.quantities)) return outcome = result('waiting', 'Las naves disponibles han cambiado; se esperará al preset completo.');
      const preset = [...dialog.querySelectorAll('[data-field="dispatch-presets"] .dispatch-preset-apply')]
        .find(button => keyOf(button) === spec.target.presetKey && sameAmounts(presetAmounts(button), spec.quantities));
      const confirm = dialog.querySelector('[data-field="dispatch-confirm"]');
      if (unavailable(preset) || !(confirm instanceof HTMLButtonElement) || confirm.hidden) throw new Error('El preset guardado ya no está disponible. Vuelve a seleccionarlo.');
      operation.guard = event => {
        if (event.target !== confirm) return;
        if (operation.permitConfirm && !operation.confirmed) {
          operation.confirmed = true; attempted.add(claim); return;
        }
        event.preventDefault(); event.stopImmediatePropagation();
      };
      window.addEventListener('click', operation.guard, true);
      preset.click();
      assertOperation(operation);
      if (routeKey(dialog) !== openedRoute || !singleNativeRoute(dialog)) throw new Error('La ruta ha cambiado al aplicar el preset.');
      if (!enough(spec.quantities) || !inputsMatch(dialog, spec.quantities)) return outcome = result('waiting', 'El preset aún no está completo. Se esperará sin enviar una flota parcial.');
      const error = readError(dialog);
      if (confirm.disabled || error) { expose(operation); return outcome = result('paused', error || 'El juego no permite enviar esta misión. Revisa el despacho.'); }
      const onClose = () => { operation.closed = true; };
      dialog.addEventListener('close', onClose, { once: true, signal: operation.controller.signal });
      operation.permitConfirm = true;
      try { confirm.click(); } finally { operation.permitConfirm = false; }
      if (!operation.confirmed) throw new Error('El juego no aceptó el clic de envío.');
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
      return outcome = result('paused', error.message || 'No se pudo preparar la misión.');
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
    active.controller.abort();
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
      if (active && event.isTrusted) cancel(active.jobId, 'Has interactuado con el juego durante la preparación.');
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
      throw new Error(operation.reason || 'Se ha cancelado la recuperación del destino.');
    }
    let permitted = false;
    try { permitted = canAct() !== false; } catch (_) {}
    if (!permitted) throw new Error('El helper está pausado. No se ha recuperado el destino.');
    if (!contextMatches(operation.spec)) {
      throw new Error('El origen, la cuenta o la selección han cambiado. Selecciona un único sistema de origen para reanudar.');
    }
    if (performance.now() > operation.deadline) throw new Error('El mapa no ha permitido recuperar el destino a tiempo. Vuelve a intentarlo.');
    const foreign = [...document.querySelectorAll('dialog[open]')].find(dialog => !operation.dialogs.has(dialog));
    if (foreign) throw new Error('El juego ha abierto otro diálogo. Ciérralo antes de recuperar esta misión.');
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
    if (!(dialog instanceof HTMLDialogElement) || dialog.open) throw new Error('Hay un diálogo del juego abierto. Se ha pausado la recuperación.');
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
  function abort(operation, message) {
    if (operation.controller.signal.aborted) return;
    operation.reason = message;
    operation.controller.abort();
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
      const aborted = () => done(new Error(operation.reason || 'Se ha cancelado la recuperación del destino.'));
      const check = () => {
        try {
          assertOperation(operation);
          const value = read();
          if (value) { done(null, value); return; }
          if (performance.now() >= until) { done(new Error(message)); return; }
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
    if (rect.width <= 0 || rect.height <= 0) throw new Error('El mapa no tiene una superficie disponible.');
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
    if (!candidates.length) throw new Error('El juego todavía no ha preparado el Inspector.');
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
    await waitFor(operation, () => inspectCoordinate(inspector), 'El Inspector no ha mostrado las coordenadas del destino.', 2000);
    return inspector;
  }
  async function resolveTarget(job, { signal } = {}) {
    if (destroyed) throw new Error('El helper se ha detenido.');
    if (current) throw new Error('Ya se está recuperando el destino de otra misión.');
    const spec = jobSpec(job);
    if (!spec || !contextMatches(spec)) throw new Error('Selecciona el único sistema de origen de la misión antes de recuperar su destino.');
    if (signal?.aborted) throw new Error('La recuperación del destino se ha cancelado.');
    if (document.querySelector('dialog[open]')) throw new Error('Cierra los diálogos del juego antes de recuperar el destino.');
    if (displayed(one('#app > .star-actions')) || displayed(one('#app > .selection-menu'))) {
      throw new Error('Cierra el menú del mapa antes de recuperar esta misión.');
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
      if (event.isTrusted) abort(operation, 'Has interactuado con el juego. La recuperación del destino se ha pausado.');
    }, options);
    for (const name of ['resize', 'pagehide', 'blur', 'popstate', 'hashchange']) window.addEventListener(name,
      event => { if (name !== 'blur' || event.target === window) abort(operation,
        'La vista del juego ha cambiado. Vuelve a recuperar el destino.'); }, options);
    if (signal) signal.addEventListener('abort', () => abort(operation, 'La recuperación del destino se ha cancelado.'),
      { once: true, signal: operation.listeners.signal });
    operation.observer = new MutationObserver(() => {
      try { assertOperation(operation); } catch (error) { abort(operation, error.message); }
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
      }, 'El mapa global no ha cargado. Vuelve a intentar la conexión del destino.', 7000);
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
        }, 'La cámara del mapa sigue moviéndose. Vuelve a recuperar el destino.', Math.max(100, locateDeadline - performance.now()));
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
      if (!keys(value, ['routeKey', 'label', 'coordinate', 'presetKey']) || typeof value.routeKey !== 'string' ||
          (value.routeKey !== '' && !value.routeKey.trim()) || value.routeKey.length > 32768 || /[\u0000\u007f]/.test(value.routeKey)) {
        throw new TypeError('Destino de misión no válido.');
      }
      const result = { routeKey: value.routeKey, label: label(value.label, 500),
        presetKey: label(label(value.presetKey, 500).normalize('NFKC').replace(/\s+/g, ' ').trim(), 500) };
      if (value.coordinate !== undefined) {
        if (!keys(value.coordinate, ['q', 'r']) || !['q', 'r'].every(key =>
          Number.isSafeInteger(value.coordinate[key]) && Math.abs(value.coordinate[key]) <= 1000000000)) {
          throw new TypeError('Coordenadas de misión no válidas.');
        }
        result.coordinate = { q: value.coordinate.q, r: value.coordinate.r };
      }
      if (value.routeKey === '' && !result.coordinate) throw new TypeError('Faltan las coordenadas del destino.');
      return result;
    }

    function spec(value) {
      if (!keys(value, ['scope', 'originId', 'originName', 'target', 'quantities', 'produce', 'autoSend']) ||
          !SCOPE.test(value.scope || '') || !UUID.test(value.originId || '') ||
          typeof value.produce !== 'boolean' || typeof value.autoSend !== 'boolean') {
        throw new TypeError('Configuración de misión no válida.');
      }
      return { scope: value.scope, originId: value.originId.toLowerCase(),
        originName: label(value.originName, 400), target: target(value.target),
        quantities: quantities(value.quantities), produce: value.produce, autoSend: value.autoSend };
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
          'autoSend', 'status', 'createdAt', 'updatedAt', 'claimedAt', 'sentAt', 'message', 'needsReview']) ||
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
        ids.add(item.id);
        identities.add(identity);
        return { id: item.id, ...clean, status: item.status, createdAt: item.createdAt,
          updatedAt: item.updatedAt, claimedAt: item.claimedAt, sentAt: item.sentAt,
          message: label(item.message, 500, true), needsReview: item.needsReview === true || item.status === 'uncertain' };
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

    function queue(value) {
      ensureReady();
      const clean = spec(value);
      if (!clean.produce && !clean.autoSend) throw new Error('Activa la producción o el envío cuando se complete la flota.');
      const existing = config.jobs.find(item => item.scope === clean.scope && item.originId === clean.originId);
      if (existing && existing.status !== 'sent') throw new Error('Este origen ya tiene una misión pendiente. Cancélala antes de sustituirla.');
      const retained = config.jobs.filter(item => item !== existing);
      if (retained.length >= MAX_JOBS) throw new Error('Se ha alcanzado el límite de misiones pendientes.');
      const time = now();
      const random = globalThis.crypto?.randomUUID?.();
      let id = random || 'fleet-' + time.toString(36) + '-' + (++idSequence).toString(36);
      while (config.jobs.some(item => item.id === id)) id = 'fleet-' + time.toString(36) + '-' + (++idSequence).toString(36);
      const job = { id, ...clean, status: 'waiting', createdAt: time, updatedAt: time,
        claimedAt: null, sentAt: null, message: '', needsReview: false };
      commit({ ...config, jobs: [...retained, job] });
      return copy(job);
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
        const previous = job.target.coordinate;
        const next = refreshedTarget.coordinate;
        if (!previous || !next || previous.q !== next.q || previous.r !== next.r ||
            job.target.presetKey !== refreshedTarget.presetKey) {
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
      const job = config.jobs.find(item => matches(item, current) && item.status === 'waiting' && item.produce && !item.needsReview);
      if (!job) return null;
      const plan = productionPlan(job, fleet);
      if (plan?.ready && !job.autoSend) {
        try { finishPreparation(job.id); } catch (_) { /* No side effect after failed persistence. */ }
        return null;
      }
      return plan ? { ...plan.production } : null;
    }

    function finishPreparation(id) {
      return changeJob(id, job => ({ ...job, produce: false, status: 'paused',
        message: 'Flota completa; preparada para envío manual.' }));
    }

    async function tick() {
      if (destroyed || running || !refreshConfig()) return null;
      const current = currentContext();
      if (!current?.active || !current.canAct) { render(); return null; }
      const job = config.jobs.find(item => matches(item, current) && item.status === 'waiting');
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
      if (!mounted || destroyed) return;
      const current = currentContext();
      const jobs = (config?.jobs || []).map(job => ({ job,
        plan: matches(job, current) ? productionPlan(job, currentFleet(job)) : null }));
      const key = JSON.stringify({ jobs, context: current, notice, readError, storageError });
      if (key === renderKey) return;
      renderKey = key;
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
      style.textContent = '.oldlight-fleet-wait{font:inherit;color:inherit;max-width:100%;min-width:0}' +
        '.oldlight-fleet-wait h4{font-size:13px;margin:12px 0 8px}.oldlight-fleet-wait article{padding:10px;border:1px solid #3b4b60;border-radius:8px;margin:8px 0;min-width:0;overflow-wrap:anywhere}' +
        '.oldlight-fleet-wait p{font-size:12px;line-height:1.45;margin:4px 0;overflow-wrap:anywhere}' +
        '.oldlight-fleet-wait .fw-muted{opacity:.75}.oldlight-fleet-wait .fw-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
        '.oldlight-fleet-wait button{font:inherit;font-size:12px;padding:5px 8px;max-width:100%;white-space:normal;border-radius:6px;border:1px solid #52647c;background:#223046;color:inherit;cursor:pointer}' +
        '.oldlight-fleet-wait button:disabled{opacity:.5;cursor:default}.oldlight-fleet-wait label{display:flex;align-items:flex-start;gap:6px;font-size:12px;margin-top:6px}' +
        '.oldlight-fleet-wait input{margin:2px 0 0}.oldlight-fleet-wait .fw-error{color:#f8c58a}';
      section.append(style, el('h4', 'Misiones pendientes'));
      if (notice) {
        const warning = el('p', notice, 'fw-error');
        warning.setAttribute('role', 'status');
        section.append(warning);
      }
      const safeAction = action => {
        try { action(); } catch (error) { notice = error.message; renderKey = ''; render(); }
      };
      for (const { job, plan } of jobs) {
        const article = el('article');
        article.dataset.fleetWaitJob = job.id;
        article.append(el('strong', job.target.label), el('p', 'Desde ' + job.originName, 'fw-muted'),
          el('p', fleetText(job.quantities)));
        const statuses = { paused: 'Pausada', sending: 'Enviando…', sent: 'Enviada',
          uncertain: 'Envío sin confirmar. Comprueba las misiones del juego.' };
        let state = statuses[job.status];
        if (job.status === 'waiting') {
          state = plan?.ready ? (job.autoSend ? 'Flota completa; lista para enviar.' : 'Flota completa. Envío automático desactivado.')
            : plan ? 'Esperando: ' + fleetText(plan.missing) : 'Selecciona este origen para comprobar su flota.';
        }
        const status = el('p', state);
        status.setAttribute('role', 'status');
        article.append(status);
        if (job.message && job.message !== state) article.append(el('p', job.message, 'fw-muted'));
        if (job.produce && job.status === 'waiting' && plan && fleetText(plan.production)) {
          article.append(el('p', 'Por producir: ' + fleetText(plan.production), 'fw-muted'));
        }
        if (['waiting', 'paused', 'uncertain'].includes(job.status)) {
          for (const [field, text] of [['produce', 'Producir las naves que faltan'], ['autoSend', 'Enviar cuando la flota esté completa']]) {
            const row = el('label');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = job[field];
            input.disabled = readError;
            input.dataset.fleetWaitOption = field;
            input.addEventListener('change', () => safeAction(() => update(job.id, { [field]: input.checked })));
            row.append(input, el('span', text));
            article.append(row);
          }
        }
        const actions = el('div', undefined, 'fw-actions');
        const button = (text, action, disabled = false) => {
          const control = el('button', text);
          control.type = 'button';
          control.disabled = disabled || readError;
          control.addEventListener('click', () => safeAction(action));
          actions.append(control);
        };
        if (job.status === 'waiting') button('Pausar', () => pause(job.id));
        if (job.status === 'paused' && !job.needsReview) button('Reanudar', () => resume(job.id));
        if (job.status === 'uncertain' || job.needsReview) button('He comprobado que no se envió: reanudar', () => acknowledge(job.id, { notSent: true }));
        button(job.status === 'sent' ? 'Quitar' : 'Cancelar pendiente', () => cancel(job.id), job.status === 'sending');
        article.append(actions);
        section.append(article);
      }
      if (jobs.some(({ job }) => job.produce && job.status !== 'sent')) {
        section.append(el('p', 'Pausar o cancelar detiene este pendiente. Las naves ya encargadas siguen en la cola del juego.', 'fw-muted'));
      }
      mounted.replaceChildren(section);
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

    return { queue, update, reconnect, cancel, pause, resume, acknowledge, productionPlan, productionDemand,
      getJobFor, tick, exportConfig, validateConfig, importConfig, backupCheckpoint, restoreCheckpoint,
      refreshConfig, mount, destroy,
      list: () => exportConfig().jobs,
      getDiagnostics: () => ({ storageError, readError, running, count: config?.jobs.length ?? null }) };
  }
  // END FLEET WAIT QUEUE

  // BEGIN FLEET WAIT INTEGRATION
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
      && context.scope && context.originId && context.selectionCount === 1
      && !document.querySelector(`${PANEL} .b-loading, ${FLEET_PANEL} .b-loading`)
      && (isVisible(document.querySelector(PANEL)) || isVisible(document.querySelector(FLEET_PANEL))));
  }

  function missionQueueContext() {
    return { ...missionContext(), active: canOperateMission(),
      canAct: canOperateMission() && !missionAdapter?.isBusy() && !document.querySelector('dialog[open]') };
  }

  function currentMissionJob() {
    try { return fleetWait?.getJobFor(missionContext()) || null; } catch { return null; }
  }

  function sameMissionPreset(job, capture) {
    const spec = capture.spec;
    return Boolean(spec && job.scope === spec.scope && job.originId === spec.originId
      && job.target.presetKey === spec.target.presetKey
      && job.target.coordinate?.q === spec.target.coordinate?.q
      && job.target.coordinate?.r === spec.target.coordinate?.r
      && SHIPS.every(([id]) => job.quantities[id] === spec.quantities[id]));
  }

  function offerEmptyPresetMission(options) {
    if (!options.capture?.spec || document.querySelector('dialog[open]')) return false;
    document.getElementById('oldlight-preset-shortage-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'oldlight-preset-shortage-dialog';
    dialog.setAttribute('aria-label', 'Preparar misión pendiente');
    dialog.style.cssText = 'width:390px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;'
      + 'padding:14px;border:1px solid #45637a;border-radius:12px;background:#101b27;color:#e8f0f7;font:13px/1.4 system-ui,sans-serif';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.style.cssText = 'display:block;margin-left:auto;padding:5px 9px;color:inherit;background:#25465e;border:1px solid #628dad;border-radius:6px;cursor:pointer';
    close.addEventListener('click', () => dialog.close());
    dialog.append(close);
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
    shadow.innerHTML = '<style>:host{display:block;margin:12px 0;color:#e8f0f7;font:13px/1.4 system-ui,sans-serif}'
      + '*{box-sizing:border-box}.card{padding:12px;border:1px solid #45637a;border-radius:10px;background:#102131}'
      + 'h3{font-size:14px;margin:0 0 7px}p{margin:6px 0;color:#b8cbd9}ul{padding-left:18px;margin:8px 0}'
      + 'p,li{overflow-wrap:anywhere}'
      + 'label{display:flex;align-items:flex-start;gap:7px;margin:9px 0}input{accent-color:#76b8e8;margin-top:3px}'
      + 'button{font:inherit;padding:8px 10px;border-radius:7px;border:1px solid #628dad;background:#25465e;color:inherit;cursor:pointer}'
      + 'button:disabled{opacity:.5;cursor:default}.error{color:#ffb9aa}.actions{display:flex;gap:8px;flex-wrap:wrap}'
      + '</style><section class="card"><h3></h3><p data-field="route"></p><ul></ul>'
      + '<label><input type="checkbox" data-option="produce">Producir las naves que faltan</label>'
      + '<p data-field="production"></p>'
      + '<label><input type="checkbox" data-option="auto-send" checked>Enviar automáticamente cuando el preset esté completo</label>'
      + '<p>La misión esperará a tener todas sus naves en base. La producción descuenta las que estén en misión o en construcción.</p>'
      + '<div class="actions"><button type="button" data-action="queue">Guardar misión pendiente</button></div>'
      + '<p data-field="status" role="status" aria-live="polite"></p></section>';
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
      line.textContent = plan ? `${name}: ${plan.parked[id]}/${quantities[id]} en base · ${plan.away[id]} en misión · ${plan.building[id]} en construcción`
        : `${name}: ${quantities[id]} necesarias`;
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
      && existing?.status !== 'sending' && !existing?.needsReview && existing?.status !== 'uncertain');
    const syncButton = () => { button.disabled = !available || (!produce.checked && !autoSend.checked); };
    produce.addEventListener('change', syncButton);
    autoSend.addEventListener('change', syncButton);
    syncButton();
    if (!available) {
      status.className = 'error';
      status.textContent = captureError || (existing?.needsReview || existing?.status === 'uncertain'
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
    const defaults = { browserEnabled: false, telegramEnabled: false, botToken: '', chatId: '',
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
      rateRetries: 0, filtered: 0,
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
      return {
        browserEnabled: saved.browserEnabled === true,
        telegramEnabled: saved.telegramEnabled === true,
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
  
    function writeConfig(next) {
      if (!storageAvailable) {
        storageError = 'Faltan GM_getValue/GM_setValue. Revisa los permisos del userscript.';
        updateUI();
        return false;
      }
      next = normalizeConfig(next);
      try { gmSet(CONFIG_KEY, { ...next }); }
      catch {
        storageError = 'No se pudo guardar en el gestor. La configuración no ha cambiado.';
        updateUI();
        return false;
      }
      const destinationChanged = next.botToken !== config.botToken || next.chatId !== config.chatId;
      if (destinationChanged || (config.telegramEnabled && !next.telegramEnabled)) clearTelegramQueue();
      if (!next.browserEnabled) clearBrowserQueue();
      config = { ...next };
      dropFilteredQueueItems();
      storageError = '';
      autosaveStatus = credentialDraftState().message || 'Guardado automáticamente.';
      updateUI();
      try { deps.onSettingsChange?.(); } catch { /* Los avisos no dependen de la copia de seguridad. */ }
      return true;
    }
  
    function refreshConfig() {
      if (destroyed || !storageAvailable) return;
      try {
        const next = normalizeConfig(gmGet(CONFIG_KEY, null));
        const destinationChanged = next.botToken !== config.botToken || next.chatId !== config.chatId;
        const telegramChanged = next.telegramEnabled !== config.telegramEnabled;
        const browserChanged = next.browserEnabled !== config.browserEnabled;
        const eventsChanged = EVENT_TYPES.some((type) => next.events[type] !== config.events[type]);
        const draftsChanged = !sameDrafts(next.drafts, config.drafts);
        if (!destinationChanged && !telegramChanged && !browserChanged && !eventsChanged
            && !draftsChanged && next.eventsExpanded === config.eventsExpanded) return;
        if (destinationChanged || (config.telegramEnabled && !next.telegramEnabled)) clearTelegramQueue();
        if (config.browserEnabled && !next.browserEnabled) clearBrowserQueue();
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
      } catch {
        storageError = 'No se pudo actualizar la configuración desde el gestor.';
      }
    }
  
    function isEnabled() {
      refreshConfig();
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
      refreshConfig();
      dropFilteredQueueItems();
      if (destroyed || !browserQueue.length) return;
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
      refreshConfig();
      dropFilteredQueueItems();
      if (destroyed || activeRequest || !telegramQueue.length) return;
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
        refreshConfig();
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
        refreshConfig();
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
        const browserOn = config.browserEnabled && permission() === 'granted';
        const telegramOn = config.telegramEnabled && configured() && !telegramBlocked;
        if (!browserOn && !telegramOn) return false;
        refreshSeen();
        if (seen.has(key) && seen.get(key) > now() - SEEN_TTL) {
          counters.duplicates += 1;
          return false;
        }
        remember(key);
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
      refreshConfig();
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
      refreshConfig();
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
      refreshConfig();
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
        storageAvailable,
        storageError,
        autosave: { status: autosaveStatus, draftStored: credentialDraftState().pending, pending: draftTimer !== null },
        events: { ...config.events },
        browser: {
          enabled: config.browserEnabled, permission: permission(),
          queued: browserQueue.length, status: browserStatus,
        },
        telegram: {
          available: telegramAvailable, enabled: config.telegramEnabled,
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
      const permitText = p === 'granted' ? 'Activar avisos del navegador' : 'Permitir avisos del navegador';
      if (permit.textContent !== permitText) permit.textContent = permitText;
      token.placeholder = config.botToken ? 'Token guardado; vacío lo conserva' : 'Token del bot';
      chat.placeholder = config.chatId ? 'Chat guardado; vacío lo conserva' : 'ID numérico o @canal';
      token.disabled = chat.disabled = !storageAvailable;
      test.disabled = !configured() || credentialDraftState().pending || !!activeRequest || telegramQueue.some((item) => item.test);
      for (const [type, input] of eventInputs) {
        input.checked = config.events[type];
        input.disabled = !storageAvailable;
      }
      const enabledEvents = EVENT_TYPES.filter((type) => config.events[type]).length;
      const eventCountText = `${enabledEvents} de ${EVENT_TYPES.length} tipos activados. Se guardan al cambiarlos.`;
      if (eventCount.textContent !== eventCountText) eventCount.textContent = eventCountText;
      mounted.eventsAll.disabled = !storageAvailable || enabledEvents === EVENT_TYPES.length;
      mounted.eventsNone.disabled = !storageAvailable || enabledEvents === 0;
      if (mounted.eventsDetails.open !== config.eventsExpanded) mounted.eventsDetails.open = config.eventsExpanded;
      const browserLine = p === 'denied' ? 'Navegador: permiso bloqueado en los ajustes del sitio.'
        : p === 'unsupported' ? 'Este navegador no admite avisos de escritorio.'
          : 'Navegador: ' + (config.browserEnabled ? browserStatus || 'activado.' : 'desactivado.');
      const telegramLine = 'Telegram: ' + (telegramStatus || (config.telegramEnabled ? 'activado.' : 'desactivado.'));
      const pendingLine = 'En cola: ' + browserQueue.length + ' navegador / ' + telegramQueue.length + ' Telegram.';
      const dropped = counters.browserDropped + counters.telegramDropped;
      const content = [storageError, storageError ? '' : autosaveStatus, browserLine, telegramLine, pendingLine,
        dropped ? 'Avisos descartados o cancelados: ' + dropped + '.' : ''].filter(Boolean).join('\n');
      if (status.textContent !== content) status.textContent = content;
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
          .notifications-details{border-top:1px solid #344257;padding-top:8px;margin-top:8px;max-width:100%;min-width:0;font:inherit;overflow-wrap:anywhere}
          .notifications-details summary{cursor:pointer;font-weight:600;padding:3px 0}
          .notifications-details .notify-body{display:grid;gap:8px;padding-top:8px;min-width:0}
          .notifications-details label{display:flex;align-items:center;gap:7px;font:inherit;min-width:0}
          .notifications-details .notify-field{display:grid;gap:4px}
          .notifications-details input[type="text"],.notifications-details input[type="password"]{box-sizing:border-box;width:100%;min-width:0;padding:7px;border:1px solid #52657f;border-radius:5px;background:#101a2c;color:inherit;font:inherit}
          .notifications-details input[type="checkbox"]{flex:0 0 auto;width:16px;height:16px;margin:0}
          .notifications-details button{box-sizing:border-box;max-width:100%;padding:7px;border:1px solid #52657f;border-radius:5px;background:#23344d;color:inherit;cursor:pointer;font:inherit;white-space:normal}
          .notifications-details button:disabled{opacity:.55;cursor:default}
          .notifications-details .notify-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
          .notifications-details .notification-events-details{min-width:0;border:1px solid #344257;border-radius:5px;padding:6px}
          .notifications-details .notification-event-groups{display:grid;gap:8px;margin-top:8px;min-width:0}
          .notifications-details .notify-event-group{display:grid;gap:7px;min-width:0;margin:0;padding:8px;border:1px solid #344257;border-radius:4px}
          .notifications-details .notify-event-group legend{padding:0 4px;font-weight:600}
          .notifications-details .notify-event-group label{align-items:flex-start;font-size:11px;line-height:1.35}
          .notifications-details .notify-note{margin:0;font-size:11px;line-height:1.4;opacity:.85}
          .notifications-details .notify-status{margin:0;white-space:pre-line;font-size:11px;line-height:1.45}
          .notifications-details :focus-visible{outline:2px solid #97c8ff;outline-offset:2px}
        </style>
        <summary>Notificaciones</summary>
        <div class="notify-body">
          <label><input class="notification-browser-toggle" type="checkbox"> Avisos del navegador</label>
          <button class="notification-permission" type="button">Permitir avisos del navegador</button>
          <label><input class="notification-telegram-toggle" type="checkbox"> Avisos por Telegram</label>
          <details class="notification-events-details">
            <summary>Tipos de notificación</summary>
            <p class="notify-note">Estos filtros se aplican al navegador y a Telegram.</p>
            <div class="notify-actions"><button class="notification-events-all" type="button">Todos</button><button class="notification-events-none" type="button">Ninguno</button></div>
            <div class="notification-event-groups">${EVENT_GROUPS.map((group) =>
              `<fieldset class="notify-event-group"><legend>${group.label}</legend>${group.entries.map(([type, label]) =>
                `<label><input class="notification-event-toggle" type="checkbox" data-notification-event="${type}"> ${label}</label>`
              ).join('')}</fieldset>`
            ).join('')}</div>
            <p class="notify-note notification-events-count"></p>
          </details>
          <label class="notify-field">Token de tu bot<input class="notification-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="221"></label>
          <label class="notify-field">Chat ID<input class="notification-chat-id" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="65"></label>
          <p class="notify-note">Todo se guarda automáticamente. Los campos vacíos conservan las credenciales activas; un borrador incompleto queda guardado para continuar después. Enviar prueba manda un mensaje al chat guardado.</p>
          <button class="notification-test" type="button">Enviar prueba a Telegram</button>
          <button class="notification-clear" type="button">Borrar credenciales de Telegram</button>
          <p class="notify-status" role="status" aria-live="polite" aria-atomic="true"></p>
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
      };
      const ui = mounted;
      ui.eventsDetails.addEventListener('toggle', () => {
        const open = ui.eventsDetails.open;
        if (open === config.eventsExpanded) return;
        refreshConfig();
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
          refreshConfig();
          writeConfig({ ...config, events: { ...config.events, [type]: enabled } });
        });
      }
      function setAllEvents(enabled) {
        refreshConfig();
        writeConfig({ ...config, events: Object.fromEntries(EVENT_TYPES.map((type) => [type, enabled])) });
      }
      ui.eventsAll.addEventListener('click', () => setAllEvents(true));
      ui.eventsNone.addEventListener('click', () => setAllEvents(false));
      ui.telegram.addEventListener('change', () => {
        const desired = ui.telegram.checked;
        refreshConfig();
        if (writeConfig({ ...config, telegramEnabled: desired })) {
          telegramStatus = desired ? configured() ? 'Activado.' : 'Activado; completa las credenciales para recibir avisos.' : 'Desactivado.';
          if (desired) armTelegram();
          updateUI();
        }
      });
      ui.browser.addEventListener('change', () => {
        const desired = ui.browser.checked && permission() === 'granted';
        refreshConfig();
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
          refreshConfig();
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
        refreshConfig();
        if (destroyed || !configured() || activeRequest || telegramQueue.some((item) => item.test)) return;
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
        refreshConfig();
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
  
    return Object.freeze({ emit, isEnabled, isEventEnabled, mount, getDiagnostics, exportConfig, validateConfig, importConfig,
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
   * createReportsWatcher({ send, fetch?, gmGetValue?, gmSetValue?, now?,
   *   getPathname?, getHidden?, AbortController?, setTimeout?, clearTimeout? })
   * .tick({ active, enabled = true, unread }) is synchronous and never awaits I/O.
   * active must mean: this tab holds the root Web Lock, visible HUD, visible tab.
   * enabled must reflect game.reports plus a notification channel, even while
   * inactive. Explicitly disabling it starts a new silent baseline when enabled.
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
    const now = deps.now || (() => Date.now());
    const later = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancelTimer = deps.clearTimeout || ((id) => clearTimeout(id));
    const getPathname = deps.getPathname || (() => globalThis.location?.pathname || '');
    const getHidden = deps.getHidden || (() => typeof document !== 'undefined' && document.hidden);
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
    const counters = { polls: 0, pages: 0, details: 0, emitted: 0, fallbacks: 0, invalidItems: 0, errors: 0 };

    function blankCheckpoint() {
      return { version: 1, initialized: false, suspended: false, watermark: null,
        seen: [], pending: [], scan: null };
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
      return !!slug && typeof fetchRead === 'function' && typeof Controller === 'function' && !!send;
    }
    function current(token) {
      try { return !destroyed && active && enabled && token === epoch && pathSlug() === slug && !getHidden(); }
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
      }
      if (!out.initialized || out.suspended) { out.pending = []; out.scan = null; }
      return out;
    }

    function loadCheckpoint() {
      if (!slug) { checkpoint = blankCheckpoint(); return; }
      if (typeof gmGet !== 'function') return;
      try { checkpoint = normalize(gmGet(PREFIX + slug, null)); storageError = false; }
      catch { storageError = true; }
    }

    function saveCheckpoint() {
      if (!slug || typeof gmSet !== 'function') return;
      try {
        gmSet(PREFIX + slug, { ...checkpoint,
          seen: checkpoint.seen.map((pair) => [...pair]),
          pending: checkpoint.pending.map((item) => ({ ...item })),
          scan: checkpoint.scan ? { ...checkpoint.scan, anchors: [...checkpoint.scan.anchors] } : null });
        storageError = false;
      } catch { storageError = true; }
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
        checkpoint = blankCheckpoint();
        checkpoint.initialized = true;
        for (const item of page.items) {
          remember(item);
          checkpoint.watermark = maxStamp(checkpoint.watermark, item.takenAt);
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
          if (anchors.has(item.id) || (scan.floor !== null && item.takenAt !== null && item.takenAt < scan.floor)) {
            boundary = true; break;
          }
          scan.high = maxStamp(scan.high, item.takenAt);
          if (known.has(item.id)) continue;
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
      return 'conexión no disponible';
    }

    function dispatch(item, detail, token, unavailable = '') {
      assertCurrent(token);
      try {
        const result = send(reportEvent(item, detail, unavailable));
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
      const nextEnabled = input.enabled !== false;
      let nextActive = nextEnabled && input.active === true;
      try { if (getHidden()) nextActive = false; } catch { nextActive = false; }
      const changedSlug = nextSlug !== slug;
      if (changedSlug) {
        active = false;
        stop();
        slug = nextSlug;
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
      else if (!enabled) status = 'Informes: notificaciones desactivadas.';
      else if (!canRead()) status = 'Informes: lectura automática no disponible en esta página.';
      else if (!active) status = 'Informes: esperando una pestaña visible con el control.';
      else if (phase === 'error') status = `Informes: ${lastError}; se reintentará automáticamente.`;
      else if (!checkpoint.initialized) status = 'Informes: preparando la referencia inicial, sin enviar historial.';
      else if (request) status = `Informes: leyendo ${phase === 'detail' ? 'el contenido' : 'la lista'}.`;
      else if (checkpoint.pending.length || checkpoint.scan) status = `Informes: ${checkpoint.pending.length} pendientes; se continuará automáticamente.`;
      else status = 'Informes: al día; comprobación cada 25 segundos.';
      if (storageError) status += ' No se pudo guardar la referencia entre pestañas.';
      return { status, phase, active, enabled, apiAvailable: canRead(),
        baselineReady: checkpoint.initialized, inFlight: !!request, pending: checkpoint.pending.length,
        scanningBacklog: !!checkpoint.scan, slug, lastListAt, nextPollAt: Math.max(nextPollAt, retryAt),
        lastError, failures, storageAvailable: typeof gmGet === 'function' && typeof gmSet === 'function',
        storageError, counters: { ...counters } };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true; active = false; stop(); phase = 'destroyed';
    }

    return { tick, getDiagnostics, destroy };
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
      mounted.count.textContent = count ? ` · ${count} activos` : '';
      for (const id of ids) {
        const input = mounted.inputs.get(id);
        const draft = unsavedDrafts.has(id) ? unsavedDrafts.get(id) : config.drafts[id];
        const value = draft === null ? (config.targets[id] ? String(config.targets[id]) : '') : draft;
        if (input.value !== value) input.value = value;
        input.setAttribute('aria-invalid', String(draft !== null && parseDraft(draft) === null));
        const level = latest?.levels.get(id);
        mounted.labels.get(id).textContent = `${config.targets[id] ? `Activo: nivel ${config.targets[id]}` : 'Desactivado'}` +
          (level !== null && level !== undefined ? ` · Actual: ${level}` : '');
      }
      mounted.status.textContent = unsavedDrafts.size
        ? 'El borrador sigue en esta ventana y todavía no se ha guardado. Edita el campo o sal de él para reintentar.'
        : storageError ? 'No se pudieron guardar los objetivos. Comprueba el almacenamiento local.' : fieldStatus;
    }

    function mount(container) {
      if (destroyed) throw new Error('Los objetivos de nivel están cerrados.');
      mounted?.root.remove();
      const root = document.createElement('details');
      root.className = 'level-targets-details';
      const style = document.createElement('style');
      style.textContent = '.level-targets-details{margin-top:12px;padding:10px;border:1px solid #304252;border-radius:6px}' +
        '.level-targets-details summary{font-weight:650;cursor:pointer}' +
        '.level-targets-details p{font-size:11px;line-height:1.45;color:#aebfd0}' +
        '.level-target-row{display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:3px 10px;align-items:center;margin-top:10px}' +
        '.level-target-row label{min-width:0;font-size:12px}' +
        '.level-target-row input{box-sizing:border-box;width:100%;min-width:0;padding:6px;border:1px solid #526679;border-radius:4px;background:#101923;color:#e5edf5;font:inherit}' +
        '.level-target-row input[aria-invalid="true"]{border-color:#e9b671}' +
        '.level-target-row small{grid-column:1/-1;font-size:10px;color:#aebfd0}' +
        '.level-targets-status:empty{display:none}';
      const summary = document.createElement('summary');
      summary.append(document.createTextNode('Objetivos de nivel'));
      const count = document.createElement('span');
      summary.append(count);
      const help = document.createElement('p');
      help.textContent = 'Elige un nivel por estructura. El aviso se aplica al sistema observado cuando termina la construcción. ' +
        'Vacío o 0 desactiva el objetivo; los niveles ya alcanzados al activarlo no generan avisos.';
      root.append(style, summary, help);
      const inputs = new Map();
      const labels = new Map();
      for (const [id, name] of buildings) {
        const row = document.createElement('div');
        row.className = 'level-target-row';
        const label = document.createElement('label');
        label.textContent = name;
        const input = document.createElement('input');
        input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = MAX_DRAFT;
        input.pattern = '[0-9]*'; input.placeholder = '—'; input.autocomplete = 'off';
        input.id = `oldlight-level-target-${id}`;
        input.dataset.levelTarget = id;
        input.setAttribute('aria-label', `Objetivo de nivel de ${name}`);
        label.htmlFor = input.id;
        const active = document.createElement('small');
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
      const status = document.createElement('p');
      status.className = 'level-targets-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      root.append(status);
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
    const CAPABILITIES = ['oauth-config', 'account-hint'];
    const encoder = new TextEncoder();
    const LABELS = {
      disconnected: 'Google Drive desconectado.',
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
      const rememberAccount = value.rememberAccount === undefined ? true : value.rememberAccount;
      const accountHint = validateAccountHint(value.accountHint === undefined ? '' : value.accountHint);
      const clientIdDraft = value.clientIdDraft === undefined ? null : value.clientIdDraft;
      if (typeof clientId !== 'string' || typeof autoBackup !== 'boolean' ||
          typeof rememberAccount !== 'boolean' ||
          (clientIdDraft !== null && (typeof clientIdDraft !== 'string' || clientIdDraft.length > 300))) {
        throw new TypeError('La configuración de Google Drive no tiene un formato válido.');
      }
      const trimmed = clientId.trim();
      if (trimmed && (trimmed.length > 300 || !CLIENT_ID.test(trimmed))) {
        throw new TypeError('El Client ID de Google no tiene un formato válido.');
      }
      return { clientId: trimmed, autoBackup, rememberAccount,
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
      inputs.remember.checked = config.rememberAccount;
      inputs.open.disabled = false;
      inputs.open.textContent = config.clientId || defaultClientId ? 'Abrir Google Drive' : 'Configurar Google Drive';
      inputs.close.disabled = !session;
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
      if (!['get-backup', 'apply-backup', 'set-config', 'remember-account'].includes(message.type)) return;
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
        if (message.type === 'get-backup') {
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
      } catch (_) {
        send(current, { type: 'reply', id: message.id, ok: false, error: 'invalid_backup' });
        report('invalid_backup');
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

    function notifyChanged() {
      if (!destroyed && !applying && Date.now() >= suppressChangedUntil && config.autoBackup) {
        send(session, { type: 'settings-changed' });
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
      box.append(element('style', '.oldlight-drive-config .drive-toggle{display:flex;gap:7px;align-items:flex-start}' +
        '.oldlight-drive-config .drive-toggle input{flex:none;margin:1px 0 0}' +
        '.oldlight-drive-config .drive-advanced{margin-top:10px}' +
        '.oldlight-drive-config .drive-advanced summary{cursor:pointer}' +
        '.oldlight-drive-config .drive-active-client,.oldlight-drive-config .drive-account{overflow-wrap:anywhere}' +
        '.oldlight-drive-config .drive-field-status:empty,.oldlight-drive-config .drive-account:empty{display:none}'));
      box.append(element('h4', 'Copia opcional en Google Drive'));
      const controls = element('div', undefined, { className: 'oldlight-drive-controls' });
      const open = element('button', 'Configurar Google Drive', { type: 'button' });
      const close = element('button', 'Desconectar', { type: 'button' });
      controls.append(open, close);
      const status = element('p');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const autoLabel = element('label', undefined, { className: 'drive-toggle' });
      const auto = element('input', undefined, { type: 'checkbox' });
      autoLabel.append(auto, document.createTextNode(' Copia automática de los cambios locales'));
      const rememberLabel = element('label', undefined, { className: 'drive-toggle' });
      const remember = element('input', undefined, { type: 'checkbox' });
      rememberLabel.append(remember, document.createTextNode(' Recordar mi cuenta para volver a conectar'));
      const note = element('p', 'Los ajustes se guardan automáticamente. La copia automática requiere ' +
        'la ventana de Drive abierta y la autorización vigente.');
      const advanced = element('details', undefined, { className: 'drive-advanced' });
      advanced.append(element('summary', 'Configuración avanzada'));
      const clientLabel = element('label', 'Client ID de Google OAuth');
      const client = element('input', undefined, { type: 'text', maxLength: 300,
        autocomplete: 'off', spellcheck: false, placeholder: '…apps.googleusercontent.com' });
      clientLabel.append(client);
      const active = element('p', undefined, { className: 'drive-active-client' });
      const account = element('p', undefined, { className: 'drive-account' });
      const setupNote = element('p', 'Para usar tu propio proyecto, crea un Client ID Web con este origen autorizado: ' + HELPER_ORIGIN +
        '. La configuración avanzada de la ventana de Drive incluye los pasos.');
      const clear = element('button', 'Borrar Client ID', { type: 'button' });
      const inputNote = element('p', 'Al escribir se guarda el borrador; se aplica cuando el Client ID esté completo. ' +
        'Vaciar el campo conserva la conexión actual. Usa Borrar Client ID para eliminarlo.');
      const fieldStatus = element('p', undefined, { className: 'drive-field-status' });
      fieldStatus.setAttribute('role', 'status');
      fieldStatus.setAttribute('aria-live', 'polite');
      advanced.append(clientLabel, inputNote, active, account, setupNote, clear);
      box.append(controls, status, autoLabel, rememberLabel, note, fieldStatus, advanced);

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
          storeConfig({ ...exportConfig(), autoBackup: auto.checked, rememberAccount: remember.checked });
          inputStatus('config_saved');
        } catch (_) {
          refreshControls();
          inputStatus('storage_error');
        }
      }
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
      inputs = { client, auto, remember, open, close, clear, active, account, status, inputStatus: fieldStatus };
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
    attributeFilter: ['disabled', 'aria-disabled', 'aria-hidden', 'aria-label', 'hidden', 'inert', 'class', 'style', 'title', 'data-tutorial'],
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    shiftPresets.cancel();
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    settings = readSettings();
    restoreNumericInputs();
    if (settings.enabled) { error = ''; unconfirmed = 0; }
    schedule();
  });
  window.addEventListener('resize', () => {
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    layoutHelper();
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('focus', schedule);
  // Respaldo para carga tardía, plazos de respuesta y recuperación de pestañas.
  setInterval(schedule, 1000);
  schedule();
})();
