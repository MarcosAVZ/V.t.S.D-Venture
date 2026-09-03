import { z } from 'zod';

const productSchema = z.object({
  producto: z.string(),
  cantidad: z.number(),
  color: z.string().nullable(),
  talle: z.string().nullable(),
  precio_unitario: z.number(),
});

export const purchaseSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  proveedor: z.string().nullable(),
  productos: z.array(productSchema).min(1),
  metodo_pago: z.string().nullable(),
});

/**
 * Validates data against purchaseSchema.
 * Returns { success: true, data } or { success: false, errors }
 */
export function validatePurchase(data) {
  const result = purchaseSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, errors: result.error.format() };
  }
}
