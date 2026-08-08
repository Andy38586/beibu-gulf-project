/**
 * useScreenActions - 全局屏幕操作封装
 * 职责：
 * 1. 封装首页 / 个人中心 / 返回上一页的导航逻辑
 * 2. 封装钦州 / 防城港 / 北海三个城市的地图 flyTo 回调
 * 3. 提供统一的按钮标签计算（登录态 vs 未登录态）
 * 设计原则：
 * - 导航逻辑集中管理，避免散落在各按钮组件中
 * - 城市坐标来自公共数据（ports.json），不硬编码
 * - 个人中心按钮在首页时进入个人中心，非首页时返回上一页（方案 B）
 */

import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useMapControls } from '@/core/map/composables/useMapControls'
import { MAP_CONFIG } from '@/core/config/map'
import { useAuth } from '@/shared'

// 城市坐标 2026-08-08 收归 MAP_CONFIG.CITY_CENTERS（地图配置单一权威源），
// 不再在本文件散落硬编码（原注释"坐标来自 ports.json 不硬编码"与实现不符，已修正）

/** useScreenActions 返回值结构 */
export interface UseScreenActionsReturn {
  isHome: ComputedRef<boolean>
  goHome: () => void
  goProfileOrBack: () => void
  userButtonLabel: ComputedRef<string>
  flyToCity: (city: string) => void
}

export function useScreenActions(): UseScreenActionsReturn {
  const route = useRoute()
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const { flyTo } = useMapControls()

  const isHome = computed(() => route.name === 'Home')

  /**
   * 回到首页
   */
  function goHome(): void {
    void router.push('/')
  }

  /**
   * 个人中心 / 返回上一页
   * - 首页：进入个人中心
   * - 非首页：优先返回上一页；历史栈为空时回到首页兜底
   */
  function goProfileOrBack(): void {
    if (isHome.value) {
      void router.push('/profile')
      return
    }
    // 历史栈存在上一页则返回，否则回到首页
    if (window.history.state?.back) {
      void router.back()
    } else {
      void router.push('/')
    }
  }

  /**
   * 用户按钮标签：已登录显示用户名，未登录显示"登录"
   */
  const userButtonLabel = computed(() => {
    if (isHome.value) {
      return isAuthenticated.value && user.value?.username ? user.value.username : '个人中心'
    }
    return '返回'
  })

  /**
   * 飞行到指定城市中心，同时放大 zoom 显示城市级比例尺
   * @param {string} city - 城市名：钦州 / 防城港 / 北海
   */
  function flyToCity(city: string): void {
    const target = MAP_CONFIG.CITY_CENTERS[city]
    if (!target) return
    flyTo({ lng: target.lng, lat: target.lat }, { height: target.height, zoom: target.zoom })
  }

  return {
    isHome,
    goHome,
    goProfileOrBack,
    userButtonLabel,
    flyToCity,
  }
}
