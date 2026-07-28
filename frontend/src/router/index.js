import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/shared/composables/useAuth'

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
    meta: { engine: '2d', title: '选址分析', requiresAuth: true },
  },
  // 预测分析：公开数据，前端路由不要求认证（与后端 routes/forecast.js 无 authenticate 一致）
  {
    path: '/forecast',
    name: 'Forecast',
    component: () => import('@/business/forecast/ForecastPage.vue'),
    meta: { engine: '2d', title: '预测分析' },
  },
  // 浸没分析（原 GCS 分析）
  {
    path: '/flood-analysis',
    name: 'FloodAnalysis',
    component: () => import('@/business/flood-analysis/FloodAnalysisPage.vue'),
    meta: { engine: '3d', title: '浸没分析', requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/ProfilePage.vue'),
    meta: { engine: '2d', title: '个人中心', requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫：保护需要认证的业务页面
router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth) {
    const auth = useAuth()
    if (!auth.isAuthenticated.value) {
      // 未登录，重定向到首页并弹出登录面板
      next({ path: '/', query: { showLogin: '1' } })
      return
    }
  }
  next()
})

export default router
