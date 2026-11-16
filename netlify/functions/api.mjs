// Nishir Daak — Netlify Function. Rooms live in Netlify Blobs; every write is
// conditional on the blob's ETag so two simultaneous requests cannot clobber
// each other (the loser re-reads and retries inside handle()).
import { getStore } from '@netlify/blobs';
import { handle } from '../../engine/api.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

// The `netlify dev` sandbox enforces conditional writes but does not return an
// ETag from reads; there we fetch it from a listing instead. Learned once per
// function instance.
let etagViaList = false;

async function listEtag(blobs, code) {
  const { blobs: items } = await blobs.list({ prefix: code });
  const hit = items.find(b => b.key === code);
  return hit ? hit.etag : null;
}

function blobStore() {
  const blobs = getStore({ name: 'nishir-daak-rooms', consistency: 'strong' });
  const read = async code => {
    const r = await blobs.getWithMetadata(code, { type: 'json' });
    return r && r.data ? r : null;
  };
  return {
    async get(code) {
      // When the ETag comes from a listing it must be fetched BEFORE the data:
      // an ETag older than the data only causes a harmless retry, a newer one
      // would let a stale write through.
      let tag = etagViaList ? await listEtag(blobs, code) : null;
      let r = await read(code);
      if (!r) return null;
      if (r.etag) {
        tag = r.etag;
      } else if (!etagViaList) {
        etagViaList = true;
        tag = await listEtag(blobs, code);
        r = await read(code);
        if (!r) return null;
      }
      // `rev` is our own write counter: last-resort check if no ETag exists at all.
      return { state: r.data, etag: { tag, rev: r.data._rev || 0 } };
    },
    async set(code, state, etag) {
      const rev = (etag && etag.rev) || 0;
      state._rev = rev + 1;
      if (etag && etag.tag) {
        const r = await blobs.setJSON(code, state, { onlyIfMatch: etag.tag });
        return !r || r.modified !== false;
      }
      const cur = await blobs.get(code, { type: 'json' });
      if (!cur || (cur._rev || 0) !== rev) return false;
      await blobs.setJSON(code, state);
      return true;
    },
    async create(code, state) {
      state._rev = 1;
      const r = await blobs.setJSON(code, state, { onlyIfNew: true });
      return !r || r.modified !== false;
    },
  };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  try {
    return json(await handle(body, blobStore(), Date.now(), { wait: 1000 }));
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
};

export const config = { path: '/api' };
