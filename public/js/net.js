// Networking: one JSON endpoint, polling (a long-poll on the local server).
const KEY = 'nd_session';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function save(s) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

async function api(body, timeout = 35000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch('/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
      cache: 'no-store',
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error('Bad response from server (' + r.status + ')'); }
  } finally { clearTimeout(t); }
}

export const net = {
  session: load(),      // { room, pid, token, name }
  v: -1, seq: 0,
  onView: () => {}, onGone: () => {}, onConn: () => {},
  _loop: 0, _fails: 0,

  _take(r) {
    if (r && r.view) {
      const fresh = r.view.v !== this.v || r.view.seq !== this.seq;
      this.v = r.view.v; this.seq = r.view.seq;
      if (fresh) this.onView(r.view);
    }
    return r;
  },

  _enter(r, name) {
    if (r.error) return r;
    this.session = { room: r.room, pid: r.pid, token: r.token, name };
    save(this.session);
    this.v = -1; this.seq = 0;
    this._take(r);
    this.start();
    return r;
  },

  async create(name) { return this._enter(await api({ op: 'create', name }), name); },
  async join(room, name) { return this._enter(await api({ op: 'join', room, name }), name); },

  async act(action) {
    const s = this.session;
    if (!s) return { error: 'Not in a room' };
    try {
      return this._take(await api({ op: 'act', room: s.room, pid: s.pid, token: s.token, seq: this.seq, action }, 15000));
    } catch (e) {
      return { error: 'Connection problem — try again' };
    }
  },

  /** Begin (or restart) the poll loop for the current session. */
  start() {
    const id = ++this._loop;
    (async () => {
      while (id === this._loop && this.session) {
        const s = this.session;
        try {
          const r = await api({ op: 'poll', room: s.room, pid: s.pid, token: s.token, v: this.v, seq: this.seq });
          if (id !== this._loop) return;
          if (this._fails) { this._fails = 0; this.onConn(true); }
          if (r.gone) { this.leave(); this.onGone(r.error || 'Room closed'); return; }
          this._take(r);
          let pause = r.error ? 1500 : Math.max(0, Math.min(5000, r.wait | 0)) || 30;
          // On a polling host (Netlify) a backgrounded tab polls less often to save function calls.
          if (pause >= 500 && document.hidden) pause = 4000;
          await sleep(pause);
        } catch (e) {
          if (id !== this._loop) return;
          if (++this._fails === 2) this.onConn(false);
          await sleep(Math.min(5000, 800 * this._fails));
        }
      }
    })();
  },

  leave() {
    this._loop++;
    this.session = null; this.v = -1; this.seq = 0;
    save(null);
  },
};
