import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const swPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/public/sw.js');
const swSource = fs.readFileSync(swPath, 'utf8');

/** Loads sw.js in a sandbox with a fake Service Worker global scope. */
function loadSW({ fetchImpl, existingCaches = {} }) {
  const stores = new Map(Object.entries(existingCaches).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const handlers = {};
  const cachesApi = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name);
      return {
        addAll: async (urls) => urls.forEach((u) => s.set(u, 'precached')),
        put: async (req, res) => s.set(typeof req === 'string' ? req : req.url, res),
      };
    },
    match: async (req) => {
      const key = typeof req === 'string' ? req : req.url;
      for (const s of stores.values()) if (s.has(key)) return s.get(key);
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
  };
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: 'https://app.test' },
  };
  vm.runInNewContext(swSource, { self, caches: cachesApi, fetch: fetchImpl, Response, URL, Promise, console });
  return { handlers, stores };
}

async function doFetch(handlers, url, { method = 'GET', mode = 'cors' } = {}) {
  let responded;
  const event = {
    request: { url, method, mode, clone() { return this; } },
    respondWith: (p) => { responded = p; },
  };
  handlers.fetch(event);
  const result = responded ? await responded : undefined;
  // let the fire-and-forget cache.put settle
  await new Promise((r) => setTimeout(r, 0));
  return { intercepted: responded !== undefined, result };
}

const okRes = () => new Response('body', { status: 200 });

describe('service worker', () => {
  let fetchImpl;
  beforeEach(() => { fetchImpl = vi.fn(async () => okRes()); });

  it('usa un nombre de cache versionado y limpia caches viejos en activate', async () => {
    const { handlers, stores } = loadSW({ fetchImpl, existingCaches: { 'vtsd-v1': {}, 'otra-app': {} } });
    let p;
    handlers.activate({ waitUntil: (x) => { p = x; } });
    await p;
    const names = [...stores.keys()];
    expect(names).not.toContain('vtsd-v1');
  });

  it('install crea el cache versionado', async () => {
    const { handlers, stores } = loadSW({ fetchImpl });
    let p;
    handlers.install({ waitUntil: (x) => { p = x; } });
    await p;
    const [name] = [...stores.keys()];
    expect(name).toMatch(/^vtsd-v\d+/);
    expect(name).not.toBe('vtsd-v1');
  });

  it('no intercepta ni cachea /api/*', async () => {
    const { handlers, stores } = loadSW({ fetchImpl });
    const r = await doFetch(handlers, 'https://app.test/api/inventory/stock?producto=x');
    expect(r.intercepted).toBe(false);
    expect([...stores.values()].every((s) => ![...s.keys()].some((k) => k.includes('/api/')))).toBe(true);
  });

  it('no cachea respuestas no-ok', async () => {
    fetchImpl.mockResolvedValue(new Response('err', { status: 500 }));
    const { handlers, stores } = loadSW({ fetchImpl });
    await doFetch(handlers, 'https://app.test/assets/a.js');
    expect([...stores.values()].some((s) => s.has('https://app.test/assets/a.js'))).toBe(false);
  });

  it('no cachea requests cross-origin', async () => {
    const { handlers, stores } = loadSW({ fetchImpl });
    await doFetch(handlers, 'https://cdn.other.com/lib.js');
    expect([...stores.values()].some((s) => s.has('https://cdn.other.com/lib.js'))).toBe(false);
  });

  it('no cachea metodos distintos de GET', async () => {
    const { handlers, stores } = loadSW({ fetchImpl });
    const r = await doFetch(handlers, 'https://app.test/assets/a.js', { method: 'POST' });
    expect(r.intercepted).toBe(false);
    expect([...stores.values()].some((s) => s.has('https://app.test/assets/a.js'))).toBe(false);
  });

  it('cachea GET same-origin ok', async () => {
    const { handlers, stores } = loadSW({ fetchImpl });
    await doFetch(handlers, 'https://app.test/assets/a.js');
    expect([...stores.values()].some((s) => s.has('https://app.test/assets/a.js'))).toBe(true);
  });
});
