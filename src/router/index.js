import { createRouter, createWebHistory } from 'vue-router'

import HomePage from '@/views/HomePage.vue'
import BufferPage from '@/views/BufferPage.vue'

const routes = [
  { path: '/', name: 'Home', component: HomePage },
  { path: '/buffer', name: 'Buffer', component: BufferPage },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
