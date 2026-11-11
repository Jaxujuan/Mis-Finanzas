/* =========================================================
   ui.js · formato, íconos, emojis y componentes pequeños
   ========================================================= */
const UI = (function () {
  const moneyFmt = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shortFmt = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8M10 13h4"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'
  };

  function icon(name, size) {
    const s = size ? ' width="' + size + '" height="' + size + '"' : '';
    return '<svg' + s + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.dataset.iconDone) return;
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
      el.dataset.iconDone = '1';
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n, opts) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    opts = opts || {};
    const sign = n < 0 ? '−' : (opts.plus && n > 0 ? '+' : '');
    return sign + 'S/ ' + (opts.short ? shortFmt.format(Math.abs(n)) : moneyFmt.format(Math.abs(n)));
  }

  function moneyParts(n) {
    return { sign: n < 0 ? '−' : '', value: moneyFmt.format(Math.abs(n || 0)) };
  }

  function pct(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(digits === undefined ? 0 : digits) + '%';
  }

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /* Emojis por categoría o grupo (se pueden ampliar libremente). */
  const EMOJI = {
    comida: '🍽️', snacks: '🍫', pasajes: '🚌', gasolina: '⛽', lavado: '🧽', mantenimiento: '🔧',
    celular: '📱', gas: '🔥', hijos: '🐶', claude: '🤖', temu: '📦', suplementos: '💊', gym: '🏋️',
    electrodomesticos: '🔌', juegos: '🎮', cine: '🎬', ocio: '🎉', ropa: '👕', aseo: '🧴', barbero: '💈',
    imprevistos: '⚠️', regalos: '🎁', reuniones: '🍻', sueldo: '💼', 'ingreso extra': '💸',
    'movimiento interno': '🔁', alimentacion: '🍽️', transporte: '🚌', carro: '🚗', servicios: '💡',
    perritos: '🐶', suscripciones: '🔁', importaciones: '📦', deporte: '🏋️', hogar: '🏠',
    entretenimiento: '🎮', 'cuidado personal': '💈', social: '🎁', otros: '🧾',
    'ingresos fijos': '💼', 'ingresos variables': '💸', 'movimientos internos': '🔁'
  };
  const TYPE_EMOJI = { ingreso: '💰', gasto: '🧾', retiro: '🏧', deposito: '🏦', gasto_trabajo: '💼', reembolso: '↩️', interno: '🔁' };

  function emojiFor(categoria, grupo, tipo) {
    return EMOJI[norm(categoria)] || EMOJI[norm(grupo)] || TYPE_EMOJI[tipo] || '🧾';
  }

  const PALETTE = ['#ea580c', '#6366f1', '#0ea5e9', '#ec4899', '#14b8a6', '#84cc16', '#a855f7', '#eab308', '#0f766e', '#64748b', '#22c55e', '#8b5cf6'];
  let colors = {};
  function setGroups(groups) { colors = {}; groups.forEach(function (g, i) { colors[g] = PALETTE[i % PALETTE.length]; }); }
  function colorFor(g) {
    if (!colors[g]) colors[g] = PALETTE[Object.keys(colors).length % PALETTE.length];
    return colors[g];
  }

  function iconBox(categoria, grupo, tipo) {
    const c = grupo ? colorFor(grupo) : '#64748b';
    return '<div class="row-icon" style="background:' + c + '1f">' + emojiFor(categoria, grupo, tipo) + '</div>';
  }

  /** "2026-11-09T13:05" → Date local */
  function parseIso(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
  }
  function isoDate(d) {
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function dayLabel(dateIso) {
    const d = parseIso(dateIso);
    if (!d) return '';
    const today = new Date();
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (isoDate(d) === isoDate(today)) return 'Hoy';
    if (isoDate(d) === isoDate(y)) return 'Ayer';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()].toLowerCase();
  }
  function timeLabel(dateIso) {
    const d = parseIso(dateIso);
    if (!d) return '';
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'ahora';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    return 'hace ' + Math.round(s / 86400) + ' d';
  }

  function deltaPill(value, higherIsGood, suffix) {
    if (value === null || value === undefined || isNaN(value)) return '';
    if (Math.abs(value) < 0.5) return '<span class="pill neutral">= ' + (suffix || '') + '</span>';
    const up = value > 0;
    const good = higherIsGood ? up : !up;
    return '<span class="pill ' + (good ? 'good' : 'bad') + '">' + icon(up ? 'up' : 'down') + Math.abs(value).toFixed(0) + '%' + (suffix ? ' ' + suffix : '') + '</span>';
  }

  function empty(emoji, title, text) {
    return '<div class="empty"><div class="e-ic">' + emoji + '</div><b>' + esc(title) + '</b>' + esc(text || '') + '</div>';
  }

  function progress(p, estado, marker) {
    const w = Math.max(0, Math.min(100, p || 0));
    return '<div class="prog"><i class="' + (estado || '') + '" style="width:' + w + '%"></i>' +
      (marker ? '<span class="marker" style="left:' + Math.min(100, marker) + '%"></span>' : '') + '</div>';
  }

  let toastTimer;
  function toast(msg, opts) {
    opts = opts || {};
    const t = document.getElementById('toast');
    t.className = 'toast' + (opts.error ? ' error' : '');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (opts.action ? '<button>' + esc(opts.action.label) + '</button>' : '');
    if (opts.action) t.querySelector('button').onclick = function () { t.classList.remove('show'); opts.action.fn(); };
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, opts.error ? 6000 : 2600);
  }

  /* Hoja inferior */
  let sheetOnClose = null;
  function openSheet(html, onClose) {
    const body = document.getElementById('sheetBody');
    body.innerHTML = html;
    hydrateIcons(body);
    sheetOnClose = onClose || null;
    document.getElementById('sheetBackdrop').classList.add('open');
    document.getElementById('sheet').classList.add('open');
    return body;
  }
  function closeSheet() {
    document.getElementById('sheetBackdrop').classList.remove('open');
    document.getElementById('sheet').classList.remove('open');
    const cb = sheetOnClose; sheetOnClose = null;
    if (cb) cb();
  }
  function sheetOpen() { return document.getElementById('sheet').classList.contains('open'); }

  return {
    MONTHS: MONTHS, icon: icon, hydrateIcons: hydrateIcons, esc: esc, money: money, moneyParts: moneyParts, pct: pct, norm: norm,
    emojiFor: emojiFor, iconBox: iconBox, setGroups: setGroups, colorFor: colorFor, parseIso: parseIso, isoDate: isoDate,
    dayLabel: dayLabel, timeLabel: timeLabel, ago: ago, deltaPill: deltaPill, empty: empty, progress: progress, toast: toast,
    openSheet: openSheet, closeSheet: closeSheet, sheetOpen: sheetOpen
  };
})();
