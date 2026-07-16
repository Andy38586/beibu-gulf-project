import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '@/views/HomePage.vue'
import SiteSelectionPage from '@/business/site-selection/SiteSelectionPage.vue'

const routes = [
  { path: '/', name: 'Home', component: HomePage },
  // Phase 4-B：路径从 /buffer 调整为 /site-selection
  { path: '/site-selection', name: 'SiteSelection', component: SiteSelectionPage },
  { path: '/profile', name: 'Profile', component: () => import('@/views/ProfilePage.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
