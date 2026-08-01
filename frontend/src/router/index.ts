import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomePage.vue'),
    meta: { engine: '2d', title: '北部湾智慧港口平台' },
  },
  // Phase 4-B：路径从 /buffer 调整为 /site-selection
  {
    path: '/site-selection',
    name: 'SiteSelection',
    component: () => import('@/business/site-selection/SiteSelectionPage.vue'),
    meta: { engine: '2d', title: '选址分析' },
  },
  // 预测分析：公开数据，前端路由不要求认证（与后端 routes/forecast.js 无 authenticate 一致）
  {
    path: '/forecast',
    name: 'Forecast',
    component: () => import('@/business/forecast/ForecastPage.vue'),
    meta: { engine: '2d', title: '预测分析' },
  },
  // 浸没分析（洪涝分析）
  // 注：路由不再要求登录。收藏保存时才在 PaginatedListPanel 弹登录提示。
  {
    path: '/flood-analysis',
    name: 'FloodAnalysis',
    component: () => import('@/business/flood-analysis/FloodAnalysisPage.vue'),
    meta: { engine: '3d', title: '浸没分析' },
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/ProfilePage.vue'),
    meta: { engine: '2d', title: '个人中心' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
