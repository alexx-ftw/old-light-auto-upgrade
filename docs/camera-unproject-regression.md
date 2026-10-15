# Native camera observation regression

The user screenshot's `awaiting-native-projection` establishes that the native module import and singleton shape validation succeeded, but no accepted observation reached the overlay. It does not prove the exact runtime cause on that device.

Verified public sources:
- https://oldlight.io/assets/galaxy-CqK10P8m.js imports `Y as N` from transits and uses `camera=N` in its viewport.
- Viewport `onPointerMove` uses `unproject` for hover and pan. Viewport `visibleWorldBounds` delegates to the same singleton.
- https://oldlight.io/assets/transits-DloGaxtE.js exports the shared `oe` as `Y` and class `ae` as `J`. Its `visibleWorldBounds` invokes `this.unproject` four times, without calling `project`.
- GPU camera updates therefore need not supply a CPU `project` observation. The former observer only wrapped `project`, leaving this valid native route invisible.

The regression fixture contains the exact native camera class excerpt, its source offset and full-asset SHA-256. Executing its bounds path without a single project call produces zero snapshots in baseline c766af558f6f65ad39e881375101a1e7c1ec57cd (test fails `0 !== 1`). With the fix it produces a snapshot whose projection matches the official class exactly, and a subsequent native unproject call refreshes pan and zoom.

The fix wraps only the already-verified singleton's own project and unproject methods, preserving arguments, receiver, exceptions, return identities and original property descriptors. It does not modify prototypes, request game data, issue orders or infer star identity. Both methods carry camera x/y/zoom and screen dimensions at argument positions 2–6.

CSS geometry validation remains strict: backing-store pixels, miniature viewport dimensions and fractional mismatches are rejected, now with `native-viewport-size-mismatch` instead of silently remaining in the pending state. Foreign receivers, changed hooks, navigation and resize invalidate observations. This diagnosis does not claim a live Brave/Violentmonkey/Drive test or prove that device-specific geometry is correct; the new diagnostic distinguishes that remaining possibility.
