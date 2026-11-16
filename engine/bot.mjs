// Nishir Daak — heuristic AI. Pure: looks at the full state and returns ONE action
// for player `pid`. The engine applies it through the normal `act()` path.
import {
  CARDS, CLASSES, MAX_BOARD, MAX_HAND, skillPower,
  validTargets, attackTargets, playBlocker, skillBlocker,
} from '../public/js/cards.js';

const has = (s, k) => s.kw.includes(k);

/** Rough worth of a spirit on the board. */
function val(s) {
  const c = CARDS[s.id];
  return s.atk + s.hp * 0.8 + c.cost * 0.5 + (has(s, 'guard') ? 1 : 0) + (has(s, 'venom') ? 2 : 0);
}

const slayerMult = (a, t) => (a.id === 'lalneel' && (t.id === 'rakkhosh' || t.id === 'khokkosh') ? 2 : 1);

export function chooseAction(G, pid, rnd = Math.random) {
  const me = G.players.find(p => p.id === pid);
  if (!me) return { type: 'end' };
  const opps = G.players.filter(p => p.id !== pid);
  const leader = opps.slice().sort((a, b) => b.ff - a.ff || a.hp - b.hp)[0];
  const P = id => G.players.find(p => p.id === id);
  const res = t => {
    const pl = P(t.p);
    return { pl, s: t.u === 'w' ? null : pl.board.find(x => x.uid === t.u) };
  };

  let best = { score: 0.6, action: { type: 'end' } };
  const consider = (score, action) => {
    score += rnd() * 0.3;
    if (score > best.score) best = { score, action };
  };

  /** Best target of a list by a scoring fn (fn returns null to reject). */
  const pick = (T, fn) => {
    let b = null;
    for (const t of T) {
      const sc = fn(res(t), t);
      if (sc != null && (!b || sc > b.sc)) b = { sc, t };
    }
    return b;
  };

  // ---- cards ----------------------------------------------------------------
  for (const card of me.hand) {
    if (playBlocker(G, pid, card.id)) continue;
    const c = CARDS[card.id];
    const T = c.target ? validTargets(G, pid, c.target) : [];
    let score = c.type === 'spirit' ? 4 + c.cost * 0.9 : 0;
    let b = null;
    switch (card.id) {
      case 'mechho': b = pick(T, r => r.pl.hand.length); if (b) score += 1.5; break;
      case 'boba': b = pick(T, r => (r.s.stun || r.s.atk < 2 ? null : r.s.atk)); if (b) score += b.sc * 0.5; break;
      case 'petni': b = pick(T, r => (r.s.atk < 1 ? null : Math.min(2, r.s.atk) + r.s.atk * 0.1)); if (b) score += b.sc * 0.6; break;
      case 'jujuburi': b = pick(T, r => (CARDS[r.s.id].cost <= 1 ? null : val(r.s))); if (b) score += b.sc * 0.3; break;
      case 'daini':
        b = pick(T, r => r.s
          ? (r.s.hp <= 2 && !r.s.ward ? 5 + val(r.s) * 0.5 : 0.5)
          : (r.pl.hp <= 2 && !r.pl.ward ? 12 : 1 + (r.pl === leader ? 0.5 : 0)));
        if (b) score += b.sc * 0.6;
        break;
      case 'shakchunni': b = pick(T, r => (r.s.atk + r.s.hp > 5 ? r.s.atk + r.s.hp - 5 : null)); if (b) score += b.sc * 0.8; break;
      case 'nishi': b = pick(T, r => val(r.s)); if (b) score += 3 + b.sc * 0.6; break;
      case 'byangoma': if (me.hand.length <= 6) score += 2; break;
      case 'jinn':
        for (const o of opps) for (const s of o.board) score += s.ward ? 0 : (s.hp <= 1 ? 2.5 : 0.5);
        break;
      case 'chandburi': if (me.hp < me.maxHp || me.board.some(s => s.hp < s.maxHp)) score += 1; break;

      case 'agni':
        b = pick(T, r => r.s
          ? (r.s.hp <= 3 && !r.s.ward ? 3 + val(r.s) * 0.6 + (CARDS[r.s.id].cost >= 5 ? 2 : 0) : null)
          : (r.pl.hp <= 3 && !r.pl.ward ? 14 : (me.hand.length >= 6 ? 1.5 : 0.8) + (r.pl === leader ? 0.3 : 0)));
        score = b ? b.sc : 0;
        break;
      case 'sorshe':
        b = pick(T, r => {
          let t = 0;
          for (const s of r.pl.board) t += s.ward ? 0 : (s.hp <= 2 ? 3 + val(s) * 0.3 : 0.8);
          return t >= 3.5 ? t : null;
        });
        score = b ? b.sc : 0;
        break;
      case 'kabach':
        b = pick(T, r => r.s
          ? (r.s.ward ? null : 1.5 + val(r.s) * 0.15)
          : (me.ward ? null : (me.hp <= 10 ? 3.5 : 0.8)));
        score = b ? b.sc : 0;
        break;
      case 'ghum':
        b = pick(T, r => {
          const t = r.pl.board.reduce((n, s) => n + (s.stun ? 0 : s.atk), 0);
          return t >= 5 ? t * 0.5 : null;
        });
        score = b ? b.sc : 0;
        break;
      case 'ilish': {
        const missing = me.maxHp - me.hp;
        score = missing >= 4 ? 2.5 + missing * 0.25 : 0;
        if (me.board.some(s => s.id === 'mechho') && me.hand.length <= 6) score += 3;
        break;
      }
      case 'tel': {
        const unlocks = me.hand.some(x => {
          if (x.uid === card.uid) return false;
          const k = CARDS[x.id];
          if (k.cost <= me.flame || k.cost > me.flame + 2) return false;
          if (k.type === 'spirit') return me.board.length < MAX_BOARD;
          return !k.target || validTargets(G, pid, k.target).length > 0;
        });
        score = unlocks ? 6 : (me.hand.length >= MAX_HAND ? 1 : 0);
        break;
      }
      case 'loha':
        b = pick(T, r => (!r.s.ward && r.s.hp <= 1
          ? 4.5 + val(r.s) * 0.5
          : (!r.s.stun && r.s.atk >= 3 ? 2 + r.s.atk * 0.3 : null)));
        score = b ? b.sc : 0;
        break;
      case 'morog': b = pick(T, r => (val(r.s) >= 7 ? 3 + val(r.s) * 0.7 : null)); score = b ? b.sc : 0; break;
      case 'jhuli': score = me.hand.length <= 6 ? 3.5 : 0; break;
      default: break;
    }
    if (c.type === 'charm' && c.target && !b) continue;
    if (score <= 0) continue;
    const action = { type: 'play', uid: card.uid };
    if (b) action.target = b.t;
    consider(score, action);
  }

  // ---- wanderer skill ---------------------------------------------------------
  if (!skillBlocker(G, pid)) {
    const T = validTargets(G, pid, CLASSES[me.cls].skill.target);
    const pw = skillPower(me.cls, me.level);
    let b = null;
    switch (me.cls) {
      case 'ojha':
        b = pick(T, r => (r.s.ward ? 0.3 : (r.s.hp <= pw.dmg ? 5 + val(r.s) * 0.5 : 1.2 + val(r.s) * 0.05)));
        break;
      case 'shikari':
        b = pick(T, r => r.s
          ? (r.s.ward ? 0.3 : (r.s.hp <= pw.dmg ? 5 + val(r.s) * 0.5 : 1.0 + val(r.s) * 0.05))
          : (r.pl.ward ? 0.3 : (r.pl.hp <= pw.dmg ? 12 : 1.1 + (r.pl === leader ? 0.3 : 0))));
        break;
      case 'baul':
        b = pick(T, r => (r.s.ready && !r.s.stun && r.s.atk > 0 ? 2.6 + val(r.s) * 0.05 : 1.6 + val(r.s) * 0.05));
        break;
      case 'kabiraj':
        b = pick(T, r => {
          const missing = r.s ? r.s.maxHp - r.s.hp : me.maxHp - me.hp;
          if (missing < 2) return null;
          return (r.s ? 1.6 : 2.2) + Math.min(missing, pw.heal) * 0.35;
        });
        break;
      case 'dakat':
        b = pick(T, r => 2.4 + r.pl.hand.length * 0.1 + (pw.dmg && !r.pl.ko && r.pl.hp <= pw.dmg ? 10 : 0) + (r.pl === leader ? 0.2 : 0));
        break;
      default: break;
    }
    if (b && b.sc > 0) consider(b.sc, { type: 'skill', target: b.t });
  }

  // ---- attacks ------------------------------------------------------------------
  for (const a of me.board) {
    if (!a.ready || a.stun || a.atk <= 0) continue;
    const T = attackTargets(G, pid, a.uid);
    if (!T.length) continue;
    if (has(a, 'blind')) {
      // The server randomises the target; just pick the juiciest opponent.
      const seen = new Set();
      for (const t of T) {
        if (seen.has(t.p)) continue;
        seen.add(t.p);
        const o = P(t.p);
        consider(3 + (o === leader ? 0.6 : 0) + o.board.length * 0.2, { type: 'attack', uid: a.uid, target: t });
      }
      continue;
    }
    for (const t of T) {
      const { pl, s } = res(t);
      let score;
      if (!s) {
        score = pl.ward ? 0.9
          : (pl.hp <= a.atk ? 20 : 2 + a.atk * 0.6 + (pl === leader ? 1 : 0) + (pl.hp <= 8 ? 1 : 0));
      } else {
        const dmg = a.atk * slayerMult(a, s);
        const back = s.atk * slayerMult(s, a);
        const kills = !s.ward && (dmg >= s.hp || has(a, 'venom'));
        const dies = !a.ward && back > 0 && (back >= a.hp || has(s, 'venom'));
        if (kills) {
          score = 6 + val(s) * 0.6 + (CARDS[s.id].cost >= 5 ? 3 : 0) - (dies ? val(a) * 0.5 : 0) - (s.id === 'aleya' ? 1.5 : 0);
        } else if (dies) {
          score = -5;
        } else {
          score = 1 + (s.ward ? 0.5 : dmg * 0.3) - back * 0.3;
        }
      }
      if (score > 0) consider(score, { type: 'attack', uid: a.uid, target: t });
    }
  }

  return best.action;
}

export const BOT_NAMES = ['Gopal', 'Thakuma', 'Bhombol', 'Tuntuni', 'Kanai', 'Majhi Dada', 'Shiyal', 'Podipishi'];
export { MAX_HAND };
