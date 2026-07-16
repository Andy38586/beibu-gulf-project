import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '@/views/HomePage.vue'
import SiteSelectionPage from '@/views/SiteSelectionPage.vue'

const routes = [
  { path: '/', name: 'Home', component: HomePage },
  // Phase 4-A：BufferPage 重命名为 SiteSelectionPage，路径保持 /buffer（Phase 4-B 再调整）
  { path: '/buffer', name: 'SiteSelection', component: SiteSelectionPage },
  { path: '/profile', name: 'Profile', component: () => import('@/views/ProfilePage.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
