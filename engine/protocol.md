# Nishir Daak — client/server protocol

One endpoint: `POST /api` with a JSON body `{ op, ... }`, JSON response.
The server is authoritative. The client polls; locally the poll is a long-poll.

## Ops

| op | body | response |
|---|---|---|
| `create` | `{ name }` | `{ room, pid, token, view }` |
| `join` | `{ room, name }` | `{ room, pid, token, view }` or `{ error }` |
| `poll` | `{ room, pid, token, v, seq }` | `{ same: true, wait }` or `{ view, wait }` |
| `act` | `{ room, pid, token, seq, action }` | `{ ok: true, view }` or `{ error, view? }` |

`wait` = ms the client should sleep before polling again (0 on the local long-poll server, ~1000 on Netlify).
`v` = last view version the client has, `seq` = last event seq it has processed.
Unknown room / bad token → `{ error, gone: true }`.

## Actions

Lobby: `{type:'class', cls}` · `{type:'name', name}` · `{type:'addBot'}` (host) · `{type:'kick', pid}` (host) ·
`{type:'settings', goal?, timer?}` (host; goal ∈ 7|10|14, timer ∈ 0|45|75|120 seconds) · `{type:'start'}` (host, ≥2 players).

Play (own turn only, except emote/leave):
`{type:'play', uid, target?}` · `{type:'attack', uid, target}` · `{type:'skill', target}` · `{type:'end'}` ·
`{type:'emote', e}` · `{type:'leave'}` · `{type:'again'}` (host, after game over → back to lobby).

A target is `{ p: playerId, u: spiritUid | 'w' }`.

## View (what one player sees)

```js
{
  code, v, seq, phase: 'lobby'|'play'|'over', hostId, you,
  settings: { goal, rounds, timer },
  turn: pid|null, round, turnLeft: ms|null,
  deckCount, discardCount,
  players: [{
    id, name, bot, auto, online, cls, hp, maxHp, level, ff, flame, maxFlame,
    handCount, hand /* only for `you`: [{uid,id}] */,
    board: [{ uid, id, atk, hp, maxHp, kw: [], ready, stun, ward }],
    ko, ward, skillUsed
  }],
  events: [ /* events with seq > requested seq, oldest first, max 80 */ ],
  ranking: null | [{ id, ff, hp }]
}
```

`atk` on a spirit is its effective attack (auras included). Player order in `players` is turn order.

## Events

Every event has `seq` (monotonic) and `t`. Targets use `tp` (player id) + `t`... to avoid clashing with the
type field the target unit is `u` (spirit uid or `'w'`).

| t | fields | meaning |
|---|---|---|
| `start` | `order:[pid]` | game begins |
| `turn` | `p, round, flame, maxFlame` | p's turn starts (flame already refilled) |
| `draw` | `p, n, cards?` | p drew n cards; `cards:[{uid,id}]` only sent to p |
| `burn` | `p, id` | card discarded because p's hand was full |
| `play` | `p, uid, id, flame, target?` | card left p's hand; `flame` = p's flame after paying |
| `summon` | `p, s, idx` | spirit `s` (full object) entered p's board at index |
| `skill` | `p, cls, flame, target` | wanderer skill used |
| `atk` | `ap, a, tp, u` | spirit `a` of player `ap` attacks |
| `dmg` | `tp, u, n, hp, ward?` | n damage dealt; `ward:true` (n=0) if a Ward absorbed it |
| `heal` | `tp, u, n, hp` | |
| `stat` | `tp, u, atk, hp, maxHp, d?` | stats changed; `d:[datk,dhp]` for a visible buff/debuff |
| `status` | `tp, u, stun?, ward?, ready?` | flags changed |
| `die` | `tp, u, by` | spirit destroyed (`by` = pid credited or null) |
| `ff` | `p, n, ff, from?` | p gained n fireflies (total `ff`); `from:{tp,u}` where they came from |
| `lvl` | `p, level, hp, maxHp` | wanderer levelled up |
| `ko` | `p, by` | wanderer knocked out |
| `revive` | `p, hp` | wanderer back on their feet |
| `move` | `from, to, u, s` | spirit changed sides (`s` = object on the new side) |
| `bounce` | `tp, u, id, card?, burned?` | spirit returned to owner's hand (`card` only to owner) |
| `steal` | `from, to, card?, none?` | card stolen from hand (`card` only to the two involved) |
| `flame` | `p, flame, maxFlame` | flame changed outside of paying a cost |
| `say` | `tp, u, text` | a spirit (or wanderer, `u:'w'`) speaks |
| `emote` | `p, e` | player emote |
| `shuffle` | | discard pile reshuffled into the deck |
| `over` | `ranking, reason` | game over; reason `'goal'` or `'dawn'` |

## Rules summary

- Start: wanderer HP by class, 1 Flame. Turn order is shuffled. Opening hands by seat: 3, 4, 5, 5.
- Turn start: revive if KO (full HP); max Flame +1 (cap 7) and refill; draw 1 (2 if hand is empty);
  your spirits become ready; start-of-turn abilities.
- On your turn, any order: play cards (cost Flame), attack once with each ready spirit, use skill once (2 Flame).
- Combat: attacker and defending spirit damage each other at once. Attacking a wanderer has no retaliation.
- Destroying an enemy spirit: +1 firefly (+2 if its cost ≥ 5). Knocking out a wanderer: +3. A KO'd wanderer
  cannot be targeted and revives at the start of their own next turn.
- Level 2 at 3 fireflies, level 3 at 7: +2 max HP, heal 3, stronger skill.
- First to `goal` fireflies wins at once. Otherwise the game ends at dawn (after `rounds` rounds): most fireflies,
  then most HP.
- Turn timer: when it runs out the turn ends. Players offline > 30 s are played by a bot until they return.
