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
  // GCS阶段1：新增三维港口分析路由，复用原热力图路由路径
  {
    path: '/heatmap',
    name: 'GCSAnalysis',
    component: () => import('@/business/gcs-analysis/GCSAnalysisPage.vue'),
    meta: { engine: '3d', title: '三维港口分析' },
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

/**
 * 路由守卫：保护需要登录的路由
 * AUDIT-3.9-FIX: 改用 Cookie 检测认证状态（HttpOnly Cookie 由浏览器自动携带）
 * 不再依赖 localStorage 中的 auth_token（已迁移至 HttpOnly Cookie）
 */
router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth) {
    // 通过检查 document.cookie 无法读取 HttpOnly Cookie，
    // 改用 /api/auth/me 接口验证登录状态会导致异步复杂度增加。
    // 简化方案：检查 localStorage 中的用户信息（useAuth 持久化的 userInfo）
    const hasUser = localStorage.getItem('beibu-gulf-user')
    if (!hasUser) {
      // 未登录，跳转到首页（登录面板在首页）
      next({ name: 'Home' })
      return
    }
  }
  next()
})

export default router
