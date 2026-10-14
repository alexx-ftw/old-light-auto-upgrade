# Ally protection: native evidence and limits

Research date: 2026-10-14 UTC. Public official documentation and read-only public JavaScript download only. No account, game session, live action, new socket, credentials, or private player record was accessed. Examples in tests are synthetic.

## What defensive help actually exists

- [Fleet Movement](https://oldlight.io/guide/fleet-movement/), “Seeing other fleets”: the client shows the player's own outbound fleets and hostile fleets inbound to the player's systems. It does not reveal another player's traffic. Consequently, observing the user's session cannot detect an attack against a friend.
- [Combat](https://oldlight.io/guide/combat/): combat ships arriving at another player's system battle that system's parked defenders. Surviving attackers return home. Sending such a fleet is not a friendly reinforcement mechanic.
- [Peace treaties](https://oldlight.io/blog/peace-treaties-in-a-browser-strategy-game/) (official developer post, 2026-09-12): formal alliances and shared defence are not implemented. A bilateral treaty lasts 14 days from acceptance, blocks hostile sends including probes, and cannot be cancelled unilaterally. The server also checks the treaty at arrival, turning around fleets launched earlier. Trade remains available.
- [Trade Hub](https://oldlight.io/guide/trade-hub/): palladium and iridium can be gifted by cargo to another player's system. The empire needs a second system for the Send Resources action, available cargo capacity and sufficient dispatch range. Storage limits can prevent full delivery. This can fund a friend's own defence, but is not troop support.
- [Deals](https://oldlight.io/guide/deals/): deals can transfer credits or systems and establish a treaty, subject to game eligibility and the recipient's acceptance. A transferred system does not include its fleet; parked ships relocate to the giver's other systems. An incoming attack does not block a deal, and whoever owns the destination when the attack lands takes the hit.

These facts support prevention, coordination and resource aid. They do not support claims of automatic shared defence, monitoring third-party threats, a troop-reinforcement order, or transferring an army through a system trade. No such actions are implemented by the observer.

## Public native source

[galaxy-CqK10P8m.js](https://oldlight.io/assets/galaxy-CqK10P8m.js), SHA-256 `ba9c761ac00e7f513a58014a33574fbcfef1f4942ffc3b337ef606ea4ab0ccdc`, release `526e1feaf0acb4d2fcc1648f1c61eb81a26f0884`. It was fetched again on the research date and matches the earlier empire evidence. Offsets below are zero-based characters in the decoded asset. They are source evidence, not a live runtime validation.

### Exact player identity route

1. Inspect a known system by its exact galaxy and coordinates. Native `Kc` (around 317100) resolves `state.getOwned(q,r)` and puts the record's `playerId` in `ownerPlayerId`. It distinguishes actual owned systems from nearby territory; territory must not be treated as an owned star.
2. In `el` (321986), the Owner control is a `button.inspect-owner-link`. Clicking it passes that exact `ownerPlayerId` to the native profile opener. Its text is only the public display name. There is no `data-player-id`, UUID-bearing `href`, or other verified public UUID attribute on this button.
3. The native profile loader `Ff` (394990 vicinity) calls `Us(e.playerId)`. `Us` (254154) makes the credentialed read-only GET `https://api.oldlight.io/api/galaxy/{slug}/players/{encodeURIComponent(playerId)}/profile`.
4. A correctly scoped request URL and its matching response `id` establish the requested player UUID. Check the response's public name and system coordinates as context; do not make a name match the identity. A manually inspected native network request/response is a concrete way to obtain this UUID without guessing a URL from a name. Do not expose cookies, headers, tokens, or unrelated fields.
5. `ff` (378348) renders `.player-profile-name` and may add `.player-profile-public-link` from the returned `publicProfilePath`. Its URL format is not proven to encode a UUID; do not parse one from it. The profile DOM itself does not supply a verified player UUID dataset.

The helper should store a verified exact UUID scoped to the galaxy. A public-name alias can conservatively block a suspected friend while verification is pending; it must never authorize an attack or substitute for stable identity. A profile response is not a synchronized ownership epoch and cannot authorize dispatch based solely on old coordinates.

### Ownership is not a complete world.players map

Native `An.rebuildOwnedMap` (35118) first builds records from `players[].owned[]`, attaching `playerId = player.id`. It then adds rival records from `stars.ownedStars()` where a star has `ownerId` and `hexId`. Those star records can also provide `ownerName`. Thus a world-event-only projection is necessarily partial; an absent coordinate is unknown, not dormant or unowned.

Native `gv` (516200 vicinity) supports existing-game socket reads `region:sectors` and `star:lookup`, returning `stars`. The dispatch endpoint resolver can use native `lookupStars`, and its result calls `N.stars.upsertCells(...)` then `N.refreshRivalsFromStars()` (around 541300). No direct HTTP equivalent or external callable state API is established here. The helper does not emit these socket requests or read action tokens.

`hex:refresh` (517756) takes `ownedHexId` and returns a hex plus public owner facts. This is another native read, not a complete-coordinate census or an authorization to open a second session. Inspector opening alone is not proven to force a fresh ownership response.

### Exact native world.delta ownership reducer

`An.applyDelta` (32407) processes:

1. Remove every `removed.playerIds` record.
2. Replace matching `updated.players` records. A nonempty `owned` replaces the old roster; an empty `owned` retains it. Updated players not already present are appended.
3. Append `added.players` only for IDs not already present. An added record for an existing player is ignored as a record.
4. Build the union of all coordinates explicitly listed in both updated and added records, plus the set of every player ID in those groups.
5. Remove those claimed coordinates from every player not in that touched-ID set. Touched players are exempt even if their `owned` list was empty. Claims from ignored added-existing records still participate in this pruning.
6. Rebuild the native ownership map, including its separate cached star source.

Two touched players claiming the same coordinate are unsafe for a helper. Although native map insertion order chooses a result, the observer refuses to authorize based on an ambiguous census.

`world.delta.updated.dirtySectors` (557917) causes native regional refresh. The observer does not consume the associated region ACK replies, so any nonempty or malformed dirty-sector signal invalidates the entire ownership projection until a new full world init. It must not keep an old rival owner merely because its own economic snapshot remains valid.

## Implemented conservative observer contract

The existing snapshot now has optional `ownership`:

```json
{"version":1,"complete":false,"players":[{"id":"<player UUID>","name":"<optional public name>","owned":[{"q":0,"r":0}]}]}
```

- It retains only player UUIDs, optional bounded public names and owned coordinate pairs. It retains no other player's fleets, transits, credits, economy, messages or credentials. No real player is hardcoded.
- It shares the containing snapshot's galaxy, authenticated self ID, generation, epoch and revision. Disconnection, session loss, malformed frames and a new connection erase it. Reconnect replaces rather than merges previous identities.
- Native replacement/pruning rules are reproduced; duplicate/conflicting coordinates fail closed. The self player's projected coordinates must match the economic roster.
- `complete:false` is mandatory. There is no claim of full galaxy coverage. Missing target coordinates, `ownership:null`, invalid scope, disconnected/stale state or an unknown owner cannot authorize a hostile send.
- Older bridge DTOs without this field become `ownership:null`. Malformed/incomplete ownership does not itself invalidate an otherwise valid own economy DTO. A later partial delta cannot rebuild a discarded base; fresh init is required.
- Unknown ownership is published immediately even when the economic snapshot remains complete. Normal valid updates wait for native handling before bridge delivery.
- Before any deferred publication, `onPending` synchronously updates a scalar stamp on the bridge's retained detached element: generation, epoch, revision, connected flag and observed timestamp only. `snapshot()` returns null whenever this marker differs from the most recently received MessagePort snapshot. Thus a valid capture delta cannot leave the old ownership usable while the timer or MessagePort delivery is still pending. The marker contains no player identity or state data.
- Names are optional and have native replacement semantics. Name omission is not evidence that a previously protected player became safe.

Tests: `tests/ally-ownership.test.cjs` covers projection/privacy, replacement, additions/removals, capture pruning, touched conflicts, dirty sectors, missing fields, reconnect/session loss, copies, bridge validation and aggregate limits. `tests/empire-bridge.test.cjs` additionally covers pending-marker revocation, delayed old deliveries and missing/malformed markers.

## Safety guarantee boundary

A final send-time guard must re-read the current snapshot and current target coordinates, with the existing mission/interlock controls. It can prevent a helper dispatch to a protected owner identified in that fresh observed epoch. It cannot atomically prevent a server ownership change between observation and launch, or a friend acquiring the destination while a fleet is already flying. A local name/UUID denylist is also not a server-side ban on manual native orders.

The game's accepted bilateral treaty is the verified arrival-time protection, and it expires. Do not promise that a local launch guard alone guarantees no eventual combat with a friend. A treaty proposal or renewal is an in-game agreement with another player and is not created by this read-only research.
