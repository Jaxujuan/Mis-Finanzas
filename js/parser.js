/* =========================================================
   parser.js · intérprete local (sin IA) de frases en español peruano
   "almuerzo 25 con yape, ayer taxi 12 en efectivo y regalo para mi tío 80"
     → 3 movimientos con tipo, categoría, monto, medio, fecha y descripción.

   Usa: opciones del Form (tipos, categorías, medios), un diccionario de
   palabras frecuentes en Perú y lo aprendido de tu historial (learned).
   ========================================================= */
const Parser = (function () {

  /* ---------------- Utilidades ---------------- */
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/s\/\.?/g, ' s/ ').replace(/[^a-z0-9ñ/.,\s-]/g, ' ')
      .replace(/([.,])(?!\d)/g, ' ').replace(/(^|[^\d])[.,]/g, '$1 ').replace(/\s+/g, ' ').trim();
  }
  function iso(d) { const p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------------- Números en palabras ---------------- */
  const UNITS = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
  const TEENS = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
  const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
  const HUNDREDS = { cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };
  function isNumWord(w) { return w in UNITS || w in TEENS || w in TENS || w in HUNDREDS || w === 'mil'; }

  /** Lee un número escrito con palabras desde tokens[i]. Devuelve {value, len} o null. */
  function wordsNumber(tokens, i) {
    let total = 0, current = 0, j = i, used = false;
    while (j < tokens.length) {
      const w = tokens[j];
      if (w in HUNDREDS) { current += HUNDREDS[w]; used = true; j++; continue; }
      if (w in TENS) {
        current += TENS[w]; used = true; j++;
        if (tokens[j] === 'y' && tokens[j + 1] in UNITS) { current += UNITS[tokens[j + 1]]; j += 2; }
        continue;
      }
      if (w in TEENS) { current += TEENS[w]; used = true; j++; continue; }
      if (w in UNITS) {
        // "un" / "una" solos suelen ser artículos ("un taxi"), no montos.
        if ((w === 'un' || w === 'una') && !(tokens[j + 1] === 'mil' || /^(sol|soles|luca|lucas)$/.test(tokens[j + 1] || ''))) break;
        current += UNITS[w]; used = true; j++; continue;
      }
      if (w === 'mil') { total += (current || 1) * 1000; current = 0; used = true; j++; continue; }
      break;
    }
    return used ? { value: total + current, len: j - i } : null;
  }

  /* ---------------- Diccionario de palabras (Perú) ---------------- */
  // Cada grupo de palabras apunta a posibles nombres de categoría (se usa el primero que exista en tu Form).
  const KEYWORDS = [
    [['Reuniones'], ['cuota', 'almuerzo familiar', 'cena del trabajo', 'cena de trabajo', 'cena trabajo', 'reunion', 'junta', 'pollada', 'parrillada', 'vaca', 'chancha', 'cumpleanos de']],
    [['Regalos'], ['regalo', 'regalos', 'obsequio', 'presente para']],
    [['Comida', 'Alimentacion', 'Alimentos'], ['comida', 'almuerzo', 'almorce', 'menu', 'cena', 'cene', 'desayuno', 'lonche', 'restaurante', 'chifa', 'pollo', 'polleria', 'broaster', 'ceviche', 'cevicheria', 'hamburguesa', 'pizza', 'delivery', 'rappi', 'pedidosya', 'mercado', 'supermercado', 'plaza vea', 'tottus', 'metro', 'wong', 'vivanda', 'makro', 'mass', 'bodega', 'pan', 'panaderia', 'verduras', 'frutas', 'abarrotes', 'comi', 'sanguche', 'anticucho']],
    [['Snacks', 'Tambo'], ['snack', 'snacks', 'chocolate', 'galleta', 'galletas', 'gaseosa', 'helado', 'golosina', 'dulce', 'papitas', 'tambo', 'oxxo', 'cafe', 'starbucks', 'chifles', 'piqueo']],
    [['Pasajes', 'Transporte', 'Movilidad'], ['taxi', 'uber', 'didi', 'cabify', 'indrive', 'indriver', 'combi', 'bus', 'micro', 'metropolitano', 'corredor', 'colectivo', 'pasaje', 'pasajes', 'tren', 'linea 1', 'mototaxi', 'peaje']],
    [['Gasolina', 'Combustible'], ['gasolina', 'grifo', 'combustible', 'petroleo', 'diesel', 'glp', 'primax', 'repsol', 'pecsa', 'tanqueada', 'tanque']],
    [['Lavado'], ['lavado', 'carwash', 'car wash', 'lavar el carro', 'lavada']],
    [['Mantenimiento'], ['mantenimiento', 'taller', 'mecanico', 'aceite', 'llanta', 'llantas', 'repuesto', 'soat', 'revision tecnica', 'afinamiento']],
    [['Celular'], ['celular', 'recarga', 'claro', 'movistar', 'entel', 'bitel', 'plan del celular', 'plan celular']],
    [['Gas'], ['gas', 'balon de gas', 'balon', 'calidda']],
    [['Servicios', 'Luz', 'Agua', 'Internet'], ['luz', 'agua', 'internet', 'enel', 'luz del sur', 'sedapal', 'cable', 'recibo']],
    [['Hijos', 'Perritos', 'Mascotas'], ['croquetas', 'croqueta', 'perro', 'perros', 'perrito', 'perritos', 'veterinario', 'veterinaria', 'mascota', 'ricocan', 'dog chow', 'pulgas']],
    [['Claude'], ['claude', 'anthropic']],
    [['Temu', 'Importaciones'], ['temu', 'aliexpress', 'shein', 'amazon']],
    [['Suplementos'], ['suplemento', 'suplementos', 'proteina', 'whey', 'creatina', 'vitaminas', 'goodprotein', 'colageno']],
    [['Gym'], ['gym', 'gimnasio', 'smart fit', 'smartfit', 'bodytech', 'mensualidad del gym']],
    [['Electrodomesticos'], ['electrodomestico', 'licuadora', 'microondas', 'refrigeradora', 'refri', 'lavadora', 'plancha', 'ventilador', 'hervidor', 'olla arrocera']],
    [['Juegos'], ['juego', 'juegos', 'steam', 'playstation', 'ps5', 'xbox', 'nintendo', 'videojuego']],
    [['Cine'], ['cine', 'cineplanet', 'cinemark', 'pelicula', 'canchita']],
    [['Ocio'], ['salida', 'bowling', 'karaoke', 'discoteca', 'bar', 'tragos', 'cerveza', 'chela', 'chelas', 'fiesta', 'paseo', 'concierto', 'entradas']],
    [['Ropa'], ['ropa', 'polo', 'zapatillas', 'zapatos', 'pantalon', 'casaca', 'camisa', 'short', 'medias', 'saga', 'ripley', 'oechsle', 'zara']],
    [['Aseo'], ['aseo', 'shampoo', 'champu', 'jabon', 'pasta dental', 'desodorante', 'papel higienico', 'detergente', 'limpieza', 'inkafarma', 'mifarma', 'farmacia']],
    [['Barbero'], ['barbero', 'barberia', 'peluqueria', 'corte de pelo', 'corte']],
    [['Imprevistos'], ['imprevisto', 'emergencia', 'multa', 'papeleta', 'urgencia']],
    [['Sueldo'], ['sueldo', 'salario', 'quincena', 'planilla', 'pago del mes']],
    [['Ingreso Extra', 'Ingresos variables', 'Extra'], ['freelance', 'cachuelo', 'extra', 'venta', 'vendi', 'bono', 'propina', 'comision', 'ingreso extra', 'me yapearon', 'me plinearon']]
  ];

  // Palabras que indican el tipo de movimiento → tipo interno.
  const TYPE_HINTS = [
    ['reembolso', ['me reembolsaron', 'reembolsaron', 'me devolvieron del trabajo', 'reembolso del trabajo', 'me pagaron el reembolso']],
    ['gasto_trabajo', ['reembolsable', 'me reembolsan', 'me lo reembolsan', 'me lo devuelven', 'me lo van a devolver', 'gasto del trabajo', 'gasto de trabajo', 'a cuenta del trabajo', 'por cuenta del trabajo', 'lo paga el trabajo']],
    ['retiro', ['saque', 'retire', 'cajero', 'retiro']],
    ['deposito', ['deposite', 'deposito a', 'meti plata', 'deposito en']],
    ['ingreso', ['me pagaron', 'me depositaron', 'cobre', 'recibi', 'me yapearon', 'me plinearon', 'gane', 'ingreso', 'sueldo', 'quincena', 'salario', 'vendi', 'me transfirieron']]
  ];

  // Palabras de medio de pago → clave lógica.
  const MEDIO_HINTS = [
    ['credito', ['tarjeta de credito', 'credito', 'con la visa', 'en cuotas']],
    ['efectivo', ['efectivo', 'cash', 'sencillo', 'en billete', 'billete', 'en mano']],
    ['banco', ['yape', 'yapee', 'yapeado', 'plin', 'plinee', 'tarjeta', 'debito', 'transferencia', 'transferi', 'banco', 'cuenta', 'bcp', 'interbank', 'bbva', 'scotiabank', 'banbif', 'online', 'app']]
  ];

  const FILLERS = ['gaste', 'gasto', 'pague', 'pago', 'compre', 'me', 'costo', 'salio', 'fue', 'de', 'del', 'en', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'por', 'con', 'y', 'a', 'al', 'para', 'que', 'soles', 'sol', 'lucas', 'luca', 's/', 'pagaron', 'cobre', 'recibi', 'saque', 'deposite', 'hoy', 'ayer', 'anteayer', 'antier', 'tambien', 'luego', 'otro', 'otra', 'mas', 'como', 'mi', 'mis', 'su', 'sus'];
  const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ---------------- Segmentación ---------------- */
  /** Divide la frase en movimientos. Une fragmentos sin monto con el siguiente. */
  function segments(text) {
    // Protege las comas decimales ("86,40") antes de separar por comas.
    const raw = String(text || '').replace(/\n+/g, ', ').replace(/(\d),(\d)/g, '$1\u00a7$2');
    let parts = raw.split(/\s*[;,]\s*|\s+(?:y luego|luego|despues|después|además|ademas|tambien|también|y también)\s+/i);
    // Separa por " y " solo si no rompe un número ("treinta y cinco").
    const out = [];
    parts.forEach(function (p) {
      const pieces = p.split(/\s+y\s+/i);
      let acc = pieces[0];
      for (let i = 1; i < pieces.length; i++) {
        const left = norm(acc).split(' ').pop();
        const right = norm(pieces[i]).split(' ')[0];
        if (left in TENS && right in UNITS) acc += ' y ' + pieces[i];
        else { out.push(acc); acc = pieces[i]; }
      }
      out.push(acc);
    });
    const cleaned = out.map(function (s) { return s.replace(/\u00a7/g, ',').trim(); }).filter(Boolean);
    // Fragmentos sin monto se unen al siguiente (o al anterior si es el último).
    const merged = [];
    let carry = '';
    cleaned.forEach(function (s, i) {
      const full = carry ? carry + ' y ' + s : s;
      if (!hasAmount(full) && i < cleaned.length - 1) { carry = full; return; }
      if (!hasAmount(full) && merged.length) { merged[merged.length - 1] += ' ' + full; carry = ''; return; }
      merged.push(full); carry = '';
    });
    return merged;
  }

  function hasAmount(s) {
    const t = stripDates(norm(s)).text;
    if (/\d/.test(t)) return true;
    const toks = t.split(' ');
    for (let i = 0; i < toks.length; i++) { const w = wordsNumber(toks, i); if (w && w.value > 0) return true; }
    return false;
  }

  /* ---------------- Fechas ---------------- */
  /** Quita expresiones de fecha del texto normalizado y devuelve la fecha si la hay. */
  function stripDates(t, today) {
    today = today || new Date();
    let date = null;
    const set = function (d) { if (!date) date = d; return ' '; };
    t = t.replace(/\b(antes de ayer|anteayer|antier)\b/, function () { return set(addDays(today, -2)); });
    t = t.replace(/\bayer\b/, function () { return set(addDays(today, -1)); });
    t = t.replace(/\bhoy\b/, function () { return set(today); });
    t = t.replace(/\bhace (\d+|\w+) dias?\b/, function (m, n) {
      const v = /^\d+$/.test(n) ? +n : (wordsNumber([n], 0) || {}).value;
      return v ? set(addDays(today, -v)) : m;
    });
    t = t.replace(/\b(?:el )?(\d{1,2})\s*(?:\/|-)\s*(\d{1,2})(?:\s*(?:\/|-)\s*(\d{2,4}))?\b/, function (m, d, mo, y) {
      return set(buildDate(today, +d, +mo, y));
    });
    t = t.replace(new RegExp('\\b(?:el )?(\\d{1,2}) de (' + MONTHS.join('|') + ')\\b'), function (m, d, mo) {
      return set(buildDate(today, +d, MONTHS.indexOf(mo) + 1));
    });
    t = t.replace(new RegExp('\\b(?:el )?(?:pasado )?(' + DAYS.join('|') + ')(?: pasado)?\\b'), function (m, day) {
      let diff = (today.getDay() - DAYS.indexOf(day) + 7) % 7;
      if (diff === 0) diff = 7;
      return set(addDays(today, -diff));
    });
    if (date && date > today) date = today;
    return { text: t.replace(/\s+/g, ' ').trim(), date: date };
  }

  function buildDate(today, d, m, y) {
    let year = y ? (+y < 100 ? 2000 + +y : +y) : today.getFullYear();
    let dt = new Date(year, m - 1, d);
    if (!y && dt > today) dt = new Date(year - 1, m - 1, d);
    return dt;
  }

  /* ---------------- Monto ---------------- */
  /** Busca el monto en los tokens normalizados. Marca los tokens usados. */
  function findAmount(tokens, used) {
    const candidates = [];
    for (let i = 0; i < tokens.length; i++) {
      if (used[i]) continue;
      const tk = tokens[i];
      let m = tk.match(/^(?:s\/)?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?$/);
      let value = null, len = 1;
      if (m) {
        value = parseFloat(m[1].replace(/[.,]/g, '') + (m[2] ? '.' + m[2] : ''));
      } else {
        const w = wordsNumber(tokens, i);
        if (w) { value = w.value; len = w.len; }
      }
      if (value === null) continue;
      // "25 con 50" / "veinte con cincuenta" → céntimos
      let j = i + len;
      if (tokens[j] === 'con' && tokens[j + 1] !== undefined) {
        const c = /^\d{1,2}$/.test(tokens[j + 1]) ? { value: +tokens[j + 1], len: 1 } : wordsNumber(tokens, j + 1);
        if (c && c.value < 100 && !/^(yape|plin|tarjeta|efectivo)/.test(tokens[j + 1])) { value += c.value / 100; len += 1 + c.len; }
      }
      j = i + len;
      let score = 1;
      if (/^(soles|sol|lucas|luca)$/.test(tokens[j] || '')) { score += 3; len++; }
      if (/^(s\/)$/.test(tokens[i - 1] || '')) score += 3;
      if (/^(de|por|a|en)$/.test(tokens[i - 1] || '')) score += 1;
      candidates.push({ i: i, len: len, value: round2(value), score: score + i * 0.01 });
      i += len - 1; // las palabras de este número ya no son otro número ("treinta y cinco")
    }
    if (!candidates.length) return 0;
    candidates.sort(function (a, b) { return b.score - a.score; });
    const best = candidates[0];
    for (let k = best.i; k < best.i + best.len; k++) used[k] = true;
    if (tokens[best.i - 1] === 's/') used[best.i - 1] = true;
    return best.value;
  }

  /* ---------------- Coincidencias de frases ---------------- */
  /** ¿La frase (varias palabras) aparece en tokens? Devuelve índice o -1. */
  function findPhrase(tokens, phrase) {
    const p = phrase.split(' ');
    outer: for (let i = 0; i <= tokens.length - p.length; i++) {
      for (let k = 0; k < p.length; k++) if (tokens[i + k] !== p[k]) continue outer;
      return i;
    }
    return -1;
  }

  /* ---------------- Interpretar un segmento ---------------- */
  function parseSegment(seg, ctx) {
    const o = ctx.options;
    const dates = stripDates(norm(seg), ctx.today);
    const tokens = dates.text.split(' ').filter(Boolean);
    const used = {};
    const rawTokens = String(seg).replace(/[;,]/g, ' ').split(/\s+/).filter(Boolean);

    // Tipo
    let kind = 'gasto';
    for (let t = 0; t < TYPE_HINTS.length && kind === 'gasto'; t++) {
      for (let h = 0; h < TYPE_HINTS[t][1].length; h++) {
        const idx = findPhrase(tokens, TYPE_HINTS[t][1][h]);
        if (idx >= 0) {
          kind = TYPE_HINTS[t][0];
          if (kind !== 'ingreso' || !/sueldo|quincena|salario/.test(TYPE_HINTS[t][1][h])) {
            for (let k = 0; k < TYPE_HINTS[t][1][h].split(' ').length; k++) used[idx + k] = true;
          }
          break;
        }
      }
    }
    const tipo = tipoLabel(kind, o);

    // Medio
    let medioKey = '', mentioned = '';
    for (let m = 0; m < MEDIO_HINTS.length && !medioKey; m++) {
      for (let h = 0; h < MEDIO_HINTS[m][1].length; h++) {
        const phrase = MEDIO_HINTS[m][1][h];
        const idx = findPhrase(tokens, phrase);
        if (idx >= 0) {
          medioKey = MEDIO_HINTS[m][0];
          if (/^(yape|yapee|yapeado)$/.test(phrase)) mentioned = 'Yape';
          if (/^(plin|plinee)$/.test(phrase)) mentioned = 'Plin';
          for (let k = 0; k < phrase.split(' ').length; k++) used[idx + k] = true;
          if (/^(con|en|por|a)$/.test(tokens[idx - 1] || '')) used[idx - 1] = true;
          break;
        }
      }
    }

    // Monto
    const monto = findAmount(tokens, used);

    // Categoría
    const cats = categoriesFor(kind, o);
    const best = pickCategory(tokens, cats, ctx.learned);
    let categoria = best ? best.name : '';
    if (!categoria && (kind === 'retiro' || kind === 'deposito') && cats.length) categoria = cats[0].name;
    const catEntry = cats.filter(function (c) { return c.name === categoria; })[0];

    // Medio final
    let medio = medioFor(medioKey, o);
    if (!medio && (kind === 'retiro' || kind === 'deposito')) medio = medioFor(kind === 'retiro' ? 'banco' : 'efectivo', o);
    if (!medio && categoria && ctx.learned && ctx.learned.medioByCat && ctx.learned.medioByCat[categoria]) {
      const lm = ctx.learned.medioByCat[categoria];
      if (o.medios.indexOf(lm) >= 0) medio = lm;
    }

    // Descripción: palabras originales que no se usaron
    const descr = describe(rawTokens, tokens, used, dates);
    let descripcion = descr;
    if (norm(descripcion) === norm(categoria)) descripcion = '';
    if (mentioned && norm(descripcion).indexOf(norm(mentioned)) < 0) descripcion = descripcion ? descripcion + ' · ' + mentioned : mentioned;

    const item = {
      tipo: tipo, kind: kind, categoria: categoria, grupo: catEntry ? catEntry.grupo : '',
      monto: monto || 0, medio: medio, fecha: iso(dates.date || ctx.lastDate || ctx.today),
      descripcion: descripcion.slice(0, 60), faltantes: [], source: 'reglas', medioDicho: !!medioKey
    };
    if (dates.date) ctx.lastDate = dates.date;
    if (!item.categoria) item.faltantes.push('categoria');
    if (!(item.monto > 0)) item.faltantes.push('monto');
    if (o.medios.length && !item.medio) item.faltantes.push('medio');
    return item;
  }

  function describe(rawTokens, tokens, used, dates) {
    // Alinear tokens originales con los normalizados (misma cantidad casi siempre).
    const raw = rawTokens.map(function (r) { return { r: r, n: norm(r) }; }).filter(function (x) { return x.n; });
    const usedNorm = {};
    tokens.forEach(function (t, i) { if (used[i]) usedNorm[t] = (usedNorm[t] || 0) + 1; });
    const keep = raw.filter(function (x) {
      if (usedNorm[x.n]) { usedNorm[x.n]--; return false; }
      if (/^(s\/)?\d/.test(x.n)) return false;
      if (/^(antes|ayer|anteayer|antier|hoy|hace|dias?|pasado)$/.test(x.n) || DAYS.indexOf(x.n) >= 0 || MONTHS.indexOf(x.n) >= 0) return false;
      if (isNumWord(x.n)) return false;
      return true;
    });
    let words = keep.map(function (x) { return x.r.replace(/^[^\wáéíóúñü]+|[^\wáéíóúñü.]+$/gi, ''); }).filter(Boolean);
    while (words.length && FILLERS.indexOf(norm(words[0])) >= 0) words.shift();
    while (words.length && FILLERS.indexOf(norm(words[words.length - 1])) >= 0) words.pop();
    const s = words.join(' ');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /* ---------------- Categorías ---------------- */
  function categoriesFor(kind, o) {
    if (kind === 'ingreso') return o.categoriasIngreso;
    if (kind === 'retiro' || kind === 'deposito') return o.categoriasInternas.length ? o.categoriasInternas : o.categoriasGasto;
    return o.categoriasGasto;
  }

  function singular(w) { return w.replace(/(es|s)$/, ''); }

  function pickCategory(tokens, cats, learned) {
    if (!cats.length) return null;
    const byNorm = {};
    cats.forEach(function (c) { byNorm[norm(c.name)] = c; });
    const scores = {};
    const add = function (name, pts) { if (byNorm[norm(name)]) scores[byNorm[norm(name)].name] = (scores[byNorm[norm(name)].name] || 0) + pts; };
    const joined = ' ' + tokens.join(' ') + ' ';

    // 1. Nombre de la categoría dicho tal cual (o en plural/singular).
    cats.forEach(function (c) {
      const n = norm(c.name);
      if (joined.indexOf(' ' + n + ' ') >= 0 || tokens.some(function (t) { return singular(t) === singular(n) && t.length > 2; })) add(c.name, 40);
    });
    // 2. Lo aprendido de tu historial.
    if (learned) {
      const full = tokens.filter(function (t) { return FILLERS.indexOf(t) < 0 && !/^\d/.test(t); }).join(' ');
      if (learned.descs && learned.descs[full]) add(learned.descs[full], 35);
      if (learned.words) tokens.forEach(function (t) {
        const w = learned.words[t];
        if (w && FILLERS.indexOf(t) < 0) add(w.c, 8 * Math.min(w.n, 3) * w.p);
      });
    }
    // 3. Diccionario de palabras frecuentes.
    KEYWORDS.forEach(function (entry) {
      const target = entry[0].filter(function (n) { return byNorm[norm(n)]; })[0];
      if (!target) return;
      entry[1].forEach(function (kw) {
        if (joined.indexOf(' ' + kw + ' ') >= 0) add(target, 10 + kw.length);
      });
    });
    let best = null;
    Object.keys(scores).forEach(function (k) { if (!best || scores[k] > best.score) best = { name: k, score: scores[k] }; });
    return best;
  }

  function tipoLabel(kind, o) {
    const t = (o.tiposInternos || []).filter(function (x) { return x.kind === kind; })[0];
    if (t) return t.label;
    const g = (o.tiposInternos || []).filter(function (x) { return x.kind === 'gasto'; })[0];
    return g ? g.label : (o.tipos[0] || 'Gasto');
  }

  function medioFor(key, o) {
    if (!key) return '';
    const ms = o.medios || [];
    const find = function (re) { return ms.filter(function (m) { return re.test(norm(m)); })[0] || ''; };
    if (key === 'efectivo') return find(/efectivo|cash/);
    if (key === 'credito') return find(/credito/) || find(/tarjeta/) || find(/cuenta|banco/);
    return find(/cuenta|banco|debito|bancari|yape|plin/) || ms.filter(function (m) { return !/efectivo/.test(norm(m)); })[0] || '';
  }

  /* ---------------- API pública ---------------- */
  /**
   * @param {string} text   lo que dijo o escribió el usuario
   * @param {Object} options opciones del Form (tipos, categorías, medios, tiposInternos)
   * @param {Object} learned diccionario aprendido del historial (opcional)
   * @param {Date}   today  (opcional, para pruebas)
   */
  function parse(text, options, learned, today) {
    const ctx = { options: options, learned: learned || options.learned || null, today: today || new Date(), lastDate: null };
    ctx.today = new Date(ctx.today.getFullYear(), ctx.today.getMonth(), ctx.today.getDate());
    const items = segments(text).map(function (s) { return parseSegment(s, ctx); }).filter(function (it) {
      return it.monto > 0 || it.categoria;
    });
    // Si en toda la frase se mencionó un solo medio ("cine 18 y canchita 15 con plin"), aplica a todos.
    const said = items.filter(function (it) { return it.medioDicho; }).map(function (it) { return it.medio; });
    const unique = said.filter(function (m, i) { return said.indexOf(m) === i; });
    items.forEach(function (it) {
      if (!it.medio && unique.length === 1 && it.kind !== 'retiro' && it.kind !== 'deposito') {
        it.medio = unique[0];
        it.faltantes = it.faltantes.filter(function (f) { return f !== 'medio'; });
      }
      delete it.medioDicho;
    });
    return items;
  }

  /** ¿Conviene pedir ayuda a la IA? (no entendió nada o faltan categoría/monto) */
  function needsHelp(items) {
    return !items.length || items.some(function (it) { return it.faltantes.indexOf('categoria') >= 0 || it.faltantes.indexOf('monto') >= 0; });
  }

  return { parse: parse, needsHelp: needsHelp, _norm: norm, _segments: segments };
})();
if (typeof module !== 'undefined') module.exports = Parser;
