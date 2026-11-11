# Mis Finanzas

App personal de finanzas: registras gastos e ingresos **con tu voz** y ves cómo vas en el mes.
Tus datos siguen en **tu Google Sheets**. Esta app solo los muestra y agrega movimientos a través de tu Google Form.

```
Tu celular (esta app, GitHub Pages)
   │  1. Interpreta lo que dices en el teléfono (reglas + lo aprendido de tu historial) — gratis
   │  2. Solo si no entiende la frase y lo activaste: pide ayuda a Gemini
   │  clave personal
   ▼
Apps Script (API)  ──►  Google Form  ──►  Google Sheets
```

## Estructura del repositorio

| Carpeta / archivo | Qué es |
|---|---|
| `index.html`, `app.css`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js` | La app (lo que publica GitHub Pages) |
| `js/parser.js` | Intérprete local de frases en español peruano (sin IA) |
| `demo/` | Datos **inventados** para el modo ejemplo |
| `apps-script/` | Copia del código del servidor (Apps Script), para tener historial de cambios. **No contiene claves.** |

---

## Instalación (una sola vez)

### 1. Actualiza tu proyecto de Apps Script
En el editor de Apps Script de tu Sheet, copia desde la carpeta `apps-script/`:

| Archivo | Acción |
|---|---|
| `Api.gs` | **Nuevo**: **+ → Secuencia de comandos**, nómbralo `Api` y pega el contenido |
| `Config.gs`, `DataService.gs`, `FinanceService.gs`, `Code.gs` | Reemplaza su contenido |

Guarda con **Ctrl+S**.

### 2. Agrega dos preguntas opcionales a tu Google Form
En el editor, elige **`agregarPreguntasOpcionales`** y pulsa **▷ Ejecutar** (una sola vez). Agrega, después de "Medio" y sin ser obligatorias:
- **Descripción** (respuesta corta): guarda "Plaza Vea", "Yape" o "regalo tío", y la app **aprende** de esas descripciones para adivinar la categoría.
- **Fecha del movimiento** (fecha): permite registrar gastos de días anteriores ("ayer…").

### 3. Crea tu clave personal
En el editor, elige **`configurarApp`** y pulsa **▷ Ejecutar**. Acepta los permisos: leer tu Form y conectarse a servicios externos.
En el **Registro de ejecución** aparece `Tu clave personal para la app: …`. **Cópiala.**

¿Perdiste el celular? Ejecuta `regenerarClaveApp` y la clave anterior deja de funcionar.

### 4. Publica la API
**Implementar → Nueva implementación → ⚙️ → Aplicación web** con estas opciones:
- Descripción: `API app`
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona**

Copia la URL que termina en `/exec`: es tu **URL de API**.

> La app vive fuera de Google y no puede iniciar sesión con tu cuenta. Por eso la API exige tu clave personal en cada llamada y se bloquea tras varios intentos fallidos. El dashboard web antiguo solo te lo muestra a ti.

### 5. Activa GitHub Pages
En este repositorio, ve a **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, rama **main**, carpeta **/ (root)**, y pulsa **Save**.
En 1–2 minutos la app queda en `https://jaxujuan.github.io/Mis-Finanzas/`.

### 6. Instálala en tu celular
1. Abre esa dirección en **Chrome**.
2. Ingresa tu **URL de API** y tu **clave personal**, y pulsa **Conectar**.
3. Menú **⋮ → Instalar app**.
4. La primera vez que toques el 🎤, **permite el micrófono**.

---

## IA de respaldo con Gemini (opcional)
Sin IA, la app entiende frases como *"almuerzo 25 con yape"*, *"ayer taxi 12 en efectivo"* o *"veinte con cincuenta de menú"*. Si quieres que también entienda frases raras o desordenadas:

1. Entra a **aistudio.google.com** con tu cuenta de Google.
2. Pulsa **Get API key → Create API key** y copia la clave (empieza con `AIza`).
3. En Apps Script, ve a **⚙️ Configuración del proyecto → Propiedades del script → Agregar propiedad**:
   - Propiedad: `GEMINI_API_KEY`
   - Valor: la clave
4. Ejecuta `configurarApp` de nuevo (o `probarApi` para revisar todo). Debe decir *"IA de respaldo: Gemini (…)"*.

Funcionamiento:
- La IA **solo** se usa cuando las reglas no entienden la categoría o el monto. Lo demás se resuelve en el teléfono.
- En **Más → Ajustes** puedes desactivarla. En cada revisión también aparece **"Reinterpretar con Gemini"**.
- Para cambiar de modelo sin tocar el código, agrega la propiedad `GEMINI_MODEL` (por defecto `gemini-3.1-flash-lite`).
- Revisa los límites y condiciones del nivel gratuito de Gemini en AI Studio: pueden cambiar, y en el nivel gratuito Google puede usar lo que envías para mejorar sus productos.
- También funciona con Claude si en lugar de Gemini agregas `ANTHROPIC_API_KEY`. Si hay ambas claves, se usa Gemini.

> Las claves de IA viven solo en las Propiedades del script. Nunca las pegues en la app ni las subas a este repositorio.

---

## Cómo se usa
- **🎤 Dictar:** *"almuerzo 25 con Yape, ayer taxi 12 en efectivo y regalo para mi tío 80"* genera 3 tarjetas. Revisa, corrige lo marcado en amarillo y guarda.
- **+ Agregar** (en Movimientos): registro manual.
- **Inicio:** gasto del mes frente al mes anterior a la misma fecha, proyección de cierre, lo libre del mes, saldos, últimos 15 días, alertas, presupuestos y próximos pagos.
- **‹ Mes ›:** cambia el periodo. Toca el nombre del mes para elegir otro mes o el año completo.
- **Más:** saldos y patrimonio, análisis por grupo y ajustes.

## Actualizar
- **Servidor:** pega los `.gs` nuevos y luego ve a Implementar → Gestionar implementaciones → **API app** → ✏️ → **Nueva versión**. La URL no cambia.
- **App:** los cambios que se suben a este repositorio se publican solos. En el celular, cierra y vuelve a abrir la app.
