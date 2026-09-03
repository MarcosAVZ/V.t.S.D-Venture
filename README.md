# V.t.S.D — Voice to Structured Data

Convertí notas de voz en datos estructurados de compra. Grabá tu voz describiendo una compra, y la app transcribe el audio y extrae los datos automáticamente en un esquema validado.

## Requisitos previos

- [Node.js](https://nodejs.org/) >= 18
- [npm](https://npmjs.com/) >= 9
- Una [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

Copiá el archivo de ejemplo y completá tu API key:

```bash
cp .env.example server/.env
```

Editá `server/.env`:

```
OPENAI_API_KEY=sk-tu-api-key-aqui
PORT=3000
```

> ⚠️ Nunca commiteés tu `.env`. Está incluido en `.gitignore`.

## Ejecutar

### Desarrollo (recomendado)

```bash
npm run dev
```

Esto levanta ambos servicios en paralelo:

| Servicio | URL |
|----------|-----|
| Frontend (Vite) | http://localhost:5173 |
| Backend (Express) | http://localhost:3000 |

### Por separado

```bash
# Terminal 1 — Servidor
cd server && npm run dev

# Terminal 2 — Cliente
cd client && npm run dev
```

## API

### Health Check

```
GET /api/health
```

Respuesta:

```json
{ "status": "ok" }
```

### Procesar audio

```
POST /api/voice/process
Content-Type: multipart/form-data
```

**Body (form-data):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `audio` | File | Sí | Archivo de audio (webm, ogg, wav, mp3, mpeg). Máximo 10MB. |

**Respuesta exitosa (200):**

```json
{
  "transcription": "Compré 3 litros de leche por 250 pesos",
  "data": {
    "tipo": "compra",
    "proveedor": null,
    "producto": "leche",
    "cantidad": 3,
    "precio_unitario": 250,
    "fecha": "2025-01-15",
    "metodo_pago": null
  }
}
```

**Errores:**

| Código | Descripción |
|--------|-------------|
| 400 | No se proporcionó archivo de audio |
| 400 | Archivo supera el límite de 10MB |
| 422 | Tipo de archivo no válido (solo audio) |
| 422 | Transcripción fallida |
| 500 | Error interno del servidor |

## Arquitectura

```
V.t.S.D-Venture/
├── client/                  # React (Vite)
│   ├── src/
│   │   ├── App.jsx          # Orquestador principal con estado
│   │   ├── App.css          # Estilos (tema brutalista)
│   │   └── components/
│   │       ├── Recorder.jsx         # Grabación + upload
│   │       ├── Transcription.jsx    # Visualización de transcripción
│   │       └── StructuredData.jsx   # Visualización de datos JSON
│   └── vite.config.js       # Proxy /api → localhost:3000
├── server/                  # Express (Node.js)
│   └── src/
│       ├── index.js         # App Express, CORS, error handlers
│       ├── routes/
│       │   └── voiceRoutes.js       # POST /api/voice/process
│       ├── services/
│       │   ├── transcriptionService.js  # OpenAI Whisper
│       │   └── aiService.js            # OpenAI GPT-4o-mini
│       └── schemas/
│           └── purchaseSchema.js    # Zod validation
└── package.json             # Workspaces + concurrently
```

## Flujo

1. **Grabar**: El usuario presiona el botón y habla al micrófono (máx. 60s)
2. **Subir**: El audio se envía al backend como `FormData`
3. **Transcribir**: OpenAI Whisper convierte audio a texto
4. **Extraer**: GPT-4o-mini analiza el texto y extrae campos de compra
5. **Validar**: Zod valida la estructura. Si falla, reintenta una vez
6. **Mostrar**: El frontend muestra la transcripción y los datos estructurados

## Tecnologías

- **Frontend**: React 19, Vite 6
- **Backend**: Express 5, Multer, Zod
- **AI**: OpenAI API (Whisper + GPT-4o-mini)
- **Diseño**: Tema oscuro brutalista, fuentes monoespaciadas
