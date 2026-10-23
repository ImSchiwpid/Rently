import crypto from 'node:crypto'

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.')
  return secret
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password, storedHash, salt) {
  try {
    const computed = crypto.scryptSync(password, salt, 64).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

export function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  let secret
  try { secret = jwtSecret() } catch { return null }
  const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null
  } catch {
    return null
  }
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!data.exp || data.exp < Date.now()) return null
    return data
  } catch {
    return null
  }
}

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// In-memory rate limiter per IP
const attempts = new Map()

export function checkRateLimit(ip, maxAttempts = 15, windowMs = 60000) {
  const now = Date.now()
  const record = attempts.get(ip)
  if (!record || now - record.start > windowMs) {
    attempts.set(ip, { count: 1, start: now })
    return true
  }
  record.count += 1
  return record.count <= maxAttempts
}
