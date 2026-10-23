import { useState } from 'react'

function shortAddress(value = '') {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : ''
}

export function SiteHeader({ account, connecting = false, onConnect, onDisconnect, onNavigate }) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const routeLink = (event, path) => { event.preventDefault(); onNavigate(path) }
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(account)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { setCopied(false) }
  }
  return (
    <header className="nav-bar">
      <a className="brand" href="/" onClick={event => routeLink(event, '/')} aria-label="Rently home">
        <span className="brand-mark">R</span><span>Rently<span className="brand-dot">.</span></span>
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        <a href="/marketplace" onClick={event => routeLink(event, '/marketplace')}>Explore</a>
        <a href="/listings/new" onClick={event => routeLink(event, '/listings/new')}>List an item</a>
        <a href="/bookings" onClick={event => routeLink(event, '/bookings')}>My bookings</a>
      </nav>
      <div className="wallet-area">
        {account ? <div className="account-control">
          <span className="network-pill"><i /> Local ETH</span>
          <button className="wallet-button" aria-expanded={accountMenuOpen} aria-haspopup="dialog" onClick={() => setAccountMenuOpen(open => !open)}>{shortAddress(account)} <span aria-hidden="true">⌄</span></button>
          {accountMenuOpen && <div className="account-menu" role="dialog" aria-label="Wallet menu">
            <div className="account-menu-heading"><span className="account-avatar">{account.slice(2, 4).toUpperCase()}</span><span><b>Wallet connected</b><small>Rental activity is tied to this address</small></span></div>
            <button className="account-address-copy" onClick={copyAddress}><span>{shortAddress(account)}</span><span>{copied ? 'Copied' : 'Copy address'}</span></button>
            <button className="account-menu-action" onClick={() => { setAccountMenuOpen(false); onNavigate('/bookings') }}>View my bookings <span aria-hidden="true">↗</span></button>
            <button className="account-menu-disconnect" onClick={() => { setAccountMenuOpen(false); onDisconnect() }}>Disconnect wallet</button>
          </div>}
        </div> : <button className="wallet-button" disabled={connecting} onClick={onConnect}>{connecting ? 'Connecting…' : 'Connect wallet'}</button>}
      </div>
    </header>
  )
}

export function SiteFooter({ onNavigate }) {
  const routeLink = (event, path) => { event.preventDefault(); onNavigate(path) }
  return (
    <footer className="footer">
      <a className="brand" href="/" onClick={event => routeLink(event, '/')} aria-label="Rently home">
        <span className="brand-mark">R</span><span>Rently<span className="brand-dot">.</span></span>
      </a>
      <span>Built by Ayush · Local Hardhat prototype</span>
      <div className="footer-links"><span>Rent together, keep it simple.</span><a href="/privacy" onClick={event => routeLink(event, '/privacy')}>Privacy policy</a></div>
    </footer>
  )
}
