// ==UserScript==
// @name         Old Light Auto Upgrade
// @namespace    old-light-auto-upgrade
// @version      1.0.1
// @description  Mejora los edificios seleccionados en cuanto el juego habilita sus botones. Incluye pausa y selección de edificios.
// @match        https://oldlight.io/*
// @homepageURL  https://github.com/alexx-ftw/old-light-auto-upgrade
// @supportURL   https://github.com/alexx-ftw/old-light-auto-upgrade/issues
// @updateURL    https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.meta.js
// @downloadURL  https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.user.js
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // Abre Structures y deja la pestaña cargada. Se usan los botones normales
  // del juego: actúan sobre los sistemas que tengas seleccionados.
  // Se elige el primer edificio habilitado en el orden de la lista del juego.
  // No se modifica ningún botón deshabilitado ni se llama a APIs del juego.

  const KEY = 'old-light-auto-upgrade:v1';
  const HOST_ID = 'old-light-auto-upgrade-panel';
  const PANEL = '#hud-panel-structures';
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
  const MIN_GAP_MS = 500;
  const RESPONSE_TIMEOUT_MS = 12000;
  const RETRY_GAP_MS = 5000;
  const MAX_UNCONFIRMED = 3;

  if (window.top !== window.self || document.getElementById(HOST_ID)) return;

  let settings = readSettings();
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

  function readSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        enabled: value?.enabled !== false,
        excluded: Array.isArray(value?.excluded)
          ? value.excluded.filter(id => BUILDINGS.some(([known]) => known === id)) : [],
        expanded: value?.expanded === true,
      };
    } catch {
      return { enabled: true, excluded: [], expanded: false };
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

  function isAvailable(button) {
    return isVisible(button) && !button.matches(':disabled') &&
      !button.classList.contains('b-loading') &&
      button.getAttribute('aria-disabled') !== 'true';
  }

  function rows() {
    return [...document.querySelectorAll(BUTTONS)].map(button => {
      const row = button.closest('.building-row');
      const id = button.dataset.tutorial.slice('upgrade-'.length);
      const target = text(button);
      const level = /^lvl\s+(\d+)\b/i.exec(target);
      return {
        id, button,
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

  function batchSummary() {
    return document.querySelector(`${PANEL} .b-batch-report .b-batch-summary`);
  }

  function batchApplied(request) {
    const summary = batchSummary();
    // El juego crea un nodo nuevo por respuesta, aunque repita el mismo texto.
    if (!summary || summary === request.batchSummary || !isVisible(summary)) return null;
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
          section { width:244px; max-width:calc(100vw - 24px); padding:11px 12px;
            color:#d8e5ef; background:#101923f5; border:1px solid #40566b;
            border-radius:10px; box-shadow:0 5px 24px #0005; }
          header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
          strong { color:#f2f7fa; font-size:13px; }
          button { font:inherit; cursor:pointer; color:#9ce9b9; background:#21382c;
            border:1px solid #426a51; border-radius:6px; padding:3px 9px; }
          button[aria-pressed="false"] { color:#cbd5df; background:#263340; border-color:#566575; }
          button:focus-visible, summary:focus-visible { outline:2px solid #8cc8ff; outline-offset:3px; }
          p { margin:8px 0 0; overflow-wrap:anywhere; }
          small { display:block; color:#93a9bb; margin-top:5px; overflow-wrap:anywhere; }
          small:empty { display:none; }
          details { margin-top:8px; border-top:1px solid #304252; padding-top:7px; }
          summary { cursor:pointer; color:#aebfd0; }
          .choices { display:grid; gap:5px; padding-top:8px; }
          label { display:flex; align-items:center; gap:7px; cursor:pointer; }
          input { accent-color:#80ccab; margin:0; }
          .hint { color:#8298aa; font-size:11px; margin-top:8px; }
        </style>
        <section aria-label="Mejoras automáticas de Old Light">
          <header><strong>Auto ↑</strong><button type="button" aria-pressed="true"></button></header>
          <p role="status"></p><small></small>
          <details><summary>Edificios</summary><div class="choices"></div>
            <p class="hint">Primer edificio disponible, por orden de la lista. Actúa sobre los sistemas seleccionados.</p>
          </details>
        </section>`;
      ui = {
        toggle: shadow.querySelector('button'),
        status: shadow.querySelector('[role="status"]'),
        last: shadow.querySelector('small'),
        details: shadow.querySelector('details'),
        choices: shadow.querySelector('.choices'),
      };
      for (const [id, name] of BUILDINGS) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = id;
        label.append(input, document.createTextNode(name));
        ui.choices.append(label);
        input.addEventListener('change', () => {
          settings.excluded = BUILDINGS.map(([key]) => key).filter(key =>
            ![...ui.choices.querySelectorAll('input')].some(item => item.value === key && item.checked));
          saveSettings();
          schedule();
        });
      }
      ui.toggle.addEventListener('click', () => {
        settings.enabled = !settings.enabled;
        if (settings.enabled) { error = ''; unconfirmed = 0; }
        saveSettings();
        schedule();
      });
      ui.details.addEventListener('toggle', () => {
        if (settings.expanded === ui.details.open) return;
        settings.expanded = ui.details.open;
        saveSettings();
      });
    }
    document.body.append(host);
  }

  function show(message) {
    if (!ui) return;
    setText(ui.toggle, settings.enabled ? 'Activo' : 'Pausado');
    ui.toggle.setAttribute('aria-pressed', String(settings.enabled));
    ui.toggle.title = settings.enabled ? 'Pausar mejoras automáticas' : 'Reanudar mejoras automáticas';
    setText(ui.status, message);
    setText(ui.last, lastClick ? `Último clic: ${lastClick}` : '');
    if (ui.details.open !== settings.expanded) ui.details.open = settings.expanded;
    for (const input of ui.choices.querySelectorAll('input')) {
      input.checked = !settings.excluded.includes(input.value);
    }
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
    if (pending) return;
    if (releaseLock) releaseLock();
    else leader = false;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // No usa requestAnimationFrame: debe reaccionar también en segundo plano.
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
    if (!panel || !document.body) {
      // Si la página desmonta el panel durante una petición, conserva el bloqueo
      // hasta que se agote su plazo para no enviar otro clic desde otra pestaña.
      if (pending && Date.now() - pending.started >= RESPONSE_TIMEOUT_MS) pending = null;
      releaseLeadership();
      if (host && !host.hidden) host.hidden = true;
      return;
    }
    mount();
    if (host.hidden) host.hidden = false;
    const current = rows();
    const now = Date.now();

    if (pending) {
      const row = current.find(item => item.id === pending.id);
      const loading = !row || row.button.classList.contains('b-loading');
      const applied = loading ? null : batchApplied(pending);
      const targetAdvanced = row?.targetLevel !== null && pending.targetLevel !== null &&
        row?.targetLevel > pending.targetLevel;
      if (!loading && (applied > 0 || (applied === null &&
          (targetAdvanced || queueLength() > pending.queueLength)))) {
        pending = null;
        unconfirmed = 0;
        nextClickAt = Math.max(nextClickAt, now + MIN_GAP_MS);
      } else if (applied === 0) {
        // Una respuesta de lote sin mejoras no es una confirmación de éxito.
        // Da tiempo a actualizar recursos/colas y sigue esperando disponibilidad.
        pending = null;
        nextClickAt = now + RETRY_GAP_MS;
      } else if (now - pending.started >= RESPONSE_TIMEOUT_MS) {
        const name = pending.name;
        pending = null;
        unconfirmed += 1;
        nextClickAt = now + RETRY_GAP_MS;
        if (unconfirmed >= MAX_UNCONFIRMED) {
          settings.enabled = false;
          error = `Sin confirmación de ${name}. Reanuda para reintentar.`;
          saveSettings();
        }
      } else {
        show(settings.enabled ? `Esperando respuesta: ${pending.name}…` : 'Pausado. Último clic enviado.');
        wakeAt(pending.started + RESPONSE_TIMEOUT_MS);
        return;
      }
    }

    if (!settings.enabled) { releaseLeadership(); show(error || 'Mejoras automáticas pausadas'); return; }
    if (!isVisible(panel)) { releaseLeadership(); show('Abre Structures para continuar'); return; }
    if (!current.length) { releaseLeadership(); show('Selecciona uno de tus sistemas'); return; }
    if (settings.excluded.length === BUILDINGS.length) { releaseLeadership(); show('Marca algún edificio'); return; }
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
    if (current.some(row => row.button.classList.contains('b-loading'))) {
      show('Esperando una petición de mejora en curso…');
      return;
    }

    const candidate = current.find(row => !settings.excluded.includes(row.id) && isAvailable(row.button));
    if (!candidate) { show('Esperando recursos o hueco en la cola…'); return; }

    // Registra la petición ANTES del clic: el juego puede actualizarse de forma síncrona.
    pending = { ...candidate, started: now, queueLength: queueLength(), batchSummary: batchSummary() };
    nextClickAt = now + MIN_GAP_MS;
    lastClick = `${candidate.name} · ${candidate.target}`;
    show(`Mejorando ${candidate.name}…`);
    try {
      candidate.button.click();
    } catch (cause) {
      pending = null;
      settings.enabled = false;
      error = 'No se pudo pulsar la mejora. Reanuda para reintentar.';
      saveSettings();
      releaseLeadership();
      show(error);
      console.warn('[Old Light Auto Upgrade]', cause);
    }
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
    attributeFilter: ['disabled', 'aria-disabled', 'aria-hidden', 'hidden', 'inert', 'class', 'style', 'data-tutorial'],
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
