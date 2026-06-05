import { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken, setViewAs } from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [realUser, setRealUser] = useState(null)
  const [viewUser, setViewUser] = useState(null) // "view as" target (manager only)
  const [loading, setLoading] = useState(true)
  const [openAdminEnabled, setOpenAdminEnabled] = useState(false)
  const [adminUrl, setAdminUrl] = useState(null)

  useEffect(() => {
    let alive = true
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const { user, openAdminEnabled: oa, adminUrl: au } = await api('/me')
        if (alive) {
          setRealUser(user)
          setOpenAdminEnabled(!!oa)
          setAdminUrl(au || null)
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
    const { token, user, openAdminEnabled: oa, adminUrl: au } = await api('/login', {
      method: 'POST',
      body: { username, password },
    })
    setToken(token)
    setRealUser(user)
    setOpenAdminEnabled(!!oa)
    setAdminUrl(au || null)
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
        openAdminEnabled,
        adminUrl,
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
