import { ref, computed } from 'vue'

const user = ref(null)
const token = ref('')
const isAuthenticated = computed(() => !!token.value)

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

function loadToken() {
  const saved = localStorage.getItem('auth_token')
  if (saved) {
    token.value = saved
  }
}

function saveToken(t) {
  token.value = t
  localStorage.setItem('auth_token', t)
}

function clearToken() {
  token.value = ''
  localStorage.removeItem('auth_token')
  user.value = null
}

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token.value) {
    headers['Authorization'] = `Bearer ${token.value}`
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

export function useAuth() {
  loadToken()

  async function login(username, password) {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    saveToken(data.token)
    user.value = data.user
    return data.user
  }

  async function register(username, password) {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    saveToken(data.token)
    user.value = data.user
    return data.user
  }

  function logout() {
    clearToken()
  }

  async function checkAuth() {
    if (!token.value) return null
    try {
      const data = await apiRequest('/auth/me')
      user.value = data.user
      return data.user
    } catch {
      clearToken()
      return null
    }
  }

  return { user, token, isAuthenticated, login, register, logout, checkAuth }
}
