import { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken, setViewAs } from '../lib/api.js'

const AuthContext = createContext(null)

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
        if (alive) setRealUser(user)
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

  function enterViewAs(target) {
    setViewAs(target.username)
    setViewUser(target)
  }
  function exitViewAs() {
    setViewAs(null)
    setViewUser(null)
  }

  const effectiveUser = viewUser || realUser

  return (
    <AuthContext.Provider
      value={{
        user: effectiveUser,
        realUser,
        loading,
        login,
        logout,
        isManager: effectiveUser?.role === 'manager',
        realIsManager: realUser?.role === 'manager',
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
