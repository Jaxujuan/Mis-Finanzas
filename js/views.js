/* =========================================================
   views.js · pantallas (solo presentan; los cálculos vienen del servidor)
   ========================================================= */
const Views = (function () {
  const $ = function (id) { return document.getElementById(id); };
  const esc = UI.esc, money = UI.money;

  function monthShort(label) { return String(label || '').split(' ')[0].toLowerCase(); }

  /* ---------------------------- Inicio ---------------------------- */
  function home(d) {
    const k = d.kpis, p = d.pace;
    const monthly = d.filters.month > 0;
    const spent = p ? p.spent : k.expenses.value;
    const parts = UI.moneyParts(spent);

    let meta = '';
    if (p && p.deltaPct !== null) {
      meta += UI.deltaPill(p.deltaPct, false) + '<span>vs ' + esc(monthShort(p.prevLabel)) + (p.isCurrent ? ' a esta fecha' : '') + '</span>';
    } else if (!monthly && k.expenses.deltaPct !== null) {
      meta += UI.deltaPill(k.expenses.deltaPct, false) + '<span>vs ' + esc(d.meta.prevLabel.toLowerCase()) + '</span>';
    } else {
      meta += '<span class="pill neutral">Sin comparación</span>';
    }

    let chart = '';
    if (p && (p.current.length || p.previous.length)) {
      chart = '<div class="chart-box"><canvas id="chartPace"></canvas></div>' +
        '<div class="legend-inline"><span><i style="background:var(--primary)"></i>' + esc(monthShort(p.label)) + '</span>' +
        '<span><i style="background:var(--chart-prev)"></i>' + esc(monthShort(p.prevLabel)) + '</span>' +
        (p.projection !== null ? '<span><i style="background:repeating-linear-gradient(90deg,var(--primary) 0 4px,transparent 4px 7px)"></i>proyección</span>' : '') + '</div>';
    }
    const projection = p && p.projection !== null
      ? '<button class="projection" data-action="projection"><span>A este ritmo cerrarás en</span><b class="num">' + money(p.projection) + ' ›</b></button>'
      : '';

    const hero = '<div class="card hero">' +
      '<div class="hero-label">' + (monthly ? 'Gastado en ' + esc(monthShort(d.meta.periodLabel)) : 'Gastado en ' + esc(d.meta.periodLabel.toLowerCase())) + '</div>' +
      '<div class="hero-amount num"><small>S/</small>' + parts.value + '</div>' +
      '<div class="hero-meta">' + meta + '</div>' + chart + projection + '</div>';

    const free = k.free;
    const freeCard = free
      ? '<button class="card mini accent' + (free.value < 0 ? ' negative' : '') + '" data-action="free" style="border:0;text-align:left;width:100%">' +
        '<div class="mini-label">Libre para el mes</div><div class="mini-value num">' + money(free.value) + '</div>' +
        '<div class="mini-foot">Tras fijos y fondos ›</div></button>'
      : '<div class="card mini accent"><div class="mini-label">Flujo neto</div><div class="mini-value num">' + money(k.net.value, { plus: true }) + '</div><div class="mini-foot">Ingresos − gastos</div></div>';
    const minis = '<div class="grid-2" style="margin-bottom:12px">' +
      '<div class="card mini"><div class="mini-label"><span class="dot" style="background:var(--income)"></span>Ingresos</div>' +
      '<div class="mini-value num">' + money(k.income.value) + '</div><div class="mini-foot">Te queda ' + money(k.net.value) + '</div></div>' + freeCard + '</div>';

    const b = d.balances.current;
    const chips = '<div class="chips-row">' +
      chip('🏦 Banco', b.banco) + chip('💵 Efectivo', b.efectivo) +
      (b.porCobrar ? chip('💼 Por cobrar', b.porCobrar) : '') + chip('📈 Patrimonio', b.patrimonio) + '</div>';

    const left = hero + minis + chips + dailyCard(d);
    const right = alertsCard(d) + budgetPreview(d) + fixedPreview(d) + recentCard(d);
    $('view-inicio').innerHTML = '<div class="home-grid"><div>' + left + '</div><div>' + right + '</div></div>';
    if (p && (p.current.length || p.previous.length)) Charts.pace('chartPace', p);
  }

  function chip(label, value) {
    return '<div class="bal-chip"><span>' + label + '</span><b class="num' + (value < 0 ? ' neg' : '') + '">' + money(value) + '</b></div>';
  }

  function dailyCard(d) {
    const days = d.daily || [];
    if (!days.length) return '';
    const max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
    const todayIso = UI.isoDate(new Date());
    const total = days.reduce(function (s, x) { return s + x.total; }, 0);
    const bars = days.map(function (x) {
      const h = x.total > 0 ? Math.max(6, x.total / max * 100) : 3;
      return '<button class="bar-col' + (x.total ? '' : ' zero') + (x.date === todayIso ? ' today' : '') + '" data-action="day" data-date="' + x.date + '" title="' + esc(x.date) + ': ' + money(x.total) + '">' +
        '<span class="b" style="height:' + h + '%"></span><small>' + x.dow + '</small></button>';
    }).join('');
    return '<div class="card"><div class="card-head"><div><h3 class="card-title">Últimos 15 días</h3><div class="card-sub">Toca un día para ver sus gastos</div></div></div>' +
      '<div class="bars">' + bars + '</div>' +
      '<div class="bars-caption"><span>Total ' + money(total) + '</span><span>Promedio ' + money(total / days.length) + '/día</span></div></div>';
  }

  function alertsCard(d) {
    const alerts = (d.alerts || []).filter(function (a) { return a.view !== 'ajustes'; }).slice(0, 4);
    if (!alerts.length) return '';
    return '<div class="card"><div class="card-head"><h3 class="card-title">Requiere tu atención</h3></div>' +
      alerts.map(function (a) {
        return '<button class="alert ' + a.level + '" data-action="goto" data-view="' + (a.view === 'fijos' ? 'presupuesto' : a.view === 'saldos' ? 'mas' : a.view === 'resumen' ? 'inicio' : a.view) + '">' +
          '<div class="alert-ic">' + UI.icon(a.level === 'info' ? 'info' : 'alert') + '</div><div><b>' + esc(a.title) + '</b><span>' + esc(a.detail) + '</span></div></button>';
      }).join('') + '</div>';
  }

  function budgetPreview(d) {
    const items = [];
    d.budget.groups.forEach(function (g) { g.items.forEach(function (it) { if (!it.fijo) items.push(it); }); });
    items.sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });
    if (!items.length) return '';
    return '<div class="card"><div class="card-head"><h3 class="card-title">Presupuestos</h3><button class="link" data-action="goto" data-view="presupuesto">Ver todo</button></div>' +
      items.slice(0, 4).map(function (it) { return budgetItem(it, d.budget.monthProgress); }).join('') + '</div>';
  }

  function budgetItem(it, marker, extraTag) {
    const left = it.disponible >= 0 ? 'Quedan ' + money(it.disponible) : '<span class="neg">Excedido ' + money(-it.disponible) + '</span>';
    return '<div class="budget-item"><div class="budget-top">' + UI.iconBox(it.categoria, it.grupo) +
      '<span class="name">' + esc(it.categoria) + (it.fijo ? '<span class="tag">Fijo</span>' : '') + (it.ritmoAlto ? '<span class="tag warn">Ritmo alto</span>' : '') + (extraTag || '') + '</span>' +
      '<span class="amt num">' + money(it.gastado) + ' / ' + money(it.presupuesto, { short: true }) + '</span></div>' +
      UI.progress(it.pct, it.estado === 'ok' ? '' : it.estado, marker) +
      '<div class="budget-foot"><span>' + UI.pct(it.pct) + '</span><span>' + left + '</span></div></div>';
  }

  function fixedPreview(d) {
    const pending = d.fixed.items.filter(function (i) { return i.estado !== 'pagado'; });
    if (!d.fixed.items.length) return '';
    const body = pending.length
      ? pending.slice(0, 4).map(fixedRow).join('')
      : UI.empty('✅', 'Todo pagado', 'Tus gastos fijos de este mes ya están registrados.');
    return '<div class="card"><div class="card-head"><h3 class="card-title">Próximos pagos</h3><span class="card-sub">' +
      money(d.fixed.totals.pendiente) + ' pendiente</span></div><div class="list">' + body + '</div></div>';
  }

  function fixedRow(i) {
    const sub = i.estado === 'pagado' ? 'Pagado el ' + i.pagadoFecha
      : i.estado === 'vencido' ? 'Vencía el ' + i.vence
        : i.diasRestantes === null ? 'Vence el ' + i.vence
          : i.diasRestantes === 0 ? 'Vence hoy' : 'Vence en ' + i.diasRestantes + ' día' + (i.diasRestantes === 1 ? '' : 's');
    const tag = i.estado === 'pagado' ? '<span class="tag ok">Pagado</span>' : i.estado === 'vencido' ? '<span class="tag warn">Sin registrar</span>' : '';
    return '<div class="row">' + UI.iconBox(i.categoria, '') + '<div class="row-main"><div class="row-title">' + esc(i.concepto) + tag + '</div>' +
      '<div class="row-sub">' + esc(sub) + '</div></div><div class="row-amount num">' + money(i.monto) + '</div></div>';
  }

  function recentCard(d) {
    const list = d.movements.slice(0, 5);
    return '<div class="card"><div class="card-head"><h3 class="card-title">Últimos movimientos</h3><button class="link" data-action="goto" data-view="movimientos">Ver todos</button></div>' +
      (list.length ? '<div class="list">' + list.map(movRow).join('') + '</div>' : UI.empty('🧾', 'Sin movimientos', 'Toca el micrófono para registrar el primero.')) + '</div>';
  }

  function movRow(m) {
    const sign = m.tipo === 'ingreso' ? '+' : m.tipo === 'gasto' ? '−' : '';
    const cls = m.tipo === 'ingreso' ? 'pos' : '';
    const title = m.categoria || m.tipoLabel;
    const sub = [m.descripcion || (m.tipo === 'gasto' || m.tipo === 'ingreso' ? m.grupo : m.tipoLabel), m.medio].filter(Boolean).join(' · ');
    return '<button class="row" data-action="mov" data-id="' + m.id + '">' + UI.iconBox(m.categoria, m.grupo, m.tipo) +
      '<div class="row-main"><div class="row-title">' + esc(title) + '</div><div class="row-sub">' + esc(sub) + '</div></div>' +
      '<div class="row-amount num ' + cls + '">' + sign + money(m.monto) + '<small>' + UI.timeLabel(m.fecha) + '</small></div></button>';
  }

  /* -------------------------- Movimientos -------------------------- */
  function movements(d, st) {
    const t = st.table;
    const q = UI.norm(t.search);
    const rows = d.movements.filter(function (m) {
      if (t.day && m.fecha.slice(0, 10) !== t.day) return false;
      if (t.kind === 'gasto' && m.tipo !== 'gasto') return false;
      if (t.kind === 'ingreso' && m.tipo !== 'ingreso') return false;
      if (t.kind === 'otros' && (m.tipo === 'gasto' || m.tipo === 'ingreso')) return false;
      if (!q) return true;
      return UI.norm([m.categoria, m.grupo, m.descripcion, m.medio, m.tipoLabel, m.monto].join(' ')).indexOf(q) >= 0;
    });
    const groups = [];
    const byDay = {};
    rows.slice(0, t.limit).forEach(function (m) {
      const day = m.fecha.slice(0, 10);
      if (!byDay[day]) { byDay[day] = { day: day, items: [], spent: 0 }; groups.push(byDay[day]); }
      byDay[day].items.push(m);
      if (m.tipo === 'gasto') byDay[day].spent += m.monto;
    });
    const kinds = [['', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos'], ['otros', 'Otros']];
    const total = rows.reduce(function (s, m) { return s + (m.tipo === 'gasto' ? m.monto : 0); }, 0);

    let html = '<div class="card-head" style="margin:4px 2px 10px"><div><h3 class="card-title" style="font-size:20px">Movimientos</h3>' +
      '<div class="card-sub">' + rows.length + ' en ' + esc(d.meta.periodLabel.toLowerCase()) + ' · gastos ' + money(total) + '</div></div>' +
      '<button class="btn" data-action="manual" style="height:40px">' + UI.icon('plus') + 'Agregar</button></div>' +
      '<div class="search">' + UI.icon('search') + '<input id="movSearch" type="search" placeholder="Buscar categoría, lugar, medio…" value="' + esc(t.search) + '"></div>' +
      '<div class="chip-row">' + kinds.map(function (k) {
        return '<button class="chip' + (t.kind === k[0] ? ' active' : '') + '" data-action="kind" data-kind="' + k[0] + '">' + k[1] + '</button>';
      }).join('') + '</div>';
    if (t.day) {
      html += '<div class="filter-note" style="margin-top:10px"><span>' + esc(UI.dayLabel(t.day)) + '</span><button data-action="clearDay">Quitar filtro ✕</button></div>';
    }
    if (!rows.length) {
      html += '<div class="card" style="margin-top:12px">' + UI.empty('🔎', d.movements.length ? 'Sin resultados' : 'Sin movimientos', d.movements.length ? 'Prueba con otra búsqueda.' : 'No hay movimientos registrados en este periodo.') + '</div>';
    } else {
      groups.forEach(function (g) {
        html += '<div class="day-head"><span>' + esc(UI.dayLabel(g.day)) + '</span><span class="num">' + (g.spent ? '−' + money(g.spent) : '') + '</span></div>' +
          '<div class="card" style="padding:4px 14px">' + g.items.map(movRow).join('') + '</div>';
      });
      if (rows.length > t.limit) html += '<button class="btn btn-block" data-action="more">Ver más (' + (rows.length - t.limit) + ')</button>';
    }
    $('view-movimientos').innerHTML = html;
  }

  function movementDetail(m) {
    const row = function (l, v) { return '<div class="stat"><span class="muted">' + l + '</span><span>' + esc(v || '—') + '</span></div>'; };
    const sign = m.tipo === 'ingreso' ? '+' : m.tipo === 'gasto' ? '−' : '';
    return '<div style="display:flex;align-items:center;gap:12px;margin:6px 0 14px">' + UI.iconBox(m.categoria, m.grupo, m.tipo) +
      '<div><div class="muted" style="font-size:13px">' + esc(m.tipoLabel) + '</div><div style="font-size:28px;font-weight:800;letter-spacing:-.02em" class="num ' + (m.tipo === 'ingreso' ? 'pos' : '') + '">' + sign + money(m.monto) + '</div></div></div>' +
      row('Categoría', m.categoria) + row('Grupo', m.grupo) + row('Fecha', UI.dayLabel(m.fecha) + ' · ' + UI.timeLabel(m.fecha)) +
      row('Medio', m.medio) + row('Cuenta', m.cuentaLabel) + row('Descripción', m.descripcion) +
      (m.excluded ? '<p class="muted" style="font-size:12.5px">No cuenta como ingreso ni gasto (movimiento interno).</p>' : '') +
      '<p class="muted" style="font-size:12.5px;margin-top:14px">Para corregir o borrar este movimiento, edita la fila ' + esc(m.id) + ' de tu hoja Movimientos.</p>' +
      '<div class="sheet-actions"><button class="btn" data-action="closeSheet">Cerrar</button></div>';
  }

  /* --------------------------- Presupuesto --------------------------- */
  function budget(d) {
    const b = d.budget, t = b.totals;
    let html = '<div class="card hero"><div class="hero-label">Presupuesto de ' + esc(d.meta.periodLabel.toLowerCase()) + '</div>' +
      '<div class="hero-amount num" style="font-size:32px"><small>S/</small>' + UI.moneyParts(t.disponible).value + '</div>' +
      '<div class="hero-meta" style="margin-bottom:10px"><span>' + (t.disponible >= 0 ? 'disponible de ' : 'excedido sobre ') + money(t.presupuesto) + '</span>' +
      (t.sinPresupuesto > 0 ? '<span class="pill warn">+' + money(t.sinPresupuesto) + ' sin presupuesto</span>' : '') + '</div>' +
      UI.progress(t.pct, t.estado === 'ok' ? '' : t.estado, b.monthProgress) +
      '<div class="budget-foot" style="margin-bottom:8px"><span>Usado ' + UI.pct(t.pct) + ' · ' + money(t.gastado) + '</span>' +
      (b.monthProgress !== null ? '<span>Mes al ' + UI.pct(b.monthProgress) + '</span>' : '<span></span>') + '</div></div>';

    if (b.groups.length) {
      html += '<div class="section-title">Por grupo</div><div class="card" style="padding:10px">' + b.groups.map(function (g, i) {
        const extra = g.sinPresupuesto > 0 ? ' · <span style="color:var(--warning)">+' + money(g.sinPresupuesto) + ' sin presupuesto</span>' : '';
        return '<div class="group' + (i === 0 ? ' open' : '') + '"><button class="group-head" data-action="toggle">' +
          '<div class="budget-top" style="margin-bottom:8px">' + UI.iconBox('', g.grupo) + '<span class="name">' + esc(g.grupo) + '</span>' +
          '<span class="amt num">' + money(g.gastado) + ' / ' + money(g.presupuesto, { short: true }) + '</span></div>' +
          UI.progress(g.pct, g.estado === 'ok' ? '' : g.estado, b.monthProgress) +
          '<div class="budget-foot"><span>' + UI.pct(g.pct) + extra + '</span><span>' + (g.disponible >= 0 ? 'Quedan ' + money(g.disponible) : '<span class="neg">Excedido ' + money(-g.disponible) + '</span>') + '</span></div></button>' +
          '<div class="group-body">' + g.items.map(function (it) { return budgetItem(it, b.monthProgress); }).join('') +
          (g.sinPresupuestoItems || []).map(function (u) {
            return '<div class="budget-item"><div class="budget-top" style="margin:0">' + UI.iconBox(u.categoria, u.grupo) + '<span class="name">' + esc(u.categoria) + '<span class="tag warn">Sin presupuesto</span></span><span class="amt num">' + money(u.gastado) + '</span></div></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="card">' + UI.empty('🎯', 'Sin presupuesto', 'Agrega montos en la hoja Presupuestos de tu Sheet.') + '</div>';
    }

    if (b.periodic && b.periodic.length) {
      html += '<div class="section-title">Compras periódicas</div><div class="card">' + b.periodic.map(function (x) {
        const when = x.proximaCompra ? 'Próxima ~' + x.proximaLabel + (x.diasParaProxima >= 0 ? ' · en ' + x.diasParaProxima + ' días' : ' · ya toca') : 'Sin compras registradas';
        return '<div class="budget-item"><div class="budget-top">' + UI.iconBox(x.categoria, x.grupo) + '<span class="name">' + esc(x.categoria) +
          (x.compradoEnPeriodo ? '<span class="tag ok">Comprado</span>' : '') + '</span><span class="amt num">' + money(x.acumulado) + ' / ' + money(x.costo, { short: true }) + '</span></div>' +
          UI.progress(x.pct, x.estado === 'ok' ? '' : x.estado) +
          '<div class="budget-foot"><span>' + esc(when) + '</span><span>Aparta ' + money(x.mensual) + '/mes</span></div></div>';
      }).join('') + '</div>';
    }

    if (d.fixed.items.length) {
      html += '<div class="section-title">Gastos fijos · ' + money(d.fixed.totals.pagado) + ' de ' + money(d.fixed.totals.total) + '</div>' +
        '<div class="card" style="padding:4px 14px">' + d.fixed.items.map(fixedRow).join('') + '</div>';
    }

    if (b.unbudgeted.length) {
      html += '<div class="section-title">Sin presupuesto</div><div class="card" style="padding:4px 14px">' + b.unbudgeted.map(function (u) {
        return '<div class="row">' + UI.iconBox(u.categoria, u.grupo) + '<div class="row-main"><div class="row-title">' + esc(u.categoria) + '</div><div class="row-sub">' + esc(u.grupo) + '</div></div><div class="row-amount num">' + money(u.gastado) + '</div></div>';
      }).join('') + '</div>';
    }
    $('view-presupuesto').innerHTML = html;
  }

  /* ------------------------------ Más ------------------------------ */
  function more(d, st) {
    const tabs = [['saldos', 'Saldos'], ['analisis', 'Análisis'], ['ajustes', 'Ajustes']];
    let html = '<div class="segmented">' + tabs.map(function (t) {
      return '<button class="' + (st.moreTab === t[0] ? 'active' : '') + '" data-action="moreTab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
    if (st.moreTab === 'saldos') html += balances(d);
    else if (st.moreTab === 'analisis') html += analysis(d);
    else html += settings(d, st);
    $('view-mas').innerHTML = html;
    if (st.moreTab === 'saldos' && d.balances.history.length) Charts.balance('chartBalance', d.balances.history);
    if (st.moreTab === 'analisis' && d.categories.groups.length) Charts.donut('chartDonut', donutItems(d));
  }

  function balances(d) {
    const c = d.balances.current;
    const stat = function (l, v, cls) { return '<div class="stat ' + (cls || '') + '"><span>' + l + '</span><span class="num">' + money(v) + '</span></div>'; };
    return '<div class="grid-2" style="margin-bottom:12px">' +
      '<div class="card mini"><div class="mini-label">🏦 Banco</div><div class="mini-value num' + (c.banco < 0 ? ' neg' : '') + '">' + money(c.banco) + '</div><div class="mini-foot">Incluye Yape / Plin</div></div>' +
      '<div class="card mini"><div class="mini-label">💵 Efectivo</div><div class="mini-value num' + (c.efectivo < 0 ? ' neg' : '') + '">' + money(c.efectivo) + '</div><div class="mini-foot">Dinero en mano</div></div></div>' +
      '<div class="card"><div class="card-head"><h3 class="card-title">Evolución</h3><span class="card-sub">Saldo al cierre de cada mes</span></div>' +
      (d.balances.history.length ? '<div class="chart-box tall"><canvas id="chartBalance"></canvas></div>' : UI.empty('📉', 'Sin historial', '')) + '</div>' +
      '<div class="card"><div class="card-head"><h3 class="card-title">Patrimonio</h3></div>' +
      stat('Banco', c.banco) + stat('Efectivo', c.efectivo) + stat('Por cobrar al trabajo', Math.max(0, c.porCobrar)) +
      stat('Tarjeta de crédito', -c.pasivos) + stat('Patrimonio neto', c.patrimonio, 'total') + '</div>';
  }

  function donutItems(d) {
    const g = d.categories.groups;
    const items = g.slice(0, 6).map(function (x) { return { name: x.name, total: x.total, share: x.share, color: UI.colorFor(x.name) }; });
    if (g.length > 6) {
      const rest = g.slice(6);
      items.push({ name: 'Otros (' + rest.length + ')', total: rest.reduce(function (s, x) { return s + x.total; }, 0), share: rest.reduce(function (s, x) { return s + (x.share || 0); }, 0), color: '#94a3b8' });
    }
    return items;
  }

  function analysis(d) {
    const g = d.categories.groups;
    if (!g.length) return '<div class="card">' + UI.empty('📊', 'Sin gastos', 'No hay gastos en este periodo.') + '</div>';
    const items = donutItems(d);
    let html = '<div class="card"><div class="card-head"><h3 class="card-title">¿En qué gasto?</h3><span class="card-sub">' + money(d.categories.total) + '</span></div>' +
      '<div class="donut-wrap"><div class="chart-box"><canvas id="chartDonut"></canvas></div><div class="legend">' + items.map(function (i) {
        return '<div class="legend-row"><span class="sw" style="background:' + i.color + '"></span><span class="nm">' + esc(i.name) + '</span><span class="vl num">' + money(i.total, { short: true }) + '</span><span class="pc">' + UI.pct(i.share) + '</span></div>';
      }).join('') + '</div></div></div>';
    html += '<div class="section-title">Por grupo · vs ' + esc(d.meta.prevLabel.toLowerCase()) + '</div><div class="card" style="padding:10px">' + g.map(function (x) {
      const delta = x.deltaPct === null ? '<span class="pill neutral">nuevo</span>' : UI.deltaPill(x.deltaPct, false);
      return '<div class="group"><button class="group-head" data-action="toggle"><div class="budget-top" style="margin:0">' + UI.iconBox('', x.name) +
        '<span class="name">' + esc(x.name) + ' <span class="muted" style="font-weight:500">· ' + UI.pct(x.share) + '</span></span>' + delta +
        '<span class="amt num" style="color:var(--text);font-weight:700">' + money(x.total) + '</span></div></button>' +
        '<div class="group-body">' + x.children.map(function (c) {
          return '<div class="budget-item"><div class="budget-top" style="margin-bottom:6px">' + UI.iconBox(c.name, x.name) + '<span class="name">' + esc(c.name) +
            ' <span class="muted" style="font-weight:500;font-size:12px">' + c.count + ' mov.</span></span><span class="amt num">' + money(c.total) + '</span></div>' +
            '<div class="prog"><i style="width:' + (c.share || 0) + '%;background:' + UI.colorFor(x.name) + '"></i></div></div>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
    html += '<div class="grid-2"><div class="card mini"><div class="mini-label">Promedio diario</div><div class="mini-value num">' + money(d.kpis.dailyAverage.value) + '</div></div>' +
      '<div class="card mini"><div class="mini-label">Tasa de ahorro</div><div class="mini-value num">' + UI.pct(d.kpis.savingsRate.value) + '</div></div></div>';
    if (d.topExpenses.length) {
      html += '<div class="section-title">Gastos más altos</div><div class="card" style="padding:4px 14px">' + d.topExpenses.map(movRow).join('') + '</div>';
    }
    return html;
  }

  function settings(d, st) {
    const demo = Api.cfg.demo;
    let host = '—';
    try { host = demo ? 'Modo ejemplo' : new URL(Api.cfg.url).pathname.split('/')[3].slice(0, 10) + '…'; } catch (e) { /* nada */ }
    const warnings = (d.meta.warnings || []).map(function (w) {
      return '<div class="alert warning"><div class="alert-ic">' + UI.icon('alert') + '</div><div><span>' + esc(w) + '</span></div></div>';
    }).join('');
    const autoOpts = [[0, 'Desactivada'], [300000, 'Cada 5 min'], [900000, 'Cada 15 min'], [3600000, 'Cada hora']];
    return '<div class="card"><div class="card-head"><h3 class="card-title">Conexión</h3></div>' +
      '<div class="stat"><span class="muted">Servidor</span><span>' + esc(host) + '</span></div>' +
      '<div class="stat"><span class="muted">Datos del Sheet</span><span>' + esc(String(d.meta.loadedAt || '').replace('T', ' ')) + '</span></div>' +
      '<div class="stat"><span class="muted">Movimientos válidos</span><span>' + d.meta.totalMovements + '</span></div>' +
      '<div class="stat"><span class="muted">Interpretar frases</span><span>En el teléfono (reglas)</span></div>' +
      '<div class="stat"><span class="muted">IA de respaldo</span><span>' + (st.aiEnabled === null ? '…' : st.aiEnabled ? providerName(st.aiProvider) : 'No configurada') + '</span></div>' +
      (st.aiEnabled ? '<label class="field" style="margin:12px 0 0"><span>Cuando no entienda una frase</span><select id="aiSelect" class="input">' +
        '<option value="1"' + (st.useAi ? ' selected' : '') + '>Pedir ayuda a ' + providerName(st.aiProvider) + '</option>' +
        '<option value="0"' + (!st.useAi ? ' selected' : '') + '>Completar a mano (sin IA)</option></select></label>' : '') +
      '<label class="field" style="margin:12px 0 0"><span>Actualización automática</span><select id="autoSelect" class="input">' +
      autoOpts.map(function (o) { return '<option value="' + o[0] + '"' + (st.autoMs === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn btn-block" data-action="logout" style="margin-top:14px">' + (demo ? 'Conectar mis datos' : 'Cambiar conexión / cerrar sesión') + '</button></div>' +
      (warnings ? '<div class="card"><div class="card-head"><h3 class="card-title">Revisar en tu Sheet</h3></div>' + warnings + '</div>' : '') +
      '<div class="card"><div class="card-head"><h3 class="card-title">Consejos para dictar</h3></div>' +
      '<div class="muted" style="font-size:13.5px">Di varios movimientos en una frase: <i>"almuerzo 25 con Yape, taxi 12 en efectivo y ayer cine 18"</i>. ' +
      'Funciona mejor si dices <b>qué</b>, <b>cuánto</b> y <b>cómo pagaste</b>. Entiende "ayer", "el lunes", "veinte con cincuenta", Yape, Plin y efectivo. ' +
      'Mientras más registros con descripción tengas, mejor adivina la categoría.</div></div>' +
      '<p class="muted" style="text-align:center;font-size:12px">Mis Finanzas · app ' + esc(App.VERSION) + '</p>';
  }

  function providerName(p) { return p === 'gemini' ? 'Gemini' : p === 'anthropic' ? 'Claude' : 'IA'; }

  return { home: home, movements: movements, movementDetail: movementDetail, budget: budget, more: more, providerName: providerName };
})();
