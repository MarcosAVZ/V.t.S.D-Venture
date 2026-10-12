// Parses a money amount typed or printed in Argentine format. Returns NaN when it is not a number.
// Mirrors server/src/schemas/purchaseSchemas.js parseArNumber (separate workspace, same rules).
//
// Ambiguity rule: "." is the THOUSANDS separator when it is followed by exactly 3 digits
// ("6.762" -> 6762, "159.500" -> 159500) and a DECIMAL point when followed by 1-2 digits
// ("2159.5" -> 2159.5, "12.50" -> 12.5). "," is always the decimal separator ("2159,50", "1.234,5").
export function parseArNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value !== 'string') return NaN
  const s = value.replace(/ars|\$|\s/gi, '')
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'))
  if (/^\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'))
  if (/^\d+\.\d{1,2}$/.test(s)) return Number(s)
  return NaN
}
