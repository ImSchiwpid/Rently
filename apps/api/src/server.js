import cors from 'cors'
import dns from 'node:dns'
import { randomUUID } from 'node:crypto'
import express from 'express'
import fs from 'node:fs'
import mongoose from 'mongoose'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validAddress } from './validation.js'
import { WalletChallengeStore } from './walletAuth.js'

// Fix Windows Node DNS SRV lookup timeouts for MongoDB Atlas
dns.setServers(['8.8.8.8', '1.1.1.1'])

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env reliably
const envPath = path.resolve(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envPath) } catch { /* ignore */ }
  } else {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=')
          if (idx > 0) {
            const k = trimmed.slice(0, idx).trim()
            const v = trimmed.slice(idx + 1).trim()
            if (!process.env[k]) process.env[k] = v
          }
        }
      }
    } catch { /* ignore */ }
  }
}

// Import auth only after loading apps/api/.env so the configured JWT secret is used.
const { hashPassword, verifyPassword, createToken, verifyToken, isValidEmail, checkRateLimit } = await import('./auth.js')

const port = Number(process.env.API_PORT || 3001)
const mongoUrl = process.env.MONGODB_URI
const app = express()
const walletChallenges = new WalletChallengeStore()
const allowedOrigins = [...new Set([
  ...(process.env.WEB_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean),
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])]

app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '64kb' }))

// --- Schemas & Models ---

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true })

const listingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  category: {
    type: String,
    required: true,
    enum: ['Tools', 'Electronics', 'Home', 'Outdoors', 'Sports', 'Music', 'Events', 'Fashion', 'Other'],
  },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  rent: { type: String, required: true },
  deposit: { type: String, required: true },
  days: { type: Number, required: true, min: 1, max: 365 },
  owner: { type: String, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
  ownerEmail: { type: String, lowercase: true },
  pickupArea: { type: String, default: '' },
  meetingDetails: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true })
listingSchema.index({ category: 1, active: 1, createdAt: -1 })

const bookingRequestSchema = new mongoose.Schema({
  listingId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Listing' },
  listingTitle: { type: String, required: true },
  owner: { type: String, lowercase: true, default: '' },
  renter: { type: String, required: true, lowercase: true },
  ownerEmail: { type: String, lowercase: true },
  renterEmail: { type: String, lowercase: true },
  rent: { type: String, required: true },
  deposit: { type: String, required: true },
  days: { type: Number, required: true },
  message: { type: String, required: true, maxlength: 1000 },
  pickupArea: { type: String, default: '' },
  scheduledPickup: { type: String, default: '' },
  meetingDetails: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'booked'], default: 'pending' },
}, { timestamps: true })

const bookingSchema = new mongoose.Schema({
  listingId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Listing' },
  listingTitle: { type: String, default: '' },
  agreementId: { type: String, required: true, unique: true },
  owner: { type: String, required: true, lowercase: true },
  renter: { type: String, required: true, lowercase: true },
  ownerEmail: { type: String, lowercase: true },
  renterEmail: { type: String, lowercase: true },
  createTransaction: { type: String, required: true, match: /^0x[a-fA-F0-9]{64}$/ },
  pickupArea: { type: String, default: '' },
  meetingDetails: { type: String, default: '' },
  scheduledPickupTime: { type: String, default: '' },
  rentalDuration: { type: Number, default: 0 },
  handoverTimestamp: { type: Number, default: 0 },
  returnDeadline: { type: Number, default: 0 },
  status: { type: String, default: 'created' },
}, { timestamps: true })

const User = mongoose.model('User', userSchema)
const Listing = mongoose.model('Listing', listingSchema)
const BookingRequest = mongoose.model('BookingRequest', bookingRequestSchema)
const Booking = mongoose.model('Booking', bookingSchema)

const AUTH_COOKIE = 'rently_session'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60
// A browser refresh keeps the account session, while restarting the API starts a fresh login session.
const serverInstanceId = randomUUID()
function cookieValue(req, name) {
  const entry = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : ''
}
function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${SESSION_MAX_AGE}${secure}`)
}
function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0`)
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ''
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const userToken = cookieValue(req, AUTH_COOKIE) || String(req.headers['x-rently-user-token'] || '').trim()
    || (bearerToken && !validAddressToken(bearerToken) ? bearerToken : '')
  const walletToken = bearerToken
  const decodedUser = verifyToken(userToken)
  const decodedWallet = verifyToken(walletToken)

  Promise.resolve().then(async () => {
    if (decodedUser?.userId && decodedUser.serverInstanceId === serverInstanceId && mongoose.isValidObjectId(decodedUser.userId)) {
      const user = await User.findById(decodedUser.userId).select('tokenVersion').lean()
      if (user && Number(decodedUser.tokenVersion || 0) === Number(user.tokenVersion || 0)) req.user = decodedUser
    }
    if (decodedWallet?.wallet && validAddress(decodedWallet.wallet)) req.wallet = decodedWallet.wallet.toLowerCase()
    next()
  }).catch(next)
}
function validAddressToken(token) {
  const decoded = verifyToken(token)
  return Boolean(decoded?.wallet)
}
app.use(authMiddleware)

function isPositiveEthAmount(value) {
  const normalized = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,18})?$/.test(normalized)) return false
  const integerUnits = normalized.replace('.', '').replace(/^0+(?=\d)/, '')
  return BigInt(integerUnits || '0') > 0n
}

// --- Routes ---

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' })
})

// Wallet authorization is separate from email login. Tokens are issued only after
// the wallet signs a short-lived, one-time challenge.
app.post('/api/wallet/challenge', (req, res) => {
  const wallet = String(req.body?.wallet || '').toLowerCase()
  if (!validAddress(wallet)) return res.status(400).json({ error: 'A valid wallet address is required.' })
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  if (!checkRateLimit(`wallet:${ip}`)) return res.status(429).json({ error: 'Too many wallet authorization attempts. Please wait a moment.' })

  try {
    res.json(walletChallenges.create(wallet))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/wallet/verify', (req, res) => {
  const wallet = String(req.body?.wallet || '').toLowerCase()
  const signature = String(req.body?.signature || '')
  if (!validAddress(wallet)) {
    return res.status(401).json({ error: 'Wallet authorization expired. Request a new challenge.' })
  }
  if (!walletChallenges.verify(wallet, signature)) {
    return res.status(401).json({ error: 'MetaMask signature did not authorize this wallet.' })
  }
  res.json({ token: createToken({ wallet }) })
})

// Authentication
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' })

    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = req.body?.password
    const name = req.body?.name
    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required.' })
    if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
      return res.status(400).json({ error: 'Password must be between 8 and 256 characters long.' })
    }
    const cleanName = String(name || email.split('@')[0]).trim().slice(0, 80)
    if (!cleanName) return res.status(400).json({ error: 'A name is required.' })
    const existing = await User.findOne({ email })
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' })

    const { hash, salt } = hashPassword(password)
    const user = await User.create({
      email,
      name: cleanName,
      passwordHash: hash,
      salt,
    })

    const token = createToken({ userId: user._id.toString(), email: user.email, name: user.name, tokenVersion: user.tokenVersion, serverInstanceId })
    setAuthCookie(res, token)
    res.status(201).json({
      user: { id: user._id.toString(), email: user.email, name: user.name },
    })
  } catch (error) { next(error) }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' })

    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = req.body?.password
    if (!isValidEmail(email) || typeof password !== 'string' || !password || password.length > 256) {
      return res.status(400).json({ error: 'A valid email address and password are required.' })
    }

    const user = await User.findOne({ email })
    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const token = createToken({ userId: user._id.toString(), email: user.email, name: user.name, tokenVersion: user.tokenVersion || 0, serverInstanceId })
    setAuthCookie(res, token)
    res.json({
      user: { id: user._id.toString(), email: user.email, name: user.name },
    })
  } catch (error) { next(error) }
})

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    if (req.user?.userId) await User.updateOne({ _id: req.user.userId }, { $inc: { tokenVersion: 1 } })
    clearAuthCookie(res)
    res.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/auth/me', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Not authenticated.' })
    const user = await User.findById(req.user.userId).lean()
    if (!user) return res.status(404).json({ error: 'User not found.' })
    res.json({ user: { id: user._id.toString(), email: user.email, name: user.name } })
  } catch (error) { next(error) }
})

// Listings
app.get('/api/listings', async (req, res, next) => {
  try {
    const items = await Listing.find({ active: true }, { meetingDetails: 0 }).sort({ createdAt: -1 }).lean()
    res.json({ listings: items.map(({ ownerEmail, ...item }) => ({
      ...item,
      isOwner: Boolean(req.user?.email && ownerEmail === req.user.email),
    })) })
  } catch (error) { next(error) }
})

app.get('/api/listings/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID.' })
    const item = await Listing.findById(req.params.id, { meetingDetails: 0 }).lean()
    if (!item) return res.status(404).json({ error: 'Listing not found.' })
    const { ownerEmail, ...publicItem } = item
    res.json({ listing: { ...publicItem, isOwner: Boolean(req.user?.email && ownerEmail === req.user.email) } })
  } catch (error) { next(error) }
})

app.post('/api/listings', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before publishing a listing.' })
    const { signature, ...body } = req.body || {}
    const signedPayload = {
      title: String(body.title || '').trim(),
      category: String(body.category || '').trim(),
      description: String(body.description || '').trim(),
      rent: String(body.rent || '').trim(),
      deposit: String(body.deposit || '').trim(),
      days: Number(body.days),
      owner: String(body.owner || '').trim().toLowerCase(),
    }
    const extraFields = {
      pickupArea: String(body.pickupArea || '').trim(),
      meetingDetails: String(body.meetingDetails || '').trim(),
      imageUrl: String(body.imageUrl || '').trim(),
      ownerEmail: req.user.email,
    }

    if (signedPayload.owner && !validAddress(signedPayload.owner)) return res.status(400).json({ error: 'A valid Ethereum owner address is required when one is provided.' })
    if (signedPayload.owner && req.wallet !== signedPayload.owner) return res.status(403).json({ error: 'Sign in and authorize the listing owner wallet before binding it.' })
    if (!isPositiveEthAmount(signedPayload.rent) || !isPositiveEthAmount(signedPayload.deposit)) {
      return res.status(400).json({ error: 'Rent and deposit must be positive ETH amounts with no more than 18 decimal places.' })
    }
    if (!Number.isInteger(signedPayload.days) || signedPayload.days < 1 || signedPayload.days > 365) {
      return res.status(400).json({ error: 'Rental duration must be a whole number of days from 1 to 365.' })
    }

    const item = await Listing.create({ ...signedPayload, ...extraFields })
    const { ownerEmail: _ownerEmail, meetingDetails: _meetingDetails, ...publicItem } = item.toObject()
    res.status(201).json({ listing: { ...publicItem, isOwner: true } })
  } catch (error) { next(error) }
})

app.patch('/api/listings/:id/wallet', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before connecting a wallet to a listing.' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID.' })
    const owner = String(req.body?.owner || '').toLowerCase()
    if (!validAddress(owner) || req.wallet !== owner) return res.status(403).json({ error: 'Authorize the wallet before connecting it to this listing.' })
    const item = await Listing.findOne({ _id: req.params.id, active: true })
    if (!item) return res.status(404).json({ error: 'Active listing not found.' })
    if (item.ownerEmail?.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'Only the Rently account that published this listing can connect its wallet.' })
    }
    if (item.owner && item.owner.toLowerCase() !== owner) {
      return res.status(409).json({ error: 'This listing is already connected to a different wallet.' })
    }
    item.owner = owner
    await item.save()
    const { ownerEmail: _ownerEmail, meetingDetails: _meetingDetails, ...publicItem } = item.toObject()
    res.json({ listing: { ...publicItem, isOwner: true } })
  } catch (error) { next(error) }
})

app.delete('/api/listings/:id', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before managing a listing.' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID.' })
    const item = await Listing.findById(req.params.id)
    if (!item) return res.status(404).json({ error: 'Listing not found.' })
    if (!item.ownerEmail || item.ownerEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'Only the Rently account that published this listing can deactivate it.' })
    }

    item.active = false
    await item.save()
    res.json({ ok: true, message: 'Listing deactivated.' })
  } catch (error) { next(error) }
})

// Booking Requests
app.get('/api/booking-requests', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before viewing booking requests.' })
    const records = await BookingRequest.find({
      $or: [
        { renterEmail: req.user.email },
        { ownerEmail: req.user.email },
      ],
    }).sort({ createdAt: -1 }).lean()
    const requests = records.map(({ ownerEmail, renterEmail, meetingDetails, ...request }) => ({
      ...request,
      isOwner: ownerEmail === req.user.email,
      isRenter: renterEmail === req.user.email,
      ...(request.status === 'booked' && meetingDetails ? { meetingDetails } : {}),
    }))
    res.json({ requests })
  } catch (error) { next(error) }
})

app.post('/api/booking-requests', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before requesting a booking.' })
    const { signature, ...body } = req.body || {}
    const message = String(body.message || '').trim()
    const renter = String(body.renter || '').toLowerCase()
    const listingId = String(body.listingId || '')

    if (!mongoose.isValidObjectId(listingId) || !validAddress(renter) || message.length < 5) {
      return res.status(400).json({ error: 'A valid listing, renter wallet, and message are required.' })
    }
    if (req.wallet !== renter) return res.status(403).json({ error: 'Connect and authorize the renter wallet before requesting this item.' })

    const listing = await Listing.findOne({ _id: listingId, active: true }).lean()
    if (!listing) return res.status(404).json({ error: 'This listing is no longer available.' })
    if (listing.ownerEmail?.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot request your own listing.' })
    }
    if (listing.owner && listing.owner.toLowerCase() === renter) return res.status(400).json({ error: 'You cannot request your own listing.' })

    const priorRequest = await BookingRequest.findOne({ listingId: listing._id, renter, status: 'pending' })
    if (priorRequest) return res.status(409).json({ error: 'You already have a pending request for this listing.' })

    const request = await BookingRequest.create({
      listingId: listing._id,
      listingTitle: listing.title,
      owner: listing.owner || '',
      renter,
      ownerEmail: listing.ownerEmail,
      renterEmail: req.user.email,
      rent: listing.rent,
      deposit: listing.deposit,
      days: listing.days,
      message,
      pickupArea: String(body.pickupArea || listing.pickupArea || ''),
      scheduledPickup: String(body.scheduledPickup || ''),
      meetingDetails: String(body.meetingDetails || listing.meetingDetails || ''),
    })
    const { ownerEmail: _ownerEmail, renterEmail: _renterEmail, meetingDetails: _meetingDetails, ...publicRequest } = request.toObject()
    res.status(201).json({ request: { ...publicRequest, isOwner: false, isRenter: true } })
  } catch (error) { next(error) }
})

app.patch('/api/booking-requests/:id', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before managing booking requests.' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid request ID.' })
    const { status } = req.body || {}
    if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be accepted or rejected.' })

    const request = await BookingRequest.findById(req.params.id)
    if (!request) return res.status(404).json({ error: 'Request not found.' })
    if (!request.ownerEmail || request.ownerEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'Sign in with the account that published this listing.' })
    }
    if (status === 'accepted') {
      const listing = request.owner
        ? null
        : await Listing.findById(request.listingId).select('owner ownerEmail').lean()
      const expectedOwner = request.owner?.toLowerCase() || listing?.owner?.toLowerCase()
      if (!expectedOwner || req.wallet !== expectedOwner) {
        return res.status(403).json({ error: 'Connect the listing owner wallet before accepting the request.' })
      }
      if (!request.owner) request.owner = expectedOwner
    }

    request.status = status
    await request.save()
    const { ownerEmail: _ownerEmail, renterEmail: _renterEmail, ...publicRequest } = request.toObject()
    res.json({ request: {
      ...publicRequest,
      isOwner: request.ownerEmail?.toLowerCase() === req.user.email.toLowerCase(),
      isRenter: request.renterEmail?.toLowerCase() === req.user.email.toLowerCase(),
    } })
  } catch (error) { next(error) }
})

// Bookings
app.get('/api/bookings', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before viewing bookings.' })
    const ownedListings = await Listing.find({ ownerEmail: req.user.email }, { _id: 1 }).lean()
    const relatedRequests = await BookingRequest.find({
      $or: [{ renterEmail: req.user.email }, { ownerEmail: req.user.email }],
    }, { listingId: 1, renter: 1, owner: 1 }).lean()
    const query = {
      $or: [
        { ownerEmail: req.user.email },
        { renterEmail: req.user.email },
        { listingId: { $in: ownedListings.map(item => item._id) } },
        ...relatedRequests.map(request => ({
          listingId: request.listingId,
          renter: request.renter,
          ...(request.owner ? { owner: request.owner } : {}),
        })),
      ],
    }
    const items = await Booking.find(query).sort({ createdAt: -1 }).populate('listingId').lean()
    res.json({ bookings: items })
  } catch (error) { next(error) }
})

app.get('/api/bookings/:id', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before viewing booking details.' })
    let booking = null
    if (mongoose.isValidObjectId(req.params.id)) {
      booking = await Booking.findById(req.params.id).populate('listingId').lean()
    }
    if (!booking) {
      booking = await Booking.findOne({ agreementId: req.params.id }).populate('listingId').lean()
    }
    if (!booking) return res.status(404).json({ error: 'Booking not found.' })
    const listing = booking.listingId && typeof booking.listingId === 'object'
      ? booking.listingId
      : await Listing.findById(booking.listingId).lean()
    const request = await BookingRequest.findOne({
      listingId: booking.listingId?._id || booking.listingId,
      $or: [
        { renterEmail: req.user.email, renter: booking.renter },
        { ownerEmail: req.user.email, owner: booking.owner },
      ],
    }).lean()
    const belongsToUser = booking.ownerEmail === req.user.email
      || booking.renterEmail === req.user.email
      || listing?.ownerEmail === req.user.email && listing.owner && booking.owner.toLowerCase() === listing.owner.toLowerCase()
      || Boolean(request)
    if (!belongsToUser) {
      return res.status(403).json({ error: 'This booking does not belong to the signed-in Rently account.' })
    }
    res.json({ booking })
  } catch (error) { next(error) }
})

app.post('/api/bookings', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before saving booking details.' })
    const body = req.body || {}
    if (!validAddress(body.owner) || !validAddress(body.renter) || !/^0x[a-fA-F0-9]{64}$/.test(body.createTransaction || '') || !/^\d+$/.test(String(body.agreementId))) {
      return res.status(400).json({ error: 'Owner, renter, agreement ID, and mined transaction hash are required.' })
    }
    if (req.wallet !== body.owner.toLowerCase()) return res.status(403).json({ error: 'Authorize the owner wallet before saving booking metadata.' })
    const listing = await Listing.findOne({ _id: body.listingId, active: true })
    if (!listing) return res.status(404).json({ error: 'Active listing not found.' })
    if (!listing.owner || listing.owner.toLowerCase() !== body.owner.toLowerCase()) {
      return res.status(403).json({ error: 'The agreement owner must match the listing owner.' })
    }
    if (!listing.ownerEmail || listing.ownerEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: 'Sign in with the account that published this listing.' })
    }
    if (body.owner.toLowerCase() === body.renter.toLowerCase()) {
      return res.status(400).json({ error: 'The owner and renter must be different wallets.' })
    }

    const requestQuery = {
      listingId: listing._id,
      renter: body.renter.toLowerCase(),
      status: { $in: ['pending', 'accepted'] },
      renterEmail: { $exists: true, $ne: '' },
    }
    if (body.bookingRequestId) {
      if (!mongoose.isValidObjectId(body.bookingRequestId)) return res.status(400).json({ error: 'Invalid booking request ID.' })
      requestQuery._id = body.bookingRequestId
    }
    const linkedRequest = await BookingRequest.findOne(requestQuery).sort({ createdAt: -1 })
    if (body.bookingRequestId && !linkedRequest) {
      return res.status(409).json({ error: 'This booking request is no longer pending for this listing and renter.' })
    }
    const booking = await Booking.create({
      ...body,
      listingTitle: listing.title,
      owner: body.owner.toLowerCase(),
      renter: body.renter.toLowerCase(),
      ownerEmail: req.user.email,
      renterEmail: linkedRequest?.renterEmail,
      pickupArea: body.pickupArea || listing.pickupArea,
      meetingDetails: body.meetingDetails || listing.meetingDetails,
      rentalDuration: Number(body.rentalDuration || listing.days * 86400),
    })

    if (linkedRequest) {
      linkedRequest.status = 'booked'
      linkedRequest.owner = body.owner.toLowerCase()
      await linkedRequest.save()
    }
    res.status(201).json({ booking })
  } catch (error) { next(error) }
})

app.patch('/api/bookings/:id/handover', async (req, res, next) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Sign in before viewing or updating booking metadata.' })
    const { handoverTimestamp, returnDeadline } = req.body || {}
    let booking = null
    if (mongoose.isValidObjectId(req.params.id)) {
      booking = await Booking.findById(req.params.id)
    }
    if (!booking) {
      booking = await Booking.findOne({ agreementId: req.params.id })
    }
    if (!booking) return res.status(404).json({ error: 'Booking not found.' })

    const listing = await Listing.findById(booking.listingId).lean()
    const request = await BookingRequest.findOne({
      listingId: booking.listingId,
      $or: [
        { renterEmail: req.user.email, renter: booking.renter },
        { ownerEmail: req.user.email, owner: booking.owner },
      ],
    }).lean()
    const belongsToUser = booking.ownerEmail === req.user.email
      || booking.renterEmail === req.user.email
      || listing?.ownerEmail === req.user.email && listing.owner && booking.owner.toLowerCase() === listing.owner.toLowerCase()
      || Boolean(request)
    if (!belongsToUser) {
      return res.status(403).json({ error: 'This booking does not belong to the signed-in Rently account.' })
    }
    if (handoverTimestamp || returnDeadline) {
      return res.status(409).json({ error: 'Handover and return times are authoritative on RentalVault and cannot be set through the API.' })
    }
    res.json({ booking })
  } catch (error) { next(error) }
})

// Error Handler
app.use((error, _req, res, _next) => {
  const status = error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500
  res.status(status).json({ error: status === 400 ? error.message : 'API request failed.' })
})

// Start Server
if (!mongoUrl) {
  console.error('MONGODB_URI is required. Configure MONGODB_URI in apps/api/.env.')
  process.exit(1)
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to at least 32 characters in apps/api/.env.')
  process.exit(1)
}

try {
  await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 15000 })
  app.listen(port, '127.0.0.1', () => console.log(`Rental API listening at http://127.0.0.1:${port} (MongoDB connected)`))
} catch (error) {
  const safeMessage = String(error.message || 'Unknown connection error').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[MongoDB URI redacted]')
  console.error(`Could not connect to MongoDB: ${safeMessage}`)
  process.exit(1)
}
