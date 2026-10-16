/* Explicit single-request transport. The core owns consent and rate limits. */
(function (root, factory) {
  'use strict';
  const commonJS = typeof module === 'object' && module && module.exports;
  const api = factory(commonJS ? require('./telemetry-core.js') : root.OldLightTelemetryCore,
    commonJS ? require('./telemetry-posthog-payload.js') : root.OldLightTelemetryPostHogPayload);
  if (commonJS) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightTelemetryPostHogTransport', { configurable: true, value: api });
})(typeof globalThis === 'object' ? globalThis : this, function (core, payload) {
  'use strict';
  const ENDPOINT = 'https://eu.i.posthog.com/i/v0/e/';
  const MAX_RESPONSE_BYTES = 4096;
  const rejected = () => ({ accepted: false });
  function create(options = {}) {
    // These are trusted construction dependencies, never UI/storage/report data.
    const { projectToken, request, randomUUID } = options;
    if (typeof projectToken !== 'string' || !/^phc_[A-Za-z0-9_-]{16,200}$/.test(projectToken)
      || typeof request !== 'function' || typeof randomUUID !== 'function') throw new TypeError('Invalid transport configuration');
    if (options.synthetic !== undefined && typeof options.synthetic !== 'boolean') throw new TypeError('Invalid synthetic option');
    const synthetic = options.synthetic === true;
    const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    let active = false;
    return function transport(report, context = {}) {
      if (active) return Promise.resolve(rejected());
      let data, signal;
      try {
        signal = context.signal;
        if (!signal || typeof signal.addEventListener !== 'function'
          || typeof signal.removeEventListener !== 'function' || signal.aborted) return Promise.resolve(rejected());
        const event = JSON.parse(payload.encode(report, randomUUID));
        if (synthetic) event.properties.synthetic = true;
        data = JSON.stringify({ api_key: projectToken, ...event });
        if (data.length > core.MAX_BYTES) return Promise.resolve(rejected());
      } catch (_) { return Promise.resolve(rejected()); }
      active = true;
      return new Promise(resolve => {
        let settled = false, handle = null, timer = null, abortPending = false;
        function finish(accepted) {
          if (settled) return;
          settled = true; active = false;
          try { if (timer !== null) cancel(timer); } catch (_) { /* No data retained. */ }
          try { signal.removeEventListener('abort', abort); } catch (_) { /* Settlement remains fail-closed. */ }
          resolve({ accepted: accepted === true });
        }
        function abort() {
          if (settled) return;
          abortPending = true;
          finish(false);
          try { handle?.abort(); } catch (_) { /* Revocation still settles locally. */ }
        }
        function onload(response) {
          try {
            if (signal.aborted || !response || response.finalUrl !== ENDPOINT
              || response.status < 200 || response.status >= 300 || !Number.isInteger(response.status)
              || typeof response.responseText !== 'string' || response.responseText.length > MAX_RESPONSE_BYTES) return finish(false);
            const body = JSON.parse(response.responseText);
            // Capture can return HTTP 200 while quota-limited; never call that accepted.
            // EU capture returns 'Ok'; legacy capture responses use numeric 1.
            finish(!!body && !Array.isArray(body) && (body.status === 'Ok' || body.status === 1)
              && (!Object.hasOwn(body, 'quota_limited') || (Array.isArray(body.quota_limited) && body.quota_limited.length === 0))
              && !Object.hasOwn(body, 'error'));
          } catch (_) { finish(false); }
        }
        try {
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted || settled) return abort();
          timer = later(abort, core.TIMEOUT);
          if (signal.aborted || settled) return abort();
          handle = request({
            method: 'POST', url: ENDPOINT, data, anonymous: true, withCredentials: false,
            // Empty privileged headers prevent sending the page's origin/referrer.
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: '', Origin: '' },
            responseType: 'text', timeout: core.TIMEOUT,
            // Supported managers may block redirects. VM documents finalUrl only:
            // its final URL is checked below; this is not a redirect-prevention guarantee.
            redirect: 'error',
            onload, onerror: () => finish(false), ontimeout: abort, onabort: () => finish(false),
            onreadystatechange(response) {
              if (response && ((response.status >= 300 && response.status < 400)
                || (response.finalUrl && response.finalUrl !== ENDPOINT))) abort();
            },
          });
          if (abortPending) { try { handle?.abort(); } catch (_) { /* Already settled. */ } }
          else if (!handle || typeof handle.abort !== 'function') finish(false);
        } catch (_) { abort(); }
      });
    };
  }
  return Object.freeze({ create, ENDPOINT });
});
