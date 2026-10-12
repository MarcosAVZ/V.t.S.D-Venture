import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('vite.config.js', () => {
  it('vitest no falla cuando un commit de una serie no trae tests (passWithNoTests)', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf-8')
    expect(config).toMatch(/passWithNoTests:\s*true/)
  })
})
