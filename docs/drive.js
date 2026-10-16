(function createDriveRuntime(runtimeOptions) {
  'use strict';
  runtimeOptions = runtimeOptions || {};
  const headless = runtimeOptions.headless === true;

  const PROTOCOL = 'old-light-drive-v1';
  const GAME_ORIGIN = 'https://oldlight.io';
  const HELPER_ORIGIN = 'https://alexx-ftw.github.io';
  const HELPER_PATH = '/old-light-helper/drive.html';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const APP = 'old-light-auto-upgrade';
  const COPY_FORMAT = 'old-light-auto-upgrade-drive-copy';
  const ROOT_FORMAT = 'old-light-auto-upgrade-backup';
  const MAX_BYTES = 1024 * 1024;
  const AUTH_TIMEOUT = 120000;
  const LIBRARY_TIMEOUT = 15000;
  const encoder = new TextEncoder();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const HASH = /^[0-9a-f]{64}$/;
  const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;
  const CLIENT_ID = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
  const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
  const STATUS = {
    waiting: 'Abre esta ventana desde el helper de Old Light para conectar tu cuenta.',
    bridge_ready: 'Inicia sesión con Google para ver y guardar tus copias.',
    missing_client: 'La conexión con Google aún no está configurada. Consulta Configuración avanzada.',
    disconnected: 'Has cerrado la sesión. Puedes iniciar sesión de nuevo cuando quieras.',
    connecting: 'Esperando tu autorización de Google…',
    renewing: 'Renovando la conexión con Google Drive…',
    switching_account: 'Elige la cuenta de Google que quieres usar.',
    verifying: 'Comprobando la cuenta de Google antes de recuperar Drive…',
    connected: 'Conexión activa con Google Drive. Puedes cerrar esta ventana de gestión.',
    syncing: 'Sincronizando ajustes entre dispositivos…',
    synced: 'Ajustes sincronizados automáticamente.',
    sync_pending: 'Hay cambios pendientes de sincronizar.',
    sync_waiting: 'Conecta Google para sincronizar los ajustes.',
    sync_account: 'No se pudo identificar la cuenta para sincronizar con seguridad.',
    invalid_sync: 'No se pudieron validar los ajustes remotos. Se reintentará sin sustituir los datos locales.',
    sync_retry: 'Conexión interrumpida. Se reintentará automáticamente.',
    renew_soon: 'La conexión caduca pronto. Pulsa Renovar conexión para continuar.',
    listing: 'Consultando las últimas copias…',
    listed: 'Lista de copias actualizada.',
    saving: 'Guardando una copia privada…',
    saved: 'Copia guardada. La configuración anterior se conserva en sus propias copias.',
    unchanged: 'Ya hay una copia idéntica de estos ajustes.',
    restoring: 'Restaurando la copia seleccionada…',
    restored: 'Configuración restaurada en el helper.',
    expired: 'La sesión ha caducado. Inicia sesión de nuevo para continuar.',
    denied: 'No se concedió el permiso de datos de esta aplicación.',
    permission_missing: 'Falta conceder el permiso para guardar las copias de esta aplicación.',
    popup_blocked: 'El navegador bloqueó la autorización. Permite ventanas emergentes aquí y vuelve a conectar.',
    auth_closed: 'Cerraste la autorización. Puedes volver a intentarlo.',
    auth_cancelled: 'Autorización cancelada. Puedes volver a intentarlo.',
    auth_timeout: 'Google no respondió a tiempo. Cierra la ventana de autorización y vuelve a intentarlo.',
    auth_error: 'Google no pudo iniciar la sesión. Inténtalo de nuevo o revisa Configuración avanzada.',
    invalid_client: 'Google no reconoce la conexión de esta aplicación. Revisa Configuración avanzada.',
    auth_origin: 'Google ha rechazado la conexión desde esta página. Revisa Configuración avanzada.',
    library_loading: 'Cargando la conexión con Google…',
    library_error: 'No se pudo conectar con Google. Pulsa Reintentar conexión.',
    library_timeout: 'Google no terminó de cargar. Comprueba tu conexión y vuelve a intentarlo.',
    bridge_lost: 'No hay enlace activo con Old Light. Mantén esta ventana abierta: se recuperará al volver al juego.',
    bridge_reconnecting: 'Recuperando el enlace con Old Light; tu autorización vigente se conserva.',
    revoking: 'Retirando el permiso de Google…',
    revoked: 'Google confirmó que el permiso de esta aplicación ha sido retirado.',
    revoke_failed: 'No se pudo confirmar la retirada del permiso. Puedes revisarlo en tu cuenta de Google.',
    timeout: 'La operación tardó demasiado. Actualiza la lista antes de volver a guardar una copia.',
    rate_limit: 'Google ha limitado las solicitudes. Espera y actualiza la lista para reanudar las copias.',
    api_denied: 'Google no ha permitido acceder a las copias. Revisa tu autorización o Configuración avanzada.',
    upload_uncertain: 'No se confirmó el guardado. Actualiza la lista antes de repetir; la copia podría haberse creado.',
    invalid_backup: 'La copia no pudo verificarse o es demasiado grande para restaurarla.',
    invalid_config: 'El ajuste no tiene un formato válido.',
    storage_error: 'No se pudo guardar el ajuste en el helper. El cambio sigue en el editor para reintentarlo.',
    busy: 'Espera a que termine la operación actual.',
    failed: 'No se pudo completar la operación. Actualiza la lista o vuelve a conectar.',
  };
  // Technical diagnostics stay in the optional advanced panel, never in the sign-in flow.
  const TECHNICAL_STATUS = {
    missing_client: 'Falta un Client ID OAuth de tipo Aplicación web. Abre Drive desde el helper para usar la conexión de la aplicación, si está disponible, o configura aquí tu propio cliente.',
    auth_error: 'Comprueba el Client ID, el origen JavaScript autorizado y los usuarios de prueba del proyecto de Google Cloud.',
    invalid_client: 'Google no reconoce el Client ID activo. Debe corresponder a un cliente OAuth de tipo Aplicación web que siga habilitado.',
    auth_origin: `El cliente OAuth debe permitir exactamente este origen JavaScript: ${HELPER_ORIGIN}.`,
    library_error: 'No se pudo cargar la biblioteca Google Identity Services desde accounts.google.com.',
    library_timeout: 'Google Identity Services no terminó de cargar dentro de 15 segundos. Puedes reintentar su carga sin cambiar tu configuración.',
    api_denied: 'Comprueba que Google Drive API esté activada en el proyecto del Client ID y que el permiso drive.appdata siga concedido.',
    invalid_backup: 'La copia debe tener un formato compatible, superar la comprobación SHA-256 y no exceder 1 MiB.',
  };
  const CONNECTION_CODES = new Set(['waiting', 'bridge_ready', 'missing_client', 'disconnected', 'connecting',
    'renewing', 'switching_account', 'verifying', 'connected', 'renew_soon', 'expired', 'denied', 'permission_missing',
    'popup_blocked', 'auth_closed', 'auth_cancelled', 'auth_timeout', 'auth_error', 'invalid_client', 'auth_origin',
    'library_loading', 'library_error', 'library_timeout', 'bridge_lost', 'bridge_reconnecting', 'revoking', 'revoked', 'revoke_failed']);
  const ui = Object.fromEntries(['status', 'connect', 'disconnect', 'automatic', 'save', 'refresh', 'backups',
    'empty', 'restore', 'account', 'session-status', 'expiry', 'switch-account', 'cancel-auth', 'retry-library',
    'remember-account', 'auto-backup', 'auto-sync', 'sync-status', 'client-id', 'choose-client-file', 'import-client', 'clear-client',
    'copy-origin', 'setup', 'setup-status', 'technical-status', 'preferences-status', 'account-settings-status',
    'revoke', 'confirm-revoke', 'cancel-revoke', 'revoke-confirmation']
    .map(id => [id, headless ? document.createElement('div') : document.getElementById(id)]));
  const pending = new Map();
  const requests = new Set();
  let port = null;
  let bridgeAlive = false;
  let config = { clientId: '', autoBackup: false, autoSync: true, rememberAccount: true, accountHint: '', clientIdDraft: null };
  let configRevision = 0;
  let configReady = false;
  let capabilities = new Set();
  let configQueue = Promise.resolve();
  let configWrites = 0;
  let configSaveFailed = false;
  let clientDraftTimer = null;
  let token = null;
  let restoredAuthorizationId = '';
  let restoredAccountId = '';
  let accountVerified = false;
  let expiresAt = 0;
  let expirationTimer = null;
  let account = null;
  let generation = 0;
  let authAttempt = 0;
  let authPending = false;
  let authTimer = null;
  let revoking = false;
  let revokeTimer = null;
  let busy = false;
  let dirty = false;
  let dirtyOwner = '';
  let autoBlocked = false;
  let autoTimer = null;
  let lastSavedHash = '';
  let copies = new Map();
  let statusCode = 'waiting';
  let connectionCode = 'waiting';
  let heartbeatTimer = null;
  let lastPong = 0;
  let requestCounter = 0;
  let readyTimer = null;
  let bootstrapTimer = null;
  let resumeAllowed = true;
  let closed = false;
  let libraryState = 'idle';
  let libraryAttempt = 0;
  let libraryTimer = null;

  // BEGIN AUTOMATIC SETTINGS SYNC
  const SYNC_ENVELOPE = 'old-light-settings-sync-envelope';
  const SYNC_FIELDS = 'id,name,mimeType,modifiedTime,createdTime,size,version,appProperties';
  const syncReplica = crypto.randomUUID();
  let syncTimer = null;
  let syncFailures = 0;
  let syncPending = true;
  let syncChangeRevision = 0;
  let syncLastAt = 0;
  let syncFileId = '';
  let syncBinding = '';
  let syncPublishedHash = '';
  let syncCache = new Map();

  function resetSync() {
    clearTimeout(syncTimer); syncTimer = null;
    syncFailures = 0; syncPending = true; syncLastAt = 0;
    syncFileId = ''; syncBinding = ''; syncPublishedHash = ''; syncCache = new Map();
  }
  function syncEnabled() { return config.autoSync && capabilities.has('settings-sync-v1'); }
  function renderSync() {
    ui['auto-sync'].checked = config.autoSync;
    ui['auto-sync'].disabled = !bridgeAlive || !capabilities.has('settings-sync-v1') || revoking || configWrites > 0;
    ui['sync-status'].textContent = !capabilities.has('settings-sync-v1')
      ? 'Actualiza el userscript a v1.11.0 para sincronizar automáticamente.'
      : !config.autoSync ? 'Sincronización automática desactivada en este cliente.'
      : !isAuthorized() ? 'Cambios conservados en local. La sincronización continuará al conectar Google.'
      : syncFailures ? 'No se ha podido sincronizar. Reintentando automáticamente sin descartar cambios…'
      : syncPending ? 'Comprobando y sincronizando cambios…'
      : 'Sincronizado · ' + new Date(syncLastAt).toLocaleTimeString() + '. Comprobación automática cada 15 s.';
  }
  function scheduleSync(delay = 15000) {
    clearTimeout(syncTimer); syncTimer = null;
    if (!syncEnabled() || !isAuthorized() || closed || authPending || revoking || configWrites || busy) return;
    const wait = syncFailures ? Math.min(120000, 3000 * 2 ** Math.min(syncFailures - 1, 6)) : delay;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      if (!syncEnabled() || !isAuthorized() || authPending || revoking || configWrites || busy) { scheduleSync(); return; }
      void operate(async () => {
        try { await syncSettings(); }
        catch (caught) {
          syncPending = true; syncFailures = caught?.code === 'busy' ? 0 : syncFailures + 1;
          throw caught;
        }
      });
    }, wait);
  }
  function validSyncFile(file, scopeHash) {
    return file && FILE_ID.test(file.id || '') && file.mimeType === 'application/json'
      && file.appProperties?.app === APP && file.appProperties?.syncFormat === '1'
      && file.appProperties?.scopeHash === scopeHash && UUID.test(file.appProperties?.replica || '')
      && HASH.test(file.appProperties?.sha256 || '') && /^\d+$/.test(String(file.version))
      && /^\d+$/.test(String(file.size)) && Number(file.size) <= MAX_BYTES
      && file.name === `${APP}-sync-${file.appProperties.replica}.json`;
  }
  async function syncFiles(scopeHash) {
    const files = []; let pageToken = ''; const seenPages = new Set();
    do {
      const result = await api('/drive/v3/files', { params: {
        spaces: 'appDataFolder', pageSize: '100', orderBy: 'createdTime',
        q: `trashed = false and appProperties has { key='app' and value='${APP}' } and appProperties has { key='syncFormat' and value='1' } and appProperties has { key='scopeHash' and value='${scopeHash}' }`,
        fields: `nextPageToken,incompleteSearch,files(${SYNC_FIELDS})`, ...(pageToken ? { pageToken } : {}),
      } });
      if (!Array.isArray(result.files) || result.incompleteSearch || result.files.some(file => !validSyncFile(file, scopeHash))) throw error('invalid_sync');
      files.push(...result.files);
      if (files.length > 1000) throw error('invalid_sync');
      pageToken = result.nextPageToken || '';
      if (typeof pageToken !== 'string' || pageToken.length > 4096 || (pageToken && seenPages.has(pageToken))) throw error('invalid_sync');
      seenPages.add(pageToken);
    } while (pageToken);
    return files;
  }
  async function readSyncFile(file, scope) {
    const cached = syncCache.get(file.id);
    if (cached?.version === String(file.version)) return cached.document;
    const envelope = await api(`/drive/v3/files/${file.id}`, { params: { alt: 'media' } });
    if (envelope?.format !== SYNC_ENVELOPE || envelope.schemaVersion !== 1 || !HASH.test(envelope.sha256 || '')
        || envelope.document?.scope !== scope || envelope.document?.format !== 'old-light-settings-sync'
        || envelope.document?.schemaVersion !== 1) throw error('invalid_sync');
    const digest = await hashBackup(envelope.document);
    // A concurrent writer may have updated after the metadata listing. Retry that race.
    if (digest !== envelope.sha256 || envelope.sha256 !== file.appProperties.sha256) throw error('invalid_sync');
    syncCache.set(file.id, { version: String(file.version), document: envelope.document });
    return envelope.document;
  }
  async function legacyPreferences(scope) {
    const selected = copies.values().next().value;
    if (!selected) return undefined;
    const envelope = await api(`/drive/v3/files/${selected.id}`, { params: { alt: 'media' } });
    if (envelope?.format !== COPY_FORMAT || envelope.schemaVersion !== 1
        || envelope.backupId !== selected.appProperties.backupId || envelope.sha256 !== selected.appProperties.sha256) throw error('invalid_backup');
    const backup = parseRoot(JSON.stringify(envelope.backup));
    if (await hashBackup(backup) !== envelope.sha256) throw error('invalid_backup');
    if (backup.profile && backup.profile !== scope) return undefined;
    return { backup, createdAt: selected.createdTime };
  }
  async function publishSync(document, scopeHash, digest) {
    const envelope = { format: SYNC_ENVELOPE, schemaVersion: 1, sha256: digest, document };
    const json = JSON.stringify(envelope);
    if (encoder.encode(json).byteLength > MAX_BYTES) throw error('invalid_sync');
    const metadata = { name: `${APP}-sync-${syncReplica}.json`, mimeType: 'application/json',
      ...(!syncFileId ? { parents: ['appDataFolder'] } : {}),
      appProperties: { app: APP, syncFormat: '1', scopeHash, replica: syncReplica, sha256: digest } };
    const boundary = `oldlight_sync_${crypto.randomUUID().replaceAll('-', '')}`;
    const contentType = `multipart/related; boundary=${boundary}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata), `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`, json, `\r\n--${boundary}--\r\n`], { type: contentType });
    const file = await api('/upload/drive/v3/files' + (syncFileId ? `/${syncFileId}` : ''), {
      method: syncFileId ? 'PATCH' : 'POST', params: { uploadType: 'multipart', fields: SYNC_FIELDS }, contentType, body });
    if (!validSyncFile(file, scopeHash) || file.appProperties.sha256 !== digest || file.appProperties.replica !== syncReplica) throw error('upload_uncertain');
    syncFileId = file.id; syncPublishedHash = digest;
    syncCache.set(file.id, { version: String(file.version), document });
  }
  async function syncSettings() {
    if (!syncEnabled()) return;
    const expected = generation;
    assertCurrent(expected);
    if (restoredAuthorizationId && !accountVerified) await verifyStoredAccount(expected);
    assertCurrent(expected);
    const identity = accountKey();
    if (!identity) throw error('sync_account');
    const startedRevision = syncChangeRevision;
    status('syncing');
    const local = await rpc('get-sync', { account: identity });
    assertCurrent(expected);
    const scope = local.document?.scope;
    if (typeof scope !== 'string' || !/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/.test(scope)) throw error('invalid_sync');
    const binding = JSON.stringify([config.clientId, identity, scope]);
    if (syncBinding !== binding) { resetSync(); syncBinding = binding; }
    const scopeHash = await hashBackup(scope);
    const files = await syncFiles(scopeHash);
    assertCurrent(expected);
    const own = files.find(file => file.appProperties.replica === syncReplica);
    syncFileId = own?.id || '';
    if (own) syncPublishedHash = own.appProperties.sha256;
    else syncPublishedHash = '';
    const aggregate = globalThis.OldLightSyncCore.create({ scope, actor: syncReplica });
    for (let i = 0; i < files.length; i += 4) {
      const batch = await Promise.all(files.slice(i, i + 4).map(file => readSyncFile(file, scope)));
      for (const document of batch) aggregate.merge([document]);
      assertCurrent(expected);
    }
    const visible = new Set(files.map(file => file.id));
    for (const id of syncCache.keys()) if (!visible.has(id)) syncCache.delete(id);
    const documents = files.length ? [aggregate.document()] : [];
    const legacy = files.length ? undefined : await legacyPreferences(scope);
    assertCurrent(expected);
    // The helper captures again immediately before merging, protecting edits made during downloads.
    const merged = await rpc('merge-sync', { account: identity, scope, documents, ...(legacy ? { legacy } : {}) });
    assertCurrent(expected);
    if (!syncEnabled()) return;
    const digest = await hashBackup(merged.document);
    assertCurrent(expected);
    if (digest !== syncPublishedHash) await publishSync(merged.document, scopeHash, digest);
    assertCurrent(expected);
    // A later edit is picked up by the journal even when this cycle's upload was in flight.
    syncPending = startedRevision !== syncChangeRevision; syncFailures = 0; syncLastAt = Date.now();
    status(syncPending ? 'sync_pending' : 'synced');
  }
  // END AUTOMATIC SETTINGS SYNC

  function error(code) { const value = new Error(code); value.code = code; return value; }

  function post(message) {
    if (!port || !bridgeAlive || closed) return false;
    try { port.postMessage({ protocol: PROTOCOL, ...message }); return true; }
    catch (_) { loseBridge(); return false; }
  }

  function status(code) {
    statusCode = Object.hasOwn(STATUS, code) ? code : 'failed';
    if (CONNECTION_CODES.has(statusCode)) connectionCode = statusCode;
    else ui.status.textContent = STATUS[statusCode];
    // The helper understands the stable v1 protocol; 'listed' is local presentation only.
    post({ type: 'status', code: statusCode === 'listed' ? 'connected' : statusCode });
    render();
  }

  function isAuthorized() { return Boolean(bridgeAlive && configReady && config.clientId && token && expiresAt > Date.now()); }
  function gisAvailable() { return typeof window.google?.accounts?.oauth2?.initTokenClient === 'function'; }
  function accountKey(value = account) { return value?.id ? `id:${value.id}` : value?.email ? `email:${value.email.toLowerCase()}` : ''; }

  function syncConfigControls() {
    if (configWrites || configSaveFailed) return;
    if (document.activeElement !== ui['client-id']) ui['client-id'].value = config.clientIdDraft ?? config.clientId;
    ui['remember-account'].checked = config.rememberAccount;
    ui['auto-backup'].checked = config.autoBackup;
  }

  function render() {
    const authorized = isAuthorized() && (!restoredAuthorizationId || accountVerified);
    const editable = bridgeAlive && configReady && capabilities.has('oauth-config');
    ui.connect.disabled = !bridgeAlive || !config.clientId || !gisAvailable() || authPending || busy || revoking || configWrites > 0;
    ui.connect.textContent = authorized ? 'Renovar conexión' : 'Iniciar sesión con Google';
    ui.connect.classList.toggle('secondary', authorized);
    ui['switch-account'].disabled = ui.connect.disabled;
    ui['switch-account'].hidden = !account && !config.accountHint;
    ui['cancel-auth'].hidden = !authPending;
    ui['retry-library'].hidden = !['error', 'timeout'].includes(libraryState);
    ui.disconnect.disabled = revoking || (!token && !authPending && !account);
    ui.revoke.disabled = !authorized || authPending || busy || revoking || configWrites > 0 || typeof window.google?.accounts?.oauth2?.revoke !== 'function';
    ui['confirm-revoke'].disabled = ui.revoke.disabled;
    ui.save.disabled = !authorized || busy || authPending || revoking || configWrites > 0;
    ui.refresh.disabled = ui.save.disabled;
    ui.backups.disabled = ui.save.disabled || copies.size === 0;
    ui.restore.disabled = ui.save.disabled || !copies.has(ui.backups.value);
    for (const id of ['client-id', 'choose-client-file', 'remember-account', 'auto-backup']) ui[id].disabled = !editable || revoking;
    ui['clear-client'].disabled = !editable || revoking || (!config.clientId && config.clientIdDraft === null);
    let connection = STATUS[connectionCode];
    if (!resumeAllowed) connection = 'Esta sesión se ha desconectado. Cierra esta ventana y vuelve a abrir Drive desde el helper para iniciar sesión.';
    else if (authPending || revoking) connection = STATUS[connectionCode];
    else if (isAuthorized() && restoredAuthorizationId && !accountVerified) connection = STATUS[statusCode === 'sync_account' ? 'sync_account' : 'verifying'];
    else if (authorized) {
      connection = expiresAt - Date.now() <= 300000 ? STATUS.renew_soon : STATUS.connected;
      if (['auth_closed', 'auth_cancelled', 'auth_timeout', 'denied', 'permission_missing', 'auth_error', 'popup_blocked',
        'invalid_client', 'auth_origin', 'revoke_failed'].includes(connectionCode)) connection += ` ${STATUS[connectionCode]}`;
    } else if (bridgeAlive && configReady && !config.clientId) connection = STATUS.missing_client;
    else if (bridgeAlive && config.clientId && ['loading', 'error', 'timeout'].includes(libraryState)) {
      connection = STATUS[libraryState === 'loading' ? 'library_loading' : libraryState === 'timeout' ? 'library_timeout' : 'library_error'];
    }
    ui['session-status'].textContent = connection;
    ui['session-status'].dataset.connected = String(authorized);
    const technicalCode = bridgeAlive && configReady && !config.clientId ? 'missing_client' : statusCode;
    ui['technical-status'].textContent = TECHNICAL_STATUS[technicalCode] || '';
    ui['technical-status'].hidden = !ui['technical-status'].textContent;
    ui.account.textContent = account ? [account.name, account.email].filter(Boolean).join(' · ') || 'Cuenta conectada' :
      authorized ? 'Cuenta conectada · Google no facilitó su nombre' :
        config.rememberAccount && config.accountHint ? `Cuenta recordada: ${config.accountHint}` : 'Sin sesión iniciada';
    ui.expiry.textContent = authorized ? `Sesión válida durante unos ${Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000))} min.` :
      account ? 'La cuenta sigue identificada; necesitas renovar la autorización para usar Drive.' : '';
    ui.automatic.textContent = !config.autoBackup ? 'Copia automática desactivada.' :
      autoBlocked ? 'Copia automática detenida. Actualiza la lista para reanudarla.' :
        authorized ? dirty ? 'Cambios pendientes. La copia se guardará al terminar de editar.' : 'Copia automática activada mientras el helper siga conectado.' :
          dirty ? 'Cambios pendientes guardados en local. Vuelve a conectar la misma cuenta para copiarlos a Drive.' :
            'Copia automática configurada. Requiere conexión y autorización vigentes.';
    syncConfigControls();
    renderSync();
  }

  function clearCopies() {
    copies = new Map();
    ui.backups.replaceChildren();
    ui.empty.textContent = 'Inicia sesión para consultar tus copias.';
    lastSavedHash = '';
  }

  function cancelAuth(code = 'auth_cancelled') {
    if (!authPending) return;
    authAttempt += 1;
    authPending = false;
    clearTimeout(authTimer);
    authTimer = null;
    status(code);
    scheduleAuto();
  }

  function clearAuth({ keepAccount = false, keepDirty = false } = {}) {
    resetSync();
    generation += 1;
    authAttempt += 1;
    authPending = false;
    token = null;
    restoredAuthorizationId = ''; restoredAccountId = ''; accountVerified = false;
    expiresAt = 0;
    clearTimeout(expirationTimer);
    clearTimeout(autoTimer);
    clearTimeout(authTimer);
    clearTimeout(revokeTimer);
    expirationTimer = autoTimer = authTimer = revokeTimer = null;
    revoking = false;
    if (!keepDirty) { dirty = false; dirtyOwner = ''; }
    if (!keepAccount) account = null;
    for (const controller of requests) controller.abort();
    requests.clear();
    clearCopies();
    ui['revoke-confirmation'].hidden = true;
  }

  function expireToken() {
    post({ type: 'authorization-invalid', code: 'expired' });
    clearTimeout(syncTimer);
    token = null;
    expiresAt = 0;
    clearTimeout(expirationTimer);
    clearTimeout(autoTimer);
    for (const controller of requests) controller.abort();
    requests.clear();
    clearCopies();
    // A user-initiated renewal may still be waiting for Google when the old token expires.
    if (!authPending) status('expired');
    else render();
  }

  function disconnectGoogle(code = 'disconnected') {
    post({ type: 'authorization-invalid', code });
    clearAuth(); autoBlocked = false; status(code);
  }

  function loseBridge({ forgetAuthorization = false } = {}) {
    if (!bridgeAlive && !port && !forgetAuthorization) return;
    try { port?.postMessage({ protocol: PROTOCOL, type: 'bye', code: 'bridge_lost' }); } catch (_) { /* closed */ }
    bridgeAlive = false;
    configReady = false;
    // A dead MessagePort is not an expired Google token. Abort in-flight work,
    // keep the token in this window's memory, and rebind only to the original tab.
    generation += 1;
    authAttempt += 1;
    authPending = false;
    clearTimeout(authTimer); authTimer = null;
    clearTimeout(autoTimer); clearTimeout(syncTimer);
    if (revoking) clearAuth();
    for (const controller of requests) controller.abort();
    requests.clear();
    clearInterval(heartbeatTimer);
    clearTimeout(clientDraftTimer);
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(error('bridge_lost')); }
    pending.clear();
    try { port?.close(); } catch (_) { /* already closed */ }
    port = null;
    if (forgetAuthorization) { resumeAllowed = false; clearInterval(readyTimer); clearAuth(); }
    status(forgetAuthorization ? 'disconnected' : 'bridge_reconnecting');
  }

  function rpc(type, fields = {}) {
    if (!bridgeAlive) return Promise.reject(error('bridge_lost'));
    const id = `request_${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(error('timeout')); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      if (!post({ type, id, revision: configRevision, ...fields })) {
        clearTimeout(timeout); pending.delete(id); reject(error('bridge_lost'));
      }
    });
  }

  function validateConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.clientId !== 'string' ||
        typeof value.autoBackup !== 'boolean' || value.clientId.length > 300 ||
        (value.clientId && !CLIENT_ID.test(value.clientId))) throw error('invalid_config');
    const autoSync = value.autoSync === undefined ? true : value.autoSync;
    if (typeof autoSync !== 'boolean') throw error('invalid_config');
    const rememberAccount = value.rememberAccount === undefined ? true : value.rememberAccount;
    const hint = value.accountHint === undefined ? '' : value.accountHint;
    const draft = value.clientIdDraft === undefined ? null : value.clientIdDraft;
    if (typeof rememberAccount !== 'boolean' || typeof hint !== 'string' || hint.length > 254 ||
        (hint && !EMAIL.test(hint)) || (draft !== null && (typeof draft !== 'string' || draft.length > 300))) throw error('invalid_config');
    return { clientId: value.clientId, autoBackup: value.autoBackup, autoSync, rememberAccount,
      accountHint: rememberAccount ? hint : '', clientIdDraft: draft };
  }

  function receiveConfig(message) {
    const next = validateConfig(message.config);
    if (!Number.isSafeInteger(message.revision) || message.revision < 0) throw error('invalid_config');
    const clientChanged = next.clientId !== config.clientId;
    const first = !configReady;
    config = next;
    configRevision = message.revision;
    configReady = true;
    capabilities = new Set(Array.isArray(message.capabilities) ? message.capabilities.filter(value => typeof value === 'string') : []);
    if (clientChanged) {
      clearAuth();
      autoBlocked = false;
      if (!configWrites) clearTimeout(clientDraftTimer);
    }
    if (!config.autoBackup) { dirty = false; dirtyOwner = ''; clearTimeout(autoTimer); }
    if (first) {
      if (!capabilities.has('oauth-config')) ui['setup-status'].textContent = 'Actualiza el userscript a la versión 1.4.0 para configurar los ajustes desde esta ventana.';
    }
    if (isAuthorized()) status('connected');
    else if (clientChanged || first) status(!config.clientId ? 'missing_client' : account ? 'expired' : 'bridge_ready');
    else render();
    scheduleAuto();
    scheduleSync(1000);
  }

  function onPortMessage(event) {
    const message = event.data;
    if (!bridgeAlive || !message || message.protocol !== PROTOCOL) return;
    if (message.type === 'resume-pending-backup') {
      if (config.autoBackup && isAuthorized() && message.account === accountKey()) {
        dirty = true; dirtyOwner = message.account; scheduleAuto();
      }
      return;
    }
    if (message.type === 'restore-authorization') {
      const auth = message.authorization;
      if (!configReady || !auth || auth.clientId !== config.clientId || typeof auth.accessToken !== 'string'
          || !/^[\x21-\x7e]{1,8192}$/.test(auth.accessToken) || !Number.isSafeInteger(auth.expiresAt)
          || auth.expiresAt <= Date.now() || auth.expiresAt > Date.now() + 86400000
          || (auth.accountId && !/^[A-Za-z0-9_-]{1,200}$/.test(auth.accountId))) return;
      clearAuth();
      token = auth.accessToken; expiresAt = auth.expiresAt; restoredAuthorizationId = auth.id;
      restoredAccountId = auth.accountId || '';
      account = auth.accountId ? { id: auth.accountId } : null;
      expirationTimer = setTimeout(expireToken, expiresAt - Date.now());
      status('verifying');
      void operate(async () => {
        const expected = generation;
        await verifyStoredAccount(expected);
        await listCopies();
        if (syncEnabled()) await syncSettings();
      });
      return;
    }
    if (message.type === 'pong') { lastPong = Date.now(); return; }
    if (message.type === 'disconnect') { loseBridge({ forgetAuthorization: true }); return; }
    if (message.type === 'detach') { loseBridge(); return; }
    if (message.type === 'reply') {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timeout);
      if (message.ok === true) item.resolve(message);
      else item.reject(error(Object.hasOwn(STATUS, message.error) ? message.error : 'failed'));
      return;
    }
    if (message.type === 'config') {
      try { receiveConfig(message); } catch (_) { disconnectGoogle('invalid_config'); }
      return;
    }
    if (message.type === 'settings-changed' && syncEnabled() && message.sharedChanged !== false) {
      syncChangeRevision += 1; syncPending = true; scheduleSync(1500);
      // Report unsent edits immediately, without hiding an active operation or error.
      if (isAuthorized() && ['connected', 'synced', 'sync_pending', 'listed', 'saved', 'unchanged', 'restored'].includes(statusCode)) {
        status('sync_pending');
      } else render();
    }
    if (message.type === 'settings-changed' && config.autoBackup && message.backupChange !== false) {
      dirty = true;
      dirtyOwner = accountKey();
      scheduleAuto();
      render();
    }
  }

  function queueConfig(patch, message = 'Guardado automáticamente.') {
    if (!bridgeAlive || !capabilities.has('oauth-config')) return Promise.resolve(false);
    const feedback = (Object.hasOwn(patch, 'autoBackup') || Object.hasOwn(patch, 'autoSync')) ? ui['preferences-status'] :
      Object.hasOwn(patch, 'rememberAccount') ? ui['account-settings-status'] : ui['setup-status'];
    configWrites += 1;
    feedback.textContent = 'Guardando en el helper…';
    feedback.classList.remove('save-error');
    render();
    const task = configQueue.then(async () => {
      const value = { ...config, ...patch };
      if (value.clientId !== config.clientId || !value.rememberAccount) value.accountHint = '';
      const result = await rpc('set-config', { config: value });
      configSaveFailed = false;
      receiveConfig(result);
      feedback.textContent = message;
      return true;
    }).catch(caught => {
      configSaveFailed = true;
      feedback.textContent = STATUS[caught?.code] || STATUS.storage_error;
      feedback.classList.add('save-error');
      return false;
    }).finally(() => { configWrites -= 1; render(); scheduleAuto(); scheduleSync(1000); });
    configQueue = task;
    return task;
  }

  function flushClientDraft() {
    clearTimeout(clientDraftTimer);
    clientDraftTimer = null;
    const value = ui['client-id'].value.trim();
    if (!value || !CLIENT_ID.test(value) || value.length > 300) return;
    if (config.clientId === value && config.clientIdDraft === null) return;
    void queueConfig({ clientId: value, clientIdDraft: null });
  }

  function scheduleAuto() {
    post({ type: 'pending-backup', pending: dirty, account: dirtyOwner });
    clearTimeout(autoTimer);
    if (!dirty || !config.autoBackup || !isAuthorized() || autoBlocked || busy || authPending || revoking || configWrites) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (dirty && config.autoBackup && isAuthorized() && !autoBlocked && !busy && !authPending && !revoking && !configWrites) {
        dirty = false;
        void operate(async () => {
          try { await saveCopy(true); }
          catch (caught) { dirty = true; throw caught; }
        });
      }
    }, 5000);
  }

  function assertCurrent(expected) {
    if (!bridgeAlive) throw error('bridge_lost');
    if (expected !== generation || !isAuthorized() || (runtimeOptions.isCurrent && !runtimeOptions.isCurrent())) throw error('expired');
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
    if (restoredAuthorizationId && !headless) {
      await rpc('check-authorization', { authorizationId: restoredAuthorizationId });
      assertCurrent(expected);
    }
    if (!/^\/(?:upload\/)?drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(path) &&
        !(path === '/drive/v3/about' && method === 'GET')) throw error('failed');
    if (restoredAuthorizationId && path !== '/drive/v3/about' && !accountVerified) {
      await verifyStoredAccount(expected);
      assertCurrent(expected);
    }
    const url = new URL(path, 'https://www.googleapis.com');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    requests.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const response = await (runtimeOptions.fetch || fetch)(url.href, {
        method, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
        body, signal: controller.signal,
      });
      assertCurrent(expected);
      if (response.status === 401) { expireToken(); throw error('expired'); }
      if (response.status === 429) throw error('rate_limit');
      if (response.status === 403) {
        let reasons = [];
        try { reasons = JSON.parse(await readLimited(response))?.error?.errors?.map(item => item?.reason) || []; } catch (_) { /* bounded generic error */ }
        assertCurrent(expected);
        throw error(reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) ? 'rate_limit' :
          reasons.includes('insufficientPermissions') ? 'permission_missing' : 'api_denied');
      }
      if (!response.ok) throw error(method === 'POST' ? 'upload_uncertain' : 'failed');
      const text = await readLimited(response);
      assertCurrent(expected);
      try { return JSON.parse(text); } catch (_) { throw error('invalid_backup'); }
    } catch (caught) {
      if (caught?.code) throw caught;
      if (!bridgeAlive) throw error('bridge_lost');
      if (expected !== generation || !isAuthorized()) throw error('expired');
      throw error(method === 'POST' ? 'upload_uncertain' : timedOut ? 'timeout' : 'failed');
    } finally { clearTimeout(timeout); requests.delete(controller); }
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
    status('listed');
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
    await rpc('apply-backup', { json });
    // The imported configuration may deliberately change the OAuth client ID.
    // Its successful application is still acknowledged even if that clears auth.
    if (!bridgeAlive) throw error('bridge_lost');
    lastSavedHash = actualHash;
    status('restored');
  }

  async function operate(task) {
    if (busy || authPending || revoking) { status('busy'); return; }
    const expected = generation;
    busy = true;
    render();
    try { await task(); }
    catch (caught) {
      autoBlocked = true;
      const code = caught?.code;
      if (expected === generation) status(Object.hasOwn(STATUS, code) ? code : 'failed');
    } finally {
      busy = false;
      render();
      scheduleAuto();
      scheduleSync(syncPending ? 1500 : 15000);
    }
  }

  function loadGoogleLibrary() {
    if (headless || closed || libraryState === 'loading') return;
    if (gisAvailable()) { libraryState = 'ready'; status(config.clientId ? 'bridge_ready' : 'missing_client'); return; }
    const attempt = ++libraryAttempt;
    libraryState = 'loading';
    clearTimeout(libraryTimer);
    document.getElementById('google-identity')?.remove();
    const script = document.createElement('script');
    script.id = 'google-identity';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    function complete(code) {
      if (closed || attempt !== libraryAttempt || libraryState !== 'loading') return;
      clearTimeout(libraryTimer);
      libraryTimer = null;
      libraryState = code === 'ready' ? 'ready' : code === 'library_timeout' ? 'timeout' : 'error';
      script.onload = script.onerror = null;
      if (code === 'ready') status(config.clientId ? 'bridge_ready' : 'missing_client');
      else status(code);
    }
    // Register handlers before inserting the async script: even a cached response is observed.
    script.onload = () => complete(gisAvailable() ? 'ready' : 'library_error');
    script.onerror = () => complete('library_error');
    libraryTimer = setTimeout(() => complete('library_timeout'), LIBRARY_TIMEOUT);
    status('library_loading');
    document.head.append(script);
  }

  function oauthError(response) {
    const code = response?.error;
    if (code === 'access_denied') return 'denied';
    if (['invalid_client', 'unauthorized_client', 'deleted_client'].includes(code)) return 'invalid_client';
    if (['origin_mismatch', 'redirect_uri_mismatch'].includes(code)) return 'auth_origin';
    return 'auth_error';
  }

  async function identifyAccount(expected) {
    try {
      const result = await api('/drive/v3/about', { params: { fields: 'user(displayName,emailAddress,permissionId)' } });
      assertCurrent(expected);
      const user = result?.user;
      const name = typeof user?.displayName === 'string' ? user.displayName.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) : '';
      const email = typeof user?.emailAddress === 'string' && user.emailAddress.length <= 254 && EMAIL.test(user.emailAddress)
        ? user.emailAddress : '';
      const id = typeof user?.permissionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(user.permissionId) ? user.permissionId : '';
      return { name, email, id };
    } catch (caught) {
      if (caught?.code === 'expired' || caught?.code === 'bridge_lost') throw caught;
      // Account identity is optional. Never guess a name, email or OAuth sub from another field.
      return null;
    }
  }

  async function verifyStoredAccount(expected) {
    const identified = await identifyAccount(expected);
    assertCurrent(expected);
    // A network/identity lookup failure pauses work but does not revoke a valid token.
    if (!identified?.id) throw error('sync_account');
    if (restoredAccountId && identified.id !== restoredAccountId) { expireToken(); throw error('sync_account'); }
    account = identified; accountVerified = true;
    status('connected');
  }

  async function initializeSession(expected, previousAccount) {
    const nextAccount = await identifyAccount(expected);
    assertCurrent(expected);
    const previousKey = accountKey(previousAccount);
    const nextKey = accountKey(nextAccount);
    account = nextAccount;
    if (!previousKey || !nextKey || previousKey !== nextKey || (dirtyOwner && dirtyOwner !== nextKey)) {
      dirty = false;
      dirtyOwner = '';
    }
    if (nextAccount?.email && config.rememberAccount && capabilities.has('account-hint')) {
      try {
        await rpc('remember-account', { email: nextAccount.email });
        assertCurrent(expected);
      } catch (caught) {
        if (caught?.code === 'expired' || caught?.code === 'bridge_lost') throw caught;
        ui['setup-status'].textContent = 'La sesión está conectada, pero no se pudo recordar la cuenta en el helper.';
      }
    }
    assertCurrent(expected);
    if (!headless && capabilities.has('local-authorization-v1')) {
      // This credential travels only through the origin/source-bound private port.
      // Wait for a confirmed userscript-storage write before closing the OAuth UI.
      const saved = await rpc('store-authorization', { authorization: {
        clientId: config.clientId, accessToken: token, expiresAt, accountId: account?.id || '',
      } });
      assertCurrent(expected);
      if (saved.stored === true && post({ type: 'activate-local' })) {
        clearTimeout(autoTimer); clearTimeout(syncTimer);
        status('connected');
        try { window.close(); } catch (_) { /* The helper also asks its own popup to close. */ }
        return;
      }
      throw error('storage_error');
    }
    status('connected');
    await listCopies();
    if (syncEnabled()) await syncSettings();
  }

  function connectGoogle(selectAccount = false) {
    if (headless || !bridgeAlive || !config.clientId || !gisAvailable() || authPending || busy || revoking || configWrites) return;
    const expected = generation;
    const attempt = ++authAttempt;
    const previousAccount = account;
    const hint = config.rememberAccount ? account?.email || config.accountHint : '';
    const knownAccount = Boolean(account || hint);
    authPending = true;
    clearTimeout(autoTimer);
    ui['revoke-confirmation'].hidden = true;
    status(selectAccount ? 'switching_account' : knownAccount ? 'renewing' : 'connecting');
    const current = () => bridgeAlive && authPending && expected === generation && attempt === authAttempt;
    const finish = () => { authPending = false; authAttempt += 1; clearTimeout(authTimer); authTimer = null; };
    const failed = code => {
      if (!current()) return;
      finish();
      // Cancellation or failure does not discard an existing valid session.
      status(code);
      scheduleAuto();
    };
    authTimer = setTimeout(() => failed('auth_timeout'), AUTH_TIMEOUT);
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId, scope: SCOPE, include_granted_scopes: false,
        callback(response) {
          if (!current()) return;
          if (response?.error) { failed(oauthError(response)); return; }
          if (!response || typeof response.access_token !== 'string' || !response.access_token || response.access_token.length > 8192) {
            failed('auth_error'); return;
          }
          let granted = false;
          try { granted = window.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE); } catch (_) { /* unsupported response */ }
          if (!granted) { failed('permission_missing'); return; }
          const seconds = Number(response.expires_in);
          if (!Number.isFinite(seconds) || seconds <= 30 || seconds > 86400) { failed('auth_error'); return; }
          finish();
          generation += 1;
          for (const controller of requests) controller.abort();
          requests.clear();
          clearCopies();
          clearTimeout(expirationTimer);
          restoredAuthorizationId = '';
          token = response.access_token;
          expiresAt = Date.now() + seconds * 1000 - 30000;
          expirationTimer = setTimeout(expireToken, Math.min(expiresAt - Date.now(), 2147483647));
          autoBlocked = false;
          const acceptedGeneration = generation;
          status('connected');
          void operate(() => initializeSession(acceptedGeneration, previousAccount));
        },
        error_callback(response) {
          failed(response?.type === 'popup_closed' ? 'auth_closed' : response?.type === 'popup_failed_to_open' ? 'popup_blocked' : 'auth_error');
        },
      });
      // Remains directly in this click handler. No timer ever starts authorization.
      client.requestAccessToken({ prompt: selectAccount || !knownAccount ? 'select_account' : '',
        ...(!selectAccount && hint ? { login_hint: hint } : {}) });
    } catch (_) { failed('auth_error'); }
  }

  function revokeGoogle() {
    if (!isAuthorized() || authPending || busy || revoking || typeof window.google?.accounts?.oauth2?.revoke !== 'function') return;
    const expected = generation;
    const activeToken = token;
    revoking = true;
    clearTimeout(autoTimer);
    ui['revoke-confirmation'].hidden = true;
    status('revoking');
    const complete = successful => {
      if (closed || expected !== generation || !revoking) return;
      clearTimeout(revokeTimer);
      revokeTimer = null;
      revoking = false;
      if (successful) {
        disconnectGoogle('revoked');
        if (capabilities.has('oauth-config')) void queueConfig({ accountHint: '' });
      } else { status('revoke_failed'); scheduleAuto(); }
    };
    revokeTimer = setTimeout(() => complete(false), 15000);
    try { window.google.accounts.oauth2.revoke(activeToken, response => complete(response?.successful === true)); }
    catch (_) { complete(false); }
  }

  async function importClientFile() {
    const file = ui['import-client'].files?.[0];
    ui['import-client'].value = '';
    if (!file || !bridgeAlive || !capabilities.has('oauth-config')) return;
    try {
      if (file.size > 65536) throw error('invalid_config');
      const document = JSON.parse(await file.text());
      const web = document?.web;
      if (!web || typeof web !== 'object' || typeof web.client_id !== 'string' ||
          web.client_id.length > 300 || !CLIENT_ID.test(web.client_id)) {
        ui['setup-status'].textContent = 'El JSON debe ser de un cliente OAuth de tipo Aplicación web.';
        return;
      }
      if (!Array.isArray(web.javascript_origins) || !web.javascript_origins.includes(HELPER_ORIGIN)) {
        ui['setup-status'].textContent = `Añade ${HELPER_ORIGIN} como origen JavaScript autorizado y descarga de nuevo el JSON.`;
        return;
      }
      clearTimeout(clientDraftTimer);
      ui['client-id'].value = web.client_id;
      // Only these public configuration fields leave this function. client_secret is discarded.
      await queueConfig({ clientId: web.client_id, clientIdDraft: null }, 'Client ID importado y guardado automáticamente.');
    } catch (_) { ui['setup-status'].textContent = 'No se pudo importar el JSON de Google. Comprueba que sea válido y no supere 64 KiB.'; }
  }

  function beginBootstrap() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const nonce = fragment.get('bridge');
    const privateBridge = fragment.get('private') === '1';
    const opener = window.opener;
    if (location.origin !== HELPER_ORIGIN || location.pathname !== HELPER_PATH ||
        !opener || typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) {
      status('waiting');
      return;
    }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    const ready = () => {
      if (!resumeAllowed || closed) return;
      try { opener.postMessage({ protocol: PROTOCOL, type: 'ready', ...(privateBridge ? { private: true } : { nonce }) }, GAME_ORIGIN); }
      catch (_) { status('bridge_lost'); }
    };
    function receivePort(event) {
      const message = event.data;
      if (!resumeAllowed || closed || event.origin !== GAME_ORIGIN || event.source !== opener ||
          !message || message.protocol !== PROTOCOL || message.nonce !== nonce) return;
      if (message.type === 'disconnect') { loseBridge({ forgetAuthorization: true }); return; }
      if (message.type !== 'port' || event.ports.length !== 1) return;
      if (event.ports[0] === port) return;
      if (port) loseBridge();
      clearTimeout(bootstrapTimer);
      port = event.ports[0];
      bridgeAlive = true;
      port.onmessage = onPortMessage;
      port.onmessageerror = () => loseBridge();
      port.start();
      lastPong = Date.now();
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastPong > 45000) { loseBridge(); return; }
        post({ type: 'ping' });
        render();
      }, 10000);
      post({ type: 'port-ready' });
      try { window.opener = null; } catch (_) { /* browser may prohibit assignment */ }
      status(isAuthorized() ? 'connected' : 'bridge_ready');
      if (libraryState !== 'ready') loadGoogleLibrary();
      else render();
      scheduleAuto();
      scheduleSync(1000);
    }
    window.addEventListener('message', receivePort);
    ready();
    // Credential-enabled links never reveal their bootstrap secret to the game page.
    // Only the content-script closure and trusted popup know the private nonce.
    // Legacy non-credential links can still recover an existing window after reload.
    readyTimer = setInterval(ready, 3000);
    bootstrapTimer = setTimeout(() => {
      if (!port) status('bridge_lost');
    }, 20000);
  }

  ui.connect.addEventListener('click', () => connectGoogle(false));
  ui['switch-account'].addEventListener('click', () => connectGoogle(true));
  ui['cancel-auth'].addEventListener('click', () => cancelAuth());
  ui['retry-library'].addEventListener('click', loadGoogleLibrary);
  ui.disconnect.addEventListener('click', () => disconnectGoogle());
  ui.revoke.addEventListener('click', () => { ui['revoke-confirmation'].hidden = false; ui['confirm-revoke'].focus(); });
  ui['confirm-revoke'].addEventListener('click', revokeGoogle);
  ui['cancel-revoke'].addEventListener('click', () => { ui['revoke-confirmation'].hidden = true; ui.revoke.focus(); });
  ui.save.addEventListener('click', () => { void operate(() => saveCopy(false)); });
  ui.refresh.addEventListener('click', () => { void operate(listCopies); });
  ui.restore.addEventListener('click', () => { void operate(restoreCopy); });
  ui.backups.addEventListener('change', render);
  ui['client-id'].addEventListener('input', () => {
    clearTimeout(clientDraftTimer);
    const value = ui['client-id'].value;
    void queueConfig({ clientIdDraft: value }, 'Borrador guardado. La conexión conserva el Client ID activo hasta que completes uno válido.');
    if (CLIENT_ID.test(value.trim())) clientDraftTimer = setTimeout(() => {
      if (ui['client-id'].value === value) flushClientDraft();
    }, 400);
  });
  ui['client-id'].addEventListener('blur', flushClientDraft);
  ui['auto-sync'].addEventListener('change', () => { void queueConfig({ autoSync: ui['auto-sync'].checked }); });
  const onOnline = () => { syncFailures = 0; scheduleSync(0); };
  const onFocus = () => scheduleSync(500);
  const onVisible = () => { if (!document.hidden) scheduleSync(500); };
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  ui['auto-backup'].addEventListener('change', () => { void queueConfig({ autoBackup: ui['auto-backup'].checked }); });
  ui['remember-account'].addEventListener('change', () => { void queueConfig({ rememberAccount: ui['remember-account'].checked }); });
  ui['clear-client'].addEventListener('click', () => {
    clearTimeout(clientDraftTimer);
    ui['client-id'].value = '';
    void queueConfig({ clientId: '', clientIdDraft: null, accountHint: '' });
  });
  ui['choose-client-file'].addEventListener('click', () => ui['import-client'].click());
  ui['import-client'].addEventListener('change', () => { void importClientFile(); });
  ui['copy-origin'].addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(HELPER_ORIGIN); ui['copy-origin'].textContent = 'Origen copiado'; }
    catch (_) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('authorized-origin'));
      selection.removeAllRanges(); selection.addRange(range);
      ui['setup-status'].textContent = 'Origen seleccionado. Cópialo con el menú del navegador o el teclado.';
    }
  });
  function shutdown() {
    if (closed) return;
    post({ type: 'bye' });
    closed = true;
    clearAuth();
    clearInterval(heartbeatTimer);
    clearInterval(readyTimer);
    clearTimeout(bootstrapTimer);
    clearTimeout(clientDraftTimer);
    clearTimeout(libraryTimer);
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(error('bridge_lost')); }
    pending.clear();
    try { port?.close(); } catch (_) { /* already closed */ }
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('beforeunload', shutdown);
    document.removeEventListener('visibilitychange', onVisible);
  }
  window.addEventListener('beforeunload', shutdown);
  if (headless) {
    port = { postMessage: message => runtimeOptions.onMessage(message), close() {} };
    bridgeAlive = true;
    post({ type: 'port-ready' });
  } else {
  beginBootstrap();
  }
  render();
  return { receive: message => onPortMessage({ data: message }), destroy: shutdown };
})();
