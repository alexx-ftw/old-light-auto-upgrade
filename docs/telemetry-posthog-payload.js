/* Pure allowlisted aggregate encoder; no storage or network. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module && module.exports
    ? require('./telemetry-core.js') : root.OldLightTelemetryCore);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightTelemetryPostHogPayload', { configurable: true, value: api });
})(typeof globalThis === 'object' ? globalThis : this, function (core) {
'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid aggregate');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value')) throw new TypeError('Invalid aggregate');
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function counters(value, allowed) {
  const data = fields(value, allowed), clean = {};
  for (const key of allowed) {
    if (!Object.hasOwn(data, key)) continue;
    const count = data[key];
    if (!Number.isSafeInteger(count) || count < 0 || count > core.MAX_COUNT) throw new TypeError('Invalid counter');
    if (count) clean[key] = count;
  }
  return clean;
}
function encode(report, randomUUID) {
  const data = fields(report, ['schema', 'helper_version', 'counts', 'duration_buckets']);
  if (data.schema !== core.SCHEMA || typeof data.helper_version !== 'string'
    || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(data.helper_version)) throw new TypeError('Invalid schema or version');
  const durations = fields(data.duration_buckets, ['helper_step']);
  const counts = counters(data.counts, core.EVENTS);
  const buckets = counters(durations.helper_step, core.BUCKETS);
  if (!Object.keys(counts).length && !Object.keys(buckets).length) throw new TypeError('Empty aggregate');
  const id = randomUUID();
  if (typeof id !== 'string' || !UUID.test(id) || id === '00000000-0000-4000-8000-000000000000') throw new TypeError('Invalid random identifier');
  // One fresh anonymous identifier per batch; never read an account/install ID.
  const event = { event: 'oldlight_helper.aggregate', distinct_id: id, properties: {
    $process_person_profile: false, $geoip_disable: true, $ip: '0.0.0.0',
    schema: data.schema, helper_version: data.helper_version, counts,
    duration_buckets: { helper_step: buckets },
  } };
  const json = JSON.stringify(event);
  if (json.length > core.MAX_BYTES) throw new TypeError('Oversized aggregate');
  return json;
}
return Object.freeze({ encode });
});
