/**
 * Code.gs
 * Punto de entrada de la Web App, funciones expuestas al frontend, caché y triggers.
 */

/**
 * Sirve el dashboard web clásico.
 * Si este proyecto también está publicado para "Cualquier persona" (API de la app),
 * el dashboard solo se muestra al dueño; los demás reciben un aviso.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return json_({ ok: false, error: 'Usa POST para la API.' });
  }
  try {
    assertAuthorized_();
  } catch (err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">No autorizado.</p>').setTitle('Mis Finanzas');
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Mis Finanzas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png');
}

/** Permite incluir Styles.html, JavaScript.html, etc. dentro de Index.html. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ------------------------------------------------------------------ */
/* API pública (llamada con google.script.run)                         */
/* ------------------------------------------------------------------ */

/**
 * Única llamada que necesita el dashboard. Devuelve { ok, data } o { ok:false, error }.
 * @param {Object} filters  { year, month, cuenta, grupo, tipo }
 * @param {boolean} forceRefresh  true = ignorar caché y releer el Sheet
 */
function getDashboardData(filters, forceRefresh) {
  return apiCall_(function () {
    if (forceRefresh) invalidateCache();
    const cache = CacheService.getScriptCache();
    const key = cacheKey_('dash', filters);
    const hit = cache.get(key);
    if (hit) {
      const cached = JSON.parse(hit);
      cached.meta.fromCache = true;
      return cached;
    }
    const result = buildDashboard_(loadDataset_(), filters);
    putCache_(cache, key, result);
    return result;
  });
}

/* ------------------------------------------------------------------ */
/* Caché                                                               */
/* ------------------------------------------------------------------ */

/** Dataset normalizado con caché propia: cambiar un filtro no relee el Sheet. */
function loadDataset_() {
  const cache = CacheService.getScriptCache();
  const key = cacheKey_('dataset', null);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const dataset = loadDatasetFromSheets_();
  putCache_(cache, key, dataset);
  return dataset;
}

function cacheVersion_() {
  return PropertiesService.getScriptProperties().getProperty('CACHE_VERSION') || '1';
}

function cacheKey_(prefix, obj) {
  const raw = prefix + '|' + cacheVersion_() + '|' + JSON.stringify(obj || {});
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return prefix + '_' + Utilities.base64EncodeWebSafe(digest);
}

/** CacheService admite ~100 KB por clave; si no cabe, simplemente no se guarda. */
function putCache_(cache, key, value) {
  try {
    cache.put(key, JSON.stringify(value), CONFIG.CACHE_SECONDS);
  } catch (e) {
    console.warn('No se pudo guardar en caché: ' + e.message);
  }
}

/** Invalida toda la caché subiendo el número de versión. */
function invalidateCache() {
  const props = PropertiesService.getScriptProperties();
  const v = parseInt(props.getProperty('CACHE_VERSION') || '1', 10) + 1;
  props.setProperty('CACHE_VERSION', String(v));
}

/* ------------------------------------------------------------------ */
/* Triggers: invalidan la caché al registrar o editar datos            */
/* ------------------------------------------------------------------ */

/** Ejecutar UNA vez desde el editor para instalar los triggers. */
function setupTriggers() {
  const ss = getSpreadsheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onDataChange') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onDataChange').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onDataChange').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onDataChange').forSpreadsheet(ss).onChange().create();
  console.log('Triggers instalados correctamente.');
}

function onDataChange() {
  invalidateCache();
}

/* ------------------------------------------------------------------ */
/* Seguridad y manejo de errores                                       */
/* ------------------------------------------------------------------ */

/**
 * Solo el dueño del script (o los correos de CONFIG.ALLOWED_EMAILS) puede usar el dashboard web.
 * Protege también el caso en que el proyecto se publique para "Cualquier persona" por la API.
 */
function assertAuthorized_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const allowed = CONFIG.ALLOWED_EMAILS.map(function (e) { return e.toLowerCase(); });
  if (email && (email === owner || allowed.indexOf(email) >= 0)) return;
  throw new AppError('No tienes permiso para ver este dashboard.');
}

/** Envuelve cada llamada: errores técnicos al log, mensaje claro al usuario. */
function apiCall_(fn) {
  try {
    assertAuthorized_();
    return { ok: true, data: fn() };
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    return {
      ok: false,
      error: e && e.userMessage
        ? e.userMessage
        : 'No se pudieron actualizar los datos. Verifica tu conexión e inténtalo nuevamente.'
    };
  }
}

/* ------------------------------------------------------------------ */
/* Diagnóstico (ejecutar desde el editor y revisar el registro)        */
/* ------------------------------------------------------------------ */

function diagnostico() {
  const ss = getSpreadsheet_();
  console.log('Pestañas: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(' | '));
  Object.keys(CONFIG.SHEETS).forEach(function (k) {
    const sh = findSheet_(ss, CONFIG.SHEETS[k]);
    if (!sh) { console.log(k + ': NO ENCONTRADA'); return; }
    const t = readTable_(sh, CONFIG.HEADERS[k]);
    console.log(k + ' → "' + sh.getName() + '" · encabezados en fila ' + t.headerRow +
      ' · ' + t.rows.length + ' filas · columnas faltantes: ' + (t.missing.join(', ') || 'ninguna'));
  });
  const dataset = loadDatasetFromSheets_();
  const data = buildDashboard_(dataset, {});
  console.log('Movimientos válidos: ' + dataset.movements.length);
  console.log('Periodo: ' + data.meta.periodLabel + ' · Ingresos ' + data.kpis.income.value +
    ' · Gastos ' + data.kpis.expenses.value + ' · Flujo ' + data.kpis.net.value);
  console.log('Saldos: Banco ' + data.balances.current.banco + ' · Efectivo ' + data.balances.current.efectivo);
  dataset.warnings.forEach(function (w) { console.log('AVISO: ' + w); });
}
