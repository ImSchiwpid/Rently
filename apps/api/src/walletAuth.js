import crypto from 'node:crypto'
import { canonical, validAddress, walletSignatureMatches } from './validation.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export class WalletChallengeStore {
  #challenges = new Map()

  create(wallet, now = Date.now()) {
    const normalizedWallet = String(wallet || '').toLowerCase()
    if (!validAddress(normalizedWallet)) throw new Error('A valid wallet address is required.')

    for (const [address, pending] of this.#challenges) {
      if (pending.expiresAt < now) this.#challenges.delete(address)
    }

    const nonce = crypto.randomBytes(24).toString('hex')
    const expiresAt = now + CHALLENGE_TTL_MS
    this.#challenges.set(normalizedWallet, { nonce, expiresAt })
    return {
      nonce,
      message: `Rently marketplace wallet:authorize\n${canonical({ nonce })}`,
      expiresAt,
    }
  }

  verify(wallet, signature, now = Date.now()) {
    const normalizedWallet = String(wallet || '').toLowerCase()
    const challenge = this.#challenges.get(normalizedWallet)
    this.#challenges.delete(normalizedWallet)
    if (!validAddress(normalizedWallet) || !challenge || challenge.expiresAt < now) return false
    return walletSignatureMatches(normalizedWallet, signature, 'wallet:authorize', { nonce: challenge.nonce })
  }
}
