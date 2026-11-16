// Nishir Daak — shared game data and targeting rules.
// Imported by BOTH the browser client and the server engine, so keep it dependency-free.

export const MAX_BOARD = 4;
export const MAX_HAND = 8;
export const MAX_FLAME = 7;
export const SKILL_COST = 2;
export const KO_FIREFLIES = 3;
export const LEVEL_AT = [0, 3, 7]; // fireflies needed for level 1, 2, 3
export const GOALS = { 7: 9, 10: 12, 14: 16 }; // firefly goal -> rounds until dawn

export const KW = {
  guard:  { name: 'Guard',  icon: '🛡', text: 'Enemies must attack this spirit before anything else on its side.' },
  swift:  { name: 'Swift',  icon: '💨', text: 'Can attack on the turn it is summoned.' },
  flying: { name: 'Flying', icon: '🪽', text: 'Ignores Guard when attacking.' },
  drain:  { name: 'Drain',  icon: '🩸', text: 'Heals your wanderer for the damage it deals.' },
  venom:  { name: 'Venom',  icon: '🐍', text: 'Destroys any spirit it wounds.' },
  blind:  { name: 'Headless', icon: '❓', text: 'Swings blindly: you pick the opponent, fate picks the target.' },
};

// ---- Wanderers (player classes) -------------------------------------------
// skill.target uses the same target spec as cards (see validTargets).
export const CLASSES = {
  ojha: {
    id: 'ojha', name: 'Ojha', bn: 'ওঝা', title: 'Exorcist', hp: 20,
    skill: { name: 'Jhar-Phook', target: { side: 'enemy', what: 'spirit' } },
    blurb: 'Drives spirits out with neem and chanting.',
  },
  baul: {
    id: 'baul', name: 'Baul', bn: 'বাউল', title: 'Minstrel', hp: 22,
    skill: { name: 'Ektara Song', target: { side: 'friendly', what: 'spirit' } },
    blurb: 'A wandering singer whose tune emboldens spirits.',
  },
  shikari: {
    id: 'shikari', name: 'Shikari', bn: 'শিকারি', title: 'Hunter', hp: 20,
    skill: { name: 'True Arrow', target: { side: 'enemy', what: 'any' } },
    blurb: 'Never misses, whether spirit or traveller.',
  },
  kabiraj: {
    id: 'kabiraj', name: 'Kabiraj', bn: 'কবিরাজ', title: 'Herbalist', hp: 30,
    skill: { name: 'Herb Poultice', target: { side: 'friendly', what: 'any' } },
    blurb: 'Roots and leaves that mend what the night breaks.',
  },
  dakat: {
    id: 'dakat', name: 'Dakat', bn: 'ডাকাত', title: 'Bandit', hp: 22,
    skill: { name: 'Highway Toll', target: { side: 'enemy', what: 'player', needHand: true } },
    blurb: 'What is yours is, shortly, theirs.',
  },
};

// Numbers behind each skill at a given level (1..3).
export function skillPower(cls, level) {
  const L = Math.max(1, Math.min(3, level | 0));
  switch (cls) {
    case 'ojha': return { dmg: L < 3 ? L : 2 };
    case 'shikari': return { dmg: L < 3 ? 1 : 2 };
    case 'baul': return L === 1 ? { atk: 1, hp: 2 } : L === 2 ? { atk: 2, hp: 2 } : { atk: 3, hp: 3 };
    case 'kabiraj': return { heal: 3 + L };
    case 'dakat': return { steal: 1, dmg: L };
    default: return {};
  }
}

export function skillText(cls, level) {
  const p = skillPower(cls, level);
  switch (cls) {
    case 'ojha': return `Deal ${p.dmg} damage to an enemy spirit.`;
    case 'shikari': return `Deal ${p.dmg} damage to any enemy.`;
    case 'baul': return `Give one of your spirits +${p.atk}/+${p.hp}.`;
    case 'kabiraj': return `Restore ${p.heal} HP to you or one of your spirits.`;
    case 'dakat': return `Steal a random card from an enemy's hand` + (p.dmg ? ` and deal ${p.dmg} damage to them.` : '.');
    default: return '';
  }
}

// ---- Cards ------------------------------------------------------------------
// type: 'spirit' | 'charm'.  target: spec object or null.
// For spirits, `target` is the target of the Call (on-summon) ability; if no
// valid target exists the spirit may still be summoned and the Call fizzles.
// Charms with a target need a valid one to be cast.
const S = (id, name, bn, cost, atk, hp, kw, text, target = null, aura = '#7fd6c2') =>
  ({ id, type: 'spirit', name, bn, cost, atk, hp, kw, text, target, aura });
const C = (id, name, bn, cost, text, target = null, aura = '#f2b84b') =>
  ({ id, type: 'charm', name, bn, cost, text, target, aura });

const ES = { side: 'enemy', what: 'spirit' };
const EA = { side: 'enemy', what: 'any' };
const EP = { side: 'enemy', what: 'player' };

export const CARDS = Object.fromEntries([
  S('gechho', 'Gechho Bhoot', 'গেছো ভূত', 1, 1, 3, ['guard'], 'A tree-dweller that drops on whoever passes below.', null, '#6fbf73'),
  S('aleya', 'Aleya', 'আলেয়া', 1, 1, 1, [], 'Haunt: deals 2 damage to whoever destroyed it.', null, '#7ee8fa'),
  S('mamdo', 'Mamdo Bhoot', 'মামদো ভূত', 2, 3, 2, [], 'A brawler of the crossroads. No tricks, only fists.', null, '#c9a26b'),
  S('mechho', 'Mechho Bhoot', 'মেছো ভূত', 2, 2, 2, [], 'Call: steal a random card from an enemy\'s hand.', { side: 'enemy', what: 'player', needHand: true }, '#5fb4d9'),
  S('khokkosh', 'Khokkosh', 'খোক্কস', 2, 2, 2, ['swift'], 'Kin: +1 attack while you control a Rakkhosh.', null, '#e07a5f'),
  S('boba', 'Boba', 'বোবা', 2, 1, 3, [], 'Call: stun an enemy spirit. It cannot attack on its next turn.', ES, '#9d8cd9'),
  S('chandburi', 'Chander Buri', 'চাঁদের বুড়ি', 2, 0, 4, [], 'End of your turn: restore 1 HP to your wanderer and your other spirits.', null, '#f4ecc2'),
  S('petni', 'Petni', 'পেত্নী', 2, 2, 3, [], 'Call: her wail gives an enemy spirit −2 attack.', ES, '#b7e4c7'),
  S('byangoma', 'Byangoma-Byangomi', 'ব্যাঙ্গমা-ব্যাঙ্গমী', 3, 2, 2, [], 'Call: the birds of prophecy draw you 2 cards.', null, '#f6bd60'),
  S('betal', 'Betal', 'বেতাল', 3, 3, 3, [], 'Haunt: flies back to your hand instead of the discard pile.', null, '#a3b18a'),
  S('skondho', 'Skondhokata', 'স্কন্ধকাটা', 3, 5, 3, ['blind'], 'Headless: you choose the opponent, but its target is random.', null, '#d9d9d9'),
  S('jokkho', 'Jokkho', 'যক্ষ', 3, 0, 6, ['guard'], 'Start of your turn: +1 Flame this turn.', null, '#f2c14e'),
  S('nagini', 'Nagini', 'নাগিনী', 3, 1, 3, ['venom'], 'The serpent-woman\'s bite is always fatal.', null, '#52b788'),
  S('jujuburi', 'Jujuburi', 'জুজুবুড়ি', 3, 2, 3, [], 'Call: scare an enemy spirit back to its owner\'s hand.', ES, '#b08968'),
  S('pakkhiraj', 'Pakkhiraj', 'পক্ষীরাজ', 3, 3, 2, ['swift', 'flying'], 'The winged horse outruns every sentry.', null, '#e9ecef'),
  S('pishach', 'Pishach', 'পিশাচ', 4, 3, 4, ['drain'], 'Feeds on the living to keep you standing.', null, '#c1121f'),
  S('daini', 'Daini', 'ডাইনী', 4, 3, 3, [], 'Call: hex any enemy for 2 damage.', EA, '#9d4edd'),
  S('shakchunni', 'Shakchunni', 'শাঁকচুন্নি', 4, 2, 3, [], 'Call: possess — copy the attack and HP of any spirit.', { side: 'any', what: 'spirit' }, '#f28482'),
  S('begho', 'Begho Bhoot', 'বেঘো ভূত', 4, 4, 3, ['swift'], 'The tiger\'s victim hunts with the tiger\'s roar.', null, '#f77f00'),
  S('lalneel', 'Lalkamal & Neelkamal', 'লালকমল-নীলকমল', 4, 3, 4, [], 'Slayers: deal double damage to Rakkhosh and Khokkosh.', null, '#ef476f'),
  S('nishi', 'Nishi', 'নিশি', 5, 2, 4, [], 'Call: lure an enemy spirit with 3 or less HP to your side.', { side: 'enemy', what: 'spirit', maxHp: 3, needRoom: true }, '#4895ef'),
  S('rakkhosh', 'Rakkhosh', 'রাক্ষস', 5, 5, 5, [], 'Devour: gains +1/+1 each time it destroys a spirit.', null, '#d00000'),
  S('brahma', 'Brahmadaitya', 'ব্রহ্মদৈত্য', 5, 3, 7, ['guard'], 'Start of your turn: restore 2 HP to your wanderer.', null, '#ffe8a3'),
  S('jinn', 'Jinn', 'জ্বীন', 6, 5, 6, [], 'Call: smokeless fire deals 1 damage to every enemy spirit.', null, '#3a86ff'),

  C('agni', 'Agnibaan', 'অগ্নিবাণ', 2, 'Deal 3 damage to any enemy.', EA, '#ff7b00'),
  C('sorshe', 'Shorshe Pora', 'সর্ষে পোড়া', 3, 'Burnt mustard smoke: deal 2 damage to all spirits of one enemy.', EP, '#e9c46a'),
  C('kabach', 'Kabach', 'কবচ', 1, 'Ward one of your spirits or yourself. A Ward blocks the next damage.', { side: 'friendly', what: 'any' }, '#90e0ef'),
  C('ghum', 'Ghumparani Gaan', 'ঘুমপাড়ানি গান', 3, 'Lullaby: stun every spirit of one enemy.', EP, '#b8c0ff'),
  C('ilish', 'Ilish Bhog', 'ইলিশ ভোগ', 2, 'Restore 5 HP to your wanderer. If you control Mechho Bhoot, also draw 2 cards.', null, '#ced4da'),
  C('tel', 'Lantern Oil', 'প্রদীপের তেল', 0, 'Gain 2 Flame this turn.', null, '#ffb703'),
  C('loha', 'Iron Nail', 'লোহার পেরেক', 1, 'Deal 1 damage to an enemy spirit and stun it.', ES, '#adb5bd'),
  C('morog', 'Rooster\'s Crow', 'মোরগের ডাক', 5, 'A false dawn: destroy an enemy spirit.', ES, '#e63946'),
  C('jhuli', 'Thakumar Golpo', 'ঠাকুমার গল্প', 2, 'Grandmother tells another tale: draw 2 cards.', null, '#dda15e'),
].map(c => [c.id, c]));

// Shared draw pile: [cardId, copies].
export const DECK = [
  ['gechho', 3], ['aleya', 2], ['mamdo', 3], ['mechho', 2], ['khokkosh', 3], ['boba', 2],
  ['chandburi', 2], ['petni', 2], ['byangoma', 2], ['betal', 2], ['skondho', 2], ['jokkho', 2],
  ['nagini', 2], ['jujuburi', 2], ['pakkhiraj', 2], ['pishach', 2], ['daini', 2], ['shakchunni', 2],
  ['begho', 2], ['lalneel', 2], ['nishi', 2], ['rakkhosh', 2], ['brahma', 2], ['jinn', 2],
  ['agni', 3], ['sorshe', 2], ['kabach', 3], ['ghum', 2], ['ilish', 2], ['tel', 3], ['loha', 3],
  ['morog', 2], ['jhuli', 2],
];

// ---- Voices -----------------------------------------------------------------
// Spoken lines. The engine emits them as `say` events; the client shows bubbles.
export const LINES = {
  gechho: { summon: 'This tree is taken.', die: 'Timberrr…' },
  aleya: { summon: 'Follow the light…', die: '…you followed.' },
  mamdo: { summon: 'Who walks my road?', attack: 'Toll!' },
  mechho: { summon: 'Maachh! Give me the fish!', attack: 'Smells like hilsa!' },
  khokkosh: { summon: 'Ke jaage? Who is awake?', attack: 'Khok-khok-khok!' },
  boba: { summon: 'Shhh…' },
  chandburi: { summon: 'Still spinning, little ones.', die: 'The thread… snaps.' },
  petni: { summon: 'Eeee-hee-hee!', attack: 'Come closer, dear!' },
  byangoma: { summon: 'We know what comes.', die: 'We… did not see that.' },
  betal: { summon: 'Answer my riddle…', die: 'Back to my tree!' },
  skondho: { summon: 'Where… is… my head?', attack: 'Is that a head?!' },
  jokkho: { summon: 'The treasure stays buried.' },
  nagini: { summon: 'Hissss…', attack: 'One kiss.' },
  jujuburi: { summon: 'Bad children get taken!', attack: 'Into the sack!' },
  pakkhiraj: { summon: 'Hrrrnnn!', attack: 'Over your heads!' },
  pishach: { summon: 'So… hungry…', attack: 'Mmm. Warm.' },
  daini: { summon: 'A pinch of ash, a drop of spite.' },
  shakchunni: { summon: 'Let me wear your bangles…' },
  begho: { summon: 'HALUM!', attack: 'Halum!' },
  lalneel: { summon: 'Lalkamal is awake! Neelkamal is awake!' },
  nishi: { summon: '…come outside. It is only me.' },
  rakkhosh: { summon: 'Hau mau khau — I smell a human!', attack: 'Crunch!' },
  brahma: { summon: 'Peace beneath my bel tree.', die: 'Om… shanti.' },
  jinn: { summon: 'Smoke and fire answer.' },
};

// When `a` attacks `b`: [attacker line, defender reply].
export const BANTER = {
  'lalneel>rakkhosh': ['Your feast ends tonight!', 'Princes taste best!'],
  'lalneel>khokkosh': ['We are awake, Khokkosh!', 'Eep!'],
  'khokkosh>lalneel': ['Ke jaage?', 'Lalkamal jaage! Neelkamal jaage!'],
  'rakkhosh>lalneel': ['Two bites. Maybe three.', 'Swords up, brother!'],
  'rakkhosh>khokkosh': ['Out of my way, runt!', 'But… uncle!'],
  'khokkosh>rakkhosh': ['Sorry, uncle!', 'Ungrateful whelp!'],
  'petni>shakchunni': ['He was MINE!', 'Get your own husband!'],
  'shakchunni>petni': ['Those are MY bangles!', 'Hee-hee — finders keepers!'],
  'daini>jujuburi': ['Amateur.', 'Hag!'],
  'jujuburi>daini': ['Into the sack, witch!', 'Try it, crone.'],
  'betal>skondho': ['Riddle: what has shoulders but no head?', '…not funny.'],
  'begho>pakkhiraj': ['Horse meat!', 'Catch me first!'],
  'jinn>daini': ['Your little spells amuse me.', 'Someone fetch a bottle!'],
  'daini>jinn': ['I have a lamp with your name on it.', 'Insolence!'],
  'nagini>byangoma': ['Little birds…', 'We saw this coming!'],
  'mechho>petni': ['That was MY fish!', 'Hee-hee-hee!'],
  'pishach>brahma': ['Holy blood…', 'Begone, foul thing!'],
  'nishi>boba': ['Say my name…', '…'],
  'mamdo>gechho': ['Come down and fight!', 'Come up and say that!'],
  'aleya>nishi': ['This way…', 'No, little light. MY way.'],
};

// When card `a` enters play (or charm `a` is cast) and spirit `b` is on any
// board, `b` reacts. side: 'same' | 'enemy' | 'any' relative to the player of `a`.
export const REACT = {
  'rakkhosh>khokkosh': { side: 'same', text: 'Uncle is here! Now you are in trouble!' },
  'khokkosh>rakkhosh': { side: 'same', text: 'Stay close, nephew.' },
  'lalneel>rakkhosh': { side: 'enemy', text: 'Grr… the princes.' },
  'lalneel>khokkosh': { side: 'enemy', text: 'Eep — the princes!' },
  'ilish>mechho': { side: 'any', text: 'FISH?! Where?!' },
  'morog>gechho': { side: 'enemy', text: 'Dawn already?!' },
  'morog>petni': { side: 'enemy', text: 'No no no — not the rooster!' },
  'jinn>daini': { side: 'any', text: 'Tch. Show-off.' },
  'chandburi>aleya': { side: 'any', text: 'Grandmother moon!' },
  'nishi>betal': { side: 'any', text: 'Do not answer her.' },
  'begho>pakkhiraj': { side: 'enemy', text: '*nervous whinny*' },
  'ghum>boba': { side: 'any', text: '…zzz.' },
};

// ---- Targeting rules (shared by engine validation, bots and client UI) ------
// G: { players: [{ id, ko, hand?|handCount, board: [{uid,id,atk,hp,kw,stun,ready}] }] }
// A target is { p: playerId, u: spiritUid | 'w' }  ('w' = the wanderer / the player).

const handSize = pl => (pl.handCount != null ? pl.handCount : (pl.hand ? pl.hand.length : 0));

/** All legal targets for a spec, from the point of view of player `pid`. */
export function validTargets(G, pid, spec) {
  if (!spec) return [];
  const out = [];
  const me = G.players.find(p => p.id === pid);
  if (!me) return out;
  if (spec.needRoom && me.board.length >= MAX_BOARD - 1) return out; // the caster itself takes a slot
  for (const pl of G.players) {
    const mine = pl.id === pid;
    if (spec.side === 'enemy' && mine) continue;
    if (spec.side === 'friendly' && !mine) continue;
    if (spec.what === 'spirit' || spec.what === 'any') {
      for (const s of pl.board) {
        if (spec.maxHp != null && s.hp > spec.maxHp) continue;
        out.push({ p: pl.id, u: s.uid });
      }
    }
    if (spec.what === 'any' && !pl.ko) out.push({ p: pl.id, u: 'w' });
    if (spec.what === 'player') {
      if (spec.needHand && handSize(pl) === 0) continue;
      out.push({ p: pl.id, u: 'w' });
    }
  }
  return out;
}

/** Legal attack targets for one of pid's spirits (ignores ready/stun state). */
export function attackTargets(G, pid, uid) {
  const me = G.players.find(p => p.id === pid);
  const a = me && me.board.find(s => s.uid === uid);
  if (!a || a.atk <= 0) return [];
  const out = [];
  for (const pl of G.players) {
    if (pl.id === pid) continue;
    const guards = pl.board.filter(s => s.kw.includes('guard'));
    if (guards.length && !a.kw.includes('flying')) {
      for (const s of guards) out.push({ p: pl.id, u: s.uid });
    } else {
      for (const s of pl.board) out.push({ p: pl.id, u: s.uid });
      if (!pl.ko) out.push({ p: pl.id, u: 'w' });
    }
  }
  return out;
}

export function canAttack(G, pid, uid) {
  const me = G.players.find(p => p.id === pid);
  const a = me && me.board.find(s => s.uid === uid);
  return !!a && a.ready && !a.stun && a.atk > 0 && attackTargets(G, pid, uid).length > 0;
}

/** Why a hand card cannot be played right now, or null if it can. */
export function playBlocker(G, pid, cardId) {
  const me = G.players.find(p => p.id === pid);
  const c = CARDS[cardId];
  if (!me || !c) return 'Unknown card';
  if (me.flame < c.cost) return 'Not enough Flame';
  if (c.type === 'spirit' && me.board.length >= MAX_BOARD) return 'Your grove is full';
  if (c.type === 'charm' && c.target && validTargets(G, pid, c.target).length === 0) return 'No valid target';
  return null;
}

export function skillBlocker(G, pid) {
  const me = G.players.find(p => p.id === pid);
  if (!me) return 'Unknown player';
  if (me.skillUsed) return 'Already used this turn';
  if (me.flame < SKILL_COST) return 'Not enough Flame';
  if (validTargets(G, pid, CLASSES[me.cls].skill.target).length === 0) return 'No valid target';
  return null;
}

export const sameTarget = (a, b) => !!a && !!b && a.p === b.p && a.u === b.u;
