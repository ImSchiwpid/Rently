import { useState } from 'react'

function shortAddress(value = '') {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : ''
}

export function SiteHeader({
  account,
  walletNeedsConfirmation = false,
  wrongNetwork = false,
  connecting = false,
  onConnect,
  onDisconnect,
  onNavigate,
  authUser,
  onOpenAuth,
  onLogout,
}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const routeLink = (event, path) => {
    event.preventDefault()
    onNavigate(path)
  }

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(account)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <header className="nav-bar">
      <div className="nav-left">
        <a className="brand" href="/" onClick={event => routeLink(event, '/')} aria-label="Rently home">
          <span className="brand-mark">R</span>
          <span className="brand-name">Rently<span className="brand-dot">.</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="/marketplace" onClick={event => routeLink(event, '/marketplace')}>Explore</a>
          <a href="/listings/new" onClick={event => routeLink(event, '/listings/new')}>List an item</a>
          <a href="/bookings" onClick={event => routeLink(event, '/bookings')}>My bookings</a>
        </nav>
      </div>

      <div className="nav-right">
        {/* User Account Authentication Actions */}
        <div className="auth-nav-area">
          {authUser ? (
            <div className="auth-user-badge">
              <span className="user-avatar" title={authUser.email}>{authUser.name.slice(0, 1).toUpperCase()}</span>
              <span className="user-name">{authUser.name}</span>
              <button className="auth-logout-btn" onClick={onLogout} title="Log out">Log out</button>
            </div>
          ) : (
            <div className="auth-guest-actions">
              <button className="auth-text-btn" onClick={() => onOpenAuth('login')}>Log in</button>
              <button className="auth-pill-btn" onClick={() => onOpenAuth('register')}>Sign up</button>
            </div>
          )}
        </div>

        {/* MetaMask Wallet Connection */}
        <div className="wallet-area">
          {account && !walletNeedsConfirmation ? (
            <div className="account-control">
              <span className={`network-pill${wrongNetwork ? ' network-pill-warning' : ''}`}>
                <i /> {wrongNetwork ? 'Wrong network' : 'Hardhat Local'}
              </span>
              <button
                className="wallet-button"
                aria-expanded={accountMenuOpen}
                aria-haspopup="dialog"
                onClick={() => setAccountMenuOpen(open => !open)}
              >
                <span>{shortAddress(account)}</span>
                <span className="caret-arrow" aria-hidden="true">⌄</span>
              </button>

              {accountMenuOpen && (
                <div className="account-menu" role="dialog" aria-label="Wallet menu">
                  <div className="account-menu-heading">
                    <span className="account-avatar">{account.slice(2, 4).toUpperCase()}</span>
                    <div>
                      <b>Wallet Connected</b>
                      <small>Contract actions use this address</small>
                    </div>
                  </div>
                  <button className="account-address-copy" onClick={copyAddress} title="Click to copy full address">
                    <span>{shortAddress(account)}</span>
                    <span className="copy-label">{copied ? 'Copied ✓' : 'Copy address'}</span>
                  </button>
                  <button
                    className="account-menu-action"
                    onClick={() => {
                      setAccountMenuOpen(false)
                      onNavigate('/bookings')
                    }}
                  >
                    <span>View my bookings</span>
                    <span aria-hidden="true">↗</span>
                  </button>
                  <button
                    className="account-menu-disconnect"
                    onClick={() => {
                      setAccountMenuOpen(false)
                      onDisconnect()
                    }}
                  >
                    Disconnect wallet
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="wallet-button" disabled={connecting} onClick={onConnect}>
              {connecting ? 'Connecting…' : account ? `Use ${shortAddress(account)}` : 'Connect wallet'}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export function SiteFooter({ onNavigate }) {
  const routeLink = (event, path) => {
    event.preventDefault()
    onNavigate(path)
  }

  return (
    <footer className="footer">
      <div className="footer-top">
        <a className="brand" href="/" onClick={event => routeLink(event, '/')} aria-label="Rently home">
          <span className="brand-mark">R</span>
          <span className="brand-name">Rently<span className="brand-dot">.</span></span>
        </a>
        <p className="footer-tagline">Peer-to-peer rental marketplace with smart-contract escrow.</p>
      </div>

      <div className="footer-bottom">
        <span>Student prototype · Built for October 23, 2026 demonstration</span>
        <div className="footer-links">
          <a href="/marketplace" onClick={event => routeLink(event, '/marketplace')}>Explore marketplace</a>
          <a href="/listings/new" onClick={event => routeLink(event, '/listings/new')}>List an item</a>
          <a href="/bookings" onClick={event => routeLink(event, '/bookings')}>My bookings</a>
          <a href="/privacy" onClick={event => routeLink(event, '/privacy')}>Privacy policy</a>
        </div>
      </div>
    </footer>
  )
}
