import { z } from 'zod';
import { todayAR } from '../utils/dateAr.js';

const MAX_STR = 200;
const MAX_PRODUCTOS = 50;

// Helper: coerce string numbers to actual numbers (AI sometimes returns "10" instead of 10).
// null/undefined become undefined so defaults / required checks apply.
const coerceNumber = (val) => {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') {
    if (val.trim() === '') return undefined;
    const parsed = Number(val);
    return isNaN(parsed) ? val : parsed;
  }
  return val;
};

// Optional non-negative finite number, defaults to 0 (null from the AI -> 0)
const num = z.preprocess(coerceNumber, z.number().finite().nonnegative().optional()).transform((v) => v ?? 0);

// Required strictly positive finite number (COMPRA / VENTA quantities)
const numRequired = z.preprocess(coerceNumber, z.number().finite().positive());

// Required non-zero finite number: AJUSTE can raise (+) or lower (-) stock
const numNonZero = z.preprocess(coerceNumber, z.number().finite().refine((n) => n !== 0, { message: 'Debe ser distinto de 0' }));

// Required trimmed string with bounded length
const str = z.string().trim().min(1).max(MAX_STR);

// Optional trimmed string with bounded length (null from the AI -> '')
const optStr = z.preprocess((val) => (val === null ? undefined : val), z.string().trim().max(MAX_STR).optional()).transform((v) => v ?? '');

// Today (Argentina local date) as YYYY-MM-DD, evaluated per parse (NOT at module load)
const today = () => todayAR();
const fechaSchema = z.preprocess(
  (val) => (val === null || val === '' ? undefined : val),
  z.string().trim().max(MAX_STR).optional()
).transform((v) => v ?? today());

// Base product schema used in COMPRA and VENTA
const productoItemSchema = z.object({
  nombre: str,
  color: optStr,
  talle: optStr,
  cantidad: numRequired,
  precio_unitario: num,
});

const productosSchema = z.array(productoItemSchema).min(1).max(MAX_PRODUCTOS);

// Individual operation schemas
export const compraSchema = z.object({
  operation: z.literal('COMPRA'),
  fecha: fechaSchema,
  proveedor: optStr,
  productos: productosSchema,
  metodo_pago: optStr,
});

export const ventaSchema = z.object({
  operation: z.literal('VENTA'),
  fecha: fechaSchema,
  cliente: optStr,
  productos: productosSchema,
  metodo_pago: optStr,
});

export const nuevoProductoSchema = z.object({
  operation: z.literal('NUEVO_PRODUCTO'),
  producto: str,
  precio: num,
  precio_venta: num,
  stock_inicial: num,
});

export const ajusteSchema = z.object({
  operation: z.literal('AJUSTE'),
  producto: str,
  color: optStr,
  talle: optStr,
  cantidad: numNonZero, // negative lowers stock, positive raises it
  motivo: optStr,
});

export const consultaSchema = z.object({
  operation: z.literal('CONSULTA'),
  producto: str,
  color: optStr,
  talle: optStr,
});

// Discriminated union of all operation schemas
export const operationSchema = z.discriminatedUnion('operation', [
  compraSchema,
  ventaSchema,
  nuevoProductoSchema,
  ajusteSchema,
  consultaSchema,
]);

/**
 * Validates data against the discriminated union operation schema.
 * Returns { success: true, data } or { success: false, errors }
 */
export function validateOperation(data) {
  const result = operationSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, errors: result.error.format() };
  }
}

// Backward compatibility: keep validatePurchase name but use new schema
export const validatePurchase = validateOperation;

