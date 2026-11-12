/* =========================================================
   app.js · estado, navegación, carga de datos y eventos
   ========================================================= */
const App = (function () {
  const VERSION = '1.3.2';
  const $ = function (id) { return document.getElementById(id); };
  const AUTO_KEY = 'mf.autoMs';

  const now = new Date();
  const st = {
    data: null,
    filters: { year: now.getFullYear(), month: now.getMonth() + 1 },
    view: 'inicio',
    loading: false,
    requestId: 0,
    lastLoad: 0,
    moreTab: 'saldos',
    aiEnabled: null,
    aiProvider: '',
    useAi: readFlag('mf.useAi', true),
    autoMs: readAuto(),
    table: { search: '', kind: '', day: '', limit: 80 }
  };

  function readFlag(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch (e) { return def; } }
  function writeFlag(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* nada */ } }

  function readAuto() { try { const v = parseInt(localStorage.getItem(AUTO_KEY), 10); return isNaN(v) ? 300000 : v; } catch (e) { return 300000; } }

  /* ------------------------- Inicio ------------------------- */
  function init() {
    UI.hydrateIcons();
    bind();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin SW */ });
    }
    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1') Api.enableDemo();
    if (Api.cfg.configured) startApp();
    else showSetup();
  }

  function showSetup(message) {
    $('app').classList.add('hidden');
    $('setup').classList.remove('hidden');
    $('setupUrl').value = Api.cfg.url;
    $('setupError').classList.toggle('hidden', !message);
    $('setupError').textContent = message || '';
  }

  async function connect() {
    const url = $('setupUrl').value.trim();
    const key = $('setupKey').value.trim();
    const err = $('setupError');
    err.classList.add('hidden');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url) || !/\/exec(\?|$)/.test(url)) {
      err.textContent = 'La URL debe ser la de tu implementación de Apps Script y terminar en /exec.';
      err.classList.remove('hidden');
      return;
    }
    if (!key) { err.textContent = 'Ingresa tu clave personal.'; err.classList.remove('hidden'); return; }
    const btn = $('setupBtn');
    btn.disabled = true; btn.textContent = 'Conectando…';
    try {
      const r = await Api.ping(url, key);
      Api.save(url, key);
      st.aiEnabled = r.aiEnabled; st.aiProvider = r.aiProvider || '';
      startApp();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Conectar';
    }
  }

  function startApp() {
    $('setup').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('demoBanner').classList.toggle('hidden', !Api.cfg.demo);
    const cached = Api.readCache(st.filters);
    if (cached) { st.data = cached.data; st.lastLoad = cached.ts; renderAll(); setSync('Guardado ' + UI.ago(cached.ts)); }
    else renderSkeleton();
    load(false);
    if (st.aiEnabled === null) Api.ping().then(function (r) { st.aiEnabled = r.aiEnabled; st.aiProvider = r.aiProvider || ''; }).catch(function () { /* nada */ });
    scheduleAuto();
    // Atajo del ícono ("Registrar con voz"): abre el micrófono directo.
    if (new URLSearchParams(location.search).get('voz') === '1') setTimeout(Entry.open, 400);
  }

  /* ------------------------- Datos ------------------------- */
  async function load(force) {
    const id = ++st.requestId;
    st.loading = true;
    $('refreshBtn').classList.add('spin');
    setSync('Actualizando…');
    try {
      const d = await Api.data(st.filters, force);
      if (id !== st.requestId) return;
      st.data = d;
      st.lastLoad = Date.now();
      renderAll();
      setSync('');
    } catch (e) {
      if (id !== st.requestId) return;
      if (e.code === 'bad_key' || e.code === 'not_configured') { showSetup(e.message); return; }
      setSync(st.data ? 'Sin conexión · ' + UI.ago(st.lastLoad) : '');
      UI.toast(e.message, { error: true, action: { label: 'Reintentar', fn: function () { load(true); } } });
      if (!st.data) $('view-inicio').innerHTML = '<div class="card">' + UI.empty('📡', 'No se pudieron cargar tus datos', e.message) + '</div>';
    } finally {
      if (id === st.requestId) { st.loading = false; $('refreshBtn').classList.remove('spin'); }
    }
  }

  function afterSave() {
    // El Form tarda unos segundos en escribir la fila en el Sheet.
    setSync('Sincronizando…');
    setTimeout(function () { load(true); }, 2500);
  }

  function setSync(text) { $('syncState').textContent = text || ''; }

  /* ------------------------- Render ------------------------- */
  function renderSkeleton() {
    $('view-inicio').innerHTML = '<div class="card hero"><div class="skeleton" style="height:14px;width:40%"></div>' +
      '<div class="skeleton" style="height:40px;width:70%;margin:12px 0"></div><div class="skeleton" style="height:150px"></div></div>' +
      '<div class="grid-2"><div class="skeleton" style="height:90px;border-radius:18px"></div><div class="skeleton" style="height:90px;border-radius:18px"></div></div>';
  }

  function renderAll() {
    const d = st.data;
    if (!d) return;
    UI.setGroups(d.meta.groups || []);
    $('periodLabel').textContent = d.meta.periodLabel;
    st.dirty = { inicio: true, movimientos: true, presupuesto: true, mas: true };
    renderView();
  }

  function renderView() {
    if (!st.data || !st.dirty || !st.dirty[st.view]) return;
    st.dirty[st.view] = false;
    try {
      if (st.view === 'inicio') Views.home(st.data);
      else if (st.view === 'movimientos') Views.movements(st.data, st);
      else if (st.view === 'presupuesto') Views.budget(st.data);
      else Views.more(st.data, st);
    } catch (e) {
      console.error(e);
      UI.toast('No se pudo mostrar esta sección.', { error: true });
    }
  }

  function setView(name) {
    st.view = name;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    window.scrollTo({ top: 0 });
    if (st.dirty) st.dirty[name] = true;
    renderView();
  }

  function rerender(view) { if (st.dirty) { st.dirty[view] = true; renderView(); } }

  /* ------------------------- Periodo ------------------------- */
  function shiftMonth(delta) {
    const f = st.filters;
    if (!f.month) { f.year += delta; }
    else {
      const dt = new Date(f.year, f.month - 1 + delta, 1);
      f.year = dt.getFullYear(); f.month = dt.getMonth() + 1;
    }
    st.table.day = '';
    changePeriod();
  }

  function changePeriod() {
    const f = st.filters;
    $('periodLabel').textContent = f.month ? UI.MONTHS[f.month - 1] + ' ' + f.year : 'Año ' + f.year;
    const cached = Api.readCache(f);
    if (cached) { st.data = cached.data; renderAll(); } else renderSkeleton();
    load(false);
  }

  function periodPicker() {
    const f = st.filters;
    const years = (st.data && st.data.meta.years) || [f.year];
    let html = '<h2>Elegir periodo</h2><div class="voice-hint" style="text-align:left">Toca un mes, o mira el año completo.</div>' +
      '<div class="chip-row" style="margin:6px 0 14px">' + years.map(function (y) {
        return '<button class="chip' + (y === f.year ? ' active' : '') + '" data-pick-year="' + y + '">' + y + '</button>';
      }).join('') + '</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
      UI.MONTHS.map(function (m, i) {
        return '<button class="btn" style="height:44px' + (f.month === i + 1 ? ';background:var(--primary);color:var(--on-primary);border-color:var(--primary)' : '') + '" data-pick-month="' + (i + 1) + '">' + m.slice(0, 3) + '</button>';
      }).join('') + '</div><button class="btn btn-block" style="margin-top:12px' + (!f.month ? ';background:var(--primary);color:var(--on-primary)' : '') + '" data-pick-month="0">Todo el año</button>';
    const body = UI.openSheet(html);
    let year = f.year;
    body.onclick = function (e) {
      const y = e.target.closest('[data-pick-year]');
      if (y) { year = +y.dataset.pickYear; body.querySelectorAll('[data-pick-year]').forEach(function (c) { c.classList.toggle('active', c === y); }); return; }
      const m = e.target.closest('[data-pick-month]');
      if (m) { st.filters.year = year; st.filters.month = +m.dataset.pickMonth; st.table.day = ''; UI.closeSheet(); changePeriod(); }
    };
  }

  /* ------------------------- Hojas de detalle ------------------------- */
  function showProjection() {
    const p = st.data.pace, det = p.projectionDetail;
    const row = function (l, v) { return '<div class="stat"><span class="muted">' + l + '</span><span class="num">' + v + '</span></div>'; };
    UI.openSheet('<h2>Proyección de cierre</h2><div class="voice-hint" style="text-align:left">Cómo calculo a cuánto llegarás este mes.</div>' +
      row('Gastado hasta hoy', UI.money(det.gastado)) +
      row('Gasto variable diario', UI.money(det.variableDiario) + ' × ' + det.diasRestantes + ' días') +
      row('Fijos pendientes', UI.money(det.fijosPendientes)) +
      '<div class="stat total"><span>Proyección</span><span class="num">' + UI.money(p.projection) + '</span></div>' +
      '<p class="muted" style="font-size:12.5px">El gasto variable excluye tus gastos fijos y compras periódicas (como los suplementos), porque no se repiten cada día.</p>' +
      '<div class="sheet-actions"><button class="btn" data-action="closeSheet">Entendido</button></div>');
  }

  function showFree() {
    const f = st.data.kpis.free;
    const row = function (l, v) { return '<div class="stat"><span class="muted">' + l + '</span><span class="num">' + v + '</span></div>'; };
    UI.openSheet('<h2>Libre para el mes</h2><div class="voice-hint" style="text-align:left">Lo que puedes gastar sin descuadrarte.</div>' +
      row('Ingresos del mes' + (f.estimated ? ' (sueldo estimado)' : ''), UI.money(f.income)) +
      row('− Gastado', UI.money(f.expenses)) + row('− Fijos pendientes', UI.money(f.pendingFixed)) +
      (f.funds ? row('− Aporte a fondos', UI.money(f.funds)) : '') +
      '<div class="stat total"><span>Libre</span><span class="num ' + (f.value < 0 ? 'neg' : '') + '">' + UI.money(f.value) + '</span></div>' +
      '<div class="sheet-actions"><button class="btn" data-action="closeSheet">Entendido</button></div>');
  }

  /* ------------------------- Auto refresco ------------------------- */
  let autoTimer;
  function scheduleAuto() {
    clearInterval(autoTimer);
    if (st.autoMs) autoTimer = setInterval(tick, 60000);
  }
  function tick() {
    if (!st.autoMs || st.loading || document.visibilityState !== 'visible' || UI.sheetOpen()) return;
    if (Date.now() - st.lastLoad >= st.autoMs) load(false);
  }

  /* ------------------------- Eventos ------------------------- */
  function bind() {
    $('setupBtn').onclick = connect;
    $('setupKey').onkeydown = function (e) { if (e.key === 'Enter') connect(); };
    $('demoBtn').onclick = function () { Api.enableDemo(); startApp(); };
    $('exitDemo').onclick = function () { Api.logout(); st.data = null; showSetup(); };
    $('tabbar').onclick = function (e) { const t = e.target.closest('.tab'); if (t) setView(t.dataset.view); };
    $('micFab').onclick = function () { Entry.open(); };
    $('prevMonth').onclick = function () { shiftMonth(-1); };
    $('nextMonth').onclick = function () { shiftMonth(1); };
    $('periodBtn').onclick = periodPicker;
    $('refreshBtn').onclick = function () { load(true); };
    $('sheetBackdrop').onclick = UI.closeSheet;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && UI.sheetOpen()) UI.closeSheet(); });
    document.addEventListener('visibilitychange', tick);

    document.addEventListener('click', function (e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'goto') setView(el.dataset.view);
      else if (a === 'closeSheet') UI.closeSheet();
      else if (a === 'projection') showProjection();
      else if (a === 'free') showFree();
      else if (a === 'manual') Entry.manual();
      else if (a === 'toggle') el.parentElement.classList.toggle('open');
      else if (a === 'day') { st.table.day = el.dataset.date; st.table.kind = ''; setView('movimientos'); }
      else if (a === 'clearDay') { st.table.day = ''; rerender('movimientos'); }
      else if (a === 'kind') { st.table.kind = el.dataset.kind; rerender('movimientos'); }
      else if (a === 'more') { st.table.limit += 80; rerender('movimientos'); }
      else if (a === 'moreTab') { st.moreTab = el.dataset.tab; rerender('mas'); }
      else if (a === 'mov') {
        const m = st.data.movements.concat(st.data.topExpenses).filter(function (x) { return String(x.id) === el.dataset.id; })[0];
        if (m) UI.openSheet(Views.movementDetail(m));
      } else if (a === 'logout') {
        if (Api.cfg.demo || confirmLogout()) { Api.logout(); st.data = null; showSetup(); }
      }
    });

    let searchTimer;
    document.addEventListener('input', function (e) {
      if (e.target.id === 'movSearch') {
        clearTimeout(searchTimer);
        const v = e.target.value;
        searchTimer = setTimeout(function () {
          st.table.search = v;
          rerender('movimientos');
          const s = $('movSearch'); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); }
        }, 200);
      }
    });
    document.addEventListener('change', function (e) {
      if (e.target.id === 'aiSelect') {
        st.useAi = e.target.value === '1';
        writeFlag('mf.useAi', st.useAi);
        UI.toast(st.useAi ? 'Usaré la IA solo cuando no entienda una frase' : 'Solo interpretaré con reglas, sin IA');
      }
      if (e.target.id === 'autoSelect') {
        st.autoMs = parseInt(e.target.value, 10);
        try { localStorage.setItem(AUTO_KEY, String(st.autoMs)); } catch (err) { /* nada */ }
        scheduleAuto();
        UI.toast(st.autoMs ? 'Actualización automática activada' : 'Actualización automática desactivada');
      }
    });
  }

  function confirmLogout() {
    return window.confirm('¿Cerrar sesión en este dispositivo? Tendrás que volver a ingresar la URL y tu clave.');
  }

  document.addEventListener('DOMContentLoaded', init);
  /** Estado de la IA de respaldo para el registro por voz. */
  function ai() { return { enabled: !!st.aiEnabled, provider: st.aiProvider, use: st.useAi }; }

  return { VERSION: VERSION, afterSave: afterSave, load: load, ai: ai };
})();
