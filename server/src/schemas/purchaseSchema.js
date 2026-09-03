import { z } from 'zod';

export const purchaseSchema = z.object({
  tipo: z.literal('compra'),
  proveedor: z.string().nullable(),
  producto: z.string().nullable(),
  cantidad: z.number().nullable(),
  precio_unitario: z.number().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
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