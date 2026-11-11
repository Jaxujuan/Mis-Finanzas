# Mis Finanzas — Dashboard con Google Apps Script

Google Sheets (Form) → Apps Script (backend) → HTML/CSS/JS (dashboard)

## 1. Archivos

| Archivo | Tipo en el editor | Responsabilidad |
|---|---|---|
| `Config.gs` | Script | Nombres de pestañas, encabezados y valores por defecto |
| `Utils.gs` | Script | Normalización de textos, montos y fechas |
| `DataService.gs` | Script | Lectura del Sheet (una lectura por pestaña) |
| `FinanceService.gs` | Script | KPIs, presupuesto, fijos, saldos, alertas |
| `Code.gs` | Script | `doGet`, API `getDashboardData`, caché, triggers, diagnóstico |
| `Index.html` | HTML | Estructura del dashboard |
| `Styles.html` | HTML | Tema (variables CSS) y diseño responsive |
| `Components.html` | HTML | Componentes de UI reutilizables |
| `Charts.html` | HTML | Gráficos (Chart.js) |
| `JavaScript.html` | HTML | Estado, filtros, navegación y vistas |
| `appsscript.json` | Manifiesto | Zona horaria Lima, V8, acceso "Solo yo" |

## 2. Instalación (10 minutos)

1. Abre tu Google Sheets → **Extensiones → Apps Script**.
2. Borra el contenido de `Código.gs` y renómbralo a `Code`.
3. Crea cada archivo con **+ → Secuencia de comandos** (los `.gs`) o **+ → HTML** (los `.html`).
   Usa el nombre **sin extensión** (ej. `Styles`, no `Styles.html`) y pega el contenido.
4. Manifiesto: **Configuración del proyecto (⚙️) → Mostrar "appsscript.json"**, luego pega el contenido del archivo.
5. Selecciona la función `diagnostico` y pulsa **Ejecutar**. Acepta los permisos.
   Revisa el **Registro de ejecución**: debe encontrar tus pestañas y columnas.
6. Ejecuta `setupTriggers` una vez (la caché se limpia sola al registrar en el Form o editar el Sheet).
7. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Solo yo**
8. Abre la URL que te da. Guárdala como marcador o agrégala a la pantalla de inicio del celular.

> Cada cambio en el código requiere **Implementar → Gestionar implementaciones → Editar → Nueva versión**.
> Para probar sin publicar, usa la URL de **Implementación de prueba** (termina en `/dev`).

## 3. Estructura del Sheet

| Pestaña | Columnas |
|---|---|
| Respuestas de formulario 1 | Marca temporal · Tipo de Movimiento · Categoría · (Categoría de ingreso) · Monto · Medio · (Descripción) |
| Categorias | Categoria · Grupo · Tipo (Gasto / Ingreso / Interno) |
| Presupuestos | Categoría · Monto Mensual |
| Gastos Fijos | Concepto · Categoria · Monto · Día de pago · Frecuencia · Activo |
| Configuracion *(opcional)* | Clave · Valor |

Los encabezados deben estar en las primeras filas (se toleran títulos encima). Mayúsculas, tildes y emojis no importan.

### Claves opcionales de `Configuracion`

| Clave | Ejemplo | Para qué sirve |
|---|---|---|
| Saldo inicial Banco | 0 | Punto de partida del saldo del banco |
| Saldo inicial Efectivo | 0 | Punto de partida del efectivo |
| Sueldo esperado | 1300 | Estima el "Libre para el mes" antes de registrar el sueldo |
| Dia sueldo mes siguiente | 25 | Sueldo registrado desde ese día cuenta para el mes siguiente |
| Umbral advertencia | 80 | % de presupuesto que pinta amarillo |
| Umbral excedido | 100 | % que pinta rojo |
| Tolerancia fijos | 25 | ±% para reconocer un gasto fijo como pagado |
| Fecha inicio | 01/10/2026 | Ignora movimientos anteriores |

Como tus filas de septiembre ya cuadran tus saldos reales, los saldos iniciales pueden quedar en 0.

## 4. Tipos de movimiento reconocidos

| Texto en el Form (contiene) | Ingreso | Gasto | Saldos |
|---|---|---|---|
| Ingreso | ✅ | | + medio |
| Gasto | | ✅ | − medio |
| Retiro | | | Banco → Efectivo |
| Depósito | | | Efectivo → Banco |
| Gasto del trabajo / reembolsable | | | − medio, + por cobrar |
| Reembolso | | | + medio, − por cobrar |

Medios: "Efectivo" → Efectivo; "Crédito" → Tarjeta de crédito (pasivo); cualquier otro (Cuenta Bancaria, Yape, Plin) → Banco.

## 5. Cómo se actualiza

- Una sola llamada `getDashboardData(filtros)` alimenta todas las vistas.
- Caché de 5 minutos que se invalida automáticamente al registrar o editar datos (triggers).
- **Actualizar datos** fuerza una lectura directa del Sheet.
- Refresco automático cada 5 minutos mientras la pestaña está visible (desactivable en Ajustes).

## 6. Seguridad

- Desplegado como **Ejecutar como: Yo / Acceso: Solo yo**: nadie más puede abrir la URL.
- No hay claves ni credenciales en el frontend.
- Opcional: agrega tu correo en `CONFIG.ALLOWED_EMAILS` como segunda barrera.
