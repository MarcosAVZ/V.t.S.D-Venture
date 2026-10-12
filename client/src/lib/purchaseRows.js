// Pure helpers for the purchase review table (rows keep inputs as strings so typing is natural)

import { parseArNumber } from './arNumber'

const MAX_NAME = 200
const MAX_PACK_UNITS = 500
const TOLERANCE = 0.01
let seq = 0

export const normName = (name) => String(name ?? '').trim().toLowerCase()

export function makeRow(producto, origen = { pagina: producto.pagina }) {
  seq += 1
  return {
    id: `row-${seq}`,
    nombre: producto.nombre_sugerido ?? '',
    variante: producto.variante ?? '',
    titulo_corto: producto.titulo_corto ?? '',
    cantidad: String(producto.cantidad ?? ''),
    unidades_por_paquete: String(producto.unidades_por_paquete ?? 1),
    costo_paquete: String(producto.costo_paquete ?? ''),
    precio_lista_texto: producto.precio_lista_texto ?? '',
    precio_promo_texto: producto.precio_promo_texto ?? '',
    alerta_precio: Boolean(producto.alerta_precio),
    posible_duplicado: false,
    duplicado_motivo: '',
    origen,
    precio_venta: '',
  }
}

// Accepts "12", "12.5", "12,5". Returns NaN for anything else (negatives, Infinity, text, empty).
export function toNumber(value) {
  const s = String(value ?? '').trim()
  if (!/^\d+([.,]\d+)?$/.test(s)) return NaN
  return Number(s.replace(',', '.'))
}

// Money inputs (costs, prices) accept the Argentine format: "6.762" -> 6762, "2159,50" -> 2159.5
export const toMoney = parseArNumber

export function validateRow(row) {
  const errors = {}
  const nombre = row.nombre.trim()
  if (nombre === '' || nombre.length > MAX_NAME) errors.nombre = 'Obligatorio (máx. 200 caracteres)'

  const cantidad = toNumber(row.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 1) errors.cantidad = 'Entero mayor o igual a 1'

  const pack = toNumber(row.unidades_por_paquete)
  if (!Number.isInteger(pack) || pack < 1 || pack > MAX_PACK_UNITS) errors.unidades_por_paquete = `Entero entre 1 y ${MAX_PACK_UNITS}`

  if (Number.isNaN(toMoney(row.costo_paquete))) errors.costo_paquete = 'Número mayor o igual a 0'

  if (row.precio_venta.trim() !== '' && Number.isNaN(toMoney(row.precio_venta))) {
    errors.precio_venta = 'Número mayor o igual a 0'
  }
  return errors
}

export const isRowValid = (row) => Object.keys(validateRow(row)).length === 0

// What actually goes to the inventory: UNITS. A "10 pares" pack bought x1 = 10 units;
// the cost per unit is the pack price / units per pack (2 decimals). null when the row is invalid.
export function derivedUnits(row) {
  if (!isRowValid(row)) return null
  const cantidad = toNumber(row.cantidad)
  const pack = toNumber(row.unidades_por_paquete)
  return {
    unidades: cantidad * pack,
    costoUnitario: Math.round((toMoney(row.costo_paquete) / pack) * 100) / 100,
  }
}

// Sum of pack price x cantidad over the valid rows (same basis as the order total on the receipt)
export function computeTotal(rows) {
  return rows.reduce((acc, row) => {
    const qty = toNumber(row.cantidad)
    const cost = toMoney(row.costo_paquete)
    return Number.isFinite(qty) && Number.isFinite(cost) ? acc + qty * cost : acc
  }, 0)
}

// True when the computed total can't be reconciled with the PDF total (1% tolerance)
export function isTotalOff(computed, pdfTotal) {
  if (!(pdfTotal > 0)) return true
  return Math.abs(computed - pdfTotal) / pdfTotal > TOLERANCE
}

// es-AR style ("." thousands, "," decimals) without relying on ICU grouping rules for 4-digit numbers
export function formatMoney(n) {
  const [int, dec] = (Math.round(Number(n) * 100) / 100).toString().split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `$${grouped}${dec ? `,${dec}` : ''}`
}
