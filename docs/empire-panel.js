/* Isolated empire dashboard. Its callback saves preferences, never game orders. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OldLightEmpirePanel = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const LABELS = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };
  const ROLES = { balanced: 'Equilibrado', industry: 'Industria', shipyard: 'Astillero', defense: 'Defensa' };
  const ROLE_HELP = {
    balanced: 'Equilibrado mantiene tu orden de edificios y participa en el reparto de nuevos objetivos de flota.',
    industry: 'Industria prioriza extractores, almacén y reactor. No recibe nuevos pedidos por los objetivos imperiales de flota.',
    shipyard: 'Astillero prioriza astillero, centro de mando, reactor y almacén. Participa en el reparto de flota, sin más peso que Equilibrado.',
    defense: 'Defensa prioriza centro de mando, almacén y reactor. No recibe nuevos pedidos por los objetivos imperiales de flota ni activa defensa militar.',
  };
  let panelSequence = 0;
  const REASONS = {
    'invalid-context': 'Falta identificar la cuenta y la galaxia.',
    'invalid-roster': 'Falta verificar la lista completa de sistemas propios.',
    'missing-snapshots': 'Faltan datos de algunos sistemas.',
    'stale-snapshots': 'Hay datos antiguos pendientes de actualizar.',
    'unknown-measurements': 'Hay recursos, colas o flotas sin datos exactos.',
    'unsynchronized-fleet': 'La flota aún no tiene un recuento sincronizado.',
    'unverified-ownership': 'No se ha podido verificar la propiedad de todos los sistemas.',
    'duplicate-snapshots': 'Hay observaciones duplicadas; se han bloqueado los pedidos.',
    'invalid-snapshots': 'Hay observaciones no válidas; se han bloqueado los pedidos.',
    'malformed-snapshots': 'Hay observaciones no válidas; se han bloqueado los pedidos.',
    'no-production-systems': 'El objetivo necesita un sistema de rol Equilibrado o Astillero.',
    'targets-met': 'Los objetivos de flota están cubiertos.',
    ready: 'Datos completos; reparto calculado.', disabled: 'Modo imperio desactivado.',
  };
  const CSS = `
.oldlight-empire{font:13px/1.45 system-ui,sans-serif;color:#e5eef6;background:#0c141d;border:1px solid #456177;border-radius:12px;padding:14px;box-sizing:border-box;max-width:100%;color-scheme:dark;container:empire-panel / inline-size}
.oldlight-empire *{box-sizing:border-box}.oldlight-empire h2{font-size:18px;margin:0}.oldlight-empire h3{font-size:14px;margin:0 0 9px}.oldlight-empire p{margin:7px 0}.oldlight-empire button,.oldlight-empire select,.oldlight-empire input{font:inherit;min-height:38px;border-radius:7px;border:1px solid #456177;background:#152432;color:inherit;padding:7px;max-width:100%}.oldlight-empire input[type=checkbox]{min-height:20px}.oldlight-empire button{cursor:pointer}.oldlight-empire button:disabled{cursor:not-allowed;opacity:.55}.oldlight-empire :focus-visible{outline:2px solid #7edec0;outline-offset:2px}.oldlight-empire .empire-head{display:flex;align-items:center;gap:8px;justify-content:space-between}.oldlight-empire .empire-hint{font-size:12px;color:#aebdcc}.oldlight-empire .empire-status{border:1px solid #55715f;border-radius:8px;padding:9px;background:#172c28}.oldlight-empire .empire-warning{color:#ffcf8e}.oldlight-empire .empire-error{color:#ffaeae}.oldlight-empire .empire-goals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.oldlight-empire .empire-goals label{display:grid;gap:4px}.oldlight-empire .empire-goals input{width:100%}.oldlight-empire .empire-card{border:1px solid #344c60;border-radius:9px;padding:10px;margin-top:9px}.oldlight-empire .empire-card[data-stale=true]{border-style:dashed}.oldlight-empire .empire-card h3{overflow-wrap:anywhere}.oldlight-empire .empire-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.oldlight-empire .empire-controls label{display:flex;gap:5px;align-items:center}.oldlight-empire .empire-numbers{font-variant-numeric:tabular-nums;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0}.oldlight-empire .empire-numbers div{padding:7px;background:#111f2b;border-radius:6px;overflow-wrap:anywhere}.oldlight-empire .empire-numbers small{display:block;color:#aebdcc}.oldlight-empire .empire-fleets{display:grid;gap:3px;font-size:12px;color:#bdcbd7}.oldlight-empire .empire-progress{font-size:12px;color:#b1dccf}.oldlight-empire .empire-empty{padding:14px 0;color:#aebdcc}.oldlight-empire[hidden]{display:none}
.oldlight-empire .empire-head{flex-wrap:wrap}.oldlight-empire .empire-head>*{min-width:0;overflow-wrap:anywhere}.oldlight-empire .empire-goals label{min-width:0;overflow-wrap:anywhere}.oldlight-empire .empire-goals input{min-width:0}.oldlight-empire .empire-edit-status{display:block;font-size:11px;line-height:1.45;margin:0;color:#aebdcc;overflow-wrap:anywhere}.oldlight-empire .empire-edit-status:empty{display:none}.oldlight-empire .empire-edit-status[data-state=invalid],.oldlight-empire .empire-edit-status[data-state=error]{color:#ffaeae}.oldlight-empire .empire-edit-status[data-state=draft]{color:#ffcf8e}.oldlight-empire .empire-edit-status[data-state=saved]{color:#7edec0}.oldlight-empire [aria-invalid=true]{border-color:#ffaeae}.oldlight-empire :is(.empire-help,.empire-recovery){margin:12px 0;padding:9px 10px;border:1px solid #344c60;border-radius:8px;background:#111f2b}.oldlight-empire :is(.empire-help,.empire-recovery) summary,.oldlight-empire .empire-role-details summary{cursor:pointer;min-height:28px;padding:4px 0;font-weight:600;overflow-wrap:anywhere}.oldlight-empire .empire-controls select{min-width:0}.oldlight-empire .empire-controls label{max-width:100%;flex-wrap:wrap}.oldlight-empire .empire-systems-heading{margin-top:16px}.oldlight-empire .empire-role-details{font-size:12px;color:#aebdcc;margin-top:6px}
@container empire-panel (max-width:340px){.oldlight-empire .empire-head{align-items:flex-start;flex-direction:column}.oldlight-empire .empire-goals,.oldlight-empire .empire-numbers{grid-template-columns:minmax(0,1fr)}}
@media(pointer:coarse){.oldlight-empire button,.oldlight-empire select,.oldlight-empire input:not([type=checkbox]),.oldlight-empire :is(.empire-help,.empire-recovery) summary,.oldlight-empire .empire-role-details summary{min-height:44px}}
@media(max-width:400px){.oldlight-empire{padding:10px}.oldlight-empire button,.oldlight-empire select,.oldlight-empire input{min-height:44px}.oldlight-empire .empire-head{align-items:flex-start;flex-direction:column}}
`;
  // Reuse the formatter: constructing locale machinery per resource/ship on
  // every native tick dominated dashboard time for larger empires.
  const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
  const num = value => typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '?';
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attribute = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
  const property = (node, key, value) => { if (node[key] !== value) node[key] = value; };
  function create({ document, core, getState, setConfig, canEnable = () => false, getRecovery = () => null, isVisible = () => true, now = Date.now }) {
    let recoveryHelp, recoveryReason, recoveryStart, recoveryKey = '';
    let root, style, status, toggle, total, fleetSummary, productionSummary, error, list, empty, overview;
    const panelId = ++panelSequence;
    let helpSequence = 0;
    const inputs = new Map(), goalStatuses = new Map(), cards = new Map(), goalEdits = new Map(), goalFeedback = new Map();
    let renderedScope = null, observedScope = null, scopeEpoch = 0, saveSequence = 0;
    let destroyed = false;
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
    function save(next, validEdit = () => true) {
      if (destroyed) return null;
      const epoch = scopeEpoch, sequence = ++saveSequence, scope = renderedScope;
      const current = () => {
        if (destroyed) return false;
        observeScope(getState().scope);
        return epoch === scopeEpoch && scope === renderedScope && validEdit();
      };
      let saved = false, failure = '';
      try {
        const result = setConfig(next);
        if (result?.then) {
          // This callback contract is synchronous. Consume an eventual rejection
          // without claiming success or applying completion to another scope.
          Promise.resolve(result).catch(() => {});
          throw new Error('Se necesita guardado síncrono confirmado.');
        }
        saved = true;
      } catch (cause) { failure = cause?.message || 'No se pudo guardar la configuración.'; }
      if (!current()) { render(); return null; }
      // A newer save owns the shared alert, but another goal may still finish
      // its own unchanged edit. Do not strand that field in Guardando… .
      if (sequence === saveSequence) text(error, failure);
      render();
      return current() ? saved : null;
    }
    function editFeedback(id, state, message, value, baseline = goalEdits.get(id)?.baseline) {
      const node = goalFeedback.get(id);
      if (destroyed || !node) return;
      property(node.dataset, 'state', state); text(node, message);
      if (state) goalEdits.set(id, { state, value, baseline }); else goalEdits.delete(id);
    }
    // Integration supplies the already-read identity even when this panel is
    // hidden. This clears A -> B -> A drafts without reading or aggregating a
    // hidden census, and does not grant permission to save or act.
    function observeScope(scope) {
      if (destroyed || observedScope === scope) return;
      observedScope = scope; scopeEpoch++;
      if (recoveryHelp) { property(recoveryHelp, 'open', false); recoveryKey = ''; }
      if (renderedScope === scope) return;
      renderedScope = null; goalEdits.clear();
      if (error) text(error, '');
      for (const [id, input] of inputs) { input.removeAttribute('aria-invalid'); editFeedback(id, '', ''); }
    }
    function currentScope() {
      if (destroyed) return false;
      const scope = getState().scope;
      if (scope !== renderedScope) { observeScope(scope); render(); return false; }
      return typeof scope === 'string' && scope.length > 0;
    }
    function policy(change) { const state = getState(); return { ...core.normalizeConfig(state.config), ...change }; }
    function cardFor(id) {
      if (cards.has(id)) return cards.get(id);
      const card = el('article', undefined, 'empire-card'); card.dataset.systemId = id;
      const name = el('h3'), age = el('p', '', 'empire-hint'), controls = el('div', undefined, 'empire-controls');
      const roleLabel = el('label', 'Rol '), role = el('select'); role.setAttribute('aria-label', 'Rol del sistema');
      for (const [value, caption] of Object.entries(ROLES)) { const option = el('option', caption); option.value = value; role.append(option); }
      roleLabel.append(role); const enabledLabel = el('label', 'Atender '), enabled = el('input'); enabled.type = 'checkbox'; enabled.setAttribute('aria-label', 'Atender este sistema'); enabledLabel.append(enabled);
      controls.append(roleLabel, enabledLabel);
      const roleHelp = el('p', '', 'empire-hint empire-role-help');
      roleHelp.id = `oldlight-empire-role-${panelId}-${++helpSequence}`;
      role.setAttribute('aria-describedby', roleHelp.id);
      const roleDetails = el('details', undefined, 'empire-role-details');
      roleDetails.append(el('summary', 'Qué hace este rol'), roleHelp);
      const numbers = el('div', undefined, 'empire-numbers');
      const resourceNodes = {};
      for (const [key, label] of [['palladium', 'Palladium'], ['iridium', 'Iridium'], ['queues', 'Colas: edificios / naves'], ['energy', 'Energía libre']]) {
        const box = el('div'), caption = el('small', label), value = el('span', '?'); box.append(caption, value); numbers.append(box); resourceNodes[key] = value;
      }
      const ships = el('div', undefined, 'empire-fleets');
      const shipNodes = new Map(core.DEFAULT_SHIPS.map(id => { const node = el('div'); ships.append(node); return [id, node]; }));
      const allocation = el('p', '', 'empire-progress');
      card.append(name, age, controls, roleDetails, numbers, ships, allocation); list.append(card);
      const update = () => {
        if (!currentScope()) return;
        const state = getState(), cfg = core.normalizeConfig(state.config);
        const current = cfg.systems[id] || { name: name.textContent, role: 'balanced', enabled: true };
        save({ ...cfg, systems: { ...cfg.systems, [id]: { ...current, role: role.value, enabled: enabled.checked } } });
      };
      role.addEventListener('change', update); enabled.addEventListener('change', update);
      const result = { card, name, age, role, roleHelp, enabled, resourceNodes, shipNodes, allocation }; cards.set(id, result); return result;
    }
    function render() {
      if (!root || destroyed || !isVisible()) return;
      const state = getState(), cfg = core.normalizeConfig(state.config), clock = now();
      observeScope(state.scope);
      const scopeChanged = renderedScope !== state.scope;
      if (scopeChanged) {
        renderedScope = state.scope; goalEdits.clear(); text(error, '');
        for (const [id, input] of inputs) { input.removeAttribute('aria-invalid'); editFeedback(id, '', ''); }
      }
      const roster = state.roster?.systems || [];
      const data = core.aggregate(state.snapshots || [], { scope: state.scope, now: clock, maxAgeMs: state.maxAgeMs, transitCensus: state.transitCensus, expectedIds: roster.map(s => s.id) });
      const freshIds = new Set(data.rows.map(row => row.systemId)), incompleteIds = new Set(data.incompleteIds);
      const raw = new Map((state.snapshots || []).map(row => [row.systemId, row]));
      text(status, state.status || REASONS[state.plan?.reason] || 'Preparando datos del imperio.');
      if (status.className.split(/\s+/).includes('empire-warning') !== !state.ready) status.classList.toggle('empire-warning', !state.ready);
      renderRecovery(scopeChanged);
      text(toggle, cfg.enabled ? 'Detener imperio' : 'Activar imperio');
      property(toggle, 'disabled', !cfg.enabled && !canEnable()); attribute(toggle, 'aria-pressed', String(cfg.enabled));
      property(toggle, 'title', toggle.disabled ? 'Falta verificar el catálogo, el selector y el censo nativo de flotas.' : 'Activa o detiene el recorrido automático de sistemas.');
      text(total, `${data.rows.length} de ${roster.length} sistemas con datos recientes${data.complete ? '' : ' · información incompleta'}`);
      text(overview, `Palladium ${num(data.totals.resources.palladium.amount)} / ${num(data.totals.resources.palladium.cap)} · Iridium ${num(data.totals.resources.iridium.amount)} / ${num(data.totals.resources.iridium.cap)}`);
      text(fleetSummary, data.fleetComplete ? (roster.length === 1 && !data.censusId ? 'Recuento exacto del sistema seleccionado.' : 'Flota contada una vez en un censo verificado.') : 'Flota sin censo sincronizado: los totales observados no autorizan nuevos pedidos.');
      const fleetVerified = data.complete && data.fleetComplete;
      const deficits = core.DEFAULT_SHIPS.map(id => fleetVerified ? Math.max(0, cfg.fleetTargets[id] - data.totals.fleet[id].total) : null);
      for (const [id, input] of inputs) {
        const edit = goalEdits.get(id), pending = edit && edit.state !== 'saved';
        if (scopeChanged || (!pending && input.getRootNode().activeElement !== input)) property(input, 'value', String(cfg.fleetTargets[id]));
        // Remote policy changes may replace a committed value, never an unsaved
        // local draft. Drop the old success message instead of claiming it saved
        // the new value. No edit state is stored or shared outside this panel.
        if (edit?.state === 'saved' && edit.value !== cfg.fleetTargets[id]) editFeedback(id, '', '');
        // Show the saved goal, not a focused draft, and discard stale totals.
        text(goalStatuses.get(id), fleetVerified
          ? `${num(data.totals.fleet[id].total)} en el imperio · objetivo ${num(cfg.fleetTargets[id])} · faltan ${num(Math.max(0, cfg.fleetTargets[id] - data.totals.fleet[id].total))}`
          : 'Total y faltantes sin verificar: falta un censo actual y completo.');
      }
      const producer = data.rows.some(row => {
        const profile = cfg.systems[row.systemId] || { enabled: true, role: 'balanced' };
        return profile.enabled && ['balanced', 'shipyard'].includes(profile.role);
      });
      text(productionSummary, !cfg.enabled ? 'Imperio desactivado: se aplican los mínimos locales de Flota.'
        : !fleetVerified ? 'Producción imperial sin calcular: falta un censo actual y completo.'
        : core.DEFAULT_SHIPS.every(id => cfg.fleetTargets[id] === 0) ? 'No hay objetivos imperiales de flota activados.'
        : deficits.every(value => value === 0) ? 'Objetivos de flota cubiertos: no se necesitan naves nuevas.'
        : !producer ? 'Faltan naves, pero no hay sistemas con Atender y rol Equilibrado o Astillero.'
        : 'Faltan naves para los objetivos imperiales. Los pedidos respetan pausas, recursos, colas y Depot/Reactor.');
      const retained = new Set();
      for (const entry of roster) {
        retained.add(entry.id); const nodes = cardFor(entry.id), snap = raw.get(entry.id), profile = cfg.systems[entry.id] || { role: 'balanced', enabled: true };
        text(nodes.name, entry.name || snap?.name || entry.id);
        const age = snap && Number.isSafeInteger(snap.observedAt) && snap.observedAt >= 0 && snap.observedAt <= clock
          ? Math.floor((clock - snap.observedAt) / 1000) : null;
        const fresh = age !== null && freshIds.has(entry.id) && !incompleteIds.has(entry.id);
        property(nodes.card.dataset, 'stale', String(!fresh));
        text(nodes.age, age === null ? 'Sin lectura verificada' : `${fresh ? 'Lectura' : 'Datos antiguos'} de hace ${age} s`);
        attribute(nodes.role, 'aria-label', 'Rol de ' + nodes.name.textContent);
        attribute(nodes.enabled, 'aria-label', 'Atender ' + nodes.name.textContent);
        if (scopeChanged || nodes.role.getRootNode().activeElement !== nodes.role) property(nodes.role, 'value', profile.role);
        // Describe the visible choice, including a focused unsaved draft. The
        // save error remains separate; help text never claims it was applied.
        text(nodes.roleHelp, ROLE_HELP[nodes.role.value] || 'Selecciona un rol válido para consultar sus prioridades.');
        property(nodes.enabled, 'checked', profile.enabled);
        for (const resource of ['palladium', 'iridium']) {
          const r = snap?.resources?.[resource]; text(nodes.resourceNodes[resource], `${num(r?.amount)} / ${num(r?.cap)}`);
        }
        text(nodes.resourceNodes.queues, `${num(snap?.queue?.buildings)} / ${num(snap?.queue?.ships)}`);
        text(nodes.resourceNodes.energy, num(snap?.energy));
        for (const [id, node] of nodes.shipNodes) { const fleet = snap?.fleet?.[id]; text(node, `${LABELS[id]}: ${num(fleet?.parked)} en base · ${num(fleet?.away)} en misión · ${num(fleet?.building)} en cola`); }
        // setConfig revokes ready immediately but retains the old plan until update.
        const allocation = cfg.enabled && fleetVerified && state.ready === true ? state.plan?.summary?.allocationsBySystem?.[entry.id] : null;
        const parts = allocation ? core.DEFAULT_SHIPS.filter(id => allocation[id] > 0).map(id => `${LABELS[id]} ×${num(allocation[id])}`) : [];
        text(nodes.allocation, parts.length ? 'Reparto propuesto: ' + parts.join(' · ') : 'Sin producción imperial adicional asignada.');
      }
      for (const [id, nodes] of cards) if (!retained.has(id)) { nodes.card.remove(); cards.delete(id); }
      property(empty, 'hidden', roster.length > 0);
    }
    function renderRecovery(scopeChanged) {
      const messages = {
        'connection-unobserved': 'No se ha visto una conexión del juego desde que arrancó el lector. Esto no demuestra que el juego esté desconectado.',
        'initial-state-wait': 'Se detectó una conexión nueva; todavía no llegó un estado inicial válido.',
        'missing-init': 'Se observaron actualizaciones, pero falta el estado inicial. No basta para reconstruir el censo.',
        'connection-lost': 'Se perdió la conexión observada. Hace falta una nueva conexión y su estado inicial válido.',
      };
      const stages = { loading: 'documento cargando', interactive: 'documento parseado', complete: 'documento cargado', unknown: 'estado del documento desconocido' };
      let value = null;
      try { value = getRecovery(); } catch { /* Help is never necessary for safety. */ }
      const read = key => {
        try { const item = value && Object.getOwnPropertyDescriptor(value, key); return item && Object.hasOwn(item, 'value') ? item.value : null; }
        catch { return null; }
      };
      const reason = read('reason'), stage = read('readyState');
      const known = typeof reason === 'string' && Object.hasOwn(messages, reason);
      const key = known ? reason : '';
      if (scopeChanged || recoveryKey !== key || !known) property(recoveryHelp, 'open', false);
      if (!known && recoveryHelp.contains?.(root.getRootNode?.().activeElement)) status.focus?.({ preventScroll: true });
      recoveryKey = key; property(recoveryHelp, 'hidden', !known);
      text(recoveryReason, known ? messages[reason] : '');
      text(recoveryStart, known ? `Inicio del lector: ${typeof stage === 'string' && Object.hasOwn(stages, stage) ? stages[stage] : stages.unknown}. No indica cuándo se abrió la conexión.` : '');
    }
    function mount(container) {
      if (root || destroyed) throw new Error('El panel ya está montado o destruido.');
      style = el('style', CSS); root = el('section', undefined, 'oldlight-empire'); root.setAttribute('aria-label', 'Gestión del imperio');
      const head = el('div', undefined, 'empire-head'); toggle = el('button', 'Activar imperio'); toggle.type = 'button'; head.append(el('h2', 'Imperio'), toggle);
      toggle.addEventListener('click', () => { if (!currentScope()) return; const cfg = policy({}); if (!cfg.enabled && !canEnable()) return; save({ ...cfg, enabled: !cfg.enabled }); });
      status = el('p', '', 'empire-status'); status.setAttribute('role', 'status'); status.setAttribute('tabindex', '-1');
      recoveryHelp = el('details', undefined, 'empire-recovery'); recoveryHelp.hidden = true;
      recoveryReason = el('p', '', 'empire-hint'); recoveryStart = el('p', '', 'empire-hint');
      const recoverySteps = el('ol', undefined, 'empire-hint');
      recoverySteps.append(el('li', 'Pausa el Helper y guarda cualquier edición pendiente.'),
        el('li', 'Recarga esta pestaña del juego.'),
        el('li', 'Revisa el censo en Imperio antes de reanudar.'));
      recoveryHelp.append(el('summary', 'Cómo recuperar el lector'), recoveryReason,
        el('p', 'Si el juego sigue cargando, espera. Una reconexión natural con un estado inicial válido también recupera el lector.', 'empire-hint'),
        el('p', 'Si el aviso persiste con el juego cargado:', 'empire-hint'), recoverySteps, recoveryStart,
        el('p', 'Si se repite después de recargar, informa de la versión del Helper y del diagnóstico de inicio. Evita recargar en bucle.', 'empire-hint'));
      total = el('p', '', 'empire-hint'); overview = el('p'); fleetSummary = el('p', '', 'empire-hint');
      productionSummary = el('p', '', 'empire-production-summary');
      const goals = el('div', undefined, 'empire-goals');
      for (const id of core.DEFAULT_SHIPS) {
        const label = el('label', `Objetivo imperial · ${LABELS[id]}`), input = el('input'); input.type = 'number'; input.min = '0'; input.max = String(core.MAX_TARGET); input.step = '1';
        input.inputMode = 'numeric';
        input.setAttribute('aria-label', `Objetivo imperial de ${LABELS[id]}`);
        const progress = el('small', '', 'empire-goal-status empire-hint');
        progress.id = `oldlight-empire-goal-${panelId}-${id}`;
        goalStatuses.set(id, progress);
        const feedback = el('small', '', 'empire-edit-status'); feedback.id = `oldlight-empire-edit-${panelId}-${id}`;
        feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
        input.setAttribute('aria-describedby', `${progress.id} ${feedback.id}`);
        label.append(input, progress, feedback); goals.append(label); inputs.set(id, input); goalFeedback.set(id, feedback);
        input.addEventListener('input', () => {
          if (!currentScope()) return;
          input.removeAttribute('aria-invalid');
          const edit = goalEdits.get(id), cfg = core.normalizeConfig(getState().config);
          editFeedback(id, 'draft', 'Sin guardar. Se guarda al salir del campo.', input.value,
            edit && edit.state !== 'saved' ? edit.baseline : cfg.fleetTargets[id]);
        });
        input.addEventListener('blur', () => {
          if (!currentScope()) return;
          const edit = goalEdits.get(id), cfg = core.normalizeConfig(getState().config);
          const value = input.value.trim() === '' ? NaN : Number(input.value);
          // Native change may not fire for 20 -> 40 -> 20. Releasing that no-op
          // must also reveal a policy update that arrived during the edit.
          if (edit?.state === 'draft' && Number.isSafeInteger(value) && value >= 0 && value <= core.MAX_TARGET
              && (value === edit.baseline || value === cfg.fleetTargets[id])) {
            editFeedback(id, '', ''); input.removeAttribute('aria-invalid');
            property(input, 'value', String(cfg.fleetTargets[id]));
          } else if (edit?.state === 'draft') commit();
        });
        const commit = () => {
          if (!currentScope()) return;
          const value = input.value.trim() === '' ? NaN : Number(input.value);
          if (!Number.isSafeInteger(value) || value < 0 || value > core.MAX_TARGET) {
            input.setAttribute('aria-invalid', 'true');
            editFeedback(id, 'invalid', `No guardado. Introduce un entero entre 0 y ${core.MAX_TARGET}.`, input.value); return;
          }
          input.removeAttribute('aria-invalid');
          const cfg = policy({});
          if (goalEdits.get(id)?.state === 'saved' && cfg.fleetTargets[id] === value) return;
          editFeedback(id, 'draft', 'Guardando…', input.value);
          const edit = goalEdits.get(id);
          const saved = save({ ...cfg, fleetTargets: { ...cfg.fleetTargets, [id]: value } }, () => goalEdits.get(id) === edit);
          if (saved === null || destroyed || goalEdits.get(id) !== edit || !currentScope()) return;
          if (saved) editFeedback(id, 'saved', 'Guardado en este navegador.', value);
          else editFeedback(id, 'error', 'Guardado sin confirmar. Vuelve a editar el campo para reintentar.', input.value);
          render();
        };
        input.addEventListener('change', commit);
      }
      error = el('p', '', 'empire-error'); error.setAttribute('role', 'alert');
      list = el('div'); empty = el('p', 'Falta verificar la lista nativa completa de sistemas propios. El recorrido automático permanece bloqueado.', 'empire-empty');
      const scopeHelp = el('p', 'Base + misiones + traslados + construcción, una sola vez. Imperio activo sustituye los mínimos locales; su casilla de misiones no cambia este recuento. 0 desactiva el objetivo.', 'empire-hint empire-scope-help');
      const help = el('details', undefined, 'empire-help');
      help.append(el('summary', 'Ayuda: reparto, recursos y Drive'),
        el('p', 'Los recursos permanecen en cada sistema; la suma es informativa.', 'empire-hint'),
        el('p', 'Equilibrado y Astillero reciben producción de flota. Industria y Defensa no reciben producción imperial adicional en esta fase.', 'empire-hint'),
        el('p', 'El reparto requiere Atender. Los roles reordenan prioridades, no excluyen otros edificios: respetan tus edificios marcados y las reglas de Depot/Reactor. No organizan patrullas, ataques ni transportes.', 'empire-hint'),
        el('p', 'Con la sincronización de Drive conectada, se comparten objetivos, roles y Atender. Activar o detener Imperio sigue siendo una decisión local.', 'empire-hint'));
      root.append(head, status, recoveryHelp, total, overview, fleetSummary, productionSummary, el('h3', 'Objetivos para todo el imperio'), scopeHelp, goals,
        error, help, el('h3', 'Sistemas del imperio', 'empire-systems-heading'), list, empty);
      container.append(style, root); render();
      return root;
    }
    return { mount, render, observeScope, destroy() { destroyed = true; scopeEpoch++; saveSequence++; root?.remove(); style?.remove(); cards.clear(); inputs.clear(); goalEdits.clear(); goalFeedback.clear(); goalStatuses.clear(); } };
  }
  return Object.freeze({ create });
});
