/**
 * Utils.gs
 * Funciones genéricas: normalización de texto, montos, fechas y redondeo.
 */

/** Error con un mensaje apto para mostrar al usuario. */
class AppError extends Error {
  constructor(userMessage, detail) {
    super(detail || userMessage);
    this.userMessage = userMessage;
  }
}

/** Minúsculas, sin tildes, sin emojis ni signos, espacios simples. */
function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Limpia emojis y espacios sobrantes conservando mayúsculas y tildes (para mostrar). */
function cleanLabel(value) {
  return String(value == null ? '' : value)
    .replace(/[^\p{L}\p{N}\s.,()\-\/&]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte "S/.1,300.50", "800", 135.22 o "1.300,50" a número. */
function parseAmount(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  let s = String(value == null ? '' : value).replace(/[^\d,.\-]/g, '').replace(/^[.,]+/, '');
  if (!s) return 0;
  const decPos = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (decPos >= 0) {
    const decimals = s.length - decPos - 1;
    if (decimals > 0 && decimals <= 2) {
      s = s.slice(0, decPos).replace(/[.,]/g, '') + '.' + s.slice(decPos + 1);
    } else {
      s = s.replace(/[.,]/g, '');
    }
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** Acepta Date, "23/9/2026", "23/9/2026 14:05:00" o ISO. Devuelve Date o null. */
function parseDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 'yyyy-MM' de una fecha (zona horaria del script = America/Lima). */
function periodKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
}

/** Suma meses a una clave 'yyyy-MM'. */
function shiftPeriod(key, delta) {
  const parts = key.split('-');
  const d = new Date(+parts[0], +parts[1] - 1 + delta, 1);
  return periodKey(d);
}

function periodLabel(key, short) {
  const parts = key.split('-');
  const names = short ? MONTH_SHORT : MONTH_NAMES;
  const name = names[+parts[1] - 1];
  return short ? name + ' ' + parts[0].slice(2) : name + ' ' + parts[0];
}

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

function formatDateISO(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
    'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function formatDateShort(date) {
  return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear();
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function pct(part, total) { return total > 0 ? round2(part / total * 100) : null; }

/** Variación entre dos valores: { value, prev, delta, deltaPct }. */
function compare(value, prev) {
  return {
    value: round2(value),
    prev: round2(prev),
    delta: round2(value - prev),
    deltaPct: prev !== 0 ? round2((value - prev) / Math.abs(prev) * 100) : null
  };
}

/** Interpreta "Si", "Sí", "TRUE", true, "x" como verdadero. Vacío = verdadero. */
function parseBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = normalizeText(value);
  if (s === '') return true;
  return ['si', 's', 'true', 'x', '1', 'yes', 'activo'].indexOf(s) >= 0;
}

/** Fecha actual (zona del script). Separado para facilitar pruebas. */
function now_() { return new Date(); }
