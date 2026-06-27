import { ref } from 'vue'
import { useAuth } from './useAuth'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export function usePlans() {
  const { token, logout } = useAuth()
  const saving = ref(false)
  const updating = ref(false)

  function authHeaders() {
    if (!token.value) throw new Error('未登录')
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.value}`,
    }
  }

  async function getPlans() {
    const headers = authHeaders()
    const res = await fetch(`${API_BASE}/plans`, { headers })
    if (res.status === 401) {
      logout()
      throw new Error('登录已过期')
    }
    if (!res.ok) throw new Error('获取方案列表失败')
    return res.json()
  }

  async function createPlan(name, typeSettings) {
    saving.value = true
    try {
      const headers = authHeaders()
      const selectedKeys = Object.entries(typeSettings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      const res = await fetch(`${API_BASE}/plans`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, selectedKeys, typeSettings }),
      })
      if (res.status === 401) {
        logout()
        throw new Error('登录已过期')
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '创建方案失败')
      }
      return res.json()
    } finally {
      saving.value = false
    }
  }

  async function deletePlan(id) {
    const headers = authHeaders()
    const res = await fetch(`${API_BASE}/plans/${id}`, {
      method: 'DELETE',
      headers,
    })
    if (res.status === 401) {
      logout()
      throw new Error('登录已过期')
    }
    if (res.status === 204) return null
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || '删除方案失败')
    }
    return null
  }

  async function updatePlan(id, name, typeSettings) {
    updating.value = true
    try {
      const headers = authHeaders()
      const selectedKeys = Object.entries(typeSettings)
        .filter(([, v]) => v.selected)
        .map(([k]) => k)
      const res = await fetch(`${API_BASE}/plans/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name, selectedKeys, typeSettings }),
      })
      if (res.status === 401) {
        logout()
        throw new Error('登录已过期')
      }
      if (res.status === 409) {
        const data = await res.json()
        throw new Error(data.error || '方案名称已存在')
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '更新方案失败')
      }
      return res.json()
    } finally {
      updating.value = false
    }
  }

  return { getPlans, createPlan, updatePlan, deletePlan, saving, updating }
}
