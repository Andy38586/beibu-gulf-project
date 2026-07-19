import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'

const token: Ref<string> = ref('')
const API_BASE: string = import.meta.env.VITE_API_BASE || '/api'

function loadToken(): void {
  const saved = localStorage.getItem('auth_token')
  if (saved) {
    token.value = saved
  }
}

function setToken(t: string): void {
  token.value = t
  localStorage.setItem('auth_token', t)
}

function clearToken(): void {
  token.value = ''
  localStorage.removeItem('auth_token')
}

const isAuthenticated: ComputedRef<boolean> = computed(() => token.value !== '')

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>
}

export function useApiRequest() {
  loadToken()

  // 泛型函数，支持调用方推导返回值类型
  async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (token.value !== '') {
      headers['Authorization'] = `Bearer ${token.value}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        clearToken()
        const router = (await import('@/router')).default
        if (router.currentRoute.value.path !== '/') {
          router.push('/')
        }
        throw new Error('登录已过期，请重新登录')
      }

      if (!res.ok) {
        if (res.status === 500) {
          throw new Error(data.error || '服务器错误，请稍后重试')
        }
        throw new Error(data.error || `请求失败 HTTP ${res.status}`)
      }

      return data as T
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('请求超时，请稍后重试')
        }
        if (error instanceof TypeError && error.message.includes('fetch')) {
          throw new Error('网络异常，请检查网络连接')
        }
      }
      throw error
    }
  }

  return {
    apiRequest,
    token,
    isAuthenticated,
    setToken,
    clearToken,
  }
}
