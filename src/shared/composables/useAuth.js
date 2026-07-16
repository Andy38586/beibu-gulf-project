/**
 * @typedef {import('@/types/auth').User} User
 * @typedef {import('@/types/auth').AuthResponse} AuthResponse
 */

import { ref } from 'vue'
import { useApiRequest } from './useApiRequest'

/** @type {import('vue').Ref<User | null>} */
const user = ref(null)

export function useAuth() {
  const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

  async function login(username, password) {
    /** @type {AuthResponse} */
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setToken(data.token)
    user.value = data.user
    return data.user
  }

  async function register(username, password) {
    /** @type {AuthResponse} */
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setToken(data.token)
    user.value = data.user
    return data.user
  }

  function logout() {
    clearToken()
    user.value = null
  }

  async function checkAuth() {
    if (!token.value) return null
    try {
      /** @type {{ user: User }} */
      const data = await apiRequest('/auth/me')
      user.value = data.user
      return data.user
    } catch {
      clearToken()
      user.value = null
      return null
    }
  }

  return { user, token, isAuthenticated, login, register, logout, checkAuth }
}
