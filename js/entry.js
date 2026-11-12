/* =========================================================
   entry.js · registrar movimientos por voz o texto
   Flujo: escuchar → texto → interpretar (Claude) → tarjetas editables → guardar
   ========================================================= */
const Entry = (function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const EXAMPLES = ['almuerzo 25 con yape', 'taxi 12 en efectivo', 'ayer gasolina 100 con tarjeta', 'me pagaron 120 de un freelance'];
  let st = null;
  let rec = null;

  function fresh() { return { phase: 'listen', text: '', base: '', interim: '', items: [], options: null, nota: '', error: '', listening: false }; }

  /* ------------------------ Apertura ------------------------ */
  function open() {
    st = fresh();
    st.phase = SR ? 'listen' : 'text';
    UI.openSheet('<div id="entryRoot"></div>', stopListening);
    render();
    if (SR) startListening();
    else setTimeout(function () { const t = document.getElementById('entryText'); if (t) t.focus(); }, 250);
  }

  async function manual() {
    st = fresh();
    st.phase = 'loading';
    UI.openSheet('<div id="entryRoot"></div>', stopListening);
    render();
    try {
      st.options = await Api.options();
      st.items = [blankItem()];
      st.phase = 'review';
    } catch (e) {
      st.phase = 'text';
      st.error = e.message;
    }
    render();
  }

  function blankItem() {
    const tipo = (st.options.tipos.filter(function (t) { return UI.norm(t) === 'gasto'; })[0]) || st.options.tipos[0] || 'Gasto';
    return { tipo: tipo, kind: kindOf(tipo), categoria: '', monto: 0, medio: '', fecha: UI.isoDate(new Date()), descripcion: '' };
  }

  /* ------------------------ Voz ------------------------ */
  function startListening() {
    if (!SR) return;
    stopListening();
    st.base = st.text ? st.text.trim() + ', ' : '';
    st.interim = '';
    st.error = '';
    try {
      rec = new SR();
      rec.lang = 'es-PE';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (e) {
        let finalText = '', interim = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        st.text = (st.base + finalText).trim();
        st.interim = interim;
        updateTranscript();
      };
      rec.onerror = function (e) {
        st.error = e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Permite el acceso al micrófono para dictar, o escribe el movimiento.'
          : e.error === 'no-speech' ? 'No te escuché. Toca el micrófono e inténtalo de nuevo.'
            : e.error === 'network' ? 'El dictado necesita internet.' : '';
      };
      rec.onend = function () {
        st.listening = false;
        if (st.interim) { st.text = (st.text + ' ' + st.interim).trim(); st.interim = ''; }
        if (st.phase === 'listen') st.phase = 'text';
        render();
      };
      rec.start();
      st.listening = true;
      st.phase = 'listen';
      render();
    } catch (e) {
      st.phase = 'text';
      st.error = 'No se pudo iniciar el micrófono. Puedes escribir el movimiento.';
      render();
    }
  }

  function stopListening() {
    if (rec) { try { rec.onend = null; rec.abort(); } catch (e) { /* nada */ } }
    rec = null;
    if (st) st.listening = false;
  }

  function finishListening() { if (rec) { try { rec.stop(); } catch (e) { /* nada */ } } }

  function updateTranscript() {
    const el = document.getElementById('entryLive');
    if (el) el.innerHTML = UI.esc(st.text) + (st.interim ? ' <span class="muted">' + UI.esc(st.interim) + '</span>' : '') || '<span class="muted">Te escucho…</span>';
  }

  /* ------------------------ Interpretar y guardar ------------------------ */
  /**
   * Interpreta primero en el teléfono (reglas, gratis e instantáneo).
   * Solo si algo queda sin entender y la IA está configurada, pide ayuda al servidor.
   */
  async function interpret(forceAi) {
    const ta = document.getElementById('entryText');
    if (ta) st.text = ta.value;
    const text = st.text.trim();
    if (!text) { st.error = 'Dicta o escribe al menos un movimiento.'; render(); return; }
    stopListening();
    st.phase = 'loading';
    st.error = '';
    render();
    try {
      if (!st.options) st.options = await Api.options();
      const ai = App.ai();
      let items = forceAi ? [] : Parser.parse(text, st.options);
      let nota = '';
      if ((forceAi || Parser.needsHelp(items)) && ai.enabled && (ai.use || forceAi)) {
        st.loadingAi = true; render();
        try {
          const r = await Api.parse(text);
          if (r.items.length) {
            items = r.items;
            st.options = r.options;
            Api.rememberOptions(r.options);
            nota = 'Interpretado con ' + Views.providerName(r.provider) + (r.nota ? ': ' + r.nota : '.');
          }
        } catch (e) {
          if (forceAi) items = Parser.parse(text, st.options);
          nota = e.message + ' Te muestro lo que entendí sin IA.';
        }
        st.loadingAi = false;
      }
      if (!items.length) {
        st.phase = 'text';
        st.error = 'No encontré montos en lo que dijiste. Prueba con "almuerzo 25 con Yape".';
      } else {
        st.items = items;
        st.nota = nota || (Parser.needsHelp(items) ? 'Completa lo marcado en amarillo.' : '');
        st.phase = 'review';
      }
    } catch (e) {
      st.loadingAi = false;
      st.phase = 'text';
      st.error = e.message;
    }
    render();
  }

  async function save() {
    syncAll();
    if (st.items.some(function (it) { return missing(it).length; })) { render(); return; }
    st.phase = 'saving';
    render();
    try {
      const r = await Api.saveItems(st.items.map(function (it) {
        return { tipo: it.tipo, categoria: it.categoria, monto: it.monto, medio: it.medio, fecha: it.fecha, descripcion: it.descripcion };
      }));
      Api.forgetOptions();
      UI.closeSheet();
      UI.toast(r.demo ? 'Modo ejemplo: no se guardó en ningún Sheet' : '✓ ' + r.saved + (r.saved === 1 ? ' movimiento guardado' : ' movimientos guardados'));
      if (!r.demo) App.afterSave();
    } catch (e) {
      st.phase = 'review';
      st.error = e.message;
      render();
    }
  }

  /* ------------------------ Validación local ------------------------ */
  function kindOf(tipo) {
    const t = (st.options && st.options.tiposInternos || []).filter(function (x) { return x.label === tipo; })[0];
    if (t && t.kind) return t.kind;
    const n = UI.norm(tipo);
    if (n.indexOf('ingreso') >= 0) return 'ingreso';
    if (n.indexOf('retiro') >= 0) return 'retiro';
    if (n.indexOf('deposito') >= 0) return 'deposito';
    if (n.indexOf('reembolsable') >= 0 || n.indexOf('trabajo') >= 0) return 'gasto_trabajo';
    if (n.indexOf('reembolso') >= 0) return 'reembolso';
    return 'gasto';
  }
  function catsFor(kind) {
    const o = st.options;
    if (kind === 'ingreso') return o.categoriasIngreso;
    if (kind === 'reembolso') return o.categoriasIngreso.concat(o.categoriasGasto);
    if (kind === 'retiro' || kind === 'deposito') return o.categoriasInternas.length ? o.categoriasInternas : o.categoriasGasto;
    return o.categoriasGasto;
  }
  function missing(it) {
    const m = [];
    if (!it.categoria) m.push('categoria');
    if (!(Number(it.monto) > 0)) m.push('monto');
    if (st.options.medios.length && !it.medio) m.push('medio');
    return m;
  }

  /** Lee los valores de una tarjeta desde el DOM. */
  function syncCard(i) {
    const card = document.querySelector('.entry-card[data-i="' + i + '"]');
    if (!card) return;
    const it = st.items[i];
    const val = function (f) { const el = card.querySelector('[data-f="' + f + '"]'); return el ? el.value : undefined; };
    const tipo = val('tipo');
    if (tipo !== undefined && tipo !== it.tipo) {
      it.tipo = tipo;
      it.kind = kindOf(tipo);
      const valid = catsFor(it.kind).map(function (c) { return c.name; });
      if (valid.indexOf(it.categoria) < 0) it.categoria = (it.kind === 'retiro' || it.kind === 'deposito') && valid.length ? valid[0] : '';
    } else {
      const c = val('categoria'); if (c !== undefined) it.categoria = c;
    }
    const monto = val('monto'); if (monto !== undefined) it.monto = Math.round(parseFloat(String(monto).replace(',', '.')) * 100) / 100 || 0;
    const medio = val('medio'); if (medio !== undefined) it.medio = medio;
    const fecha = val('fecha'); if (fecha !== undefined && fecha) it.fecha = fecha;
    const desc = val('descripcion'); if (desc !== undefined) it.descripcion = desc;
    const cat = catsFor(it.kind).filter(function (c) { return c.name === it.categoria; })[0];
    it.grupo = cat ? cat.grupo : '';
  }
  function syncAll() { st.items.forEach(function (_, i) { syncCard(i); }); }

  /* ------------------------ Render ------------------------ */
  function render() {
    const root = document.getElementById('entryRoot');
    if (!root || !st) return;
    let html = '';
    if (st.phase === 'listen' || st.phase === 'text') html = renderCapture();
    else if (st.phase === 'loading') html = renderLoading();
    else html = renderReview();
    root.innerHTML = html;
    UI.hydrateIcons(root);
    bind(root);
  }

  function renderCapture() {
    const listening = st.listening;
    const err = st.error ? '<p class="form-error" style="margin:8px 0 0">' + UI.esc(st.error) + '</p>' : '';
    if (listening) {
      return '<div class="voice"><h2>Te escucho</h2><div class="voice-hint">Di uno o varios movimientos</div>' +
        '<button class="voice-mic listening" data-a="stop" aria-label="Terminar">' + UI.icon('mic') + '</button>' +
        '<div class="transcript" id="entryLive" style="min-height:70px">' + (UI.esc(st.text) || '<span class="muted">Te escucho…</span>') + '</div>' +
        '<div class="voice-hint" style="margin-top:10px">Toca el micrófono cuando termines</div></div>';
    }
    return '<div class="voice"><h2>Nuevo movimiento</h2>' +
      '<div class="voice-hint">' + (SR ? 'Revisa el texto o dicta más' : 'Escribe o usa el micrófono de tu teclado para dictar') + '</div>' +
      '<textarea class="transcript" id="entryText" rows="3" placeholder="Ej.: almuerzo 25 con Yape y taxi 12 en efectivo">' + UI.esc(st.text) + '</textarea>' + err +
      (st.text ? '' : '<div class="examples">' + EXAMPLES.map(function (e) { return '<button data-a="example" data-t="' + UI.esc(e) + '">' + UI.esc(e) + '</button>'; }).join('') + '</div>') +
      '<div class="sheet-actions">' + (SR ? '<button class="btn" data-a="listen">' + UI.icon('mic') + (st.text ? 'Dictar más' : 'Dictar') + '</button>' : '<button class="btn" data-a="manual">Llenar a mano</button>') +
      '<button class="btn btn-primary" data-a="interpret">' + UI.icon('sparkle') + 'Interpretar</button></div></div>';
  }

  function renderLoading() {
    return '<h2>' + (st.loadingAi ? 'Pidiendo ayuda a la IA…' : 'Entendiendo…') + '</h2><div class="voice-hint" style="text-align:left">' + UI.esc(st.text || 'Preparando el formulario') + '</div>' +
      '<div class="skeleton" style="height:150px;margin:12px 0"></div><div class="skeleton" style="height:150px"></div>';
  }

  function sel(field, options, value, placeholder, isMissing) {
    return '<select data-f="' + field + '">' + (placeholder ? '<option value="">' + placeholder + '</option>' : '') +
      options.map(function (o) {
        const v = typeof o === 'string' ? o : o.name;
        return '<option value="' + UI.esc(v) + '"' + (v === value ? ' selected' : '') + '>' + UI.esc(v) + '</option>';
      }).join('') + '</select>';
  }

  function renderReview() {
    const o = st.options;
    const today = UI.isoDate(new Date());
    const total = st.items.reduce(function (s, it) { return s + (Number(it.monto) || 0); }, 0);
    const anyMissing = st.items.some(function (it) { return missing(it).length; });
    const saving = st.phase === 'saving';
    let html = '<h2>' + (st.items.length === 1 ? 'Revisa el movimiento' : 'Revisa ' + st.items.length + ' movimientos') + '</h2>' +
      (st.nota ? '<div class="voice-hint" style="text-align:left">' + UI.esc(st.nota) + '</div>' : '<div class="voice-hint" style="text-align:left">Corrige lo que haga falta y guarda.</div>');
    html += st.items.map(function (it, i) {
      const miss = missing(it);
      const m = function (f) { return miss.indexOf(f) >= 0 ? ' class="missing"' : ''; };
      const showCat = true;
      const dateNote = (!o.hasFecha && it.fecha !== today) ? '<div class="entry-note">Tu Form no tiene "Fecha del movimiento": se guardará con fecha de hoy.</div>' : '';
      return '<div class="entry-card' + (miss.length ? ' incomplete' : '') + '" data-i="' + i + '">' +
        (st.items.length > 1 || st.phase !== 'review' ? '<button class="icon-btn entry-remove" data-a="remove" data-i="' + i + '" aria-label="Quitar">' + UI.icon('x') + '</button>' : '') +
        '<div class="entry-top">' + UI.iconBox(it.categoria, it.grupo, it.kind) +
        '<div class="entry-amount' + (miss.indexOf('monto') >= 0 ? ' neg' : '') + '"><span>S/</span><input data-f="monto" inputmode="decimal" value="' + (it.monto ? Number(it.monto).toFixed(2) : '') + '" placeholder="0.00" aria-label="Monto"></div></div>' +
        '<div class="entry-fields">' +
        '<label><span>Tipo</span>' + sel('tipo', o.tipos, it.tipo) + '</label>' +
        (showCat ? '<label' + m('categoria') + '><span>Categoría</span>' + sel('categoria', catsFor(it.kind), it.categoria, 'Elegir…') + '</label>' : '') +
        '<label' + m('medio') + '><span>Medio</span>' + sel('medio', o.medios, it.medio, 'Elegir…') + '</label>' +
        '<label><span>Fecha</span><input type="date" data-f="fecha" value="' + UI.esc(it.fecha || today) + '" max="' + today + '"></label>' +
        (o.hasDescripcion ? '<label class="full"><span>Descripción</span><input data-f="descripcion" value="' + UI.esc(it.descripcion || '') + '" maxlength="80" placeholder="Opcional: lugar o detalle"></label>' : '') +
        '</div>' + dateNote + (miss.length ? '<div class="entry-note">Completa: ' + miss.join(', ') + '</div>' : '') + '</div>';
    }).join('');
    html += '<button class="btn btn-ghost btn-block" data-a="add">' + UI.icon('plus') + 'Agregar otro</button>';
    const ai = App.ai();
    if (ai.enabled && st.text && st.items.length && st.items.every(function (it) { return it.source === 'reglas'; })) {
      html += '<button class="btn btn-ghost btn-block" data-a="ai" style="margin-top:0">' + UI.icon('sparkle') + 'Reinterpretar con ' + Views.providerName(ai.provider) + '</button>';
    }
    if (!o.hasDescripcion) html += '<p class="muted" style="font-size:12px;text-align:center">Agrega la pregunta "Descripción" a tu Form para guardar también el detalle.</p>';
    if (st.error) html += '<p class="form-error" style="margin-top:8px">' + UI.esc(st.error) + '</p>';
    html += '<div class="sheet-actions"><button class="btn" data-a="back"' + (saving ? ' disabled' : '') + '>' + UI.icon('mic') + 'Dictar</button>' +
      '<button class="btn btn-primary" data-a="save"' + (anyMissing || saving ? ' disabled' : '') + '>' +
      (saving ? 'Guardando…' : UI.icon('check') + 'Guardar ' + (st.items.length > 1 ? st.items.length + ' · ' : '') + UI.money(total)) + '</button></div>';
    return html;
  }

  /* ------------------------ Eventos ------------------------ */
  function bind(root) {
    root.onclick = function (e) {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'stop') finishListening();
      else if (a === 'listen') { const ta = document.getElementById('entryText'); if (ta) st.text = ta.value; startListening(); }
      else if (a === 'interpret') interpret(false);
      else if (a === 'ai') interpret(true);
      else if (a === 'example') { st.text = b.dataset.t; render(); }
      else if (a === 'manual') { UI.closeSheet(); manual(); }
      else if (a === 'save') save();
      else if (a === 'add') { syncAll(); st.items.push(blankItem()); render(); }
      else if (a === 'remove') { syncAll(); st.items.splice(+b.dataset.i, 1); if (!st.items.length) { st.phase = 'text'; } render(); }
      else if (a === 'back') { syncAll(); st.items = []; st.phase = SR ? 'listen' : 'text'; st.text = ''; render(); if (SR) startListening(); }
    };
    root.onchange = function (e) {
      const card = e.target.closest('.entry-card');
      if (!card) return;
      syncCard(+card.dataset.i);
      if (e.target.dataset.f === 'tipo' || e.target.dataset.f === 'categoria') render();
      else refreshFooter();
    };
    root.oninput = function (e) {
      const card = e.target.closest('.entry-card');
      if (card && e.target.dataset.f === 'monto') { syncCard(+card.dataset.i); refreshFooter(); }
      if (e.target.id === 'entryText') st.text = e.target.value;
    };
  }

  /** Actualiza total, botón y avisos sin re-renderizar (no pierde el foco del input). */
  function refreshFooter() {
    const btn = document.querySelector('#entryRoot [data-a="save"]');
    if (!btn) return;
    const total = st.items.reduce(function (s, it) { return s + (Number(it.monto) || 0); }, 0);
    const anyMissing = st.items.some(function (it) { return missing(it).length; });
    btn.disabled = anyMissing;
    btn.innerHTML = UI.icon('check') + 'Guardar ' + (st.items.length > 1 ? st.items.length + ' · ' : '') + UI.money(total);
    document.querySelectorAll('#entryRoot .entry-card').forEach(function (card) {
      const it = st.items[+card.dataset.i];
      card.classList.toggle('incomplete', missing(it).length > 0);
    });
  }

  return { open: open, manual: manual, supported: !!SR };
})();
