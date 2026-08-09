<script setup lang="ts">
/**
 * FloodAnalysisReportPanel - 浸没分析报告面板
 * 功能：
 * 1. 显示浸没分析关键信息（淹没面积、水深、损失等）
 * 2. 自动响应水位变化，实时更新数据
 * 3. 灰色区域：3.8宽×2.8高，距标题下方0.6cell、左右各0.1cell
 * 布局：4×4 Cell，左上位置
 */

import { computed } from 'vue'

import { useGCS , formatLoss } from '@/shared'
import { useFloodStore } from '@/stores'

const floodStore = useFloodStore()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell16px } = css

/**
 * 计算灰色内容区样式（基于cell单位，响应式布局）
 * 尺寸：3.8宽 × 2.8高（cell单位）
 * 位置：距面板顶部0.6cell、左右各0.1cell
 * 使用绝对定位，相对于.flood-analysis-report-panel
 */
const contentStyle = computed(() => {
  const cell = cellPixel.value

  return {
    width: `${3.8 * cell}px`,
    height: `${2.8 * cell}px`,
    top: `${0.6 * cell}px`,
    left: `${0.1 * cell}px`,
  }
})

/** 格式化损失金额 */
/** 影响等级（根据总损失计算） */
const impactLevel = computed(() => {
  const loss = floodStore.totalLoss
  if (loss === 0) return '无'
  if (loss < 10000) return '低'
  if (loss < 50000) return '中'
  if (loss < 100000) return '高'
  return '极高'
})

/** 受影响港口列表（从 floodStatistics 提取并类型收窄） */
const affectedPorts = computed<string[]>(() => {
  const ports = floodStore.floodStatistics?.affectedPorts
  return Array.isArray(ports) ? (ports as string[]) : []
})
</script>

<template>
  <div class="flood-analysis-report-panel">
    <!-- 标题区 -->
    <div class="panel-header">
      <div class="header-title">浸没分析报告</div>
    </div>

    <!-- 灰色内容区：3.8宽×2.8高，距标题下方0.6cell、左右各0.1cell -->
    <div class="report-content" :style="contentStyle">
      <div v-if="floodStore.floodStatistics" class="info-item">
        <span class="info-label">淹没面积</span>
        <span class="info-value">{{ floodStore.floodStatistics.floodArea || 0 }} km²</span>
      </div>
      <div v-if="floodStore.floodStatistics" class="info-item">
        <span class="info-label">平均水深</span>
        <span class="info-value">{{ floodStore.floodStatistics.averageDepth || 0 }} m</span>
      </div>
      <div v-if="floodStore.floodStatistics" class="info-item">
        <span class="info-label">最大水深</span>
        <span class="info-value">{{ floodStore.floodStatistics.maxDepth || 0 }} m</span>
      </div>
      <div class="info-item">
        <span class="info-label">受影响设施</span>
        <span class="info-value"
          >{{
            floodStore.affectedFacilities.length ||
            floodStore.floodStatistics?.affectedFacilities ||
            0
          }}
          个</span
        >
      </div>
      <div class="info-item">
        <span class="info-label">预估损失</span>
        <span class="info-value highlight"
          >{{
            formatLoss(
              Number(floodStore.totalLoss || floodStore.floodStatistics?.estimatedLoss || 0)
            )
          }}元</span
        >
      </div>
      <div class="info-item">
        <span class="info-label">影响等级</span>
        <span class="info-value">{{ impactLevel }}</span>
      </div>
      <div v-if="affectedPorts.length > 0" class="info-item">
        <span class="info-label">受影响港口</span>
        <span class="info-value">{{ affectedPorts.join('、') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flood-analysis-report-panel {
  width: 100%;
  height: 100%;
  padding: 0;
  background: var(--GCS-bg-panel-translucent);
  border-radius: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 标题区：居中显示 */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell16px);
  flex-shrink: 0;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--GCS-text-primary);
}

/*
 * 灰色内容区（绝对定位，从面板顶部算起）
 * 尺寸：3.8宽 × 2.8高（cell单位，响应式）
 * 位置：距面板顶部0.6cell、左右各0.1cell
 * 内容区域在灰色面板内上下左右居中
 */
.report-content {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--GCS-bg-container);
  border-radius: 6px;
  box-sizing: border-box;
  /* 内容区域在灰色面板内居中 */
  justify-content: center;
  align-items: center;
  padding: v-bind(cell16px);
}

/* 信息列表容器：占满灰色面板，info-item左右对齐 */
.info-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 信息行：左右对齐，占满灰色面板宽度 */
.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  width: 100%;
}

.info-label {
  color: var(--GCS-text-secondary);
}

.info-value {
  color: var(--GCS-text-primary);
  font-weight: 500;
}

.info-value.highlight {
  color: var(--GCS-color-danger);
  font-weight: 600;
}
</style>
