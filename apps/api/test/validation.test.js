import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { canonical, validAddress, walletSignatureMatches } from '../src/validation.js'

test('canonicalizes objects independent of property order', () => {
  assert.equal(canonical({ z: 1, a: { y: true, x: 'item' } }), canonical({ a: { x: 'item', y: true }, z: 1 }))
})

test('validates wallet addresses', () => {
  assert.equal(validAddress('0x0000000000000000000000000000000000000001'), true)
  assert.equal(validAddress('0x1234'), false)
})

test('accepts a valid owner signature and rejects altered data or operation', async () => {
  const wallet = Wallet.createRandom()
  const payload = { owner: wallet.address, title: 'Camera', rent: '0.1' }
  const operation = 'listing:create'
  const signature = await wallet.signMessage(`Rently marketplace ${operation}\n${canonical(payload)}`)
  assert.equal(walletSignatureMatches(wallet.address, signature, operation, payload), true)
  assert.equal(walletSignatureMatches(wallet.address, signature, 'listing:update', payload), false)
  assert.equal(walletSignatureMatches(wallet.address, signature, operation, { ...payload, rent: '0.2' }), false)
  assert.equal(walletSignatureMatches(Wallet.createRandom().address, signature, operation, payload), false)
})
