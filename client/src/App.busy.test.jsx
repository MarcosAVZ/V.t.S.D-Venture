import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./components/PurchaseImport', () => ({
  default: ({ onBusyChange }) => (
    <div>
      <button type="button" onClick={() => onBusyChange(true)}>simular importando</button>
      <button type="button" onClick={() => onBusyChange(false)}>simular fin</button>
    </div>
  ),
}))

import App from './App'

describe('pestañas mientras se importa', () => {
  beforeEach(() => { vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true } }) })
  afterEach(() => vi.unstubAllGlobals())

  it('deshabilita la pestaña Voz mientras PurchaseImport esta importando', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Importar compra (PDF)' }))
    expect(screen.getByRole('tab', { name: 'Voz' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'simular importando' }))
    expect(screen.getByRole('tab', { name: 'Voz' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'simular fin' }))
    expect(screen.getByRole('tab', { name: 'Voz' })).toBeEnabled()
  })
})
