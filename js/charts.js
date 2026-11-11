/* =========================================================
   charts.js · gráficos con Chart.js (se crean una vez y se actualizan)
   ========================================================= */
const Charts = (function () {
  const inst = {};
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function ready() { return typeof Chart !== 'undefined'; }

  function upsert(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !ready()) return;
    if (inst[id] && inst[id].canvas !== canvas) { inst[id].destroy(); delete inst[id]; }
    if (inst[id]) {
      inst[id].data = config.data;
      inst[id].options = config.options;
      inst[id].update();
      return;
    }
    inst[id] = new Chart(canvas, config);
  }

  function tooltip(label) {
    return {
      backgroundColor: css('--text'), titleColor: css('--bg'), bodyColor: css('--bg'), padding: 10, cornerRadius: 10,
      displayColors: false, titleFont: { family: 'Inter', weight: '700' }, bodyFont: { family: 'Inter' },
      callbacks: { label: label }
    };
  }

  /**
   * Ritmo del mes: acumulado actual (relleno), mes anterior (gris) y proyección (punteada).
   */
  function pace(id, p) {
    const days = p.daysInMonth;
    const labels = [];
    for (let i = 1; i <= days; i++) labels.push(i);
    const prev = labels.map(function (d) { return d <= p.previous.length ? p.previous[d - 1] : null; });
    const cur = labels.map(function (d) { return d <= p.current.length ? p.current[d - 1] : null; });
    let proj = labels.map(function () { return null; });
    if (p.projection !== null && p.current.length) {
      const startDay = p.current.length, startVal = p.current[startDay - 1];
      proj = labels.map(function (d) {
        if (d < startDay) return null;
        return Math.round((startVal + (p.projection - startVal) * (d - startDay) / Math.max(1, days - startDay)) * 100) / 100;
      });
    }
    const primary = css('--primary');
    upsert(id, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: p.prevLabel, data: prev, borderColor: css('--chart-prev'), borderWidth: 2, pointRadius: 0, tension: .3, spanGaps: true },
          { label: 'Proyección', data: proj, borderColor: primary, borderDash: [5, 5], borderWidth: 2, pointRadius: 0, tension: 0 },
          { label: p.label, data: cur, borderColor: primary, backgroundColor: primary + '26', fill: 'origin', borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, tension: .3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltip(function (c) { return c.parsed.y === null ? null : c.dataset.label + ': ' + UI.money(c.parsed.y); })
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: css('--faint'), font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
          y: { display: false, beginAtZero: true }
        }
      }
    });
  }

  function donut(id, items) {
    upsert(id, {
      type: 'doughnut',
      data: { labels: items.map(function (i) { return i.name; }), datasets: [{ data: items.map(function (i) { return i.total; }), backgroundColor: items.map(function (i) { return i.color; }), borderWidth: 2, borderColor: css('--surface'), hoverOffset: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: tooltip(function (c) { return c.label + ': ' + UI.money(c.parsed); }) } }
    });
  }

  function balance(id, history) {
    const primary = css('--primary');
    upsert(id, {
      type: 'line',
      data: {
        labels: history.map(function (h) { return h.label; }),
        datasets: [
          { label: 'Disponible', data: history.map(function (h) { return h.disponible; }), borderColor: primary, backgroundColor: primary + '22', fill: true, tension: .3, borderWidth: 3, pointRadius: 3 },
          { label: 'Banco', data: history.map(function (h) { return h.banco; }), borderColor: '#6366f1', tension: .3, borderWidth: 2, pointRadius: 2 },
          { label: 'Efectivo', data: history.map(function (h) { return h.efectivo; }), borderColor: '#f59e0b', tension: .3, borderWidth: 2, pointRadius: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: css('--muted'), font: { family: 'Inter', size: 12 } } }, tooltip: tooltip(function (c) { return c.dataset.label + ': ' + UI.money(c.parsed.y); }) },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: css('--faint'), font: { size: 11 } } },
          y: { grid: { color: css('--border') }, border: { display: false }, ticks: { color: css('--faint'), font: { size: 11 }, callback: function (v) { return 'S/ ' + Number(v).toLocaleString('es-PE'); } } }
        }
      }
    });
  }

  return { pace: pace, donut: donut, balance: balance, ready: ready };
})();
