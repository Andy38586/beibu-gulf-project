<script setup lang="ts">
/**
 * 浸没分析报告面板：显示淹没面积、水深、损失等关键信息，随水位变化实时更新。
 * 布局 4×4，左上角。
 */

import { computed } from 'vue'

import { formatLoss, useGCS } from '@/shared'
import { useFloodStore } from '@/stores'

import { summarizeFacilityTypes } from '../constants/facilityTypeLabels'

const floodStore = useFloodStore()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell16px } = css

/** 灰色内容区样式：3.8×2.8 cell，距顶部 0.6cell、左右各 0.1cell，绝对定位 */
const contentStyle = computed(() => {
  const cell = cellPixel.value

  return {
    width: `${3.8 * cell}px`,
    height: `${2.8 * cell}px`,
    top: `${0.6 * cell}px`,
    left: `${0.1 * cell}px`,
  }
})

/** 影响等级：直读评估返回的风险分级（floodStore.floodRiskLevel ← 后端
 *  RISK_LEVEL_BANDS 派生，与滑块动态徽章同一张表）。2026-09-12 重划后统一：
 *  原实现按总损失阈值（1万/5万/10万元）自算第三套分级，阈值停留在早期万元口径，
 *  损失进入亿级后恒为"极高"，分级失效——三套分级并存至此收口为一张表 */
const impactLevel = computed(() => floodStore.floodRiskLevel)

/** 受影响港口列表（从 floodStatistics 提取并类型收窄） */
const affectedPorts = computed<string[]>(() => {
  const ports = floodStore.floodStatistics?.affectedPorts
  return Array.isArray(ports) ? (ports as string[]) : []
})

/**
 * 水深参考档披露（W19 / d056 N-1）：averageDepth/maxDepth 来自 6 档 DEM 反演参考表
 *（源数据无 251 档水深），该表的反演基准比本响应的实际档位低 `depthUnderstatedBy` 米
 * ——后端按 EGM96 等值算出，前端不重算偏移。
 *
 * 判据「有低估才标 *」：旧实现拿参考档标签（理论深度基准面）与实际水位（EGM96）直接比，
 * 基准混用 ⇒ 披露反转：真低估 2.5m 的档（2/5/8/10/15m）不标，唯一不低估的档（请求 2.5m）
 * 反而标。
 */
const depthRefLevel = computed(() => floodStore.floodStatistics?.depthRefLevel)
const depthUnderstatedBy = computed(() => floodStore.floodStatistics?.depthUnderstatedBy ?? 0)
const depthIsReference = computed(() => depthUnderstatedBy.value > 0)
const depthHint = computed(() =>
  depthIsReference.value
    ? `参考 ${depthRefLevel.value}m 档 DEM 反演值（基准比实际档位低 ${depthUnderstatedBy.value}m）`
    : ''
)

/** 设施分类统计（z039④）：聚合结果挂「受影响设施」行 title——后端已有 type，前端不新造数据 */
const facilityTypeSummary = computed(() => summarizeFacilityTypes(floodStore.affectedFacilities))

/**
 * 档位对齐披露（z039④）：请求水位向上取档后，面板/几何用的是**实际档**。
 * 两值不等才披露（请求 4.5 → 实际 5），避免被读成精确水位。
 */
const levelAdjustment = computed(() => {
  const stats = floodStore.floodStatistics
  const requested = Number(stats?.requestedWaterLevel)
  const actual = Number(stats?.actualWaterLevel ?? stats?.waterLevel)
  if (!Number.isFinite(requested) || !Number.isFinite(actual) || requested === actual) return null
  return { requested, actual }
})
const levelHint = computed(() =>
  levelAdjustment.value
    ? `请求 ${levelAdjustment.value.requested}m 档 → 实际取 ${levelAdjustment.value.actual}m 档（向上取档；面板数值与地图几何均按实际档）`
    : ''
)

/** 报告行：label + 值文本 + 可选后缀标注（⇧ / *）+ 可选 title/高亮类 */
interface ReportRow {
  label: string
  value: string
  title?: string
  valueClass?: 'highlight' | 'has-hint'
  mark?: { text: string; class: 'level-adjust-mark' | 'ref-mark'; title?: string }
}

const row = (label: string, value: string, extra: Partial<ReportRow> = {}): ReportRow => ({
  label,
  value,
  ...extra,
})

/**
 * 7 行报告的唯一事实源：模板侧一段 v-for，不再逐行写标签/值的重复结构。
 * 前三行（面积/水深）随 floodStatistics 出现或消失——门控在这里表达；
 * 数值统一 `?? 0`（合法 0 不经 OR 链误判跳到下一兜底）。
 */
const rows = computed<ReportRow[]>(() => {
  const s = floodStore.floodStatistics
  const depthMark = depthIsReference.value ? { text: '*', class: 'ref-mark' as const } : undefined
  const upMark = levelAdjustment.value
    ? { text: '⇧', class: 'level-adjust-mark' as const, title: levelHint.value }
    : undefined
  const summary = facilityTypeSummary.value || undefined
  const loss = formatLoss(Number(floodStore.totalLoss ?? s?.estimatedLoss ?? 0))
  const depthRows = [
    row('平均水深', `${s?.averageDepth ?? 0} m`, { title: depthHint.value, mark: depthMark }),
    row('最大水深', `${s?.maxDepth ?? 0} m`, { title: depthHint.value, mark: depthMark }),
  ]
  const list: ReportRow[] = s
    ? [row('淹没面积', `${s.floodArea ?? 0} km²`, { mark: upMark }), ...depthRows]
    : []
  list.push(
    row('受影响设施', `${floodStore.affectedFacilities.length} 个`, {
      title: summary,
      valueClass: summary ? 'has-hint' : undefined,
    }),
    // 预估损失（X4）：disaster 的 totalLoss 与 estimatedLoss 现同式，?? 兜底链两侧可互换
    row('预估损失', `${loss}元`, { valueClass: 'highlight' }),
    row('影响等级', impactLevel.value)
  )
  if (affectedPorts.value.length) list.push(row('受影响港口', affectedPorts.value.join('、')))
  return list
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
      <!-- 行集与前置门控见 rows computed；受影响设施 title 为后端 type 聚合，不新造数据 -->
      <div v-for="item in rows" :key="item.label" class="info-item">
        <span class="info-label">{{ item.label }}</span>
        <span class="info-value" :class="item.valueClass" :title="item.title"
          >{{ item.value
          }}<span v-if="item.mark" :class="item.mark.class" :title="item.mark.title">{{
            item.mark.text
          }}</span></span
        >
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
  font-size: var(--GCS-font-size-lg); /* 面板标题字号归档 */
  font-weight: 600;
  color: var(--GCS-text-primary);
}

/* 灰色内容区：绝对定位，内容居中 */
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

.info-value.has-hint {
  cursor: help;
}

/* 档位对齐标注（⇧）：请求水位向上取档后，提示面板数字用的是实际档 */
.level-adjust-mark {
  margin-left: 2px;
  color: var(--GCS-text-secondary);
  cursor: help;
}

/* 水深参考档位标注（*）：提示该值来自 6 档 DEM 反演参考表而非当前水位 */
.ref-mark {
  margin-left: 2px;
  color: var(--GCS-text-secondary);
  cursor: help;
}
</style>
