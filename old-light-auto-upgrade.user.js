// ==UserScript==
// @name         Old Light Auto Upgrade
// @namespace    old-light-auto-upgrade
// @version      1.1.0
// @description  Mejoras por prioridad, Reactor y Depot según necesidad, mínimos de naves y avisos por Telegram/navegador. Con actualización automática.
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
  // Nunca elimina hidden/disabled ni llama a APIs del juego.

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
  const notifier = createNotifier();
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
      title: systemName ? `Old Light · ${systemName}` : 'Old Light', message });
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

  function readSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        enabled: value?.enabled !== false,
        excluded: Array.isArray(value?.excluded)
          ? [...new Set(value.excluded.filter(id => DEFAULT_ORDER.includes(id)))] : [],
        order: normalizeOrder(value?.order),
        expanded: value?.expanded === true,
        shipMinimums: Object.fromEntries(SHIPS.map(([id]) => [id, normalizeMinimum(value?.shipMinimums?.[id])])),
        shipOrder: normalizeOrder(value?.shipOrder, DEFAULT_SHIP_ORDER),
        countAway: value?.countAway === true,
        fleetExpanded: value?.fleetExpanded === true,
        depotFillPercent: typeof value?.depotFillPercent === 'number' && Number.isFinite(value.depotFillPercent)
          ? Math.min(100, Math.max(1, Math.round(value.depotFillPercent))) : 90,
      };
    } catch {
      return { enabled: true, excluded: [], order: [...DEFAULT_ORDER], expanded: false,
        shipMinimums: Object.fromEntries(SHIPS.map(([id]) => [id, 0])),
        shipOrder: [...DEFAULT_SHIP_ORDER], countAway: false, fleetExpanded: false, depotFillPercent: 90 };
    }
  }

  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {
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
          section { width:300px; max-width:calc(100vw - 24px); max-height:calc(100dvh - 24px);
            overflow-y:auto; padding:11px 12px;
            color:#d8e5ef; background:#101923f5; border:1px solid #40566b;
            border-radius:10px; box-shadow:0 5px 24px #0005; }
          header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
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
          .priority-row { display:grid; grid-template-columns:12px minmax(0,1fr) auto;
            align-items:center; gap:6px; }
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
        <section aria-label="Mejoras automáticas de Old Light">
          <header><strong>Auto ↑</strong><button type="button" aria-pressed="true"></button></header>
          <p role="status"></p><small></small>
          <details><summary>Edificios</summary>
            <div class="choices" role="list" aria-label="Prioridad de edificios"></div>
            <button type="button" class="reset-order">Restablecer orden</button>
            <p class="hint">Prioridad de arriba abajo. Se mejora el primero disponible entre los marcados.</p>
            <p class="hint">Reactor solo si otra mejora marcada necesita más energía. Cada Reactor o Depot espera al anterior en cola.</p>
            <label class="depot-threshold">Depot al alcanzar <input type="number" min="1" max="100" step="1"
              data-setting="depot-fill-percent" aria-label="Porcentaje de capacidad para mejorar Resource Depot">% de capacidad</label>
          </details>
          <details class="fleet-details"><summary>Mínimos de naves</summary>
            <p class="hint">Mínimo por tipo en el sistema seleccionado. 0 desactiva su reposición.</p>
            <div class="fleet-choices" role="list" aria-label="Mínimos y prioridad de naves"></div>
            <label class="count-away"><input type="checkbox">Contar también las naves en misión</label>
            <button type="button" class="reset-ships">Restablecer orden de naves</button>
            <p class="hint">Se descuentan las naves ya en construcción. La reposición disponible tiene prioridad sobre las mejoras.</p>
          </details>
        </section>`;
      ui = {
        toggle: shadow.querySelector('button'),
        status: shadow.querySelector('[role="status"]'),
        last: shadow.querySelector('small'),
        details: shadow.querySelector('details'),
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
        item.append(position, label, actions);
        ui.choices.append(item);
        ui.items.set(id, { item, position, input, up, down, name });
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
      ui.fleetDetails.addEventListener('toggle', () => {
        if (settings.fleetExpanded === ui.fleetDetails.open) return;
        settings.fleetExpanded = ui.fleetDetails.open;
        saveSettings();
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
        emitEvent(settings.enabled ? 'automation.resumed' : 'automation.paused',
          settings.enabled ? 'Mejoras y reposición reanudadas.' : 'Mejoras y reposición pausadas.');
        schedule();
      });
      ui.details.addEventListener('toggle', () => {
        if (settings.expanded === ui.details.open) return;
        settings.expanded = ui.details.open;
        saveSettings();
      });
      notifier.mount(shadow.querySelector('section'));
    }
    document.body.append(host);
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
    if (ui.details.open !== settings.expanded) ui.details.open = settings.expanded;
    if (ui.fleetDetails.open !== settings.fleetExpanded) ui.fleetDetails.open = settings.fleetExpanded;
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
    observeGameEvents(current, leader && observeNotifications);

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
    const storageAvailable = typeof gmGet === 'function' && typeof gmSet === 'function';
    const telegramAvailable = storageAvailable && typeof gmRequest === 'function';
    const defaults = { browserEnabled: false, telegramEnabled: false, botToken: '', chatId: '' };
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
      rateRetries: 0,
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
      if (!saved || typeof saved !== 'object') return { ...defaults };
      return {
        browserEnabled: saved.browserEnabled === true,
        telegramEnabled: saved.telegramEnabled === true,
        botToken: validToken(saved.botToken) ? saved.botToken : '',
        chatId: validChat(saved.chatId) ? saved.chatId : '',
      };
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
      storageError = '';
      updateUI();
      return true;
    }

    function refreshConfig() {
      if (destroyed || !storageAvailable) return;
      try {
        const next = normalizeConfig(gmGet(CONFIG_KEY, null));
        const destinationChanged = next.botToken !== config.botToken || next.chatId !== config.chatId;
        const telegramChanged = next.telegramEnabled !== config.telegramEnabled;
        const browserChanged = next.browserEnabled !== config.browserEnabled;
        if (!destinationChanged && !telegramChanged && !browserChanged) return;
        if (destinationChanged || (config.telegramEnabled && !next.telegramEnabled)) clearTelegramQueue();
        if (config.browserEnabled && !next.browserEnabled) clearBrowserQueue();
        config = next;
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
      return !destroyed && (config.browserEnabled || config.telegramEnabled);
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
          if (item.retries < MAX_429_RETRIES && Number.isFinite(nextTelegramAt)) {
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
        const title = plain(event.title || 'Old Light', 500);
        const message = plain(event.message || '', 4096);
        const type = plain(event.type || 'event', 120);
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
        const item = { key, title, message, text: plain('[Old Light] ' + title + '\n' + message, 4096), retries: 0 };
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
      const { root, browser, telegram, permit, token, chat, test, status } = mounted;
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
          .notifications-details .notify-note{margin:0;font-size:11px;line-height:1.4;opacity:.85}
          .notifications-details .notify-status{margin:0;white-space:pre-line;font-size:11px;line-height:1.45}
          .notifications-details :focus-visible{outline:2px solid #97c8ff;outline-offset:2px}
        </style>
        <summary>Notificaciones</summary>
        <div class="notify-body">
          <label><input class="notification-browser-toggle" type="checkbox"> Avisos del navegador</label>
          <button class="notification-permission" type="button">Permitir avisos del navegador</button>
          <label><input class="notification-telegram-toggle" type="checkbox"> Avisos por Telegram</label>
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
      };
      const ui = mounted;

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
          text: '[Old Light] Prueba de notificaciones. Telegram está configurado para recibir tus avisos.',
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

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearBrowserQueue();
      clearTelegramQueue();
      mounted?.root.remove();
      mounted = null;
    }

    return Object.freeze({ emit, isEnabled, mount, getDiagnostics, destroy, get status() { return getDiagnostics(); } });
  }
  // END NOTIFIER

  // Observa eventos nuevos del HUD; no reenvía historial al cargar/cambiar de pestaña.
  function createGameEventObserver(send) {
    let observing = false;
    let baseline = null;
    let seenToasts = new WeakSet();
    let unread = new Map();

    function readUnread(kind) {
      const button = document.querySelector(`#${kind}-btn`);
      const label = button?.getAttribute('aria-label') || button?.getAttribute('title') || '';
      const match = new RegExp(`^Open ${kind}(?:, (\\d+) unread)?$`).exec(label);
      return match ? Number(match[1] || 0) : null;
    }

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

    return function observe(current, active) {
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
          if (previous !== null && previous !== undefined && count > previous) {
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
    settings = readSettings();
    if (settings.enabled) { error = ''; unconfirmed = 0; }
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('focus', schedule);
  // Respaldo para carga tardía, plazos de respuesta y recuperación de pestañas.
  setInterval(schedule, 1000);
  schedule();
})();
