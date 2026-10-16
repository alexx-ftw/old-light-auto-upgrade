'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode } = require('../docs/telemetry-posthog-payload.cjs');
const core = require('../docs/telemetry-core.js');
const uuid = () => '12345678-1234-4234-8234-123456789abc';
const report = () => ({ schema: 1, helper_version: '1.17.8', counts: { 'helper.loaded': 1 }, duration_buckets: { helper_step: { lt_1ms: 2 } } });
test('fixed anonymous payload contains only allowlisted aggregate data', () => {
  const event = JSON.parse(encode(report(), uuid));
  assert.deepEqual(event, { event: 'oldlight_helper.aggregate', distinct_id: uuid(), properties: {
    $process_person_profile: false, $geoip_disable: true, $ip: '0.0.0.0', schema: 1, helper_version: '1.17.8',
    counts: { 'helper.loaded': 1 }, duration_buckets: { helper_step: { lt_1ms: 2 } },
  } });
});
test('all maximum counters fit bounded payload', () => {
  const input = report(); input.counts = Object.fromEntries(core.EVENTS.map(k => [k, core.MAX_COUNT]));
  input.duration_buckets.helper_step = Object.fromEntries(core.BUCKETS.map(k => [k, core.MAX_COUNT]));
  assert.ok(encode(input, uuid).length < core.MAX_BYTES);
});
for (const mutate of [
  x => x.secret = 'no', x => x.counts['message.text'] = 1,
  x => x.duration_buckets.helper_step['private'] = 1, x => x.schema = 2,
  x => x.helper_version = 'private@example.test', x => x.counts['helper.loaded'] = -1,
  x => x.counts['helper.loaded'] = Infinity, x => x.counts['helper.loaded'] = 0.5,
  x => x.counts['helper.loaded'] = core.MAX_COUNT + 1, x => x.counts = [],
  x => x.counts = Object.create({ 'helper.loaded': 1 }), x => x.duration_buckets = null,
  x => x[Symbol('private')] = 'private', x => x.counts = {},
]) test('malformed or non-allowlisted input is rejected: ' + mutate.toString(), () => {
  const input = report(); mutate(input); if (!Object.keys(input.counts || {}).length) input.duration_buckets = { helper_step: {} };
  assert.throws(() => encode(input, uuid));
});
test('getters and serialization hooks never run', () => {
  for (const key of ['counts', 'toJSON']) {
    let called = false; const input = report();
    Object.defineProperty(input, key, { get() { called = true; return {}; } });
    assert.throws(() => encode(input, uuid)); assert.equal(called, false);
  }
});
test('fresh generated IDs are required without accepting arbitrary identifiers', () => {
  for (const id of [undefined, 'account@example.test', '00000000-0000-4000-8000-000000000000']) assert.throws(() => encode(report(), () => id));
  let calls = 0; encode(report(), () => { calls++; return uuid(); }); assert.equal(calls, 1);
});
test('no live transport or credential is bundled in the prerequisite', () => {
  const fs = require('node:fs'); const source = fs.readFileSync(require.resolve('../docs/telemetry-posthog-payload.cjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|GM_xmlhttpRequest|localStorage|sessionStorage)\b|phc_|phx_|phk_|api_key|https?:\/\//);
});
