// Nishir Daak — browser client.
import {
  CARDS, CLASSES, KW, MAX_BOARD, SKILL_COST, DECK, skillText,
  validTargets, attackTargets, canAttack, playBlocker, skillBlocker,
} from './cards.js';
import { art } from './art.js';
import { sfx } from './sfx.js';
import { net } from './net.js';
import * as fx from './fx.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls = '', html = '') => { const d = document.createElement(tag); d.className = cls; d.innerHTML = html; return d; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const same = (a, b) => String(a) === String(b);
const wait = fx.wait;
const EMOTES = ['😂', '😱', '😈', '🙏', '🔥', '😴', '👻', '🐟'];

const S = {
  V: null,            // the state currently on screen
  latest: null,       // newest state from the server
  q: [],              // events waiting to be animated
  running: false, sending: false,
  lastQueued: 0,
  sel: null, targets: [],
  turnEndsAt: 0, lastTick: -1,
  sps: new Map(),     // spirit uid -> element
  hcs: new Map(),     // hand card uid -> element
  deathPos: new Map(),
  overReason: 'goal', resultsShown: false,
};

const me = () => S.V && S.V.players.find(p => p.id === S.V.you);
const P = id => S.V.players.find(p => same(p.id, id));
const spirit = (pid, u) => { const p = P(pid); return p && p.board.find(s => same(s.uid, u)); };
const myTurn = () => !!S.V && S.V.phase === 'play' && S.V.turn === S.V.you;
const cls = p => CLASSES[p.cls] || CLASSES.ojha;

// ───────────────────────── screens ─────────────────────────
function show(name) {
  for (const s of $$('.screen')) s.classList.toggle('show', s.id === name);
  document.body.dataset.screen = name;
  if (name !== 'game') { $('#results').hidden = true; }
  sfx.ambient(name === 'game');
}

// ───────────────────────── home ─────────────────────────
const inName = $('#inName'), inCode = $('#inCode');
try { inName.value = localStorage.getItem('nd_name') || ''; } catch { /* ignore */ }
const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (urlRoom) inCode.value = urlRoom;

function playerName() {
  const n = inName.value.trim().slice(0, 14) || 'Traveller';
  try { localStorage.setItem('nd_name', n); } catch { /* ignore */ }
  return n;
}
function homeErr(t) { $('#homeErr').textContent = t || ''; }

async function enter(fn, btn) {
  if (btn.disabled) return;
  homeErr(''); btn.disabled = true; sfx.unlock(); sfx.play('tap');
  try {
    const r = await fn();
    if (r.error) { homeErr(r.error); sfx.play('deny'); }
    else { sfx.play('join'); setUrlRoom(r.room); }
  } catch (e) {
    homeErr('Could not reach the server. Is it running?');
  }
  btn.disabled = false;
}
function setUrlRoom(code) {
  try { history.replaceState(null, '', code ? '?room=' + code : location.pathname); } catch { /* ignore */ }
}

$('#btnCreate').onclick = e => enter(() => net.create(playerName()), e.currentTarget);
$('#btnJoin').onclick = e => {
  const code = inCode.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { homeErr('Room codes are 4 letters.'); return; }
  enter(() => net.join(code, playerName()), e.currentTarget);
};
inCode.addEventListener('input', () => { inCode.value = inCode.value.toUpperCase().replace(/[^A-Z]/g, ''); });
inCode.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnJoin').click(); });
inName.addEventListener('keydown', e => { if (e.key === 'Enter') (inCode.value ? $('#btnJoin') : $('#btnCreate')).click(); });
$('#btnHow').onclick = () => openHelp();

function goHome(msg) {
  net.leave();
  S.V = S.latest = null; S.q = []; S.lastQueued = 0; S.sel = null; S.targets = [];
  setUrlRoom('');
  show('home');
  if (msg) homeErr(msg);
}

// ───────────────────────── lobby ─────────────────────────
function renderLobby() {
  const V = S.V, host = V.hostId === V.you, mine = me();
  $('#lobCode').textContent = V.code;

  const box = $('#lobPlayers');
  box.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const p = V.players[i];
    const d = el('div', 'lp' + (p ? '' : ' empty'));
    if (p) {
      const c = cls(p);
      d.innerHTML = `<div class="lp-art">${art(c.id)}</div>
        <div class="lp-info"><b>${esc(p.name)}</b><small>${c.name} · ${c.title}</small></div>
        <div class="lp-tags">${same(p.id, V.hostId) ? '<span class="tag host">host</span>' : ''}${p.bot ? '<span class="tag">bot</span>' : ''}${same(p.id, V.you) ? '<span class="tag you">you</span>' : ''}</div>
        ${host && !same(p.id, V.you) ? `<button class="lp-kick" data-kick="${esc(p.id)}" aria-label="Remove">×</button>` : ''}`;
    } else {
      d.innerHTML = '<div class="lp-art"></div><div class="lp-info"><small>Waiting for a traveller…</small></div>';
    }
    box.appendChild(d);
  }

  const cbox = $('#lobClasses');
  if (!cbox.children.length) {
    for (const c of Object.values(CLASSES)) {
      const d = el('button', 'cc');
      d.dataset.cls = c.id;
      d.innerHTML = `<div class="cc-art">${art(c.id)}</div>
        <div class="cc-name">${c.name} <span class="bn">${c.bn}</span></div>
        <div class="cc-title">${c.title} · ♥ ${c.hp}</div>
        <div class="cc-skill"><b>${c.skill.name}</b> ${skillText(c.id, 1)}</div>`;
      cbox.appendChild(d);
    }
  }
  for (const d of cbox.children) d.classList.toggle('on', !!mine && d.dataset.cls === mine.cls);

  const hb = $('#lobHost');
  const seg = (label, key, opts, cur) => `<div class="seg"><span>${label}</span><div class="seg-row">${opts.map(([v, t]) =>
    `<button data-set="${key}" data-val="${v}" class="${cur === v ? 'on' : ''}" ${host ? '' : 'disabled'}>${t}</button>`).join('')}</div></div>`;
  hb.innerHTML =
    seg('Fireflies to win', 'goal', [[7, 'Quick · 7'], [10, 'Classic · 10'], [14, 'Epic · 14']], V.settings.goal) +
    seg('Turn timer', 'timer', [[0, 'Off'], [45, '45s'], [75, '75s'], [120, '2m']], V.settings.timer) +
    (host && V.players.length < 4 ? '<button class="btn small ghost" data-addbot>+ Add a forest spirit (bot)</button>' : '');

  const start = $('#btnStart'), hint = $('#lobHint');
  start.hidden = !host;
  start.disabled = V.players.length < 2;
  const hostP = P(V.hostId);
  hint.textContent = host
    ? (V.players.length < 2 ? 'Invite a friend with the room code, or add a bot.' : `${V.players.length} travellers ready.`)
    : `Waiting for ${hostP ? hostP.name : 'the host'} to start…`;
}

$('#lobby').addEventListener('click', async e => {
  const t = e.target;
  sfx.unlock();
  const cc = t.closest('.cc');
  if (cc) { sfx.play('select'); return act({ type: 'class', cls: cc.dataset.cls }); }
  const k = t.closest('[data-kick]');
  if (k) return act({ type: 'kick', pid: P(k.dataset.kick)?.id ?? k.dataset.kick });
  if (t.closest('[data-addbot]')) { sfx.play('join'); return act({ type: 'addBot' }); }
  const st = t.closest('[data-set]');
  if (st) { sfx.play('tap'); return act({ type: 'settings', [st.dataset.set]: +st.dataset.val }); }
});
$('#btnStart').onclick = () => { sfx.unlock(); act({ type: 'start' }); };
$('#btnLeaveLobby').onclick = async () => { await net.act({ type: 'leave' }); goHome(); };
function inviteLink() { return location.origin + location.pathname + '?room=' + S.V.code; }
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); fx.toast(okMsg); }
  catch { fx.toast(text, 5000); }
}
$('#codeBox').onclick = () => copy(S.V.code, 'Room code copied');
$('#btnShare').onclick = async () => {
  const url = inviteLink();
  if (navigator.share) {
    try { await navigator.share({ title: 'Nishir Daak', text: `Join my night in the forest — room ${S.V.code}`, url }); return; } catch { /* cancelled */ }
  }
  copy(url, 'Invite link copied');
};

async function act(action) {
  if (S.sending) return null;
  S.sending = true;
  const r = await net.act(action);
  S.sending = false;
  if (r.error) { fx.toast(r.error); sfx.play('deny'); }
  return r;
}

// ───────────────────────── incoming state ─────────────────────────
net.onGone = msg => goHome(msg === 'Room closed' ? '' : msg);
net.onConn = ok => $('#conn').classList.toggle('show', !ok);
net.onView = view => {
  S.latest = view;
  S.turnEndsAt = view.turnLeft != null ? performance.now() + view.turnLeft : 0;
  const evs = (view.events || []).filter(e => e.seq > S.lastQueued);

  if (view.phase === 'lobby') {
    S.q = []; S.V = clone(view); S.lastQueued = view.seq; S.sel = null; S.targets = []; S.resultsShown = false;
    show('lobby'); renderLobby();
    return;
  }
  const gap = evs.length > 0 && evs[0].seq !== S.lastQueued + 1;
  const fresh = !S.V || S.V.phase === 'lobby' || S.V.code !== view.code || gap || evs.length > 70;
  if (fresh) {
    const fromLobby = !!S.V && S.V.phase === 'lobby';
    S.q = []; S.V = clone(view); S.lastQueued = view.seq; S.sel = null; S.targets = [];
    const o = evs.find(e => e.t === 'over'); if (o) S.overReason = o.reason;
    show('game'); buildBoards(); sync();
    if (fromLobby) {
      sfx.play('start');
      fx.banner('The night begins', 'First to ' + view.settings.goal + ' fireflies finds the way out', true);
      const first = P(view.turn);
      if (first) setTimeout(() => { turnBanner(first); }, 1400);
    }
    if (S.V.phase === 'over') showResults();
    return;
  }
  if (evs.length) { S.q.push(...evs); S.lastQueued = evs[evs.length - 1].seq; }
  runQueue();
};

async function runQueue() {
  if (S.running) return;
  S.running = true;
  while (S.q.length) {
    const ev = S.q.shift();
    const fast = S.q.length > 30 || document.hidden;
    const h = H[ev.t];
    if (h) { try { await h(ev, fast); } catch (e) { console.error('event', ev, e); } }
  }
  S.V = clone(S.latest);
  S.running = false;
  if ($('#boards').children.length !== S.V.players.length) buildBoards();
  refreshSel();
  sync();
  if (S.V.phase === 'over') showResults();
}

// ───────────────────────── board rendering ─────────────────────────
function buildBoards() {
  const b = $('#boards'), V = S.V, n = V.players.length;
  b.innerHTML = ''; S.sps.clear();
  const mi = Math.max(0, V.players.findIndex(p => p.id === V.you));
  const order = [];
  for (let i = 1; i < n; i++) order.push(V.players[(mi + i) % n]);
  order.push(V.players[mi]);
  for (const p of order) {
    const row = el('div', 'row ' + (p.id === V.you ? 'me' : 'opp'));
    row.dataset.p = p.id;
    row.innerHTML = `
      <div class="wand" data-p="${esc(p.id)}" data-u="w">
        <div class="w-art"></div><span class="w-lvl"></span>
        <div class="w-name"></div>
        <div class="w-hp"><i></i><b></b></div>
        <div class="w-res">
          <span class="r-ff"><i class="ic-ff"></i><b>0</b></span>
          <span class="r-fl"><i class="ic-fl"></i><b>0</b></span>
          <span class="r-hand"><i class="ic-card"></i><b>0</b></span>
        </div>
        <span class="w-tag"></span><span class="w-shield"></span><span class="w-ko">LOST</span>
      </div>
      <div class="slots"></div>`;
    b.appendChild(row);
  }
  b.dataset.n = n;
  $('#hand').innerHTML = ''; S.hcs.clear();
  layout();
}

function layout() {
  const b = $('#boards');
  if (!S.V || !b.children.length) return;
  const n = S.V.players.length;
  const rowH = b.clientHeight / n;
  const inner = b.clientWidth - 12 - 10 - 8;       // board padding, row padding/border, badge overhang
  const stack = rowH >= 176;                        // roomy rows: wanderer strip above/below its spirits
  const wandW = Math.min(92, Math.max(70, b.clientWidth * 0.2));
  const availW = (stack ? inner : inner - wandW - 6) - 3 * 5;
  const tw = Math.max(40, Math.min((rowH - (stack ? 66 : 14)) / 1.3, availW / 4, 124));
  b.classList.toggle('stack', stack);
  b.style.setProperty('--tw', tw.toFixed(1) + 'px');
  b.style.setProperty('--th', (tw * 1.3).toFixed(1) + 'px');
  b.style.setProperty('--ww', wandW.toFixed(1) + 'px');
  b.classList.toggle('tight', rowH < 112);
  $('.g-bottom').style.setProperty('--bh', b.clientHeight + 'px');
  fitHand();
}
addEventListener('resize', layout);

function setNum(elm, val) {
  const t = String(val);
  if (elm.textContent !== t) {
    const had = elm.textContent !== '';
    elm.textContent = t;
    if (had) { elm.classList.remove('pop'); void elm.offsetWidth; elm.classList.add('pop'); }
  }
}

function rowOf(pid) { return $$('#boards .row').find(r => same(r.dataset.p, pid)); }
function wandEl(pid) { const r = rowOf(pid); return r && r.querySelector('.wand'); }
function spEl(uid) { return S.sps.get(String(uid)); }
function unitEl(pid, u) { return u === 'w' ? wandEl(pid) : spEl(u); }

function sync() {
  const V = S.V;
  if (!V || V.phase === 'lobby') return;
  $('#roundTxt').textContent = `${Math.min(V.round, V.settings.rounds)}/${V.settings.rounds}`;
  $('#dawnFill').style.width = Math.min(100, ((V.round - 1) / Math.max(1, V.settings.rounds - 1)) * 100) + '%';
  $('#goalTxt').textContent = V.settings.goal;
  setNum($('#deckTxt'), V.deckCount);
  for (const p of V.players) {
    const row = rowOf(p.id);
    if (!row) continue;
    row.classList.toggle('active', same(V.turn, p.id) && V.phase === 'play');
    updateWand(row, p);
    syncSlots(row, p);
  }
  syncHand();
  syncBar();
  markTargets();
}

function updateWand(row, p) {
  const w = row.querySelector('.wand'), c = cls(p);
  const a = w.querySelector('.w-art');
  if (a.dataset.cls !== c.id) { a.dataset.cls = c.id; a.innerHTML = art(c.id); }
  w.querySelector('.w-name').textContent = p.name;
  setNum(w.querySelector('.w-lvl'), p.level);
  w.querySelector('.w-lvl').dataset.l = p.level;
  setNum(w.querySelector('.w-hp b'), Math.max(0, p.hp));
  const pct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  const bar = w.querySelector('.w-hp i');
  bar.style.width = pct + '%';
  bar.dataset.low = pct <= 35 ? '1' : '';
  setNum(w.querySelector('.r-ff b'), p.ff);
  setNum(w.querySelector('.r-fl b'), p.flame);
  setNum(w.querySelector('.r-hand b'), p.handCount);
  w.classList.toggle('ko', !!p.ko);
  w.classList.toggle('warded', !!p.ward);
  const tag = w.querySelector('.w-tag');
  tag.textContent = p.bot ? 'bot' : p.auto ? 'auto' : p.online === false ? 'away' : '';
}

function makeSp(s) {
  const c = CARDS[s.id];
  const e = el('div', 'sp enter', `
    <div class="sp-art">${art(s.id)}</div>
    <div class="sp-name">${c.name}</div>
    <div class="sp-kw"></div>
    <span class="b atk"></span><span class="b hp"></span>
    <span class="sp-zz">💤</span><span class="sp-shield"></span>`);
  e.dataset.uid = e.dataset.u = String(s.uid);
  e.style.setProperty('--aura', c.aura);
  setTimeout(() => e.classList.remove('enter'), 600);
  return e;
}

function updateSp(e, s, p) {
  const c = CARDS[s.id];
  e.dataset.p = p.id;
  setNum(e.querySelector('.atk'), s.atk);
  setNum(e.querySelector('.hp'), s.hp);
  e.querySelector('.atk').dataset.m = s.atk > c.atk ? 'up' : s.atk < c.atk ? 'down' : '';
  e.querySelector('.hp').dataset.m = s.hp < s.maxHp ? 'down' : s.maxHp > c.hp ? 'up' : '';
  const kw = e.querySelector('.sp-kw');
  const icons = s.kw.map(k => KW[k] ? KW[k].icon : '').join('');
  if (kw.textContent !== icons) kw.textContent = icons;
  e.classList.toggle('guard', s.kw.includes('guard'));
  e.classList.toggle('stun', !!s.stun);
  e.classList.toggle('warded', !!s.ward);
  e.classList.toggle('ready', p.id === S.V.you && myTurn() && !S.running && canAttack(S.V, p.id, s.uid));
  e.classList.toggle('sel', !!S.sel && S.sel.kind === 'sp' && same(S.sel.uid, s.uid));
}

function syncSlots(row, p) {
  const slots = row.querySelector('.slots');
  const want = [];
  for (const s of p.board) {
    const key = String(s.uid);
    let e = S.sps.get(key);
    if (!e) { e = makeSp(s); S.sps.set(key, e); }
    updateSp(e, s, p);
    want.push(e);
  }
  want.forEach((e, i) => { if (slots.children[i] !== e) slots.insertBefore(e, slots.children[i] || null); });
  for (const e of $$('.sp', slots)) {
    if (!want.includes(e)) { e.remove(); if (S.sps.get(e.dataset.uid) === e) S.sps.delete(e.dataset.uid); }
  }
  const phs = $$('.ph', slots), need = MAX_BOARD - want.length;
  for (let i = phs.length; i < need; i++) slots.appendChild(el('div', 'ph'));
  for (let i = need; i < phs.length; i++) phs[i].remove();
}

function cardFace(c) {
  return `<span class="cost">${c.cost}</span>
    <div class="hc-art">${art(c.id)}</div>
    <div class="hc-name">${c.name}</div>
    ${c.type === 'spirit' ? `<span class="b atk">${c.atk}</span><span class="b hp">${c.hp}</span>` : '<span class="hc-type">charm</span>'}`;
}

function syncHand() {
  const hand = $('#hand'), p = me();
  const cards = (p && p.hand) || [];
  const want = [];
  for (const h of cards) {
    const key = String(h.uid);
    let e = S.hcs.get(key);
    if (!e) {
      const c = CARDS[h.id];
      e = el('div', 'hc enter ' + c.type, cardFace(c));
      e.dataset.uid = key;
      e.style.setProperty('--aura', c.aura);
      setTimeout(() => e.classList.remove('enter'), 500);
      S.hcs.set(key, e);
    }
    e.classList.toggle('playable', myTurn() && !S.running && !playBlocker(S.V, S.V.you, h.id));
    e.classList.toggle('sel', !!S.sel && S.sel.kind === 'card' && same(S.sel.uid, h.uid));
    want.push(e);
  }
  want.forEach((e, i) => { if (hand.children[i] !== e) hand.insertBefore(e, hand.children[i] || null); });
  for (const e of $$('.hc', hand)) {
    if (!want.includes(e)) { e.remove(); S.hcs.delete(e.dataset.uid); }
  }
  hand.classList.toggle('empty', !want.length);
  fitHand();
}

function fitHand() {
  const hand = $('#hand'), n = hand.children.length;
  if (!n) return;
  const cw = hand.children[0].offsetWidth || 64, W = hand.clientWidth - 16;
  const gap = 5;
  let ov = gap;
  if (n > 1 && n * cw + (n - 1) * gap > W) ov = (W - n * cw) / (n - 1);
  hand.style.setProperty('--ov', ov.toFixed(1) + 'px');
}

function syncBar() {
  const p = me();
  if (!p) return;
  const mt = myTurn(), c = cls(p);
  const total = Math.max(p.flame, p.maxFlame);
  let pips = '';
  for (let i = 0; i < total; i++) pips += `<i class="pip${i < p.flame ? ' on' : ''}${i >= p.maxFlame ? ' extra' : ''}"></i>`;
  const f = $('#flame');
  const html = `<i class="ic-fl big"></i><b>${p.flame}</b><span class="pips">${pips}</span>`;
  if (f.dataset.h !== html) { f.dataset.h = html; f.innerHTML = html; }

  const sk = $('#btnSkill');
  const blocker = mt ? skillBlocker(S.V, p.id) : 'wait';
  const skHtml = `<span class="sk-name">${c.skill.name}</span><span class="sk-cost"><i class="ic-fl"></i>${SKILL_COST}</span>`;
  if (sk.dataset.h !== skHtml) { sk.dataset.h = skHtml; sk.innerHTML = skHtml; }
  sk.classList.toggle('usable', mt && !blocker && !S.running);
  sk.classList.toggle('used', !!p.skillUsed && mt);
  sk.classList.toggle('sel', !!S.sel && S.sel.kind === 'skill');

  const end = $('#btnEnd');
  const cur = P(S.V.turn);
  if (S.V.phase !== 'play') { end.textContent = 'Dawn'; end.disabled = true; end.classList.remove('nudge'); return; }
  end.disabled = !mt;
  end.textContent = mt ? 'End turn' : (cur ? cur.name : '…');
  end.classList.toggle('waiting', !mt);
  const idle = mt && !S.running && blocker &&
    !(p.hand || []).some(h => !playBlocker(S.V, p.id, h.id)) &&
    !p.board.some(s => canAttack(S.V, p.id, s.uid));
  end.classList.toggle('nudge', !!idle);
}

function markTargets() {
  for (const e of $$('#boards .tgt')) e.classList.remove('tgt');
  for (const t of S.targets) { const e = unitEl(t.p, t.u); if (e) e.classList.add('tgt'); }
  $('#game').classList.toggle('targeting', S.targets.length > 0);
}

// ───────────────────────── selection & input ─────────────────────────
function clearSel() { if (!S.sel && !S.targets.length) return; S.sel = null; S.targets = []; renderSel(); }
function renderSel() {
  markTargets();
  for (const [uid, e] of S.hcs) e.classList.toggle('sel', !!S.sel && S.sel.kind === 'card' && same(S.sel.uid, uid));
  for (const [uid, e] of S.sps) e.classList.toggle('sel', !!S.sel && S.sel.kind === 'sp' && same(S.sel.uid, uid));
  $('#btnSkill').classList.toggle('sel', !!S.sel && S.sel.kind === 'skill');
  renderDetail();
}
function computeTargets(sel) {
  const V = S.V;
  if (!sel || !myTurn() || S.running) return [];
  if (sel.kind === 'card') {
    const c = CARDS[sel.id];
    return (!playBlocker(V, V.you, sel.id) && c.target) ? validTargets(V, V.you, c.target) : [];
  }
  if (sel.kind === 'sp') return (same(sel.pid, V.you) && canAttack(V, V.you, sel.uid)) ? attackTargets(V, V.you, sel.uid) : [];
  if (sel.kind === 'skill') return skillBlocker(V, V.you) ? [] : validTargets(V, V.you, cls(me()).skill.target);
  return [];
}
function refreshSel() {
  const sel = S.sel;
  if (!sel) return;
  const p = me();
  const gone =
    (sel.kind === 'card' && !(p.hand || []).some(h => same(h.uid, sel.uid))) ||
    (sel.kind === 'sp' && !spirit(sel.pid, sel.uid)) ||
    (sel.kind === 'skill' && (!myTurn() || skillBlocker(S.V, p.id))) ||
    (sel.kind === 'wand' && !P(sel.pid));
  if (gone) { S.sel = null; S.targets = []; } else S.targets = computeTargets(sel);
  renderSel();
}
function select(sel) {
  S.sel = sel; S.targets = computeTargets(sel);
  sfx.play('select');
  renderSel();
}

function kwLines(list) {
  return list.filter(k => KW[k]).map(k => `<div class="d-kw"><b>${KW[k].icon} ${KW[k].name}</b> ${KW[k].text}</div>`).join('');
}
function cardDetail(c, s, action) {
  const kws = s ? s.kw : (c.kw || []);
  return `<div class="d-art" style="--aura:${c.aura}">${art(c.id)}</div>
    <div class="d-body">
      <div class="d-title">${c.name} <span class="bn">${c.bn}</span></div>
      <div class="d-meta"><span class="chip fl"><i class="ic-fl"></i>${c.cost}</span>${
        c.type === 'spirit'
          ? `<span class="chip atk">⚔ ${s ? s.atk : c.atk}</span><span class="chip hp">♥ ${s ? s.hp + '/' + s.maxHp : c.hp}</span>`
          : '<span class="chip">Charm</span>'}${s && s.stun ? '<span class="chip">💤 stunned</span>' : ''}${s && s.ward ? '<span class="chip">🔵 warded</span>' : ''}</div>
      <div class="d-text">${c.text}</div>
      ${kwLines(kws)}
      <div class="d-act">${action || ''}</div>
    </div>
    <button class="d-x" data-act="close" aria-label="Close">×</button>`;
}

function renderDetail() {
  const d = $('#detail'), sel = S.sel, V = S.V;
  if (!sel || !V) { d.classList.remove('show'); return; }
  let html = '';
  const note = (t, glow) => `<span class="d-note${glow ? ' glow' : ''}">${t}</span>`;
  if (sel.kind === 'card') {
    const c = CARDS[sel.id];
    const blocker = !myTurn() ? 'Wait for your turn' : S.running ? '…' : playBlocker(V, V.you, sel.id);
    let action;
    if (blocker) action = note(blocker);
    else if (S.targets.length) action = note(c.type === 'spirit' ? 'Tap a glowing target for its Call' : 'Tap a glowing target', true);
    else action = `<button class="btn primary" data-act="play">${c.type === 'spirit' ? 'Summon' : 'Cast'}</button>` +
      (c.target ? note('Its Call has no target right now') : '');
    html = cardDetail(c, null, action);
  } else if (sel.kind === 'sp') {
    const s = spirit(sel.pid, sel.uid);
    if (!s) { d.classList.remove('show'); return; }
    const c = CARDS[s.id];
    let action = '';
    if (same(sel.pid, V.you) && myTurn()) {
      if (S.targets.length) action = note(s.kw.includes('blind') ? 'Tap an opponent — fate picks the target' : 'Tap a glowing enemy to attack', true);
      else action = note(s.stun ? 'Stunned this turn' : s.atk <= 0 ? 'Cannot attack' : !s.ready ? 'Resting until your next turn' : 'Nothing to attack');
    } else {
      const o = P(sel.pid);
      action = note(same(sel.pid, V.you) ? 'Your spirit' : `${esc(o.name)}'s spirit`);
    }
    html = cardDetail(c, s, action);
  } else {
    const p = sel.kind === 'skill' ? me() : P(sel.pid);
    const c = cls(p);
    let action = '';
    if (sel.kind === 'skill') action = S.targets.length ? note('Tap a glowing target', true) : note(skillBlocker(V, p.id) || '');
    html = `<div class="d-art" style="--aura:#ffb703">${art(c.id)}</div>
      <div class="d-body">
        <div class="d-title">${esc(p.name)} <span class="bn">${c.name} · ${c.bn}</span></div>
        <div class="d-meta"><span class="chip">${c.title} · Lv ${p.level}</span><span class="chip hp">♥ ${Math.max(0, p.hp)}/${p.maxHp}</span><span class="chip ff"><i class="ic-ff"></i>${p.ff}</span></div>
        <div class="d-text"><b>${c.skill.name}</b> (<i class="ic-fl"></i>${SKILL_COST}) — ${skillText(c.id, p.level)}</div>
        <div class="d-kw">${c.blurb}</div>
        <div class="d-act">${action}</div>
      </div>
      <button class="d-x" data-act="close" aria-label="Close">×</button>`;
  }
  d.innerHTML = html;
  // While choosing a target the sheet shrinks, and moves to the top if it would hide my own units.
  d.classList.toggle('compact', S.targets.length > 0);
  d.classList.toggle('top', S.targets.some(t => same(t.p, V.you)));
  d.classList.add('show');
}

function onUnitTap(pid, u) {
  const t = S.targets.find(x => same(x.p, pid) && same(x.u, u));
  if (t && S.sel && S.sel.kind !== 'wand') return commit(t);
  if (u === 'w') {
    if (S.sel && S.sel.kind === 'wand' && same(S.sel.pid, pid)) return clearSel();
    return select({ kind: 'wand', pid: P(pid).id });
  }
  if (S.sel && S.sel.kind === 'sp' && same(S.sel.uid, u)) return clearSel();
  const s = spirit(pid, u);
  if (s) select({ kind: 'sp', pid: P(pid).id, uid: s.uid });
}

async function commit(target) {
  const sel = S.sel;
  if (!sel || S.running || S.sending || !myTurn()) return;
  let action;
  if (sel.kind === 'card') action = { type: 'play', uid: sel.uid, ...(target ? { target } : {}) };
  else if (sel.kind === 'sp') action = { type: 'attack', uid: sel.uid, target };
  else if (sel.kind === 'skill') action = { type: 'skill', target };
  else return;
  S.sel = null; S.targets = []; renderSel();
  await act(action);
}

$('#game').addEventListener('click', e => {
  const t = e.target;
  sfx.unlock();
  const a = t.closest('[data-act]');
  if (a) {
    if (a.dataset.act === 'close') return clearSel();
    if (a.dataset.act === 'play') return commit(null);
  }
  const em = t.closest('[data-emote]');
  if (em) { $('#emotes').classList.remove('show'); net.act({ type: 'emote', e: em.dataset.emote }); return; }
  if (t.closest('#btnEmote')) { $('#emotes').classList.toggle('show'); return; }
  $('#emotes').classList.remove('show');
  if (t.closest('#btnMenu')) return openMenu();
  const hc = t.closest('.hc');
  if (hc) {
    const h = (me().hand || []).find(x => same(x.uid, hc.dataset.uid));
    if (!h) return;
    if (S.sel && S.sel.kind === 'card' && same(S.sel.uid, h.uid)) return clearSel();
    return select({ kind: 'card', uid: h.uid, id: h.id });
  }
  const sp = t.closest('.sp');
  if (sp) return onUnitTap(sp.dataset.p, sp.dataset.u);
  const w = t.closest('.wand');
  if (w) return onUnitTap(w.dataset.p, 'w');
  if (t.closest('#btnSkill')) {
    if (S.sel && S.sel.kind === 'skill') return clearSel();
    if (!myTurn()) return select({ kind: 'wand', pid: S.V.you });
    const b = skillBlocker(S.V, S.V.you);
    if (b) { fx.toast(b); sfx.play('deny'); return select({ kind: 'wand', pid: S.V.you }); }
    return select({ kind: 'skill' });
  }
  if (t.closest('#btnEnd')) {
    if (!myTurn() || S.running) return;
    clearSel(); sfx.play('endturn');
    return act({ type: 'end' });
  }
  if (t.closest('#detail')) return;
  clearSel();
});

$('#emotes').innerHTML = EMOTES.map(e => `<button data-emote="${e}">${e}</button>`).join('');

// ───────────────────────── event animations ─────────────────────────
function turnBanner(p) {
  const mine = p.id === S.V.you;
  fx.banner(mine ? 'Your turn' : esc(p.name), mine ? '' : 'is taking their turn', mine);
  if (mine) { sfx.play('turn'); if (navigator.vibrate) { try { navigator.vibrate(40); } catch { /* ignore */ } } }
}
const hpColor = { dmg: '#ff6b6b', heal: '#95f59b' };

const H = {
  async turn(ev, fast) {
    const V = S.V, p = P(ev.p);
    V.turn = ev.p; V.round = ev.round;
    if (p) { p.flame = ev.flame; p.maxFlame = ev.maxFlame; p.skillUsed = false; p.board.forEach(s => { s.ready = true; }); }
    S.sel = null; S.targets = []; renderSel();
    sync();
    if (!fast && p) { turnBanner(p); await wait(p.id === V.you ? 900 : 520); }
  },

  async draw(ev, fast) {
    const p = P(ev.p);
    p.handCount += ev.n;
    if (ev.cards && p.hand) p.hand.push(...ev.cards);
    S.V.deckCount = Math.max(0, S.V.deckCount - ev.n);
    sync();
    if (fast) return;
    sfx.play('draw');
    if (p.id !== S.V.you) fx.float(wandEl(p.id)?.querySelector('.r-hand'), '+' + ev.n, 'info');
    await wait(240);
  },

  async burn(ev, fast) {
    if (fast) return;
    const c = CARDS[ev.id];
    if (ev.p === S.V.you && c) fx.toast(`Hand full — ${c.name} slipped into the dark`);
    await wait(120);
  },

  async play(ev, fast) {
    const p = P(ev.p), c = CARDS[ev.id];
    p.flame = ev.flame;
    p.handCount = Math.max(0, p.handCount - 1);
    if (p.hand) p.hand = p.hand.filter(h => !same(h.uid, ev.uid));
    sync();
    if (fast || !c) return;
    if (c.type === 'charm') {
      sfx.play('charm');
      const card = await fx.reveal(c, p.id === S.V.you ? 'You cast' : esc(p.name) + ' casts');
      if (ev.target) { const te = unitEl(ev.target.p, ev.target.u); if (te) await fx.bolt(card, te, c.aura); }
    } else {
      sfx.play('play');
      await wait(90);
    }
  },

  async summon(ev, fast) {
    const p = P(ev.p);
    if (!p.board.some(s => same(s.uid, ev.s.uid))) p.board.splice(Math.min(ev.idx ?? p.board.length, p.board.length), 0, ev.s);
    sync();
    if (fast) return;
    const e = spEl(ev.s.uid);
    sfx.play('summon');
    if (e) { fx.ring(e, CARDS[ev.s.id].aura); fx.burst(e, CARDS[ev.s.id].aura, 8); }
    await wait(430);
  },

  async skill(ev, fast) {
    const p = P(ev.p), c = CLASSES[ev.cls] || cls(p);
    p.flame = ev.flame; p.skillUsed = true;
    sync();
    if (fast) return;
    const w = wandEl(p.id);
    sfx.play('skill');
    fx.ring(w, '#ffb703');
    fx.bubble(w, c.skill.name + '!', 'shout');
    await wait(260);
    if (ev.target) {
      const te = unitEl(ev.target.p, ev.target.u);
      if (te && te !== w) await fx.bolt(w, te, '#ffd166');
    }
  },

  async atk(ev, fast) {
    if (fast) return;
    const a = spEl(ev.a), t = unitEl(ev.tp, ev.u);
    sfx.play('lunge');
    await fx.lunge(a, t);
  },

  async dmg(ev, fast) {
    const e = unitEl(ev.tp, ev.u);
    if (ev.ward) {
      if (ev.u === 'w') P(ev.tp).ward = false; else { const s = spirit(ev.tp, ev.u); if (s) s.ward = false; }
      if (!fast && e) { sfx.play('block'); fx.ring(e, '#90e0ef'); fx.float(e, 'Blocked', 'info'); }
      sync();
      if (!fast) await wait(260);
      return;
    }
    if (ev.u === 'w') P(ev.tp).hp = ev.hp; else { const s = spirit(ev.tp, ev.u); if (s) s.hp = ev.hp; }
    sync();
    if (fast) return;
    if (e) { fx.float(e, '−' + ev.n, 'dmg'); fx.shake(e); fx.burst(e, hpColor.dmg, 5); }
    sfx.play(ev.n >= 4 ? 'bighit' : 'hit');
    if (ev.u === 'w') fx.screenShake(ev.tp === S.V.you);
    await wait(S.q[0] && S.q[0].t === 'dmg' ? 60 : 300);
  },

  async heal(ev, fast) {
    if (ev.u === 'w') P(ev.tp).hp = ev.hp; else { const s = spirit(ev.tp, ev.u); if (s) s.hp = ev.hp; }
    sync();
    if (fast || !ev.n) return;
    const e = unitEl(ev.tp, ev.u);
    if (e) { fx.float(e, '+' + ev.n, 'heal'); fx.burst(e, hpColor.heal, 6); }
    sfx.play('heal');
    await wait(S.q[0] && S.q[0].t === 'heal' ? 50 : 260);
  },

  async stat(ev, fast) {
    const s = spirit(ev.tp, ev.u);
    if (s) { s.atk = ev.atk; s.hp = ev.hp; s.maxHp = ev.maxHp; }
    sync();
    if (fast || !ev.d) return;
    const e = spEl(ev.u), [da, dh] = ev.d;
    const up = da + dh >= 0;
    const sign = n => (n >= 0 ? '+' : '−') + Math.abs(n);
    if (e) { fx.float(e, dh ? `${sign(da)}/${sign(dh)}` : `${sign(da)} ⚔`, up ? 'buff' : 'debuff'); fx.ring(e, up ? '#ffd166' : '#b388ff'); }
    sfx.play(up ? 'buff' : 'debuff');
    await wait(300);
  },

  async status(ev, fast) {
    const t = ev.u === 'w' ? P(ev.tp) : spirit(ev.tp, ev.u);
    if (!t) return;
    const was = { stun: t.stun, ward: t.ward };
    for (const k of ['stun', 'ward', 'ready']) if (k in ev) t[k] = ev[k];
    sync();
    if (fast) return;
    const e = unitEl(ev.tp, ev.u);
    if (ev.stun && !was.stun) { sfx.play('stun'); if (e) fx.float(e, '💤', 'info'); await wait(S.q[0] && S.q[0].t === 'status' ? 60 : 260); }
    else if (ev.ward && !was.ward) { sfx.play('block'); if (e) fx.ring(e, '#90e0ef'); await wait(240); }
  },

  async die(ev, fast) {
    const p = P(ev.tp), e = spEl(ev.u);
    if (e) S.deathPos.set(String(ev.u), e.getBoundingClientRect());
    if (!fast && e) {
      sfx.play('die');
      e.classList.add('dying');
      fx.burst(e, '#e9ff70', 12);
      await wait(430);
    }
    if (p) p.board = p.board.filter(s => !same(s.uid, ev.u));
    if (S.sel && S.sel.kind === 'sp' && same(S.sel.uid, ev.u)) { S.sel = null; S.targets = []; renderSel(); }
    sync();
  },

  async ff(ev, fast) {
    const p = P(ev.p);
    if (!fast) {
      const to = wandEl(p.id)?.querySelector('.r-ff');
      const from = ev.from ? (S.deathPos.get(String(ev.from.u)) || unitEl(ev.from.tp, ev.from.u)) : wandEl(p.id);
      sfx.play('firefly');
      setTimeout(() => sfx.play('firefly'), 140);
      if (to) await fx.fireflies(from, to, ev.n);
    }
    p.ff = ev.ff;
    sync();
    if (!fast) { const w = wandEl(p.id); if (w) fx.float(w.querySelector('.r-ff'), '+' + ev.n, 'ffl'); await wait(120); }
  },

  async lvl(ev, fast) {
    const p = P(ev.p);
    p.level = ev.level; p.hp = ev.hp; p.maxHp = ev.maxHp;
    sync();
    if (fast) return;
    const w = wandEl(p.id);
    sfx.play('levelup');
    fx.ring(w, '#ffd166'); fx.burst(w, '#ffd166', 16);
    fx.bubble(w, `Level ${ev.level}!`, 'shout');
    await wait(620);
  },

  async ko(ev, fast) {
    const p = P(ev.p);
    p.ko = true; p.hp = 0;
    sync();
    if (fast) return;
    sfx.play('ko');
    fx.screenShake(true);
    const by = P(ev.by);
    fx.banner(p.id === S.V.you ? 'You are lost in the dark' : `${esc(p.name)} is lost`, by ? `struck down by ${esc(by.id === S.V.you ? 'you' : by.name)}` : '', true);
    await wait(950);
  },

  async revive(ev, fast) {
    const p = P(ev.p);
    p.ko = false; p.hp = ev.hp;
    sync();
    if (fast) return;
    sfx.play('revive');
    fx.ring(wandEl(p.id), '#95f59b');
    await wait(320);
  },

  async move(ev, fast) {
    const from = P(ev.from), to = P(ev.to);
    const old = spEl(ev.u)?.getBoundingClientRect();
    if (from) from.board = from.board.filter(s => !same(s.uid, ev.u));
    if (to && !to.board.some(s => same(s.uid, ev.u))) to.board.push(ev.s);
    sync();
    if (fast) return;
    const e = spEl(ev.u);
    sfx.play('steal');
    fx.flip(e, old, 560);
    if (e) fx.ring(e, '#4895ef');
    await wait(560);
  },

  async bounce(ev, fast) {
    const p = P(ev.tp), e = spEl(ev.u);
    if (e) S.deathPos.set(String(ev.u), e.getBoundingClientRect());
    if (!fast && e) {
      sfx.play('bounce');
      const w = wandEl(ev.tp), a = fx.centerOf(e), b = fx.centerOf(w);
      e.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${b.x - a.x}px,${b.y - a.y}px) scale(.2) rotate(40deg)`, opacity: 0.2 }],
        { duration: 400, easing: 'ease-in', fill: 'forwards' });
      await wait(390);
    }
    if (p) {
      p.board = p.board.filter(s => !same(s.uid, ev.u));
      if (!ev.burned) { p.handCount++; if (p.hand && ev.card) p.hand.push(ev.card); }
    }
    sync();
  },

  async steal(ev, fast) {
    const a = P(ev.from), b = P(ev.to);
    if (ev.none) { if (!fast) fx.toast('Nothing to steal'); return; }
    if (!fast) { sfx.play('steal'); await fx.flyCard(wandEl(ev.from), wandEl(ev.to)); }
    a.handCount = Math.max(0, a.handCount - 1); b.handCount++;
    if (ev.card) {
      if (a.hand) a.hand = a.hand.filter(h => !same(h.uid, ev.card.uid));
      if (b.hand) b.hand.push(ev.card);
      const c = CARDS[ev.card.id];
      if (!fast && c) fx.toast(a.id === S.V.you ? `${b.name} stole your ${c.name}!` : `You stole ${c.name}!`, 2600);
    }
    sync();
  },

  async flame(ev) { const p = P(ev.p); p.flame = ev.flame; p.maxFlame = ev.maxFlame; sync(); },

  async say(ev, fast) {
    if (fast) return;
    const e = unitEl(ev.tp, ev.u);
    if (!e) return;
    sfx.play('speak');
    fx.bubble(e, ev.text);
    await wait(S.q[0] && S.q[0].t === 'say' ? 520 : 300);
  },

  async emote(ev, fast) {
    if (fast) return;
    sfx.play('emote');
    fx.bubble(wandEl(ev.p), ev.e, 'emo');
  },

  async shuffle(ev, fast) { if (!fast) { fx.toast('The forest deals its cards anew'); sfx.play('draw'); } },

  async over(ev) { S.overReason = ev.reason; await wait(500); },
};

// ───────────────────────── results ─────────────────────────
function showResults() {
  const V = S.V;
  if (!V.ranking) return;
  const box = $('#results');
  const first = S.resultsShown !== V.code + ':' + V.seq;
  const top = P(V.ranking[0].id), won = top && top.id === V.you;
  $('#resKicker').textContent = S.overReason === 'dawn' ? 'Dawn breaks over the forest' : 'A lantern full of fireflies';
  $('#resTitle').textContent = won ? 'You found the way out!' : `${top ? top.name : 'Someone'} found the way out`;
  $('#resList').innerHTML = V.ranking.map((r, i) => {
    const p = P(r.id); if (!p) return '';
    return `<div class="res-row${p.id === V.you ? ' you' : ''}${i === 0 ? ' win' : ''}">
      <span class="res-rank">${i + 1}</span>
      <div class="res-art">${art(cls(p).id)}</div>
      <div class="res-name"><b>${esc(p.name)}</b><small>${cls(p).name} · Lv ${p.level}</small></div>
      <span class="res-ff"><i class="ic-ff"></i>${r.ff}</span>
    </div>`;
  }).join('');
  const host = V.hostId === V.you;
  $('#btnAgain').hidden = !host;
  box.hidden = false;
  if (first) {
    S.resultsShown = V.code + ':' + V.seq;
    sfx.play(won ? 'win' : 'lose');
    if (won) fx.burst({ left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 }, '#e9ff70', 26);
  }
}
$('#btnAgain').onclick = () => act({ type: 'again' });
$('#btnResLeave').onclick = async () => { await net.act({ type: 'leave' }); goHome(); };

// ───────────────────────── timer ─────────────────────────
setInterval(() => {
  const V = S.V, fill = $('#timerFill');
  if (!V || V.phase !== 'play' || !S.turnEndsAt || !V.settings.timer) { fill.style.width = '0%'; return; }
  const left = S.turnEndsAt - performance.now();
  const pct = Math.max(0, Math.min(1, left / (V.settings.timer * 1000)));
  fill.style.width = (pct * 100) + '%';
  fill.dataset.low = left < 10000 ? '1' : '';
  const sec = Math.ceil(left / 1000);
  if (myTurn() && sec <= 8 && sec > 0 && sec !== S.lastTick) { S.lastTick = sec; sfx.play('tick'); }
}, 250);

// ───────────────────────── menu & help ─────────────────────────
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
}
$('#modal').addEventListener('click', async e => {
  const t = e.target;
  if (t === $('#modal') || t.closest('[data-close]')) { $('#modal').hidden = true; return; }
  const m = t.closest('[data-menu]');
  if (!m) return;
  const k = m.dataset.menu;
  if (k === 'sound') { sfx.setMuted(!sfx.muted); sfx.play('tap'); openMenu(); }
  if (k === 'help') openHelp();
  if (k === 'invite') { $('#modal').hidden = true; copy(inviteLink(), 'Invite link copied'); }
  if (k === 'leave') { $('#modal').hidden = true; await net.act({ type: 'leave' }); goHome(); }
});

function openMenu() {
  openModal(`<h2>Room ${S.V ? esc(S.V.code) : ''}</h2>
    <div class="menu">
      <button class="btn wide" data-menu="sound">Sound: ${sfx.muted ? 'off' : 'on'}</button>
      <button class="btn wide" data-menu="help">How to play &amp; bestiary</button>
      <button class="btn wide" data-menu="invite">Copy invite link</button>
      <button class="btn wide danger" data-menu="leave">Leave the forest</button>
    </div>`);
}

function openHelp() {
  const copies = Object.fromEntries(DECK);
  const card = c => `<div class="g-card" style="--aura:${c.aura}">
      <div class="g-art">${art(c.id)}</div>
      <div class="g-body">
        <div class="g-name">${c.name} <span class="bn">${c.bn}</span></div>
        <div class="d-meta"><span class="chip fl"><i class="ic-fl"></i>${c.cost}</span>${c.type === 'spirit' ? `<span class="chip atk">⚔ ${c.atk}</span><span class="chip hp">♥ ${c.hp}</span>` : '<span class="chip">Charm</span>'}${(c.kw || []).map(k => `<span class="chip">${KW[k].icon} ${KW[k].name}</span>`).join('')}<span class="chip dim">×${copies[c.id] || 0}</span></div>
        <div class="g-text">${c.text}</div>
      </div></div>`;
  const all = Object.values(CARDS);
  openModal(`<h2>How to play</h2>
    <div class="help">
      <p>You are a wanderer lost in the night forest. Bind its spirits, outwit your friends, and fill your lantern with <b><i class="ic-ff"></i> fireflies</b> — the first to reach the goal finds the way out. If nobody does before <b>dawn</b>, the fullest lantern wins.</p>
      <h3>Your turn</h3>
      <ul>
        <li>Your <b><i class="ic-fl"></i> Flame</b> grows by 1 each turn (up to 7) and refills. You draw a card.</li>
        <li><b>Tap a card</b> in your hand to read it, then <b>Summon</b> a spirit into your grove (4 slots) or <b>Cast</b> a charm. Glowing units are valid targets.</li>
        <li><b>Tap one of your spirits</b>, then a glowing enemy, to attack. Each spirit attacks once per turn, and not on the turn it arrives.</li>
        <li>Spirits that fight hurt each other. Hitting a wanderer is free.</li>
        <li>Use your wanderer's <b>skill</b> once per turn for 2 Flame.</li>
      </ul>
      <h3>Fireflies</h3>
      <ul>
        <li>Destroy an enemy spirit: <b>+1</b> (<b>+2</b> for mighty ones costing 5 or more).</li>
        <li>Knock out a wanderer: <b>+3</b>. They return at full health on their next turn.</li>
        <li>At 3 and 7 fireflies your wanderer levels up: more health, stronger skill.</li>
      </ul>
      <h3>Words on cards</h3>
      <div class="d-kw"><b>Call</b> happens when the spirit is summoned.</div>
      <div class="d-kw"><b>Haunt</b> happens when the spirit is destroyed.</div>
      <div class="d-kw"><b>🔵 Ward</b> blocks the next damage. <b>💤 Stunned</b> spirits cannot attack on their next turn.</div>
      ${kwLines(Object.keys(KW))}
      <h3>Wanderers</h3>
      ${Object.values(CLASSES).map(c => `<div class="g-card" style="--aura:#ffb703"><div class="g-art">${art(c.id)}</div><div class="g-body">
        <div class="g-name">${c.name} <span class="bn">${c.bn}</span></div>
        <div class="d-meta"><span class="chip">${c.title}</span><span class="chip hp">♥ ${c.hp}</span></div>
        <div class="g-text"><b>${c.skill.name}</b> — ${skillText(c.id, 1)} ${c.blurb}</div></div></div>`).join('')}
      <h3>Spirits</h3>
      ${all.filter(c => c.type === 'spirit').sort((a, b) => a.cost - b.cost).map(card).join('')}
      <h3>Charms</h3>
      ${all.filter(c => c.type === 'charm').sort((a, b) => a.cost - b.cost).map(card).join('')}
    </div>`);
}

// ───────────────────────── boot ─────────────────────────
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.V && S.V.phase !== 'lobby') layout(); });
fx.startSky();
show('home');

if (net.session) {
  if (urlRoom && urlRoom !== net.session.room) {
    net.leave();
  } else {
    homeErr('Returning to room ' + net.session.room + '…');
    setUrlRoom(net.session.room);
    net.start();
    setTimeout(() => { if (!S.V) homeErr(''); }, 4000);
  }
}
window.__nd = { S, net }; // handy for debugging from the console
