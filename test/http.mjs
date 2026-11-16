// Nishir Daak — live HTTP smoke test against a running server.
//   node test/http.mjs [baseUrl]      (default http://localhost:8080)
// Works against `node server.mjs` and against `netlify dev` / a deployed site.
import assert from 'node:assert/strict';

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const api = async body => {
  const r = await fetch(BASE + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(r.status, 200, 'api status');
  return r.json();
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// static files
for (const [p, type] of [['/', 'text/html'], ['/js/cards.js', 'javascript']]) {
  const r = await fetch(BASE + p);
  if (r.status === 404 && p === '/') { console.log('  (no index.html yet — static check skipped for /)'); continue; }
  assert.equal(r.status, 200, p);
  assert.ok(r.headers.get('content-type').includes(type), `${p} content-type ${r.headers.get('content-type')}`);
}
assert.equal((await fetch(BASE + '/nope.txt')).status, 404);
const trav = await fetch(BASE + '/..%2f..%2fpackage.json');
assert.ok(trav.status === 403 || trav.status === 404 || !(await trav.text()).includes('nishir-daak'), 'path traversal blocked');
assert.equal((await fetch(BASE + '/api')).status, 405, 'GET /api rejected');
console.log('static + method checks ok');

// lobby
const a = await api({ op: 'create', name: 'Host' });
assert.ok(a.room && a.pid && a.token && a.view.phase === 'lobby');
const A = { room: a.room, pid: a.pid, token: a.token };
const b = await api({ op: 'join', room: a.room, name: 'Guest' });
const B = { room: a.room, pid: b.pid, token: b.token };
assert.equal(b.view.players.length, 2);
assert.ok((await api({ op: 'poll', ...B, token: 'x', v: 0, seq: 0 })).gone);

// poll semantics: an unchanged poll either long-polls (local) or returns same+wait (Netlify)
let v = (await api({ op: 'poll', ...B, v: -1, seq: 0 })).view.v;
const t0 = Date.now();
const pending = api({ op: 'poll', ...B, v, seq: 0 });
await sleep(700);
await api({ op: 'act', ...A, action: { type: 'class', cls: 'baul' } });
let res = await pending;
const took = Date.now() - t0;
if (res.same) {
  assert.ok(res.wait > 0, 'short-poll server must tell the client to wait');
  res = await api({ op: 'poll', ...B, v, seq: 0 });
  console.log(`short-poll server (wait ${res.wait} ms)`);
} else {
  assert.ok(took >= 600 && took < 5000, `long-poll should be woken by the other request (took ${took} ms)`);
  console.log(`long-poll woken after ${took} ms`);
}
assert.equal(res.view.players.find(p => p.id === A.pid).cls, 'baul');

// a whole game: host + guest idle (turn timer 45 s is too slow) -> use bots and watch
await api({ op: 'act', ...A, action: { type: 'kick', pid: B.pid } });
assert.ok((await api({ op: 'poll', ...B, v: 0, seq: 0 })).gone, 'kicked player is gone');
await api({ op: 'act', ...A, action: { type: 'addBot' } });
await api({ op: 'act', ...A, action: { type: 'addBot' } });
await api({ op: 'act', ...A, action: { type: 'settings', goal: 7, timer: 0 } });
let view = (await api({ op: 'act', ...A, action: { type: 'start' } })).view;
assert.equal(view.phase, 'play');
let seq = view.seq, turns = 0, events = 0;
v = view.v;
const until = Date.now() + 45000;
const take = vw => {
  view = vw; v = view.v;
  for (const e of view.events) { assert.ok(e.seq > seq, 'events arrive in order, once'); seq = e.seq; events++; if (e.t === 'turn') turns++; }
};
while (Date.now() < until && turns < 4) {
  if (view.turn === A.pid) {
    const me = view.players.find(p => p.id === A.pid);
    assert.ok(Array.isArray(me.hand) && view.players.every(p => p.id === A.pid || !('hand' in p)));
    const end = await api({ op: 'act', ...A, seq, action: { type: 'end' } });
    assert.ok(end.ok, end.error);
    take(end.view);
    continue;
  }
  const r = await api({ op: 'poll', ...A, v, seq });
  if (!r.same) take(r.view);
  if (r.wait) await sleep(r.wait);
}
assert.ok(turns >= 4, `bots should take their turns on their own (saw ${turns} turn events)`);
console.log(`game running: ${turns} turns, ${events} events streamed, round ${view.round}`);
console.log('HTTP smoke test passed.');
