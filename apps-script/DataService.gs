/**
 * DataService.gs
 * Lectura de Google Sheets y normalización de datos.
 * Cada pestaña se lee UNA sola vez por carga (getDataRange().getValues()).
 * Las columnas se identifican por encabezado, nunca por posición.
 */

function getSpreadsheet_() {
  const ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new AppError('No se encontró el Google Sheets. Revisa SPREADSHEET_ID en Config.gs.');
  }
  return ss;
}

/** Busca una pestaña por cualquiera de sus nombres aceptados. */
function findSheet_(ss, candidates) {
  const wanted = candidates.map(normalizeText);
  const sheets = ss.getSheets();
  for (let w = 0; w < wanted.length; w++) {
    for (let i = 0; i < sheets.length; i++) {
      if (normalizeText(sheets[i].getName()) === wanted[w]) return sheets[i];
    }
  }
  return null;
}

/**
 * Lee una tabla identificando columnas por encabezado.
 * Detecta la fila de encabezados dentro de las 5 primeras filas (tolera títulos encima).
 * @return {{rows: Object[], missing: string[], headerRow: number}}
 */
function readTable_(sheet, aliasMap) {
  const values = sheet.getDataRange().getValues();
  const fields = Object.keys(aliasMap);
  const normAliases = {};
  fields.forEach(function (f) { normAliases[f] = aliasMap[f].map(normalizeText); });

  let best = { row: -1, score: 0, index: {} };
  for (let r = 0; r < Math.min(5, values.length); r++) {
    const headers = values[r].map(normalizeText);
    const index = {};
    let score = 0;
    fields.forEach(function (f) {
      for (let a = 0; a < normAliases[f].length; a++) {
        const col = headers.indexOf(normAliases[f][a]);
        if (col >= 0) { index[f] = col; score++; break; }
      }
    });
    if (score > best.score) best = { row: r, score: score, index: index };
  }

  const missing = fields.filter(function (f) { return best.index[f] === undefined; });
  if (best.row < 0) return { rows: [], missing: fields, headerRow: -1 };

  const rows = [];
  for (let r = best.row + 1; r < values.length; r++) {
    const obj = { _row: r + 1 };
    let hasData = false;
    fields.forEach(function (f) {
      const col = best.index[f];
      const v = col === undefined ? '' : values[r][col];
      obj[f] = v;
      if (v !== '' && v !== null) hasData = true;
    });
    if (hasData) rows.push(obj);
  }
  return { rows: rows, missing: missing, headerRow: best.row + 1 };
}

/** Lee una pestaña opcional; si no existe devuelve filas vacías y registra un aviso. */
function readOptional_(ss, sheetKey, warnings) {
  const sheet = findSheet_(ss, CONFIG.SHEETS[sheetKey]);
  if (!sheet) {
    warnings.push('No se encontró la pestaña "' + CONFIG.SHEETS[sheetKey][0] + '".');
    return [];
  }
  return readTable_(sheet, CONFIG.HEADERS[sheetKey]).rows;
}

/**
 * Lee todas las pestañas y devuelve el dataset normalizado.
 * Es la única función que toca SpreadsheetApp para datos.
 */
function loadDatasetFromSheets_() {
  const ss = getSpreadsheet_();
  const warnings = [];

  const movSheet = findSheet_(ss, CONFIG.SHEETS.MOVIMIENTOS);
  if (!movSheet) {
    throw new AppError('No se encontró la hoja de movimientos. Revisa CONFIG.SHEETS.MOVIMIENTOS en Config.gs.');
  }
  const movTable = readTable_(movSheet, CONFIG.HEADERS.MOVIMIENTOS);
  ['fecha', 'tipo', 'monto'].forEach(function (f) {
    if (movTable.missing.indexOf(f) >= 0) {
      throw new AppError('Falta la columna "' + CONFIG.HEADERS.MOVIMIENTOS[f][0] +
        '" en la hoja de movimientos. Revisa los encabezados.');
    }
  });

  const settings = parseSettings_(readOptional_(ss, 'CONFIGURACION', warnings));
  const catalog = parseCatalog_(readOptional_(ss, 'CATEGORIAS', warnings));
  const budget = parseBudget_(readOptional_(ss, 'PRESUPUESTO', warnings));
  const fixed = parseFixed_(readOptional_(ss, 'GASTOS_FIJOS', warnings));
  const movements = normalizeMovements_(movTable.rows, catalog, settings, warnings);

  return {
    movements: movements,
    catalog: catalog,
    budget: budget,
    fixed: fixed,
    settings: settings,
    warnings: warnings,
    sheetName: movSheet.getName(),
    loadedAt: now_().getTime()
  };
}

function parseSettings_(rows) {
  const settings = Object.assign({}, CONFIG.DEFAULTS);
  rows.forEach(function (r) {
    const key = CONFIG.SETTING_KEYS[normalizeText(r.clave)];
    if (!key || r.valor === '' || r.valor === null) return;
    if (key === 'fechaInicio') {
      settings.fechaInicio = parseDate(r.valor);
    } else if (key === 'toleranciaFijos') {
      const t = parseAmount(r.valor);
      settings.toleranciaFijos = t > 1 ? t / 100 : t;
    } else {
      settings[key] = parseAmount(r.valor);
    }
  });
  return settings;
}

/** Catálogo: categoría normalizada → { name, group, type }. */
function parseCatalog_(rows) {
  const catalog = {};
  rows.forEach(function (r) {
    const name = cleanLabel(r.categoria);
    if (!name) return;
    const tipo = normalizeText(r.tipo);
    catalog[normalizeText(name)] = {
      name: name,
      group: cleanLabel(r.grupo) || 'Sin grupo',
      type: tipo.indexOf('ingreso') >= 0 ? 'ingreso' : tipo.indexOf('interno') >= 0 ? 'interno' : 'gasto'
    };
  });
  return catalog;
}

function parseBudget_(rows) {
  return rows
    .map(function (r) {
      const meses = parseAmount(r.meses);
      return { categoria: cleanLabel(r.categoria), monto: parseAmount(r.monto), meses: meses > 1 ? meses : 1 };
    })
    .filter(function (b) { return b.categoria && b.monto > 0; });
}

function parseFixed_(rows) {
  return rows
    .map(function (r) {
      return {
        concepto: cleanLabel(r.concepto) || cleanLabel(r.categoria),
        categoria: cleanLabel(r.categoria),
        monto: parseAmount(r.monto),
        dia: Math.min(31, Math.max(1, Math.round(parseAmount(r.dia)) || 1)),
        frecuencia: cleanLabel(r.frecuencia) || 'Mensual',
        activo: parseBoolean(r.activo)
      };
    })
    .filter(function (f) { return f.categoria && f.monto > 0; });
}

/**
 * Fecha del movimiento: usa "Fecha del movimiento" si existe (para registrar gastos de días anteriores).
 * Si cae el mismo día que la marca temporal, conserva la hora de la marca temporal.
 */
function resolveMovementDate_(rawTimestamp, rawMovementDate) {
  const stamp = parseDate(rawTimestamp);
  const chosen = parseDate(rawMovementDate);
  if (!chosen) return stamp;
  if (stamp && stamp.getFullYear() === chosen.getFullYear() && stamp.getMonth() === chosen.getMonth() &&
      stamp.getDate() === chosen.getDate()) return stamp;
  return new Date(chosen.getFullYear(), chosen.getMonth(), chosen.getDate(), 12, 0, 0);
}

/** Traduce el texto del Form a un tipo interno. */
function resolveMovementType_(rawTipo) {
  const t = normalizeText(rawTipo);
  if (t.indexOf('reembolsable') >= 0 || (t.indexOf('gasto') >= 0 && t.indexOf('trabajo') >= 0)) return 'gasto_trabajo';
  if (t.indexOf('reembolso') >= 0) return 'reembolso';
  if (t.indexOf('retiro') >= 0) return 'retiro';
  if (t.indexOf('deposito') >= 0) return 'deposito';
  if (t.indexOf('transferencia') >= 0 || t.indexOf('interno') >= 0) return 'interno';
  if (t.indexOf('ingreso') >= 0) return 'ingreso';
  if (t.indexOf('gasto') >= 0) return 'gasto';
  return null;
}

/** Traduce el medio del Form a una cuenta interna. */
function resolveAccount_(rawMedio) {
  const m = normalizeText(rawMedio);
  if (m.indexOf('efectivo') >= 0) return 'efectivo';
  if (m.indexOf('credito') >= 0) return 'credito';
  return 'banco';
}

function normalizeMovements_(rows, catalog, settings, warnings) {
  const out = [];
  let skipped = 0;
  const unknownCats = {};
  const salaryKey = normalizeText(CONFIG.SALARY_CATEGORY);

  rows.forEach(function (r) {
    const date = resolveMovementDate_(r.fecha, r.fechaMovimiento);
    const tipo = resolveMovementType_(r.tipo);
    const monto = Math.abs(parseAmount(r.monto));
    if (!date || !tipo || !(monto > 0)) { skipped++; return; }
    if (settings.fechaInicio && date < settings.fechaInicio) return;

    // La categoría correcta depende del tipo (dos columnas cuando el Form usa secciones).
    const rawCat = tipo === 'ingreso'
      ? (r.categoriaIngreso || r.categoria)
      : (r.categoria || r.categoriaIngreso);
    const catName = cleanLabel(rawCat);
    const catKey = normalizeText(catName);
    const entry = catalog[catKey];

    let kind = tipo;
    let excluded = false;
    if (entry && entry.type === 'interno' && (tipo === 'gasto' || tipo === 'ingreso')) excluded = true;
    if (tipo === 'interno') excluded = true;

    let grupo = '';
    if (tipo === 'gasto' || tipo === 'ingreso') {
      if (entry) grupo = entry.group;
      else if (catName) { grupo = 'Sin grupo'; unknownCats[catName] = true; }
      else grupo = 'Sin categoría';
    }

    // Opción A: el sueldo cobrado a fin de mes cuenta para el mes siguiente.
    let period = periodKey(date);
    if (kind === 'ingreso' && catKey === salaryKey && date.getDate() >= settings.diaSueldoMesSiguiente) {
      period = shiftPeriod(period, 1);
    }

    out.push({
      id: r._row,
      date: date.getTime(),
      period: period,
      tipo: kind,
      categoria: entry ? entry.name : (catName || ''),
      grupo: grupo,
      monto: round2(monto),
      cuenta: resolveAccount_(r.medio),
      medio: cleanLabel(r.medio) || 'Sin medio',
      descripcion: cleanLabel(r.descripcion),
      excluded: excluded
    });
  });

  if (skipped) warnings.push(skipped + ' fila(s) ignoradas por fecha, tipo o monto inválido.');
  const unknown = Object.keys(unknownCats);
  if (unknown.length) warnings.push('Categorías sin grupo en el catálogo: ' + unknown.join(', ') + '.');

  out.sort(function (a, b) { return a.date - b.date; });
  return out;
}
