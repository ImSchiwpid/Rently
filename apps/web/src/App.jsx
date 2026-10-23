import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserProvider, Contract, JsonRpcProvider, formatEther, isAddress, parseEther } from 'ethers'
import { vaultAbi } from './vaultAbi.js'
import { SiteFooter, SiteHeader } from './components/SiteChrome.jsx'
import './App.css'
import './Marketplace.css'
import './DesignSystem.css'
import './Readability.css'

const categories = ['All items', 'Tools', 'Electronics', 'Home', 'Outdoors', 'Sports', 'Music', 'Events', 'Fashion', 'Other']
const stateNames = ['Created', 'Funded', 'Handover pending', 'Active rental', 'Return pending', 'Disputed', 'Completed', 'Cancelled', 'Expired', 'Resolved']
const address = import.meta.env.VITE_RENTAL_VAULT_ADDRESS
const chainId = Number(import.meta.env.VITE_CHAIN_ID || 31337)
const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'
const rpc = new JsonRpcProvider('http://127.0.0.1:8545')
const walletDisconnectedKey = 'rently_wallet_disconnected'
const agreementFields = [
  'owner', 'renter', 'rent', 'deposit', 'escrowRemaining', 'fundingDeadline',
  'handoverNotBefore', 'handoverDeadline', 'rentalDuration', 'returnGracePeriod',
  'handoverAt', 'rentalEnd', 'returnDeadline', 'disputeOpenedAt',
  'proposedDeduction', 'disputeEvidenceHash', 'state', 'ownerHandoverConfirmed',
  'renterHandoverConfirmed', 'ownerReturnConfirmed', 'renterReturnConfirmed',
  'renterAcceptedDeduction', 'ownerCancelConsent', 'renterCancelConsent',
]

function shortAddress(value = '') {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—'
}

function dateLabel(seconds) {
  return seconds && Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toLocaleString() : 'Not set'
}

function localDateLabel(value) {
  if (!value) return 'Not scheduled'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString()
}

function messageFor(error) {
  return error?.shortMessage || error?.reason || error?.message?.split('\n')[0] || 'The transaction could not be completed.'
}

function emailUserAuthHeaders() {
  const token = localStorage.getItem('rently_auth_token')
  return token ? { 'X-Rently-User-Token': token } : {}
}

function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'include', ...options })
}

function _canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

const emptyListing = {
  title: '', category: 'Tools', description: '', imageUrl: '',
  pickupArea: '', contact: '', rent: '', deposit: '', days: '3',
}

function App() {
  const [path, setPath] = useState(window.location.pathname)
  const navigate = useCallback((nextPath) => {
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  useEffect(() => {
    const syncPath = () => setPath(window.location.pathname)
    window.addEventListener('popstate', syncPath)
    return () => window.removeEventListener('popstate', syncPath)
  }, [])

  const page = path === '/marketplace' ? 'marketplace' :
    path === '/listings/new' || path.startsWith('/listings/') ? 'listing' :
    path === '/bookings' ? 'bookings' :
    path === '/privacy' ? 'privacy' :
    path === '/login' ? 'login' : 'home'

  // User Authentication State
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authModalOpen, setAuthModalOpen] = useState(window.location.pathname === '/login')
  const [authModalMode, setAuthModalMode] = useState('login')
  const [pendingAction, setPendingAction] = useState(null)

  // MetaMask Wallet State
  const [account, setAccount] = useState('')
  const [walletConfirmed, setWalletConfirmed] = useState(false)
  const [walletConnecting, setWalletConnecting] = useState(false)
  const [walletAuthToken, setWalletAuthToken] = useState('')
  const [walletAuthorizing, setWalletAuthorizing] = useState(false)
  const [wrongNetwork, setWrongNetwork] = useState(false)

  // Marketplace & Contract Data State
  const [listings, setListings] = useState([])
  const [listingLoading, setListingLoading] = useState(true)
  const [selectedListing, setSelectedListing] = useState(null)
  const [selectedBookingDetails, setSelectedBookingDetails] = useState(null)
    const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All items')
      const [credit, setCredit] = useState(0n)
  const [agreements, setAgreements] = useState([])
  const [arbitrators, setArbitrators] = useState([])
  const [bookings, setBookings] = useState([])
  const [bookingRequests, setBookingRequests] = useState([])
  const [dashboardRole, setDashboardRole] = useState('all')
  const [listingForm, setListingForm] = useState(emptyListing)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [clock, setClock] = useState(0)

  const readVault = useMemo(() => address ? new Contract(address, vaultAbi, rpc) : null, [])

  // Clock updates every second for live countdown
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Restore the Rently session independently from MetaMask.
  useEffect(() => {
    apiFetch(`${apiBase}/auth/me`, { headers: emailUserAuthHeaders() })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.user) {
          setAuthUser(data.user)
          localStorage.removeItem('rently_auth_token')
        } else if (data?.error) {
          localStorage.removeItem('rently_auth_token')
        }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false))
  }, [])

  function askForLogin(action = null) {
    if (action) {
      setPendingAction(action)
      if (['requestBooking', 'createBooking', 'transaction'].includes(action.type)) setWalletConfirmed(false)
    }
    setAuthModalMode('login')
    setAuthModalOpen(true)
  }

  function handleNavigate(nextPath) {
    const protectedPath = nextPath === '/listings/new' || nextPath === '/bookings'
    if (protectedPath && authLoading) {
      setNotice('Checking your Rently session…')
      return
    }
    if (protectedPath && !authUser) {
      setPendingAction({ type: 'navigate', path: nextPath })
      navigate('/login')
      setAuthModalMode('login')
      setAuthModalOpen(true)
      return
    }
    navigate(nextPath)
  }

  const refresh = useCallback(async (wallet = account) => {
    if (!address || !readVault) {
      setNotice('RentalVault address is not configured. Build the contracts, start Hardhat Local, deploy the contract, then restart Vite.')
      return
    }
    try {
      const bytecode = await rpc.getCode(address)
      if (bytecode === '0x') {
        setAgreements([])
        setArbitrators([])
        setCredit(0n)
        setNotice(`RentalVault is not deployed at ${address} on Hardhat Local. Start the chain and run npm run deploy:local, then refresh.`)
        return
      }
      const next = Number(await readVault.nextAgreementId())
      const records = []
      for (let idValue = 1; idValue < next; idValue += 1) {
        try {
          const data = await readVault.getAgreement(idValue)
          records.push({
            id: idValue,
            ...Object.fromEntries(agreementFields.map(field => [field, data[field]])),
          })
        } catch { /* Sequential IDs; skip any empty record. */ }
      }
      setAgreements(records.reverse())
      setArbitrators([await readVault.primaryArbitrator(), await readVault.backupArbitrator()])
      if (wallet) setCredit(await readVault.credits(wallet))
    } catch (error) {
      const message = messageFor(error)
      setNotice(message.toLowerCase().includes('could not detect network') || message.toLowerCase().includes('failed to detect')
        ? 'Hardhat Local is not responding at http://127.0.0.1:8545. Start the local chain, deploy RentalVault, then refresh.'
        : `Could not read the local contract: ${message}`)
    }
  }, [account, readVault])
  // Detect previously approved accounts without opening a MetaMask permission prompt.
  useEffect(() => {
    if (!window.ethereum) return
    window.ethereum.request({ method: 'eth_accounts' })
      .then(accounts => {
        if (accounts?.[0] && localStorage.getItem(walletDisconnectedKey) !== 'true') {
          setAccount(accounts[0])
          setWalletConfirmed(true)
        }
      })
      .catch(() => {})
    window.ethereum.request({ method: 'eth_chainId' })
      .then(chain => setWrongNetwork(Number(chain) !== chainId))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (account) void refresh(account)
  }, [account, refresh])

  // Listen for account and network changes
  useEffect(() => {
    if (!window.ethereum) return undefined
    const handleAccountsChanged = (accounts) => {
      if (accounts?.[0]) {
        // Ignore provider account events until the user explicitly connects in this app.
        if (!account) return
        if (account.toLowerCase() !== accounts[0].toLowerCase()) {
          setCredit(0n)
          setAgreements([])
          setArbitrators([])
        }
        setWalletAuthToken('')
        setAccount(accounts[0])
        setWalletConfirmed(true)
        localStorage.removeItem(walletDisconnectedKey)
      } else {
        setAccount('')
        setWalletConfirmed(false)
        setWalletAuthToken('')
        setCredit(0n)
        setAgreements([])
        setArbitrators([])
        setNotice('Wallet disconnected.')
      }
    }
    const handleChainChanged = (chain) => {
      const nextChainId = Number(chain)
      setWrongNetwork(nextChainId !== chainId)
      if (nextChainId === chainId) {
        refresh(account)
      } else {
        setCredit(0n)
        setAgreements([])
        setArbitrators([])
      }
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [account, refresh])

  const pendingActionHandlersRef = useRef({})
  useEffect(() => {
    pendingActionHandlersRef.current = { handleRequestBooking, createBooking, handleSaveListing, handleRejectRequest, transact }
  })

  // Resume a protected action only after Rently authentication and, when needed,
  // an explicit wallet connection have both completed.
  useEffect(() => {
    if (authLoading || !authUser || !pendingAction) return
    if (pendingAction.type === 'navigate') {
      setPendingAction(null)
      navigate(pendingAction.path)
      return
    }
    const requiresWallet = ['requestBooking', 'createBooking', 'transaction'].includes(pendingAction.type)
    if (requiresWallet && (!account || !walletConfirmed)) {
      setNotice('You are signed in. Click Connect wallet to continue this action.')
      return
    }
    setPendingAction(null)
    const handlers = pendingActionHandlersRef.current
    if (pendingAction.type === 'requestBooking') {
      void handlers.handleRequestBooking(...pendingAction.args).then(ok => {
        if (ok && selectedListing?._id === pendingAction.args[0]._id) setSelectedListing(null)
      })
    } else if (pendingAction.type === 'createBooking') {
      void handlers.createBooking(...pendingAction.args).then(ok => {
        if (ok && selectedListing?._id === pendingAction.args[0]._id) setSelectedListing(null)
      })
    } else if (pendingAction.type === 'saveListing') {
      void handlers.handleSaveListing()
    } else if (pendingAction.type === 'rejectRequest') {
      void handlers.handleRejectRequest(pendingAction.request)
    } else if (pendingAction.type === 'transaction') {
      void handlers.transact(pendingAction.action, pendingAction.successMessage, pendingAction.expectedSender)
    }
  }, [authLoading, authUser, account, walletConfirmed, pendingAction, navigate, selectedListing])

  // Protect direct URL entry as well as navigation links.
  useEffect(() => {
    if (authLoading || authUser || !['/listings/new', '/bookings'].includes(path)) return
    setPendingAction({ type: 'navigate', path })
    navigate('/login')
    setAuthModalMode('login')
    setAuthModalOpen(true)
  }, [authLoading, authUser, path, navigate])

  useEffect(() => {
    if (!authLoading && authUser && path === '/login' && !pendingAction) navigate('/')
  }, [authLoading, authUser, path, pendingAction, navigate])

  const loadListings = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setListingLoading(true)
      const response = await apiFetch(`${apiBase}/listings`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load listings.')
      setListings(result.listings || [])
      setNotice(current => current.startsWith('Marketplace API unavailable:') ? '' : current)
    } catch (error) {
      if (!quiet) setNotice(`Marketplace API unavailable: ${messageFor(error)}. Verify API is running.`)
    } finally {
      if (!quiet) setListingLoading(false)
    }
  }, [])

  const loadBookings = useCallback(async () => {
    if (!authUser) { setBookings([]); return }
    try {
      const response = await apiFetch(`${apiBase}/bookings`, {
        headers: emailUserAuthHeaders(),
      })
      const result = await response.json()
      if (response.ok) setBookings(result.bookings || [])
      else if (response.status === 401) {
        setAuthUser(null)
        setNotice('Your Rently session expired. Log in again to view bookings.')
      }
    } catch { /* Silent */ }
  }, [authUser])

  const loadBookingRequests = useCallback(async () => {
    if (!authUser) { setBookingRequests([]); return }
    try {
      const response = await apiFetch(`${apiBase}/booking-requests`, {
        headers: emailUserAuthHeaders(),
      })
      const result = await response.json()
      if (response.ok) setBookingRequests(result.requests || [])
      else if (response.status === 401) {
        setAuthUser(null)
        setNotice('Your Rently session expired. Log in again to view booking requests.')
      }
    } catch { /* Silent */ }
  }, [authUser])

  useEffect(() => { const t = setTimeout(loadListings, 0); return () => clearTimeout(t) }, [loadListings, authUser])
  useEffect(() => { const t = setTimeout(loadBookings, 0); return () => clearTimeout(t) }, [loadBookings])
  useEffect(() => { const t = setTimeout(loadBookingRequests, 0); return () => clearTimeout(t) }, [loadBookingRequests])

  // Keep public listings current for buyers in another already-open browser.
  useEffect(() => {
    if (!['home', 'marketplace'].includes(page)) return undefined
    const refreshVisibleListings = () => {
      if (document.visibilityState === 'visible') void loadListings({ quiet: true })
    }
    const interval = window.setInterval(refreshVisibleListings, 6000)
    window.addEventListener('focus', refreshVisibleListings)
    document.addEventListener('visibilitychange', refreshVisibleListings)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisibleListings)
      document.removeEventListener('visibilitychange', refreshVisibleListings)
    }
  }, [page, loadListings])

  async function refreshDashboard() {
    setRefreshing(true)
    try {
      await Promise.all([
        refresh(),
        loadListings({ quiet: true }),
        loadBookings(),
        loadBookingRequests(),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  async function authorizeWallet(wallet = account) {
    if (walletAuthorizing) return null
    if (!authUser) {
      askForLogin()
      setNotice('Log in to Rently before authorizing a wallet for protected marketplace actions.')
      return null
    }
    if (!wallet || !window.ethereum) {
      setNotice('Connect MetaMask before authorizing private booking data.')
      return null
    }
    setWalletAuthorizing(true)
    try {
      const challengeResponse = await apiFetch(`${apiBase}/wallet/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      })
      const challenge = await challengeResponse.json()
      if (!challengeResponse.ok) throw new Error(challenge.error || 'Could not start wallet authorization.')

      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()
      if (signerAddress.toLowerCase() !== wallet.toLowerCase()) throw new Error('The active MetaMask account changed. Retry authorization.')
      const signature = await signer.signMessage(challenge.message)
      const verifyResponse = await apiFetch(`${apiBase}/wallet/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, signature }),
      })
      const verified = await verifyResponse.json()
      if (!verifyResponse.ok) throw new Error(verified.error || 'Wallet authorization failed.')
      setWalletAuthToken(verified.token)
      return verified.token
    } catch (error) {
      setNotice(`Wallet connected, but private marketplace access was not authorized: ${messageFor(error)}`)
      return null
    } finally {
      setWalletAuthorizing(false)
    }
  }

  // Wallet Connection: NEVER navigates away!
  async function connectWallet() {
    if (!window.ethereum) {
      setNotice('MetaMask was not found. Please install the MetaMask extension to interact with smart contracts.')
      return false
    }
    setWalletConnecting(true)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts?.[0]) return false
      const activeChain = Number(await window.ethereum.request({ method: 'eth_chainId' }))
      setWalletAuthToken('')
      setAccount(accounts[0])
      setWalletConfirmed(true)
      localStorage.removeItem(walletDisconnectedKey)
      setWrongNetwork(activeChain !== chainId)
      setNotice('Wallet connected. Rently login is separate; contract transactions require confirmation in MetaMask.')
      return true
    } catch (error) {
      setNotice(messageFor(error))
      return false
    } finally {
      setWalletConnecting(false)
    }
  }

  function disconnectWallet() {
    localStorage.setItem(walletDisconnectedKey, 'true')
    setAccount('')
    setWalletConfirmed(false)
    setWalletAuthToken('')
    setCredit(0n)
    setAgreements([])
    setNotice('Wallet disconnected.')
  }

  async function switchNetwork() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      })
    } catch (error) {
      if (error.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${chainId.toString(16)}`,
              chainName: 'Hardhat Local',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['http://127.0.0.1:8545'],
            }],
          })
        } catch (addError) {
          setNotice(messageFor(addError))
          return
        }
      } else {
        setNotice(messageFor(error))
        return
      }
    }
    const activeChain = Number(await window.ethereum.request({ method: 'eth_chainId' }))
    setWrongNetwork(activeChain !== chainId)
  }

  async function transact(action, successMessage, expectedSender = account) {
    if (!authUser) {
      askForLogin({ type: 'transaction', action, successMessage, expectedSender })
      return null
    }
    if (!account || !walletConfirmed || !window.ethereum) {
      setPendingAction({ type: 'transaction', action, successMessage, expectedSender })
      setNotice('You are signed in. Click Connect wallet before approving this transaction.')
      return null
    }
    if (!address) {
      setNotice('RentalVault is not deployed. Please start the node and deploy the contract.')
      return null
    }
    setBusy(true)
    let submittedTx = null
    try {
      const provider = new BrowserProvider(window.ethereum)
      const activeNetwork = await provider.getNetwork()
      if (activeNetwork.chainId !== BigInt(chainId)) {
        setWrongNetwork(true)
        throw new Error(`Switch MetaMask to Hardhat Local (chain ID ${chainId}) before submitting this transaction.`)
      }
      setWrongNetwork(false)
      const contractCode = await provider.getCode(address)
      if (contractCode === '0x') {
        throw new Error(`RentalVault has no bytecode at ${address} on this chain. Start the local chain, deploy the contract, then restart Vite.`)
      }
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()
      if (signerAddress.toLowerCase() !== account.toLowerCase()) {
        setAccount(signerAddress)
        throw new Error('MetaMask account changed. Please retry with the active account.')
      }
      if (expectedSender && signerAddress.toLowerCase() !== expectedSender.toLowerCase()) {
        throw new Error(`Switch MetaMask to ${shortAddress(expectedSender)} to authorize this action.`)
      }
      const contract = new Contract(address, vaultAbi, signer)
      setNotice('Awaiting your confirmation in MetaMask…')
      const tx = await action(contract)
      submittedTx = tx
      setNotice('Transaction pending on Hardhat Local while the receipt is confirmed.')
      setNotice('Transaction submitted to Hardhat local chain. Waiting for receipt…')
      const receipt = await tx.wait()
      if (!receipt || receipt.status !== 1) throw new Error('The transaction was mined without a successful receipt.')
      const confirmedMessage = `${successMessage || 'Transaction confirmed on Hardhat Local.'} Tx: ${receipt.hash} · RentalVault: ${address}`
      try {
        await refresh(signerAddress)
        setNotice(confirmedMessage)
      } catch (refreshError) {
        setNotice(`${confirmedMessage} The chain confirmed it, but the dashboard refresh failed: ${messageFor(refreshError)}`)
      }
      return receipt
    } catch (error) {
      setNotice(submittedTx?.hash
        ? `Transaction ${submittedTx.hash} did not confirm successfully: ${messageFor(error)}`
        : error?.code === 4001 || error?.code === 'ACTION_REJECTED'
        ? 'Transaction rejected in MetaMask. Your form and page are unchanged.'
        : messageFor(error))
      return null
    } finally {
      setBusy(false)
    }
  }

  // Create the agreement on-chain, verify its event and stored terms, then save its display metadata.
  async function createBooking(item, renterAddress, scheduledPickupTime = '', bookingRequestId = '') {
    if (!authUser) {
      askForLogin({ type: 'createBooking', args: [item, renterAddress, scheduledPickupTime, bookingRequestId] })
      return false
    }
    if (!window.ethereum || !account || !walletConfirmed) {
      setPendingAction({ type: 'createBooking', args: [item, renterAddress, scheduledPickupTime, bookingRequestId] })
      setNotice('You are signed in. Click Connect wallet to create this agreement.')
      return false
    }
    if (!item.isOwner) {
      setNotice('Sign in with the Rently account that published this listing before creating its agreement.')
      return false
    }
    if (item.owner && item.owner.toLowerCase() !== account.toLowerCase()) {
      setNotice('Switch to the listing owner wallet before creating this agreement.')
      return false
    }
    if (!isAddress(renterAddress) || renterAddress.toLowerCase() === account.toLowerCase()) {
      setNotice('Enter a valid renter wallet address that is different from the owner.')
      return false
    }

    let rentAmount
    let depositAmount
    try {
      rentAmount = parseEther(String(item.rent))
      depositAmount = parseEther(String(item.deposit))
    } catch {
      setNotice('Rent and deposit must be valid ETH amounts with no more than 18 decimal places.')
      return false
    }
    if (rentAmount <= 0n || depositAmount <= 0n) {
      setNotice('Rent and security deposit must both be greater than zero.')
      return false
    }

    if (!address || !readVault) {
      setNotice('RentalVault is not configured. Start Hardhat Local, deploy the contract, then restart Vite.')
      return false
    }
    try {
      const provider = new BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()
      if (network.chainId !== BigInt(chainId)) {
        setWrongNetwork(true)
        setNotice(`Switch MetaMask to Hardhat Local (chain ID ${chainId}) before creating this agreement.`)
        return false
      }
      if (await provider.getCode(address) === '0x') {
        setNotice(`RentalVault is not deployed at ${address} on this network. Deploy it before creating an agreement.`)
        return false
      }
    } catch (error) {
      setNotice(messageFor(error))
      return false
    }

    const latestBlock = await rpc.getBlock('latest').catch(() => null)
    if (!latestBlock) {
      setNotice('Hardhat Local is not responding at http://127.0.0.1:8545. Start the local chain before creating an agreement.')
      return false
    }
    const now = latestBlock.timestamp
    const fundingDeadline = now + 24 * 3600
    // Handover window: can start immediately or from now
    const handoverNotBefore = now
    const handoverDeadline = now + 48 * 3600
    const rentalDuration = Number(item.days || 3) * 86400
    const returnGracePeriod = 86400
    const accessToken = walletAuthToken || await authorizeWallet(account)
    if (!accessToken) return false

    if (bookingRequestId) {
      try {
        const acceptedResponse = await apiFetch(`${apiBase}/booking-requests/${bookingRequestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...emailUserAuthHeaders() },
          body: JSON.stringify({ status: 'accepted' }),
        })
        const acceptedResult = await acceptedResponse.json()
        if (!acceptedResponse.ok) throw new Error(acceptedResult.error || 'Could not accept this booking request.')
        setBookingRequests(current => current.map(request => request._id === bookingRequestId ? acceptedResult.request : request))
      } catch (error) {
        setNotice(messageFor(error))
        return false
      }
    }

    const receipt = await transact(vault => vault.createAgreement(
      renterAddress,
      rentAmount,
      depositAmount,
      fundingDeadline,
      handoverNotBefore,
      handoverDeadline,
      rentalDuration,
      returnGracePeriod,
    ), null)

    if (!receipt) return false

    let agreementId = ''
    for (const log of receipt.logs) {
      try {
        const parsed = readVault.interface.parseLog(log)
        if (parsed?.name === 'AgreementCreated') agreementId = parsed.args.agreementId.toString()
      } catch { /* Ignore logs emitted by other contracts. */ }
    }

    if (!agreementId) {
      setNotice(`Transaction ${receipt.hash} succeeded, but its RentalVault agreement event could not be verified. Check My bookings before retrying.`)
      return false
    }

    try {
      const created = await readVault.getAgreement(agreementId)
      const termsMatch = created.owner.toLowerCase() === account.toLowerCase()
        && created.renter.toLowerCase() === renterAddress.toLowerCase()
        && created.rent === rentAmount
        && created.deposit === depositAmount
      if (!termsMatch) {
        setNotice(`Agreement ${agreementId} was mined, but its saved terms did not match the form. Do not retry; inspect the on-chain agreement.`)
        return false
      }
    } catch (error) {
      setNotice(`Agreement ${agreementId} was mined, but the local chain could not verify its stored terms: ${messageFor(error)}. Check My bookings before retrying.`)
      return false
    }

    try {
      if (!item.owner) {
        const walletResponse = await apiFetch(`${apiBase}/listings/${item._id}/wallet`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...emailUserAuthHeaders() },
          body: JSON.stringify({ owner: account }),
        })
        const walletResult = await walletResponse.json()
        if (!walletResponse.ok) throw new Error(walletResult.error || 'Could not connect the listing to this wallet.')
        item = walletResult.listing
        setListings(current => current.map(listing => listing._id === item._id ? item : listing))
      }
      const response = await apiFetch(`${apiBase}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...emailUserAuthHeaders() },
        body: JSON.stringify({
          listingId: item._id,
          listingTitle: item.title,
          bookingRequestId,
          agreementId,
          owner: account,
          renter: renterAddress,
          createTransaction: receipt.hash,
          rentalDuration,
          pickupArea: item.pickupArea,
          meetingDetails: item.meetingDetails,
          scheduledPickupTime,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save booking details.')
      setBookings(current => [result.booking, ...current])
      if (bookingRequestId) {
        setBookingRequests(current => current.map(request => request._id === bookingRequestId
          ? { ...request, status: 'booked' }
          : request))
      }
      await loadBookingRequests(account)
      await loadListings()
      setNotice(`Rental agreement ${agreementId} for “${item.title}” is confirmed on-chain and its booking details were saved.`)
      return true
    } catch (error) {
      setNotice(`Rental agreement ${agreementId} is confirmed on-chain, but its booking details could not be saved: ${messageFor(error)}. Check My bookings before retrying.`)
      return false
    }
  }

  // Request Booking from Owner
  async function handleRequestBooking(item, message, scheduledPickup = '') {
    if (!authUser) {
      askForLogin({ type: 'requestBooking', args: [item, message, scheduledPickup] })
      return false
    }
    if (!account || !walletConfirmed) {
      setPendingAction({ type: 'requestBooking', args: [item, message, scheduledPickup] })
      setNotice('You are signed in. Click Connect wallet to send this booking request.')
      return false
    }
    let scheduledPickupUtc = ''
    if (scheduledPickup) {
      const scheduledDate = new Date(scheduledPickup)
      if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= clock * 1000) {
        setNotice('Choose a valid pickup date and time in the future.')
        return false
      }
      scheduledPickupUtc = scheduledDate.toISOString()
    }
    const accessToken = walletAuthToken || await authorizeWallet(account)
    if (!accessToken) return false
    setBusy(true)
    try {
      const response = await apiFetch(`${apiBase}/booking-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...emailUserAuthHeaders() },
        body: JSON.stringify({
          listingId: item._id,
          renter: account,
          renterEmail: authUser?.email,
          message,
          scheduledPickup: scheduledPickupUtc,
          pickupArea: item.pickupArea,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not send booking request.')
      setBookingRequests(current => [result.request, ...current])
      setNotice('Booking request sent to the listing owner. Track it in My bookings.')
      return true
    } catch (error) {
      setNotice(messageFor(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleRejectRequest(request) {
    if (!authUser) {
      askForLogin({ type: 'rejectRequest', request })
      return
    }
    setBusy(true)
    try {
      const response = await apiFetch(`${apiBase}/booking-requests/${request._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...emailUserAuthHeaders() },
        body: JSON.stringify({ status: 'rejected' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not update request.')
      setBookingRequests(current => current.map(r => r._id === request._id ? result.request : r))
      setNotice('Booking request declined.')
    } catch (error) {
      setNotice(messageFor(error))
    } finally {
      setBusy(false)
    }
  }

  // Publish / Edit Listing
  async function handleSaveListing(event) {
    event?.preventDefault?.()
    if (!authUser) {
      askForLogin({ type: 'saveListing' })
      return
    }
    setBusy(true)
    try {
      const payload = {
        title: listingForm.title,
        category: listingForm.category,
        description: listingForm.description,
        imageUrl: listingForm.imageUrl,
        pickupArea: listingForm.pickupArea,
        meetingDetails: listingForm.contact,
        rent: listingForm.rent,
        deposit: listingForm.deposit,
        days: Number(listingForm.days),
      }
      const response = await apiFetch(`${apiBase}/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...emailUserAuthHeaders() },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not publish listing.')
      setListings(current => [result.listing, ...current])
      setListingForm(emptyListing)
      setNotice('Listing published to the marketplace.')
      navigate('/marketplace')
    } catch (error) {
      setNotice(messageFor(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleWithdrawCredit() {
    if (credit === 0n) return
    await transact(vault => vault.withdraw(credit), 'Your available credit was withdrawn to the connected wallet.')
  }

  async function handleLogout() {
    let serverSessionInvalidated = false
    try {
      const response = await apiFetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: emailUserAuthHeaders(),
      })
      serverSessionInvalidated = response.ok
    } catch { /* Clear the local session even if the API is unavailable. */ }
    localStorage.removeItem('rently_auth_token')
    setAuthUser(null)
    setWalletAuthToken('')
    setBookings([])
    setBookingRequests([])
    setPendingAction(null)
    if (path === '/bookings' || path === '/listings/new') navigate('/')
    setNotice(serverSessionInvalidated
      ? 'You have logged out.'
      : 'You are signed out here, but the API could not invalidate the server session. Reconnect to the API and log out again.')
  }

  const visibleListings = useMemo(() => {
    return listings.filter(item => {
      const query = search.trim().toLowerCase()
      const categoryMatch = filter === 'All items' || item.category === filter
      const textMatch = !query || `${item.title} ${item.description} ${item.category} ${item.pickupArea || ''}`.toLowerCase().includes(query)
      return categoryMatch && textMatch && item.active !== false
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [listings, search, filter])

  const visibleAgreements = useMemo(() => {
    return agreements.filter(item => {
      if (dashboardRole === 'all') return true
      if (!account) return true
      return dashboardRole === 'owner'
        ? item.owner.toLowerCase() === account.toLowerCase()
        : item.renter.toLowerCase() === account.toLowerCase()
    })
  }, [agreements, dashboardRole, account])

  const visibleBookingRequests = useMemo(() => {
    return bookingRequests.filter(req => {
      if (dashboardRole === 'all') return true
      return dashboardRole === 'owner'
        ? req.isOwner
        : req.isRenter
    })
  }, [bookingRequests, dashboardRole])

  const currentSelectedListing = selectedListing
    ? listings.find(item => item._id === selectedListing._id) || selectedListing
    : null

  return (
    <main className="app-shell">
      <SiteHeader
        account={account}
        walletNeedsConfirmation={Boolean(account && !walletConfirmed)}
        wrongNetwork={wrongNetwork}
        connecting={walletConnecting}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
        onNavigate={handleNavigate}
        authUser={authUser}
        onOpenAuth={(mode) => {
          setAuthModalMode(mode)
          setAuthModalOpen(true)
        }}
        onLogout={handleLogout}
      />

      {account && wrongNetwork && (
        <div className="network-warning">
          <span>MetaMask is not on Hardhat Local (Chain ID 31337).</span>
          <button onClick={() => switchNetwork().catch(error => setNotice(messageFor(error)))}>
            Switch to Hardhat Local
          </button>
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {/* --- HOMEPAGE --- */}
      {page === 'home' && (
        <>
          <section className="hero" id="top">
            <div className="hero-copy">
              <p className="eyebrow">BORROW MORE. BUY LESS.</p>
              <h1>Good things are<br /><em>better shared.</em></h1>
              <p>Peer-to-peer equipment rentals with on-chain deposit escrow. Secure, local, and straightforward.</p>

              {/* Balanced, Unclipped Hero Search Bar */}
              <form
                className="hero-search-bar"
                role="search"
                onSubmit={e => {
                  e.preventDefault()
                  navigate('/marketplace')
                }}
              >
                <div className="search-field">
                  <svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search tools, cameras, gear…"
                    aria-label="Search items"
                  />
                </div>
                <div className="search-divider" />
                <select
                  className="search-category-select"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  aria-label="Filter by category"
                >
                  {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <button type="submit" className="search-submit-btn">Search items</button>
              </form>
            </div>

            <figure className="hero-art">
              <img
                src="https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?auto=format&fit=crop&w=1200&q=80"
                alt="Photography gear and outdoor equipment"
              />
              <figcaption>
                <span>RENTLY VAULT ESCROW</span>
                <span>Security deposit protected on-chain</span>
              </figcaption>
            </figure>
          </section>

          {/* Categories */}
          <section className="home-categories">
            <div className="section-header">
              <div>
                <p className="eyebrow">CATEGORIES</p>
                <h2>What do you need?</h2>
              </div>
              <a href="/marketplace" className="section-link" onClick={e => { e.preventDefault(); navigate('/marketplace') }}>
                Browse all categories ↗
              </a>
            </div>
            <div className="category-chips">
              {categories.slice(1).map(cat => (
                <button
                  key={cat}
                  className={`category-chip ${filter === cat ? 'active' : ''}`}
                  onClick={() => {
                    setFilter(cat)
                    navigate('/marketplace')
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </section>

          {/* Real Listings Showcase */}
          <section className="home-listings">
            <div className="section-header">
              <div>
                <p className="eyebrow">COMMUNITY FINDS</p>
                <h2>Available near you</h2>
              </div>
              <a href="/marketplace" className="section-link" onClick={e => { e.preventDefault(); navigate('/marketplace') }}>
                View marketplace ({listings.length}) ↗
              </a>
            </div>

            {listingLoading ? (
              <p>Loading listings…</p>
            ) : listings.length === 0 ? (
              <p>No listings currently available.</p>
            ) : (
              <div className="listing-grid">
                {listings.slice(0, 4).map(item => (
                  <ListingCard
                    key={item._id}
                    item={item}
                    onDetails={() => setSelectedListing(item)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {page === 'login' && (
        <section className="market-section" style={{ minHeight: '55vh', display: 'grid', placeItems: 'center' }}>
          <div className="setup-callout" style={{ maxWidth: '520px' }}>
            <span>Sign in or create a Rently account to continue. Your Rently account and MetaMask wallet are separate.</span>
            <button className="dark-button" onClick={() => askForLogin()}>
              Log in or sign up
            </button>
          </div>
        </section>
      )}

      {/* --- MARKETPLACE EXPLORE PAGE --- */}
      {page === 'marketplace' && (
        <section className="market-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">COMMUNITY SHELF</p>
              <h2>Explore gear to borrow</h2>
            </div>
            <span style={{ fontSize: '14px', color: 'var(--muted)' }}>
              {visibleListings.length} items available
            </span>
          </div>

          <div className="category-chips" style={{ marginBottom: '24px' }}>
            {categories.map(cat => (
              <button
                key={cat}
                className={`category-chip ${filter === cat ? 'active' : ''}`}
                onClick={() => setFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {listingLoading ? (
            <p>Loading marketplace listings…</p>
          ) : visibleListings.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <h3>No items found</h3>
              <p>Try modifying your search or select a different category.</p>
            </div>
          ) : (
            <div className="listing-grid">
              {visibleListings.map(item => (
                <ListingCard
                  key={item._id}
                  item={item}
                  onDetails={() => setSelectedListing(item)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* --- CREATE / EDIT LISTING --- */}
      {page === 'listing' && (
        <section style={{ maxWidth: '640px', margin: '40px auto', width: '100%' }}>
          <div className="section-header">
            <div>
              <p className="eyebrow">SHARE YOUR GEAR</p>
              <h2>List an item</h2>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSaveListing}>
            <div className="input-group">
              <label>Title *</label>
              <input
                required
                maxLength="80"
                value={listingForm.title}
                onChange={e => setListingForm({ ...listingForm, title: e.target.value })}
                placeholder="e.g. Sony A7 III Camera Kit"
              />
            </div>

            <div className="input-group">
              <label>Category *</label>
              <select
                value={listingForm.category}
                onChange={e => setListingForm({ ...listingForm, category: e.target.value })}
              >
                {categories.slice(1).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>

            <div className="input-group">
              <label>Description *</label>
              <textarea
                required
                rows="3"
                value={listingForm.description}
                onChange={e => setListingForm({ ...listingForm, description: e.target.value })}
                placeholder="Include condition, accessories included, and rental requirements"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <label>Rent (ETH) *</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  value={listingForm.rent}
                  onChange={e => setListingForm({ ...listingForm, rent: e.target.value })}
                  placeholder="0.01"
                />
              </div>

              <div className="input-group">
                <label>Deposit (ETH) *</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  value={listingForm.deposit}
                  onChange={e => setListingForm({ ...listingForm, deposit: e.target.value })}
                  placeholder="0.05"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <label>Duration (days) *</label>
                <input
                  type="number"
                  min="1"
                  max="90"
                  required
                  value={listingForm.days}
                  onChange={e => setListingForm({ ...listingForm, days: e.target.value })}
                />
              </div>

              <div className="input-group">
                <label>Pickup Area</label>
                <input
                  value={listingForm.pickupArea}
                  onChange={e => setListingForm({ ...listingForm, pickupArea: e.target.value })}
                  placeholder="e.g. Indiranagar, Bengaluru"
                />
              </div>
            </div>

            <div className="input-group">
              <label>Photo URL (HTTPS)</label>
              <input
                type="url"
                value={listingForm.imageUrl}
                onChange={e => setListingForm({ ...listingForm, imageUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>

            <div className="input-group">
              <label>Meeting & Contact Instructions</label>
              <input
                value={listingForm.contact}
                onChange={e => setListingForm({ ...listingForm, contact: e.target.value })}
                placeholder="Private instructions shared after booking acceptance"
              />
            </div>

            <button type="submit" className="btn-primary" disabled={busy} style={{ marginTop: '12px', padding: '14px' }}>
              {busy ? 'Publishing…' : 'Publish listing to marketplace'}
            </button>
          </form>
        </section>
      )}

      {/* --- BOOKINGS & ESCROW DASHBOARD --- */}
      {page === 'bookings' && (
        <section style={{ padding: '36px 0 60px' }}>
          <div className="section-header">
            <div>
              <p className="eyebrow">YOUR RENTALS</p>
              <h2>Bookings &amp; Escrow</h2>
            </div>
            <button
              className="btn-secondary"
              style={{ width: 'auto', flex: '0 0 auto', minWidth: '124px', whiteSpace: 'nowrap' }}
              disabled={busy || refreshing}
              onClick={refreshDashboard}
            >
              ↻ Refresh
            </button>
          </div>

          {!authUser && (
            <div className="setup-callout" role="status">
              <span>Sign in to view private booking details and manage requests. Email account access and wallet authorization are separate.</span>
              <button className="dark-button" onClick={() => { setAuthModalMode('login'); setAuthModalOpen(true) }}>
                Log in or sign up
              </button>
            </div>
          )}

          {/* Account & Withdrawable Credit Summary */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '32px',
          }}>
            <div>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Connected Wallet</span>
              <div style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>
                {account ? shortAddress(account) : 'Not connected'}
              </div>
            </div>
            <div>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Withdrawable Rent Credit</span>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--accent)' }}>
                {formatEther(credit)} ETH
              </div>
            </div>
            <button
              className="btn-primary"
              style={{ width: 'auto', padding: '10px 20px' }}
              disabled={!account || credit === 0n || busy}
              onClick={handleWithdrawCredit}
            >
              Withdraw credit
            </button>
          </div>

          {/* Dashboard Filter Tabs */}
          <div className="category-chips" style={{ marginBottom: '28px' }}>
            {['all', 'owner', 'renter'].map(role => (
              <button
                key={role}
                className={`category-chip ${dashboardRole === role ? 'active' : ''}`}
                onClick={() => setDashboardRole(role)}
              >
                {role === 'all' ? 'All records' : role === 'owner' ? 'As Owner' : 'As Renter'}
              </button>
            ))}
          </div>

          {/* Booking Requests Inbox */}
          <div style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '16px' }}>
              Booking Requests Inbox
            </h3>
            {visibleBookingRequests.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No pending requests.</p>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {visibleBookingRequests.map(req => {
                  const isOwner = req.isOwner
                  return (
                    <div
                      key={req._id}
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--radius-md)',
                        padding: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: '700' }}>{req.listingTitle}</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: ['accepted', 'booked'].includes(req.status) ? 'var(--success)' : 'var(--accent)' }}>
                          {req.status.toUpperCase()}
                        </span>
                      </div>
                      <p style={{ fontSize: '14px', color: 'var(--muted)', margin: 0 }}>“{req.message}”</p>
                      <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                        Renter: <b>{shortAddress(req.renter)}</b> · Rent: <b>{req.rent} ETH</b> · Deposit: <b>{req.deposit} ETH</b>
                      </div>
                      {req.scheduledPickup && (
                        <div style={{ fontSize: '14px' }}>
                          Scheduled pickup: <b>{localDateLabel(req.scheduledPickup)}</b>
                        </div>
                      )}
                      {isOwner && ['pending', 'accepted'].includes(req.status) && (
                        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                          <button
                            className="btn-primary"
                            style={{ width: 'auto', padding: '8px 16px' }}
                            disabled={busy}
                            onClick={() => createBooking({
                              _id: req.listingId,
                              isOwner: true,
                              title: req.listingTitle,
                              rent: req.rent,
                              deposit: req.deposit,
                              days: req.days,
                              pickupArea: req.pickupArea,
                              owner: req.owner,
                              meetingDetails: req.meetingDetails,
                            }, req.renter, req.scheduledPickup, req._id)}
                          >
                            {req.status === 'accepted' ? 'Create Agreement' : 'Accept & Create Agreement'}
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ width: 'auto', padding: '8px 16px' }}
                            disabled={busy}
                            onClick={() => handleRejectRequest(req)}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* On-Chain Agreements */}
          <div>
            <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '16px' }}>
              On-Chain Agreements ({visibleAgreements.length})
            </h3>
            {visibleAgreements.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No agreements found on local chain.</p>
            ) : (
              <div style={{ display: 'grid', gap: '18px' }}>
                {visibleAgreements.map(item => {
                  const booking = bookings.find(b => String(b.agreementId) === String(item.id))
                  const populatedListing = booking?.listingId && typeof booking.listingId === 'object'
                    ? booking.listingId
                    : null
                  const listing = populatedListing || listings.find(l => l._id === booking?.listingId)
                  return (
                    <AgreementCard
                      key={item.id}
                      agreement={item}
                      booking={booking}
                      listing={listing}
                      account={account}
                      clock={clock}
                      onClick={() => setSelectedBookingDetails({ agreement: item, booking, listing })}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* --- AUTH MODAL (LOGIN / REGISTER) --- */}
      {authModalOpen && (
        <AuthModal
          mode={authModalMode}
          onModeChange={setAuthModalMode}
          onClose={() => {
            setAuthModalOpen(false)
            setPendingAction(null)
            if (path === '/login') navigate('/')
          }}
          onSuccess={(user) => {
            setAuthUser(user)
            localStorage.removeItem('rently_auth_token')
            setAuthModalOpen(false)
            if (path === '/login' && !pendingAction) navigate('/')
            setNotice(`Welcome back, ${user.name}!`)
          }}
        />
      )}

      {/* --- ITEM DETAILS MODAL --- */}
      {selectedListing && (
        <ListingDetailsModal
          item={currentSelectedListing}
          account={account}
          authUser={authUser}
          busy={busy}
          existingRequest={bookingRequests.find(r => r.listingId === currentSelectedListing._id && r.renter?.toLowerCase() === account?.toLowerCase())}
          onClose={() => setSelectedListing(null)}
          onRequestBooking={handleRequestBooking}
          onBook={createBooking}
          onLogin={() => askForLogin()}
        />
      )}

      {/* --- COMPLETE CLICKABLE BOOKING DETAILS MODAL WITH LIVE COUNTDOWN --- */}
      {selectedBookingDetails && (
        <BookingDetailsModal
          agreement={selectedBookingDetails.agreement}
          booking={selectedBookingDetails.booking}
          listing={selectedBookingDetails.listing}
          account={account}
          arbitrators={arbitrators}
          clock={clock}
          busy={busy}
          onAction={transact}
          refresh={refresh}
          onClose={() => setSelectedBookingDetails(null)}
        />
      )}

      <SiteFooter onNavigate={navigate} />
    </main>
  )
}

// --- SUB-COMPONENTS ---

function ListingCard({ item, onDetails }) {
  return (
    <article className="listing-card" onClick={onDetails}>
      <div className="listing-art-frame">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.title} loading="lazy" />
        ) : (
          <div className="listing-art-placeholder">{item.category}</div>
        )}
        <span className="listing-tag">{item.category}</span>
      </div>

      <div className="listing-body">
        <h3>{item.title}</h3>
        <p className="listing-desc">{item.description}</p>
        <div className="listing-prices">
          <span className="rent-tag">{item.rent} ETH <small>/ {item.days}d</small></span>
          <span className="deposit-tag">{item.deposit} ETH deposit</span>
        </div>
        <div className="listing-meta-row">
          <span>{item.pickupArea || 'Local pickup'}</span>
          <span>Owner {shortAddress(item.owner)}</span>
        </div>
      </div>
    </article>
  )
}

function ListingDetailsModal({ item, account, authUser, busy, existingRequest, onClose, onRequestBooking, onBook, onLogin }) {
  const [renterWallet, setRenterWallet] = useState('')
  const [msg, setMsg] = useState('Hi, I’d like to rent this item. Let me know when it is available.')
  const [pickupDate, setPickupDate] = useState('')
  const isOwner = Boolean((authUser && item.isOwner) || (account && item.owner?.toLowerCase() === account.toLowerCase()))
  const totalDue = formatEther(parseEther(String(item.rent)) + parseEther(String(item.deposit)))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>×</button>
        <p className="eyebrow">{item.category} · DETAILS</p>
        <h2 style={{ margin: '6px 0 16px', fontSize: '26px' }}>{item.title}</h2>
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt={item.title}
            style={{ width: '100%', height: '220px', objectFit: 'cover', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}
          />
        )}
        <p style={{ color: 'var(--muted)', fontSize: '15px', lineHeight: 1.6 }}>{item.description}</p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '12px',
          background: 'var(--surface-raised)',
          padding: '16px',
          borderRadius: 'var(--radius-md)',
          margin: '20px 0',
        }}>
          <div><small style={{ color: 'var(--muted)' }}>Rent</small><div style={{ fontWeight: '700' }}>{item.rent} ETH</div></div>
          <div><small style={{ color: 'var(--muted)' }}>Refundable Security Deposit</small><div style={{ fontWeight: '700' }}>{item.deposit} ETH</div></div>
          <div><small style={{ color: 'var(--muted)' }}>Total due to fund</small><div style={{ fontWeight: '700' }}>{totalDue} ETH</div></div>
          <div><small style={{ color: 'var(--muted)' }}>Rental Period</small><div style={{ fontWeight: '700' }}>{item.days} days</div></div>
          <div><small style={{ color: 'var(--muted)' }}>Pickup Area</small><div style={{ fontWeight: '700' }}>{item.pickupArea || 'Local area'}</div></div>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '13px' }}>The contract holds rent and deposit in escrow. Any deposit deduction follows the agreement terms and contract settlement process.</p>

        {!authUser ? (
          <button className="btn-primary" style={{ width: '100%', padding: '12px' }} onClick={onLogin}>
            Log in or sign up to continue
          </button>
        ) : isOwner ? (
          <form onSubmit={async e => {
            e.preventDefault()
            if (await onBook(item, renterWallet)) onClose()
          }}>
            <div className="input-group" style={{ marginBottom: '14px' }}>
              <label>Direct Renter Wallet Address</label>
              <input
                required
                pattern="0x[a-fA-F0-9]{40}"
                value={renterWallet}
                onChange={e => setRenterWallet(e.target.value)}
                placeholder="0x..."
              />
            </div>
            <button className="btn-primary" style={{ width: '100%', padding: '12px' }} disabled={busy}>
              Create On-Chain Agreement
            </button>
          </form>
        ) : existingRequest ? (
          <div style={{ padding: '14px', background: 'var(--surface-raised)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
            <span style={{ fontWeight: '700', color: 'var(--accent)' }}>Request {existingRequest.status}</span>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '4px 0 0' }}>Track status in My Bookings.</p>
          </div>
        ) : (
          <form onSubmit={async e => {
            e.preventDefault()
            const ok = await onRequestBooking(item, msg, pickupDate)
            if (ok) onClose()
          }}>
            <div className="input-group" style={{ marginBottom: '12px' }}>
              <label>Scheduled Pickup Date / Time</label>
              <input
                type="datetime-local"
                value={pickupDate}
                onChange={e => setPickupDate(e.target.value)}
              />
            </div>
            <div className="input-group" style={{ marginBottom: '16px' }}>
              <label>Message to Owner</label>
              <textarea
                required
                rows="2"
                value={msg}
                onChange={e => setMsg(e.target.value)}
              />
            </div>
            <button className="btn-primary" style={{ width: '100%', padding: '12px' }} disabled={busy}>
              {busy ? 'Submitting…' : 'Send Booking Request'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function AgreementCard({ agreement: a, booking, listing, _account, clock, onClick }) {
    const statusName = stateNames[Number(a.state)] || 'Unknown'

  // Live return deadline countdown preview
  const activeRental = Number(a.state) === 3
  const returnDeadline = Number(a.returnDeadline)
  const secondsLeft = returnDeadline - clock

  return (
    <article
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        cursor: 'pointer',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          AGREEMENT #{a.id}
        </span>
        <span style={{
          fontSize: '12px',
          fontWeight: '700',
          padding: '4px 10px',
          borderRadius: 'var(--radius-full)',
          background: Number(a.state) === 3 ? 'var(--accent-light)' : 'var(--surface-raised)',
          color: Number(a.state) === 3 ? 'var(--accent)' : 'var(--ink-soft)',
        }}>
          {statusName}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>
          {listing?.title || booking?.listingTitle || `Rental Agreement #${a.id}`}
        </h4>
        <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--ink)' }}>
          {formatEther(a.rent)} ETH rent
        </span>
      </div>

      <div style={{ fontSize: '13px', color: 'var(--muted)', display: 'flex', gap: '20px' }}>
        <span>Owner: <b>{shortAddress(a.owner)}</b></span>
        <span>Renter: <b>{shortAddress(a.renter)}</b></span>
        <span>Vault holds: <b>{formatEther(a.escrowRemaining)} ETH</b></span>
      </div>

      {activeRental && (
        <div style={{
          padding: '8px 12px',
          background: secondsLeft > 0 ? 'var(--accent-light)' : 'var(--danger-bg)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '13px',
          fontWeight: '700',
          color: secondsLeft > 0 ? 'var(--accent)' : 'var(--danger)',
        }}>
          {secondsLeft > 0 ? (
            `Return Countdown: ${Math.floor(secondsLeft / 86400)}d ${Math.floor((secondsLeft % 86400) / 3600)}h ${Math.floor((secondsLeft % 3600) / 60)}m ${secondsLeft % 60}s`
          ) : (
            `OVERDUE by ${Math.abs(Math.floor(secondsLeft / 3600))}h ${Math.abs(Math.floor((secondsLeft % 3600) / 60))}m`
          )}
        </div>
      )}

      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)', alignSelf: 'flex-end' }}>
        View complete details &amp; actions ↗
      </div>
    </article>
  )
}

// Complete Booking Details Modal with LIVE TICKING COUNTDOWN and Full Timeline (PART 13, 14)
function BookingDetailsModal({ agreement: a, booking, listing, account, arbitrators, clock, busy, onAction, refresh, onClose }) {
  const [deduction, setDeduction] = useState('0')
  const [ownerShare, setOwnerShare] = useState('0')
  const [evidenceHash, setEvidenceHash] = useState('')

  const isOwner = account && a.owner?.toLowerCase() === account.toLowerCase()
  const isRenter = account && a.renter?.toLowerCase() === account.toLowerCase()
  const isArbitrator = account && arbitrators.some(arb => arb?.toLowerCase() === account.toLowerCase())

  const state = Number(a.state)
  const statusName = stateNames[state] || 'Unknown'

  // Live countdown calculation
  const returnDeadline = Number(a.returnDeadline)
  const remaining = returnDeadline - clock
  const isOverdue = remaining < 0

  const days = Math.floor(Math.abs(remaining) / 86400)
  const hours = Math.floor((Math.abs(remaining) % 86400) / 3600)
  const minutes = Math.floor((Math.abs(remaining) % 3600) / 60)
  const seconds = Math.abs(remaining) % 60

  const send = async (callback, msg, expectedSender) => {
    await onAction(callback, msg, expectedSender)
    await refresh()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box wide" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>×</button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <p className="eyebrow">BOOKING DETAILS &amp; ESCROW</p>
          <span style={{
            fontSize: '13px',
            fontWeight: '700',
            padding: '4px 12px',
            borderRadius: 'var(--radius-full)',
            background: state === 3 ? 'var(--accent-light)' : 'var(--surface-raised)',
            color: state === 3 ? 'var(--accent)' : 'var(--ink)',
          }}>
            {statusName}
          </span>
        </div>

        <h2 style={{ fontSize: '28px', fontWeight: '800', margin: '0 0 4px' }}>
          {listing?.title || booking?.listingTitle || `Agreement #${a.id}`}
        </h2>
        <span style={{ fontSize: '14px', color: 'var(--muted)' }}>
          {listing?.category || 'Rental Item'} · {listing?.pickupArea || booking?.pickupArea || 'Local Meeting Area'}
        </span>

        {/* Live Countdown Banner (Active Rental or Return Pending) */}
        {(state === 3 || (state === 4 && remaining > 0)) && (
          <div className={`countdown-banner ${isOverdue ? 'overdue-countdown' : 'active-countdown'}`}>
            <span className="countdown-title">
              {isOverdue ? '⚠️ RENTAL RETURN OVERDUE' : '⏱️ TIME REMAINING UNTIL RETURN DEADLINE'}
            </span>
            <div className="countdown-digits">
              <div className="countdown-block">
                <span className="countdown-number">{String(days).padStart(2, '0')}</span>
                <span className="countdown-unit">Days</span>
              </div>
              <span className="countdown-sep">:</span>
              <div className="countdown-block">
                <span className="countdown-number">{String(hours).padStart(2, '0')}</span>
                <span className="countdown-unit">Hours</span>
              </div>
              <span className="countdown-sep">:</span>
              <div className="countdown-block">
                <span className="countdown-number">{String(minutes).padStart(2, '0')}</span>
                <span className="countdown-unit">Mins</span>
              </div>
              <span className="countdown-sep">:</span>
              <div className="countdown-block">
                <span className="countdown-number">{String(seconds).padStart(2, '0')}</span>
                <span className="countdown-unit">Secs</span>
              </div>
            </div>
            <small style={{ color: 'var(--muted)', fontSize: '13px' }}>
              Deadline: {dateLabel(a.returnDeadline)} (Local Time)
            </small>
          </div>
        )}

        {/* Financial Overview Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          margin: '20px 0',
        }}>
          <div style={{ background: 'var(--surface-raised)', padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Agreed Rent</span>
            <div style={{ fontSize: '16px', fontWeight: '800' }}>{formatEther(a.rent)} ETH</div>
          </div>
          <div style={{ background: 'var(--surface-raised)', padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Agreed Security Deposit</span>
            <div style={{ fontSize: '16px', fontWeight: '800' }}>{formatEther(a.deposit)} ETH</div>
          </div>
          <div style={{ background: 'var(--surface-raised)', padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Currently held by RentalVault</span>
            <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--accent)' }}>{formatEther(a.escrowRemaining)} ETH</div>
          </div>
          <div style={{ background: 'var(--surface-raised)', padding: '12px 14px', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Duration</span>
            <div style={{ fontSize: '16px', fontWeight: '800' }}>{Number(a.rentalDuration) / 86400} days</div>
          </div>
        </div>

        {/* Participant & Meeting Details */}
        <div style={{
          borderTop: '1px solid var(--line)',
          paddingTop: '16px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          fontSize: '14px',
        }}>
          <div>
            <span style={{ color: 'var(--muted)', fontSize: '13px' }}>Item Owner:</span>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: '600' }}>{a.owner}</div>
          </div>
          <div>
            <span style={{ color: 'var(--muted)', fontSize: '13px' }}>Renter:</span>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: '600' }}>{a.renter}</div>
          </div>
        </div>

        {booking && (
          <div className="booking-meeting-details">
            <h3>Pickup arrangements</h3>
            <p><b>Scheduled pickup:</b> {localDateLabel(booking.scheduledPickupTime)}</p>
            <p><b>Meeting instructions:</b> {booking.meetingDetails || 'The owner has not added private meeting instructions.'}</p>
          </div>
        )}

        {/* Chronological Event History */}
        <div style={{ margin: '24px 0', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
          <h4 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '12px' }}>Agreement Progress Timeline</h4>
          <div className="timeline">
            <div className="timeline-step completed">
              <b>Agreement Created on Local Chain</b>
              <span>Owner initialized terms #{a.id}</span>
            </div>
            <div className={`timeline-step ${state >= 1 ? 'completed' : ''}`}>
              <b>Renter Funding</b>
              <span>{state >= 1 ? `${formatEther(a.escrowRemaining)} ETH currently held in RentalVault escrow` : 'No funds deposited. Renter funding is pending.'}</span>
            </div>
            <div className={`timeline-step ${state >= 3 ? 'completed' : ''}`}>
              <b>Mutual Handover Confirmation</b>
              <span>
                Owner: {a.ownerHandoverConfirmed ? 'Confirmed ✓' : 'Pending'} · Renter: {a.renterHandoverConfirmed ? 'Confirmed ✓' : 'Pending'}
                {a.handoverAt && Number(a.handoverAt) > 0 ? ` (At ${dateLabel(a.handoverAt)})` : ''}
              </span>
            </div>
            <div className={`timeline-step ${state === 6 ? 'completed' : ''}`}>
              <b>Return &amp; Deposit Settlement</b>
              <span>
                {state === 6 ? 'Return confirmed & deposit refunded to renter.' : 'Pending return and deposit settlement.'}
              </span>
            </div>
          </div>
        </div>

        {/* Contract Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          {/* State 0: Unfunded */}
          {state === 0 && isRenter && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => send(vault => vault.fund(a.id, { value: a.rent + a.deposit }), 'Rent and deposit funded into vault escrow.', a.renter)}
            >
              Fund {formatEther(a.rent + a.deposit)} ETH from MetaMask as Renter
            </button>
          )}

          {state === 0 && (isOwner || isRenter) && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => send(vault => vault.cancelBeforeFunding(a.id), 'Unfunded agreement cancelled.')}
            >
              Cancel Unfunded Agreement
            </button>
          )}

          {/* State 1 or 2: Funded / Handover Pending */}
          {[1, 2].includes(state) && (
            <>
              {isOwner && !a.ownerHandoverConfirmed && (
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => send(vault => vault.confirmHandover(a.id), 'Owner confirmed physical handover.')}
                >
                  Owner: Confirm Handover
                </button>
              )}
              {isRenter && !a.renterHandoverConfirmed && (
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => send(vault => vault.confirmHandover(a.id), 'Renter confirmed physical handover.')}
                >
                  Renter: Confirm Handover
                </button>
              )}
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => send(vault => vault.consentToFundedCancellation(a.id), 'Consent to cancel and full refund recorded.')}
              >
                Consent to Pre-Handover Cancellation
              </button>
            </>
          )}

          {/* State 3 or 4: Active Rental / Return Pending */}
          {[3, 4].includes(state) && isRenter && !a.renterReturnConfirmed && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => send(vault => vault.confirmReturn(a.id), 'Renter confirmed item return.')}
            >
              Renter: Confirm Return of Item
            </button>
          )}

          {[3, 4].includes(state) && isOwner && !a.ownerReturnConfirmed && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="number"
                min="0"
                step="any"
                max={formatEther(a.deposit)}
                value={deduction}
                onChange={e => setDeduction(e.target.value)}
                placeholder="Deduction ETH (0 for full refund)"
                style={{ flex: 1, padding: '10px' }}
              />
              <button
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={busy}
                onClick={() => send(vault => vault.confirmReturnAndProposeDeduction(a.id, parseEther(deduction || '0')), 'Owner confirmed return.')}
              >
                Confirm Return &amp; Settle
              </button>
            </div>
          )}

          {/* Deduction Acceptance by Renter */}
          {state === 4 && isRenter && a.ownerReturnConfirmed && !a.renterAcceptedDeduction && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => send(vault => vault.acceptDeduction(a.id, a.proposedDeduction), `Accepted deduction of ${formatEther(a.proposedDeduction)} ETH.`)}
            >
              Accept Proposed Deduction of {formatEther(a.proposedDeduction)} ETH
            </button>
          )}

          {/* Dispute */}
          {[1, 2, 3, 4].includes(state) && (isOwner || isRenter) && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <input
                value={evidenceHash}
                onChange={e => setEvidenceHash(e.target.value)}
                placeholder="Dispute evidence hash (0x + 64 hex chars)"
                style={{ flex: 1, padding: '10px' }}
              />
              <button
                className="btn-secondary"
                style={{ width: 'auto' }}
                disabled={busy}
                onClick={() => {
                  if (!/^0x[a-fA-F0-9]{64}$/.test(evidenceHash)) {
                    window.alert('Please enter a valid 32-byte hex hash.')
                    return
                  }
                  send(vault => vault.openDispute(a.id, evidenceHash), 'Dispute opened.')
                }}
              >
                Open Dispute
              </button>
            </div>
          )}

          {/* Arbitration */}
          {state === 5 && isArbitrator && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="number"
                step="any"
                value={ownerShare}
                onChange={e => setOwnerShare(e.target.value)}
                placeholder="Owner allocation ETH"
                style={{ flex: 1, padding: '10px' }}
              />
              <button
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={busy}
                onClick={() => {
                  const share = parseEther(ownerShare || '0')
                  const renterShare = BigInt(a.escrowRemaining) - share
                  send(vault => vault.arbitrate(a.id, share, renterShare), 'Arbitrator resolved remaining escrow.')
                }}
              >
                Arbitrate Escrow
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Authentication Modal Component (PART 12)
function AuthModal({ mode, onModeChange, onClose, onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = mode === 'login' ? { email, password } : { email, password, name }
      const res = await apiFetch(`${apiBase}/${mode === 'login' ? 'auth/login' : 'auth/register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Authentication failed.')
      onSuccess(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay auth-modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>×</button>
        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { onModeChange('login'); setError('') }}
          >
            Log in
          </button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { onModeChange('register'); setError('') }}
          >
            Sign up
          </button>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: '16px' }}>{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="input-group">
              <label>Your Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
          )}

          <div className="input-group">
            <label>Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="input-group">
            <label>Password (min 8 characters)</label>
            <input
              type="password"
              required
              minLength="8"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ marginTop: '8px', padding: '12px' }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default App
