/**
 * FinanceService.gs
 * Cálculos financieros. Funciones puras: reciben el dataset y devuelven datos listos
 * para el frontend. No leen Sheets (eso es responsabilidad de DataService.gs).
 *
 * Definiciones:
 *   Flujo neto        = Ingresos − Gastos
 *   Tasa de ahorro    = Flujo neto / Ingresos × 100
 *   % presupuesto     = Gasto real / Presupuesto × 100
 *   Por cobrar        = Gastos del trabajo − Reembolsos recibidos
 *   Patrimonio neto   = Activos (Banco + Efectivo + Por cobrar) − Pasivos (Tarjeta)
 *   Libre del mes     = Ingresos − Gastos − Fijos pendientes − Aporte a fondos (compras periódicas no hechas este mes)
 *   Fondo periódico   = (Costo ÷ Meses que dura) × meses transcurridos desde la última compra (tope: el costo)
 *   Ritmo             = Gasto acumulado del mes vs. el mes anterior al mismo día
 *   Proyección        = Gastado + (gasto variable diario × días restantes) + fijos pendientes
 *                       (el gasto variable excluye fijos y compras periódicas, que no se repiten a diario)
 * Retiros, depósitos, gastos del trabajo y reembolsos NO cuentan como ingreso ni gasto.
 */

/** Punto de entrada: arma el objeto consolidado del dashboard. */
function buildDashboard_(dataset, rawFilters) {
  const today = now_();
  const filters = resolveFilters_(rawFilters, dataset, today);
  const ctx = {
    dataset: dataset,
    filters: filters,
    today: today,
    settings: dataset.settings,
    periods: periodsOf_(filters),
    prevPeriods: periodsOf_(previousFilters_(filters))
  };

  const filtered = applyFilters_(dataset.movements, filters);
  const current = inPeriods_(filtered, ctx.periods);
  const previous = inPeriods_(filtered, ctx.prevPeriods);

  const fixed = calculateFixedExpenses_(ctx);
  const budget = calculateBudget_(ctx, fixed);
  const balances = calculateBalances_(dataset);
  const summary = summarize_(current);
  const prevSummary = summarize_(previous);

  const result = {
    filters: filters,
    kpis: calculateKPIs_(ctx, summary, prevSummary, balances, fixed, budget),
    monthly: calculateMonthlySeries_(ctx, filtered),
    categories: calculateCategories_(current, previous),
    accounts: calculateExpensesByAccount_(current),
    budget: budget,
    fixed: fixed,
    balances: balances,
    topExpenses: topExpenses_(current, 5),
    movements: serializeMovements_(current),
    pace: calculatePace_(ctx, filtered, fixed, budget),
    daily: calculateDaily_(ctx, filtered, 15),
    meta: buildMeta_(ctx)
  };
  result.alerts = buildAlerts_(result, ctx);
  return result;
}

/* ------------------------------------------------------------------ */
/* Filtros y periodos                                                  */
/* ------------------------------------------------------------------ */

function resolveFilters_(raw, dataset, today) {
  raw = raw || {};
  const year = parseInt(raw.year, 10) || today.getFullYear();
  let month = raw.month === undefined || raw.month === null || raw.month === ''
    ? today.getMonth() + 1
    : parseInt(raw.month, 10);
  if (!(month >= 0 && month <= 12)) month = 0;
  return {
    year: year,
    month: month, // 0 = todo el año
    cuenta: raw.cuenta || '',
    grupo: raw.grupo || '',
    tipo: raw.tipo || ''
  };
}

/** Lista de claves 'yyyy-MM' que abarca el filtro. */
function periodsOf_(f) {
  if (f.month) return [f.year + '-' + pad2(f.month)];
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(f.year + '-' + pad2(m));
  return out;
}

function previousFilters_(f) {
  if (!f.month) return Object.assign({}, f, { year: f.year - 1 });
  const prev = shiftPeriod(f.year + '-' + pad2(f.month), -1).split('-');
  return Object.assign({}, f, { year: +prev[0], month: +prev[1] });
}

function applyFilters_(movements, f) {
  return movements.filter(function (m) {
    if (f.cuenta && m.cuenta !== f.cuenta) return false;
    if (f.tipo && m.tipo !== f.tipo) return false;
    if (f.grupo && m.grupo !== f.grupo) return false;
    return true;
  });
}

function inPeriods_(movements, periods) {
  const set = {};
  periods.forEach(function (p) { set[p] = true; });
  return movements.filter(function (m) { return set[m.period]; });
}

function isIncome_(m) { return m.tipo === 'ingreso' && !m.excluded; }
function isExpense_(m) { return m.tipo === 'gasto' && !m.excluded; }

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

function summarize_(list) {
  let income = 0, expenses = 0, work = 0, refunds = 0, count = 0;
  list.forEach(function (m) {
    if (isIncome_(m)) { income += m.monto; count++; }
    else if (isExpense_(m)) { expenses += m.monto; count++; }
    else if (m.tipo === 'gasto_trabajo') work += m.monto;
    else if (m.tipo === 'reembolso') refunds += m.monto;
  });
  return {
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    savingsRate: pct(income - expenses, income),
    work: round2(work),
    refunds: round2(refunds),
    count: count
  };
}

function calculateKPIs_(ctx, s, p, balances, fixed, budget) {
  const f = ctx.filters;
  const kpis = {
    income: compare(s.income, p.income),
    expenses: compare(s.expenses, p.expenses),
    net: compare(s.net, p.net),
    savingsRate: {
      value: s.savingsRate,
      prev: p.savingsRate,
      delta: s.savingsRate !== null && p.savingsRate !== null ? round2(s.savingsRate - p.savingsRate) : null
    },
    available: { value: balances.current.disponible },
    receivable: { value: balances.current.porCobrar },
    netWorth: { value: balances.current.patrimonio },
    dailyAverage: { value: dailyAverage_(ctx, s.expenses) },
    free: null
  };

  // "Libre del mes" solo tiene sentido en vista mensual.
  if (f.month) {
    let income = s.income;
    let estimated = false;
    const salary = ctx.settings.sueldoEsperado || 0;
    if (salary > 0 && !f.cuenta && !f.tipo && !f.grupo) {
      const hasSalary = ctx.dataset.movements.some(function (m) {
        return m.period === ctx.periods[0] && isIncome_(m) &&
          normalizeText(m.categoria) === normalizeText(CONFIG.SALARY_CATEGORY);
      });
      if (!hasSalary) { income += salary; estimated = true; }
    }
    const pending = fixed.totals.pendiente;
    // Aporte del mes a los fondos de compras periódicas que no se compraron este mes.
    const funds = round2(budget.periodic.reduce(function (sum, x) {
      return sum + (x.compradoEnPeriodo ? 0 : x.mensual);
    }, 0));
    kpis.free = {
      value: round2(income - s.expenses - pending - funds),
      income: round2(income),
      expenses: s.expenses,
      pendingFixed: pending,
      funds: funds,
      estimated: estimated
    };
  }
  return kpis;
}

/** Gasto promedio por día del periodo (días transcurridos si es el periodo actual). */
function dailyAverage_(ctx, expenses) {
  const f = ctx.filters;
  const today = ctx.today;
  let days;
  if (f.month) {
    const dim = daysInMonth(f.year, f.month);
    const isCurrent = f.year === today.getFullYear() && f.month === today.getMonth() + 1;
    days = isCurrent ? today.getDate() : dim;
  } else {
    const start = new Date(f.year, 0, 1);
    const end = f.year === today.getFullYear() ? today : new Date(f.year, 11, 31);
    days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  }
  return days > 0 ? round2(expenses / days) : 0;
}

/* ------------------------------------------------------------------ */
/* Series y desgloses                                                  */
/* ------------------------------------------------------------------ */

/** Últimos 12 meses hasta el mes elegido (o enero–diciembre en vista anual). */
function calculateMonthlySeries_(ctx, filtered) {
  const f = ctx.filters;
  const end = f.month ? f.year + '-' + pad2(f.month) : f.year + '-12';
  const keys = [];
  for (let i = 11; i >= 0; i--) keys.push(shiftPeriod(end, -i));

  const buckets = {};
  keys.forEach(function (k) { buckets[k] = { income: 0, expenses: 0 }; });
  filtered.forEach(function (m) {
    const b = buckets[m.period];
    if (!b) return;
    if (isIncome_(m)) b.income += m.monto;
    else if (isExpense_(m)) b.expenses += m.monto;
  });

  return keys.map(function (k) {
    const b = buckets[k];
    return {
      period: k,
      label: periodLabel(k, true),
      income: round2(b.income),
      expenses: round2(b.expenses),
      net: round2(b.income - b.expenses)
    };
  });
}

/** Gastos por grupo con sus categorías, y variación vs. periodo anterior. */
function calculateCategories_(current, previous) {
  const groups = {};
  let total = 0;
  current.filter(isExpense_).forEach(function (m) {
    const g = groups[m.grupo] || (groups[m.grupo] = { name: m.grupo, total: 0, count: 0, children: {} });
    const catName = m.categoria || 'Sin categoría';
    const c = g.children[catName] || (g.children[catName] = { name: catName, total: 0, count: 0 });
    g.total += m.monto; g.count++;
    c.total += m.monto; c.count++;
    total += m.monto;
  });

  const prevByGroup = {};
  previous.filter(isExpense_).forEach(function (m) {
    prevByGroup[m.grupo] = (prevByGroup[m.grupo] || 0) + m.monto;
  });

  const list = Object.keys(groups).map(function (k) {
    const g = groups[k];
    const prev = round2(prevByGroup[k] || 0);
    return {
      name: g.name,
      total: round2(g.total),
      count: g.count,
      share: pct(g.total, total),
      prev: prev,
      deltaPct: prev > 0 ? round2((g.total - prev) / prev * 100) : null,
      children: Object.keys(g.children).map(function (ck) {
        const c = g.children[ck];
        return { name: c.name, total: round2(c.total), count: c.count, share: pct(c.total, g.total) };
      }).sort(function (a, b) { return b.total - a.total; })
    };
  }).sort(function (a, b) { return b.total - a.total; });

  return { total: round2(total), groups: list };
}

function calculateExpensesByAccount_(current) {
  const acc = {};
  let total = 0;
  current.filter(isExpense_).forEach(function (m) {
    acc[m.cuenta] = (acc[m.cuenta] || 0) + m.monto;
    total += m.monto;
  });
  return Object.keys(acc).map(function (k) {
    return { key: k, name: ACCOUNTS[k].label, total: round2(acc[k]), share: pct(acc[k], total) };
  }).sort(function (a, b) { return b.total - a.total; });
}

function topExpenses_(current, n) {
  return serializeMovements_(current.filter(isExpense_)
    .slice().sort(function (a, b) { return b.monto - a.monto; }).slice(0, n));
}

/** Convierte movimientos a objetos planos (google.script.run no admite Date). */
function serializeMovements_(list) {
  return list.slice().sort(function (a, b) { return b.date - a.date; })
    .slice(0, CONFIG.MAX_TABLE_ROWS)
    .map(function (m) {
      const d = new Date(m.date);
      return {
        id: m.id,
        fecha: formatDateISO(d),
        fechaTexto: formatDateShort(d),
        period: m.period,
        tipo: m.tipo,
        tipoLabel: MOVEMENT_TYPES[m.tipo].label,
        categoria: m.categoria,
        grupo: m.grupo,
        monto: m.monto,
        cuenta: m.cuenta,
        cuentaLabel: ACCOUNTS[m.cuenta].label,
        medio: m.medio,
        descripcion: m.descripcion,
        excluded: m.excluded
      };
    });
}

/* ------------------------------------------------------------------ */
/* Gastos fijos                                                        */
/* ------------------------------------------------------------------ */

/**
 * Checklist de gastos fijos del mes elegido (o del mes actual en vista anual).
 * Un fijo está pagado si existe un gasto de su categoría en ese mes con monto
 * dentro de la tolerancia configurada.
 */
function calculateFixedExpenses_(ctx) {
  const f = ctx.filters;
  const today = ctx.today;
  const year = f.month ? f.year : (f.year === today.getFullYear() ? today.getFullYear() : f.year);
  const month = f.month || (f.year === today.getFullYear() ? today.getMonth() + 1 : 12);
  const period = year + '-' + pad2(month);
  const currentPeriod = periodKey(today);
  const tolerance = ctx.settings.toleranciaFijos;
  const dim = daysInMonth(year, month);

  const candidates = ctx.dataset.movements.filter(function (m) { return m.period === period && isExpense_(m); });
  const used = {};

  const items = ctx.dataset.fixed.filter(function (x) {
    return x.activo && normalizeText(x.frecuencia) !== 'anual';
  }).map(function (x) {
    const key = normalizeText(x.categoria);
    const sameCat = candidates.filter(function (m) { return normalizeText(m.categoria) === key && !used[m.id]; });
    const match = sameCat.filter(function (m) { return Math.abs(m.monto - x.monto) <= x.monto * tolerance; })[0];
    const dueDay = Math.min(x.dia, dim);
    const item = {
      concepto: x.concepto,
      categoria: x.categoria,
      monto: round2(x.monto),
      dia: x.dia,
      vence: pad2(dueDay) + '/' + pad2(month),
      estado: 'pendiente',
      diasRestantes: null,
      pagadoMonto: null,
      pagadoFecha: null,
      nota: ''
    };

    if (match) {
      used[match.id] = true;
      item.estado = 'pagado';
      item.pagadoMonto = match.monto;
      item.pagadoFecha = formatDateShort(new Date(match.date));
      return item;
    }

    if (period < currentPeriod) {
      item.estado = 'vencido';
    } else if (period === currentPeriod) {
      const diff = dueDay - today.getDate();
      item.diasRestantes = diff;
      item.estado = diff < 0 ? 'vencido' : 'pendiente';
    }
    if (sameCat.length) {
      item.nota = 'Hay un gasto de ' + x.categoria + ' por S/ ' + sameCat[0].monto.toFixed(2) +
        ' que no coincide con el monto esperado.';
    }
    return item;
  }).sort(function (a, b) { return a.dia - b.dia; });

  const totals = { total: 0, pagado: 0, pendiente: 0, vencidos: 0 };
  items.forEach(function (i) {
    totals.total += i.monto;
    if (i.estado === 'pagado') totals.pagado += i.monto;
    else { totals.pendiente += i.monto; if (i.estado === 'vencido') totals.vencidos++; }
  });
  Object.keys(totals).forEach(function (k) { if (k !== 'vencidos') totals[k] = round2(totals[k]); });

  return { period: period, periodLabel: periodLabel(period), items: items, totals: totals };
}

/* ------------------------------------------------------------------ */
/* Presupuesto                                                         */
/* ------------------------------------------------------------------ */

/**
 * Presupuesto por categoría (variables desde Presupuestos + fijos desde Gastos Fijos),
 * agrupado por grupo. En vista anual se multiplica por los meses transcurridos.
 */
function calculateBudget_(ctx) {
  const f = ctx.filters;
  const s = ctx.settings;
  const today = ctx.today;
  const catalog = ctx.dataset.catalog;

  // En vista anual solo cuentan los meses con registros (desde el primer movimiento hasta hoy).
  let months = 1;
  if (!f.month) {
    const first = ctx.dataset.movements.length ? ctx.dataset.movements[0].period : periodKey(today);
    const current = periodKey(today);
    months = ctx.periods.filter(function (p) { return p >= first && p <= current; }).length;
  }

  const lines = {};
  function addLine(categoria, monto, fijo) {
    const key = normalizeText(categoria);
    const entry = catalog[key];
    const line = lines[key] || (lines[key] = {
      categoria: entry ? entry.name : categoria,
      grupo: entry ? entry.group : 'Sin grupo',
      presupuesto: 0,
      fijo: false
    });
    line.presupuesto += monto * months;
    if (fijo) line.fijo = true;
  }
  const periodicKeys = {};
  ctx.dataset.budget.forEach(function (b) {
    if (b.meses > 1) { periodicKeys[normalizeText(b.categoria)] = true; return; }
    addLine(b.categoria, b.monto, false);
  });
  ctx.dataset.fixed.forEach(function (x) {
    if (x.activo && normalizeText(x.frecuencia) !== 'anual') addLine(x.categoria, x.monto, true);
  });

  // Gasto real del periodo (solo filtro de grupo; el presupuesto es por categoría, no por medio).
  const spent = {};
  const unbudgeted = {};
  inPeriods_(ctx.dataset.movements, ctx.periods).filter(isExpense_).forEach(function (m) {
    if (f.grupo && m.grupo !== f.grupo) return;
    const key = normalizeText(m.categoria);
    if (periodicKeys[key]) return; // las compras periódicas se evalúan contra su fondo
    spent[key] = (spent[key] || 0) + m.monto;
    if (!lines[key]) {
      const u = unbudgeted[key] || (unbudgeted[key] = { categoria: m.categoria || 'Sin categoría', grupo: m.grupo, gastado: 0 });
      u.gastado += m.monto;
    }
  });

  // Ritmo: porcentaje del mes transcurrido (solo mes en curso).
  const isCurrentMonth = f.month && f.year === today.getFullYear() && f.month === today.getMonth() + 1;
  const monthProgress = isCurrentMonth ? round2(today.getDate() / daysInMonth(f.year, f.month) * 100) : null;

  /** Variables: advertencia desde el umbral, excedido al superarlo. Fijos: excedido solo fuera de la tolerancia. */
  function status(p, fijo) {
    if (p === null) return 'ok';
    if (fijo) return p > 100 + s.toleranciaFijos * 100 ? 'excedido' : 'ok';
    if (p > s.umbralExcedido) return 'excedido';
    if (p >= s.umbralAdvertencia) return 'advertencia';
    return 'ok';
  }

  function worstStatus(items) {
    const rank = { ok: 0, advertencia: 1, excedido: 2 };
    return items.reduce(function (w, it) { return rank[it.estado] > rank[w] ? it.estado : w; }, 'ok');
  }

  const groups = {};
  Object.keys(lines).forEach(function (key) {
    const l = lines[key];
    if (f.grupo && l.grupo !== f.grupo) return;
    const gastado = round2(spent[key] || 0);
    const used = pct(gastado, l.presupuesto);
    const row = {
      categoria: l.categoria,
      grupo: l.grupo,
      presupuesto: round2(l.presupuesto),
      gastado: gastado,
      disponible: round2(l.presupuesto - gastado),
      pct: used,
      estado: status(used, l.fijo),
      fijo: l.fijo,
      ritmoAlto: !l.fijo && monthProgress !== null && used !== null && used < s.umbralAdvertencia &&
        used > monthProgress + 15
    };
    const g = groups[l.grupo] || (groups[l.grupo] = { grupo: l.grupo, presupuesto: 0, gastado: 0, items: [] });
    g.presupuesto += row.presupuesto;
    g.gastado += row.gastado;
    g.items.push(row);
  });

  const unbudgetedList = Object.keys(unbudgeted).map(function (k) {
    const u = unbudgeted[k]; u.gastado = round2(u.gastado); return u;
  }).sort(function (a, b) { return b.gastado - a.gastado; });

  // Los gastos sin presupuesto se muestran dentro de su grupo (sin barra) para no ocultar el gasto real del grupo.
  unbudgetedList.forEach(function (u) {
    const g = groups[u.grupo];
    if (!g) return;
    (g.sinPresupuestoItems || (g.sinPresupuestoItems = [])).push(u);
    g.sinPresupuesto = (g.sinPresupuesto || 0) + u.gastado;
  });

  const groupList = Object.keys(groups).map(function (k) {
    const g = groups[k];
    const used = pct(g.gastado, g.presupuesto);
    g.items.sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });
    return {
      grupo: g.grupo,
      presupuesto: round2(g.presupuesto),
      gastado: round2(g.gastado),
      disponible: round2(g.presupuesto - g.gastado),
      pct: used,
      estado: worstStatus(g.items),
      items: g.items,
      sinPresupuesto: round2(g.sinPresupuesto || 0),
      sinPresupuestoItems: g.sinPresupuestoItems || []
    };
  }).sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });

  const totals = groupList.reduce(function (t, g) {
    t.presupuesto += g.presupuesto; t.gastado += g.gastado; return t;
  }, { presupuesto: 0, gastado: 0 });
  totals.presupuesto = round2(totals.presupuesto);
  totals.gastado = round2(totals.gastado);
  totals.disponible = round2(totals.presupuesto - totals.gastado);
  totals.pct = pct(totals.gastado, totals.presupuesto);
  totals.estado = status(totals.pct);
  totals.sinPresupuesto = round2(unbudgetedList.reduce(function (s, u) { return s + u.gastado; }, 0));

  return {
    months: months,
    monthProgress: monthProgress,
    totals: totals,
    groups: groupList,
    unbudgeted: unbudgetedList,
    periodic: calculatePeriodicFunds_(ctx),
    thresholds: { advertencia: s.umbralAdvertencia, excedido: s.umbralExcedido }
  };
}

/**
 * Fondos de previsión para compras periódicas (ej. suplementos cada 6.94 meses).
 * Se evalúan a la fecha de corte: hoy, o el último día del periodo elegido si es pasado.
 */
function calculatePeriodicFunds_(ctx) {
  const f = ctx.filters;
  const today = ctx.today;
  const lastPeriod = ctx.periods[ctx.periods.length - 1].split('-');
  const periodEnd = new Date(+lastPeriod[0], +lastPeriod[1], 0, 23, 59, 59);
  const asOf = periodEnd < today ? periodEnd : today;
  const dayMs = 86400000;
  const monthMs = CONFIG.DAYS_PER_MONTH * dayMs;
  const periodSet = {};
  ctx.periods.forEach(function (p) { periodSet[p] = true; });
  const firstDate = ctx.dataset.movements.length ? ctx.dataset.movements[0].date : asOf.getTime();

  return ctx.dataset.budget.filter(function (b) { return b.meses > 1; }).map(function (b) {
    const key = normalizeText(b.categoria);
    const entry = ctx.dataset.catalog[key];
    if (f.grupo && entry && entry.group !== f.grupo) return null;
    const purchases = ctx.dataset.movements.filter(function (m) {
      return isExpense_(m) && normalizeText(m.categoria) === key && m.date <= asOf.getTime();
    });
    const last = purchases.length ? purchases[purchases.length - 1] : null;
    const mensual = b.monto / b.meses;
    const since = last ? last.date : firstDate;
    const elapsedMonths = Math.max(0, (asOf.getTime() - since) / monthMs);
    const acumulado = Math.min(b.monto, mensual * elapsedMonths);
    const next = last ? new Date(last.date + b.meses * monthMs) : null;
    const daysToNext = next ? Math.ceil((next.getTime() - asOf.getTime()) / dayMs) : null;
    const gastadoPeriodo = purchases.filter(function (m) { return periodSet[m.period]; })
      .reduce(function (s, m) { return s + m.monto; }, 0);
    const pctFondo = pct(acumulado, b.monto);

    let estado = 'ok';
    if (daysToNext !== null && daysToNext <= 30 && acumulado < b.monto * 0.9) estado = 'advertencia';
    if (daysToNext !== null && daysToNext < 0) estado = 'excedido';

    return {
      categoria: entry ? entry.name : b.categoria,
      grupo: entry ? entry.group : 'Sin grupo',
      costo: round2(b.monto),
      meses: round2(b.meses),
      mensual: round2(mensual),
      acumulado: round2(acumulado),
      pct: pctFondo,
      estado: estado,
      ultimaCompra: last ? formatDateShort(new Date(last.date)) : null,
      ultimaCompraMonto: last ? last.monto : null,
      proximaCompra: next ? formatDateShort(next) : null,
      proximaLabel: next ? MONTH_NAMES[next.getMonth()].toLowerCase() + ' ' + next.getFullYear() : null,
      diasParaProxima: daysToNext,
      gastadoPeriodo: round2(gastadoPeriodo),
      compradoEnPeriodo: gastadoPeriodo > 0
    };
  }).filter(Boolean).sort(function (a, b) {
    return (a.diasParaProxima === null ? 1e9 : a.diasParaProxima) - (b.diasParaProxima === null ? 1e9 : b.diasParaProxima);
  });
}

/* ------------------------------------------------------------------ */
/* Ritmo, proyección y gasto diario (app móvil)                        */
/* ------------------------------------------------------------------ */

function dayKey_(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

/** Suma de gastos por día del mes de un periodo 'yyyy-MM' → arreglo [día1..díaN]. */
function dailyExpenseTotals_(list, period, days) {
  const totals = [];
  for (let i = 0; i < days; i++) totals.push(0);
  list.forEach(function (m) {
    if (!isExpense_(m) || m.period !== period) return;
    const d = new Date(m.date).getDate();
    if (d >= 1 && d <= days) totals[d - 1] += m.monto;
  });
  return totals;
}

function cumulative_(arr) {
  let acc = 0;
  return arr.map(function (v) { acc += v; return round2(acc); });
}

/**
 * Ritmo del mes: gasto acumulado día a día frente al mes anterior y proyección de cierre.
 * Solo aplica a vista mensual.
 */
function calculatePace_(ctx, filtered, fixed, budget) {
  const f = ctx.filters;
  if (!f.month) return null;
  const today = ctx.today;
  const period = f.year + '-' + pad2(f.month);
  const prevPeriod = shiftPeriod(period, -1);
  const prevParts = prevPeriod.split('-');
  const dim = daysInMonth(f.year, f.month);
  const prevDim = daysInMonth(+prevParts[0], +prevParts[1]);
  const currentPeriod = periodKey(today);
  const isCurrent = period === currentPeriod;
  const dayLimit = isCurrent ? today.getDate() : (period < currentPeriod ? dim : 0);

  const curDaily = dailyExpenseTotals_(filtered, period, dim).slice(0, dayLimit);
  const prevDaily = dailyExpenseTotals_(filtered, prevPeriod, prevDim);
  const curCum = cumulative_(curDaily);
  const prevCum = cumulative_(prevDaily);
  const spent = curCum.length ? curCum[curCum.length - 1] : 0;
  const sameDay = Math.min(dayLimit, prevDim);
  const prevSameDay = sameDay > 0 ? prevCum[sameDay - 1] : 0;
  const prevTotal = prevCum.length ? prevCum[prevCum.length - 1] : 0;

  let projection = null;
  let detail = null;
  if (isCurrent && dayLimit > 0) {
    // Categorías que no se repiten a diario: gastos fijos y compras periódicas.
    const excluded = {};
    ctx.dataset.fixed.forEach(function (x) { if (x.activo) excluded[normalizeText(x.categoria)] = true; });
    ctx.dataset.budget.forEach(function (b) { if (b.meses > 1) excluded[normalizeText(b.categoria)] = true; });
    const variable = filtered.filter(function (m) {
      return isExpense_(m) && m.period === period && new Date(m.date).getDate() <= dayLimit &&
        !excluded[normalizeText(m.categoria)];
    }).reduce(function (s, m) { return s + m.monto; }, 0);
    const daily = variable / dayLimit;
    const remainingDays = dim - dayLimit;
    const pendingFixed = (!f.cuenta && !f.tipo && !f.grupo) ? fixed.totals.pendiente : 0;
    projection = round2(spent + daily * remainingDays + pendingFixed);
    detail = {
      gastado: spent,
      variableDiario: round2(daily),
      diasRestantes: remainingDays,
      fijosPendientes: round2(pendingFixed)
    };
  }

  return {
    period: period,
    label: periodLabel(period),
    prevLabel: periodLabel(prevPeriod),
    daysInMonth: dim,
    prevDaysInMonth: prevDim,
    dayLimit: dayLimit,
    isCurrent: isCurrent,
    current: curCum,
    previous: prevCum,
    spent: spent,
    prevSameDay: round2(prevSameDay),
    prevTotal: round2(prevTotal),
    deltaPct: prevSameDay > 0 ? round2((spent - prevSameDay) / prevSameDay * 100) : null,
    projection: projection,
    projectionDetail: detail
  };
}

/** Gasto por día de los últimos N días hasta hoy (o hasta el cierre del mes elegido si es pasado). */
function calculateDaily_(ctx, filtered, n) {
  const f = ctx.filters;
  const today = ctx.today;
  let end = today;
  if (f.month) {
    const monthEnd = new Date(f.year, f.month, 0);
    if (monthEnd < today) end = monthEnd;
  } else if (f.year < today.getFullYear()) {
    end = new Date(f.year, 11, 31);
  }
  const letters = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const days = [];
  const index = {};
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const key = dayKey_(d);
    index[key] = days.length;
    days.push({ date: key, day: d.getDate(), dow: letters[d.getDay()], total: 0, count: 0 });
  }
  filtered.forEach(function (m) {
    if (!isExpense_(m)) return;
    const i = index[dayKey_(new Date(m.date))];
    if (i === undefined) return;
    days[i].total += m.monto;
    days[i].count++;
  });
  days.forEach(function (d) { d.total = round2(d.total); });
  return days;
}

/* ------------------------------------------------------------------ */
/* Saldos y patrimonio                                                 */
/* ------------------------------------------------------------------ */

/** Efecto de un movimiento en cada cuenta (usa la fecha real, no el periodo contable). */
function applyMovementToBalance_(bal, m) {
  switch (m.tipo) {
    case 'ingreso':
    case 'reembolso':
      if (m.cuenta === 'credito') bal.credito -= m.monto; else bal[m.cuenta] += m.monto;
      if (m.tipo === 'reembolso') bal.porCobrar -= m.monto;
      break;
    case 'gasto':
    case 'gasto_trabajo':
      if (m.cuenta === 'credito') bal.credito += m.monto; else bal[m.cuenta] -= m.monto;
      if (m.tipo === 'gasto_trabajo') bal.porCobrar += m.monto;
      break;
    case 'retiro':
      bal.banco -= m.monto; bal.efectivo += m.monto;
      break;
    case 'deposito':
      bal.efectivo -= m.monto; bal.banco += m.monto;
      break;
    default:
      // Movimiento interno sin dirección conocida: no altera saldos.
      break;
  }
}

function snapshot_(bal) {
  const disponible = bal.banco + bal.efectivo;
  const activos = disponible + Math.max(0, bal.porCobrar);
  const pasivos = Math.max(0, bal.credito);
  return {
    banco: round2(bal.banco),
    efectivo: round2(bal.efectivo),
    credito: round2(bal.credito),
    porCobrar: round2(bal.porCobrar),
    disponible: round2(disponible),
    activos: round2(activos),
    pasivos: round2(pasivos),
    patrimonio: round2(activos - pasivos)
  };
}

function calculateBalances_(dataset) {
  const s = dataset.settings;
  const bal = { banco: s.saldoInicialBanco || 0, efectivo: s.saldoInicialEfectivo || 0, credito: 0, porCobrar: 0 };
  const movements = dataset.movements; // ordenados por fecha
  const history = [];
  let cursor = movements.length ? periodKey(new Date(movements[0].date)) : periodKey(now_());
  const last = periodKey(now_());

  let i = 0;
  while (cursor <= last) {
    while (i < movements.length && periodKey(new Date(movements[i].date)) <= cursor) {
      applyMovementToBalance_(bal, movements[i]);
      i++;
    }
    const snap = snapshot_(bal);
    snap.period = cursor;
    snap.label = periodLabel(cursor, true);
    history.push(snap);
    cursor = shiftPeriod(cursor, 1);
  }
  // Movimientos con fecha futura (poco común) se aplican al saldo actual.
  while (i < movements.length) { applyMovementToBalance_(bal, movements[i]); i++; }

  return { current: snapshot_(bal), history: history.slice(-24), hasCredit: bal.credito !== 0 };
}

/* ------------------------------------------------------------------ */
/* Alertas y metadatos                                                 */
/* ------------------------------------------------------------------ */

function money_(n) { return CONFIG.CURRENCY_SYMBOL + ' ' + Number(n).toFixed(2); }

function buildAlerts_(r, ctx) {
  const alerts = [];
  r.fixed.items.forEach(function (i) {
    if (i.estado === 'vencido') {
      alerts.push({ level: 'danger', view: 'fijos', title: i.concepto + ' sin registrar',
        detail: 'Vencía el ' + i.vence + ' (' + money_(i.monto) + '). Si ya lo pagaste, regístralo en el Form.' });
    } else if (i.estado === 'pendiente' && i.diasRestantes !== null && i.diasRestantes <= 3) {
      alerts.push({ level: 'warning', view: 'fijos', title: i.concepto + ' vence pronto',
        detail: (i.diasRestantes === 0 ? 'Vence hoy' : 'Vence en ' + i.diasRestantes + ' día(s)') + ' · ' + money_(i.monto) });
    }
  });
  r.budget.groups.forEach(function (g) {
    g.items.forEach(function (it) {
      if (it.estado === 'excedido') {
        alerts.push({ level: 'danger', view: 'presupuesto', title: it.categoria + ' excedido',
          detail: 'Gastaste ' + money_(it.gastado) + ' de ' + money_(it.presupuesto) + ' (' + Math.round(it.pct) + '%).' });
      } else if (it.estado === 'advertencia') {
        alerts.push({ level: 'warning', view: 'presupuesto', title: it.categoria + ' cerca del límite',
          detail: 'Llevas ' + Math.round(it.pct) + '% · quedan ' + money_(it.disponible) + '.' });
      } else if (it.ritmoAlto) {
        alerts.push({ level: 'warning', view: 'presupuesto', title: 'Ritmo alto en ' + it.categoria,
          detail: 'Usaste ' + Math.round(it.pct) + '% con ' + Math.round(r.budget.monthProgress) + '% del mes transcurrido.' });
      }
    });
  });
  r.budget.periodic.forEach(function (x) {
    if (x.diasParaProxima === null || x.compradoEnPeriodo) return;
    if (x.diasParaProxima < 0) {
      alerts.push({ level: 'warning', view: 'presupuesto', title: 'Toca comprar ' + x.categoria,
        detail: 'Según su duración debía reponerse el ' + x.proximaCompra + '. Fondo: ' + money_(x.acumulado) + ' de ' + money_(x.costo) + '.' });
    } else if (x.diasParaProxima <= 30) {
      alerts.push({ level: x.estado === 'advertencia' ? 'warning' : 'info', view: 'presupuesto', title: x.categoria + ' en ~' + x.diasParaProxima + ' días',
        detail: 'Próxima compra cerca del ' + x.proximaCompra + '. Fondo: ' + money_(x.acumulado) + ' de ' + money_(x.costo) + '.' });
    }
  });
  if (r.kpis.net.value < 0 && r.kpis.income.value > 0) {
    alerts.push({ level: 'danger', view: 'resumen', title: 'Flujo negativo',
      detail: 'Este periodo gastas ' + money_(-r.kpis.net.value) + ' más de lo que ingresa.' });
  }
  if (r.kpis.free && r.kpis.free.value < 0) {
    alerts.push({ level: 'danger', view: 'resumen', title: 'No alcanza para el mes',
      detail: 'Con los fijos pendientes te faltarían ' + money_(-r.kpis.free.value) + '.' });
  }
  if (r.balances.current.porCobrar > 0) {
    alerts.push({ level: 'info', view: 'saldos', title: 'Reembolsos pendientes',
      detail: 'El trabajo te debe ' + money_(r.balances.current.porCobrar) + '.' });
  }
  ctx.dataset.warnings.forEach(function (w) {
    alerts.push({ level: 'info', view: 'ajustes', title: 'Revisar datos', detail: w });
  });
  const order = { danger: 0, warning: 1, info: 2 };
  return alerts.sort(function (a, b) { return order[a.level] - order[b.level]; });
}

function buildMeta_(ctx) {
  const d = ctx.dataset;
  const years = {};
  years[ctx.today.getFullYear()] = true;
  const groups = {};
  const accounts = {};
  d.movements.forEach(function (m) {
    years[m.period.slice(0, 4)] = true;
    if (m.grupo) groups[m.grupo] = true;
    accounts[m.cuenta] = true;
  });
  Object.keys(d.catalog).forEach(function (k) { groups[d.catalog[k].group] = true; });

  return {
    years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; }),
    groups: Object.keys(groups).sort(),
    accounts: Object.keys(accounts).map(function (k) { return { key: k, label: ACCOUNTS[k].label }; }),
    types: Object.keys(MOVEMENT_TYPES).filter(function (k) { return k !== 'interno'; })
      .map(function (k) { return { key: k, label: MOVEMENT_TYPES[k].label }; }),
    periodLabel: ctx.filters.month ? periodLabel(ctx.periods[0]) : 'Año ' + ctx.filters.year,
    prevLabel: ctx.filters.month ? periodLabel(ctx.prevPeriods[0]) : 'Año ' + (ctx.filters.year - 1),
    today: formatDateShort(ctx.today),
    generatedAt: formatDateISO(ctx.today),
    loadedAt: formatDateISO(new Date(d.loadedAt)),
    sheetName: d.sheetName,
    totalMovements: d.movements.length,
    warnings: d.warnings,
    settings: {
      diaSueldoMesSiguiente: ctx.settings.diaSueldoMesSiguiente,
      umbralAdvertencia: ctx.settings.umbralAdvertencia,
      umbralExcedido: ctx.settings.umbralExcedido,
      toleranciaFijos: ctx.settings.toleranciaFijos,
      sueldoEsperado: ctx.settings.sueldoEsperado,
      saldoInicialBanco: ctx.settings.saldoInicialBanco,
      saldoInicialEfectivo: ctx.settings.saldoInicialEfectivo
    },
    currency: CONFIG.CURRENCY_SYMBOL,
    fromCache: false
  };
}
