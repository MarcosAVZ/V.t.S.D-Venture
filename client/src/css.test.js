import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('App.css', () => {
  it('tiene llaves balanceadas (una } suelta rompe el build)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf-8')
    let depth = 0
    for (const ch of css) {
      if (ch === '{') depth += 1
      if (ch === '}') depth -= 1
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })
})
