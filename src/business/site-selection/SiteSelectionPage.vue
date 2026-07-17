<script setup>
/**
 * SiteSelectionPage - 选址分析业务页
 *
 * 布局（继承 Home Layout，替换 slot 内容）：
 * - 左上（4×4）：第一名小区雷达图
 * - 左下（4×4）：图层控制面板（接入真实功能）
 * - 右上（4×4）：设施因子选择面板（6 按钮 + 滑块 + 清空/分析）
 * - 右下（4×4）：小区名单列表
 *
 * 顶部标题 + 城市按钮 + 底部导航条固定不变。
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import SiteFactorPanel from './components/SiteFactorPanel.vue'
import SiteLayerPanel from './components/SiteLayerPanel.vue'
import RadarChart from '@/visualization/charts/RadarChart.vue'
import { useMapControls } from '@/core/map/composables/useMapControls'
import { useMapStore } from '@/stores/map'

const { flyTo, startBreathing, stopBreathing, zoomToCity, zoomToDistrict } = useMapControls()
const mapStore = useMapStore()

/** 分析结果 */
const matchedXiaoqu = ref([])
const selectedTypes = ref([])
const selectedXiaoqu = ref(null)

/** 第一名小区（雷达图默认显示） */
const topXiaoqu = computed(() => matchedXiaoqu.value[0] || null)

/** 处理分析结果 */
function handleResult(result) {
  mapStore.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = result.selectedTypes || []
  selectedXiaoqu.value = null
  mapStore.setSelectedXiaoqu(null)
  stopBreathing()
  if (matchedXiaoqu.value.length > 0) {
    zoomToDistrict()
  }
}

/** 点击小区列表项 */
function handleSelectXiaoqu(xq) {
  selectedXiaoqu.value = xq
  mapStore.setSelectedXiaoqu(xq)
  if (xq.lon && xq.lat) {
    startBreathing(xq.lon, xq.lat)
    flyTo({ lng: xq.lon, lat: xq.lat }, { height: 5000 })
  }
}

onMounted(() => {
  setTimeout(() => zoomToCity(), 300)
})

onUnmounted(() => {
  stopBreathing()
})
</script>

<template>
  <div class="site-selection-page">
    <AppLayout>
      <!-- 左侧：左上雷达图 + 左下图层控制 -->
      <template #left>
        <!-- 左上：第一名小区雷达图 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <RadarChart
            :embedded="true"
            :xiaoqu="topXiaoqu"
            :selected-types="selectedTypes"
          />
        </GcsPanel>
        <!-- 左下：图层控制面板 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <SiteLayerPanel />
        </GcsPanel>
      </template>

      <!-- 右侧：右上因子面板 + 右下小区名单 -->
      <template #right>
        <!-- 右上：设施因子选择面板 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <SiteFactorPanel @result-update="handleResult" />
        </GcsPanel>
        <!-- 右下：小区名单列表 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <div class="xiaoqu-list-panel">
            <div v-if="matchedXiaoqu.length === 0" class="empty-hint">
              请在右侧选择设施因子后点击"开始分析"
            </div>
            <ul v-else class="xiaoqu-list">
              <li
                v-for="(xq, i) in matchedXiaoqu"
                :key="xq.id"
                :class="['xiaoqu-item', { active: selectedXiaoqu?.id === xq.id }]"
                @click="handleSelectXiaoqu(xq)"
              >
                <span class="rank">{{ i + 1 }}</span>
                <span class="name">{{ xq.name }}</span>
                <span class="score">{{ xq.score }}分</span>
              </li>
            </ul>
          </div>
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.site-selection-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 小区名单面板内部样式 */
.xiaoqu-list-panel {
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
  overflow-y: auto;
}

.empty-hint {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
  text-align: center;
}

.xiaoqu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.xiaoqu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  font-size: 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
}

.xiaoqu-item:hover {
  background: #f5f7fa;
}

.xiaoqu-item.active {
  background: rgba(64, 158, 255, 0.15);
}

.rank {
  width: 24px;
  color: #999;
  font-size: 13px;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.score {
  color: #409eff;
  font-weight: 500;
  font-size: 13px;
}
</style>
