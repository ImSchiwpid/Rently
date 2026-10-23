import assert from 'node:assert/strict'
import test from 'node:test'
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
const { hashPassword, verifyPassword, createToken, verifyToken, isValidEmail, checkRateLimit } = await import('../src/auth.js')

test('hashes and verifies password correctly', () => {
  const password = 'CorrectHorseBatteryStaple123!'
  const { hash, salt } = hashPassword(password)
  assert.ok(hash && hash.length === 128)
  assert.ok(salt && salt.length === 32)
  assert.equal(verifyPassword(password, hash, salt), true)
  assert.equal(verifyPassword('WrongPassword', hash, salt), false)
})

test('creates and verifies JWT tokens', () => {
  const payload = { userId: '12345', email: 'test@rently.local' }
  const token = createToken(payload)
  assert.ok(token && token.split('.').length === 3)
  
  const decoded = verifyToken(token)
  assert.ok(decoded)
  assert.equal(decoded.userId, payload.userId)
  assert.equal(decoded.email, payload.email)
  assert.ok(decoded.exp > Date.now())

  // Tampered token fails verification
  const tampered = token.slice(0, -4) + 'abcd'
  assert.equal(verifyToken(tampered), null)
  assert.equal(verifyToken('invalid.token'), null)
})

test('refuses to sign tokens when the application secret is missing', () => {
  const configuredSecret = process.env.JWT_SECRET
  delete process.env.JWT_SECRET
  assert.throws(() => createToken({ userId: '12345' }), /JWT_SECRET must be configured/)
  process.env.JWT_SECRET = configuredSecret
})

test('validates email addresses', () => {
  assert.equal(isValidEmail('alice@example.com'), true)
  assert.equal(isValidEmail('user.name+tag@sub.domain.co'), true)
  assert.equal(isValidEmail('invalid-email'), false)
  assert.equal(isValidEmail('@nodomain.com'), false)
  assert.equal(isValidEmail(''), false)
})

test('rate limits repeated attempts per IP', () => {
  const ip = '192.168.1.100'
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit(ip, 5), true)
  }
  assert.equal(checkRateLimit(ip, 5), false)
})
