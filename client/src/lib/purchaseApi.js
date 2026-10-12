// Thin fetch wrappers for /api/purchase/*. Errors carry a user-facing Spanish message.

async function post(path, body, fallbackMessage, tooLargeMessage) {
  let response
  try {
    response = await fetch(`/api/purchase/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('No se pudo conectar al servidor.')
  }
  if (response.status === 413 && tooLargeMessage) throw new Error(tooLargeMessage)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const userFacing = (response.status === 422 || response.status === 429) && data.error
    throw new Error(userFacing ? data.error : fallbackMessage)
  }
  return response.json()
}

export const extractPurchase = (pages) =>
  post('extract', { pages }, 'No pude leer el comprobante. Probá de nuevo.',
    'Las imágenes son demasiado pesadas; elegí menos páginas o capturas más chicas.')

export const matchNames = (nombres) =>
  post('match', { nombres }, 'No se pudo verificar los productos.')

export const importPurchase = (payload) =>
  post('import', payload, 'No se pudo guardar la compra.')
