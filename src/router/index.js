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

// 路由守卫：保护需要登录的路由
router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth) {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      // 未登录，跳转到首页（登录面板在首页）
      next({ name: 'Home' })
      return
    }
  }
  next()
})

export default router
