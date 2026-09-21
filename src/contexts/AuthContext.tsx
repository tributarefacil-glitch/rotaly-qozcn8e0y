import React, { createContext, useContext, useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import type { UserRecord, UserRole } from '@/types/delivery'

interface AuthContextType {
  user: UserRecord | null
  token: string | null
  role: UserRole
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, pass: string) => Promise<UserRecord>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserRecord | null>(
    (pb.authStore.record as unknown as UserRecord) || null,
  )
  const [token, setToken] = useState<string | null>(pb.authStore.token || null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Sync PocketBase authStore state
    const unsubscribe = pb.authStore.onChange((newToken, newModel) => {
      setToken(newToken)
      setUser((newModel as unknown as UserRecord) || null)
    })

    // Validate token on mount
    if (pb.authStore.isValid) {
      pb.collection('users')
        .authRefresh({ requestKey: null })
        .then((res) => {
          setUser(res.record as unknown as UserRecord)
        })
        .catch((err) => {
          console.warn('[AuthContext] authRefresh falhou:', err)
          pb.authStore.clear()
          setUser(null)
          setToken(null)
          if (typeof window !== 'undefined') {
            localStorage.removeItem('rotaly_active_empresa_id')
            localStorage.removeItem('rotaly_active_company')
            localStorage.removeItem('rotaly_empresa_id')
          }
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      setIsLoading(false)
    }
    return () => {
      unsubscribe()
    }
  }, [])

  const login = async (email: string, pass: string) => {
    const cleanEmail = email.trim().toLowerCase()
    // Limpar contexto residual anterior antes de inicializar a sessão do novo usuário
    if (typeof window !== 'undefined') {
      localStorage.removeItem('rotaly_active_empresa_id')
      localStorage.removeItem('rotaly_active_company')
      localStorage.removeItem('rotaly_empresa_id')
    }
    const authData = await pb
      .collection('users')
      .authWithPassword(cleanEmail, pass, { requestKey: null })
    const authUser = authData.record as unknown as UserRecord
    setUser(authUser)
    setToken(authData.token)
    return authUser
  }

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
    setToken(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('rotaly_active_empresa_id')
      localStorage.removeItem('rotaly_active_company')
      localStorage.removeItem('rotaly_empresa_id')
    }
  }

  const refreshUser = async () => {
    if (pb.authStore.isValid) {
      try {
        const res = await pb.collection('users').authRefresh({ requestKey: null })
        setUser(res.record as unknown as UserRecord)
      } catch (err) {
        console.error('Error refreshing user:', err)
      }
    }
  }

  const role: UserRole = user?.role || 'seller'
  const isAuthenticated = !!user && pb.authStore.isValid

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        role,
        isAuthenticated,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
