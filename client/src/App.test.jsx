import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./lib/pdfPages', () => ({ pdfToPages: vi.fn() }))

import App from './App'

describe('App entry points', () => {
  beforeEach(() => { vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true } }) })
  afterEach(() => vi.unstubAllGlobals())

  it('por defecto muestra el flujo de voz y la pestaña de importar', () => {
    render(<App />)
    expect(screen.getByRole('tab', { name: 'Voz', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Importar compra (PDF)' })).toBeInTheDocument()
    expect(screen.getByText('Listo para grabar')).toBeInTheDocument()
  })

  it('la pestaña de importar muestra el selector de PDF y se puede volver a voz', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Importar compra (PDF)' }))
    expect(screen.getByLabelText(/PDF del comprobante/i)).toBeInTheDocument()
    expect(screen.queryByText('Listo para grabar')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Voz' }))
    expect(screen.getByText('Listo para grabar')).toBeInTheDocument()
  })
})
