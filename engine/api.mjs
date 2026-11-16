// Nishir Daak — transport-agnostic request handler (see protocol.md).
// `store` hides where rooms live (memory for the local server, Blobs on Netlify):
//   get(code)              -> { state, etag } | null
//   set(code, state, etag) -> boolean   (false = someone else wrote first)
//   create(code, state)    -> boolean   (false = code already taken)
import { newRoom, joinRoom, act, tick, touch, viewFor, cleanName } from './engine.mjs';

const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const RETRIES = 6;

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
  return s;
}

export function cleanCode(code) {
  const s = String(code == null ? '' : code).toUpperCase().replace(/[^A-Z]/g, '');
  return s.length === 4 && [...s].every(ch => CODE_ABC.includes(ch)) ? s : null;
}

const GONE = { error: 'This room no longer exists', gone: true };

function auth(state, body) {
  const pl = state.players.find(p => p.id === body.pid);
  return pl && typeof body.token === 'string' && pl.token === body.token ? pl : null;
}

/**
 * @param body  parsed JSON request
 * @param store room storage (see top of file)
 * @param now   ms timestamp
 * @param opts  { wait } ms the client should sleep between polls (0 = long-poll server)
 */
export async function handle(body, store, now = Date.now(), opts = {}) {
  const wait = opts.wait == null ? 1000 : opts.wait;
  if (!body || typeof body !== 'object') return { error: 'Bad request' };

  if (body.op === 'create') {
    for (let i = 0; i < 12; i++) {
      const code = makeCode();
      const { state, pid, token } = newRoom(code, cleanName(body.name), now);
      if (await store.create(code, state)) return { room: code, pid, token, view: viewFor(state, pid, 0, now) };
    }
    return { error: 'Could not create a room, try again' };
  }

  const code = cleanCode(body.room);
  if (!code) return { error: 'Room codes are 4 letters', gone: true };

  if (body.op === 'join') {
    for (let i = 0; i < RETRIES; i++) {
      const got = await store.get(code);
      if (!got) return { error: 'No room with that code', gone: true };
      const { state, etag } = got;
      tick(state, now);
      const r = joinRoom(state, cleanName(body.name), now);
      if (r.error) return { error: r.error };
      if (await store.set(code, state, etag)) return { room: code, pid: r.pid, token: r.token, view: viewFor(state, r.pid, 0, now) };
    }
    return { error: 'Busy, try again' };
  }

  if (body.op === 'poll') {
    let got = null;
    for (let i = 0; i < 3; i++) {
      got = await store.get(code);
      if (!got) return GONE;
      if (!auth(got.state, body)) return { error: 'You are not in this room', gone: true };
      const dirtyA = touch(got.state, body.pid, now);
      const dirtyB = tick(got.state, now);
      if (!dirtyA && !dirtyB) break;
      if (await store.set(code, got.state, got.etag)) break;
      got = null; // conflict: someone else advanced the room, re-read
    }
    if (!got) {
      got = await store.get(code);
      if (!got) return GONE;
      if (!auth(got.state, body)) return { error: 'You are not in this room', gone: true };
    }
    if (got.state.v === body.v) return { same: true, wait };
    return { view: viewFor(got.state, body.pid, body.seq, now), wait };
  }

  if (body.op === 'act') {
    for (let i = 0; i < RETRIES; i++) {
      const got = await store.get(code);
      if (!got) return GONE;
      const { state, etag } = got;
      if (!auth(state, body)) return { error: 'You are not in this room', gone: true };
      const before = state.v;
      touch(state, body.pid, now);
      const r = act(state, body.pid, body.action, now);
      if (r.error) {
        // Nothing game-relevant changed; a failed save of lastSeen is harmless.
        if (state.v !== before) await store.set(code, state, etag);
        return { error: r.error, view: viewFor(state, body.pid, body.seq, now) };
      }
      if (await store.set(code, state, etag)) {
        const still = state.players.some(p => p.id === body.pid);
        return still ? { ok: true, view: viewFor(state, body.pid, body.seq, now) } : { ok: true, gone: true };
      }
    }
    return { error: 'Busy, try again' };
  }

  return { error: 'Unknown op' };
}

/** Simple in-memory store (local server and tests). `onChange(code, state)` fires after every write. */
export function memoryStore(onChange) {
  const rooms = new Map();
  return {
    rooms,
    async get(code) {
      const state = rooms.get(code);
      return state ? { state, etag: null } : null;
    },
    async set(code, state) {
      rooms.set(code, state);
      if (onChange) onChange(code, state);
      return true;
    },
    async create(code, state) {
      if (rooms.has(code)) return false;
      rooms.set(code, state);
      if (onChange) onChange(code, state);
      return true;
    },
  };
}
