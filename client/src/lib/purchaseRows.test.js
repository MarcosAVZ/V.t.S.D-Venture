import { describe, it, expect } from 'vitest'
import { makeRow, validateRow, computeTotal, isTotalOff, normName, derivedUnits } from './purchaseRows'

const base = (over = {}) => ({ id: 'r1', nombre: 'Gorra', variante: '', cantidad: '1', unidades_por_paquete: '1', costo_paquete: '100', precio_venta: '', ...over })

describe('makeRow', () => {
  it('convierte el producto extraido a una fila editable con strings', () => {
    const row = makeRow({ nombre_sugerido: 'Gorra', titulo_corto: 'Gorra larga', variante: 'rosa', cantidad: 2, unidades_por_paquete: 10, costo_paquete: 6762 }, 0)
    expect(row).toMatchObject({ nombre: 'Gorra', titulo_corto: 'Gorra larga', variante: 'rosa', cantidad: '2', unidades_por_paquete: '10', costo_paquete: '6762', precio_venta: '' })
    expect(row.id).toBeTruthy()
  })
})

describe('validateRow', () => {
  it('fila valida => sin errores', () => {
    expect(validateRow(base())).toEqual({})
  })
  it('nombre vacio o demasiado largo', () => {
    expect(validateRow(base({ nombre: '  ' })).nombre).toBeTruthy()
    expect(validateRow(base({ nombre: 'a'.repeat(201) })).nombre).toBeTruthy()
  })
  it.each(['0', '', '1.5', '-2', 'abc'])('cantidad invalida: %s', (v) => {
    expect(validateRow(base({ cantidad: v })).cantidad).toBeTruthy()
  })
  it.each(['', '-1', 'abc', 'Infinity'])('costo invalido: %s', (v) => {
    expect(validateRow(base({ costo_paquete: v })).costo_paquete).toBeTruthy()
  })
  it('costo 0 y decimales son validos', () => {
    expect(validateRow(base({ costo_paquete: '0' }))).toEqual({})
    expect(validateRow(base({ costo_paquete: '12.5' }))).toEqual({})
  })
  it('precio_venta es opcional pero no negativo', () => {
    expect(validateRow(base({ precio_venta: '' }))).toEqual({})
    expect(validateRow(base({ precio_venta: '-3' })).precio_venta).toBeTruthy()
  })
})

describe('makeRow: precios leidos', () => {
  it('conserva textos y alerta', () => {
    const row = makeRow({ nombre_sugerido: 'A', cantidad: 1, costo_paquete: 21595, precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595', alerta_precio: true })
    expect(row).toMatchObject({ precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595', alerta_precio: true })
  })
  it('defaults vacios', () => {
    expect(makeRow({ nombre_sugerido: 'A', cantidad: 1, costo_paquete: 5 })).toMatchObject({ precio_lista_texto: '', precio_promo_texto: '', alerta_precio: false })
  })
})

describe('makeRow: unidades_por_paquete', () => {
  it('default 1 si falta', () => {
    expect(makeRow({ nombre_sugerido: 'A', cantidad: 1, costo_paquete: 5 }).unidades_por_paquete).toBe('1')
  })
})

describe('validateRow: unidades por paquete', () => {
  it.each(['0', '', '1.5', '-2', 'abc', '501'])('invalido: %s', (v) => {
    expect(validateRow(base({ unidades_por_paquete: v })).unidades_por_paquete).toBeTruthy()
  })
  it.each(['1', '10', '500'])('valido: %s', (v) => {
    expect(validateRow(base({ unidades_por_paquete: v }))).toEqual({})
  })
})

describe('derivedUnits (lo que se importa son UNIDADES)', () => {
  it.each([
    ['10 pares, 21595 x1 (variante)', { cantidad: '1', unidades_por_paquete: '10', costo_paquete: '21595' }, 10, 2159.5],
    ['4 pares, 4944', { cantidad: '1', unidades_por_paquete: '4', costo_paquete: '4944' }, 4, 1236],
    ['5 pares solo en titulo, 8673', { cantidad: '1', unidades_por_paquete: '5', costo_paquete: '8673' }, 5, 1734.6],
    ['neceser 1 PC, 2676 x2', { cantidad: '2', unidades_por_paquete: '1', costo_paquete: '2676' }, 2, 2676],
  ])('%s', (_n, over, unidades, costoUnitario) => {
    expect(derivedUnits(base(over))).toEqual({ unidades, costoUnitario })
  })
  it('cantidad x paquete: 3 paquetes de 10 = 30 unidades', () => {
    expect(derivedUnits(base({ cantidad: '3', unidades_por_paquete: '10', costo_paquete: '1000' }))).toEqual({ unidades: 30, costoUnitario: 100 })
  })
  it('redondea a 2 decimales', () => {
    expect(derivedUnits(base({ unidades_por_paquete: '3', costo_paquete: '100' })).costoUnitario).toBe(33.33)
  })
  it('null si la fila es invalida', () => {
    expect(derivedUnits(base({ cantidad: 'x' }))).toBeNull()
    expect(derivedUnits(base({ unidades_por_paquete: '0' }))).toBeNull()
  })
})

describe('totales', () => {
  it('computeTotal usa precio de paquete x cantidad (no unidades)', () => {
    expect(computeTotal([base({ cantidad: '1', unidades_por_paquete: '10', costo_paquete: '21595' })])).toBe(21595)
  })

  it('computeTotal suma costo x cantidad ignorando filas invalidas', () => {
    const rows = [base({ cantidad: '2', costo_paquete: '2676' }), base({ id: 'r2', cantidad: '1', costo_paquete: '6762' }), base({ id: 'r3', cantidad: 'x' })]
    expect(computeTotal(rows)).toBe(12114)
  })
  it('isTotalOff usa tolerancia de 1%', () => {
    expect(isTotalOff(57140, 57139)).toBe(false)
    expect(isTotalOff(60000, 57139)).toBe(true)
    expect(isTotalOff(100, 0)).toBe(true)
  })
})

describe('normName', () => {
  it('trim + minusculas', () => {
    expect(normName('  GoRRa ')).toBe('gorra')
  })
})

describe('costos en formato argentino', () => {
  it.each([
    ['6.762', 6762],
    ['2159,50', 2159.5],
    ['1.234,5', 1234.5],
    ['2159.5', 2159.5],
  ])('costo "%s" se interpreta como %s', (texto, esperado) => {
    const row = base({ cantidad: '1', unidades_por_paquete: '1', costo_paquete: texto })
    expect(validateRow(row)).toEqual({})
    expect(derivedUnits(row).costoUnitario).toBe(esperado)
    expect(computeTotal([row])).toBe(esperado)
  })
  it('precio_venta tambien: "6.762" => 6762 valido', () => {
    expect(validateRow(base({ precio_venta: '6.762' }))).toEqual({})
    expect(validateRow(base({ precio_venta: '1.2.3' })).precio_venta).toBeTruthy()
  })
  it('costo no parseable sigue siendo invalido', () => {
    expect(validateRow(base({ costo_paquete: '1..2' })).costo_paquete).toBeTruthy()
  })
})
