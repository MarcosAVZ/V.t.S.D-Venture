import OpenAI from 'openai';

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI();
  }
  return openai;
}

const EXTRACTION_PROMPT = `Analiza el texto proporcionado por el usuario y extrae exclusivamente la información correspondiente a una compra. No inventes información. Si un dato no está presente en el texto, utiliza null. Normaliza las fechas al formato YYYY-MM-DD. Extrae números como valores numéricos, sin símbolos de moneda. Devuelve únicamente la estructura solicitada.

Estructura esperada:
{
  "tipo": "compra",
  "proveedor": "string o null",
  "producto": "string o null",
  "cantidad": number o null,
  "precio_unitario": number o null,
  "fecha": "YYYY-MM-DD o null",
  "metodo_pago": "string o null"
}`;

/**
 * Extracts purchase data from transcription text using GPT.
 * @param {string} transcriptionText - Transcribed text
 * @returns {Promise<Object>} Parsed JSON object
 * @throws {Error} If extraction fails or returns invalid JSON
 */
export async function extractPurchaseData(transcriptionText) {
  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Eres un asistente que extrae información de compras de texto.' },
        { role: 'user', content: `${EXTRACTION_PROMPT}\n\nTexto: ${transcriptionText}` },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from AI');
    }

    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    console.error('AI extraction error:', error.message);
    throw new Error(`AI extraction failed: ${error.message}`);
  }
}