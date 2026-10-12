import { describe, it, expect } from 'vitest'
import { flagDuplicates, nameKey } from './purchaseDuplicates'

const row = (over = {}) => ({
  id: over.id ?? 'r', nombre: 'Calcetines magnéticos de algodón', titulo_corto: '',
  precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595',
  origen: { pagina: 1, imagen: 1, parte: 1, partes: 4 }, posible_duplicado: false, ...over,
})
const at = (imagen, parte) => ({ pagina: 1, imagen, parte, partes: 4 })

describe('nameKey', () => {
  it('minusculas, sin acentos ni signos, primeras 4 palabras', () => {
    expect(nameKey('  Calcetines MAGNÉTICOS, de algodón unisex!')).toBe('calcetines magneticos de algodon')
  })
})

describe('flagDuplicates', () => {
  it('marca la fila de la parte siguiente cuando repite lista+promo y nombre similar (solape)', () => {
    const rows = [row({ id: 'a', origen: at(1, 1) }), row({ id: 'b', origen: at(1, 2), nombre: 'calcetines magneticos de algodon mujer' })]
    const out = flagDuplicates(rows)
    expect(out.map((r) => r.posible_duplicado)).toEqual([false, true])
  })

  it('NO marca el mismo producto en imagenes distintas', () => {
    const rows = [row({ id: 'a', origen: at(1, 1) }), row({ id: 'b', origen: at(2, 1) })]
    expect(flagDuplicates(rows).map((r) => r.posible_duplicado)).toEqual([false, false])
  })

  it('NO marca partes no adyacentes de la misma imagen', () => {
    const rows = [row({ id: 'a', origen: at(1, 1) }), row({ id: 'b', origen: at(1, 3) })]
    expect(flagDuplicates(rows).map((r) => r.posible_duplicado)).toEqual([false, false])
  })

  it('NO marca si cambia la promo o si cambia la lista (ambas presentes)', () => {
    const base = row({ id: 'a', origen: at(1, 1) })
    expect(flagDuplicates([base, row({ id: 'b', origen: at(1, 2), precio_promo_texto: 'ARS9.999' })])[1].posible_duplicado).toBe(false)
    expect(flagDuplicates([base, row({ id: 'c', origen: at(1, 2), precio_lista_texto: 'ARS1.000' })])[1].posible_duplicado).toBe(false)
  })

  it('motivo: nombre cuando coincide el nombre, precio cuando solo coinciden los precios', () => {
    const base = row({ id: 'a', origen: at(1, 1) })
    expect(flagDuplicates([base, row({ id: 'b', origen: at(1, 2) })])[1].duplicado_motivo).toBe('nombre')
    expect(flagDuplicates([base, row({ id: 'd', origen: at(1, 2), nombre: 'Gorra gato bordado' })])[1]).toMatchObject({ posible_duplicado: true, duplicado_motivo: 'precio' })
    expect(flagDuplicates([base, row({ id: 'e', origen: at(1, 2), precio_promo_texto: 'ARS9.999' })])[1].duplicado_motivo).toBe('')
  })

  it('caso real: articulo completo en la parte 3 y cortado en la parte 4 (otro nombre/titulo, mismos precios)', () => {
    const kawaii = row({
      id: 'k3', nombre: 'calcetines gato kawaii', titulo_corto: '5 pares de calcetines tipo tri',
      precio_lista_texto: 'ARS12.136', precio_promo_texto: 'ARS8.673', origen: at(1, 3),
    })
    const cortado = row({
      id: 'k4', nombre: 'calcetines gato corazones', titulo_corto: 'patita de gato y corazones',
      precio_lista_texto: 'ARS12.136', precio_promo_texto: 'ARS8.673', origen: at(1, 4),
    })
    const out = flagDuplicates([kawaii, cortado])
    expect(out.map((r) => r.posible_duplicado)).toEqual([false, true])
    expect(out[1].duplicado_motivo).toBe('precio')
  })

  it('lista ausente en alguno de los lados: alcanza con que coincida la promo', () => {
    const a = row({ id: 'a', nombre: 'uno', precio_lista_texto: 'ARS12.136', precio_promo_texto: 'ARS8.673', origen: at(1, 1) })
    const b = row({ id: 'b', nombre: 'otro distinto', precio_lista_texto: '', precio_promo_texto: 'ARS8.673', origen: at(1, 2) })
    expect(flagDuplicates([a, b])[1]).toMatchObject({ posible_duplicado: true, duplicado_motivo: 'precio' })
    expect(flagDuplicates([b, { ...a, origen: at(1, 3) }])[1].posible_duplicado).toBe(true)
    expect(flagDuplicates([b, { ...a, origen: at(1, 4) }])[1].posible_duplicado).toBe(false)
  })

  it('precio coincidente pero en imagenes distintas o partes no adyacentes: no marca', () => {
    const a = row({ id: 'a', nombre: 'uno', origen: at(1, 1) })
    expect(flagDuplicates([a, row({ id: 'b', nombre: 'otro', origen: at(2, 2) })])[1].posible_duplicado).toBe(false)
    expect(flagDuplicates([a, row({ id: 'c', nombre: 'otro', origen: at(1, 3) })])[1].posible_duplicado).toBe(false)
  })

  it('NO marca filas sin precios leidos ni de PDF (sin imagen)', () => {
    const sinPrecios = { precio_lista_texto: '', precio_promo_texto: '' }
    expect(flagDuplicates([row({ id: 'a', origen: at(1, 1), ...sinPrecios }), row({ id: 'b', origen: at(1, 2), ...sinPrecios })])[1].posible_duplicado).toBe(false)
    expect(flagDuplicates([row({ id: 'a', origen: { pagina: 1 } }), row({ id: 'b', origen: { pagina: 2 } })])[1].posible_duplicado).toBe(false)
  })

  it('no elimina filas y no muta la entrada', () => {
    const rows = [row({ id: 'a', origen: at(1, 1) }), row({ id: 'b', origen: at(1, 2) })]
    const out = flagDuplicates(rows)
    expect(out).toHaveLength(2)
    expect(rows[1].posible_duplicado).toBe(false)
  })

  it('tambien detecta la parte anterior si el orden esta invertido', () => {
    const rows = [row({ id: 'b', origen: at(1, 2) }), row({ id: 'a', origen: at(1, 1) })]
    expect(flagDuplicates(rows).filter((r) => r.posible_duplicado)).toHaveLength(1)
  })
})
