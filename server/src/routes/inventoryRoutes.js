import { Router } from 'express';
import { queryStock, getProducts } from '../services/sheetsService.js';

const router = Router();

// GET /api/inventory/stock?producto=X&color=Y&talle=Z
// Query stock for a product (supports partial composite key)
router.get('/stock', async (req, res) => {
  const { producto, color, talle } = req.query;

  if (!producto) {
    return res.status(422).json({
      error: 'Parámetro requerido: producto',
    });
  }

  try {
    const result = await queryStock(producto, color || null, talle || null);

    if (!result.success) {
      return res.status(404).json({
        error: result.error || `No encontré el producto '${producto}' en el inventario`,
      });
    }

    res.json(result);
  } catch (error) {
    console.error('[inventory] Stock query error:', error.message);
    res.status(500).json({
      error: 'Error al consultar stock',
      details: error.message,
    });
  }
});

// GET /api/inventory/products
// List all products with stock
router.get('/products', async (req, res) => {
  try {
    const result = await getProducts();

    if (!result.success) {
      return res.status(500).json({
        error: result.error || 'Error al obtener productos',
      });
    }

    res.json(result);
  } catch (error) {
    console.error('[inventory] Products list error:', error.message);
    res.status(500).json({
      error: 'Error al listar productos',
      details: error.message,
    });
  }
});

export default router;
