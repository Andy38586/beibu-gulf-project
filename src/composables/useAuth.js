/**
 * @typedef {import('@/types/auth').User} User
 * @typedef {import('@/types/auth').AuthResponse} AuthResponse
 */

import { ref, computed } from 'vue'

/** @type {import('vue').Ref<User | null>} */
const user = ref(null)
/** @type {import('vue').Ref<string>} */
const token = ref('')
/** @type {import('vue').ComputedRef<boolean>} */
const isAuthenticated = computed(() => !!token.value)

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

/**
 * 从 localStorage 加载保存的 Token
 */
function loadToken() {
  const saved = localStorage.getItem('auth_token')
  if (saved) {
    token.value = saved
  }
}

/**
 * 保存 Token 到 localStorage
 * @param {string} t - Token 值
 */
function saveToken(t) {
  token.value = t
  localStorage.setItem('auth_token', t)
}

/**
 * 清除 Token 和用户信息
 */
function clearToken() {
  token.value = ''
  localStorage.removeItem('auth_token')
  user.value = null
}

/**
 * 封装 API 请求，自动添加 Authorization 头
 * @param {string} path - 请求路径
 * @param {RequestInit} [options] - 请求选项
 * @returns {Promise<any>} - 响应数据
 */
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

/**
 * 认证相关的 composable
 * @returns {{
 *   user: import('vue').Ref<User | null>,
 *   token: import('vue').Ref<string>,
 *   isAuthenticated: import('vue').ComputedRef<boolean>,
 *   login: (username: string, password: string) => Promise<User>,
 *   register: (username: string, password: string) => Promise<User>,
 *   logout: () => void,
 *   checkAuth: () => Promise<User | null>
 * }}
 */
export function useAuth() {
  loadToken()

  /**
   * 用户登录
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<User>} - 用户信息
   */
  async function login(username, password) {
    /** @type {AuthResponse} */
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    saveToken(data.token)
    user.value = data.user
    return data.user
  }

  /**
   * 用户注册
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<User>} - 用户信息
   */
  async function register(username, password) {
    /** @type {AuthResponse} */
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    saveToken(data.token)
    user.value = data.user
    return data.user
  }

  /**
   * 用户登出
   */
  function logout() {
    clearToken()
  }

  /**
   * 检查登录状态，验证 Token 有效性
   * @returns {Promise<User | null>} - 用户信息或 null
   */
  async function checkAuth() {
    if (!token.value) return null
    try {
      /** @type {{ user: User }} */
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
