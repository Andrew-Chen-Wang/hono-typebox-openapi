export function isValidPositiveInteger(str: string | number | null | undefined, allowZero = false) {
  if (str === null || str === undefined) return false

  const num = Number(typeof str === "string" ? str.trim() : str.toString()) // may return NaN
  if (!Number.isInteger(num)) return false // handles NaN
  return allowZero ? num >= 0 : num > 0
}
