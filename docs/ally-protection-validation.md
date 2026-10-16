# Protected-player validation: source checkpoint before integration

The final release integration and new independent review are documented in [the 1.16.0 matrix](1.16.0-validation-matrix.md). Results below belong only to the earlier checkpoint.

Date: 2026-10-14 UTC. Candidate based on published Helper 1.15.1. No real game session, live order, player contact, treaty, or account configuration was used or changed. All test identities are synthetic. Release versioning and integration belong to the parent release.

## Implemented boundary

- The generic list is empty by default. Local storage is scoped by exact account and galaxy. It is not part of backup/Drive/sync or metrics. A real player's name or ID is never shipped in defaults, examples, tests or release artifacts.
- A bound UUID persists through renames; identical aliases cannot overwrite another UUID. Name-only additions cannot downgrade an existing bound record. An unresolved alias pauses attacks and foreign sends until its ID is verified. Since 1.17.13 a route custom Send to a freshly verified self-owned destination is exempt only from this unrelated-alias veto; all other checks and protected matches remain. See [own reinforcement review validation](1.17.13-own-reinforcement-review-validation.md).
- `createNativeMissionAdapter.dispatch` covers queued preset/custom missions and retry/campaign amount missions. `createShiftPresetMenu.sendPreset` covers the immediate shortcut path. Both check before submission and in the final capture listener. No unguarded automatic `confirm.click()` remains.
- A partial, current native owner projection is required when any protection exists. Unknown/ambiguous owners, stale or disconnected observations, different scope/epoch, pending bridge delivery, dirty regions and changed ownership fail closed. Empty protection preserves the prior mission behavior.
- The page observer retains only public owner UUID/name/coordinates for this purpose, without other-player private economy, credits, fleets or transits. A scalar stamp on a detached private bridge element revokes an old snapshot synchronously, before deferred publication or MessagePort delivery.
- The immediate preset's inspection runs inside `nativeAction` so its own clicks cannot remove the confirmation guard. Its final guard also checks route, fleet quantities, stock and the exact confirmation control.
- UI scope and storage changes refresh the list. A stale form cannot write into a new account. Text rendering prevents HTML injection from names.

## Executed checks

- `node --test tests/*.test.cjs`: 1322 passed, 0 failed, 0 skipped.
- Four builds (`build-drive.cjs`, `build-sync.cjs`, `build-metrics.cjs`, `build-empire.cjs`) leave the candidate userscript byte-for-byte unchanged.
- `node --check` on userscript and changed observer/bridge modules; `git diff --check`: passed.
- Independent reviewer reproduced and verified fixes for alias-ID replacement, stale account UI, observation-publication races and shortcut inspection removing its guard.

New regression coverage:

- `ally-protection.test.cjs`: account scope, corrupt/unreadable storage, unknown/stale ownership, aliases, stable IDs, renames, duplicate names, stale forms and final re-reads.
- `ally-ownership.test.cjs`: exact native delta reduction, partial claims, privacy, conflicts, invalidation, lifecycle and synchronous pending markers.
- `ally-dispatch.test.cjs`: real adapter and immediate shortcut code over deterministic native-control DOM doubles. Includes legacy/custom/campaign-amount sends, protected destinations, capture during preparation/input, protection added in an earlier click listener, disconnection and final-click changes. No browser or network is involved.
- `ally-observation-race.test.cjs`: real observer → real generated bridge → delayed MessagePort → real guard, with a confirmation timer already queued before a capture delta.
- Existing empire/bridge privacy and isolation fixtures now implement the scalar marker and allow only the explicitly sanitized public ownership fields. Their prior secret/token/private-data checks remain.

## Pending checks and limitations

`tests/ally-protection.browser.cjs` is a browser-only local simulated-page fixture, not a passed result. Chromium could not launch in this executor: the sandbox denied its socket; the permitted escalated path failed in environment setup before starting the test. This was an infrastructure blocker, not a browser result. The fixture does not navigate to Old Light or make network requests.

Brave/Violentmonkey, real cross-realm marker visibility, live native DOM compatibility and real Drive interaction remain unvalidated. Installing this generic update does not add a particular person to the local list. Activating that protection requires verification of the native player UUID and saving it in the intended account/galaxy; no such configuration was performed here.

The local guard cannot cancel an already launched fleet, prevent manual native orders, or guarantee no combat after ownership changes in transit. The native bilateral treaty is the documented arrival-time protection. Shared defence, military reinforcement and observing attacks against third parties are not supported mechanics. See [official evidence](ally-defense-evidence.md).
