/**
 * Api.gs
 * API JSON para la app móvil (alojada en GitHub Pages).
 *
 * Todas las llamadas son POST con cuerpo JSON (Content-Type: text/plain para evitar preflight CORS):
 *   { action: 'ping' | 'data' | 'options' | 'parse' | 'save', key: '<clave personal>', ... }
 *
 * Seguridad:
 *   - Cada llamada exige la clave personal guardada en Propiedades del script (APP_KEY).
 *   - Las API keys de IA (GEMINI_API_KEY o ANTHROPIC_API_KEY) viven solo en Propiedades del script.
 *   - La app interpreta frases sin IA (reglas); la IA solo se usa como respaldo, si está configurada.
 *   - Tras varios intentos fallidos de clave se bloquea temporalmente.
 *
 * Los movimientos se guardan enviando una respuesta real a tu Google Form, así entran
 * validados con las mismas opciones y llegan a la hoja como cualquier respuesta.
 */

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida.' });
  }
  return json_(handleApi_(req));
}

/** Enruta una solicitud ya parseada. Devuelve { ok, data } o { ok:false, error, code }. */
function handleApi_(req) {
  try {
    checkAppKey_(req.key);
    switch (req.action) {
      case 'ping':
        return { ok: true, data: { version: CONFIG.API.VERSION, aiEnabled: !!aiProvider_(), aiProvider: aiProvider_() } };
      case 'data':
        return { ok: true, data: getDashboardForApi_(req.filters || {}, !!req.force) };
      case 'options':
        return { ok: true, data: getEntryOptions_() };
      case 'parse':
        return { ok: true, data: parseMovementsText_(req.text, req.today) };
      case 'save':
        return { ok: true, data: saveMovements_(req.items) };
      default:
        throw new AppError('Acción no reconocida.');
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return {
      ok: false,
      code: err && err.code ? err.code : 'error',
      error: err && err.userMessage ? err.userMessage : 'Ocurrió un error en el servidor. Inténtalo nuevamente.'
    };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Seguridad                                                           */
/* ------------------------------------------------------------------ */

function getSecret_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

/** Comparación en tiempo constante para no filtrar información por tiempos de respuesta. */
function safeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function checkAppKey_(key) {
  const expected = getSecret_('APP_KEY');
  if (!expected) {
    throw withCode_(new AppError('La API aún no está configurada. Ejecuta configurarApp() en el editor de Apps Script.'), 'not_configured');
  }
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get('api_fails') || '0', 10);
  if (fails >= CONFIG.API.MAX_FAILED_KEYS) {
    throw withCode_(new AppError('Demasiados intentos fallidos. Espera 10 minutos.'), 'locked');
  }
  if (!safeEquals_(key, expected)) {
    cache.put('api_fails', String(fails + 1), 600);
    throw withCode_(new AppError('Clave personal incorrecta.'), 'bad_key');
  }
}

function withCode_(err, code) { err.code = code; return err; }

/**
 * Ejecutar UNA vez desde el editor: crea tu clave personal (si no existe) y revisa la configuración.
 * La clave aparece en el Registro de ejecución; cópiala en la app.
 */
function configurarApp() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('APP_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('APP_KEY', key);
    console.log('Clave personal creada.');
  }
  console.log('Tu clave personal para la app: ' + key);
  const provider = aiProvider_();
  console.log(provider
    ? 'IA de respaldo: ' + (provider === 'gemini' ? 'Gemini (' + geminiModel_() + ')' : 'Claude (' + CONFIG.API.MODEL + ')')
    : 'IA de respaldo: desactivada (la app interpreta con reglas). Para activarla agrega GEMINI_API_KEY en Propiedades del script.');
  const opts = getEntryOptions_(true);
  console.log('Form encontrado. Tipos: ' + opts.tipos.join(', '));
  console.log('Medios: ' + opts.medios.join(', '));
  console.log('Categorías de gasto: ' + opts.categoriasGasto.map(function (c) { return c.name; }).join(', '));
  console.log('Categorías de ingreso: ' + opts.categoriasIngreso.map(function (c) { return c.name; }).join(', '));
  console.log('Pregunta "Descripción" en el Form: ' + (opts.hasDescripcion ? 'sí' : 'NO (la descripción no se guardará)'));
  console.log('Pregunta "Fecha del movimiento" en el Form: ' + (opts.hasFecha ? 'sí' : 'NO (todo se guardará con la fecha de hoy)'));
}

/**
 * Ejecutar UNA vez: agrega al Form las preguntas opcionales "Descripción" (respuesta corta)
 * y "Fecha del movimiento" (fecha), justo después de "Medio". No modifica las preguntas existentes.
 */
function agregarPreguntasOpcionales() {
  const form = getLinkedForm_();
  const fi = findFormItems_(form);
  const anchorItem = fi.medio || fi.monto;
  let pos = anchorItem ? anchorItem.getIndex() + 1 : form.getItems().length;
  if (!fi.descripcion) {
    const d = form.addTextItem().setTitle('Descripción')
      .setHelpText('Opcional: lugar o detalle (ej. Plaza Vea, Yape, regalo tío)').setRequired(false);
    form.moveItem(d.getIndex(), pos);
    pos++;
    console.log('Pregunta "Descripción" agregada.');
  } else {
    pos = fi.descripcion.getIndex() + 1;
    console.log('La pregunta "Descripción" ya existía.');
  }
  if (!fi.fecha) {
    const f = form.addDateItem().setTitle('Fecha del movimiento')
      .setHelpText('Opcional: solo si el movimiento no es de hoy').setRequired(false);
    form.moveItem(f.getIndex(), pos);
    console.log('Pregunta "Fecha del movimiento" agregada.');
  } else {
    console.log('La pregunta "Fecha del movimiento" ya existía.');
  }
  invalidateCache();
}

/** Prueba la API desde el editor (usa la clave guardada; no la muestra). */
function probarApi() {
  const key = getSecret_('APP_KEY');
  const ping = handleApi_({ action: 'ping', key: key });
  console.log('ping: ' + JSON.stringify(ping));
  const opts = handleApi_({ action: 'options', key: key });
  if (!opts.ok) { console.log('options: ' + opts.error); return; }
  console.log('Categorías aprendidas por descripción: ' + Object.keys(opts.data.learned.descs).length +
    ' · palabras: ' + Object.keys(opts.data.learned.words).length +
    ' · medio habitual: ' + JSON.stringify(opts.data.learned.medioByCat));
  console.log('OPCIONES ' + JSON.stringify({
    tipos: opts.data.tipos, medios: opts.data.medios, tiposInternos: opts.data.tiposInternos,
    categoriasGasto: opts.data.categoriasGasto, categoriasIngreso: opts.data.categoriasIngreso,
    categoriasInternas: opts.data.categoriasInternas, hasDescripcion: opts.data.hasDescripcion, hasFecha: opts.data.hasFecha
  }));
  const data = handleApi_({ action: 'data', key: key, filters: {} });
  if (!data.ok) { console.log('data: ' + data.error); return; }
  const d = data.data;
  console.log(d.meta.periodLabel + ' · ingresos ' + d.kpis.income.value + ' · gastos ' + d.kpis.expenses.value +
    ' · proyección ' + (d.pace && d.pace.projection) + ' · libre ' + (d.kpis.free && d.kpis.free.value));
  console.log('Tamaño de la respuesta: ' + Math.round(JSON.stringify(data).length / 1024) + ' KB');
}

/** Genera una clave nueva (por ejemplo, si perdiste el celular). La anterior deja de funcionar. */
function regenerarClaveApp() {
  PropertiesService.getScriptProperties().deleteProperty('APP_KEY');
  configurarApp();
}

/* ------------------------------------------------------------------ */
/* Datos                                                               */
/* ------------------------------------------------------------------ */

/** Mismos datos que el dashboard, con caché compartida. */
function getDashboardForApi_(filters, force) {
  if (force) invalidateCache();
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
}

/* ------------------------------------------------------------------ */
/* Opciones del Form                                                   */
/* ------------------------------------------------------------------ */

function getLinkedForm_() {
  const ss = getSpreadsheet_();
  const url = ss.getFormUrl();
  if (!url) throw new AppError('Tu Google Sheets no tiene un Form vinculado.');
  return FormApp.openByUrl(url);
}

/** Encuentra las preguntas del Form por título. */
function findFormItems_(form) {
  const items = form.getItems();
  const found = {};
  Object.keys(CONFIG.FORM_ITEMS).forEach(function (field) {
    const wanted = CONFIG.FORM_ITEMS[field].map(normalizeText);
    for (let w = 0; w < wanted.length && !found[field]; w++) {
      for (let i = 0; i < items.length; i++) {
        if (normalizeText(items[i].getTitle()) === wanted[w]) { found[field] = items[i]; break; }
      }
    }
  });
  return found;
}

/** Opciones de una pregunta de selección (vacío si es de texto). */
function itemChoices_(item) {
  if (!item) return [];
  const t = item.getType();
  if (t === FormApp.ItemType.MULTIPLE_CHOICE) return item.asMultipleChoiceItem().getChoices().map(function (c) { return c.getValue(); });
  if (t === FormApp.ItemType.LIST) return item.asListItem().getChoices().map(function (c) { return c.getValue(); });
  if (t === FormApp.ItemType.CHECKBOX) return item.asCheckboxItem().getChoices().map(function (c) { return c.getValue(); });
  return [];
}

/**
 * Opciones válidas para registrar movimientos: tipos, categorías (con grupo), medios.
 * Se cachean 10 minutos (leer el Form toma ~1 s).
 */
function getEntryOptions_(force) {
  const cache = CacheService.getScriptCache();
  const key = cacheKey_('options', null);
  if (!force) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const form = getLinkedForm_();
  const items = findFormItems_(form);
  ['tipo', 'categoria', 'monto'].forEach(function (f) {
    if (!items[f]) throw new AppError('No encontré la pregunta "' + CONFIG.FORM_ITEMS[f][0] + '" en tu Form.');
  });

  const catalog = loadDataset_().catalog;
  const tipos = itemChoices_(items.tipo);
  const medios = itemChoices_(items.medio);
  const catChoices = itemChoices_(items.categoria);
  const incomeChoices = itemChoices_(items.categoriaIngreso);

  function describe(name) {
    const entry = catalog[normalizeText(name)];
    return { name: name, grupo: entry ? entry.group : 'Sin grupo', tipo: entry ? entry.type : 'gasto' };
  }
  const allCats = catChoices.map(describe);
  const categoriasIngreso = (incomeChoices.length ? incomeChoices.map(describe) : allCats.filter(function (c) { return c.tipo === 'ingreso'; }));
  const categoriasGasto = allCats.filter(function (c) { return c.tipo === 'gasto'; });
  const internas = allCats.filter(function (c) { return c.tipo === 'interno'; });

  const opts = {
    learned: learnFromHistory_(),
    aiProvider: aiProvider_(),
    tipos: tipos,
    tiposInternos: tipos.map(function (t) { return { label: t, kind: resolveMovementType_(t) }; }),
    medios: medios,
    categoriasGasto: categoriasGasto,
    categoriasIngreso: categoriasIngreso,
    categoriasInternas: internas,
    hasDescripcion: !!items.descripcion,
    hasFecha: !!items.fecha,
    separateIncomeCategory: !!items.categoriaIngreso
  };
  putCache_(cache, key, opts);
  return opts;
}

/* ------------------------------------------------------------------ */
/* Aprendizaje del historial (para el intérprete local de la app)      */
/* ------------------------------------------------------------------ */

const STOPWORDS_ = ['de', 'del', 'la', 'el', 'los', 'las', 'con', 'en', 'para', 'por', 'un', 'una', 'mi', 'mis', 'y', 'a', 'al', 'que', 'se'];

/**
 * Resume tu historial para que la app sugiera sin IA:
 *   descs:      descripción completa → categoría       ("plaza vea" → Comida)
 *   words:      palabra → { c: categoría, n: veces, p: pureza }
 *   medioByCat: categoría → medio habitual (si lo usas ≥ 75% de las veces y al menos 3 veces)
 */
function learnFromHistory_() {
  const dataset = loadDataset_();
  const since = now_().getTime() - CONFIG.API.LEARN_MONTHS * 31 * 86400000;
  const descs = {}, words = {}, medios = {};
  dataset.movements.forEach(function (m) {
    if (m.date < since || m.excluded || !m.categoria || (m.tipo !== 'gasto' && m.tipo !== 'ingreso')) return;
    const mc = medios[m.categoria] || (medios[m.categoria] = {});
    mc[m.medio] = (mc[m.medio] || 0) + 1;
    const d = normalizeText(m.descripcion);
    if (!d) return;
    const dc = descs[d] || (descs[d] = {});
    dc[m.categoria] = (dc[m.categoria] || 0) + 1;
    d.split(' ').forEach(function (w) {
      if (w.length < 3 || STOPWORDS_.indexOf(w) >= 0 || /^\d/.test(w)) return;
      const wc = words[w] || (words[w] = {});
      wc[m.categoria] = (wc[m.categoria] || 0) + 1;
    });
  });
  function top(counts) {
    let best = null, total = 0;
    Object.keys(counts).forEach(function (k) { total += counts[k]; if (!best || counts[k] > counts[best]) best = k; });
    return { c: best, n: counts[best], p: Math.round(counts[best] / total * 100) / 100 };
  }
  const outDescs = {}, outWords = {}, outMedios = {};
  Object.keys(descs).slice(0, 400).forEach(function (d) { const t = top(descs[d]); if (t.p >= 0.6) outDescs[d] = t.c; });
  Object.keys(words).map(function (w) { const t = top(words[w]); t.w = w; return t; })
    .filter(function (t) { return t.p >= 0.6; })
    .sort(function (a, b) { return b.n - a.n; }).slice(0, 400)
    .forEach(function (t) { outWords[t.w] = { c: t.c, n: t.n, p: t.p }; });
  Object.keys(medios).forEach(function (c) { const t = top(medios[c]); if (t.n >= 3 && t.p >= 0.75 && t.c !== 'Sin medio') outMedios[c] = t.c; });
  return { descs: outDescs, words: outWords, medioByCat: outMedios };
}

/* ------------------------------------------------------------------ */
/* Interpretar texto con IA (respaldo)                                 */
/* ------------------------------------------------------------------ */

const DIAS_SEMANA_ = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Proveedor de IA disponible según las claves configuradas ('gemini', 'anthropic' o ''). */
function aiProvider_() {
  if (getSecret_('GEMINI_API_KEY')) return 'gemini';
  if (getSecret_('ANTHROPIC_API_KEY')) return 'anthropic';
  return '';
}

function geminiModel_() {
  return getSecret_('GEMINI_MODEL') || CONFIG.API.GEMINI_MODEL;
}

/**
 * Convierte una frase ("almuerzo 25 con yape y taxi 12 en efectivo") en movimientos estructurados con IA.
 * La app solo llama aquí cuando sus reglas locales no entendieron la frase.
 */
function parseMovementsText_(text, clientToday) {
  text = String(text || '').trim();
  if (!text) throw new AppError('No recibí ningún texto para interpretar.');
  if (text.length > CONFIG.API.MAX_TEXT_CHARS) throw new AppError('El texto es muy largo. Divide los movimientos en varios mensajes.');
  const provider = aiProvider_();
  if (!provider) throw withCode_(new AppError('La IA de respaldo no está configurada.'), 'no_ai');

  const opts = getEntryOptions_();
  const today = now_();
  const todayIso = Utilities.formatDate(today, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const prompt = buildParserPrompt_(opts, todayIso, DIAS_SEMANA_[today.getDay()], provider);
  const raw = provider === 'gemini' ? callGemini_(prompt, text) : callAnthropic_(prompt, text, opts);

  const items = (raw.movimientos || []).slice(0, CONFIG.API.MAX_ITEMS_PER_SAVE).map(function (m) {
    const it = sanitizeItem_(m, opts, todayIso);
    it.source = provider;
    return it;
  });
  return { items: items, nota: raw.nota || '', options: opts, today: todayIso, provider: provider };
}

/** Gemini (Google AI Studio) con salida JSON estructurada. */
function callGemini_(prompt, text) {
  const schema = {
    type: 'OBJECT',
    properties: {
      movimientos: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            tipo: { type: 'STRING' },
            categoria: { type: 'STRING' },
            monto: { type: 'NUMBER' },
            medio: { type: 'STRING' },
            fecha: { type: 'STRING', description: 'YYYY-MM-DD' },
            descripcion: { type: 'STRING' }
          },
          required: ['tipo', 'categoria', 'monto', 'medio', 'fecha', 'descripcion']
        }
      },
      nota: { type: 'STRING' }
    },
    required: ['movimientos']
  };
  const body = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: 'user', parts: [{ text: text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0, maxOutputTokens: CONFIG.API.MAX_TOKENS }
  };
  const res = UrlFetchApp.fetch(CONFIG.API.GEMINI_URL + encodeURIComponent(geminiModel_()) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': getSecret_('GEMINI_API_KEY') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = res.getResponseCode();
  let payload = {};
  try { payload = JSON.parse(res.getContentText()); } catch (e) { /* no JSON */ }
  if (status !== 200) {
    const msg = (payload.error && payload.error.message) || '';
    console.error('Gemini ' + status + ': ' + msg);
    if (/api key/i.test(msg) || status === 401) throw new AppError('La API key de Gemini no es válida. Revísala en Propiedades del script.');
    if (status === 404) throw new AppError('El modelo de Gemini configurado no existe. Revisa la propiedad GEMINI_MODEL.');
    if (status === 429) throw new AppError('Llegaste al límite de uso de Gemini por ahora. Intenta más tarde o completa a mano.');
    if (status === 403) throw new AppError('Gemini rechazó la solicitud. Revisa que la API key sea de Google AI Studio.');
    if (status >= 500) throw new AppError('Gemini está ocupado. Intenta en unos segundos.');
    throw new AppError('Gemini no pudo interpretar el texto.');
  }
  const cand = (payload.candidates || [])[0];
  const part = cand && cand.content && cand.content.parts && cand.content.parts[0];
  try {
    return JSON.parse(part && part.text ? part.text : '{"movimientos":[]}');
  } catch (e) {
    console.error('Gemini devolvió JSON inválido: ' + (part && part.text));
    return { movimientos: [] };
  }
}

/** Claude (Anthropic) con tool use forzado. */
function callAnthropic_(prompt, text, opts) {
  const body = {
    model: CONFIG.API.MODEL,
    max_tokens: CONFIG.API.MAX_TOKENS,
    system: prompt,
    tools: [buildParserTool_(opts)],
    tool_choice: { type: 'tool', name: 'registrar_movimientos' },
    messages: [{ role: 'user', content: text }]
  };
  const res = UrlFetchApp.fetch(CONFIG.API.ANTHROPIC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': getSecret_('ANTHROPIC_API_KEY'), 'anthropic-version': CONFIG.API.ANTHROPIC_VERSION },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const status = res.getResponseCode();
  let payload = {};
  try { payload = JSON.parse(res.getContentText()); } catch (e) { /* no JSON */ }
  if (status !== 200) {
    const msg = (payload.error && payload.error.message) || '';
    console.error('Anthropic ' + status + ': ' + msg);
    if (status === 401) throw new AppError('La API key de Anthropic no es válida. Revísala en Propiedades del script.');
    if (/credit|billing|balance/i.test(msg)) throw new AppError('Tu cuenta de Anthropic no tiene crédito. Recarga en console.anthropic.com.');
    if (status === 429 || status === 529 || status >= 500) throw new AppError('El servicio de IA está ocupado. Intenta en unos segundos.');
    throw new AppError('No se pudo interpretar el texto. Intenta escribirlo de otra forma.');
  }
  const block = (payload.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
  return block && block.input ? block.input : { movimientos: [] };
}

function buildParserPrompt_(opts, todayIso, weekday, provider) {
  const gastos = opts.categoriasGasto.map(function (c) { return c.name + ' (' + c.grupo + ')'; }).join(', ');
  const ingresos = opts.categoriasIngreso.map(function (c) { return c.name; }).join(', ');
  const internas = opts.categoriasInternas.map(function (c) { return c.name; }).join(', ');
  const tipos = opts.tiposInternos.map(function (t) { return '"' + t.label + '"' + (t.kind ? ' = ' + t.kind : ''); }).join('; ');
  return [
    'Eres el asistente de registro de finanzas personales de un usuario en Perú. Moneda: soles (S/).',
    provider === 'anthropic'
      ? 'Convierte lo que dice el usuario en movimientos usando SIEMPRE la herramienta registrar_movimientos.'
      : 'Convierte lo que dice el usuario en movimientos y responde SOLO con el JSON del esquema indicado.',
    'Hoy es ' + weekday + ' ' + todayIso + ' (zona horaria de Lima).',
    '',
    'Tipos de movimiento disponibles (usa el texto exacto): ' + tipos + '.',
    'Categorías de gasto (nombre exacto, grupo entre paréntesis): ' + gastos + '.',
    'Categorías de ingreso: ' + (ingresos || '(ninguna)') + '.',
    internas ? 'Categorías internas (para retiros, depósitos y transferencias): ' + internas + '.' : '',
    'Medios de pago disponibles (texto exacto): ' + (opts.medios.join(', ') || '(ninguno)') + '.',
    '',
    'Reglas:',
    '- Un movimiento por cada gasto o ingreso mencionado. Una frase puede tener varios.',
    '- Elige la categoría más específica de la lista, con el texto exacto. Si ninguna encaja con claridad, deja categoria vacía.',
    '- Yape, Plin, transferencia, tarjeta de débito o "cuenta" se pagan desde el banco: usa el medio bancario de la lista y menciona Yape/Plin en la descripción.',
    '- "Efectivo", "cash", "sencillo" = medio en efectivo. Si no se menciona el medio, deja medio vacío. Si se menciona un solo medio para varios gastos, aplícalo a todos.',
    '- Montos: "25 soles", "s/ 25", "veinticinco" → 25; "veinte con cincuenta" → 20.50. "Luca" = 1 sol. Si no hay monto claro, monto 0.',
    '- Sacar plata del cajero = retiro de efectivo. Depositar efectivo en la cuenta = depósito a banco.',
    '- Solo es gasto del trabajo si el usuario dice que se lo reembolsarán. Cuotas para cenas o reuniones del trabajo son gastos personales.',
    '- Fechas relativas ("ayer", "el lunes") se convierten a YYYY-MM-DD; si no se dice, usa la fecha de hoy. Nunca uses fechas futuras.',
    '- descripcion: el lugar o detalle breve (ej. "Plaza Vea", "almuerzo con equipo"), máximo 60 caracteres, sin repetir la categoría.',
    '- No inventes movimientos que el usuario no dijo.'
  ].filter(function (l) { return l !== ''; }).join('\n');
}

function buildParserTool_(opts) {
  const allCats = opts.categoriasGasto.concat(opts.categoriasIngreso, opts.categoriasInternas).map(function (c) { return c.name; });
  return {
    name: 'registrar_movimientos',
    description: 'Registra los movimientos financieros que el usuario mencionó.',
    input_schema: {
      type: 'object',
      properties: {
        movimientos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: opts.tipos },
              categoria: { type: 'string', enum: allCats.concat(['']) },
              monto: { type: 'number', description: 'Monto positivo en soles.' },
              medio: { type: 'string', enum: opts.medios.concat(['']) },
              fecha: { type: 'string', description: 'YYYY-MM-DD' },
              descripcion: { type: 'string' },
              faltantes: { type: 'array', items: { type: 'string', enum: ['tipo', 'categoria', 'monto', 'medio'] } }
            },
            required: ['tipo', 'categoria', 'monto', 'medio', 'fecha', 'descripcion', 'faltantes']
          }
        },
        nota: { type: 'string', description: 'Aclaración breve para el usuario solo si algo fue ambiguo; vacío si no.' }
      },
      required: ['movimientos']
    }
  };
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

/** Devuelve la opción válida que coincide (sin importar tildes/mayúsculas) o ''. */
function matchOption_(value, options) {
  const v = normalizeText(value);
  if (!v) return '';
  for (let i = 0; i < options.length; i++) {
    if (normalizeText(options[i]) === v) return options[i];
  }
  return '';
}

function categoriesFor_(kind, opts) {
  if (kind === 'ingreso') return opts.categoriasIngreso;
  if (kind === 'retiro' || kind === 'deposito' || kind === 'interno') {
    return opts.categoriasInternas.length ? opts.categoriasInternas : opts.categoriasGasto;
  }
  return opts.categoriasGasto;
}

/** Normaliza y valida un movimiento contra las opciones del Form. */
function sanitizeItem_(m, opts, todayIso) {
  m = m || {};
  const missing = {};
  const tipo = matchOption_(m.tipo, opts.tipos) || matchOption_('Gasto', opts.tipos);
  const kind = resolveMovementType_(tipo) || 'gasto';
  const cats = categoriesFor_(kind, opts).map(function (c) { return c.name; });
  let categoria = matchOption_(m.categoria, cats);
  if (!categoria && (kind === 'retiro' || kind === 'deposito') && cats.length) categoria = cats[0];
  if (!categoria) missing.categoria = true;

  const monto = round2(Math.abs(parseAmount(m.monto)));
  if (!(monto > 0)) missing.monto = true;

  let medio = matchOption_(m.medio, opts.medios);
  if (!medio && (kind === 'retiro' || kind === 'deposito') && opts.medios.length) {
    // Retiro sale del banco; depósito sale del efectivo (el saldo se calcula por el tipo).
    medio = matchOption_(kind === 'retiro' ? 'Cuenta Bancaria' : 'Efectivo', opts.medios) || opts.medios[0];
  }
  if (!medio && opts.medios.length) missing.medio = true;

  let fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(m.fecha || '')) ? m.fecha : todayIso;
  if (fecha > todayIso) fecha = todayIso;

  (m.faltantes || []).forEach(function (f) {
    if (f === 'categoria' && !categoria) missing.categoria = true;
  });

  return {
    tipo: tipo,
    kind: kind,
    categoria: categoria,
    grupo: categoria ? (categoriesFor_(kind, opts).filter(function (c) { return c.name === categoria; })[0] || {}).grupo || '' : '',
    monto: monto,
    medio: medio,
    fecha: fecha,
    descripcion: cleanLabel(m.descripcion || '').slice(0, 80),
    faltantes: Object.keys(missing)
  };
}

/* ------------------------------------------------------------------ */
/* Guardar en el Form                                                  */
/* ------------------------------------------------------------------ */

function itemResponse_(item, value) {
  const t = item.getType();
  if (t === FormApp.ItemType.MULTIPLE_CHOICE) return item.asMultipleChoiceItem().createResponse(value);
  if (t === FormApp.ItemType.LIST) return item.asListItem().createResponse(value);
  if (t === FormApp.ItemType.CHECKBOX) return item.asCheckboxItem().createResponse([value]);
  if (t === FormApp.ItemType.TEXT) return item.asTextItem().createResponse(String(value));
  if (t === FormApp.ItemType.PARAGRAPH_TEXT) return item.asParagraphTextItem().createResponse(String(value));
  if (t === FormApp.ItemType.DATE) return item.asDateItem().createResponse(value);
  throw new AppError('El tipo de la pregunta "' + item.getTitle() + '" no es compatible.');
}

/**
 * Guarda movimientos confirmados como respuestas del Form.
 * Valida todo antes de enviar: si uno falla, no se guarda ninguno.
 */
function saveMovements_(items) {
  if (!Array.isArray(items) || !items.length) throw new AppError('No hay movimientos para guardar.');
  if (items.length > CONFIG.API.MAX_ITEMS_PER_SAVE) throw new AppError('Máximo ' + CONFIG.API.MAX_ITEMS_PER_SAVE + ' movimientos por vez.');

  const opts = getEntryOptions_();
  const todayIso = Utilities.formatDate(now_(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const clean = items.map(function (m, i) {
    const s = sanitizeItem_(m, opts, todayIso);
    if (s.faltantes.length) {
      throw new AppError('El movimiento ' + (i + 1) + ' está incompleto: falta ' + s.faltantes.join(', ') + '.');
    }
    return s;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const form = getLinkedForm_();
    const fi = findFormItems_(form);
    clean.forEach(function (m) {
      const r = form.createResponse();
      r.withItemResponse(itemResponse_(fi.tipo, m.tipo));
      const catItem = (m.kind === 'ingreso' && fi.categoriaIngreso) ? fi.categoriaIngreso : fi.categoria;
      r.withItemResponse(itemResponse_(catItem, m.categoria));
      r.withItemResponse(itemResponse_(fi.monto, m.monto));
      if (fi.medio && m.medio) r.withItemResponse(itemResponse_(fi.medio, m.medio));
      if (fi.descripcion && m.descripcion) r.withItemResponse(itemResponse_(fi.descripcion, m.descripcion));
      if (fi.fecha && m.fecha) {
        const p = m.fecha.split('-');
        r.withItemResponse(itemResponse_(fi.fecha, new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0)));
      }
      r.submit();
    });
  } finally {
    lock.releaseLock();
  }
  invalidateCache();
  return { saved: clean.length, items: clean };
}
