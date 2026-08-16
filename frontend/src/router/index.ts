import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import { buildBusinessRoutes } from '@/business'

// 业务路由由 manifest 生成（路径/name/engine/title 一处声明,新增业务只改 business/manifest.ts）
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomePage.vue'),
    meta: { engine: '2d', title: '北部湾智慧港口平台' },
  },
  ...buildBusinessRoutes(),
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
