/* =========================================================
   api.js · comunicación con Apps Script, caché local y modo ejemplo
   La URL y la clave se guardan solo en este dispositivo (localStorage).
   ========================================================= */
const Api = (function () {
  const K = { url: 'mf.apiUrl', key: 'mf.key', demo: 'mf.demo', cache: 'mf.cache.', options: 'mf.options' };
  const TIMEOUT_MS = 45000;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }

  const cfg = {
    get url() { return get(K.url) || ''; },
    get key() { return get(K.key) || ''; },
    get demo() { return get(K.demo) === '1'; },
    get configured() { return this.demo || (!!this.url && !!this.key); }
  };

  function save(url, key) { set(K.url, url.trim()); set(K.key, key.trim()); set(K.demo, null); }
  function enableDemo() { set(K.demo, '1'); }
  function logout() {
    [K.url, K.key, K.demo, K.options].forEach(function (k) { set(k, null); });
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(K.cache) === 0) localStorage.removeItem(k); });
    } catch (e) { /* nada */ }
  }

  /** Llamada genérica: POST con text/plain (evita preflight CORS en Apps Script). */
  async function call(action, payload, override) {
    if (cfg.demo && !override) return Demo.handle(action, payload || {});
    const url = override ? override.url : cfg.url;
    const key = override ? override.key : cfg.key;
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, key: key }, payload || {})),
        redirect: 'follow',
        signal: ctrl.signal
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError'
        ? 'El servidor tardó demasiado. Inténtalo nuevamente.'
        : 'Sin conexión con tu servidor. Revisa tu internet.');
    } finally {
      clearTimeout(timer);
    }
    let body;
    try { body = await res.json(); } catch (e) {
      throw new Error('Respuesta inesperada del servidor. Revisa que la URL sea la de tu implementación de API.');
    }
    if (!body.ok) {
      const err = new Error(body.error || 'Error del servidor.');
      err.code = body.code;
      throw err;
    }
    return body.data;
  }

  function cacheKey(filters) { return K.cache + (cfg.demo ? 'demo.' : '') + JSON.stringify(filters || {}); }
  function readCache(filters) {
    try { return JSON.parse(get(cacheKey(filters)) || 'null'); } catch (e) { return null; }
  }
  function writeCache(filters, data) {
    try { set(cacheKey(filters), JSON.stringify({ ts: Date.now(), data: data })); } catch (e) { /* lleno */ }
  }

  async function data(filters, force) {
    const d = await call('data', { filters: filters, force: !!force });
    writeCache(filters, d);
    return d;
  }

  async function options(force) {
    if (!force) {
      try {
        const c = JSON.parse(get(K.options) || 'null');
        if (c && Date.now() - c.ts < 6 * 3600 * 1000) return c.data;
      } catch (e) { /* nada */ }
    }
    const o = await call('options');
    set(K.options, JSON.stringify({ ts: Date.now(), data: o }));
    return o;
  }
  function rememberOptions(o) { if (o) set(K.options, JSON.stringify({ ts: Date.now(), data: o })); }
  /** Tras guardar, la próxima vez se piden opciones nuevas (incluye lo aprendido del historial). */
  function forgetOptions() { set(K.options, null); }

  return {
    cfg: cfg, save: save, enableDemo: enableDemo, logout: logout, call: call,
    data: data, readCache: readCache, options: options, rememberOptions: rememberOptions, forgetOptions: forgetOptions,
    ping: function (url, key) { return call('ping', {}, url ? { url: url, key: key } : null); },
    parse: function (text) { return call('parse', { text: text }); },
    saveItems: function (items) { return call('save', { items: items }); }
  };
})();

/* =========================================================
   Modo ejemplo: datos ficticios para probar la app sin conectar nada.
   (Las frases se interpretan con el mismo intérprete local, js/parser.js.)
   ========================================================= */
const Demo = (function () {
  let dataCache = null, optCache = null;
  async function load() {
    if (!dataCache) {
      const r = await Promise.all([fetch('demo/data.json'), fetch('demo/options.json')]);
      dataCache = await r[0].json();
      optCache = await r[1].json();
    }
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function handle(action, payload) {
    await load();
    await wait(action === 'parse' ? 700 : 350);
    switch (action) {
      case 'ping': return { version: 'demo', aiEnabled: false, aiProvider: '' };
      case 'data': return JSON.parse(JSON.stringify(dataCache));
      case 'options': return optCache;
      case 'parse': { const e = new Error('Sin IA en modo ejemplo.'); e.code = 'no_ai'; throw e; }
      case 'save': return { saved: (payload.items || []).length, demo: true };
      default: throw new Error('Acción no disponible en modo ejemplo.');
    }
  }
  return { handle: handle };
})();
