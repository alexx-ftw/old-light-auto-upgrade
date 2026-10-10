// ==UserScript==
// @name         Old Light Auto Upgrade
// @namespace    old-light-auto-upgrade
// @version      1.2.0
// @description  Mejoras por prioridad, mínimos de naves, informes y avisos, panel móvil y copias locales/Drive. Con actualización automática.
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
  const MIN_GAP_MS = 500;
  const RESPONSE_TIMEOUT_MS = 12000;
  const RETRY_GAP_MS = 5000;
  const MAX_UNCONFIRMED = 3;

  if (window.top !== window.self || document.getElementById(HOST_ID)) return;

  let settings = readSettings();
  const notifier = createNotifier({ onSettingsChange: settingsChanged });
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
        fleetExpanded: value?.fleetExpanded === true,
        depotFillPercent: typeof value?.depotFillPercent === 'number' && Number.isFinite(value.depotFillPercent)
          ? Math.min(100, Math.max(1, Math.round(value.depotFillPercent))) : 90,
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
    try { localStorage.setItem(KEY, JSON.stringify(settings)); settingsChanged(); } catch {
      // El script sigue funcionando si el navegador bloquea el almacenamiento.
    }
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
          .oldlight-drive-config label:first-of-type { display:grid; gap:5px; }
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
          .depot-threshold { display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; font-size:11px; }
          .depot-threshold input { width:51px; padding:3px; border:1px solid #40576b;
            border-radius:5px; color:#e1edf4; background:#172632; font:inherit; }
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
              <label class="depot-threshold">Depot al alcanzar <input type="number" min="1" max="100" step="1"
                data-setting="depot-fill-percent" aria-label="Porcentaje de capacidad para mejorar Resource Depot">% de capacidad</label>
            </details>
          </details>
          <details class="settings-page fleet-details" data-page="fleet" id="oldlight-settings-fleet" role="tabpanel" aria-labelledby="oldlight-tab-fleet" open hidden><summary>Mínimos de naves</summary>
            <p class="page-intro">Mínimo por tipo en el sistema seleccionado. 0 desactiva su reposición.</p>
            <div class="fleet-choices" role="list" aria-label="Mínimos y prioridad de naves"></div>
            <label class="count-away"><input type="checkbox">Contar también las naves en misión</label>
            <button type="button" class="reset-ships">Restablecer orden de naves</button>
            <p class="hint">Se descuentan las naves ya en construcción. La reposición disponible tiene prioridad sobre las mejoras.</p>
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
        conditionsDetails: shadow.querySelector('.conditions-details'),
        backupStatus: shadow.querySelector('[data-field="backup-status"]'),
        exportSettings: shadow.querySelector('[data-action="export-settings"]'),
        importSettings: shadow.querySelector('[data-action="import-settings"]'),
        chooseImport: shadow.querySelector('[data-action="choose-import-settings"]'),
        driveContainer: shadow.querySelector('[data-field="drive-backup"]'),
        choices: shadow.querySelector('.choices'),
        resetOrder: shadow.querySelector('.reset-order'),
        depotThreshold: shadow.querySelector('[data-setting="depot-fill-percent"]'),
        items: new Map(),
        fleetDetails: shadow.querySelector('.fleet-details'),
        fleetChoices: shadow.querySelector('.fleet-choices'),
        countAway: shadow.querySelector('.count-away input'),
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
        input.addEventListener('change', () => {
          settings.shipMinimums[id] = normalizeMinimum(Number(input.value));
          input.value = String(settings.shipMinimums[id]);
          saveSettings();
          emitEvent('settings.minimum', `Mínimo de ${name}: ${settings.shipMinimums[id]}.`);
          schedule();
        });
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
        item.append(position, label, input, actions, counts);
        ui.fleetChoices.append(item);
        ui.shipItems.set(id, { item, position, input, up, down, counts });
      }
      ui.countAway.addEventListener('change', () => {
        settings.countAway = ui.countAway.checked;
        saveSettings();
        emitEvent('settings.fleet_mode', settings.countAway
          ? 'Los mínimos cuentan naves en base y en misión.' : 'Los mínimos cuentan las naves en base.');
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
      ui.depotThreshold.addEventListener('change', () => {
        const value = Number(ui.depotThreshold.value);
        settings.depotFillPercent = Number.isFinite(value) ? Math.min(100, Math.max(1, Math.round(value))) : 90;
        ui.depotThreshold.value = String(settings.depotFillPercent);
        saveSettings();
        emitEvent('settings.depot', `Resource Depot se mejorará desde el ${settings.depotFillPercent}% de capacidad.`);
        schedule();
      });
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
      if (driveBackup) driveBackup.mount(ui.driveContainer);
      else {
        const unavailable = document.createElement('p');
        unavailable.className = 'hint';
        unavailable.textContent = 'Google Drive requiere un gestor de userscripts con almacenamiento GM disponible.';
        ui.driveContainer.append(unavailable);
      }
      const backupHelp = document.createElement('a');
      backupHelp.className = 'backup-help';
      backupHelp.textContent = 'Cómo configurar Google Drive';
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
      scriptVersion: '1.2.0',
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(settings),
      notifications: notifier.exportConfig(),
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
    const booleanKeys = ['enabled', 'expanded', 'minimized', 'countAway', 'fleetExpanded', 'conditionsExpanded'];
    if (typeof next.enabled !== 'boolean' || !list(next.order, DEFAULT_ORDER) || !list(next.excluded, DEFAULT_ORDER)
        || !list(next.shipOrder, DEFAULT_SHIP_ORDER) || !object(next.shipMinimums)
        || booleanKeys.some(key => next[key] !== undefined && typeof next[key] !== 'boolean')
        || SHIPS.some(([id]) => !Number.isInteger(next.shipMinimums[id])
          || next.shipMinimums[id] < 0 || next.shipMinimums[id] > MAX_SHIP_MINIMUM)
        || !Number.isFinite(next.depotFillPercent) || next.depotFillPercent < 1 || next.depotFillPercent > 100
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
    return { settings: normalizeSettings(next), notifications, drive };
  }

  function applyBackup(value) {
    const next = validateBackup(value);
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    const previous = { settings, raw: localStorage.getItem(KEY), notifications: notifier.exportConfig(),
      drive: driveBackup?.exportConfig?.() };
    importingBackup = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(next.settings));
      notifier.importConfig(next.notifications);
      if (driveBackup) driveBackup.importConfig(next.drive);
      settings = next.settings;
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
      try { if (driveBackup && previous.drive) driveBackup.importConfig(previous.drive); } catch { restored = false; }
      settings = previous.settings;
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
      if (focused !== controls.input) controls.input.value = String(settings.shipMinimums[id]);
      controls.up.disabled = index === 0;
      controls.down.disabled = index === settings.shipOrder.length - 1;
      const counts = fleetCounts(id);
      setText(controls.counts, counts
        ? `${counts.parked.toLocaleString()} en base · ${counts.away.toLocaleString()} en misión · +${counts.building.toLocaleString()} en cola`
        : 'Selecciona un solo sistema para leer la flota');
    }
    ui.countAway.checked = settings.countAway;
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
    if (ui.depotThreshold.getRootNode().activeElement !== ui.depotThreshold) {
      ui.depotThreshold.value = String(settings.depotFillPercent);
    }
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
    if (pending || observingNotifications) return;
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
    if (settings.excluded.length === BUILDINGS.length && !maintainFleet) {
      if (observeNotifications) acquireLeadership(); else releaseLeadership();
      show('Marca un edificio o configura un mínimo de naves'); return;
    }
    acquireLeadership();
    if (!leader) {
      show(lockError ? 'No se pudo coordinar esta pestaña. Recarga para reintentar.' : 'Esperando control de esta pestaña');
      return;
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
    if (maintainFleet) {
      const fleet = new Map(settings.shipOrder.map(id => [id, fleetCounts(id)]));
      const unknown = !activeSystem || settings.shipOrder.some(id =>
        settings.shipMinimums[id] > 0 && !fleet.get(id));
      const full = document.querySelector('[data-field="garrison"].active-garrison-chip--full');
      if (unknown) {
        fleetNotice = 'Naves: selecciona un solo sistema con recuentos disponibles';
      } else if (full && isVisible(full)) {
        fleetNotice = 'Naves: esperando espacio en los muelles';
      } else {
        const byId = new Map(ships.map(row => [row.id, row]));
        for (const id of settings.shipOrder) {
          if (!settings.shipMinimums[id]) continue;
          const counts = fleet.get(id);
          const deficit = fleetDeficit(id, counts);
          if (deficit === 0) continue;
          fleetNotice = 'Naves: esperando recursos, desbloqueo o hueco en la cola';
          const row = byId.get(id);
          const quantity = row ? prepareShip(row, deficit) : 0;
          if (!quantity) continue;
          const latest = fleetCounts(id);
          if (activeSystem !== systemId() || !latest || fleetDeficit(id, latest) < quantity) break;
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
    const DEFAULT_EVENTS = Object.fromEntries(EVENT_GROUPS.flatMap((group) =>
      group.entries.map(([type]) => [type, group.enabled])));
    const storageAvailable = typeof gmGet === 'function' && typeof gmSet === 'function';
    const telegramAvailable = storageAvailable && typeof gmRequest === 'function';
    const defaults = { browserEnabled: false, telegramEnabled: false, botToken: '', chatId: '', events: DEFAULT_EVENTS, eventsExpanded: false };
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

    function normalizeConfig(saved) {
      if (!saved || typeof saved !== 'object') return { ...defaults, events: { ...DEFAULT_EVENTS } };
      return {
        browserEnabled: saved.browserEnabled === true,
        telegramEnabled: saved.telegramEnabled === true,
        eventsExpanded: saved.eventsExpanded === true,
        botToken: validToken(saved.botToken) ? saved.botToken : '',
        chatId: validChat(saved.chatId) ? saved.chatId : '',
        events: Object.fromEntries(EVENT_TYPES.map((type) => [type,
          typeof saved.events?.[type] === 'boolean' ? saved.events[type] : DEFAULT_EVENTS[type]])),
      };
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
        if (!destinationChanged && !telegramChanged && !browserChanged && !eventsChanged
            && next.eventsExpanded === config.eventsExpanded) return;
        if (destinationChanged || (config.telegramEnabled && !next.telegramEnabled)) clearTelegramQueue();
        if (config.browserEnabled && !next.browserEnabled) clearBrowserQueue();
        config = next;
        dropFilteredQueueItems();
        if (destinationChanged || (telegramChanged && next.telegramEnabled)) {
          telegramBlocked = false;
          consecutiveFailures = 0;
          telegramStatus = 'Configuración actualizada desde el gestor.';
        }
        storageError = '';
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
        const meta = EVENT_META.get(type);
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

    function getDiagnostics() {
      return {
        destroyed,
        storageAvailable,
        storageError,
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
      test.disabled = !configured() || !!activeRequest || telegramQueue.some((item) => item.test);
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
      const content = [storageError, browserLine, telegramLine, pendingLine,
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
          <p class="notify-note">Los campos vacíos conservan lo guardado. Guardar no envía mensajes. Enviar prueba manda un mensaje al chat guardado.</p>
          <div class="notify-actions"><button class="notification-save" type="button">Guardar</button><button class="notification-test" type="button">Enviar prueba a Telegram</button></div>
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
      };
      const ui = mounted;
      ui.eventsDetails.addEventListener('toggle', () => {
        const open = ui.eventsDetails.open;
        if (open === config.eventsExpanded) return;
        refreshConfig();
        writeConfig({ ...config, eventsExpanded: open });
      });

      function saveFields(enableTelegram) {
        refreshConfig();
        if (enableTelegram === undefined) enableTelegram = config.telegramEnabled;
        const botToken = ui.token.value.trim() || config.botToken;
        const chatId = ui.chat.value.trim() || config.chatId;
        if ((botToken && !validToken(botToken)) || (chatId && !validChat(chatId))
            || (enableTelegram && (!validToken(botToken) || !validChat(chatId)))) {
          telegramStatus = 'Completa un token válido y un chat ID numérico o @canal; después pulsa Guardar.';
          updateUI();
          return false;
        }
        if (!writeConfig({ ...config, botToken, chatId, telegramEnabled: enableTelegram })) return false;
        ui.token.value = '';
        ui.chat.value = '';
        telegramBlocked = false;
        consecutiveFailures = 0;
        telegramStatus = 'Configuración guardada.';
        updateUI();
        armTelegram();
        return true;
      }

      query('.notification-save').addEventListener('click', () => saveFields());
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
        if (desired) saveFields(true);
        else if (writeConfig({ ...config, telegramEnabled: false })) {
          telegramStatus = 'Desactivado.';
          updateUI();
        }
      });
      ui.browser.addEventListener('change', () => {
        const desired = ui.browser.checked && permission() === 'granted';
        refreshConfig();
        writeConfig({ ...config, browserEnabled: desired });
        browserStatus = desired ? 'Activado.' : 'Desactivado.';
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
        if (ui.token.value.trim() || ui.chat.value.trim()) {
          telegramStatus = 'Guarda los cambios de los campos antes de enviar la prueba.';
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
        if (writeConfig({ ...config, botToken: '', chatId: '', telegramEnabled: false })) {
          ui.token.value = '';
          ui.chat.value = '';
          telegramBlocked = false;
          consecutiveFailures = 0;
          telegramStatus = 'Credenciales borradas; Telegram desactivado.';
          updateUI();
        }
      });
      container.appendChild(root);
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
      return { ...config, events: { ...config.events } };
    }

    function validateConfig(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || typeof value.browserEnabled !== 'boolean' || typeof value.telegramEnabled !== 'boolean'
          || typeof value.botToken !== 'string' || typeof value.chatId !== 'string'
          || (value.botToken && !validToken(value.botToken)) || (value.chatId && !validChat(value.chatId))
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
      return true;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
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
      return (round ? Math.round(value) : value).toLocaleString('es-ES', { maximumFractionDigits: 2 });
    }
    function count(value) {
      if (!object(value) || value.kind === 'unknown' || !finite(value.quantity)) return '???';
      return `${value.kind === 'approximate' || value.approximate === true ? '~' : ''}${number(value.quantity)}`;
    }
    function fleet(values) {
      if (!Array.isArray(values)) return '';
      const entries = values.slice(0, 16).filter(object).map((item) => {
        const name = shipNames[item.type] || clean(item.type, 40) || 'Tipo desconocido';
        return `${name} ${count(item)}`;
      });
      return entries.join(' · ') || '0';
    }
    function resources(value, fields) {
      if (!object(value)) return '';
      return fields.filter(([key]) => finite(value[key]))
        .map(([key, label]) => `${label} ${number(value[key], true)}`).join(' · ');
    }
    function locationText(value) {
      if (!object(value)) return '';
      const name = clean(value.name, 150);
      const coordinates = finite(value.q) && finite(value.r) ? `(${value.q}, ${value.r})` : '';
      const owner = clean(value.ownerName, 100);
      return [name || (coordinates ? '' : 'Desconocido'), coordinates, owner ? `Propietario: ${owner}` : '']
        .filter(Boolean).join(' · ');
    }
    function dateText(item, detail) {
      const time = item.takenAt ?? stamp(detail?.createdAt);
      if (time === null) return '';
      try {
        return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(time));
      } catch { return new Date(time).toISOString(); }
    }

    function reportEvent(item, detail = null, unavailable = '') {
      const route = object(detail?.route) ? detail.route : {};
      const sections = object(detail?.sections) ? detail.sections : {};
      const battle = object(sections.battle) ? sections.battle : null;
      const probe = object(sections.probe) ? sections.probe : null;
      const variant = object(detail?.variant) ? detail.variant : {};
      const lines = [];
      if (item.title) lines.push(item.title);
      if (item.verdict) lines.push(`Resultado: ${item.verdict}`);
      const date = dateText(item, detail);
      if (date) lines.push(`Fecha: ${date}`);
      const from = locationText(route.from), to = locationText(route.to);
      if (from) lines.push(`Origen: ${from}`);
      if (to) lines.push(`Destino: ${to}`);
      if (battle) {
        lines.push('');
        for (const [field, label] of [
          ['attackerShips', 'Flota atacante'], ['attackerLost', 'Pérdidas atacantes'],
          ['defenderShips', 'Flota defensora'], ['defenderLost', 'Pérdidas defensoras'],
        ]) {
          const text = fleet(battle[field]);
          if (text) lines.push(`${label}: ${text}`);
        }
        const loot = resources(battle.plundered, [['pa', 'Palladium'], ['ir', 'Iridium'], ['credits', 'Créditos']]);
        if (loot) lines.push(`Botín: ${loot}`);
        const loyalty = battle.loyaltyChange;
        if (object(loyalty)) {
          if (finite(loyalty.before) && finite(loyalty.after)) {
            lines.push(`Lealtad: ${number(loyalty.before)} → ${number(loyalty.after)}`);
          } else if (finite(loyalty.after)) lines.push(`Lealtad final: ${number(loyalty.after)}`);
          if (finite(loyalty.damageDealt)) lines.push(`Daño a la lealtad: ${number(loyalty.damageDealt)}`);
          if (loyalty.captured === true) lines.push(battle.targetOwnerKind === 'owned' ? 'Sistema perdido.' : 'Sistema capturado.');
        }
        if (battle.combatDeficit === true) lines.push('Fuerza de combate reducida por déficit de créditos.');
        if (finite(battle.defenderSectorBonusPct) && battle.defenderSectorBonusPct > 0) {
          lines.push(`Bonificación del defensor: ${number(battle.defenderSectorBonusPct)}%.`);
        }
      }
      if (probe) {
        lines.push('');
        if (probe.tier === 0) lines.push('Sondeo: todas las sondas perdidas; no se recuperó información.');
        else {
          lines.push(finite(probe.tier) ? `Inteligencia obtenida: nivel ${number(probe.tier)}.` : 'Inteligencia obtenida:');
          const intel = resources(probe, [['palladium', 'Palladium'], ['iridium', 'Iridium']]);
          if (intel) lines.push(`Recursos detectados: ${intel}`);
          if (Array.isArray(probe.buildings) && probe.buildings.length) {
            const buildings = probe.buildings.slice(0, 20).filter(object).map((entry) => {
              const name = buildingNames[entry.type] || clean(entry.type, 40) || 'Edificio desconocido';
              const level = finite(entry.level) ? `${entry.approximate === true ? '~' : ''}${number(entry.level)}` : '???';
              return `${name}: nivel ${level}`;
            });
            if (buildings.length) lines.push('Edificios detectados:', ...buildings);
          }
          if (Array.isArray(probe.inTransit) && probe.inTransit.length) lines.push(`En tránsito: ${fleet(probe.inTransit)}`);
          if (finite(probe.loyalty) && !battle?.loyaltyChange) lines.push(`Lealtad: ${number(probe.loyalty)}`);
        }
      }
      if (object(sections.incoming) && finite(sections.incoming.attackerIntelTier) && sections.incoming.attackerIntelTier > 0) {
        lines.push(`Información obtenida por el atacante: nivel ${number(sections.incoming.attackerIntelTier)}.`);
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
      // Reserve space for the notifier's heading and system line. Slice without
      // splitting UTF-16 surrogate pairs; final notifier also enforces 4096.
      if (message.length > 3600) {
        let clipped = message.slice(0, 3560);
        if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
        message = `${clipped}\n[Resumen recortado]`;
      }
      const defensive = object(sections.incoming) || variant.kind === 'capture_loss'
        || battle?.targetOwnerKind === 'owned' || variant.shipmentRole === 'recipient';
      const context = defensive ? route.to : route.from?.ownerKind === 'owned' ? route.from : null;
      return { type: 'game.reports', id: `report:${item.id}`, title: 'Old Light',
        systemName: clean(context?.name, 150), message };
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
      bridge_lost: 'Se perdió la conexión con la ventana. Vuelve a abrir Google Drive.',
      timeout: 'La operación tardó demasiado. Comprueba la lista antes de repetir una copia.',
      rate_limit: 'Google ha limitado las solicitudes. La copia automática está detenida.',
      api_denied: 'Google rechazó la petición. Comprueba que Drive API esté activada y que el permiso siga concedido.',
      upload_uncertain: 'No se confirmó la copia. Actualiza la lista de Drive antes de repetir.',
      invalid_backup: 'La copia no es válida o supera 1 MiB.',
      busy: 'Espera a que termine la operación actual.',
      failed: 'No se pudo completar la operación. Revisa la ventana de Drive.',
      config_saved: 'Configuración de Drive guardada. Guardar no inicia una copia.',
      storage_error: 'No se pudo guardar la configuración de Drive.',
    };

    if (typeof getBackup !== 'function' || typeof applyBackup !== 'function' ||
        typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function') {
      throw new TypeError('Faltan las funciones de almacenamiento o copia.');
    }

    let config;
    try {
      const stored = gmGetValue(STORAGE_KEY, { clientId: '', autoBackup: false });
      if (stored && typeof stored.then === 'function') {
        throw new TypeError('createDriveBackup necesita GM_getValue síncrono.');
      }
      config = validateConfig(stored);
    } catch (error) {
      if (error instanceof TypeError && /síncrono/.test(error.message)) throw error;
      config = { clientId: '', autoBackup: false };
    }

    let destroyed = false;
    let session = null;
    let mountNode = null;
    let inputs = null;
    let statusCode = config.clientId ? 'disconnected' : 'missing_client';
    let applying = false;
    let configDeferred = false;
    let suppressChangedUntil = 0;
    let configRevision = 0;

    function validateConfig(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('La configuración de Drive debe ser un objeto.');
      }
      const clientId = value.clientId === undefined ? '' : value.clientId;
      const autoBackup = value.autoBackup === undefined ? false : value.autoBackup;
      if (typeof clientId !== 'string' || typeof autoBackup !== 'boolean') {
        throw new TypeError('Client ID o copia automática inválidos.');
      }
      const trimmed = clientId.trim();
      if (trimmed && (trimmed.length > 300 ||
          !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(trimmed))) {
        throw new TypeError('El Client ID de Google no tiene un formato válido.');
      }
      return { clientId: trimmed, autoBackup };
    }

    function exportConfig() {
      return { clientId: config.clientId, autoBackup: config.autoBackup };
    }

    function report(code) {
      if (destroyed) return;
      statusCode = Object.hasOwn(LABELS, code) ? code : 'failed';
      if (inputs) inputs.status.textContent = LABELS[statusCode];
      try { onStatus?.({ code: statusCode, message: LABELS[statusCode] }); } catch (_) { /* caller UI */ }
    }

    function refreshControls() {
      if (!inputs) return;
      inputs.client.value = config.clientId;
      inputs.auto.checked = config.autoBackup;
      inputs.open.disabled = !config.clientId;
      inputs.close.disabled = !session;
      inputs.status.textContent = LABELS[statusCode];
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
      send(session, { type: 'config', config: exportConfig(), revision: configRevision });
    }

    function importConfig(value) {
      const next = validateConfig(value);
      if (destroyed) throw new Error('El módulo de Drive está cerrado.');
      const written = gmSetValue(STORAGE_KEY, { ...next });
      if (written && typeof written.then === 'function') {
        throw new TypeError('createDriveBackup necesita GM_setValue síncrono.');
      }
      const changed = next.clientId !== config.clientId || next.autoBackup !== config.autoBackup;
      if (next.clientId !== config.clientId) configRevision += 1;
      config = next;
      if (!session) report(config.clientId ? 'disconnected' : 'missing_client');
      refreshControls();
      if (changed) sendConfig();
      return exportConfig();
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
      if (message.type === 'port-ready' && !current.ready) {
        current.ready = true;
        clearTimeout(current.openTimeout);
        sendConfig();
        report('bridge_ready');
        return;
      }
      if (!current.ready) return;
      if (message.type === 'ping') { send(current, { type: 'pong' }); return; }
      if (message.type === 'bye') { closeSession('disconnected'); return; }
      if (message.type === 'status') {
        if (typeof message.code === 'string' && Object.hasOwn(LABELS, message.code)) report(message.code);
        return;
      }
      if (message.type !== 'get-backup' && message.type !== 'apply-backup') return;
      if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(message.id)) return;
      if (message.revision !== configRevision) {
        send(current, { type: 'reply', id: message.id, ok: false, error: 'expired' });
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
      channel.port1.onmessageerror = () => closeSession('bridge_lost');
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
      if (!config.clientId) { report('missing_client'); return; }
      if (session?.popup && !session.popup.closed) {
        try { session.popup.focus(); } catch (_) { /* focus is best effort */ }
        return;
      }
      closeSession();
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const nonce = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      // The nonce is public session routing data. Settings never enter this URL.
      const current = { nonce, popup: null, port: null, ready: false, serving: false };
      session = current;
      try {
        current.popup = window.open(`${HELPER_URL}#bridge=${nonce}`, '_blank',
          'popup,width=720,height=820,resizable=yes,scrollbars=yes');
      } catch (_) { /* blocked */ }
      if (!current.popup) { closeSession('popup_blocked'); return; }
      current.openTimeout = setTimeout(() => {
        if (session === current && !current.ready) closeSession('bridge_lost');
      }, 20000);
      current.closedCheck = setInterval(() => {
        if (session === current && current.popup.closed) closeSession('disconnected');
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
      mountNode?.remove();
      const box = element('section', undefined, { className: 'oldlight-drive-config' });
      box.append(element('h4', 'Copia opcional en Google Drive'));
      const clientLabel = element('label', 'Client ID de Google OAuth');
      const client = element('input', undefined, { type: 'text', maxLength: 300,
        autocomplete: 'off', spellcheck: false, placeholder: '…apps.googleusercontent.com' });
      clientLabel.append(client);
      const autoLabel = element('label');
      const auto = element('input', undefined, { type: 'checkbox' });
      autoLabel.append(auto, document.createTextNode(' Copia automática de los cambios locales'));
      const note = element('p', 'Requiere un Client ID propio con origen autorizado ' + HELPER_ORIGIN +
        '. La copia automática sólo funciona con la ventana de Drive abierta y la autorización vigente.');
      const controls = element('div', undefined, { className: 'oldlight-drive-controls' });
      const save = element('button', 'Guardar configuración', { type: 'button' });
      const open = element('button', 'Abrir Google Drive', { type: 'button' });
      const close = element('button', 'Desconectar', { type: 'button' });
      const status = element('p');
      status.setAttribute('role', 'status');
      controls.append(save, open, close);
      box.append(clientLabel, autoLabel, note, controls, status);
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const next = validateConfig({ clientId: client.value, autoBackup: auto.checked });
          await importConfig(next);
          report('config_saved');
        } catch (_) {
          report('storage_error');
        } finally { save.disabled = false; }
      });
      open.addEventListener('click', openCompanion);
      close.addEventListener('click', () => closeSession());
      inputs = { client, auto, open, close, status };
      mountNode = box;
      container.append(box);
      refreshControls();
      return box;
    }

    function destroy() {
      if (destroyed) return;
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

  // Observa eventos nuevos del HUD; no reenvía historial al cargar/cambiar de pestaña.
  function createGameEventObserver(send) {
    let observing = false;
    let baseline = null;
    let seenToasts = new WeakSet();
    let unread = new Map();

    function snapshot(current) {
      return {
        system: systemId(),
        levels: new Map(current.map(row => {
          const match = /^Lvl\s+(\d+)$/i.exec(text(row.row.querySelector('.b-level')));
          return [row.id, match ? Number(match[1]) : null];
        })),
        fleet: new Map(SHIPS.map(([id]) => [id, fleetCounts(id)])),
      };
    }

    return function observe(current, active, reportApiAvailable = false) {
      if (!active) { observing = false; baseline = null; return; }
      const next = snapshot(current);
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
        gmGetValue: GM_getValue, gmSetValue: GM_setValue });
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
    ui?.cancelPriorityDrag?.();
    ui?.cancelPanelDrag?.();
    settings = readSettings();
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
