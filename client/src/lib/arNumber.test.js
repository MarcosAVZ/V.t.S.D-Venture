import { describe, it, expect } from 'vitest'
import { parseArNumber } from './arNumber'

describe('parseArNumber (formato argentino)', () => {
  it.each([
    ['6.762', 6762],
    ['6762', 6762],
    ['1.234.567', 1234567],
    ['2159,50', 2159.5],
    ['2159,5', 2159.5],
    ['1.234,5', 1234.5],
    ['1.234,56', 1234.56],
    ['2159.5', 2159.5],
    ['2159.50', 2159.5],
    ['12.5', 12.5],
    ['0.5', 0.5],
    ['ARS6.762', 6762],
    ['$ 6.762', 6762],
    [' 100 ', 100],
    ['0', 0],
  ])('%s -> %s', (input, expected) => {
    expect(parseArNumber(input)).toBe(expected)
  })

  it('regla de ambiguedad: un punto + exactamente 3 digitos es separador de miles', () => {
    expect(parseArNumber('159.500')).toBe(159500)
    expect(parseArNumber('1.000')).toBe(1000)
  })

  it.each(['', '  ', 'abc', '-5', '1..2', '1,2,3', '1.2.3', 'Infinity', '12abc', '1.234,5,6'])('no parseable: %j -> NaN', (input) => {
    expect(parseArNumber(input)).toBeNaN()
  })

  it('acepta numeros y rechaza no finitos', () => {
    expect(parseArNumber(6762)).toBe(6762)
    expect(parseArNumber(Infinity)).toBeNaN()
    expect(parseArNumber(null)).toBeNaN()
    expect(parseArNumber(undefined)).toBeNaN()
  })
})
