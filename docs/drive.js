(() => {
  'use strict';

  const PROTOCOL = 'old-light-drive-v1';
  const GAME_ORIGIN = 'https://oldlight.io';
  const HELPER_ORIGIN = 'https://alexx-ftw.github.io';
  const HELPER_PATH = '/old-light-auto-upgrade/drive.html';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const APP = 'old-light-auto-upgrade';
  const COPY_FORMAT = 'old-light-auto-upgrade-drive-copy';
  const ROOT_FORMAT = 'old-light-auto-upgrade-backup';
  const MAX_BYTES = 1024 * 1024;
  const encoder = new TextEncoder();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const HASH = /^[0-9a-f]{64}$/;
  const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;
  const CLIENT_ID = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
  const STATUS = {
    waiting: 'Esperando al userscript… Abre esta ventana desde el helper de Old Light.',
    bridge_ready: 'El helper está conectado. Pulsa Conectar Google Drive para autorizar tu cuenta.',
    missing_client: 'Falta tu Client ID. Guárdalo en los ajustes del helper y vuelve a abrir esta ventana.',
    disconnected: 'Google Drive desconectado.',
    connecting: 'Esperando tu autorización de Google…',
    connected: 'Google Drive conectado durante esta sesión.',
    listing: 'Consultando las últimas copias…',
    saving: 'Guardando una copia privada…',
    saved: 'Copia guardada. La configuración anterior se conserva en sus propias copias.',
    unchanged: 'Ya hay una copia idéntica de estos ajustes.',
    restoring: 'Restaurando la copia seleccionada…',
    restored: 'Configuración restaurada en el helper.',
    expired: 'La autorización ha caducado. Pulsa Conectar Google Drive para continuar.',
    denied: 'No se concedió el permiso de datos de esta aplicación.',
    popup_blocked: 'El navegador bloqueó la autorización. Vuelve a pulsar Conectar Google Drive.',
    auth_closed: 'Cerraste la autorización. Puedes volver a conectar cuando quieras.',
    auth_error: 'No se pudo autorizar. Comprueba que el Client ID es de tipo Web y permite este origen.',
    library_error: 'No se pudo cargar Google Identity Services. Recarga la ventana e inténtalo de nuevo.',
    bridge_lost: 'Se perdió el enlace con el helper. Abre una nueva ventana desde Old Light.',
    timeout: 'La operación tardó demasiado. Actualiza la lista antes de volver a guardar una copia.',
    rate_limit: 'Google ha limitado las solicitudes. Espera y actualiza la lista para reanudar las copias.',
    api_denied: 'Google rechazó la petición. Comprueba que Drive API esté activada en el proyecto del Client ID y que el permiso siga concedido.',
    upload_uncertain: 'No se confirmó el guardado. Actualiza la lista antes de repetir; la copia podría haberse creado.',
    invalid_backup: 'La copia no es válida, su hash no coincide o supera 1 MiB.',
    busy: 'Espera a que termine la operación actual.',
    failed: 'No se pudo completar la operación. Actualiza la lista o vuelve a conectar.',
  };

  const ui = Object.fromEntries(['status', 'connect', 'disconnect', 'automatic', 'save',
    'refresh', 'backups', 'empty', 'restore'].map(id => [id, document.getElementById(id)]));
  const pending = new Map();
  const requests = new Set();
  let port = null;
  let bridgeAlive = false;
  let config = { clientId: '', autoBackup: false };
  let configRevision = 0;
  let token = null;
  let expiresAt = 0;
  let expirationTimer = null;
  let generation = 0;
  let authAttempt = 0;
  let authPending = false;
  let busy = false;
  let dirty = false;
  let autoBlocked = false;
  let autoTimer = null;
  let lastSavedHash = '';
  let copies = new Map();
  let statusCode = 'waiting';
  let heartbeatTimer = null;
  let lastPong = 0;
  let requestCounter = 0;
  let readyTimer = null;
  let bootstrapTimer = null;
  let closed = false;

  function error(code) {
    const value = new Error(code);
    value.code = code;
    return value;
  }

  function post(message) {
    if (!port || !bridgeAlive || closed) return false;
    try { port.postMessage({ protocol: PROTOCOL, ...message }); return true; }
    catch (_) { loseBridge(); return false; }
  }

  function status(code) {
    statusCode = Object.hasOwn(STATUS, code) ? code : 'failed';
    ui.status.textContent = STATUS[statusCode];
    post({ type: 'status', code: statusCode });
    render();
  }

  function isAuthorized() {
    return Boolean(bridgeAlive && config.clientId && token && expiresAt > Date.now());
  }

  function gisAvailable() {
    return typeof window.google?.accounts?.oauth2?.initTokenClient === 'function';
  }

  function render() {
    const authorized = isAuthorized();
    ui.connect.disabled = !bridgeAlive || !config.clientId || !gisAvailable() || authPending || busy;
    ui.disconnect.disabled = !bridgeAlive || (!token && !authPending);
    ui.save.disabled = !authorized || busy || authPending;
    ui.refresh.disabled = !authorized || busy || authPending;
    ui.backups.disabled = !authorized || busy || copies.size === 0;
    ui.restore.disabled = !authorized || busy || !copies.has(ui.backups.value);
    ui.automatic.textContent = !config.autoBackup ? 'Copia automática desactivada.' :
      autoBlocked ? 'Copia automática detenida. Actualiza la lista para reanudarla.' :
      authorized ? 'Copia automática activada mientras esta ventana siga conectada.' :
      'Copia automática configurada. Requiere conexión y autorización vigentes.';
  }

  function clearAuth() {
    generation += 1;
    authAttempt += 1;
    authPending = false;
    token = null;
    expiresAt = 0;
    clearTimeout(expirationTimer);
    clearTimeout(autoTimer);
    expirationTimer = null;
    autoTimer = null;
    dirty = false;
    for (const controller of requests) controller.abort();
    requests.clear();
    copies = new Map();
    ui.backups.replaceChildren();
    ui.empty.textContent = 'Conecta Google Drive para consultar tus copias.';
    lastSavedHash = '';
  }

  function disconnectGoogle(code = 'disconnected') {
    clearAuth();
    status(code);
  }

  function loseBridge() {
    if (!bridgeAlive && !port) return;
    bridgeAlive = false;
    clearAuth();
    clearInterval(heartbeatTimer);
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(error('bridge_lost'));
    }
    pending.clear();
    try { port?.close(); } catch (_) { /* already closed */ }
    port = null;
    status('bridge_lost');
  }

  function rpc(type, json) {
    if (!bridgeAlive) return Promise.reject(error('bridge_lost'));
    const id = `request_${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(error('timeout'));
      }, 15000);
      pending.set(id, { resolve, reject, timeout });
      if (!post({ type, id, revision: configRevision, ...(json === undefined ? {} : { json }) })) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(error('bridge_lost'));
      }
    });
  }

  function validateConfig(value) {
    if (!value || typeof value !== 'object' || typeof value.clientId !== 'string' ||
        typeof value.autoBackup !== 'boolean' || value.clientId.length > 300 ||
        (value.clientId && !CLIENT_ID.test(value.clientId))) throw error('auth_error');
    return { clientId: value.clientId, autoBackup: value.autoBackup };
  }

  function onPortMessage(event) {
    const message = event.data;
    if (!bridgeAlive || !message || message.protocol !== PROTOCOL) return;
    if (message.type === 'pong') { lastPong = Date.now(); return; }
    if (message.type === 'disconnect') { loseBridge(); return; }
    if (message.type === 'reply') {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timeout);
      if (message.ok === true) item.resolve(message);
      else item.reject(error(Object.hasOwn(STATUS, message.error) ? message.error : 'failed'));
      return;
    }
    if (message.type === 'config') {
      try {
        const next = validateConfig(message.config);
        if (!Number.isSafeInteger(message.revision) || message.revision < 0) throw error('auth_error');
        const clientChanged = next.clientId !== config.clientId;
        config = next;
        configRevision = message.revision;
        if (clientChanged) clearAuth();
        if (!config.autoBackup) { dirty = false; clearTimeout(autoTimer); }
        if (clientChanged || statusCode === 'waiting') status(config.clientId ? 'bridge_ready' : 'missing_client');
        else render();
      } catch (_) { disconnectGoogle('auth_error'); }
      return;
    }
    if (message.type === 'settings-changed' && config.autoBackup && isAuthorized()) {
      dirty = true;
      scheduleAuto();
    }
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (!dirty || !config.autoBackup || !isAuthorized() || autoBlocked || busy) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (dirty && config.autoBackup && isAuthorized() && !autoBlocked && !busy) {
        dirty = false;
        void operate(() => saveCopy(true));
      }
    }, 5000);
  }

  function assertCurrent(expected) {
    if (!bridgeAlive) throw error('bridge_lost');
    if (expected !== generation || !isAuthorized()) throw error('expired');
  }

  async function readLimited(response) {
    const announced = Number(response.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > MAX_BYTES) throw error('invalid_backup');
    if (!response.body?.getReader) {
      const text = await response.text();
      if (encoder.encode(text).byteLength > MAX_BYTES) throw error('invalid_backup');
      return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let result = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw error('invalid_backup'); }
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode();
      return result;
    } finally { reader.releaseLock(); }
  }

  async function api(path, { method = 'GET', params = {}, body, contentType } = {}) {
    const expected = generation;
    assertCurrent(expected);
    if (!/^\/(?:upload\/)?drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(path)) throw error('failed');
    const url = new URL(path, 'https://www.googleapis.com');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    requests.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const response = await fetch(url.href, {
        method, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
        body, signal: controller.signal,
      });
      assertCurrent(expected);
      if (response.status === 401) { disconnectGoogle('expired'); throw error('expired'); }
      if (response.status === 429) throw error('rate_limit');
      if (response.status === 403) throw error('api_denied');
      if (!response.ok) throw error(method === 'POST' ? 'upload_uncertain' : 'failed');
      const text = await readLimited(response);
      assertCurrent(expected);
      try { return JSON.parse(text); } catch (_) { throw error('invalid_backup'); }
    } catch (caught) {
      if (caught?.code) throw caught;
      if (!bridgeAlive) throw error('bridge_lost');
      if (expected !== generation || !isAuthorized()) throw error('expired');
      throw error(method === 'POST' ? 'upload_uncertain' : timedOut ? 'timeout' : 'failed');
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }

  function parseRoot(json) {
    if (typeof json !== 'string' || json.length > MAX_BYTES || encoder.encode(json).byteLength > MAX_BYTES) {
      throw error('invalid_backup');
    }
    let value;
    try { value = JSON.parse(json); } catch (_) { throw error('invalid_backup'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== ROOT_FORMAT ||
        value.schemaVersion !== 1 || typeof value.scriptVersion !== 'string' ||
        typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt)) ||
        !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings) ||
        !value.notifications || typeof value.notifications !== 'object' || Array.isArray(value.notifications) ||
        !value.drive || typeof value.drive !== 'object' || Array.isArray(value.drive)) {
      throw error('invalid_backup');
    }
    return value;
  }

  function canonicalBackup(value) {
    let nodes = 0;
    function encode(current, depth) {
      if (++nodes > 100000 || depth > 64) throw error('invalid_backup');
      if (current === null || typeof current !== 'object') return JSON.stringify(current);
      if (Array.isArray(current)) return `[${current.map(item => encode(item, depth + 1)).join(',')}]`;
      return `{${Object.keys(current).filter(key => depth !== 0 || key !== 'exportedAt').sort()
        .map(key => `${JSON.stringify(key)}:${encode(current[key], depth + 1)}`).join(',')}}`;
    }
    return encode(value, 0);
  }

  async function hashBackup(value) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalBackup(value)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function validMetadata(file) {
    return file && typeof file === 'object' && FILE_ID.test(file.id) &&
      file.mimeType === 'application/json' && typeof file.createdTime === 'string' &&
      Number.isFinite(Date.parse(file.createdTime)) && file.appProperties?.app === APP &&
      file.appProperties?.backupFormat === '1' && UUID.test(file.appProperties?.backupId) &&
      HASH.test(file.appProperties?.sha256) &&
      file.name === `${APP}-backup-${file.appProperties.backupId}.json` &&
      /^\d+$/.test(String(file.size)) && Number(file.size) <= MAX_BYTES;
  }

  async function listCopies() {
    status('listing');
    const result = await api('/drive/v3/files', { params: {
      spaces: 'appDataFolder', pageSize: '30', orderBy: 'createdTime desc',
      q: `trashed = false and appProperties has { key='app' and value='${APP}' } and appProperties has { key='backupFormat' and value='1' }`,
      fields: 'files(id,name,mimeType,createdTime,size,appProperties)',
    } });
    if (!Array.isArray(result.files)) throw error('failed');
    const eligible = result.files.filter(validMetadata);
    copies = new Map(eligible.map(file => [file.id, file]));
    ui.backups.replaceChildren();
    const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
    for (const file of eligible) {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = `${formatDate.format(new Date(file.createdTime))} · ${Math.ceil(Number(file.size) / 1024)} KiB`;
      ui.backups.append(option);
    }
    // A restoration always requires a deliberate selection, including after refresh.
    ui.backups.selectedIndex = -1;
    ui.empty.textContent = eligible.length ? `${eligible.length} copias disponibles. Selecciona una para restaurarla.` :
      'Todavía no hay copias compatibles de esta aplicación.';
    lastSavedHash = eligible[0]?.appProperties.sha256 || '';
    autoBlocked = false;
    status('connected');
  }

  async function saveCopy(automatic) {
    const expected = generation;
    assertCurrent(expected);
    status('saving');
    const response = await rpc('get-backup');
    assertCurrent(expected);
    const backup = parseRoot(response.json);
    const sha256 = await hashBackup(backup);
    assertCurrent(expected);
    if (automatic && sha256 === lastSavedHash) { status('unchanged'); return; }
    const backupId = crypto.randomUUID();
    const envelope = { format: COPY_FORMAT, schemaVersion: 1, backupId,
      createdAt: new Date().toISOString(), sha256, backup };
    const json = JSON.stringify(envelope);
    if (encoder.encode(json).byteLength > MAX_BYTES) throw error('invalid_backup');
    const metadata = { name: `${APP}-backup-${backupId}.json`, mimeType: 'application/json',
      parents: ['appDataFolder'], appProperties: { app: APP, backupFormat: '1', backupId, sha256 } };
    const boundary = `oldlight_${crypto.randomUUID().replaceAll('-', '')}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata), `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      json, `\r\n--${boundary}--\r\n`,
    ], { type: `multipart/related; boundary=${boundary}` });
    const created = await api('/upload/drive/v3/files', { method: 'POST',
      params: { uploadType: 'multipart', fields: 'id,name,mimeType,createdTime,size,appProperties' },
      contentType: `multipart/related; boundary=${boundary}`, body });
    assertCurrent(expected);
    if (!validMetadata(created) || created.appProperties.backupId !== backupId ||
        created.appProperties.sha256 !== sha256) throw error('upload_uncertain');
    lastSavedHash = sha256;
    autoBlocked = false;
    // Refresh is read-only; an unsuccessful refresh does not invalidate the successful save.
    try { await listCopies(); }
    catch (caught) {
      if (caught?.code === 'expired' || caught?.code === 'bridge_lost') throw caught;
      autoBlocked = true;
    }
    assertCurrent(expected);
    lastSavedHash = sha256;
    status('saved');
  }

  async function restoreCopy() {
    const expected = generation;
    assertCurrent(expected);
    const selected = copies.get(ui.backups.value);
    if (!selected) throw error('invalid_backup');
    status('restoring');
    const envelope = await api(`/drive/v3/files/${selected.id}`, { params: { alt: 'media' } });
    assertCurrent(expected);
    if (!envelope || envelope.format !== COPY_FORMAT || envelope.schemaVersion !== 1 ||
        envelope.backupId !== selected.appProperties.backupId || !HASH.test(envelope.sha256) ||
        envelope.sha256 !== selected.appProperties.sha256 || typeof envelope.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(envelope.createdAt))) throw error('invalid_backup');
    const json = JSON.stringify(envelope.backup);
    const backup = parseRoot(json);
    const actualHash = await hashBackup(backup);
    assertCurrent(expected);
    if (actualHash !== envelope.sha256) throw error('invalid_backup');
    dirty = false;
    clearTimeout(autoTimer);
    await rpc('apply-backup', json);
    // The imported configuration may deliberately change the OAuth client ID.
    // Its successful application is still acknowledged even if that clears auth.
    if (!bridgeAlive) throw error('bridge_lost');
    lastSavedHash = actualHash;
    status('restored');
  }

  async function operate(task) {
    if (busy) { status('busy'); return; }
    busy = true;
    render();
    try { await task(); }
    catch (caught) {
      autoBlocked = true;
      const code = caught?.code;
      status(Object.hasOwn(STATUS, code) ? code : 'failed');
    } finally {
      busy = false;
      render();
      scheduleAuto();
    }
  }

  function connectGoogle() {
    if (!bridgeAlive || !config.clientId || !gisAvailable() || authPending || busy) return;
    clearAuth();
    const expected = generation;
    const attempt = ++authAttempt;
    authPending = true;
    autoBlocked = false;
    status('connecting');
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId, scope: SCOPE, include_granted_scopes: false,
        callback(response) {
          if (!bridgeAlive || expected !== generation || attempt !== authAttempt) return;
          authPending = false;
          if (!response || response.error || typeof response.access_token !== 'string' ||
              !window.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
            status(response?.error === 'access_denied' ? 'denied' : 'auth_error');
            return;
          }
          const seconds = Number(response.expires_in);
          if (!Number.isFinite(seconds) || seconds <= 30) { status('expired'); return; }
          token = response.access_token;
          expiresAt = Date.now() + seconds * 1000 - 30000;
          expirationTimer = setTimeout(() => disconnectGoogle('expired'), Math.min(expiresAt - Date.now(), 2147483647));
          status('connected');
          void operate(listCopies);
        },
        error_callback(response) {
          if (!bridgeAlive || expected !== generation || attempt !== authAttempt) return;
          authPending = false;
          const code = response?.type === 'popup_closed' ? 'auth_closed' :
            response?.type === 'popup_failed_to_open' ? 'popup_blocked' : 'auth_error';
          status(code);
        },
      });
      // Must stay directly inside this user click. Never called by a timer.
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (_) {
      authPending = false;
      status('auth_error');
    }
  }

  function beginBootstrap() {
    const nonce = new URLSearchParams(location.hash.slice(1)).get('bridge');
    const opener = window.opener;
    if (location.origin !== HELPER_ORIGIN || location.pathname !== HELPER_PATH ||
        !opener || typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) {
      status('waiting');
      return;
    }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    const ready = () => {
      try {
        // Public bootstrap only. Secrets are never sent by window.postMessage.
        opener.postMessage({ protocol: PROTOCOL, type: 'ready', nonce }, GAME_ORIGIN);
      } catch (_) { status('bridge_lost'); }
    };
    function receivePort(event) {
      const message = event.data;
      if (port || event.origin !== GAME_ORIGIN || event.source !== opener ||
          !message || message.protocol !== PROTOCOL || message.type !== 'port' ||
          message.nonce !== nonce || event.ports.length !== 1) return;
      window.removeEventListener('message', receivePort);
      clearInterval(readyTimer);
      clearTimeout(bootstrapTimer);
      port = event.ports[0];
      bridgeAlive = true;
      port.onmessage = onPortMessage;
      port.onmessageerror = loseBridge;
      port.start();
      lastPong = Date.now();
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastPong > 45000) { loseBridge(); return; }
        post({ type: 'ping' });
      }, 10000);
      post({ type: 'port-ready' });
      // All further communication uses the private MessagePort.
      try { window.opener = null; } catch (_) { /* browser may prohibit assignment */ }
      status('bridge_ready');
    }
    window.addEventListener('message', receivePort);
    ready();
    readyTimer = setInterval(ready, 500);
    bootstrapTimer = setTimeout(() => {
      window.removeEventListener('message', receivePort);
      clearInterval(readyTimer);
      if (!port) status('bridge_lost');
    }, 20000);
  }

  ui.connect.addEventListener('click', connectGoogle);
  ui.disconnect.addEventListener('click', () => disconnectGoogle());
  ui.save.addEventListener('click', () => { void operate(() => saveCopy(false)); });
  ui.refresh.addEventListener('click', () => { void operate(listCopies); });
  ui.restore.addEventListener('click', () => { void operate(restoreCopy); });
  ui.backups.addEventListener('change', render);
  const googleScript = document.getElementById('google-identity');
  googleScript.addEventListener('load', render);
  googleScript.addEventListener('error', () => status('library_error'));
  window.addEventListener('beforeunload', () => {
    post({ type: 'bye' });
    closed = true;
    clearAuth();
    clearInterval(heartbeatTimer);
    clearInterval(readyTimer);
    clearTimeout(bootstrapTimer);
    try { port?.close(); } catch (_) { /* already closed */ }
  });
  beginBootstrap();
  render();
})();
