/* Isolated empire dashboard. Its callback saves preferences, never game orders. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OldLightEmpirePanel = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const LABELS = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };
  const ROLES = { balanced: 'Equilibrado', industry: 'Industria', shipyard: 'Astillero', defense: 'Defensa' };
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
.oldlight-empire{font:13px/1.45 system-ui,sans-serif;color:#e5eef6;background:#0c141d;border:1px solid #456177;border-radius:12px;padding:14px;box-sizing:border-box;max-width:100%;color-scheme:dark}
.oldlight-empire *{box-sizing:border-box}.oldlight-empire h2{font-size:18px;margin:0}.oldlight-empire h3{font-size:14px;margin:0 0 9px}.oldlight-empire p{margin:7px 0}.oldlight-empire button,.oldlight-empire select,.oldlight-empire input{font:inherit;min-height:38px;border-radius:7px;border:1px solid #456177;background:#152432;color:inherit;padding:7px;max-width:100%}.oldlight-empire input[type=checkbox]{min-height:20px}.oldlight-empire button{cursor:pointer}.oldlight-empire button:disabled{cursor:not-allowed;opacity:.55}.oldlight-empire :focus-visible{outline:2px solid #7edec0;outline-offset:2px}.oldlight-empire .empire-head{display:flex;align-items:center;gap:8px;justify-content:space-between}.oldlight-empire .empire-hint{font-size:12px;color:#aebdcc}.oldlight-empire .empire-status{border:1px solid #55715f;border-radius:8px;padding:9px;background:#172c28}.oldlight-empire .empire-warning{color:#ffcf8e}.oldlight-empire .empire-error{color:#ffaeae}.oldlight-empire .empire-goals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.oldlight-empire .empire-goals label{display:grid;gap:4px}.oldlight-empire .empire-goals input{width:100%}.oldlight-empire .empire-card{border:1px solid #344c60;border-radius:9px;padding:10px;margin-top:9px}.oldlight-empire .empire-card[data-stale=true]{border-style:dashed}.oldlight-empire .empire-card h3{overflow-wrap:anywhere}.oldlight-empire .empire-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.oldlight-empire .empire-controls label{display:flex;gap:5px;align-items:center}.oldlight-empire .empire-numbers{font-variant-numeric:tabular-nums;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0}.oldlight-empire .empire-numbers div{padding:7px;background:#111f2b;border-radius:6px;overflow-wrap:anywhere}.oldlight-empire .empire-numbers small{display:block;color:#aebdcc}.oldlight-empire .empire-fleets{display:grid;gap:3px;font-size:12px;color:#bdcbd7}.oldlight-empire .empire-progress{font-size:12px;color:#b1dccf}.oldlight-empire .empire-empty{padding:14px 0;color:#aebdcc}.oldlight-empire[hidden]{display:none}
@media(max-width:400px){.oldlight-empire{padding:10px}.oldlight-empire button,.oldlight-empire select,.oldlight-empire input{min-height:44px}.oldlight-empire .empire-head{align-items:flex-start;flex-direction:column}}
`;
  // Reuse the formatter: constructing locale machinery per resource/ship on
  // every native tick dominated dashboard time for larger empires.
  const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
  const num = value => typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '?';
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attribute = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
  const property = (node, key, value) => { if (node[key] !== value) node[key] = value; };
  function create({ document, core, getState, setConfig, canEnable = () => false, isVisible = () => true, now = Date.now }) {
    let root, style, status, toggle, total, fleetSummary, error, list, empty, overview;
    const inputs = new Map(), cards = new Map();
    let destroyed = false;
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
    function save(next) {
      if (destroyed) return;
      try { const result = setConfig(next); if (result?.then) throw new Error('Se necesita guardado síncrono confirmado.'); error.textContent = ''; }
      catch (cause) { error.textContent = cause?.message || 'No se pudo guardar la configuración.'; }
      render();
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
      const numbers = el('div', undefined, 'empire-numbers');
      const resourceNodes = {};
      for (const [key, label] of [['palladium', 'Palladium'], ['iridium', 'Iridium'], ['queues', 'Colas: edificios / naves'], ['energy', 'Energía libre']]) {
        const box = el('div'), caption = el('small', label), value = el('span', '?'); box.append(caption, value); numbers.append(box); resourceNodes[key] = value;
      }
      const ships = el('div', undefined, 'empire-fleets');
      const shipNodes = new Map(core.DEFAULT_SHIPS.map(id => { const node = el('div'); ships.append(node); return [id, node]; }));
      const allocation = el('p', '', 'empire-progress');
      card.append(name, age, controls, numbers, ships, allocation); list.append(card);
      const update = () => {
        const state = getState(), cfg = core.normalizeConfig(state.config);
        const current = cfg.systems[id] || { name: name.textContent, role: 'balanced', enabled: true };
        save({ ...cfg, systems: { ...cfg.systems, [id]: { ...current, role: role.value, enabled: enabled.checked } } });
      };
      role.addEventListener('change', update); enabled.addEventListener('change', update);
      const result = { card, name, age, role, enabled, resourceNodes, shipNodes, allocation }; cards.set(id, result); return result;
    }
    function render() {
      if (!root || destroyed || !isVisible()) return;
      const state = getState(), cfg = core.normalizeConfig(state.config), clock = now();
      const roster = state.roster?.systems || [];
      const data = core.aggregate(state.snapshots || [], { scope: state.scope, now: clock, maxAgeMs: state.maxAgeMs, transitCensus: state.transitCensus, expectedIds: roster.map(s => s.id) });
      const freshIds = new Set(data.rows.map(row => row.systemId)), incompleteIds = new Set(data.incompleteIds);
      const raw = new Map((state.snapshots || []).map(row => [row.systemId, row]));
      text(status, state.status || REASONS[state.plan?.reason] || 'Preparando datos del imperio.');
      if (status.className.split(/\s+/).includes('empire-warning') !== !state.ready) status.classList.toggle('empire-warning', !state.ready);
      text(toggle, cfg.enabled ? 'Detener imperio' : 'Activar imperio');
      property(toggle, 'disabled', !cfg.enabled && !canEnable()); attribute(toggle, 'aria-pressed', String(cfg.enabled));
      property(toggle, 'title', toggle.disabled ? 'Falta verificar el catálogo, el selector y el censo nativo de flotas.' : 'Activa o detiene el recorrido automático de sistemas.');
      text(total, `${data.rows.length} de ${roster.length} sistemas con datos recientes${data.complete ? '' : ' · información incompleta'}`);
      text(overview, `Palladium ${num(data.totals.resources.palladium.amount)} / ${num(data.totals.resources.palladium.cap)} · Iridium ${num(data.totals.resources.iridium.amount)} / ${num(data.totals.resources.iridium.cap)}`);
      text(fleetSummary, data.fleetComplete ? (roster.length === 1 && !data.censusId ? 'Recuento exacto del sistema seleccionado.' : 'Flota contada una vez en un censo verificado.') : 'Flota sin censo sincronizado: los totales observados no autorizan nuevos pedidos.');
      for (const [id, input] of inputs) if (input.getRootNode().activeElement !== input) property(input, 'value', String(cfg.fleetTargets[id]));
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
        if (nodes.role.getRootNode().activeElement !== nodes.role) property(nodes.role, 'value', profile.role);
        property(nodes.enabled, 'checked', profile.enabled);
        for (const resource of ['palladium', 'iridium']) {
          const r = snap?.resources?.[resource]; text(nodes.resourceNodes[resource], `${num(r?.amount)} / ${num(r?.cap)}`);
        }
        text(nodes.resourceNodes.queues, `${num(snap?.queue?.buildings)} / ${num(snap?.queue?.ships)}`);
        text(nodes.resourceNodes.energy, num(snap?.energy));
        for (const [id, node] of nodes.shipNodes) { const fleet = snap?.fleet?.[id]; text(node, `${LABELS[id]}: ${num(fleet?.parked)} en base · ${num(fleet?.away)} en misión · ${num(fleet?.building)} en cola`); }
        const allocation = state.plan?.summary?.allocationsBySystem?.[entry.id];
        const parts = allocation ? core.DEFAULT_SHIPS.filter(id => allocation[id] > 0).map(id => `${LABELS[id]} ×${num(allocation[id])}`) : [];
        text(nodes.allocation, parts.length ? 'Reparto propuesto: ' + parts.join(' · ') : 'Sin producción imperial adicional asignada.');
      }
      for (const [id, nodes] of cards) if (!retained.has(id)) { nodes.card.remove(); cards.delete(id); }
      property(empty, 'hidden', roster.length > 0);
    }
    function mount(container) {
      if (root || destroyed) throw new Error('El panel ya está montado o destruido.');
      style = el('style', CSS); root = el('section', undefined, 'oldlight-empire'); root.setAttribute('aria-label', 'Gestión del imperio');
      const head = el('div', undefined, 'empire-head'); toggle = el('button', 'Activar imperio'); toggle.type = 'button'; head.append(el('h2', 'Imperio'), toggle);
      toggle.addEventListener('click', () => { const cfg = policy({}); if (!cfg.enabled && !canEnable()) return; save({ ...cfg, enabled: !cfg.enabled }); });
      status = el('p', '', 'empire-status'); status.setAttribute('role', 'status');
      total = el('p', '', 'empire-hint'); overview = el('p'); fleetSummary = el('p', '', 'empire-hint');
      const goals = el('div', undefined, 'empire-goals');
      for (const id of core.DEFAULT_SHIPS) {
        const label = el('label', `Objetivo imperial · ${LABELS[id]}`), input = el('input'); input.type = 'number'; input.min = '0'; input.max = String(core.MAX_TARGET); input.step = '1';
        input.setAttribute('aria-label', `Objetivo imperial de ${LABELS[id]}`); label.append(input); goals.append(label); inputs.set(id, input);
        input.addEventListener('change', () => {
          const value = input.value.trim() === '' ? NaN : Number(input.value);
          if (!Number.isSafeInteger(value) || value < 0 || value > core.MAX_TARGET) { input.setAttribute('aria-invalid', 'true'); error.textContent = `Introduce un entero entre 0 y ${core.MAX_TARGET}.`; return; }
          input.removeAttribute('aria-invalid'); const cfg = policy({}); save({ ...cfg, fleetTargets: { ...cfg.fleetTargets, [id]: value } });
        });
      }
      error = el('p', '', 'empire-error'); error.setAttribute('role', 'alert');
      list = el('div'); empty = el('p', 'Falta verificar la lista nativa completa de sistemas propios. El recorrido automático permanece bloqueado.', 'empire-empty');
      root.append(head, status, total, overview, fleetSummary, el('h3', 'Objetivos para todo el imperio'), goals,
        el('p', 'Los objetivos cuentan base, misiones y construcción. Los recursos permanecen en cada sistema; la suma es informativa.', 'empire-hint'),
        el('p', 'Equilibrado y Astillero reciben producción de flota. Industria y Defensa no reciben producción imperial adicional en esta fase.', 'empire-hint'),
        el('p', 'Con la sincronización de Drive conectada, se comparten objetivos, roles y Atender. Activar o detener Imperio sigue siendo una decisión local.', 'empire-hint'), error, list, empty);
      container.append(style, root); render();
      return root;
    }
    return { mount, render, destroy() { destroyed = true; root?.remove(); style?.remove(); cards.clear(); inputs.clear(); } };
  }
  return Object.freeze({ create });
});
