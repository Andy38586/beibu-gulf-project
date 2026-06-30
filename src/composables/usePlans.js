/**
 * @typedef {import('@/types/plans').Plan} Plan
 * @typedef {import('@/types/analysis').TypeSetting} TypeSetting
 */

import { ref } from 'vue'
import { useAuth } from './useAuth'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

/**
 * 方案管理相关的 composable
 * @returns {{
 *   getPlans: () => Promise<Plan[]>,
 *   createPlan: (name: string, typeSettings: Record<string, TypeSetting>) => Promise<Plan>,
 *   updatePlan: (id: string, name: string, typeSettings: Record<string, TypeSetting>) => Promise<Plan>,
 *   deletePlan: (id: string) => Promise<null>,
 *   saving: import('vue').Ref<boolean>,
 *   updating: import('vue').Ref<boolean>
 * }}
 */
export function usePlans() {
  const { token, logout } = useAuth()
  /** @type {import('vue').Ref<boolean>} */
  const saving = ref(false)
  /** @type {import('vue').Ref<boolean>} */
  const updating = ref(false)

  /**
   * 获取认证请求头
   * @returns {{ 'Content-Type': string, Authorization: string }}
   */
  function authHeaders() {
    if (!token.value) throw new Error('未登录')
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.value}`,
    }
  }

  /**
   * 获取用户的方案列表
   * @returns {Promise<Plan[]>} - 方案列表
   */
  async function getPlans() {
    const headers = authHeaders()
    const res = await fetch(`${API_BASE}/plans`, { headers })
    if (res.status === 401) {
      logout()
      throw new Error('登录已过期')
    }
    if (!res.ok) throw new Error('获取方案列表失败')
    /** @type {Plan[]} */
    return res.json()
  }

  /**
   * 创建新方案
   * @param {string} name - 方案名称
   * @param {Record<string, TypeSetting>} typeSettings - 设施类型设置
   * @returns {Promise<Plan>} - 创建的方案
   */
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
      /** @type {Plan} */
      return res.json()
    } finally {
      saving.value = false
    }
  }

  /**
   * 删除方案
   * @param {string} id - 方案 ID
   * @returns {Promise<null>}
   */
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

  /**
   * 更新方案
   * @param {string} id - 方案 ID
   * @param {string} name - 方案名称
   * @param {Record<string, TypeSetting>} typeSettings - 设施类型设置
   * @returns {Promise<Plan>} - 更新后的方案
   */
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
      /** @type {Plan} */
      return res.json()
    } finally {
      updating.value = false
    }
  }

  return { getPlans, createPlan, updatePlan, deletePlan, saving, updating }
}
