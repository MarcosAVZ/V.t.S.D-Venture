import Groq from 'groq-sdk';

let groq = null;

function getClient() {
  if (!groq) {
    groq = new Groq();
  }
  return groq;
}

const EXTRACTION_PROMPT = `Eres un sistema de extracción de información para un sistema de inventario.

Tu tarea es analizar la transcripción de una conversación y extraer información de UNA SOLA operación.

NO inventes información. Si un dato no está presente, usa null para strings y 0 para números.

Primero, detecta el tipo de operación basándote en las siguientes señales lingüísticas:

1. COMPRA: palabras como "compré", "compre", "traje", "ingresé", "ingrese", "incoming"
2. VENTA: palabras como "vendí", "vendi", "salí", "sali", "outgoing"
3. NUEVO_PRODUCTO: palabras como "nuevo", "nueva", "crear", "agregar"
4. AJUSTE: palabras como "rompió", "rompio", "dañado", "danado", "ajuste", "ajustar"
5. CONSULTA: palabras como "cuántas", "cuantas", "cuánto", "cuanto", "stock", "tengo", "hay"

Si detectas múltiples operaciones en la misma grabación, devuelve:
{ "error": "multiple_operations", "operations": ["COMPRA", "VENTA"] }

Para cada operación, extrae los campos específicos. SIEMPRE incluí TODOS los campos, usando null si no están presentes:

COMPRA:
{
  "operation": "COMPRA",
  "fecha": "YYYY-MM-DD o null si no se menciona",
  "proveedor": "nombre del proveedor o null",
  "productos": [
    {
      "nombre": "nombre del producto",
      "color": "color o null",
      "talle": "talle o null",
      "cantidad": número,
      "precio_unitario": número o null
    }
  ],
  "metodo_pago": "método de pago o null"
}

VENTA:
{
  "operation": "VENTA",
  "fecha": "YYYY-MM-DD o null si no se menciona",
  "cliente": "nombre del cliente o null",
  "productos": [
    {
      "nombre": "nombre del producto",
      "color": "color o null",
      "talle": "talle o null",
      "cantidad": número,
      "precio_unitario": número o null
    }
  ],
  "metodo_pago": "método de pago o null"
}

NUEVO_PRODUCTO:
{
  "operation": "NUEVO_PRODUCTO",
  "producto": "nombre del producto",
  "precio": número (precio de compra POR UNIDAD — si el usuario dice un total, dividilo por la cantidad. Ej: "50 remeras por 6000" → precio = 120),
  "precio_venta": número o 0 si no se menciona (precio de venta POR UNIDAD),
  "stock_inicial": número o 0 si no se menciona
}

REGLA IMPORTANTE para NUEVO_PRODUCTO:
- Si el usuario dice "compré X unidades por Y pesos", el precio unitario es Y / X
- Ejemplo: "50 remeras por 6000" → precio: 120, stock_inicial: 50
- Ejemplo: "remeras a 15 pesos la unidad" → precio: 15, stock_inicial: 0 (si no menciona cantidad)
- Ejemplo: "200 medias por 1000, se venden a 5" → precio: 5, precio_venta: 5, stock_inicial: 200

AJUSTE:
{
  "operation": "AJUSTE",
  "producto": "nombre del producto",
  "color": "color o null",
  "talle": "talle o null",
  "cantidad": número (puede ser negativo para bajar stock),
  "motivo": "motivo del ajuste o null"
}

CONSULTA:
{
  "operation": "CONSULTA",
  "producto": "nombre del producto",
  "color": "color o null",
  "talle": "talle o null"
}

Normaliza todos los nombres de productos, colores y talles a minúsculas y sin espacios extra.

Los precios y cantidades deben ser números, sin símbolos de moneda.

Devuelve exclusivamente JSON válido.`;

/**
 * Extracts operation data from transcription text using Groq LLM.
 * Uses JSON mode for reliable output parsing.
 * Returns { operation, data } envelope for single operations.
 * Throws error for multiple operations detected.
 * @param {string} transcriptionText - Transcribed text
 * @returns {Promise<Object>} Parsed JSON object with operation and data
 * @throws {Error} If extraction fails, returns invalid JSON, or detects multiple operations
 */
export async function extractOperationData(transcriptionText) {
  try {
    const response = await getClient().chat.completions.create({
      model: 'openai/gpt-oss-20b',
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

    const parsed = JSON.parse(content);
    
    // Check for multiple operations detection
    if (parsed.error === 'multiple_operations' && Array.isArray(parsed.operations)) {
      const error = new Error('Se detectaron múltiples operaciones en una grabación. Grabá una operación por vez.');
      error.code = 'MULTIPLE_OPERATIONS';
      error.operations = parsed.operations;
      throw error;
    }
    
    // Ensure we have operation field
    if (!parsed.operation) {
      throw new Error('AI response missing operation field');
    }
    
    // Normalize product names, colors, and talle values
    const normalizedData = normalizeOperationData(parsed);
    
    return normalizedData;
  } catch (error) {
    console.error('AI extraction error:', error.message);
    throw new Error(`AI extraction failed: ${error.message}`);
  }
}

/**
 * Normalizes product names, colors, and talle values to lowercase and trimmed.
 * @param {Object} operationData - Operation data from AI
 * @returns {Object} Normalized operation data
 */
function normalizeOperationData(operationData) {
  const { operation, ...data } = operationData;
  
  // Helper to normalize string values
  const normalizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.toLowerCase().trim();
  };
  
  // Normalize based on operation type
  switch (operation) {
    case 'COMPRA':
    case 'VENTA':
      return {
        operation,
        ...data,
        productos: data.productos?.map(product => ({
          ...product,
          nombre: normalizeString(product.nombre),
          color: product.color ? normalizeString(product.color) : null,
          talle: product.talle ? normalizeString(product.talle) : null,
        })) || [],
      };
    
    case 'NUEVO_PRODUCTO':
      return {
        operation,
        ...data,
        producto: normalizeString(data.producto),
      };
    
    case 'AJUSTE':
      return {
        operation,
        ...data,
        producto: normalizeString(data.producto),
        color: data.color ? normalizeString(data.color) : null,
        talle: data.talle ? normalizeString(data.talle) : null,
      };
    
    case 'CONSULTA':
      return {
        operation,
        ...data,
        producto: normalizeString(data.producto),
        color: data.color ? normalizeString(data.color) : undefined,
        talle: data.talle ? normalizeString(data.talle) : undefined,
      };
    
    default:
      return operationData;
  }
}

// Keep backward compatibility
export const extractPurchaseData = extractOperationData;
