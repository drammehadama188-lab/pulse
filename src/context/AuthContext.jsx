import { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken, setViewAs, getViewAs } from '../lib/api.js'

const AuthContext = createContext(null)

// NOTE (12 Jun 2026): the openAdminEnabled / adminUrl state was removed here
// when Pulse was narrowed to HR-only and the Open Admin SSO bridge was cut.

export function AuthProvider({ children }) {
  const [realUser, setRealUser] = useState(null)
  const [viewUser, setViewUser] = useState(null) // "view as" target (manager only)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const { user } = await api('/me')
        if (!alive) return
        setRealUser(user)
        // Restore a persisted "view as" so a refresh leaves you where you were
        // (per-tab, manager-only). The /me call above runs as the real user
        // because _viewAs isn't re-applied until here.
        const pending = getViewAs()
        if (pending && pending !== user.username && (user.powers || []).includes('viewas')) {
          try {
            const { users } = await api('/users')
            const target = (users || []).find((u) => u.username === pending)
            if (target) { setViewAs(target.username); setViewUser(target) }
            else setViewAs(null)
          } catch { setViewAs(null) }
        }
      } catch {
        setToken(null)
      } finally {
        if (alive) setLoading(false)
      }
    }
    bootstrap()
    return () => {
      alive = false
    }
  }, [])

  async function login(username, password) {
    const { token, user } = await api('/login', {
      method: 'POST',
      body: { username, password },
    })
    setToken(token)
    setRealUser(user)
    return user
  }

  async function logout() {
    try {
      await api('/logout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    setViewAs(null)
    setViewUser(null)
    setToken(null)
    setRealUser(null)
  }

  async function refreshUser() {
    const { user } = await api('/me')
    setRealUser(user)
    return user
  }

  function enterViewAs(target) {
    setViewAs(target.username)
    setViewUser(target)
  }
  function exitViewAs() {
    setViewAs(null)
    setViewUser(null)
  }

  const effectiveUser = viewUser || realUser

  // Powers: per-person grants resolved by the server (CEO has all).
  // The EFFECTIVE user's powers drive what's visible (so view-as shows
  // exactly what they see); the REAL user's powers drive what you may DO.
  const powers = effectiveUser?.powers || []
  const realPowers = realUser?.powers || []
  const hasPower = (p) => powers.includes(p)
  const hasRealPower = (p) => realPowers.includes(p)

  return (
    <AuthContext.Provider
      value={{
        user: effectiveUser,
        realUser,
        loading,
        login,
        logout,
        refreshUser,
        powers,
        hasPower,
        hasRealPower,
        // legacy flag — "manager-ish" now means holding the Team power
        isManager: hasPower('team'),
        realIsManager: hasRealPower('team'),
        isViewAs: !!viewUser,
        enterViewAs,
        exitViewAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
