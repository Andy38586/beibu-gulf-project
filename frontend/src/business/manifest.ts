/**
 * business/manifest.ts — 业务注册清单：路由 + 底部导航 + meta 一处声明。
 * 新增业务模块只需在清单追加一条并新建 `business/<name>/` 目录，无需再改 router/App.vue；
 * 静态路由（首页/个人中心）与模块自有资产（adapter/store/types/constants）不在此清单。
 * 登出重置也在此声明（App.vue 批量调用，新增模块的 store 重置无需再改 App.vue）。
 */
import type { RouteRecordRaw } from 'vue-router'

import { useFloodStore, useForecastStore, useSiteSelectionStore } from '@/stores'

export interface BusinessModule {
  /** 唯一标识（即路由 name） */
  name: string
  /** 路由路径 */
  path: string
  /** 地图引擎（路由 meta.engine,驱动 2D/3D 切换） */
  engine: '2d' | '3d'
  /** 路由标题（meta.title,页面标题/面板标题） */
  title: string
  /** 底部导航显示名 */
  navLabel: string
  /** 底部导航图标 */
  navIcon: string
  /** 导航禁用（预留模块占位,如"航线分析"未实现） */
  navDisabled?: boolean
  /** 路由懒加载组件；null = 模块未实现（仅占位导航，不注册路由） */
  component: (() => Promise<unknown>) | null
  /** 登出时执行的业务状态重置（无状态模块可省略）；调用点在 App.vue 登出重置链 */
  reset?: () => void
}

/** 业务模块清单 —— 新增业务只需在此追加一条 */
export const businessModules: BusinessModule[] = [
  {
    name: 'SiteSelection',
    path: '/site-selection',
    engine: '2d',
    title: '选址分析',
    navLabel: '选址分析',
    navIcon: '◈',
    component: () => import('@/business/site-selection/SiteSelectionPage.vue'),
    reset: () => useSiteSelectionStore().clearState(),
  },
  {
    name: 'Forecast',
    path: '/forecast',
    engine: '2d',
    title: '预测分析',
    navLabel: '预测分析',
    navIcon: '📊',
    component: () => import('@/business/forecast/ForecastPage.vue'),
    // 登出须清快照：reset() 刻意不清快照（保卸载重置链路），clearState 兜底清登出前旧会话
    reset: () => {
      useForecastStore().reset()
      useForecastStore().clearState()
    },
  },
  {
    name: 'FloodAnalysis',
    path: '/flood-analysis',
    engine: '3d',
    title: '浸没分析',
    navLabel: '浸没分析',
    navIcon: '🌊',
    component: () => import('@/business/flood-analysis/FloodAnalysisPage.vue'),
    reset: () => useFloodStore().clearState(),
  },
  {
    name: 'RouteAnalysis',
    path: '/route-analysis',
    engine: '2d',
    title: '航线分析',
    navLabel: '航线分析',
    navIcon: '🚢',
    component: () => import('@/business/route-analysis/RouteAnalysisPage.vue'),
    // 页面状态为本地 ref（起终点/结果），无持久 store；登出时路由保留、图层由页面清理，
    // reset 声明为 no-op 以维持"已实现模块必须声明 reset"的清单不变量（专项6 4.5 语义）
    reset: () => {},
  },
]

/** 由清单生成业务路由（meta.engine/title 自动带；component 为 null 的占位模块跳过） */
export function buildBusinessRoutes(): RouteRecordRaw[] {
  return businessModules
    .filter(
      (m): m is BusinessModule & { component: () => Promise<unknown> } => m.component !== null
    )
    .map(
      (m) =>
        ({
          path: m.path,
          name: m.name,
          component: m.component,
          meta: { engine: m.engine, title: m.title },
        }) as RouteRecordRaw
    )
}

/** 登出时批量执行各业务模块声明的登出重置（App.vue 登出重置链调用；新增模块只需在清单补 reset） */
export function runBusinessLogoutReset(): void {
  for (const m of businessModules) {
    m.reset?.()
  }
}
