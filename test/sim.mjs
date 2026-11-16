// Nishir Daak — engine self-test:  node test/sim.mjs [gamesPerSize]
// 1. hundreds of bot-vs-bot games straight against the engine, with invariants
// 2. a tick()-driven game (bots + an absent human) on a fake clock
// 3. an API-level run through handle() with an in-memory store
import assert from 'node:assert/strict';
import { CARDS, CLASSES, DECK, MAX_BOARD, MAX_HAND, MAX_FLAME, skillPower } from '../public/js/cards.js';
import { newRoom, joinRoom, act, tick, touch, viewFor } from '../engine/engine.mjs';
import { chooseAction } from '../engine/bot.mjs';
import { handle, memoryStore } from '../engine/api.mjs';

const GAMES = Number(process.argv[2]) || 150;
const DECK_SIZE = DECK.reduce((n, [, c]) => n + c, 0);
const CLS = Object.keys(CLASSES);
const EVENT_TYPES = ['start', 'turn', 'draw', 'burn', 'play', 'summon', 'skill', 'atk', 'dmg', 'heal', 'stat', 'status',
  'die', 'ff', 'lvl', 'ko', 'revive', 'move', 'bounce', 'steal', 'flame', 'say', 'emote', 'shuffle', 'over'];

const seen = { cards: new Set(), skills: new Set(), events: new Set() };
let lastSeq = 0;

function scanEvents(st) {
  for (const e of st.log) {
    if (e.seq <= lastSeq) continue;
    assert.equal(e.seq, lastSeq + 1, 'event seq must be gapless');
    lastSeq = e.seq;
    assert.ok(EVENT_TYPES.includes(e.t), 'unknown event type ' + e.t);
    seen.events.add(e.t);
    if (e.t === 'play') seen.cards.add(e.id);
    if (e.t === 'skill') seen.skills.add(e.cls);
  }
}

function check(st) {
  let cards = st.deck.length + st.discard.length;
  for (const p of st.players) {
    cards += p.hand.length + p.board.length;
    assert.ok(p.hp >= 0 && p.hp <= p.maxHp, `hp ${p.hp}/${p.maxHp}`);
    assert.equal(p.ko, p.hp === 0, 'ko <=> 0 hp');
    assert.ok(p.flame >= 0 && p.maxFlame <= MAX_FLAME, 'flame bounds');
    assert.ok(p.board.length <= MAX_BOARD, 'board size');
    assert.ok(p.hand.length <= MAX_HAND, 'hand size');
    assert.ok(p.level >= 1 && p.level <= 3, 'level');
    for (const s of p.board) {
      assert.ok(s.hp > 0 && s.hp <= s.maxHp, `spirit hp ${s.id} ${s.hp}/${s.maxHp}`);
      assert.ok(s.atk >= 0 && Number.isInteger(s.atk), 'spirit atk');
      assert.ok(!('kb' in s), 'transient kill marker left behind');
      assert.ok(CARDS[s.id] && CARDS[s.id].type === 'spirit', 'spirit card');
    }
    for (const c of p.hand) assert.ok(CARDS[c.id], 'hand card');
  }
  if (st.phase !== 'lobby') assert.equal(cards, DECK_SIZE, 'cards are conserved');
  const uids = st.players.flatMap(p => [...p.hand.map(c => c.uid), ...p.board.map(s => s.uid)]);
  assert.equal(new Set(uids).size, uids.length, 'uids unique');
  assert.ok(st.log.length <= 240, 'log trimmed');
  assert.deepEqual(JSON.parse(JSON.stringify(st)), st, 'state is plain JSON');
}

function checkViews(st) {
  for (const p of st.players) {
    const v = viewFor(st, p.id, Math.max(0, st.seq - 30), 0);
    assert.ok(v.events.length <= 80);
    for (const q of v.players) {
      assert.equal('hand' in q, q.id === p.id, 'only your own hand is visible');
      assert.ok(!('token' in q), 'tokens never leave the server');
      for (const s of q.board) assert.ok(!('base' in s) && !('kb' in s));
    }
    for (const e of v.events) {
      if (e.t === 'draw') assert.equal('cards' in e, e.p === p.id, 'draws are private');
      if (e.t === 'steal' && e.card) assert.ok(e.from === p.id || e.to === p.id, 'steals are private');
      if (e.t === 'bounce' && e.card) assert.equal(e.tp, p.id, 'bounced card is private');
    }
    assert.ok(!JSON.stringify(v).includes(st.players.find(x => x.id !== p.id).token), 'no foreign token in view');
  }
}

function setup(n, goal) {
  const { state: st, pid } = newRoom('TEST', 'Host', 0);
  for (let i = 1; i < n; i++) assert.ok(act(st, pid, { type: 'addBot' }, 0).ok);
  for (const p of st.players) p.cls = CLS[Math.floor(Math.random() * CLS.length)];
  assert.ok(act(st, pid, { type: 'settings', goal, timer: 0 }, 0).ok);
  assert.ok(act(st, pid, { type: 'start' }, 0).ok);
  return st;
}

// ---- 0. rule scenarios ----------------------------------------------------------
function scene(clsA = 'ojha', clsB = 'ojha') {
  const { state: st, pid } = newRoom('UNIT', 'A', 0);
  const j = joinRoom(st, 'B', 0);
  act(st, pid, { type: 'settings', timer: 0 }, 0);
  assert.ok(act(st, pid, { type: 'start' }, 0).ok);
  const A = st.players.find(p => p.id === pid), B = st.players.find(p => p.id === j.pid);
  st.players = [A, B];
  st.ti = 0;
  for (const p of st.players) {
    Object.assign(p, { hand: [], board: [], flame: 7, maxFlame: 7, hp: 20, maxHp: 20, ff: 0, level: 1, skillUsed: false, ko: false, ward: false });
  }
  A.cls = clsA; B.cls = clsB;
  const give = (pl, id) => { const c = { uid: ++st.uidc, id }; pl.hand.push(c); return c; };
  const put = (pl, id, over = {}) => {
    const c = CARDS[id];
    const s = { uid: ++st.uidc, id, base: c.atk, atk: c.atk, hp: c.hp, maxHp: c.hp, kw: [...c.kw], ready: true, stun: false, ward: false, ...over };
    if (over.atk != null && over.base == null) s.base = over.atk;
    pl.board.push(s);
    return s;
  };
  const mark = () => st.seq;
  const ev = (t, since = 0) => st.log.filter(e => e.t === t && e.seq > since);
  const ok = (pl, action) => { const r = act(st, pl.id, action, 0); assert.ok(r.ok, `expected ok, got: ${r.error}`); };
  const err = (pl, action) => { const r = act(st, pl.id, action, 0); assert.ok(r.error, 'expected an error'); return r.error; };
  const T = (pl, s) => ({ p: pl.id, u: s ? s.uid : 'w' });
  return { st, A, B, give, put, ev, ok, err, T, mark };
}

{
  // reshuffle + turn draw + hand cap burn
  let x = scene();
  x.st.deck = []; x.st.discard = ['gechho', 'mamdo', 'aleya'];
  for (let i = 0; i < MAX_HAND; i++) x.give(x.B, 'tel');
  x.ok(x.A, { type: 'end' });
  assert.equal(x.ev('shuffle').length, 1, 'discard reshuffled');
  assert.equal(x.ev('burn').length, 1, 'full hand burns the draw');
  assert.equal(x.B.hand.length, MAX_HAND);
  assert.equal(x.st.players[x.st.ti], x.B);
  seen.events.add('shuffle');

  // guard, flying, blind
  x = scene();
  const g = x.put(x.B, 'gechho'); const m = x.put(x.B, 'mamdo');
  const mine = x.put(x.A, 'mamdo'); const horse = x.put(x.A, 'pakkhiraj'); const sk = x.put(x.A, 'skondho');
  assert.equal(x.err(x.A, { type: 'attack', uid: mine.uid, target: x.T(x.B) }), 'A Guard blocks the way');
  assert.equal(x.err(x.A, { type: 'attack', uid: mine.uid, target: x.T(x.B, m) }), 'A Guard blocks the way');
  x.ok(x.A, { type: 'attack', uid: horse.uid, target: x.T(x.B) });
  assert.equal(x.B.hp, 20 - horse.atk, 'flying ignores guard');
  assert.ok(x.err(x.A, { type: 'attack', uid: horse.uid, target: x.T(x.B) }), 'one attack per turn');
  x.ok(x.A, { type: 'attack', uid: sk.uid, target: x.T(x.B) });
  assert.equal(x.ev('atk').pop().u, g.uid, 'headless swing still has to hit the guard');
  assert.ok(x.err(x.A, { type: 'attack', uid: mine.uid, target: x.T(x.A, horse) }), 'cannot attack own side');

  // venom + greater spirit fireflies + drain + retaliation
  x = scene();
  const big = x.put(x.B, 'brahma'); const snake = x.put(x.A, 'nagini', { hp: 9, maxHp: 9 });
  x.ok(x.A, { type: 'attack', uid: snake.uid, target: x.T(x.B, big) });
  assert.ok(!x.B.board.length && x.A.ff === 2, 'venom kills, cost 5+ gives 2 fireflies');
  assert.equal(snake.hp, 9 - big.atk, 'defender hits back');
  x = scene();
  x.A.hp = 10; const leech = x.put(x.A, 'pishach', { atk: 3 });
  x.ok(x.A, { type: 'attack', uid: leech.uid, target: x.T(x.B) });
  assert.ok(x.A.hp === 13 && x.B.hp === 17, 'drain heals for damage dealt');

  // aleya haunt, rakkhosh devour, khokkosh kin aura, slayers
  x = scene();
  const wisp = x.put(x.B, 'aleya', { atk: 1 });
  const rk = x.put(x.A, 'rakkhosh', { atk: 5, hp: 5, maxHp: 5 }); const kh = x.put(x.A, 'khokkosh', { atk: 2 });
  kh.atk = 3; // aura already applied
  x.ok(x.A, { type: 'attack', uid: rk.uid, target: x.T(x.B, wisp) });
  assert.deepEqual([rk.atk, rk.hp, rk.maxHp], [6, 3, 6], 'devour +1/+1, then 1 retaliation and 2 haunt damage');
  assert.equal(x.A.ff, 1);
  const princes = x.put(x.B, 'lalneel', { atk: 3, hp: 4, maxHp: 4 });
  x.ok(x.A, { type: 'end' });
  let at = x.mark();
  x.ok(x.B, { type: 'attack', uid: princes.uid, target: x.T(x.A, rk) });
  assert.ok(!x.A.board.includes(rk), 'slayers deal double damage to Rakkhosh');
  assert.equal(x.ev('say', at).length, 2, 'banter pair spoken');
  assert.equal(kh.atk, 2, 'kin aura ends with Rakkhosh');
  assert.ok(x.ev('stat', at).some(e => e.u === kh.uid && e.atk === 2 && !e.d), 'aura change emits stat');
  x = scene();
  const kh2 = x.put(x.A, 'khokkosh', { atk: 2 }); const rc = x.give(x.A, 'rakkhosh');
  x.ok(x.A, { type: 'play', uid: rc.uid });
  assert.equal(kh2.atk, 3, 'kin aura on summon');
  assert.ok(x.ev('say').some(e => e.u === kh2.uid), 'khokkosh reacts to uncle');
  assert.equal(x.A.board[1].uid, rc.uid, 'spirit keeps its card uid');
  assert.ok(x.err(x.A, { type: 'attack', uid: rc.uid, target: x.T(x.B) }), 'summoning sickness');

  // betal returns to hand, credit still given
  x = scene();
  const bt = x.put(x.B, 'betal', { hp: 1, maxHp: 3 }); const hit = x.put(x.A, 'mamdo', { hp: 9, maxHp: 9 });
  x.ok(x.A, { type: 'attack', uid: hit.uid, target: x.T(x.B, bt) });
  assert.ok(x.B.hand.some(c => c.uid === bt.uid && c.id === 'betal') && !x.B.board.length, 'betal back in hand');
  assert.ok(x.ev('bounce').length === 1 && x.ev('die').length === 0 && x.A.ff === 1);

  // calls: nishi lure (+needRoom), shakchunni copy, jujuburi bounce, mechho steal, boba stun, petni, daini, byangoma, jinn
  x = scene();
  const prey = x.put(x.B, 'mamdo', { hp: 2, maxHp: 2 }); const tough = x.put(x.B, 'brahma');
  let c = x.give(x.A, 'nishi');
  assert.ok(x.err(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, tough) }), 'too healthy to lure');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, prey) });
  assert.ok(x.A.board.includes(prey) && !x.B.board.includes(prey) && !prey.ready && x.ev('move').length === 1, 'lured');
  x.A.flame = 7; c = x.give(x.A, 'shakchunni');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, tough) });
  let sh = x.A.board.find(s => s.id === 'shakchunni');
  assert.deepEqual([sh.atk, sh.hp, sh.maxHp], [tough.atk, tough.hp, tough.hp], 'possess copies stats');
  x.A.flame = 7; c = x.give(x.A, 'jujuburi');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, tough) });
  assert.ok(!x.B.board.length && x.B.hand.some(k => k.uid === tough.uid), 'scared back to hand');
  x.A.flame = 7; c = x.give(x.A, 'nishi');
  assert.equal(x.A.board.length, MAX_BOARD);
  assert.equal(x.err(x.A, { type: 'play', uid: c.uid }), 'Your grove is full');

  x = scene();
  x.give(x.B, 'agni'); c = x.give(x.A, 'mechho');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B) });
  assert.ok(x.A.hand.some(k => k.id === 'agni') && !x.B.hand.length && x.ev('steal')[0].card.id === 'agni', 'stolen');
  const brute = x.put(x.B, 'rakkhosh', { atk: 5 });
  x.A.flame = 7; c = x.give(x.A, 'boba');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, brute) });
  assert.ok(brute.stun);
  x.A.flame = 7; c = x.give(x.A, 'petni');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, brute) });
  assert.equal(brute.atk, 3, 'wail -2 attack');
  x.A.flame = 7; c = x.give(x.A, 'daini');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B) });
  assert.equal(x.B.hp, 18, 'hex');
  x.ok(x.A, { type: 'end' });
  assert.ok(x.err(x.B, { type: 'attack', uid: brute.uid, target: x.T(x.A) }).includes('stunned'));
  x.ok(x.B, { type: 'end' });
  assert.ok(!brute.stun, 'stun wears off after the owner\'s turn');

  x = scene();
  x.st.deck = ['gechho', 'gechho', 'gechho', 'gechho'];
  c = x.give(x.A, 'byangoma');
  x.ok(x.A, { type: 'play', uid: c.uid });
  assert.equal(x.A.hand.length, 2, 'birds draw 2');
  const w1 = x.put(x.B, 'aleya', { hp: 1, maxHp: 1 }); const w2 = x.put(x.B, 'brahma'); x.put(x.A, 'gechho');
  x.A.flame = 7; c = x.give(x.A, 'jinn');
  x.ok(x.A, { type: 'play', uid: c.uid });
  assert.ok(!x.B.board.includes(w1) && w2.hp === w2.maxHp - 1 && x.A.board[1].hp === x.A.board[1].maxHp, 'smokeless fire hits enemies only');

  // charms
  x = scene();
  const e1 = x.put(x.B, 'gechho', { hp: 3, maxHp: 3 }); const e2 = x.put(x.B, 'mamdo', { hp: 2, maxHp: 2 });
  c = x.give(x.A, 'kabach');
  assert.ok(x.err(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, e1) }), 'ward is friendly only');
  assert.ok(x.err(x.A, { type: 'play', uid: c.uid }), 'charm needs its target');
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.A) });
  assert.ok(x.A.ward);
  c = x.give(x.A, 'sorshe'); x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B) });
  assert.ok(e1.hp === 1 && !x.B.board.includes(e2) && x.A.ff === 1, 'mustard smoke');
  x.A.flame = 0; c = x.give(x.A, 'tel'); x.ok(x.A, { type: 'play', uid: c.uid });
  assert.equal(x.A.flame, 2);
  c = x.give(x.A, 'loha'); x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, e1) });
  assert.ok(!x.B.board.length && x.A.ff === 2, 'iron nail finishes it');
  x.A.flame = 7; const e3 = x.put(x.B, 'jinn', { ward: true });
  c = x.give(x.A, 'agni'); at = x.mark();
  x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, e3) });
  assert.ok(e3.hp === e3.maxHp && !e3.ward && x.ev('dmg', at)[0].ward === true && x.ev('dmg', at)[0].n === 0, 'ward absorbs');
  c = x.give(x.A, 'morog'); x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B, e3) });
  assert.ok(!x.B.board.length && x.A.ff === 4 && x.A.level === 2, 'rooster destroys; level 2 at 3 fireflies');
  assert.ok(x.A.maxHp === 22 && x.ev('lvl').length === 1);
  x.A.flame = 7; x.A.hp = 10; x.put(x.A, 'mechho'); x.st.deck = ['gechho', 'gechho', 'gechho'];
  const before = x.A.hand.length;
  c = x.give(x.A, 'ilish'); x.ok(x.A, { type: 'play', uid: c.uid });
  assert.ok(x.A.hp === 15 && x.A.hand.length === before + 2, 'hilsa heals and feeds the fish ghost');
  x.put(x.B, 'mamdo'); x.put(x.B, 'mamdo');
  c = x.give(x.A, 'ghum'); x.ok(x.A, { type: 'play', uid: c.uid, target: x.T(x.B) });
  assert.ok(x.B.board.every(s => s.stun));
  c = x.give(x.A, 'jhuli'); x.A.flame = 7; x.st.deck = ['gechho', 'gechho'];
  const h2 = x.A.hand.length; x.ok(x.A, { type: 'play', uid: c.uid });
  assert.equal(x.A.hand.length, h2 - 1 + 2);
  assert.equal(x.err(x.A, { type: 'play', uid: x.give(x.A, 'jinn').uid }), 'Not enough Flame');

  // start/end of turn abilities, KO + revive, enemy wanderer protection while KO
  x = scene('shikari', 'kabiraj');
  x.put(x.B, 'jokkho'); x.put(x.B, 'brahma'); const moon = x.put(x.B, 'chandburi');
  x.B.board[0].hp -= 2; x.B.hp = 10; x.B.maxFlame = 3;
  x.ok(x.A, { type: 'end' });
  assert.ok(x.B.flame === 5 && x.B.maxFlame === 4, 'jokkho grants +1 flame over the refill');
  assert.equal(x.B.hp, 12, 'brahmadaitya blessing');
  x.ok(x.B, { type: 'skill', target: x.T(x.B) });
  const mend = skillPower('kabiraj', 1).heal;
  assert.ok(x.B.hp === 12 + mend && x.B.skillUsed && x.B.flame === 3, 'herb poultice');
  assert.equal(x.err(x.B, { type: 'skill', target: x.T(x.B) }), 'Already used this turn');
  x.ok(x.B, { type: 'end' });
  assert.ok(x.B.hp === 13 + mend && x.B.board[0].hp === x.B.board[0].maxHp - 1 && moon.hp === moon.maxHp, 'moon thread heals others');
  x.B.hp = 1; x.B.board = [];
  x.ok(x.A, { type: 'skill', target: x.T(x.B) });
  assert.ok(x.B.ko && x.A.ff === 3 && x.A.level === 2 && x.ev('ko').length === 1, 'knock-out gives 3 fireflies');
  const arrow = x.put(x.A, 'mamdo');
  assert.ok(x.err(x.A, { type: 'attack', uid: arrow.uid, target: x.T(x.B) }), 'a lost wanderer cannot be hit');
  x.ok(x.A, { type: 'end' });
  assert.ok(!x.B.ko && x.B.hp === x.B.maxHp && x.ev('revive').length === 1, 'revives on own turn');

  // skills: ojha, baul, dakat
  x = scene('ojha', 'dakat');
  const tgt = x.put(x.B, 'brahma'); const pal = x.put(x.A, 'gechho');
  assert.ok(x.err(x.A, { type: 'skill', target: x.T(x.B) }), 'ojha cannot hit wanderers');
  x.ok(x.A, { type: 'skill', target: x.T(x.B, tgt) });
  assert.ok(tgt.hp < tgt.maxHp);
  x.A.cls = 'baul'; x.A.skillUsed = false;
  x.ok(x.A, { type: 'skill', target: x.T(x.A, pal) });
  const song = skillPower('baul', 1);
  assert.deepEqual([pal.atk, pal.hp, pal.maxHp], [CARDS.gechho.atk + song.atk, CARDS.gechho.hp + song.hp, CARDS.gechho.hp + song.hp]);
  x.give(x.A, 'tel'); x.ok(x.A, { type: 'end' });
  x.B.hand = [];
  x.ok(x.B, { type: 'skill', target: x.T(x.A) });
  assert.ok(x.B.hand.length === 1 && x.B.hand[0].id === 'tel' && x.A.hand.length === 0, 'highway toll takes a card');

  // goal ends the game at once; dawn ends it otherwise
  x = scene();
  x.A.ff = x.st.settings.goal - 1; const last = x.put(x.B, 'aleya', { hp: 1, maxHp: 1 }); const fin = x.put(x.A, 'brahma');
  x.ok(x.A, { type: 'attack', uid: fin.uid, target: x.T(x.B, last) });
  assert.ok(x.st.phase === 'over' && x.st.ranking[0].id === x.A.id && x.ev('over')[0].reason === 'goal');
  assert.equal(x.err(x.A, { type: 'end' }), 'The game is over');
  x = scene();
  x.st.round = x.st.settings.rounds; x.st.ti = 1; x.B.ff = 2;
  x.ok(x.B, { type: 'end' });
  assert.ok(x.st.phase === 'over' && x.ev('over')[0].reason === 'dawn' && x.st.ranking[0].id === x.B.id);
  console.log('\nRule scenarios: ok');
}

// ---- 1. direct bot-vs-bot games ------------------------------------------------
const stats = {};
for (const n of [2, 3, 4]) {
  const S = stats[n] = { rounds: 0, actions: 0, goal: 0, dawn: 0, wins: {}, picks: {}, seat: Array(n).fill(0), topFF: 0, kos: 0 };
  for (let g = 0; g < GAMES; g++) {
    lastSeq = 0;
    const st = setup(n, 10);
    let actions = 0;
    while (st.phase === 'play') {
      const p = st.players[st.ti];
      const a = chooseAction(st, p.id);
      const r = act(st, p.id, a, 0);
      assert.ok(r.ok, `bot chose an illegal action ${JSON.stringify(a)} -> ${r.error}`);
      actions++;
      assert.ok(actions < 5000, 'game did not terminate');
      scanEvents(st);
      check(st);
      if (actions % 25 === 0) checkViews(st);
    }
    checkViews(st);
    const over = st.log[st.log.length - 1];
    assert.equal(over.t, 'over');
    S[over.reason]++;
    S.rounds += st.round;
    S.actions += actions;
    S.kos += st.log.filter(e => e.t === 'ko').length; // (log tail only, indicative)
    const win = st.players.find(p => p.id === st.ranking[0].id);
    S.wins[win.cls] = (S.wins[win.cls] || 0) + 1;
    S.seat[st.players.indexOf(win)]++;
    S.topFF += st.ranking[0].ff;
    for (const p of st.players) S.picks[p.cls] = (S.picks[p.cls] || 0) + 1;
  }
}

console.log(`\nDirect sims: ${GAMES} games each, goal 10 fireflies, dawn after 12 rounds`);
for (const n of [2, 3, 4]) {
  const S = stats[n];
  const cls = CLS.map(c => `${c} ${S.picks[c] ? (100 * (S.wins[c] || 0) / S.picks[c]).toFixed(0) : '-'}%`).join('  ');
  console.log(`  ${n}p: avg rounds ${(S.rounds / GAMES).toFixed(1)}, avg actions ${(S.actions / GAMES).toFixed(0)}, ` +
    `ended by goal ${S.goal} / dawn ${S.dawn}, winner avg fireflies ${(S.topFF / GAMES).toFixed(1)}`);
  console.log(`      win rate per pick (fair = ${(100 / n).toFixed(0)}%): ${cls}`);
  console.log(`      wins by seat: ${S.seat.join(' / ')}`);
}

const missingCards = Object.keys(CARDS).filter(id => !seen.cards.has(id));
const missingSkills = CLS.filter(c => !seen.skills.has(c));
const missingEvents = EVENT_TYPES.filter(t => !seen.events.has(t) && t !== 'emote');
assert.deepEqual(missingCards, [], 'every card got played');
assert.deepEqual(missingSkills, [], 'every class skill got used');
assert.deepEqual(missingEvents, [], 'every event type got emitted');
console.log(`  coverage: ${seen.cards.size}/${Object.keys(CARDS).length} cards, ${seen.skills.size}/${CLS.length} skills, ${seen.events.size} event types`);

// ---- 2. tick-driven game on a fake clock (bots + an absent human) -------------------
{
  lastSeq = 0;
  const { state: st, pid } = newRoom('TICK', 'Sleepy', 0);
  act(st, pid, { type: 'addBot' }, 0);
  act(st, pid, { type: 'addBot' }, 0);
  act(st, pid, { type: 'settings', goal: 7, timer: 45 }, 0);
  assert.ok(act(st, pid, { type: 'start' }, 0).ok);
  const human = st.players.find(p => p.id === pid);
  let now = 0, steps = 0, sawAuto = false, timerEnds = 0;
  while (st.phase === 'play') {
    now += 300;
    const wasTurn = st.players[st.ti].id;
    const changed = tick(st, now);
    if (human.auto) sawAuto = true;
    if (changed && wasTurn === pid && !human.auto) timerEnds++;
    // the human shows up briefly mid-game, then leaves the tab again
    if (now > 60000 && now < 200000) touch(st, pid, now);
    scanEvents(st);
    check(st);
    assert.ok(++steps < 200000, 'tick game did not terminate');
  }
  assert.ok(sawAuto, 'offline human was taken over by a bot');
  console.log(`\nTick sim: finished in ${(now / 1000).toFixed(0)} s of game time, ${st.round} rounds, ` +
    `human auto-played: ${sawAuto}, turns ended by timer: ${timerEnds}`);
}

// ---- 3. API level ---------------------------------------------------------------------
{
  lastSeq = 0;
  const store = memoryStore();
  let now = 1000;
  const call = body => handle(body, store, now += 50, { wait: 0 });

  const a = await call({ op: 'create', name: '  <b>Mashroor the Magnificent</b> ' });
  assert.match(a.room, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(a.view.phase, 'lobby');
  assert.ok(a.view.players[0].name.length <= 14 && !a.view.players[0].name.includes('<'));
  const A = { room: a.room, pid: a.pid, token: a.token };

  assert.ok((await call({ op: 'join', room: 'ZZZZ', name: 'x' })).gone, 'unknown room');
  assert.ok((await call({ op: 'join', room: '12', name: 'x' })).error, 'bad code');
  const b = await call({ op: 'join', room: a.room.toLowerCase(), name: 'Rina' });
  assert.ok(b.pid && b.token && b.view.players.length === 2);
  const B = { room: a.room, pid: b.pid, token: b.token };

  assert.ok((await call({ op: 'poll', ...B, token: 'nope', v: 0, seq: 0 })).gone, 'bad token');
  const p1 = await call({ op: 'poll', ...B, v: 0, seq: 0 });
  assert.ok(p1.view && p1.wait === 0);
  assert.ok((await call({ op: 'poll', ...B, v: p1.view.v, seq: 0 })).same, 'unchanged poll');

  assert.ok((await call({ op: 'act', ...B, action: { type: 'start' } })).error, 'guest cannot start');
  assert.ok((await call({ op: 'act', ...B, action: { type: 'addBot' } })).error, 'guest cannot add bots');
  assert.ok((await call({ op: 'act', ...B, action: { type: 'class', cls: 'wizard' } })).error, 'unknown class');
  assert.ok((await call({ op: 'act', ...B, action: { type: 'class', cls: 'dakat' } })).ok);
  assert.ok((await call({ op: 'act', ...A, action: { type: 'class', cls: 'kabiraj' } })).ok);
  assert.ok((await call({ op: 'act', ...A, action: { type: 'name', name: 'Mashroor' } })).ok);
  assert.ok((await call({ op: 'act', ...A, action: { type: 'settings', goal: 99 } })).error, 'bad goal');
  assert.ok((await call({ op: 'act', ...A, action: { type: 'settings', goal: 7, timer: 0 } })).ok);
  let r = await call({ op: 'act', ...A, action: { type: 'addBot' } });
  assert.equal(r.view.players.length, 3);
  r = await call({ op: 'act', ...A, action: { type: 'addBot' } });
  assert.equal(r.view.players.length, 4);
  assert.ok((await call({ op: 'act', ...A, action: { type: 'addBot' } })).error, 'room full');
  assert.ok((await call({ op: 'join', room: a.room, name: 'Late' })).error, 'room full for joiners');
  const botId = r.view.players.find(p => p.bot).id;
  r = await call({ op: 'act', ...A, action: { type: 'kick', pid: botId } });
  assert.equal(r.view.players.length, 3);
  assert.deepEqual(r.view.settings, { goal: 7, rounds: 9, timer: 0 });

  r = await call({ op: 'act', ...A, action: { type: 'start' } });
  assert.ok(r.ok && r.view.phase === 'play' && r.view.events.some(e => e.t === 'start'));
  assert.ok((await call({ op: 'join', room: a.room, name: 'Late' })).error, 'cannot join a running game');

  const state = store.rooms.get(a.room);
  const viewOf = async who => (await call({ op: 'poll', ...who, v: -1, seq: 0 })).view;
  const humans = { [A.pid]: A, [B.pid]: B };
  let illegalChecked = false, guard = 0;
  while (state.phase === 'play') {
    assert.ok(++guard < 20000, 'api game did not terminate');
    const turn = state.players[state.ti];
    if (turn.bot) { now += 1500; await call({ op: 'poll', ...A, v: -1, seq: 0 }); continue; }
    const me = humans[turn.id], other = turn.id === A.pid ? B : A;
    if (!illegalChecked) {
      illegalChecked = true;
      const v = await viewOf(me);
      assert.equal(v.turn, me.pid);
      assert.ok(v.players.find(p => p.id === me.pid).hand.length >= 3);
      assert.equal((await call({ op: 'act', ...other, action: { type: 'end' } })).error, 'It is not your turn');
      assert.ok((await call({ op: 'act', ...me, action: { type: 'play', uid: 99999 } })).error, 'card not in hand');
      assert.ok((await call({ op: 'act', ...me, action: { type: 'attack', uid: 1, target: { p: other.pid, u: 'w' } } })).error, 'no such spirit');
      assert.ok((await call({ op: 'act', ...me, action: { type: 'skill', target: { p: 'nobody', u: 'w' } } })).error, 'bad skill target');
      assert.ok((await call({ op: 'act', ...me, action: { type: 'fly' } })).error, 'unknown action');
      assert.ok((await call({ op: 'act', ...me, action: null })).error, 'null action');
      const e = await call({ op: 'act', ...other, seq: state.seq, action: { type: 'emote', e: '👻' } });
      assert.ok(e.ok && e.view.events.some(x => x.t === 'emote'), 'emote off-turn');
    }
    const res = await call({ op: 'act', ...me, seq: state.seq, action: chooseAction(state, turn.id) });
    assert.ok(res.ok, 'api action failed: ' + res.error);
    check(state);
  }
  const fin = await viewOf(B);
  assert.equal(fin.phase, 'over');
  assert.equal(fin.ranking.length, 3);
  assert.equal(fin.turn, null);
  assert.ok((await call({ op: 'act', ...B, action: { type: 'again' } })).error, 'guest cannot restart');
  assert.ok((await call({ op: 'act', ...B, action: { type: 'leave' } })).ok, 'guest leaves after the game');
  r = await call({ op: 'act', ...A, action: { type: 'again' } });
  assert.ok(r.ok && r.view.phase === 'lobby' && r.view.players.length === 2, 'back to lobby without the leaver');
  assert.ok((await call({ op: 'poll', ...B, v: 0, seq: 0 })).gone, 'leaver is gone');
  r = await call({ op: 'act', ...A, action: { type: 'start' } });
  assert.ok(r.ok && r.view.phase === 'play' && r.view.round === 1, 'second game starts');
  console.log(`\nAPI test: lobby, validation, full game (${fin.round} rounds, winner ${fin.ranking[0].ff} fireflies), rematch — ok`);
}

// ---- 4. blob-like store: copies on read, conditional writes, racing clients ----------
{
  const blobs = new Map(); // code -> { json, etag }
  let etagc = 0, conflicts = 0;
  const lag = () => new Promise(r => setImmediate(r));
  const store = {
    async get(code) { await lag(); const b = blobs.get(code); return b ? { state: JSON.parse(b.json), etag: b.etag } : null; },
    async set(code, state, etag) {
      await lag();
      const b = blobs.get(code);
      if (!b || b.etag !== etag) { conflicts++; return false; }
      blobs.set(code, { json: JSON.stringify(state), etag: 'e' + (++etagc) });
      return true;
    },
    async create(code, state) {
      await lag();
      if (blobs.has(code)) return false;
      blobs.set(code, { json: JSON.stringify(state), etag: 'e' + (++etagc) });
      return true;
    },
  };
  let now = 5000;
  const a = await handle({ op: 'create', name: 'A' }, store, now);
  const [b, c] = await Promise.all([
    handle({ op: 'join', room: a.room, name: 'B' }, store, now),
    handle({ op: 'join', room: a.room, name: 'C' }, store, now),
  ]);
  assert.ok(b.pid && c.pid && b.pid !== c.pid, 'racing joins both land');
  const who = [a, b, c].map(x => ({ room: a.room, pid: x.pid, token: x.token, v: -1, seq: 0, log: [] }));
  const id = w => ({ room: w.room, pid: w.pid, token: w.token });
  await handle({ op: 'act', ...id(who[0]), action: { type: 'addBot' } }, store, now);
  await handle({ op: 'act', ...id(who[0]), action: { type: 'settings', goal: 7, timer: 45 } }, store, now);
  assert.ok((await handle({ op: 'act', ...id(who[0]), action: { type: 'start' } }, store, now)).ok);
  let phase = 'play', frames = 0;
  while (phase === 'play') {
    assert.ok(++frames < 5000, 'blob game did not terminate');
    now += 1000;
    // every client polls at the same instant; they all try to advance bots / timers
    const res = await Promise.all(who.map(w => handle({ op: 'poll', ...id(w), v: w.v, seq: w.seq }, store, now)));
    res.forEach((r, i) => {
      assert.ok(!r.error, r.error);
      if (r.same) return;
      const w = who[i];
      w.v = r.view.v;
      for (const e of r.view.events) { assert.ok(e.seq > w.seq); w.seq = e.seq; w.log.push(e.seq + ':' + e.t); }
      phase = r.view.phase;
      w.turn = r.view.turn;
    });
    // B plays properly on their turn; A and C just let the timer / takeover handle it
    const st = JSON.parse(blobs.get(a.room).json);
    if (st.phase === 'play' && st.players[st.ti].id === who[1].pid && !st.players[st.ti].auto) {
      const r = await handle({ op: 'act', ...id(who[1]), seq: who[1].seq, action: chooseAction(st, who[1].pid) }, store, now);
      assert.ok(r.ok, 'racing act failed: ' + r.error);
    }
  }
  const final = JSON.parse(blobs.get(a.room).json);
  check(final);
  // every client saw the very same event stream (nobody saw a branch that was thrown away)
  const tails = who.map(w => w.log.slice(-40).join(','));
  assert.ok(tails[0] === tails[1] && tails[1] === tails[2], 'clients agree on the event stream');
  assert.ok(conflicts > 0, 'the race was actually exercised');
  console.log(`\nBlob-store race test: ${frames} poll rounds from 3 racing clients, ${conflicts} write conflicts resolved, streams identical — ok`);
}

console.log('\nAll checks passed.\n');
