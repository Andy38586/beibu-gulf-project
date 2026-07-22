<script setup>
/**
 * FloodAnalysisReportPanel - 浸没分析报告面板
 *
 * 功能：
 * 1. 显示浸没分析关键信息（淹没面积、水深、损失等）
 * 2. 自动响应水位变化，实时更新数据
 * 3. 灰色区域：3.8宽×2.8高，距标题下方0.6cell、左右各0.1cell
 *
 * 布局：4×4 Cell，左上位置
 */

import { computed } from 'vue'
import { useGcsStore } from '@/stores/gcsStore'
import { useGCS } from '@/core/layout/useGCS.js'

const gcsStore = useGcsStore()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px, cell16px, cell40px } = css

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
function formatLoss(loss) {
  if (loss >= 10000) {
    return (loss / 10000).toFixed(1) + ' 亿'
  }
  return loss.toFixed(0) + ' 万'
}

/** 影响等级（根据总损失计算） */
const impactLevel = computed(() => {
  const loss = gcsStore.totalLoss
  if (loss === 0) return '无'
  if (loss < 10000) return '低'
  if (loss < 50000) return '中'
  if (loss < 100000) return '高'
  return '极高'
})

/** 始终显示报告内容 */
const showReport = computed(() => true)
</script>

<template>
  <div class="flood-analysis-report-panel">
    <!-- 标题区 -->
    <div class="panel-header">
      <div class="header-title">浸没分析报告</div>
    </div>

    <!-- 灰色内容区：3.8宽×2.8高，距标题下方0.6cell、左右各0.1cell -->
    <div class="report-content" v-if="showReport" :style="contentStyle">
      <div class="info-item" v-if="gcsStore.floodStatistics">
        <span class="info-label">淹没面积</span>
        <span class="info-value">{{ gcsStore.floodStatistics.floodArea || 0 }} km²</span>
      </div>
      <div class="info-item" v-if="gcsStore.floodStatistics">
        <span class="info-label">平均水深</span>
        <span class="info-value">{{ gcsStore.floodStatistics.averageDepth || 0 }} m</span>
      </div>
      <div class="info-item" v-if="gcsStore.floodStatistics">
        <span class="info-label">最大水深</span>
        <span class="info-value">{{ gcsStore.floodStatistics.maxDepth || 0 }} m</span>
      </div>
      <div class="info-item">
        <span class="info-label">受影响设施</span>
        <span class="info-value"
          >{{
            gcsStore.affectedFacilities.length || gcsStore.floodStatistics?.affectedFacilities || 0
          }}
          个</span
        >
      </div>
      <div class="info-item">
        <span class="info-label">预估损失</span>
        <span class="info-value highlight"
          >{{
            formatLoss(gcsStore.totalLoss || gcsStore.floodStatistics?.estimatedLoss || 0)
          }}元</span
        >
      </div>
      <div class="info-item">
        <span class="info-label">影响等级</span>
        <span class="info-value">{{ impactLevel }}</span>
      </div>
      <div class="info-item" v-if="gcsStore.floodStatistics?.affectedPorts?.length > 0">
        <span class="info-label">受影响港口</span>
        <span class="info-value">{{ gcsStore.floodStatistics.affectedPorts.join('、') }}</span>
      </div>
    </div>

    <!-- 无数据提示 -->
    <div class="no-data-section" v-else>
      <div class="no-data-text">当前水位：{{ gcsStore.waterLevel.toFixed(1) }} m</div>
      <div class="no-data-hint">开始分析后显示浸没报告</div>
    </div>
  </div>
</template>

<style scoped>
.flood-analysis-report-panel {
  width: 100%;
  height: 100%;
  padding: 0;
  background: rgba(255, 255, 255, 0.95);
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
  color: #303133;
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
  background: #f5f7fa;
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
  color: #606266;
}

.info-value {
  color: #303133;
  font-weight: 500;
}

.info-value.highlight {
  color: #f56c6c;
  font-weight: 600;
}

/* 无数据提示 */
.no-data-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: v-bind(cell40px) 20px;
  gap: v-bind(cell8px);
  flex: 1;
}

.no-data-text {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
}

.no-data-hint {
  font-size: 12px;
  color: #909399;
}
</style>
