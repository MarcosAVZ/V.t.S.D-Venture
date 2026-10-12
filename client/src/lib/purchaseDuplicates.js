// Flags (never removes) rows that probably come from the overlap between adjacent parts of a sliced screenshot.

// Lowercase, no accents or punctuation, first 4 words
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ')
}

const sameProduct = (a, b) => {
  const nameA = nameKey(a.nombre)
  const nameB = nameKey(b.nombre)
  if (nameA && nameA === nameB) return true
  const titleA = nameKey(a.titulo_corto)
  return Boolean(titleA) && titleA === nameKey(b.titulo_corto)
}

const adjacentParts = (a, b) =>
  a.origen?.imagen !== undefined
  && a.origen.imagen === b.origen?.imagen
  && Math.abs((a.origen.parte ?? 0) - (b.origen?.parte ?? 0)) === 1

// Same list+promo text; a missing list on either side is fine as long as the promo matches
const samePrices = (a, b) => {
  if (a.precio_promo_texto !== b.precio_promo_texto) return false
  const listA = a.precio_lista_texto
  const listB = b.precio_lista_texto
  if (listA && listB && listA !== listB) return false
  return Boolean(a.precio_promo_texto) || (Boolean(listA) && listA === listB)
}

/**
 * Same image, adjacent parts. The later part's row is flagged when its prices match an earlier part's row
 * (an item cut by the slice can be read with a different name/title, so names may differ):
 * duplicado_motivo = 'nombre' (prices AND name/title match) or 'precio' (only the prices match).
 */
export function flagDuplicates(rows) {
  return rows.map((row, i) => {
    const earlier = rows.filter((other, j) => (
      j !== i && adjacentParts(other, row) && other.origen.parte < row.origen.parte && samePrices(other, row)
    ))
    if (earlier.length === 0) return { ...row, posible_duplicado: row.posible_duplicado || false, duplicado_motivo: row.duplicado_motivo ?? '' }
    const byName = Boolean(row.precio_lista_texto) && earlier.some((other) => other.precio_lista_texto === row.precio_lista_texto && sameProduct(other, row))
    return { ...row, posible_duplicado: true, duplicado_motivo: byName ? 'nombre' : 'precio' }
  })
}
