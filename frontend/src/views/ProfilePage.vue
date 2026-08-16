<script setup lang="ts">
/**
 * ProfilePage - 个人中心（用户工作台）
 * 继承 AppLayout 布局基座：左侧吞吐量图表（自 AppLayout 下沉），
 * 右侧单个 4×8 Panel 放置登录/用户信息/收藏夹（UserInfoCard、PlansPanel 为独立子组件）。
 */
import { defineAsyncComponent, onMounted } from 'vue'

import { AppLayout, GCSPanel } from '@/core'
import { useAuth, useGCS } from '@/shared'
import { useOverviewCharts } from '@/business'
import { ChartLoading } from '@/visualization'

import PlansPanel from './components/PlansPanel.vue'
import UserInfoCard from './components/UserInfoCard.vue'
import LoginPanel from './LoginPanel.vue'

// 图表异步化：echarts 移出首屏关键路径（同首页；loader 深路径保留——见 HomePage 注释）
const LineChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/LineChart.vue'),
  loadingComponent: ChartLoading,
})
const BarChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/BarChart.vue'),
  loadingComponent: ChartLoading,
})

const { user, logout } = useAuth()
const { cellPixel } = useGCS()
const { chartData, barData, loadOverviewCharts } = useOverviewCharts()

// 与首页共用 useOverviewCharts（图表数据统一来源，无本页假数据）
onMounted(loadOverviewCharts)

/** 退出登录：复用 useAuth.logout（清 HttpOnly Cookie + localStorage + 业务 store） */
async function handleLogout() {
  await logout()
}

// 退出按钮尺寸（Cell 单位，样式自 UserInfoCard 下沉）
const logoutWidthCss = `${cellPixel.value * 3.8}px`
const logoutHeightCss = `${cellPixel.value * 0.8}px`
const logoutFontCss = `${cellPixel.value * 0.175}px`
// 内边距 0.1 Cell（与 GCS 面板边缘规格一致）
const logoutPaddingCss = `${cellPixel.value * 0.1}px`
</script>

<template>
  <div class="profile-page">
    <AppLayout>
      <!-- 左侧：吞吐量图表（自 AppLayout 下沉） -->
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <LineChart title="港口吞吐量趋势" :x-data="chartData.labels" :series="chartData.series" />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <BarChart title="港口吞吐量对比" :x-data="barData.labels" :series="barData.series" />
        </GCSPanel>
      </template>

      <!-- 右侧：单个 4×8 Panel -->
      <template #right>
        <GCSPanel :w="4" :h="8" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <div class="profile-content">
            <!-- 未登录显示登录面板，已登录显示个人中心 -->
            <LoginPanel v-if="!user" class="profile-login" />

            <!-- 已登录：用户信息 + 收藏 + 底部独立退出按钮 -->
            <div v-else class="profile-logged-in">
              <UserInfoCard />
              <PlansPanel />
              <div class="profile-logout-bar">
                <button class="profile-logout-btn" @click="handleLogout">退出登录</button>
              </div>
            </div>
          </div>
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.profile-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.profile-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  pointer-events: auto;
}

/* 未登录：登录面板占满整个 Panel */
.profile-login {
  flex: 1 1 0;
  min-height: 0;
}

/* 已登录：内部三段式（顶部头像+用户名 / 中段收藏 / 底部退出） */
.profile-logged-in {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 底部退出登录：独立下沉到最底部（内边距 0.1 Cell 与 GCS 规格一致） */
.profile-logout-bar {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  padding: v-bind(logoutPaddingCss);
}

.profile-logout-btn {
  width: v-bind(logoutWidthCss);
  height: v-bind(logoutHeightCss);
  border: 1px solid var(--GCS-color-error);
  border-radius: var(--GCS-radius-md);
  background: var(--GCS-bg-panel);
  color: var(--GCS-color-error);
  font-size: v-bind(logoutFontCss);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.profile-logout-btn:hover {
  background: var(--GCS-color-error);
  color: var(--GCS-text-inverse);
}
</style>
