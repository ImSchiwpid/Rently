import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { WalletChallengeStore } from '../src/walletAuth.js'

test('wallet challenge verifies one signature once and only for its wallet', async () => {
  const wallet = Wallet.createRandom()
  const store = new WalletChallengeStore()
  const challenge = store.create(wallet.address, 1000)
  const signature = await wallet.signMessage(challenge.message)

  assert.equal(store.verify(wallet.address, signature, 1001), true)
  assert.equal(store.verify(wallet.address, signature, 1002), false)

  const otherChallenge = store.create(wallet.address, 2000)
  const otherSignature = await wallet.signMessage(otherChallenge.message)
  assert.equal(store.verify(Wallet.createRandom().address, otherSignature, 2001), false)
  assert.equal(store.verify(wallet.address, otherSignature, 2001), true)
  assert.equal(store.verify(wallet.address, otherSignature, 2002), false)
})

test('wallet challenge rejects expired and malformed challenges', async () => {
  const wallet = Wallet.createRandom()
  const store = new WalletChallengeStore()
  const challenge = store.create(wallet.address, 1000)
  const signature = await wallet.signMessage(challenge.message)

  assert.equal(store.verify(wallet.address, signature, challenge.expiresAt + 1), false)
  assert.throws(() => store.create('not a wallet'), /valid wallet address/)
})
