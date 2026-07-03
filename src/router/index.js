import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '@/views/HomePage.vue'

const routes = [
  { path: '/', name: 'Home', component: HomePage },
  { path: '/buffer', name: 'Buffer', component: () => import('@/views/BufferPage.vue') },
  { path: '/profile', name: 'Profile', component: () => import('@/views/ProfilePage.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router