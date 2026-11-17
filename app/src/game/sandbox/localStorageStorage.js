/**
 * Sandbox persistence tools (Phase 4A) — Developer B's own test doubles. These
 * are NOT business logic and NOT A's real modules: they implement the SAME ports
 * the in-memory mocks in repair/ and voyage/ do (load/save, getBalance/execute,
 * getLocalDate), but back their state onto a Web Storage so the playground
 * survives a real browser refresh.
 *
 * createLocalStorageGameStorage: a GameStorage (load/save) over a Web Storage
 * backend — globalThis.localStorage in the browser, an injectable fake in Node
 * tests. Every doc is namespaced, so separate sandboxes never collide. If the
 * backend is missing or throws, it falls back to an in-memory Map and reports
 * isPersistent=false, so a caller can SHOW "not saved" instead of silently
 * pretending a refresh would recover.
 *
 * Interface parity with createMockStorage (repair/mocks.js), all synchronous:
 *   load(key)   -> a fresh copy of the saved object, or null
 *   save(state) -> true; persists under state.key
 */

const ROOT = "frigo.sandbox";

/** Probe a Web Storage-like backend: it must round-trip set/get/remove. */
export function backendWorks(backend) {
  if (!backend) return false;
  try {
    const probe = `${ROOT}.__probe__`;
    backend.setItem(probe, "1");
    const ok = backend.getItem(probe) === "1";
    backend.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

/**
 * @param {{ namespace: string, backend?: object }} opts
 *   backend: a Web Storage (getItem/setItem/removeItem/key/length). Defaults to
 *   globalThis.localStorage. Pass createFakeLocalStorage() in Node tests.
 */
export function createLocalStorageGameStorage({ namespace, backend } = {}) {
  if (!namespace || typeof namespace !== "string") {
    throw new TypeError("sandbox storage: a non-empty string namespace is required");
  }
  const resolved =
    backend ?? (typeof globalThis !== "undefined" ? globalThis.localStorage : null);
  const persistent = backendWorks(resolved);
  const mem = new Map(); // in-memory fallback + hot cache
  const prefix = `${ROOT}:${namespace}:`;
  const keyOf = (k) => prefix + k;

  function load(key) {
    if (persistent) {
      try {
        const raw = resolved.getItem(keyOf(key));
        if (raw != null) return JSON.parse(raw);
      } catch {
        /* fall through to the in-memory copy */
      }
    }
    return mem.has(key) ? structuredClone(mem.get(key)) : null;
  }

  function save(state) {
    const key = (state && state.key) ?? "game.default";
    const snapshot = structuredClone(state);
    mem.set(key, snapshot); // always cache, so a read works even if the write throws
    if (persistent) {
      try {
        resolved.setItem(keyOf(key), JSON.stringify(snapshot));
      } catch {
        /* kept in memory only for this session */
      }
    }
    return true;
  }

  /** Clear every doc in THIS namespace (used by Sandbox Reset). Other namespaces untouched. */
  function reset() {
    mem.clear();
    if (persistent) {
      try {
        const doomed = [];
        for (let i = 0; i < resolved.length; i++) {
          const k = resolved.key(i);
          if (k && k.startsWith(prefix)) doomed.push(k);
        }
        for (const k of doomed) resolved.removeItem(k);
      } catch {
        /* best effort */
      }
    }
  }

  /** The doc keys this namespace currently owns (for inspection / debugging). */
  function keys() {
    if (!persistent) return [...mem.keys()];
    const out = [];
    try {
      for (let i = 0; i < resolved.length; i++) {
        const k = resolved.key(i);
        if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  return { load, save, reset, keys, isPersistent: persistent, namespace };
}

/** A minimal synchronous Web Storage for Node tests (and a last-ditch fallback). */
export function createFakeLocalStorage() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key(i) {
      return [...m.keys()][i] ?? null;
    },
    getItem(k) {
      return m.has(String(k)) ? m.get(String(k)) : null;
    },
    setItem(k, v) {
      m.set(String(k), String(v));
    },
    removeItem(k) {
      m.delete(String(k));
    },
    clear() {
      m.clear();
    },
  };
}

/** A Web Storage whose writes always throw — simulates blocked/unavailable storage. */
export function createBlockedLocalStorage() {
  const boom = () => {
    throw new Error("localStorage is unavailable");
  };
  return {
    get length() {
      return 0;
    },
    key: () => null,
    getItem: boom,
    setItem: boom,
    removeItem: () => {},
    clear: () => {},
  };
}
