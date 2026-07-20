<script setup>
/**
 * GCSAnalysisPage - 三维港口分析页面
 *
 * 职责：
 * 1. 继承Home Layout（AppLayout）
 * 2. 使用Cesium引擎（由App.vue根据route.meta.engine='3d'自动切换）
 * 3. 为4个业务模块提供面板容器
 * 4. 管理GCS状态生命周期
 *
 * 布局结构：
 * - 左上（4×2）：水位模拟面板（阶段2实现）
 * - 左下（4×2）：淹没分析面板（阶段4实现）
 * - 右上（4×2）：剖面分析面板（阶段3实现）
 * - 右下（4×2）：港口影响面板（阶段5实现）
 *
 * 架构说明：
 * - UnifiedMap已在App.vue根级别挂载，无需重复引入
 * - 引擎切换由App.vue监听route.meta.engine自动处理
 * - Cesium实例由CesiumViewerManager单例缓存，离开路由不销毁
 * - AppLayout提供布局基座，业务路由仅替换slot内容
 */

import { onUnmounted } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import { useGcsStore } from '@/stores/gcsStore'

const gcsStore = useGcsStore()

/**
 * 组件卸载时重置GCS状态
 * 确保离开三维分析页面后清理所有分析数据
 */
onUnmounted(() => {
  gcsStore.resetAll()
})
</script>

<template>
  <div class="gcs-analysis-page">
    <!-- 继承Home Layout，仅替换左右slot内容 -->
    <AppLayout>
      <!-- 左侧面板组 -->
      <template #left>
        <!-- 左上：水位模拟面板（4×2，阶段2实现） -->
        <GcsPanel :w="4" :h="2" anchor="top-left" :offset-x="0" :offset-y="0">
          <div class="panel-placeholder">
            <div class="placeholder-title">水位动态模拟</div>
            <div class="placeholder-desc">阶段2实现</div>
          </div>
        </GcsPanel>

        <!-- 左下：淹没分析面板（4×2，阶段4实现） -->
        <GcsPanel :w="4" :h="2" anchor="top-left" :offset-x="0" :offset-y="2.25">
          <div class="panel-placeholder">
            <div class="placeholder-title">淹没风险分析</div>
            <div class="placeholder-desc">阶段4实现</div>
          </div>
        </GcsPanel>
      </template>

      <!-- 右侧面板组 -->
      <template #right>
        <!-- 右上：剖面分析面板（4×2，阶段3实现） -->
        <GcsPanel :w="4" :h="2" anchor="top-right" :offset-x="0" :offset-y="0">
          <div class="panel-placeholder">
            <div class="placeholder-title">剖面分析</div>
            <div class="placeholder-desc">阶段3实现</div>
          </div>
        </GcsPanel>

        <!-- 右下：港口影响面板（4×2，阶段5实现） -->
        <GcsPanel :w="4" :h="2" anchor="top-right" :offset-x="0" :offset-y="2.25">
          <div class="panel-placeholder">
            <div class="placeholder-title">港口影响分析</div>
            <div class="placeholder-desc">阶段5实现</div>
          </div>
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.gcs-analysis-page {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  /* 关键：让鼠标事件穿透到下层地图容器 */
  pointer-events: none;
}

/* 注意：不能使用 :deep(*) 通配符设置 pointer-events: none */
/* 原因：Vue scoped 样式中 :deep(*) 的选择器特异性(0,2,0)高于 */
/* UnifiedMap 的 .map-container(0,1,0)，会覆盖地图容器的 pointer-events: auto */
/* 导致 Cesium canvas 无法接收鼠标事件（拖拽/缩放/旋转全部失效） */
/* 正确做法：.gcs-analysis-page 自身 pointer-events: none 即可穿透事件 */
/* 面板通过 :deep(.gcs-panel) 恢复 pointer-events: auto */

/* 仅面板恢复鼠标事件 */
.gcs-analysis-page :deep(.gcs-panel) {
  pointer-events: auto;
}

.panel-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
}

.placeholder-title {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.placeholder-desc {
  font-size: 13px;
  opacity: 0.7;
}

/* Cesium 3D路由禁用backdrop-filter，避免WebGL性能问题 */
.gcs-analysis-page :deep(.gcs-panel) {
  backdrop-filter: none !important;
  background: rgba(255, 255, 255, 0.95) !important;
}
</style>
