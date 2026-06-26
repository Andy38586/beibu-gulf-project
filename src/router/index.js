import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '@/views/HomePage.vue'
import BufferPage from '@/views/BufferPage.vue'
// import OverlayPage from '@/views/OverlayPage.vue'

const routes = [
  { path: '/', name: 'Home', component: HomePage },
  { path: '/buffer', name: 'Buffer', component: BufferPage },
  { path: '/overlay', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
