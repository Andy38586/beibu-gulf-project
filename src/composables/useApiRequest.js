import { ref, computed } from 'vue'

const token = ref('')
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

function loadToken() {
  const saved = localStorage.getItem('auth_token')
  if (saved) {
    token.value = saved
  }
}

function setToken(t) {
  token.value = t
  localStorage.setItem('auth_token', t)
}

function clearToken() {
  token.value = ''
  localStorage.removeItem('auth_token')
}

const isAuthenticated = computed(() => !!token.value)

export function useApiRequest() {
  loadToken()

  async function apiRequest(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers }
    if (token.value) {
      headers['Authorization'] = `Bearer ${token.value}`
    }
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      clearToken()
      throw new Error('登录已过期')
    }
    if (!res.ok) {
      throw new Error(data.error || `请求失败 HTTP ${res.status}`)
    }
    return data
  }

  return {
    apiRequest,
    token,
    isAuthenticated,
    setToken,
    clearToken,
  }
}
