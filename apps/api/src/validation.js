import { verifyMessage } from 'ethers'

export function validAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''))
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function walletSignatureMatches(owner, signature, operation, payload) {
  if (!validAddress(owner) || !/^0x[a-fA-F0-9]{130}$/.test(String(signature || ''))) return false
  try { return verifyMessage(`Rently marketplace ${operation}\n${canonical(payload)}`, signature).toLowerCase() === owner.toLowerCase() } catch { return false }
}
