import { z } from 'zod';

// Helper: coerce string numbers to actual numbers (AI sometimes returns "10" instead of 10)
const num = z.preprocess(
  (val) => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') {
      const parsed = Number(val);
      return isNaN(parsed) ? val : parsed;
    }
    return val;
  },
  z.number().optional()
).default(0);

const numRequired = z.preprocess(
  (val) => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') {
      const parsed = Number(val);
      return isNaN(parsed) ? val : parsed;
    }
    return val;
  },
  z.number().positive()
);

// Base product schema used in COMPRA and VENTA
const productoItemSchema = z.object({
  nombre: z.string(),
  color: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  talle: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  cantidad: numRequired,
  precio_unitario: num,
});

// Individual operation schemas
export const compraSchema = z.object({
  operation: z.literal('COMPRA'),
  fecha: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(new Date().toISOString().split('T')[0]),
  proveedor: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  productos: z.array(productoItemSchema).min(1),
  metodo_pago: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
});

export const ventaSchema = z.object({
  operation: z.literal('VENTA'),
  fecha: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(new Date().toISOString().split('T')[0]),
  cliente: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  productos: z.array(productoItemSchema).min(1),
  metodo_pago: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
});

export const nuevoProductoSchema = z.object({
  operation: z.literal('NUEVO_PRODUCTO'),
  producto: z.string(),
  precio: num,
  precio_venta: num,
  stock_inicial: num,
});

export const ajusteSchema = z.object({
  operation: z.literal('AJUSTE'),
  producto: z.string(),
  color: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  talle: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  cantidad: numRequired,
  motivo: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
});

export const consultaSchema = z.object({
  operation: z.literal('CONSULTA'),
  producto: z.string(),
  color: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
  talle: z.preprocess((val) => (val === null ? undefined : val), z.string().optional()).default(''),
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

