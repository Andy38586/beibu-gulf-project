/**
 * business/manifest.ts — 业务注册清单：路由 + 底部导航 + meta 一处声明。
 * 新增业务模块只需在清单追加一条并新建 `business/<name>/` 目录，无需再改 router/App.vue；
 * 静态路由（首页/个人中心）与模块自有资产（adapter/store/types/constants）不在此清单。
 * 登出重置也在此声明（App.vue 批量调用，新增模块的 store 重置无需再改 App.vue）。
 *
 * 2026-10-19 必要性审判：删 `navDisabled?` —— 5 个模块无一设置，生产仅 `App.vue` 读一次
 * （恒 `false`），属「预留模块占位」型的零生产者字段；未实现模块已由 `component: null`
 * 表达（`buildBusinessRoutes()` 跳过），导航禁用不再需要第二条通道。
 *
 * 2026-10-20 W59：懒加载由 `@/business/<mod>/<Mod>Page.vue` 深路径改走 `@/business/<mod>`
 * 模块入口（各模块 index.ts 只 export Page 组件）。此前注释称「动态 import 属构建优化，
 * 保留深路径」——那是给 barrel 自身穿透找的说法；模块入口同样是单次动态加载，
 * 没有构建层面的差别（Vite 对入口文件与内部文件一视同仁地产出 chunk）。
 */
import type { RouteRecordRaw } from 'vue-router'

import { useFloodStore, useForecastStore, useSiteSuitabilityStore } from '@/stores'

interface BusinessModule {
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
  /** 路由懒加载组件；null = 模块未实现（仅占位导航，不注册路由） */
  component: (() => Promise<unknown>) | null
  /** 登出时执行的业务状态重置（无状态模块可省略）；调用点在 App.vue 登出重置链 */
  reset?: () => void
}

/** 业务模块清单 —— 新增业务只需在此追加一条 */
export const businessModules: BusinessModule[] = [
  {
    name: 'SiteSuitability',
    path: '/site-suitability',
    engine: '2d',
    title: '选址分析',
    navLabel: '选址分析',
    navIcon: '◎',
    component: () => import('@/business/site-suitability'),
    reset: () => useSiteSuitabilityStore().reset(),
  },
  {
    name: 'DiversionAnalysis',
    path: '/diversion-analysis',
    // Cesium ③：3D 弧线可视化前提。引擎切换/导航进度环判据均由 meta.engine 派生（App.vue）
    engine: '3d',
    title: '分流分析',
    navLabel: '分流分析',
    navIcon: '≋',
    component: () => import('@/business/diversion'),
    // 页面状态为本地 ref（年份/结果），无持久 store；登出时路由保留，
    // reset 声明为 no-op 以维持"已实现模块必须声明 reset"的清单不变量（同上一条）
    reset: () => {},
  },
  {
    name: 'Forecast',
    path: '/forecast',
    engine: '2d',
    title: '预测分析',
    navLabel: '预测分析',
    navIcon: '📊',
    component: () => import('@/business/forecast'),
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
    component: () => import('@/business/flood-analysis'),
    reset: () => useFloodStore().clearState(),
  },
  {
    name: 'RouteAnalysis',
    path: '/route-analysis',
    engine: '3d',
    title: '航线分析',
    navLabel: '航线分析',
    navIcon: '🚢',
    component: () => import('@/business/route-analysis'),
    // 页面状态为本地 ref（起终点/结果），无持久 store；登出时路由保留、图层由页面清理，
    // reset 声明为 no-op 以维持"已实现模块必须声明 reset"的清单不变量（单一事实源不变量）
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
