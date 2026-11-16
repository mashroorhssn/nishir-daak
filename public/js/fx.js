// Visual effects: everything that flies, floats, shakes or glows.
import { art } from './art.js';

export const wait = ms => new Promise(r => setTimeout(r, ms));
const layer = () => document.getElementById('fx');
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function centerOf(elOrRect) {
  if (!elOrRect) return { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 };
  const r = elOrRect.getBoundingClientRect ? elOrRect.getBoundingClientRect() : elOrRect;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

function node(cls, html = '') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  layer().appendChild(d);
  return d;
}
function place(d, x, y) { d.style.left = x + 'px'; d.style.top = y + 'px'; }
function after(anim, fn) {
  let done = false;
  const go = () => { if (!done) { done = true; fn(); } };
  anim.onfinish = go; anim.oncancel = go;
  setTimeout(go, (anim.effect?.getComputedTiming().endTime || 1000) + 200);
}

/** Floating number / label rising from an element. kind: dmg | heal | buff | debuff | info */
export function float(target, text, kind = 'info') {
  const c = centerOf(target);
  const d = node('fx-float ' + kind, text);
  place(d, c.x + (Math.random() * 14 - 7), c.y - c.h * 0.1);
  const a = d.animate([
    { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%,-90%) scale(1.25)', opacity: 1, offset: 0.18 },
    { transform: 'translate(-50%,-120%) scale(1)', opacity: 1, offset: 0.6 },
    { transform: 'translate(-50%,-190%) scale(.9)', opacity: 0 },
  ], { duration: 1000, easing: 'ease-out' });
  after(a, () => d.remove());
}

export function shake(el, cls = 'shake') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 420);
}

export function screenShake(strong = false) {
  if (reduce()) return;
  const g = document.getElementById('game');
  g.animate([
    { transform: 'translate(0,0)' }, { transform: `translate(${strong ? -9 : -5}px,3px)` },
    { transform: `translate(${strong ? 8 : 4}px,-3px)` }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(0,0)' },
  ], { duration: strong ? 380 : 260, easing: 'ease-out' });
  if (navigator.vibrate) { try { navigator.vibrate(strong ? [30, 40, 60] : 25); } catch { /* ignore */ } }
}

/** Attacker lunges at the target and springs back. Resolves at the moment of impact. */
export async function lunge(aEl, tEl) {
  if (!aEl || !tEl) return;
  const a = centerOf(aEl), t = centerOf(tEl);
  const dx = (t.x - a.x) * 0.72, dy = (t.y - a.y) * 0.72;
  aEl.classList.add('lunging');
  const anim = aEl.animate([
    { transform: 'translate(0,0) scale(1)' },
    { transform: `translate(${-dx * 0.08}px,${-dy * 0.08}px) scale(1.08)`, offset: 0.22 },
    { transform: `translate(${dx}px,${dy}px) scale(1.16)`, offset: 0.52 },
    { transform: 'translate(0,0) scale(1)' },
  ], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)' });
  after(anim, () => aEl.classList.remove('lunging'));
  await wait(270);
  slash(tEl);
}

export function slash(tEl) {
  const c = centerOf(tEl);
  const d = node('fx-slash');
  place(d, c.x, c.y);
  d.style.setProperty('--rot', (Math.random() * 80 - 40) + 'deg');
  setTimeout(() => d.remove(), 360);
}

/** Glowing orb flying from A to B. */
export async function bolt(from, to, color = '#ffd166', dur = 320) {
  const a = centerOf(from), b = centerOf(to);
  const d = node('fx-bolt');
  d.style.setProperty('--c', color);
  place(d, 0, 0);
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.18, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.18 - 20;
  const anim = d.animate([
    { transform: `translate(${a.x}px,${a.y}px) scale(.5)`, opacity: 0.4 },
    { transform: `translate(${mx}px,${my}px) scale(1.2)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${b.x}px,${b.y}px) scale(.8)`, opacity: 1 },
  ], { duration: dur, easing: 'ease-in' });
  after(anim, () => d.remove());
  await wait(dur - 20);
  ring(to, color);
}

export function ring(target, color = '#fff') {
  const c = centerOf(target);
  const d = node('fx-ring');
  d.style.setProperty('--c', color);
  d.style.setProperty('--s', Math.max(40, c.w || 60) + 'px');
  place(d, c.x, c.y);
  setTimeout(() => d.remove(), 620);
}

/** Radial burst of small glowing motes. */
export function burst(target, color = '#e9ff70', n = 10) {
  if (reduce()) n = Math.min(n, 4);
  const c = centerOf(target);
  for (let i = 0; i < n; i++) {
    const d = node('fx-mote');
    d.style.setProperty('--c', color);
    place(d, c.x, c.y);
    const ang = Math.random() * Math.PI * 2, dist = 24 + Math.random() * 46;
    const anim = d.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist - 14}px)) scale(.2)`, opacity: 0 },
    ], { duration: 520 + Math.random() * 380, easing: 'cubic-bezier(.1,.7,.3,1)' });
    after(anim, () => d.remove());
  }
}

/** Fireflies drift from a point to a counter element. */
export async function fireflies(from, toEl, n = 3) {
  const a = centerOf(from), b = centerOf(toEl);
  const count = Math.min(8, Math.max(2, n * 2));
  for (let i = 0; i < count; i++) {
    const d = node('fx-fly');
    place(d, 0, 0);
    const sx = a.x + (Math.random() * 30 - 15), sy = a.y + (Math.random() * 30 - 15);
    const mx = (sx + b.x) / 2 + (Math.random() * 120 - 60), my = (sy + b.y) / 2 + (Math.random() * 90 - 60);
    const anim = d.animate([
      { transform: `translate(${sx}px,${sy}px) scale(.3)`, opacity: 0 },
      { transform: `translate(${sx}px,${sy - 10}px) scale(1.3)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${mx}px,${my}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${b.x}px,${b.y}px) scale(.5)`, opacity: 0.9 },
    ], { duration: 700 + i * 60, delay: i * 45, easing: 'ease-in-out', fill: 'backwards' });
    after(anim, () => d.remove());
  }
  await wait(620);
}

/** Speech bubble above a unit. Non-blocking. */
export function bubble(target, text, cls = '') {
  if (!target) return;
  const c = centerOf(target);
  const d = node('fx-bubble ' + cls);
  d.textContent = text;
  const below = c.y - c.h / 2 < 70;
  d.classList.toggle('below', below);
  const x = Math.max(74, Math.min(innerWidth - 74, c.x));
  place(d, x, below ? c.y + c.h / 2 + 6 : c.y - c.h / 2 - 6);
  d.style.setProperty('--tail', Math.max(-56, Math.min(56, c.x - x)) + 'px');
  const life = Math.min(3200, 1300 + text.length * 38);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 260); }, life);
}

let bannerTimer = 0;
export function banner(text, sub = '', big = false) {
  const b = document.getElementById('banner');
  b.innerHTML = `<div class="bn-main">${text}</div>${sub ? `<div class="bn-sub">${sub}</div>` : ''}`;
  b.className = 'banner show' + (big ? ' big' : '');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, big ? 1250 : 800);
}

let toastTimer = 0;
export function toast(text, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** A charm is shown large in the middle of the table for a moment. */
export async function reveal(card, who) {
  const d = node('fx-reveal', `
    <div class="rv-card" style="--aura:${card.aura}">
      <div class="rv-art">${art(card.id)}</div>
      <div class="rv-name">${card.name}</div>
      <div class="rv-bn">${card.bn}</div>
    </div>
    <div class="rv-who">${who}</div>`);
  place(d, innerWidth / 2, innerHeight * 0.42);
  await wait(720);
  d.classList.add('out');
  setTimeout(() => d.remove(), 320);
  return d.querySelector('.rv-card');
}

/** A face-down card flies between two elements. */
export async function flyCard(fromEl, toEl, faceHtml = '') {
  const a = centerOf(fromEl), b = centerOf(toEl);
  const d = node('fx-card' + (faceHtml ? ' face' : ''), faceHtml);
  place(d, 0, 0);
  const anim = d.animate([
    { transform: `translate(${a.x}px,${a.y}px) translate(-50%,-50%) rotate(-12deg) scale(.6)`, opacity: 0.2 },
    { transform: `translate(${(a.x + b.x) / 2}px,${(a.y + b.y) / 2 - 30}px) translate(-50%,-50%) rotate(8deg) scale(1.1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${b.x}px,${b.y}px) translate(-50%,-50%) rotate(0deg) scale(.5)`, opacity: 0.3 },
  ], { duration: 520, easing: 'ease-in-out' });
  after(anim, () => d.remove());
  await wait(480);
}

/** FLIP: animate an element from an old rect to where it is now. */
export function flip(el, oldRect, dur = 420) {
  if (!el || !oldRect) return;
  const n = el.getBoundingClientRect();
  const dx = oldRect.left - n.left, dy = oldRect.top - n.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  el.animate([
    { transform: `translate(${dx}px,${dy}px) scale(1.08)` },
    { transform: 'translate(0,0) scale(1)' },
  ], { duration: dur, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

// ---- Background: drifting fireflies on a canvas ------------------------------
export function startSky() {
  const cv = document.getElementById('sky');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, flies = [], last = 0;
  const N = reduce() ? 8 : 26;
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn() {
    return { x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6.28, s: 6 + Math.random() * 14, ph: Math.random() * 6.28, r: 1 + Math.random() * 1.6 };
  }
  size();
  flies = Array.from({ length: N }, spawn);
  addEventListener('resize', size);
  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || t - last < 33) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    ctx.clearRect(0, 0, W, H);
    for (const f of flies) {
      f.a += (Math.random() - 0.5) * 0.6;
      f.x += Math.cos(f.a) * f.s * dt; f.y += Math.sin(f.a) * f.s * dt * 0.7;
      f.ph += dt * 1.6;
      if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10;
      if (f.y < -10) f.y = H + 10; if (f.y > H + 10) f.y = -10;
      const glow = 0.25 + 0.75 * Math.max(0, Math.sin(f.ph));
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 7);
      g.addColorStop(0, `rgba(233,255,112,${0.55 * glow})`);
      g.addColorStop(0.3, `rgba(190,240,90,${0.18 * glow})`);
      g.addColorStop(1, 'rgba(190,240,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 7, 0, 6.28); ctx.fill();
    }
  }
  requestAnimationFrame(frame);
}
