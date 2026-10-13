# Native empire state and navigation: implementation evidence

Research date: 2026-10-13 UTC. Read-only public HTTP and local source inspection only. No account login, live game selection, game actions, or authenticated API requests occurred. This document records the source evidence used by the runtime adapter; it is not a live-game validation.

## Earlier evidence from public landing/map assets

### Player identity is stored locally, but that is not server proof

[identity-dwwyDlBk.js](https://oldlight.io/assets/identity-dwwyDlBk.js) stores the player identifier at `oldlight.playerId`, with migration from `stellar.playerId`. The public map compares that identifier with `owners[].id` to distinguish the local player's empire visually.

This verifies the storage key and comparison mechanism. A mutable local-storage value alone does **not** establish the authenticated player, current membership, or current ownership. The scheduler must additionally validate against the game's current server-derived state.

### Public ownership map enumerates coordinates, not actionable system identities

[galaxy_map_view-DJ2JnTy3.js](https://oldlight.io/assets/galaxy_map_view-DJ2JnTy3.js) verifies:

- `owners[]` has `id`, `name`, `kind` (`human` or `npc`).
- `owned` uses parallel arrays `q`, `r`, `owner`, `type`.
- An `owned.owner[i]` value indexes `owners[]`.
- `se(data, q, r)` resolves the owner for a coordinate from those arrays.
- `pe()` collects an empire's coordinate list by matching the owner index.
- The reader fetches `options.mapUrl` when supplied, otherwise the API base's `/api/map`; its fetch uses a default cache policy unless explicitly refreshed.
- `territory` is a separate dataset. Territory hexes must not be interpreted as owned star systems.

No owned-system UUID field is present in the verified public-map schema. It is suitable for an ownership-coordinate cross-check, not by itself for safe action targeting, current ownership confirmation, or a complete synchronized economic snapshot. The public default `/api/map` is not yet proven to be the correct galaxy-scoped endpoint for every game slug.

Source navigation (zero-based character offsets in the exact fetched asset): schema `S` 3802; coordinate/owner resolver `se` 8990; owner comparison in `ce` 9374; empire coordinate extraction `pe` 15803; configurable map URL 24151.

### Game entry and existing helper navigation evidence

[enter_form-CLahF6gr.js](https://oldlight.io/assets/enter_form-CLahF6gr.js), offset 2034, sets the game entry route to `/game/galaxy/alpha`.

The existing userscript has these current local assumptions, which are not newly verified against the current game bundle:

- `systemId()` reads a UUID-like value from the URL's `system` query parameter (line 1688).
- `missionContext()` combines the pathname galaxy slug and `oldlight.playerId` for scope (line 8077).
- `fleetCounts()` reads title values from `[data-field="active-fleet-list"]` rows containing `.ship-icon-{type}` and recognizes `parked`, `away`, `building` (line 1693).
- The helper infers single selection when every ship type has an exact parked count, rather than the multi-selection dash/range.
- The native target resolver uses `#galaxy-map-btn`, `#galaxy-map-modal`, `#galaxy-map-viewport`, `input.gmap-search-input`, matching coordinate search options, `.galaxy-map-info`, and `button.galaxy-map-info-jump` (around lines 5798–5832).
- That resolver locates and inspects a target while keeping the origin. Its Jump button must not be assumed to make the inspected target the active owned system.
- Existing root automation operates on the currently rendered Structures/Shipyard panels; it has no verified owned-system roster traversal.

A URL parameter changing or a Jump button being available is not sufficient proof of a completed single-owned-system selection. Names must never be used as identities.

## Fleet totals: verified rule and unresolved renderer detail

The official [Fleet guide](https://oldlight.io/guide/fleet/) describes separate system fleet stacks. The [Fleet Movement guide](https://oldlight.io/guide/fleet-movement/) states that sent ships leave the origin's stack immediately and appear in the destination's stack upon arrival. Recalled ships return to their origin's stack. This supports treating a completed friendly transfer as destination parked ships, rather than a persistent origin-owned home fleet.

The game-bundle addendum below resolves the exact HUD `away` definition. In particular, friendly transfers are excluded from it.

Even if parked and away are disjoint in one authoritative game snapshot, sequential per-system snapshots can double-count: the source is observed with ships away before arrival, then the destination with the same ships parked after arrival. Conversely, the opposite scan order can omit ships. A defensible empire total requires one synchronized authoritative state snapshot or stable move IDs with reconciled movement state; otherwise display a qualified estimate and do not use that aggregate as a spending constraint.

## Initial gaps (superseded by the verified game-bundle addendum below)

1. The currently served `/game/galaxy/alpha` HTML and its entry/dependency bundle URLs. A read-only download of the public game shell was interrupted by tool-level automatic-review cancellation; no HTTP status or game content was obtained.
2. The native server-derived owned-system roster: system UUID, q/r, owner/player ID, galaxy scope, completeness/freshness markers, and the exact read mechanism.
3. The native single-selection control or function and its exact side effects, including query-string/history updates and whether selection can trigger Helper activity.
4. A reliable ready/ownership/selection confirmation after navigation, tied to the exact requested system UUID and player/galaxy.
5. The native fleet renderer/aggregation source proving parked, away, and building semantics and movement deduplication.

No guessed endpoint, synthesized ownership claim, or unverified navigation implementation should fill these gaps. A read-only copy of the public shell and imported scripts is sufficient for the next analysis step; account credentials are not needed.

## Captured source hashes

Public release marker in fetched bundles: `526e1feaf0acb4d2fcc1648f1c61eb81a26f0884`.

| Asset | SHA-256 |
| --- | --- |
| identity-dwwyDlBk.js | da6480a99ebef8d28a7a35ccb3bd80cc518b9bfceca91e8488d0c4a771f90e21 |
| base-CkpLJbQ4.js | aae85046ccca0c29a261fefd48c0ea2f39e503716f2ab0f09e1abbc075743f76 |
| galaxy_map_view-DJ2JnTy3.js | 50014f19a830852ea3a1da9e0274549a576285e24151fc78d06622a8fb33f3ff |
| map-CVq722Ta.js | 988bfdcbe9f8690ee71185b3def612509c97dbe62896d5a486bc0d9fb5312721 |
| enter_form-CLahF6gr.js | 715208c4893f2bdded9bd8703d05897701afc88c74967c53060e413e08fd5d22 |


# Verified game-bundle addendum

After new task authorization, the same cancelled public shell GET was retried exactly once and succeeded. The imported public game bundle was then downloaded read-only. No live game, account, socket connection, or API action was used.

Primary source: [galaxy-CqK10P8m.js](https://oldlight.io/assets/galaxy-CqK10P8m.js), SHA-256 `ba9c761ac00e7f513a58014a33574fbcfef1f4942ffc3b337ef606ea4ab0ccdc`. Release is the same `526e1feaf0acb4d2fcc1648f1c61eb81a26f0884`. Offsets below are zero-based characters in the fetched UTF-8-decoded JavaScript.

## Authoritative identity and complete own roster

- `mv` (514935) receives Socket.IO `world.init` containing `world`, `selfId`, `serverNow`, and `config`.
- Boot (around 533400) overwrites local `oldlight.playerId` from that **server-provided selfId**, then creates native state `An(world, selfId)`.
- `An.rebuildOwnedMap` (35118) indexes every `players[].owned[]` record both by coordinate and `owned.id`, attaching `playerId = player.id`.
- Own selection is `owned.playerId === state.myPlayerId`.
- Owned records expose `id`, `q`, `r`, `name`, `capturedAt`, `score`, `buildings`, and, for the current player, `fleet`, `economy`, `shipyard`, and `garrisonCap` where provided.
- `_me` is `players.find(player.id === myPlayerId)`; `_me.owned` is the complete server-driven own roster represented by the client. This is the appropriate roster source, rather than map visibility or all public territory.
- `myOwnedSorted` (40450) filters owned records by exact player ID. Sorting can be changed/frozen by the player overview, so the scheduler must not assume alphabetical order.
- `world.delta` is handled by `An.applyDelta`; `world.init` on reconnect replaces state and may change selfId. Source at 557405/558307 wires these updates.
- A full snapshot and its following ordered deltas form one state epoch. An independently fetched profile or per-system DOM scan is not automatically the same epoch.

The source proves data shape and native processing; an authenticated runtime fixture has not been captured. Native state `N` lives inside the boot function's module closure and is **not** a documented `window` global.

## Exact native read mechanisms

### Player profile HTTP read

`Us` (254154) invokes a GET through the credentialed base fetch wrapper:

`https://api.oldlight.io/api/galaxy/{slug}/players/{encodeURIComponent(playerId)}/profile`

No action token or POST is used. The profile renderer consumes `id`, `starCount`, `stars[]`, and other public profile fields. `stars[]` is consumed with coordinates, name, score, capturedAt, optional ID and fleet. At 391143 the own table adds economy and shipyard **from native state**, not from an assumed profile response.

`Nf` (394615) chooses the own-system table only when returned `profile.id === state.myPlayerId`; otherwise it renders the rival list. A parser should validate matching ID, complete starCount, unique valid UUIDs and coordinates, and fail closed if any required field is missing. The source alone does not guarantee all optional response fields are always present.

### Existing game socket

`lv` (514741) establishes the native Socket.IO connection to `https://api.oldlight.io`, websocket transport, credentialed, scoped to the current galaxy. The game receives `world.init` and `world.delta` and handles session displacement/loss.

No corresponding GET `/world`, `/state`, or `/owned-systems` was found or invented. Do not open a second native game socket merely for observation: the game explicitly handles session displacement from excessive sessions/devices. No plan to spoof client signals or bypass native restrictions is part of this research.

`hex:refresh` (around 517970) is a native socket request with `{ ownedHexId }`, returning `{ hex, ownerScore, ownerCanDeal, ownerStarCount, ownerProvocations }`. That is source evidence of a native read, not authorization to emit it or evidence that a direct HTTP equivalent exists.

## Exact native selection, ownership guards and confirmation

### Owned-system previous/next controls

Public shell and `pr` (53592):

- `[data-field="nameplate-prev"]` invokes the cycle callback with -1.
- `[data-field="nameplate-next"]` invokes it with +1.

`cycleActiveStar` (41084) moves through `myOwnedSorted()` and wraps. Boot callback `an` (550293) only activates if the result's UUID differs from the current UUID. Activation `$t` (547412) calls `N.setActiveStar(record)`, clears map target selection, pans camera, refreshes Structures, Shipyard, resources and fleet panels, and schedules rendering. It has no server mutation call.

`setActiveStar` (31736) clears multi-selection and toggles the new system **only if the active UUID changes**. Selecting the already active record does not collapse a multi-selection. The native cycle callback also refuses a same-ID result. Thus a scheduler cannot treat an unchanged URL as confirmation that multi-selection has been cleared.

`onActiveStarChanged` (533797) writes the UUID to `?system=` using `history.replaceState` (`jv`, 519882) and saves `oldlight.activeSystem.{galaxy}`. These writes are synchronous native selection effects. A helper merely changing the query string or dispatching `popstate` is not a verified selection mechanism.

### Owned-system Inspector Set active

Inspector `headerTrailing` (332789) uses `.info-modal-header-btn`:

- It has no trailing selection button when the inspected coordinate is already active.
- It renders **Set active** when current native state says the coordinate is owned by the current player.
- It renders **Jump to** otherwise.

The `activate` callback (540510) re-reads the owned record at the coordinate, checks `record.playerId === myPlayerId` immediately, and only then calls native activation `$t`. This is stronger than a stale captured button or a name match.

Global-map **Jump to** is a camera/target-navigation operation and does not select a different active origin. It must not be substituted for Inspector **Set active**.

### Full-page system deep link

At boot `Pv` / `Fv` (520271), the native client resolves the `system` query UUID through its roster and requires exact ownership by `myPlayerId`. Invalid, lost, or foreign IDs are rejected and the client falls back to its saved/native active system. A native full-page deep link therefore has an ownership gate, but its resulting URL/selection must still be verified after boot.

### Minimum adapter postconditions

Before enabling any spending action after navigation, require:

1. Same exact galaxy and validated authenticated-player epoch.
2. Requested UUID equals current native URL UUID and a current owned-roster entry.
3. Fresh rendered single-selection fleet rows for every ship type; multi-selection shows the exact `— parked` sentinel (108268 onward).
4. No pending helper request, native loading control, modal/user interaction, stale epoch, or socket/session-loss indication.
5. If using the Inspector route, exact saved coordinates and Set active semantics; names are never identity.

All selection is navigation-only, but changing selection while the existing Helper remains active could indirectly issue orders. It must occur under the same scheduler/mission/production interlock, never as an independent background enumerator.

## Owned profile DOM: useful but not complete identity/census data

Clicking `[data-field="player-name"]` opens the self profile (52600); native profile dialogs are marked `[data-self-profile]` only when the requested player ID is current self. The actual own table is `.player-profile-systable`, with `tbody > .player-profile-sysrow` and `.sys-name-text` buttons.

Rows do not expose a UUID or coordinate dataset. Row/name click opens an Inspector at coordinates stored in its native event closure; it does not directly activate the system. Names may collide. The table's rename control captures the optional UUID but does not publish it as a DOM data attribute.

This DOM is useful for read-only overview and completeness checking, but cannot safely become a UUID roster by scraping visible names. Opening/sorting the table can update the native frozen cycle order.

## Exact fleet semantics and the synchronized census requirement

`ra` (108268) computes the HUD **away** values from `_me.transits`:

1. If phase is `returning` or recalledAt is non-null, it reverses which endpoint is considered the home/remote endpoint.
2. It **skips the transit if the remote endpoint is currently owned by the current player**.
3. Otherwise it adds each ship quantity to the assigned home coordinate.

Consequences:

- Friendly inter-system transfers are not included in either system's HUD away value.
- A sum of all system HUD `parked + away + building` is incomplete even when synchronized: it omits those friendly transits.
- A source losing ownership or a return changing route can alter attribution. Do not reconstruct the empire census from those presentation values.

The fleet HUD reads parked ships from `activeStar.fleet[].quantity`. `computeBuildingByType` (111502) sums `activeStar.shipyard.queue[].quantityRemaining` by type and excludes every job with kind `scrap`. Ships waiting for scrap are still parked and must not be counted a second time or immediately removed.

For a complete own empire snapshot, aggregate by ship type from the **same native state epoch**:

- Existing parked: every self-owned system's `fleet[]`.
- In flight: every self player's `transits[].ships[]` once, deduplicating stable transit IDs and rejecting contradictory duplicate payloads.
- Future production, reported separately: remaining quantities in all non-scrap own shipyard jobs.

Do not add `incomingTransits`: those are hostile inbound visibility, not additional self-owned ships. Do not add the HUD away values if all self transits have already been included.

Sequential DOM scans remain non-atomic and can double-count or omit transfers around arrival. A full `world.init` plus ordered `world.delta` updates, or an explicitly synchronized complete runtime fixture, is required for an exact spending-governing census.

## Remaining smallest gap

The source-level roster, identity, UI navigation and fleet semantics are now verified. What remains is an authorized runtime observation adapter providing the **existing** native complete state stream and authenticated selfId to the helper without opening another game session, reading action tokens, or assuming access to a private module closure. Its behavior also needs runtime fixtures proving reconnect/reset, ownership loss, multi-selection and movement arrival handling.

A profile GET plus native cycle UI can establish and visit owned systems if its response includes valid IDs, but cannot supply the complete synchronized fleet census. Until that final adapter evidence exists, keep any empire aggregate explicitly incomplete and do not claim autonomous whole-empire production is end-to-end connected.

## Follow-up: DOM-only adapter feasibility

This section addresses the restriction against assuming private closure access, intercepting the socket, opening another socket, or copying credentials. None of those approaches was attempted or is proposed here.

### Global/snapshot bridge search

In the captured main bundle, inspection found no `window.<property> =` or `globalThis.<property> =` state assignment, no `new CustomEvent`, `dispatchEvent`, or `postMessage`, and no DOM listener exposing/requesting a game snapshot. The native state `N` is instantiated and retained inside `Oy`. Imports are libraries; the main entry boots itself rather than exporting this state. This is absence of a found supported bridge, not a claim about every future release.

### Own profile DOM field accuracy

- Open self profile through `[data-field="player-name"]`.
- Scope reads to `dialog.info-modal[data-content-type="player"][data-self-profile]` and `.player-profile-systable`.
- Enumerate `tbody > tr.player-profile-sysrow`, not footer totals.
- `.sys-name-text` contains the display name. Rows carry no native UUID or coordinate attribute. Both the row and name button open Inspector through coordinates captured by their listener.
- `td.sys-ship-col .sys-cell-count` contains localized exact parked count (or `-` at zero). `.sys-cell-away` is a slash-prefixed parked-plus-away total, not an additional count. When away is nonzero the cell title states exact parked and away counts. It uses the same hostile-only `ra` attribution described above.
- `td.sys-res-col .sys-res-value` is formatted through `H(value, true)`, a compact display; do not treat it as precise stockpile.
- `td.sys-queue-col` title and content give structure-job and ship-job counts, not queued ship quantities or complete building targets.
- `td.sys-move-col` gives counts of outgoing/incoming/hostile movements. Summing these per-system movement counts can count an internal transfer at both endpoints; they are not ship totals.
- Own profile live refresh re-reads current native ownership, removes lost systems and appends newly owned systems. It preserves native objects internally but does not publish their IDs to the DOM.

### Existing movements DOM

`Sa.refresh` (118741) takes all own `myTransits()` and visible hostile `myIncomingTransits()`, then filters by the selected All/Threats/Fleets/Trade tab. Filtered-out rows are removed from the visible list, so arbitrary current list contents are not a complete census.

The All/Fleets view can expose existing own combat fleets at:

`#transit-panel [data-field="transit-list"] > .movements-row[data-kind="outbound"]`

and the corresponding `data-kind="outbound-attack"` rows. Each `.movements-ship-chip` title gives exact ship class and quantity; returning/recalled rows have `data-recalling`. Incoming hostile rows use `data-kind="incoming-attack"` and do not belong in own totals. Trade/deal rows are separate kinds and have different contents.

There is **no transit UUID dataset** on these rows. UUIDs are keys in the private `rows` map and are captured by click callbacks. Route text uses names when available, not guaranteed coordinates; ETA is display text. Do not fabricate a unique transit ID from names, ETA or ship counts.

### Feasible boundary and smallest next evidence

A DOM-only controller can use native owned-only prev/next navigation, exact URL UUID confirmation, and per-system action guards. A verified profile GET response could supply the exhaustive UUID roster if all required IDs are actually present. The smallest next read-only runtime fixture is the current player's profile response with server identity/galaxy and sensitive unrelated fields omitted, plus DOM snapshots after own prev/next navigation performed under an automation pause/interlock.

That still does not establish a synchronized total of parked, all friendly/hostile own transit ships, and build queues. A profile + DOM summary must be labeled incomplete/non-atomic until a supported complete source exists. Do not silently replace the user's empire-wide budget constraint with a sum of observed active-system HUD values.
