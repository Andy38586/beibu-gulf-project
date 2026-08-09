<script setup lang="ts">
/**
 * ProfilePage - 个人中心（用户工作台）
 * 继承 AppLayout 布局基座：
 * - 左侧：港口吞吐量折线图 + 柱状图（c023 从 AppLayout 下沉到本页）
 * - 右侧：单个 4×8 Panel，放置 LoginPanel + 用户信息 + 收藏夹
 *
 * P1-10 拆分：用户信息（UserInfoCard）与收藏方案管理（PlansPanel）已下沉为
 * 独立子组件，本页只负责布局与图表展示。
 */
import { defineAsyncComponent, onMounted } from 'vue'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useAuth, useOverviewCharts } from '@/shared'
import ChartLoading from '@/visualization/charts/ChartLoading.vue'

import PlansPanel from './components/PlansPanel.vue'
import UserInfoCard from './components/UserInfoCard.vue'
import LoginPanel from './LoginPanel.vue'

// 2026-08-09：图表组件异步化（同首页，echarts 移出首屏关键路径）
const LineChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/LineChart.vue'),
  loadingComponent: ChartLoading,
})
const BarChart = defineAsyncComponent({
  loader: () => import('@/visualization/charts/BarChart.vue'),
  loadingComponent: ChartLoading,
})

const { user } = useAuth()
const { chartData, barData, loadOverviewCharts } = useOverviewCharts()

// 2026-08-09（P0-3）：与首页共用 useOverviewCharts，去掉本页硬编码假数据
onMounted(loadOverviewCharts)
</script>

<template>
  <div class="profile-page">
    <AppLayout>
      <!-- 左侧：折线图 + 柱状图（c023 从 AppLayout 下沉到本页） -->
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
            <!-- c013: 两张屏 v-if 互换——未登录显示登录面板，已登录显示个人中心 -->
            <LoginPanel v-if="!user" class="profile-login" />

            <!-- 个人中心（仅登录后显示）：用户信息 + 收藏抽屉 -->
            <div v-else class="profile-logged-in">
              <UserInfoCard />
              <PlansPanel />
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

/* 已登录：内部三段式（顶部头像+用户名 / 中段抽屉收藏 / 底部退出，由子组件各自承担） */
.profile-logged-in {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
