// Nishir Daak — authoritative rules engine. Pure functions over a plain-JSON
// room state (it is stored as a blob on Netlify). See protocol.md.
import {
  CARDS, CLASSES, DECK, GOALS, KO_FIREFLIES, LEVEL_AT, LINES, BANTER, REACT,
  MAX_BOARD, MAX_HAND, MAX_FLAME, SKILL_COST,
  skillPower, validTargets, attackTargets, playBlocker, skillBlocker, sameTarget,
} from '../public/js/cards.js';
import { chooseAction, BOT_NAMES } from './bot.mjs';

export const MAX_PLAYERS = 4;
export const OFFLINE_MS = 30000;   // human offline this long on their turn -> bot plays for them
export const TOUCH_MS = 10000;     // persist lastSeen at most this often
export const LOG_KEEP = 200;
export const VIEW_EVENTS = 80;
const TIMERS = [0, 45, 75, 120];

let rnd = Math.random;
/** Swap the random source (tests). */
export function setRandom(fn) { rnd = fn || Math.random; }

const ri = n => Math.floor(rnd() * n);
const pickOne = arr => arr[ri(arr.length)];
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function randId(n) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    for (let i = 0; i < n; i++) s += abc[b[i] % abc.length];
  } else {
    for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  }
  return s;
}

export function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 14).join('') || 'Wanderer';
}

// ---- state helpers ------------------------------------------------------------

function emit(st, ev) {
  ev.seq = ++st.seq;
  st.log.push(ev);
  if (st.log.length > LOG_KEEP + 40) st.log.splice(0, st.log.length - LOG_KEEP);
  return ev;
}

const P = (st, id) => st.players.find(p => p.id === id);
const cur = st => st.players[st.ti];
const pub = s => ({ uid: s.uid, id: s.id, atk: s.atk, hp: s.hp, maxHp: s.maxHp, kw: s.kw.slice(), ready: s.ready, stun: s.stun, ward: s.ward });

function findSpirit(st, uid) {
  for (const pl of st.players) {
    const s = pl.board.find(x => x.uid === uid);
    if (s) return { pl, s };
  }
  return null;
}

function resolve(st, t) {
  const pl = P(st, t.p);
  if (!pl) return null;
  if (t.u === 'w') return { pl, s: null };
  const s = pl.board.find(x => x.uid === t.u);
  return s ? { pl, s } : null;
}

function normTarget(t) {
  if (!t || typeof t !== 'object' || typeof t.p !== 'string') return null;
  if (t.u === 'w') return { p: t.p, u: 'w' };
  return Number.isInteger(t.u) ? { p: t.p, u: t.u } : null;
}

function newPlayer(st, name, bot, now) {
  let id;
  do { id = 'p' + randId(5); } while (P(st, id));
  return {
    id, token: randId(18), name: cleanName(name), bot: !!bot, auto: false, left: false,
    cls: bot ? pickOne(Object.keys(CLASSES)) : 'ojha',
    hp: 0, maxHp: 0, level: 1, ff: 0, flame: 0, maxFlame: 0,
    hand: [], board: [], ko: false, ward: false, skillUsed: false, lastSeen: now,
  };
}

function say(st, pl, s, text) {
  if (text) emit(st, { t: 'say', tp: pl.id, u: s ? s.uid : 'w', text });
}

// ---- rooms ----------------------------------------------------------------------

export function newRoom(code, hostName, now = Date.now()) {
  const state = {
    code, v: 1, seq: 0, phase: 'lobby', hostId: null, createdAt: now,
    settings: { goal: 10, rounds: GOALS[10], timer: 75 },
    players: [], deck: [], discard: [],
    ti: 0, round: 0, turnEndsAt: null, botAt: 0,
    log: [], uidc: 0, ranking: null,
  };
  const pl = newPlayer(state, hostName, false, now);
  state.players.push(pl);
  state.hostId = pl.id;
  return { state, pid: pl.id, token: pl.token };
}

export function joinRoom(st, name, now = Date.now()) {
  if (st.phase !== 'lobby') return { error: 'That game has already started' };
  if (st.players.length >= MAX_PLAYERS) return { error: 'Room is full' };
  const pl = newPlayer(st, name, false, now);
  st.players.push(pl);
  st.v++;
  return { pid: pl.id, token: pl.token };
}

/** Record that a player is connected. Returns true when the state needs saving. */
export function touch(st, pid, now = Date.now()) {
  const pl = P(st, pid);
  if (!pl) return false;
  let dirty = false;
  if (pl.auto && !pl.left && !pl.bot) {
    pl.auto = false;
    if (st.phase === 'play' && cur(st) === pl) st.turnEndsAt = st.settings.timer ? now + st.settings.timer * 1000 : null;
    st.v++;
    dirty = true;
  }
  if (dirty || now - pl.lastSeen > TOUCH_MS) { pl.lastSeen = now; dirty = true; }
  return dirty;
}

// ---- core mechanics ---------------------------------------------------------------

function effAtk(pl, s) {
  let a = s.base;
  if (s.id === 'khokkosh' && pl.board.some(x => x.id === 'rakkhosh' && x.hp > 0)) a += 1;
  return Math.max(0, a);
}

function auras(st) {
  for (const pl of st.players) {
    for (const s of pl.board) {
      const e = effAtk(pl, s);
      if (e !== s.atk) {
        s.atk = e;
        emit(st, { t: 'stat', tp: pl.id, u: s.uid, atk: s.atk, hp: s.hp, maxHp: s.maxHp });
      }
    }
  }
}

function buff(st, pl, s, da, dh) {
  s.base = Math.max(0, s.base + da);
  if (dh) { s.hp += dh; s.maxHp += dh; }
  s.atk = effAtk(pl, s);
  emit(st, { t: 'stat', tp: pl.id, u: s.uid, atk: s.atk, hp: s.hp, maxHp: s.maxHp, d: [da, dh] });
}

function award(st, pid, n, from) {
  const pl = P(st, pid);
  if (!pl || n <= 0) return;
  pl.ff += n;
  const ev = { t: 'ff', p: pl.id, n, ff: pl.ff };
  if (from) ev.from = from;
  emit(st, ev);
  while (pl.level < LEVEL_AT.length && pl.ff >= LEVEL_AT[pl.level]) {
    pl.level++;
    pl.maxHp += 2;
    if (!pl.ko) pl.hp = Math.min(pl.maxHp, pl.hp + 3);
    emit(st, { t: 'lvl', p: pl.id, level: pl.level, hp: pl.hp, maxHp: pl.maxHp });
  }
}

/** Deal damage. s = null targets the wanderer. Returns HP actually lost. */
function hurt(st, pl, s, n, src) {
  if (n <= 0) return 0;
  if (s) {
    if (s.hp <= 0) return 0;
    if (s.ward) {
      s.ward = false;
      emit(st, { t: 'dmg', tp: pl.id, u: s.uid, n: 0, hp: s.hp, ward: true });
      return 0;
    }
    const lost = Math.min(n, s.hp);
    s.hp -= lost;
    emit(st, { t: 'dmg', tp: pl.id, u: s.uid, n, hp: s.hp });
    if (s.hp === 0) s.kb = src ? { p: src.pid, u: src.uid == null ? null : src.uid } : null;
    return lost;
  }
  if (pl.ko) return 0;
  if (pl.ward) {
    pl.ward = false;
    emit(st, { t: 'dmg', tp: pl.id, u: 'w', n: 0, hp: pl.hp, ward: true });
    return 0;
  }
  const lost = Math.min(n, pl.hp);
  pl.hp -= lost;
  emit(st, { t: 'dmg', tp: pl.id, u: 'w', n, hp: pl.hp });
  if (pl.hp === 0) {
    pl.ko = true;
    const by = src && src.pid !== pl.id ? src.pid : null;
    emit(st, { t: 'ko', p: pl.id, by });
    if (by) award(st, by, KO_FIREFLIES, { tp: pl.id, u: 'w' });
  }
  return lost;
}

function heal(st, pl, s, n) {
  if (n <= 0) return 0;
  if (s) {
    const got = Math.min(n, s.maxHp - s.hp);
    if (got <= 0 || s.hp <= 0) return 0;
    s.hp += got;
    emit(st, { t: 'heal', tp: pl.id, u: s.uid, n: got, hp: s.hp });
    return got;
  }
  if (pl.ko) return 0;
  const got = Math.min(n, pl.maxHp - pl.hp);
  if (got <= 0) return 0;
  pl.hp += got;
  emit(st, { t: 'heal', tp: pl.id, u: 'w', n: got, hp: pl.hp });
  return got;
}

/** Destroy outright (no damage number, ignores Ward). */
function slay(s, src) {
  s.hp = 0;
  s.kb = src ? { p: src.pid, u: src.uid == null ? null : src.uid } : null;
}

function destroy(st, pl, s) {
  const kb = s.kb || null;
  const c = CARDS[s.id];
  const toHand = s.id === 'betal' && pl.hand.length < MAX_HAND;
  const line = LINES[s.id] && LINES[s.id].die;
  if (line && (toHand || rnd() < 0.5)) say(st, pl, s, line);
  pl.board.splice(pl.board.indexOf(s), 1);
  if (toHand) {
    const card = { uid: s.uid, id: s.id };
    pl.hand.push(card);
    emit(st, { t: 'bounce', tp: pl.id, u: s.uid, id: s.id, card });
  } else {
    st.discard.push(s.id);
    emit(st, { t: 'die', tp: pl.id, u: s.uid, by: kb && kb.p !== pl.id ? kb.p : null });
  }
  if (kb && kb.p && kb.p !== pl.id) award(st, kb.p, c.cost >= 5 ? 2 : 1, { tp: pl.id, u: s.uid });
  const killer = kb && kb.u != null ? findSpirit(st, kb.u) : null;
  if (killer && killer.s.hp > 0 && killer.s.id === 'rakkhosh' && killer.pl.id !== pl.id) buff(st, killer.pl, killer.s, 1, 1);
  if (s.id === 'aleya' && kb && kb.p && kb.p !== pl.id) {
    // Killed by a spirit -> that spirit is burned (if it survived); killed by a
    // charm or skill -> the wanderer who cast it is.
    const kpl = P(st, kb.p);
    if (kb.u != null) { if (killer && killer.s.hp > 0) hurt(st, killer.pl, killer.s, 2, { pid: pl.id }); }
    else if (kpl) hurt(st, kpl, null, 2, { pid: pl.id });
  }
}

function sweep(st) {
  for (let guard = 0; guard < 100; guard++) {
    let hit = null;
    for (const pl of st.players) {
      const s = pl.board.find(x => x.hp <= 0);
      if (s) { hit = [pl, s]; break; }
    }
    if (!hit) break;
    destroy(st, hit[0], hit[1]);
  }
  auras(st);
}

function draw(st, pl, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!st.deck.length) {
      if (!st.discard.length) break;
      st.deck = shuffle(st.discard);
      st.discard = [];
      emit(st, { t: 'shuffle' });
    }
    const id = st.deck.pop();
    if (pl.hand.length >= MAX_HAND) {
      st.discard.push(id);
      emit(st, { t: 'burn', p: pl.id, id });
    } else {
      const card = { uid: ++st.uidc, id };
      pl.hand.push(card);
      got.push(card);
    }
  }
  if (got.length) emit(st, { t: 'draw', p: pl.id, n: got.length, cards: got });
  return got.length;
}

function stealCard(st, from, to) {
  if (!from.hand.length) { emit(st, { t: 'steal', from: from.id, to: to.id, none: true }); return; }
  const card = from.hand.splice(ri(from.hand.length), 1)[0];
  emit(st, { t: 'steal', from: from.id, to: to.id, card });
  if (to.hand.length >= MAX_HAND) {
    st.discard.push(card.id);
    emit(st, { t: 'burn', p: to.id, id: card.id });
  } else {
    to.hand.push(card);
  }
}

function setStun(st, pl, s) {
  if (s.hp <= 0 || s.stun) return;
  s.stun = true;
  emit(st, { t: 'status', tp: pl.id, u: s.uid, stun: true });
}

function react(st, pid, cardId, selfUid) {
  for (const key of Object.keys(REACT)) {
    if (!key.startsWith(cardId + '>')) continue;
    const witness = key.slice(cardId.length + 1);
    const r = REACT[key];
    for (const pl of st.players) {
      const mine = pl.id === pid;
      if ((r.side === 'same' && !mine) || (r.side === 'enemy' && mine)) continue;
      const s = pl.board.find(x => x.id === witness && x.uid !== selfUid && x.hp > 0);
      if (s) { say(st, pl, s, r.text); break; }
    }
  }
}

// ---- turn flow -----------------------------------------------------------------------

function gameOver(st, reason) {
  if (st.phase !== 'play') return;
  st.phase = 'over';
  st.turnEndsAt = null;
  st.ranking = st.players
    .map((p, i) => ({ id: p.id, ff: p.ff, hp: p.hp, i }))
    .sort((a, b) => b.ff - a.ff || b.hp - a.hp || a.i - b.i)
    .map(({ id, ff, hp }) => ({ id, ff, hp }));
  emit(st, { t: 'over', ranking: st.ranking, reason });
}

function checkWin(st) {
  if (st.phase === 'play' && st.players.some(p => p.ff >= st.settings.goal)) gameOver(st, 'goal');
}

function beginTurn(st, now) {
  const pl = cur(st);
  if (pl.ko) {
    pl.ko = false;
    pl.hp = pl.maxHp;
    emit(st, { t: 'revive', p: pl.id, hp: pl.hp });
  }
  pl.maxFlame = Math.min(MAX_FLAME, pl.maxFlame + 1);
  pl.flame = pl.maxFlame;
  pl.skillUsed = false;
  for (const s of pl.board) s.ready = true;
  emit(st, { t: 'turn', p: pl.id, round: st.round, flame: pl.flame, maxFlame: pl.maxFlame });
  draw(st, pl, pl.hand.length === 0 ? 2 : 1);
  const hoard = pl.board.filter(s => s.id === 'jokkho').length;
  if (hoard) {
    pl.flame += hoard;
    emit(st, { t: 'flame', p: pl.id, flame: pl.flame, maxFlame: pl.maxFlame });
  }
  for (const s of pl.board) if (s.id === 'brahma') heal(st, pl, null, 2);
  st.turnEndsAt = st.settings.timer && !pl.bot && !pl.auto ? now + st.settings.timer * 1000 : null;
  st.botAt = now + 1100;
}

function endTurn(st, now) {
  const pl = cur(st);
  for (const s of pl.board.slice()) {
    if (s.id !== 'chandburi' || s.hp <= 0) continue;
    heal(st, pl, null, 1);
    for (const o of pl.board) if (o !== s) heal(st, pl, o, 1);
  }
  for (const s of pl.board) {
    if (s.stun) {
      s.stun = false;
      emit(st, { t: 'status', tp: pl.id, u: s.uid, stun: false });
    }
  }
  st.ti = (st.ti + 1) % st.players.length;
  if (st.ti === 0) {
    st.round++;
    if (st.round > st.settings.rounds) { st.round = st.settings.rounds; gameOver(st, 'dawn'); return; }
  }
  beginTurn(st, now);
}

function startGame(st, now) {
  shuffle(st.players);
  st.deck = [];
  for (const [id, n] of DECK) for (let i = 0; i < n; i++) st.deck.push(id);
  shuffle(st.deck);
  st.discard = [];
  st.ranking = null;
  st.uidc = 0;
  for (const pl of st.players) {
    const c = CLASSES[pl.cls] || CLASSES.ojha;
    Object.assign(pl, {
      cls: c.id, hp: c.hp, maxHp: c.hp, level: 1, ff: 0, flame: 0, maxFlame: 0,
      hand: [], board: [], ko: false, ward: false, skillUsed: false,
    });
  }
  st.phase = 'play';
  st.round = 1;
  st.ti = 0;
  emit(st, { t: 'start', order: st.players.map(p => p.id) });
  st.players.forEach((pl, i) => draw(st, pl, Math.min(5, 3 + i))); // later seats get a bigger opening hand
  beginTurn(st, now);
}

// ---- actions -----------------------------------------------------------------------------

function callEffect(st, pl, s, tgt) {
  const src = { pid: pl.id, uid: s.uid };
  switch (s.id) {
    case 'mechho': if (tgt) stealCard(st, tgt.pl, pl); break;
    case 'boba': if (tgt) setStun(st, tgt.pl, tgt.s); break;
    case 'petni': if (tgt) buff(st, tgt.pl, tgt.s, -Math.min(2, tgt.s.base), 0); break;
    case 'byangoma': draw(st, pl, 2); break;
    case 'jujuburi':
      if (tgt) {
        const { pl: o, s: v } = tgt;
        o.board.splice(o.board.indexOf(v), 1);
        const card = { uid: v.uid, id: v.id };
        if (o.hand.length < MAX_HAND) {
          o.hand.push(card);
          emit(st, { t: 'bounce', tp: o.id, u: v.uid, id: v.id, card });
        } else {
          st.discard.push(v.id);
          emit(st, { t: 'bounce', tp: o.id, u: v.uid, id: v.id, burned: true });
        }
      }
      break;
    case 'daini': if (tgt) hurt(st, tgt.pl, tgt.s, 2, src); break;
    case 'shakchunni':
      if (tgt) {
        const da = tgt.s.atk - s.base;
        s.base = tgt.s.atk;
        const dh = tgt.s.hp - s.hp;
        s.hp = tgt.s.hp;
        s.maxHp = tgt.s.hp;
        s.atk = effAtk(pl, s);
        emit(st, { t: 'stat', tp: pl.id, u: s.uid, atk: s.atk, hp: s.hp, maxHp: s.maxHp, d: [da, dh] });
      }
      break;
    case 'nishi':
      if (tgt && pl.board.length < MAX_BOARD) {
        const { pl: o, s: v } = tgt;
        o.board.splice(o.board.indexOf(v), 1);
        v.ready = false;
        pl.board.push(v);
        v.atk = effAtk(pl, v);
        emit(st, { t: 'move', from: o.id, to: pl.id, u: v.uid, s: pub(v) });
      }
      break;
    case 'jinn':
      for (const o of st.players) {
        if (o === pl) continue;
        for (const v of o.board.slice()) hurt(st, o, v, 1, src);
      }
      break;
    default: break;
  }
}

function charmEffect(st, pl, id, tgt) {
  const src = { pid: pl.id, uid: null };
  switch (id) {
    case 'agni': hurt(st, tgt.pl, tgt.s, 3, src); break;
    case 'sorshe': for (const v of tgt.pl.board.slice()) hurt(st, tgt.pl, v, 2, src); break;
    case 'kabach':
      if (tgt.s) tgt.s.ward = true; else tgt.pl.ward = true;
      emit(st, { t: 'status', tp: tgt.pl.id, u: tgt.s ? tgt.s.uid : 'w', ward: true });
      break;
    case 'ghum': for (const v of tgt.pl.board) setStun(st, tgt.pl, v); break;
    case 'ilish':
      heal(st, pl, null, 5);
      if (pl.board.some(s => s.id === 'mechho')) draw(st, pl, 2);
      break;
    case 'tel':
      pl.flame += 2;
      emit(st, { t: 'flame', p: pl.id, flame: pl.flame, maxFlame: pl.maxFlame });
      break;
    case 'loha':
      hurt(st, tgt.pl, tgt.s, 1, src);
      setStun(st, tgt.pl, tgt.s);
      break;
    case 'morog': slay(tgt.s, src); break;
    case 'jhuli': draw(st, pl, 2); break;
    default: break;
  }
}

function doPlay(st, pl, action) {
  const i = pl.hand.findIndex(c => c.uid === action.uid);
  if (i < 0) return { error: 'That card is not in your hand' };
  const card = pl.hand[i];
  const c = CARDS[card.id];
  const block = playBlocker(st, pl.id, card.id);
  if (block) return { error: block };
  let target = null;
  if (c.target) {
    const T = validTargets(st, pl.id, c.target);
    target = normTarget(action.target);
    if (target && !T.some(t => sameTarget(t, target))) return { error: 'Not a valid target' };
    if (!target && c.type === 'charm') return { error: 'Choose a target' };
  }
  const tgt = target ? resolve(st, target) : null;
  if (target && !tgt) return { error: 'Not a valid target' };

  pl.flame -= c.cost;
  pl.hand.splice(i, 1);
  const ev = { t: 'play', p: pl.id, uid: card.uid, id: card.id, flame: pl.flame };
  if (target) ev.target = target;
  emit(st, ev);

  if (c.type === 'spirit') {
    const s = {
      uid: card.uid, id: c.id, base: c.atk, atk: c.atk, hp: c.hp, maxHp: c.hp,
      kw: c.kw.slice(), ready: c.kw.includes('swift'), stun: false, ward: false,
    };
    pl.board.push(s);
    s.atk = effAtk(pl, s);
    emit(st, { t: 'summon', p: pl.id, s: pub(s), idx: pl.board.length - 1 });
    auras(st);
    say(st, pl, s, LINES[s.id] && LINES[s.id].summon);
    react(st, pl.id, s.id, s.uid);
    callEffect(st, pl, s, tgt);
  } else {
    react(st, pl.id, c.id, null);
    charmEffect(st, pl, c.id, tgt);
    st.discard.push(c.id);
  }
  sweep(st);
  return { ok: true };
}

const slayerMult = (a, t) => (a.id === 'lalneel' && (t.id === 'rakkhosh' || t.id === 'khokkosh') ? 2 : 1);

function doAttack(st, pl, action) {
  const a = pl.board.find(s => s.uid === action.uid);
  if (!a) return { error: 'That spirit is not yours' };
  if (!a.ready) return { error: 'That spirit is not ready yet' };
  if (a.stun) return { error: 'That spirit is stunned' };
  if (a.atk <= 0) return { error: 'That spirit cannot attack' };
  let target = normTarget(action.target);
  if (!target) return { error: 'Choose a target' };
  const T = attackTargets(st, pl.id, a.uid);
  if (a.kw.includes('blind')) {
    const pool = T.filter(t => t.p === target.p);
    if (!pool.length) return { error: 'Not a valid target' };
    target = pickOne(pool);
  } else if (!T.some(t => sameTarget(t, target))) {
    const side = P(st, target.p);
    const guarded = side && side !== pl && !a.kw.includes('flying') && side.board.some(s => s.kw.includes('guard'));
    return { error: guarded ? 'A Guard blocks the way' : 'Not a valid target' };
  }
  const tgt = resolve(st, target);
  if (!tgt) return { error: 'Not a valid target' };
  const { pl: o, s: d } = tgt;

  a.ready = false;
  const pair = d ? BANTER[a.id + '>' + d.id] : null;
  if (pair) {
    say(st, pl, a, pair[0]);
    say(st, o, d, pair[1]);
  } else if (LINES[a.id] && LINES[a.id].attack && rnd() < 0.3) {
    say(st, pl, a, LINES[a.id].attack);
  }
  emit(st, { t: 'atk', ap: pl.id, a: a.uid, tp: o.id, u: target.u });

  if (!d) {
    const dealt = hurt(st, o, null, a.atk, { pid: pl.id, uid: a.uid });
    if (dealt && a.kw.includes('drain')) heal(st, pl, null, dealt);
  } else {
    const out = a.atk * slayerMult(a, d);
    const back = d.atk * slayerMult(d, a);
    const dealt = hurt(st, o, d, out, { pid: pl.id, uid: a.uid });
    const taken = hurt(st, pl, a, back, { pid: o.id, uid: d.uid });
    if (dealt && a.kw.includes('venom') && d.hp > 0) {
      emit(st, { t: 'dmg', tp: o.id, u: d.uid, n: d.hp, hp: 0 });
      slay(d, { pid: pl.id, uid: a.uid });
    }
    if (taken && d.kw.includes('venom') && a.hp > 0) {
      emit(st, { t: 'dmg', tp: pl.id, u: a.uid, n: a.hp, hp: 0 });
      slay(a, { pid: o.id, uid: d.uid });
    }
    if (dealt && a.kw.includes('drain')) heal(st, pl, null, dealt);
    if (taken && d.kw.includes('drain')) heal(st, o, null, taken);
  }
  sweep(st);
  return { ok: true };
}

function doSkill(st, pl, action) {
  const block = skillBlocker(st, pl.id);
  if (block) return { error: block };
  const target = normTarget(action.target);
  if (!target) return { error: 'Choose a target' };
  const T = validTargets(st, pl.id, CLASSES[pl.cls].skill.target);
  if (!T.some(t => sameTarget(t, target))) return { error: 'Not a valid target' };
  const tgt = resolve(st, target);
  if (!tgt) return { error: 'Not a valid target' };
  const pw = skillPower(pl.cls, pl.level);
  pl.flame -= SKILL_COST;
  pl.skillUsed = true;
  emit(st, { t: 'skill', p: pl.id, cls: pl.cls, flame: pl.flame, target });
  const src = { pid: pl.id, uid: null };
  switch (pl.cls) {
    case 'ojha':
    case 'shikari': hurt(st, tgt.pl, tgt.s, pw.dmg, src); break;
    case 'baul': buff(st, tgt.pl, tgt.s, pw.atk, pw.hp); break;
    case 'kabiraj': heal(st, tgt.pl, tgt.s, pw.heal); break;
    case 'dakat':
      stealCard(st, tgt.pl, pl);
      if (pw.dmg) hurt(st, tgt.pl, null, pw.dmg, src);
      break;
    default: break;
  }
  sweep(st);
  return { ok: true };
}

function removePlayer(st, pl) {
  st.players.splice(st.players.indexOf(pl), 1);
  if (st.hostId === pl.id) {
    const next = st.players.find(p => !p.bot && !p.left);
    st.hostId = next ? next.id : null;
  }
}

function lobbyAct(st, pl, action) {
  const host = st.hostId === pl.id;
  switch (action.type) {
    case 'class':
      if (!CLASSES[action.cls]) return { error: 'Unknown wanderer' };
      pl.cls = action.cls;
      return { ok: true };
    case 'name':
      pl.name = cleanName(action.name);
      return { ok: true };
    case 'addBot': {
      if (!host) return { error: 'Only the host can do that' };
      if (st.players.length >= MAX_PLAYERS) return { error: 'Room is full' };
      const free = BOT_NAMES.filter(n => !st.players.some(p => p.name === n));
      st.players.push(newPlayer(st, pickOne(free.length ? free : BOT_NAMES), true, 0));
      return { ok: true };
    }
    case 'kick': {
      if (!host) return { error: 'Only the host can do that' };
      const v = P(st, action.pid);
      if (!v || v === pl) return { error: 'Cannot remove that player' };
      removePlayer(st, v);
      return { ok: true };
    }
    case 'settings':
      if (!host) return { error: 'Only the host can do that' };
      if (action.goal != null) {
        if (!GOALS[action.goal]) return { error: 'Bad goal' };
        st.settings.goal = Number(action.goal);
        st.settings.rounds = GOALS[action.goal];
      }
      if (action.timer != null) {
        if (!TIMERS.includes(action.timer)) return { error: 'Bad timer' };
        st.settings.timer = action.timer;
      }
      return { ok: true };
    case 'start':
      if (!host) return { error: 'Only the host can start' };
      if (st.players.length < 2) return { error: 'Need at least 2 players (add a bot?)' };
      return { ok: true, start: true };
    case 'leave':
      removePlayer(st, pl);
      return { ok: true };
    default:
      return { error: 'Not available in the lobby' };
  }
}

function emote(st, pl, action) {
  const e = Array.from(String(action.e == null ? '' : action.e).replace(/[\u0000-\u001f<>]/g, '')).slice(0, 16).join('');
  if (!e) return { error: 'Empty emote' };
  emit(st, { t: 'emote', p: pl.id, e });
  return { ok: true };
}

export function act(st, pid, action, now = Date.now()) {
  const pl = P(st, pid);
  if (!pl) return { error: 'You are not in this room' };
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return { error: 'Bad action' };
  let r;
  if (st.phase === 'lobby') {
    r = lobbyAct(st, pl, action);
    if (r.start) { startGame(st, now); r = { ok: true }; }
  } else if (action.type === 'emote') {
    r = emote(st, pl, action);
  } else if (action.type === 'leave') {
    pl.left = true;
    pl.auto = true;
    if (st.hostId === pl.id) {
      const next = st.players.find(p => !p.bot && !p.left);
      if (next) st.hostId = next.id;
    }
    if (st.phase === 'play' && cur(st) === pl) { st.turnEndsAt = null; st.botAt = now + 600; }
    r = { ok: true };
  } else if (st.phase === 'over') {
    if (action.type !== 'again') return { error: 'The game is over' };
    if (st.hostId !== pl.id) return { error: 'Only the host can do that' };
    st.players = st.players.filter(p => !p.left);
    for (const p of st.players) {
      Object.assign(p, { hp: 0, maxHp: 0, level: 1, ff: 0, flame: 0, maxFlame: 0, hand: [], board: [], ko: false, ward: false, skillUsed: false, auto: false });
    }
    Object.assign(st, { phase: 'lobby', deck: [], discard: [], ti: 0, round: 0, turnEndsAt: null, ranking: null });
    r = { ok: true };
  } else {
    if (cur(st) !== pl) return { error: 'It is not your turn' };
    switch (action.type) {
      case 'play': r = doPlay(st, pl, action); break;
      case 'attack': r = doAttack(st, pl, action); break;
      case 'skill': r = doSkill(st, pl, action); break;
      case 'end': endTurn(st, now); r = { ok: true }; break;
      default: return { error: 'Unknown action' };
    }
    if (r.ok) checkWin(st);
  }
  if (r.ok) st.v++;
  return r;
}

/** Advance time-driven things: bots, offline takeover, turn timer. */
export function tick(st, now = Date.now()) {
  if (st.phase !== 'play') return false;
  const pl = cur(st);
  let changed = false;
  if (!pl.bot && !pl.auto && (pl.left || now - pl.lastSeen > OFFLINE_MS)) {
    pl.auto = true;
    st.turnEndsAt = null;
    st.botAt = now + 600;
    changed = true;
  }
  if (pl.bot || pl.auto) {
    if (now >= st.botAt) {
      const v = st.v;
      let action;
      try { action = chooseAction(st, pl.id, rnd); } catch { action = { type: 'end' }; }
      let r = act(st, pl.id, action, now);
      if (!r.ok) r = act(st, pl.id, { type: 'end' }, now);
      st.v = v; // bumped once below
      st.botAt = now + 900 + ri(400);
      changed = true;
    }
  } else if (st.turnEndsAt && now >= st.turnEndsAt) {
    endTurn(st, now);
    changed = true;
  }
  if (changed) st.v++;
  return changed;
}

// ---- views ----------------------------------------------------------------------------------

function filterEvent(ev, pid) {
  if (ev.t === 'draw' && ev.p !== pid && ev.cards) { const { cards, ...rest } = ev; return rest; }
  if (ev.t === 'steal' && ev.card && ev.from !== pid && ev.to !== pid) { const { card, ...rest } = ev; return rest; }
  if (ev.t === 'bounce' && ev.card && ev.tp !== pid) { const { card, ...rest } = ev; return rest; }
  return ev;
}

export function viewFor(st, pid, sinceSeq = 0, now = Date.now()) {
  const since = Number.isFinite(+sinceSeq) ? +sinceSeq : 0;
  const playing = st.phase === 'play';
  let events = st.log.filter(e => e.seq > since);
  if (events.length > VIEW_EVENTS) events = events.slice(-VIEW_EVENTS);
  return {
    code: st.code, v: st.v, seq: st.seq, phase: st.phase, hostId: st.hostId, you: pid,
    settings: { ...st.settings },
    turn: playing ? cur(st).id : null,
    round: st.round,
    turnLeft: playing && st.turnEndsAt ? Math.max(0, st.turnEndsAt - now) : null,
    deckCount: st.deck.length, discardCount: st.discard.length,
    players: st.players.map(p => {
      const o = {
        id: p.id, name: p.name, bot: p.bot, auto: p.auto, online: p.bot || (!p.left && now - p.lastSeen < OFFLINE_MS),
        cls: p.cls, hp: p.hp, maxHp: p.maxHp, level: p.level, ff: p.ff, flame: p.flame, maxFlame: p.maxFlame,
        handCount: p.hand.length, board: p.board.map(pub), ko: p.ko, ward: p.ward, skillUsed: p.skillUsed,
      };
      if (p.id === pid) o.hand = p.hand.map(c => ({ uid: c.uid, id: c.id }));
      return o;
    }),
    events: events.map(e => filterEvent(e, pid)),
    ranking: st.ranking,
  };
}
