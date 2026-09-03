import Groq from 'groq-sdk';

let groq = null;

function getClient() {
  if (!groq) {
    groq = new Groq();
  }
  return groq;
}

const EXTRACTION_PROMPT = `Eres un sistema de extracción de información.

Tu tarea es analizar la transcripción de una conversación y convertir la información de una compra en datos estructurados.

NO inventes información.

Si un dato no está presente, devuelve null.

Una compra puede contener uno o varios productos.

Extrae:
- fecha
- proveedor
- productos (cada producto debe ser un objeto independiente con: producto, cantidad, color, talle, precio_unitario)
- metodo_pago

La fecha debe utilizar el formato YYYY-MM-DD.
Los precios y cantidades deben ser números, sin símbolos de moneda.

Devuelve exclusivamente JSON válido.`;

// JSON Schema for Groq Structured Outputs
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    fecha: { type: ['string', 'null'], description: 'Formato YYYY-MM-DD' },
    proveedor: { type: ['string', 'null'] },
    productos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          producto: { type: 'string' },
          cantidad: { type: 'number' },
          color: { type: ['string', 'null'] },
          talle: { type: ['string', 'null'] },
          precio_unitario: { type: 'number' },
        },
        required: ['producto', 'cantidad', 'precio_unitario'],
      },
    },
    metodo_pago: { type: ['string', 'null'] },
  },
  required: ['fecha', 'proveedor', 'productos', 'metodo_pago'],
};

/**
 * Extracts purchase data from transcription text using Groq LLM.
 * Uses Structured Outputs when available, falls back to JSON parsing.
 * @param {string} transcriptionText - Transcribed text
 * @returns {Promise<Object>} Parsed JSON object
 * @throws {Error} If extraction fails or returns invalid JSON
 */
export async function extractPurchaseData(transcriptionText) {
  try {
    const response = await getClient().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `Transcripción:\n\n${transcriptionText}` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'purchase_extraction',
          strict: true,
          schema: EXTRACTION_SCHEMA,
        },
      },
      temperature: 0,
      max_tokens: 1024,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from AI');
    }

    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    // If structured outputs fail, try plain JSON mode
    if (error.status === 400 || error.message?.includes('json_schema')) {
      console.warn('Structured outputs not supported, falling back to JSON mode');
      return extractWithJsonMode(transcriptionText);
    }
    console.error('AI extraction error:', error.message);
    throw new Error(`AI extraction failed: ${error.message}`);
  }
}

/**
 * Fallback: extraction using plain JSON mode (no schema enforcement).
 */
async function extractWithJsonMode(transcriptionText) {
  const response = await getClient().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `Transcripción:\n\n${transcriptionText}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 1024,
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('Empty response from AI');
  }

  return JSON.parse(content);
}
