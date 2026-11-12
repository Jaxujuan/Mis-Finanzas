/**
 * Config.gs
 * Configuración central del proyecto.
 * Si cambias el nombre de una pestaña o de una pregunta del Form, solo ajusta este archivo.
 * Los nombres se comparan sin distinguir mayúsculas, tildes ni emojis.
 */

const CONFIG = {
  /** Deja vacío si el script está creado desde el Sheet (Extensiones → Apps Script). */
  SPREADSHEET_ID: '',

  /** Correos adicionales autorizados para el dashboard web. Vacío = solo el dueño del script. */
  ALLOWED_EMAILS: [],

  TIMEZONE: 'America/Lima',
  CURRENCY_SYMBOL: 'S/',

  /** Segundos que se guarda la información en caché. Se invalida sola al registrar o editar datos. */
  CACHE_SECONDS: 300,

  /** Variantes aceptadas para el nombre de cada pestaña (la primera que exista se usa). */
  SHEETS: {
    MOVIMIENTOS: ['Respuestas de formulario 1', 'Form Responses 1', 'Movimientos', 'Respuestas'],
    CATEGORIAS: ['Categorias'],
    PRESUPUESTO: ['Presupuestos', 'Presupuesto'],
    GASTOS_FIJOS: ['Gastos Fijos', 'GastosFijos'],
    CONFIGURACION: ['Configuracion']
  },

  /** Variantes aceptadas para cada encabezado. */
  HEADERS: {
    MOVIMIENTOS: {
      fecha: ['Marca temporal', 'Fecha', 'Timestamp'],
      tipo: ['Tipo de Movimiento', 'Tipo'],
      categoria: ['Categoria', 'Categoria de gasto', 'Categoria gasto'],
      categoriaIngreso: ['Categoria de ingreso', 'Categoria ingreso'],
      monto: ['Monto', 'Importe'],
      medio: ['Medio', 'Medio de pago', 'Cuenta'],
      descripcion: ['Descripcion', 'Detalle', 'Comentario'],
      /** Opcional: pregunta de tipo Fecha en el Form. Si tiene valor, reemplaza a la marca temporal. */
      fechaMovimiento: ['Fecha del movimiento', 'Fecha movimiento', 'Fecha real']
    },
    CATEGORIAS: {
      categoria: ['Categoria'],
      grupo: ['Grupo'],
      tipo: ['Tipo']
    },
    PRESUPUESTO: {
      categoria: ['Categoria'],
      monto: ['Monto Mensual', 'Monto', 'Presupuesto'],
      /** Opcional. Vacío o 1 = presupuesto mensual. Mayor a 1 = compra periódica (el monto es el costo de cada compra). */
      meses: ['Cada (meses)', 'Cada meses', 'Meses', 'Duracion (meses)', 'Duracion', 'Frecuencia (meses)']
    },
    GASTOS_FIJOS: {
      concepto: ['Concepto'],
      categoria: ['Categoria'],
      monto: ['Monto'],
      dia: ['Dia de pago', 'Dia'],
      frecuencia: ['Frecuencia'],
      activo: ['Activo']
    },
    CONFIGURACION: {
      clave: ['Clave', 'Parametro', 'Concepto'],
      valor: ['Valor']
    }
  },

  /** Valores por defecto. Cualquiera puede sobrescribirse desde la hoja Configuracion. */
  DEFAULTS: {
    saldoInicialBanco: 0,
    saldoInicialEfectivo: 0,
    sueldoEsperado: 0,
    /** Un Sueldo registrado desde este día cuenta para el mes siguiente (Opción A). */
    diaSueldoMesSiguiente: 25,
    umbralAdvertencia: 80,
    umbralExcedido: 100,
    /** Tolerancia para reconocer un gasto fijo como pagado (0.25 = ±25% del monto). */
    toleranciaFijos: 0.25,
    /** Opcional: ignorar movimientos anteriores a esta fecha. Vacío = usar todo. */
    fechaInicio: null
  },

  /** Claves aceptadas en la hoja Configuracion → propiedad interna. */
  SETTING_KEYS: {
    'saldo inicial banco': 'saldoInicialBanco',
    'saldo inicial efectivo': 'saldoInicialEfectivo',
    'sueldo esperado': 'sueldoEsperado',
    'dia sueldo mes siguiente': 'diaSueldoMesSiguiente',
    'umbral advertencia': 'umbralAdvertencia',
    'umbral excedido': 'umbralExcedido',
    'tolerancia fijos': 'toleranciaFijos',
    'fecha inicio': 'fechaInicio'
  },

  /** Días promedio de un mes, para prorratear compras periódicas. */
  DAYS_PER_MONTH: 30.4375,

  /** Nombre de la categoría que se trata como sueldo. */
  SALARY_CATEGORY: 'Sueldo',

  /** Cantidad máxima de movimientos enviados a la tabla por periodo. */
  MAX_TABLE_ROWS: 3000,

  /** API para la app móvil (Api.gs). Las claves NO van aquí: van en Propiedades del script. */
  API: {
    /**
     * IA opcional para frases difíciles. Se usa el primer proveedor con API key en Propiedades del script:
     *   GEMINI_API_KEY (Google AI Studio)  →  Gemini
     *   ANTHROPIC_API_KEY                 →  Claude
     * El modelo de Gemini puede cambiarse con la propiedad GEMINI_MODEL sin tocar el código.
     */
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    GEMINI_URL: 'https://generativelanguage.googleapis.com/v1beta/models/',
    MODEL: 'claude-haiku-4-5-20251001',
    ANTHROPIC_URL: 'https://api.anthropic.com/v1/messages',
    ANTHROPIC_VERSION: '2023-06-01',
    MAX_TOKENS: 1500,
    MAX_TEXT_CHARS: 1200,
    MAX_ITEMS_PER_SAVE: 15,
    /** Intentos fallidos de clave permitidos por cada 10 minutos antes de bloquear. */
    MAX_FAILED_KEYS: 20,
    /** Cuántos meses de historial se usan para aprender (lugar → categoría, categoría → medio). */
    LEARN_MONTHS: 12,
    VERSION: '1.1.0'
  },

  /** Preguntas del Google Form (se buscan por título, sin importar tildes ni mayúsculas). */
  FORM_ITEMS: {
    tipo: ['Tipo de Movimiento', 'Tipo'],
    categoria: ['Categoria', 'Categoria de gasto', 'Categoria gasto'],
    categoriaIngreso: ['Categoria de ingreso', 'Categoria ingreso'],
    monto: ['Monto', 'Importe'],
    medio: ['Medio', 'Medio de pago', 'Cuenta'],
    descripcion: ['Descripcion', 'Detalle', 'Comentario'],
    fecha: ['Fecha del movimiento', 'Fecha movimiento', 'Fecha real']
  }
};

/** Tipos de movimiento internos y cómo se muestran. */
const MOVEMENT_TYPES = {
  ingreso: { label: 'Ingreso' },
  gasto: { label: 'Gasto' },
  retiro: { label: 'Retiro de efectivo' },
  deposito: { label: 'Depósito a banco' },
  gasto_trabajo: { label: 'Gasto reembolsable' },
  reembolso: { label: 'Reembolso' },
  interno: { label: 'Movimiento interno' }
};

/** Cuentas internas. Yape, Plin y débito se suman al Banco. */
const ACCOUNTS = {
  banco: { label: 'Banco' },
  efectivo: { label: 'Efectivo' },
  credito: { label: 'Tarjeta de crédito' }
};

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
