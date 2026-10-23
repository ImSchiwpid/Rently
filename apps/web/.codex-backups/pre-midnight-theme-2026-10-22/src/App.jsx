import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, JsonRpcProvider, formatEther, parseEther } from 'ethers'
import { vaultAbi } from './vaultAbi.js'
import { SiteFooter, SiteHeader } from './components/SiteChrome.jsx'
import './App.css'
import './Marketplace.css'

const categories = ['All items', 'Tools', 'Electronics', 'Home', 'Outdoors', 'Sports', 'Music', 'Events', 'Fashion', 'Other']
const stateNames = ['Created', 'Funded', 'Handover pending', 'Active rental', 'Return pending', 'Disputed', 'Completed', 'Cancelled', 'Expired', 'Resolved']
const address = import.meta.env.VITE_RENTAL_VAULT_ADDRESS
const chainId = Number(import.meta.env.VITE_CHAIN_ID || 31337)
const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001/api'
const rpc = new JsonRpcProvider('http://127.0.0.1:8545')
const agreementFields = [
  'owner', 'renter', 'rent', 'deposit', 'escrowRemaining', 'fundingDeadline',
  'handoverNotBefore', 'handoverDeadline', 'rentalDuration', 'returnGracePeriod',
  'handoverAt', 'rentalEnd', 'returnDeadline', 'disputeOpenedAt',
  'proposedDeduction', 'disputeEvidenceHash', 'state', 'ownerHandoverConfirmed',
  'renterHandoverConfirmed', 'ownerReturnConfirmed', 'renterReturnConfirmed',
  'renterAcceptedDeduction', 'ownerCancelConsent', 'renterCancelConsent',
]

function shortAddress(value = '') { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—' }
function dateLabel(seconds) { return seconds ? new Date(Number(seconds) * 1000).toLocaleString() : 'Not set' }
function messageFor(error) { return error?.shortMessage || error?.reason || error?.message?.split('\n')[0] || 'The transaction could not be completed.' }

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
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
  const page = path === '/marketplace' ? 'marketplace' : path === '/listings/new' || path.startsWith('/listings/') ? 'listing' : path === '/bookings' ? 'bookings' : path === '/privacy' ? 'privacy' : path === '/login' ? 'login' : 'home'
  const [account, setAccount] = useState('')
  const [walletConnecting, setWalletConnecting] = useState(false)
  const [walletSessionActive, setWalletSessionActive] = useState(false)
  const [wrongNetwork, setWrongNetwork] = useState(false)
  const [filter, setFilter] = useState('All items')
  const [search, setSearch] = useState('')
  const [maxRent, setMaxRent] = useState('')
  const [sort, setSort] = useState('newest')
  const [dashboardRole, setDashboardRole] = useState('all')
  const [listings, setListings] = useState([])
  const [bookings, setBookings] = useState([])
  const [bookingRequests, setBookingRequests] = useState([])
  const [listingLoading, setListingLoading] = useState(true)
  const [editingId, setEditingId] = useState('')
  const [selectedListing, setSelectedListing] = useState(null)
  const [agreements, setAgreements] = useState([])
  const [arbitrators, setArbitrators] = useState([])
  const [credit, setCredit] = useState(0n)
  const emptyListing = { title: '', category: 'Tools', description: '', imageUrl: '', pickupArea: '', contact: '', rent: '', deposit: '', days: '3' }
  const [listingForm, setListingForm] = useState(emptyListing)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [clock, setClock] = useState(0)

  const readVault = useMemo(() => address ? new Contract(address, vaultAbi, rpc) : null, [])
  const visibleAgreements = agreements.filter(item => dashboardRole === 'all' || (dashboardRole === 'owner' ? item.owner.toLowerCase() === account.toLowerCase() : item.renter.toLowerCase() === account.toLowerCase()))
  const visibleBookingRequests = bookingRequests.filter(request => dashboardRole === 'all' || (dashboardRole === 'owner' ? request.owner.toLowerCase() === account.toLowerCase() : request.renter.toLowerCase() === account.toLowerCase()))
  const visibleListings = listings.filter(item => {
    const query = search.trim().toLowerCase()
    const categoryMatch = filter === 'All items' || item.category === filter
    const textMatch = !query || `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(query)
    return categoryMatch && textMatch && (!maxRent || Number(item.rent) <= Number(maxRent)) && item.active !== false
  }).sort((a, b) => sort === 'price-low' ? Number(a.rent) - Number(b.rent) : sort === 'price-high' ? Number(b.rent) - Number(a.rent) : new Date(b.createdAt) - new Date(a.createdAt))

  const refresh = useCallback(async (wallet = account) => {
    if (!readVault) return
    try {
      const bytecode = await rpc.getCode(address)
      if (bytecode === '0x') {
        setAgreements([])
        setArbitrators([])
        setCredit(0n)
        setNotice(`RentalVault is not deployed at ${address} on Hardhat Local. Start the local chain and run the contracts deployment command, then refresh.`)
        return
      }
      const next = Number(await readVault.nextAgreementId())
      const records = []
      for (let idValue = 1; idValue < next; idValue += 1) {
        try {
          const data = await readVault.getAgreement(idValue)
          // ethers returns Solidity structs as array-like Result values. Their
          // named fields are readable, but object spread only copies indices.
          // Copy the named properties explicitly so dashboard cards receive
          // the actual contract state and participant addresses.
          records.push({
            id: idValue,
            ...Object.fromEntries(agreementFields.map(field => [field, data[field]])),
          })
        } catch { /* Agreement IDs are sequential; skip any unknown record. */ }
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

  const loadListings = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/listings`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load listings.')
      setListings(result.listings || [])
      setNotice(current => current.startsWith('Marketplace API unavailable:') ? '' : current)
    } catch (error) {
      setListings([])
      setNotice(`Marketplace API unavailable: ${messageFor(error)} Start MongoDB and the API server to load listings.`)
    } finally { setListingLoading(false) }
  }, [])

  const loadBookings = useCallback(async (wallet = account) => {
    if (!wallet) return
    try {
      const response = await fetch(`${apiBase}/bookings?wallet=${encodeURIComponent(wallet)}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load booking metadata.')
      setBookings(result.bookings || [])
    } catch (error) { setNotice(`Could not load booking metadata: ${messageFor(error)}`) }
  }, [account])

  const loadBookingRequests = useCallback(async (wallet = account) => {
    if (!wallet) { setBookingRequests([]); return }
    try {
      const response = await fetch(`${apiBase}/booking-requests?wallet=${encodeURIComponent(wallet)}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load booking requests.')
      setBookingRequests(result.requests || [])
    } catch (error) { setNotice(`Could not load booking requests: ${messageFor(error)}`) }
  }, [account])

  useEffect(() => {
    const timer = window.setTimeout(() => { loadListings() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadListings])
  useEffect(() => {
    const timer = window.setTimeout(() => { loadBookings() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadBookings])
  useEffect(() => {
    const timer = window.setTimeout(() => { loadBookingRequests() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadBookingRequests])

  useEffect(() => {
    const updateClock = () => setClock(Math.floor(Date.now() / 1000))
    updateClock()
    const timer = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!window.ethereum) return undefined
    const update = async (accounts) => {
      if (!walletSessionActive) return
      setAccount(accounts?.[0] || '')
      if (!accounts?.[0]) setBookings([])
      if (accounts?.[0]) refresh(accounts[0])
    }
    const chainChanged = (value) => setWrongNetwork(Number(value) !== chainId)
    window.ethereum.on('accountsChanged', update)
    window.ethereum.on('chainChanged', chainChanged)
    window.ethereum.request({ method: 'eth_chainId' }).then(chainChanged).catch(() => {})
    return () => {
      window.ethereum.removeListener('accountsChanged', update)
      window.ethereum.removeListener('chainChanged', chainChanged)
    }
  }, [refresh, walletSessionActive])

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice('MetaMask was not found. Install the browser extension, then reload this page.')
      return false
    }
    setWalletConnecting(true)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts?.[0]) return false
      const activeChain = Number(await window.ethereum.request({ method: 'eth_chainId' }))
      setWalletSessionActive(true)
      setAccount(accounts[0])
      setWrongNetwork(activeChain !== chainId)
      // Wallet sign-in should not wait for the local Hardhat RPC to respond.
      void refresh(accounts[0])
      setNotice('Wallet connected. Contract actions require confirmation in MetaMask.')
      return true
    } catch (error) { setNotice(messageFor(error)); return false }
    finally { setWalletConnecting(false) }
  }

  function disconnectWallet() {
    setWalletSessionActive(false)
    setAccount('')
    setCredit(0n)
    setAgreements([])
    setBookings([])
    setBookingRequests([])
    setDashboardRole('all')
    setNotice('You are logged out of Rently. Your MetaMask account remains available to connect again.')
  }

  async function switchNetwork() {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] })
    } catch (error) {
      if (error.code !== 4902) throw error
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}`, chainName: 'Hardhat Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['http://127.0.0.1:8545'] }],
      })
    }
  }

  async function transact(action, successMessage, expectedSender = account) {
    if (!account || !window.ethereum) {
      setNotice('Connect MetaMask before using contract actions.')
      return
    }
    if (!address) {
      setNotice('RentalVault is not deployed yet. Start the Hardhat node and run the local deployment command.')
      return
    }
    setBusy(true)
    setNotice('Waiting for MetaMask confirmation…')
    try {
      const activeChain = Number(await window.ethereum.request({ method: 'eth_chainId' }))
      if (activeChain !== chainId) {
        setWrongNetwork(true)
        setNotice('Switch MetaMask to Hardhat Local before sending this transaction.')
        return false
      }
      const deployedCode = await rpc.getCode(address)
      if (deployedCode === '0x') {
        setNotice(`RentalVault is not deployed at ${address} on Hardhat Local. Deploy it with “npm.cmd run deploy:local --workspace=contracts”, then reload this page.`)
        return false
      }
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()
      if (signerAddress.toLowerCase() !== expectedSender.toLowerCase()) {
        setNotice(`No transaction was sent. MetaMask is selected to ${shortAddress(signerAddress)}, but this action requires ${shortAddress(expectedSender)}. Select the required wallet and try again.`)
        return false
      }
      const vault = new Contract(address, vaultAbi, signer)
      const tx = await action(vault)
      const receipt = await tx.wait()
      if (!receipt || receipt.status !== 1) throw new Error('The transaction did not succeed on-chain.')
      setNotice(`${successMessage} Transaction: ${receipt.hash}`)
      await refresh(account)
      return receipt
    } catch (error) { setNotice(messageFor(error)) }
    finally { setBusy(false) }
    return false
  }

  async function addListing(event) {
    event.preventDefault()
    if (!account) { setNotice('Connect the wallet that owns this item before publishing a listing.'); return }
    try {
      if (parseEther(listingForm.rent) <= 0n || parseEther(listingForm.deposit) <= 0n || Number(listingForm.days) <= 0) throw new Error('Rent, deposit, and rental duration must be greater than zero.')
      const payload = { ...listingForm, days: Number(listingForm.days), owner: account }
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const operation = editingId ? 'listing:update' : 'listing:create'
      const signature = await signer.signMessage(`Rently marketplace ${operation}\n${canonical(payload)}`)
      const response = await fetch(editingId ? `${apiBase}/listings/${editingId}` : `${apiBase}/listings`, {
        method: editingId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, signature }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Listing could not be saved.')
      setListings(current => editingId ? current.map(item => item._id === editingId ? result.listing : item) : [result.listing, ...current])
      setListingForm(emptyListing)
      setNotice(editingId ? 'Listing updated in the marketplace database.' : 'Listing published to the marketplace database.')
      setEditingId('')
      navigate('/marketplace')
    } catch (error) { setNotice(messageFor(error)) }
  }

  async function deactivateListing(item) {
    if (!account || item.owner.toLowerCase() !== account.toLowerCase()) {
      setNotice('Connect the wallet that owns this listing before deactivating it.')
      return
    }
    setBusy(true)
    try {
      const payload = { id: item._id, owner: account }
      const signer = await new BrowserProvider(window.ethereum).getSigner()
      const signature = await signer.signMessage(`Rently marketplace listing:delete\n${canonical(payload)}`)
      const query = new URLSearchParams({ owner: account, signature })
      const response = await fetch(`${apiBase}/listings/${item._id}?${query}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Listing could not be deactivated.')
      setListings(current => current.filter(listing => listing._id !== item._id))
      setNotice('Listing deactivated. It is no longer shown in the marketplace.')
    } catch (error) { setNotice(messageFor(error)) }
    finally { setBusy(false) }
  }

  async function createBooking(item, renterAddress) {
    if (!window.ethereum || !account) { setNotice('Connect the item owner wallet before creating an agreement.'); return }
    const now = clock
    const fundingDeadline = now + 24 * 60 * 60
    const handoverNotBefore = now + 60
    const handoverDeadline = now + 48 * 60 * 60
    const days = Number(item.days)
    const receipt = await transact(vault => vault.createAgreement(
      renterAddress,
      parseEther(item.rent),
      parseEther(item.deposit),
      fundingDeadline,
      handoverNotBefore,
      handoverDeadline,
      days * 24 * 60 * 60,
      24 * 60 * 60,
    ), `Agreement created for “${item.title}”.`)
    if (receipt) {
      let agreementId = ''
      for (const log of receipt.logs) {
        try { const parsed = readVault.interface.parseLog(log); if (parsed?.name === 'AgreementCreated') agreementId = parsed.args.agreementId.toString() } catch { /* Ignore non-vault logs. */ }
      }
      if (!agreementId) {
        try {
          const latestId = BigInt(await readVault.nextAgreementId()) - 1n
          if (latestId > 0n) {
            const latest = await readVault.getAgreement(latestId)
            if (latest.owner.toLowerCase() === account.toLowerCase() && latest.renter.toLowerCase() === renterAddress.toLowerCase()) agreementId = latestId.toString()
          }
        } catch { /* The event log remains the primary source; surface a recovery message if both reads fail. */ }
      }
      if (!agreementId) {
        setNotice(`The transaction was mined (${receipt.hash}), but the vault emitted no AgreementCreated event. No booking was recorded. Check that MetaMask and this app use the same deployed RentalVault on Hardhat Local.`)
        return
      }
      try {
        const response = await fetch(`${apiBase}/bookings`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ listingId: item._id, agreementId, owner: account, renter: renterAddress, createTransaction: receipt.hash }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Booking metadata could not be saved.')
        setBookings(current => [result.booking, ...current])
        await loadBookingRequests(account)
        await loadListings()
      } catch (error) {
        setNotice(`On-chain agreement succeeded (${receipt.hash}), but booking metadata failed: ${messageFor(error)}. Check the agreement in the contract dashboard.`)
      }
    }
  }

  async function requestBooking(item, message) {
    if (!window.ethereum || !account) { setNotice('Connect your wallet to request this rental.'); return false }
    setBusy(true)
    try {
      const payload = { listingId: item._id, renter: account, message: message.trim() }
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const signature = await signer.signMessage(`Rently marketplace booking-request:create\n${canonical(payload)}`)
      const response = await fetch(`${apiBase}/booking-requests`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, signature }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Your booking request could not be sent.')
      await loadBookingRequests(account)
      setNotice('Request sent. The owner can review it under My bookings and create the rental agreement.')
      return true
    } catch (error) {
      setNotice(messageFor(error))
      return false
    } finally { setBusy(false) }
  }

  async function rejectBookingRequest(request) {
    if (!account || request.owner.toLowerCase() !== account.toLowerCase()) {
      setNotice('Connect the wallet that owns this listing before rejecting its request.')
      return
    }
    setBusy(true)
    try {
      const payload = { requestId: request._id, owner: account }
      const signer = await new BrowserProvider(window.ethereum).getSigner()
      const signature = await signer.signMessage(`Rently marketplace booking-request:reject\n${canonical(payload)}`)
      const response = await fetch(`${apiBase}/booking-requests/${request._id}/reject`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, signature }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Booking request could not be rejected.')
      setBookingRequests(current => current.map(item => item._id === request._id ? result.request : item))
      setNotice('Booking request declined. No agreement or payment was created.')
    } catch (error) { setNotice(messageFor(error)) }
    finally { setBusy(false) }
  }

  async function withdrawCredit() {
    if (credit === 0n) return
    await transact(vault => vault.withdraw(credit), 'Your available credit was withdrawn to the connected wallet.')
  }

  return (
    <main className="app-shell">
      <SiteHeader account={account} connecting={walletConnecting} onConnect={async () => { if (await connectWallet()) navigate('/marketplace') }} onDisconnect={disconnectWallet} onNavigate={navigate} />

      {page !== 'home' && wrongNetwork && <div className="network-warning">MetaMask is on another network. <button onClick={() => switchNetwork().catch(error => setNotice(messageFor(error)))}>Switch to Hardhat Local</button></div>}
      {page !== 'home' && notice && <div className="notice" role="status"><span>{notice}</span>{notice.startsWith('Marketplace API unavailable:') && <button onClick={() => loadListings()}>Retry</button>}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>Dismiss</button></div>}

      {page === 'home' && <>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">BORROW MORE. BUY LESS.</p>
          <h1>Good things are<br /><em>better shared.</em></h1>
          <p>Find useful things from people nearby, with rental deposits held safely in a local smart contract.</p>
          <a className="primary-link" href="/marketplace" onClick={event => { event.preventDefault(); navigate('/marketplace') }}>Explore the marketplace <span>↗</span></a>
        </div>
        <figure className="hero-art" aria-label="A welcoming home where useful things are shared">
          <img className="hero-photo-main" src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=85" alt="A welcoming living room" fetchPriority="high" />
          <figcaption className="hero-image-caption"><span>GOOD THINGS, SHARED OFTEN</span><span>Useful things are closer than you think.</span></figcaption>
        </figure>
        <div className="hero-note"><span>01</span><span>Borrow from your community</span><span className="note-line" /></div>
      </section>
      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="how-intro"><p className="eyebrow">A BETTER WAY TO BORROW</p><h2 id="how-heading">Good things, <em>shared simply.</em></h2><p>Find what you need nearby, meet the owner, and return it when you’re done.</p></div>
        <div className="how-steps">
          <article><span>01</span><h3>Find your thing</h3><p>Browse useful items listed by people in your community.</p></article>
          <article><span>02</span><h3>Meet the owner</h3><p>Check the pickup area and contact the owner to arrange a handoff.</p></article>
          <article><span>03</span><h3>Borrow with care</h3><p>Agree on the rental, return it on time, and keep good things in use.</p></article>
        </div>
      </section>
      </>}

      {page === 'marketplace' && <section className="market-section" id="marketplace">
        <div className="section-heading">
          <div><p className="eyebrow">THE COMMUNITY SHELF</p><h2>Find your next<br /><em>borrowed favorite.</em></h2></div>
          <div className="heading-side"><p>Useful things, shared locally.<br />Choose a category to get started.</p><span className="item-count">{listings.length} items listed</span></div>
        </div>
        <div className="category-tabs" role="tablist" aria-label="Filter by category">
          {categories.map(category => <button key={category} role="tab" aria-selected={filter === category} className={filter === category ? 'selected' : ''} onClick={() => setFilter(category)}>{category}</button>)}
        </div>
        <div className="market-tools">
          <label className="search-control"><span>Search listings</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, description, or category" /></label>
          <label className="filter-control"><span>Maximum rent (ETH)</span><input type="number" min="0" step="any" value={maxRent} onChange={event => setMaxRent(event.target.value)} placeholder="Any price" /></label>
          <label className="filter-control"><span>Sort by</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest</option><option value="price-low">Rent: low to high</option><option value="price-high">Rent: high to low</option></select></label>
        </div>
        {listingLoading ? <div className="empty-shelf"><div><h3>Loading marketplace...</h3></div></div> : visibleListings.length === 0 ? (
          <div className="empty-shelf"><div className="empty-icon">ITEM</div><div><h3>No listings found</h3><p>Try changing your filters, or publish a real item to the marketplace.</p></div></div>
        ) : (
          <div className="listing-grid">
            {visibleListings.map(item => <ListingCard key={item._id} item={item} account={account} agreement={agreements.find(record => record.id === Number(bookings.find(booking => booking.listingId === item._id)?.agreementId))} busy={busy} onBook={createBooking} onLogin={() => navigate('/login')} onEdit={() => { setEditingId(item._id); setListingForm({ ...emptyListing, title: item.title, category: item.category, description: item.description, imageUrl: item.imageUrl || '', pickupArea: item.pickupArea || '', contact: item.contact || '', rent: item.rent, deposit: item.deposit, days: String(item.days) }); navigate('/listings/new') }} onDeactivate={() => deactivateListing(item)} onDetails={() => setSelectedListing(item)} />)}
          </div>
        )}
        <p className="catalog-note">Listings and booking references are stored in MongoDB. Agreement state and escrow are read from RentalVault on Hardhat.</p>
      </section>}

      {page === 'listing' && <section className="publish-section" id="list-item">
        <div className="publish-copy"><p className="eyebrow">PASS IT ON</p><h2>Got something<br />to <em>share?</em></h2><p>Give your gear another life. Publish a local listing, agree on the dates, and let the vault hold the deposit.</p><div className="publish-steps"><span><b>01</b> Add your item</span><span><b>02</b> Create a booking</span><span><b>03</b> Confirm handover</span></div></div>
        <form className="listing-form" onSubmit={addListing}>
          <div className="form-title"><span>{editingId ? 'EDIT LISTING' : 'NEW LISTING'}</span><span>MongoDB marketplace</span></div>
          <label>Item name<input required maxLength="64" value={listingForm.title} onChange={event => setListingForm({ ...listingForm, title: event.target.value })} placeholder="e.g. Weekend camping kit" /></label>
          <label>Category<select value={listingForm.category} onChange={event => setListingForm({ ...listingForm, category: event.target.value })}>{categories.slice(1).map(category => <option key={category}>{category}</option>)}</select></label>
          <label>Short description<textarea required maxLength="180" value={listingForm.description} onChange={event => setListingForm({ ...listingForm, description: event.target.value })} placeholder="What should a borrower know?" rows="3" /></label>
          <label>Item photo URL (HTTPS)<input type="url" maxLength="500" value={listingForm.imageUrl} onChange={event => setListingForm({ ...listingForm, imageUrl: event.target.value })} placeholder="Optional: link to your item photo" /></label>
          <label>Pickup area<input required maxLength="100" value={listingForm.pickupArea} onChange={event => setListingForm({ ...listingForm, pickupArea: event.target.value })} placeholder="e.g. Indiranagar, Bengaluru" /></label>
          <label>Contact (phone or email)<input required maxLength="120" value={listingForm.contact} onChange={event => setListingForm({ ...listingForm, contact: event.target.value })} placeholder="How can renters reach you?" /></label>
          <div className="form-row"><label>Rent (ETH)<input type="number" required min="0.000000000000000001" step="any" value={listingForm.rent} onChange={event => setListingForm({ ...listingForm, rent: event.target.value })} placeholder="0.05" /></label><label>Deposit (ETH)<input type="number" required min="0.000000000000000001" step="any" value={listingForm.deposit} onChange={event => setListingForm({ ...listingForm, deposit: event.target.value })} placeholder="0.1" /></label></div>
          <label>Rental duration in days<input type="number" required min="1" max="30" value={listingForm.days} onChange={event => setListingForm({ ...listingForm, days: event.target.value })} /></label>
          <button className="dark-button full-button" type="submit">{editingId ? 'Save listing changes' : 'Publish listing'} <span>↗</span></button>
          {editingId && <button className="outline-button full-button" type="button" onClick={() => { setEditingId(''); setListingForm(emptyListing) }}>Stop editing</button>}
        </form>
      </section>}

      {page === 'bookings' && <section className="booking-section" id="bookings">
        <div className="section-heading compact-heading"><div><p className="eyebrow">YOUR RENTALS</p><h2>Bookings &amp; <em>escrow</em></h2></div><button className="refresh-button" disabled={busy} onClick={async () => { await Promise.all([refresh(), loadBookings(), loadBookingRequests(), loadListings()]) }}>↻ Refresh everything</button></div>
        <div className="account-summary">
          <div><span>Connected wallet</span><strong>{account ? shortAddress(account) : 'Connect MetaMask'}</strong></div>
          <div><span>Withdrawable credit</span><strong>{formatEther(credit)} ETH</strong></div>
          <button className="dark-button" disabled={!account || credit === 0n || busy} onClick={withdrawCredit}>Withdraw credit</button>
        </div>
        <div className="dashboard-switch" role="tablist" aria-label="Booking dashboard view">{['all', 'owner', 'renter'].map(role => <button key={role} role="tab" aria-selected={dashboardRole === role} className={dashboardRole === role ? 'selected' : ''} onClick={() => setDashboardRole(role)}>{role === 'all' ? 'All agreements' : role === 'owner' ? 'Owner dashboard' : 'Renter dashboard'}</button>)}</div>
        {!address && <div className="setup-callout"><strong>Local contract not deployed yet.</strong><span>Run the contract node, then deploy RentalVault from the contracts workspace. The deployment command writes the address for this app.</span></div>}
        <section className="requests-section">
          <div className="requests-heading"><div><p className="eyebrow">INBOX</p><h3>Booking requests</h3></div><span>{visibleBookingRequests.filter(request => request.status === 'pending' && request.owner.toLowerCase() === account.toLowerCase()).length} waiting</span></div>
          {!account ? <div className="empty-bookings"><p>Connect your wallet to view requests.</p><span>Requests sent to you and requests you’ve made appear here.</span></div> : visibleBookingRequests.length === 0 ? <div className="empty-bookings"><p>No requests in this view.</p><span>Switch to All agreements to see requests as a renter and owner.</span></div> : <div className="request-list">{visibleBookingRequests.map(request => <BookingRequestCard key={request._id} request={request} account={account} busy={busy} onCreateAgreement={() => createBooking({ _id: request.listingId, title: request.listingTitle, rent: request.rent, deposit: request.deposit, days: request.days }, request.renter)} onReject={() => rejectBookingRequest(request)} />)}</div>}
        </section>
        {visibleAgreements.length === 0 ? <div className="empty-bookings"><p>No on-chain bookings found yet.</p><span>Owner-created agreements appear here after a renter request is approved.</span></div> : <div className="agreement-list">{visibleAgreements.map(item => {
          const booking = bookings.find(record => String(record.agreementId) === String(item.id))
          const listing = listings.find(record => record._id === booking?.listingId)
          return <AgreementCard key={item.id} agreement={item} itemTitle={listing?.title || booking?.listingTitle} itemCategory={listing?.category} account={account} arbitrators={arbitrators} clock={clock} busy={busy} onAction={transact} refresh={refresh} />
        })}</div>}
      </section>}

      {page === 'login' && <section className="login-page">
        <div className="login-card">
          <p className="eyebrow">YOUR WALLET IS YOUR SIGN IN</p>
          <h1>Welcome to<br /><em>Rently.</em></h1>
          <p>Connect MetaMask to publish listings, create rental agreements, and manage your bookings. Rently does not create a separate email and password account.</p>
          <button className="dark-button full-button" disabled={walletConnecting} onClick={async () => { if (await connectWallet()) navigate('/marketplace') }}>{walletConnecting ? 'Connecting…' : 'Connect MetaMask'}</button>
          <a href="/marketplace" onClick={event => { event.preventDefault(); navigate('/marketplace') }}>Continue exploring without connecting</a>
        </div>
        <div className="login-side"><span>LOCAL ETH · HARDHAT</span><p>Each action is signed by the wallet you choose.</p></div>
      </section>}

      {selectedListing && <ListingDetailsModal item={selectedListing} account={account} busy={busy} existingRequest={bookingRequests.find(request => request.listingId === selectedListing._id && request.renter.toLowerCase() === account.toLowerCase())} onBook={createBooking} onRequestBooking={requestBooking} onLogin={() => navigate('/login')} onClose={() => setSelectedListing(null)} />}

      {page === 'privacy' && <section className="privacy-section"><p className="eyebrow">RENTLY · PRIVACY</p><h1>Privacy policy</h1><p>Rently is a local prototype. Marketplace listings and booking references are stored by the project API. Wallet addresses and agreement activity are public on the local blockchain used for this demonstration.</p><p>This prototype does not offer user accounts, collect email addresses, or provide a production privacy service. Do not enter sensitive personal information into listing descriptions.</p><p>For this local demo, application data is handled by the MongoDB database configured by the operator. Removing that database may remove marketplace and booking metadata; blockchain records on the local chain follow that chain’s lifecycle.</p></section>}
      <SiteFooter onNavigate={navigate} />
    </main>
  )
}

function ListingCard({ item, account, agreement, busy, onBook, onLogin, onEdit, onDeactivate, onDetails }) {
  const [renterAddress, setRenterAddress] = useState('')
  const [showBooking, setShowBooking] = useState(false)
  const isOwner = account && item.owner.toLowerCase() === account.toLowerCase()
  return <article className="listing-card" tabIndex="0" aria-label={`View details for ${item.title}`} onClick={onDetails} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onDetails() } }}>
    <div className={`listing-art art-${item.category.toLowerCase()}`}>
      {item.imageUrl && <img className="listing-photo" src={item.imageUrl} alt={`Photo of ${item.title}`} loading="lazy" onError={event => event.currentTarget.classList.add('image-unavailable')} />}
      {!item.imageUrl && <span className="listing-art-fallback" aria-hidden="true">{item.category}</span>}
      <span className="listing-category">{item.category}</span>
      {item.imageUrl && <span className="listing-art-name">{item.title}</span>}
    </div>
    <div className="listing-info" onClick={event => { if (event.target.closest('button, a, form, input')) event.stopPropagation() }}>
      <h3 className="listing-title">{item.title}</h3>
      <p className="listing-description">{item.description}</p>
      <div className="listing-meta"><span>Owner <b>{shortAddress(item.owner)}</b></span><span>{item.days} days</span></div>
      <div className="price-row"><span><strong>{item.rent}</strong> ETH <small>/ rental</small></span><span className="deposit-price">{item.deposit} ETH <small>deposit</small></span></div>
      <button className="outline-button full-button" onClick={onDetails}>View details</button>
      {isOwner && <><button className="outline-button full-button" disabled={busy} onClick={onEdit}>Edit listing</button><button className="outline-button full-button" disabled={busy} onClick={onDeactivate}>Deactivate listing</button></>}
      {agreement && Number(agreement.state) <= 5 ? <p className="listing-hint">Agreement #{agreement.id} is in progress.</p> : isOwner ? <button className="outline-button full-button" disabled={busy} onClick={() => setShowBooking(value => !value)}>{showBooking ? 'Close booking' : 'Create booking'}</button> : !account ? <button className="dark-button full-button" onClick={onLogin}>Connect to book</button> : <button className="dark-button full-button" onClick={onDetails}>Request to book</button>}
      {showBooking && <form className="booking-create" onSubmit={event => { event.preventDefault(); onBook(item, renterAddress); setShowBooking(false) }}><label>Renter wallet address<input required pattern="0x[a-fA-F0-9]{40}" value={renterAddress} onChange={event => setRenterAddress(event.target.value)} placeholder="0x..." /></label><button className="dark-button full-button" disabled={busy}>Create on-chain agreement</button></form>}
    </div>
  </article>
}

function ListingDetailsModal({ item, account, busy, existingRequest, onBook, onRequestBooking, onLogin, onClose }) {
  const [renterAddress, setRenterAddress] = useState('')
  const [message, setMessage] = useState('Hi, I’d like to rent this item. Please let me know if it’s available.')
  const isOwner = account && item.owner.toLowerCase() === account.toLowerCase()
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="details-modal" role="dialog" aria-modal="true" aria-label={`${item.title} details`} onClick={event => event.stopPropagation()}>
      <button className="modal-close" aria-label="Close details" onClick={onClose}>×</button>
      {item.imageUrl && <img className="details-photo" src={item.imageUrl} alt={`Photo of ${item.title}`} />}
      <p className="eyebrow">{item.category} · AVAILABLE TO RENT</p>
      <h2>{item.title}</h2>
      <p>{item.description}</p>
      <dl>
        <div><dt>Owner</dt><dd>{shortAddress(item.owner)}</dd></div>
        <div><dt>Pickup area</dt><dd>{item.pickupArea || 'Arrange with the owner'}</dd></div>
        <div><dt>Rental duration</dt><dd>{item.days} days</dd></div>
        <div><dt>Rent</dt><dd>{item.rent} ETH</dd></div>
        <div><dt>Refundable deposit</dt><dd>{item.deposit} ETH</dd></div>
      </dl>
      {isOwner ? <form className="booking-create details-booking" onSubmit={event => { event.preventDefault(); onBook(item, renterAddress); onClose() }}>
        <p className="details-note">Create an agreement for the renter. They’ll fund the rent and deposit from their wallet.</p>
        <label>Renter wallet address<input required pattern="0x[a-fA-F0-9]{40}" value={renterAddress} onChange={event => setRenterAddress(event.target.value)} placeholder="0x..." /></label>
        <button className="dark-button full-button" disabled={busy}>Create rental booking</button>
      </form> : !account ? <button className="dark-button full-button" onClick={onLogin}>Connect wallet to request</button> : existingRequest && existingRequest.status !== 'rejected' ? <div className="request-confirmation"><span>{existingRequest.status === 'booked' ? 'Agreement created' : 'Request sent'}</span><p>{existingRequest.status === 'booked' ? 'The owner has created an agreement. Open My bookings to see its status.' : 'The owner has your request. Open My bookings to check for updates.'}</p></div> : <form className="booking-create details-booking" onSubmit={async event => { event.preventDefault(); if (await onRequestBooking(item, message)) onClose() }}>
        <label>Message to the owner<textarea required minLength="8" maxLength="500" value={message} onChange={event => setMessage(event.target.value)} rows="3" /></label>
        <button className="dark-button full-button" disabled={busy}>{busy ? 'Sending request…' : 'Send booking request'}</button>
        <p className="details-note">Your signed request appears in My bookings. The owner can review it and create the on-chain agreement.</p>
      </form>}
    </section>
  </div>
}

function BookingRequestCard({ request, account, busy, onCreateAgreement, onReject }) {
  const isOwner = account?.toLowerCase() === request.owner?.toLowerCase()
  const date = new Date(request.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return <article className="request-card">
    <div className="request-card-top"><div><span className="request-status">{request.status === 'booked' ? 'AGREEMENT CREATED' : request.status === 'rejected' ? 'DECLINED' : 'PENDING REQUEST'}</span><h4>{request.listingTitle}</h4></div><time>{date}</time></div>
    <p className="request-message">“{request.message}”</p>
    <div className="request-meta"><span>{isOwner ? 'From' : 'To'} <b>{shortAddress(isOwner ? request.renter : request.owner)}</b></span><span>{request.rent} ETH · {request.days} days</span><span>{request.deposit} ETH deposit</span></div>
    {isOwner && request.status === 'pending' && <button className="dark-button" disabled={busy} onClick={onCreateAgreement}>Create rental agreement</button>}
    {isOwner && request.status === 'pending' && <button className="outline-button request-reject" disabled={busy} onClick={onReject}>Decline request</button>}
    {!isOwner && request.status === 'pending' && <p className="request-footnote">Waiting for the owner to review your request.</p>}
    {!isOwner && request.status === 'rejected' && <p className="request-footnote">The owner declined this request. No agreement or payment was created.</p>}
  </article>
}

function AgreementCard({ agreement: a, itemTitle, itemCategory, account, arbitrators, clock, busy, onAction, refresh }) {
  const [deduction, setDeduction] = useState('0')
  const [ownerShare, setOwnerShare] = useState('0')
  const [evidenceHash, setEvidenceHash] = useState('')
  const owner = account && a.owner.toLowerCase() === account.toLowerCase()
  const renter = account && a.renter.toLowerCase() === account.toLowerCase()
  const arb = account && arbitrators.some(value => value?.toLowerCase() === account.toLowerCase())
  const role = owner ? 'Owner' : renter ? 'Renter' : arb ? 'Arbitrator' : 'Participant'
  const status = stateNames[Number(a.state)] || 'Unknown'
  const financialNote = Number(a.state) === 0
    ? 'Funding is started by the renter only. Rent and deposit go into the vault; neither is paid to the owner at funding.'
    : [1, 2].includes(Number(a.state))
      ? 'Both parties must confirm handover. The rent becomes owner credit only after the second confirmation; the deposit stays locked.'
      : [3, 4].includes(Number(a.state))
        ? 'The owner can withdraw credited rent. The deposit remains locked until the agreed return settlement.'
        : 'Arbitration can allocate only the escrow still held by the contract; rent already credited is separate.'
  const handoverReady = clock >= Number(a.handoverNotBefore)
  const send = async (callback, message, expectedSender) => { await onAction(callback, message, expectedSender); await refresh() }
  const inputEvidence = async () => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(evidenceHash)) return window.alert('Enter a 32-byte evidence reference hash (0x followed by 64 hex characters).')
    await send(vault => vault.openDispute(a.id, evidenceHash), 'Dispute opened. Funds remain locked for resolution.')
  }
  const escrow = BigInt(a.escrowRemaining)
  const showDispute = [1, 2, 3, 4].includes(Number(a.state))
  return <article className="agreement-card">
    <div className="agreement-top"><div><span className="agreement-label">AGREEMENT #{a.id}</span><span className={`status-badge status-${Number(a.state)}`}>{status}</span></div><span className="role-label">Viewing as {role}</span></div>
    <div className="agreement-item"><span>{itemCategory || 'RENTAL ITEM'}</span><strong>{itemTitle || `Rental agreement #${a.id}`}</strong></div>
    <div className="agreement-parties"><span>Owner <b>{shortAddress(a.owner)}</b></span><span>Renter <b>{shortAddress(a.renter)}</b></span></div>
    <div className="agreement-money"><div><span>Agreed rent</span><strong>{formatEther(a.rent)} ETH</strong></div><div><span>Original deposit</span><strong>{formatEther(a.deposit)} ETH</strong></div><div><span>Still escrowed</span><strong>{formatEther(a.escrowRemaining)} ETH</strong></div></div>
    {Number(a.state) >= 3 && Number(a.state) <= 5 && <div className="deadline-row"><span>Rental started <b>{dateLabel(a.handoverAt)}</b></span><span>Return deadline <b>{dateLabel(a.returnDeadline)}</b></span></div>}
    <div className="agreement-actions">
      {Number(a.state) === 0 && (owner || renter) && <button className="outline-button" disabled={busy} onClick={() => send(vault => vault.cancelBeforeFunding(a.id), 'Unfunded agreement cancelled.')}>Cancel agreement</button>}
      {Number(a.state) === 0 && renter && <button className="dark-button" disabled={busy} onClick={() => send(vault => vault.fund(a.id, { value: a.rent + a.deposit }), 'Rent and deposit funded into escrow.', a.renter)}>Fund {formatEther(a.rent + a.deposit)} ETH as renter</button>}
      {[1, 2].includes(Number(a.state)) && (owner || renter) && <>
        {!a.ownerHandoverConfirmed && owner && <button className="dark-button" disabled={busy || !handoverReady} onClick={() => send(vault => vault.confirmHandover(a.id), 'Owner confirmed handover.')}>{handoverReady ? 'Confirm handover' : `Handover opens ${dateLabel(a.handoverNotBefore)}`}</button>}
        {!a.renterHandoverConfirmed && renter && <button className="dark-button" disabled={busy || !handoverReady} onClick={() => send(vault => vault.confirmHandover(a.id), 'Renter confirmed handover.')}>{handoverReady ? 'Confirm handover' : `Handover opens ${dateLabel(a.handoverNotBefore)}`}</button>}
        {!a.ownerHandoverConfirmed && !a.renterHandoverConfirmed && <button className="outline-button" disabled={busy} onClick={() => send(vault => vault.consentToFundedCancellation(a.id), 'Cancellation consent recorded.')}>Agree to full refund</button>}
        <button className="outline-button" disabled={busy} onClick={() => send(vault => vault.consentToFundedCancellation(a.id), 'Cancellation consent recorded.')}>Consent to cancel</button>
      </>}
      {[3, 4].includes(Number(a.state)) && renter && !a.renterReturnConfirmed && <button className="dark-button" disabled={busy} onClick={() => send(vault => vault.confirmReturn(a.id), 'Renter confirmed the item return.')}>Confirm return</button>}
      {[3, 4].includes(Number(a.state)) && owner && !a.ownerReturnConfirmed && <div className="inline-action"><label>Deposit deduction (ETH)<input type="number" min="0" step="any" max={formatEther(a.deposit)} value={deduction} onChange={event => setDeduction(event.target.value)} /></label><button className="dark-button" disabled={busy} onClick={() => send(vault => vault.confirmReturnAndProposeDeduction(a.id, parseEther(deduction || '0')), 'Owner confirmed return and proposed the deduction.')}>Confirm return</button></div>}
      {Number(a.state) === 4 && renter && a.ownerReturnConfirmed && a.renterReturnConfirmed && !a.renterAcceptedDeduction && <button className="dark-button" disabled={busy} onClick={() => send(vault => vault.acceptDeduction(a.id, a.proposedDeduction), `Accepted exact deduction of ${formatEther(a.proposedDeduction)} ETH.`)}>Accept {formatEther(a.proposedDeduction)} ETH deduction</button>}
      {showDispute && (owner || renter) && <div className="inline-action dispute-action"><label>Evidence reference hash<input value={evidenceHash} onChange={event => setEvidenceHash(event.target.value)} placeholder="0x + 64 hex characters" /></label><button className="outline-button" disabled={busy} onClick={() => inputEvidence()}>Open dispute</button></div>}
      {Number(a.state) === 5 && arb && <div className="inline-action"><label>Owner share (ETH)<input type="number" min="0" step="any" value={ownerShare} onChange={event => setOwnerShare(event.target.value)} /></label><button className="dark-button" disabled={busy} onClick={() => send(vault => { const amount = parseEther(ownerShare || '0'); return vault.arbitrate(a.id, amount, escrow - amount) }, 'Arbitrator resolved the remaining escrow.')}>Allocate escrow</button></div>}
    </div>
    <div className="agreement-deadlines"><span>Funding deadline {dateLabel(a.fundingDeadline)}</span><span>Handover opens {dateLabel(a.handoverNotBefore)}</span><span>Handover window ends {dateLabel(a.handoverDeadline)}</span></div>
    <p className="accounting-note">{financialNote}</p>
  </article>
}

export default App
