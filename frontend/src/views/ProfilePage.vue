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
import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useAuth } from '@/shared'
import BarChart from '@/visualization/charts/BarChart.vue'
import LineChart from '@/visualization/charts/LineChart.vue'

import PlansPanel from './components/PlansPanel.vue'
import UserInfoCard from './components/UserInfoCard.vue'
import LoginPanel from './LoginPanel.vue'

const { user } = useAuth()

/**
 * 折线图数据（c023 从 AppLayout 下沉到本页）
 */
const chartData = {
  labels: ['2019', '2020', '2021', '2022', '2023', '2024'],
  series: [
    { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
    { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
    { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
  ],
}

/**
 * 柱状图数据（c023 从 AppLayout 下沉到本页）
 */
const barData = {
  labels: ['钦州港', '北海港', '防城港'],
  series: [
    { name: '2023年', data: [190, 140, 150] },
    { name: '2024年', data: [230, 180, 170] },
  ],
}
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
