/**
 * Google Sheets service — communicates with Apps Script web app.
 * Handles mutations (executeOperation), queries (queryStock, getProducts).
 * 
 * Apps Script structure:
 * - Productos: id | código | nombre | precioCompra | precioVenta | stock
 * - Movimientos: id | fecha | productoId | tipo | cantidad | precio | observaciones
 * - Ventas: id | fecha | productoId | cantidad | precioVenta
 */

import { todayAR } from '../utils/dateAr.js';

const SHEETS_TIMEOUT = 30_000; // 30 seconds

/**
 * Validates an Apps Script HTTP response (status + content-type) and parses its JSON body.
 * @param {Response} response - fetch Response
 * @returns {Promise<Object>} Parsed JSON
 * @throws {Error} If status is not ok or the body is not JSON
 */
async function parseAppsScriptResponse(response) {
  if (!response.ok) {
    throw new Error(`Google Sheets error: status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google Sheets devolvió ${contentType.split(';')[0] || 'no-JSON'} en vez de JSON. ¿El Web App está deployado correctamente? ${text.substring(0, 120)}`);
  }

  return response.json();
}

/**
 * Sends a request to Apps Script with timeout and error handling.
 * @param {Object} payload - Request body (must include `action` field)
 * @returns {Promise<Object>} Apps Script response
 * @throws {Error} If URL missing, timeout, or HTTP error
 */
async function callAppsScript(payload) {
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL;
  if (!sheetsUrl) {
    throw new Error('Google Sheets no configurado');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEETS_TIMEOUT);

  try {
    const response = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });

    return await parseAppsScriptResponse(response);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Google Sheets timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends a GET request to Apps Script (for queries).
 * @param {string} action - Action name
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Apps Script response
 */
async function callAppsScriptGet(action, params = {}) {
  const sheetsUrl = process.env.GOOGLE_SHEETS_URL;
  if (!sheetsUrl) {
    throw new Error('Google Sheets no configurado');
  }

  const queryString = new URLSearchParams({ action, ...params }).toString();
  const url = `${sheetsUrl}?${queryString}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEETS_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    return await parseAppsScriptResponse(response);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Google Sheets timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the current stock of a product. Throws-free: returns { ok, stock }.
 * ok=false means the stock could not be verified (the caller MUST abort).
 */
async function getCurrentStock(productoId) {
  const stockResult = await callAppsScriptGet('queryStock', { productoId });
  const stock = Number(stockResult?.stock);
  if (!stockResult?.success || stockResult.stock === null || stockResult.stock === undefined || !Number.isFinite(stock)) {
    return { ok: false };
  }
  return { ok: true, stock };
}

const STOCK_UNVERIFIED = {
  success: false,
  error: 'No se pudo verificar el stock. Operación cancelada.',
};

/**
 * Finds a product by name (fuzzy match).
 * @param {string} nombre - Product name to search
 * @returns {Promise<Object>} { success, found, product? }
 */
export async function findProductByName(nombre) {
  return callAppsScriptGet('findProduct', { nombre });
}

/**
 * Executes an operation by dispatching to the correct Apps Script action.
 * Handles product lookup, stock validation, and multi-step operations.
 * @param {string} operation - Operation type (COMPRA, VENTA, etc.)
 * @param {Object} data - Operation data
 * @returns {Promise<Object>} { success, message, details? }
 */
export async function executeOperation(operation, data) {
  switch (operation) {
    case 'COMPRA':
      return executeCompra(data);
    case 'VENTA':
      return executeVenta(data);
    case 'NUEVO_PRODUCTO':
      return executeNuevoProducto(data);
    case 'AJUSTE':
      return executeAjuste(data);
    default:
      return { success: false, error: `Operación no soportada: ${operation}` };
  }
}

/**
 * COMPRA: For each product, look up by name, then add COMPRA movement.
 */
async function executeCompra(data) {
  const results = [];

  for (const producto of data.productos) {
    // Find product by name
    const lookupResult = await findProductByName(producto.nombre);

    if (!lookupResult.success || !lookupResult.found) {
      return {
        success: false,
        error: `Producto no encontrado: ${producto.nombre}. ¿Querés crearlo primero?`,
        suggestion: 'create_product',
      };
    }

    const productoId = lookupResult.product.id;

    // Create COMPRA movement
    const movementResult = await callAppsScript({
      action: 'addMovement',
      fecha: data.fecha,
      productoId: productoId,
      tipo: 'COMPRA',
      cantidad: producto.cantidad,
      precio: producto.precio_unitario || 0,
      observaciones: `Proveedor: ${data.proveedor || 'N/A'} | Pago: ${data.metodo_pago || 'N/A'}`,
    });

    if (!movementResult.success) {
      return { success: false, error: `Error al registrar movimiento para: ${producto.nombre}` };
    }

    results.push({
      producto: producto.nombre,
      productoId,
      movementId: movementResult.movementId,
    });
  }

  return {
    success: true,
    message: `Compra registrada: ${data.productos.length} producto(s)`,
    details: results,
  };
}

/**
 * VENTA: For each product, verify stock exists, then add VENTA movement.
 */
async function executeVenta(data) {
  const results = [];

  for (const producto of data.productos) {
    // Find product by name
    const lookupResult = await findProductByName(producto.nombre);

    if (!lookupResult.success || !lookupResult.found) {
      return {
        success: false,
        error: `Producto no encontrado: ${producto.nombre}`,
      };
    }

    const productoId = lookupResult.product.id;

    // Check available stock
    const current = await getCurrentStock(productoId);
    if (!current.ok) {
      return { ...STOCK_UNVERIFIED };
    }

    if (current.stock < producto.cantidad) {
      return {
        success: false,
        error: 'Stock insuficiente',
        currentStock: current.stock,
        requested: producto.cantidad,
      };
    }

    // Create VENTA via addSale (which also creates movement)
    const saleResult = await callAppsScript({
      action: 'addSale',
      fecha: data.fecha,
      productoId: productoId,
      cantidad: producto.cantidad,
      precioVenta: producto.precio_unitario || 0,
    });

    if (!saleResult.success) {
      return { success: false, error: `Error al registrar venta para: ${producto.nombre}` };
    }

    results.push({
      producto: producto.nombre,
      productoId,
      saleId: saleResult.saleId,
      stockRestante: saleResult.stockRestante,
    });
  }

  return {
    success: true,
    message: `Venta registrada: ${data.productos.length} producto(s)`,
    details: results,
  };
}

/**
 * NUEVO_PRODUCTO: Create product with initial stock, then add COMPRA movement if stock_inicial > 0.
 */
async function executeNuevoProducto(data) {
  // Create the product with stock
  const createResult = await callAppsScript({
    action: 'createProduct',
    nombre: data.producto,
    codigo: data.codigo || '',
    precioCompra: data.precio || 0,
    precioVenta: data.precio_venta || data.precio || 0,
    stock: data.stock_inicial || 0,
  });

  if (!createResult.success) {
    return { success: false, error: `Error al crear producto: ${data.producto}` };
  }

  const productoId = createResult.product.id;

  // If stock_inicial > 0, also register a COMPRA movement
  if (data.stock_inicial > 0) {
    const movementResult = await callAppsScript({
      action: 'addMovement',
      fecha: data.fecha || todayAR(),
      productoId: productoId,
      tipo: 'COMPRA',
      cantidad: data.stock_inicial,
      precio: data.precio || 0,
      observaciones: 'Stock inicial',
    });

    if (!movementResult.success) {
      return {
        success: false,
        error: `Producto creado pero error al registrar stock inicial: ${data.producto}`,
      };
    }

    return {
      success: true,
      message: `Producto "${data.producto}" creado con stock inicial: ${data.stock_inicial}`,
      details: { product: createResult.product, movement: movementResult },
    };
  }

  return {
    success: true,
    message: `Producto "${data.producto}" creado`,
    details: { product: createResult.product },
  };
}

/**
 * AJUSTE: Verify product exists, validate stock, then add AJUSTE movement.
 */
async function executeAjuste(data) {
  // Find product by name
  const lookupResult = await findProductByName(data.producto);

  if (!lookupResult.success || !lookupResult.found) {
    return {
      success: false,
      error: `Producto no encontrado: ${data.producto}`,
    };
  }

  const productoId = lookupResult.product.id;

  // Check available stock
  const current = await getCurrentStock(productoId);
  if (!current.ok) {
    return { ...STOCK_UNVERIFIED };
  }

  // cantidad > 0 raises stock, cantidad < 0 lowers it: the result must not go below 0
  if (current.stock + data.cantidad < 0) {
    return {
      success: false,
      error: 'Stock insuficiente para ajuste',
      currentStock: current.stock,
      requested: data.cantidad,
    };
  }

  // Create AJUSTE movement
  const movementResult = await callAppsScript({
    action: 'adjustStock',
    fecha: todayAR(),
    productoId: productoId,
    cantidad: data.cantidad, // Can be negative
    motivo: data.motivo || '',
  });

  if (!movementResult.success) {
    return { success: false, error: `Error al registrar ajuste para: ${data.producto}` };
  }

  return {
    success: true,
    message: `Ajuste registrado para "${data.producto}": ${data.cantidad} unidades`,
    details: movementResult,
  };
}

/**
 * Queries stock for a product from Google Sheets via Apps Script.
 * @param {string} producto - Product name (normalized)
 * @param {string|null} color - Not used in new structure (kept for compatibility)
 * @param {string|null} talle - Not used in new structure (kept for compatibility)
 * @returns {Promise<Object>} { product, stock, historial }
 */
export async function queryStock(producto, color = null, talle = null) {
  // Find product by name first
  const lookupResult = await findProductByName(producto);

  if (!lookupResult.success || !lookupResult.found) {
    return {
      success: false,
      error: `Producto no encontrado: ${producto}`,
    };
  }

  const productoId = lookupResult.product.id;

  // Query stock using product ID
  const result = await callAppsScriptGet('queryStock', { productoId });

  return result;
}

/**
 * Returns the full product list from Google Sheets via Apps Script.
 * @returns {Promise<Object>} { products: [...] }
 */
export async function getProducts() {
  return callAppsScriptGet('getProducts');
}
