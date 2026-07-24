import { createRouter, createWebHistory } from 'vue-router'

const routes = [
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
  // TODO:2.1b: 新增预测分析路由
  {
    path: '/forecast',
    name: 'Forecast',
    component: () => import('@/business/forecast/ForecastPage.vue'),
    meta: { engine: '2d', title: '预测分析' },
  },
  // Flood分析路由（原GCS分析），复用原热力图路由路径
  {
    path: '/heatmap',
    name: 'FloodAnalysis',
    component: () => import('@/business/flood-analysis/FloodAnalysisPage.vue'),
    meta: { engine: '3d', title: '浸没分析' },
  },
  // P0-001-FIX: 移除 requiresAuth，允许未登录用户访问登录面板
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

// FIX:P3-12: 删除路由守卫死代码。四条路由 meta 均无 requiresAuth（P0-001 已移除），beforeEach 永不触发。
export default router
