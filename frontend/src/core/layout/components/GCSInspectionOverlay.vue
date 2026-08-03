<script setup lang="ts">
/**
 * GCSInspectionOverlay - GCS 检查模式覆盖层
 *
 * 职责：
 * 1. 可视化 Cell 网格边界和编号
 * 2. 动态检测并显示 Panel / Dock / Container / TopArea 的实际边界
 * 3. 自动验证各元素是否与 Cell 网格对齐
 * 4. 显示当前 GCS 参数与对齐状态
 *
 * 设计说明：
 * - 仅用于开发验收，生产环境默认关闭
 * - 禁止拖拽、换位、动态编辑等交互功能
 * - 边界信息通过 DOM getBoundingClientRect 动态获取，确保反映真实渲染结果
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { INSPECTION_COLORS } from '@/shared'
import { CELL_PIXEL, GRID_SIZE, PANEL_SPACING, SAFE_MARGIN } from '@/shared'
import { useGCS } from '@/shared'

interface Props {
  enabled?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  enabled: false,
})

const { cellPixel, gap, padding } = useGCS()

// 用于 CSS v-bind 的计算属性：标签位置（基于 CELL_PIXEL 的比例）
const labelOffsetCss = computed(() => `${Math.round(CELL_PIXEL * 0.05)}px`)
const labelFontSizeSmallCss = computed(() => `${Math.round(CELL_PIXEL * 0.1375)}px`)
const labelFontSizeMediumCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const labelPaddingCss = computed(
  () => `${Math.round(CELL_PIXEL * 0.025)}px ${Math.round(CELL_PIXEL * 0.075)}px`
)

// 信息面板样式（基于 CELL_PIXEL 的比例）
const infoPanelOffsetCss = computed(() => `${Math.round(CELL_PIXEL * 0.25)}px`)
const infoPanelPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.2)}px`)
const infoPanelFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.1625)}px`)
const infoPanelMinWidthCss = computed(() => `${Math.round(CELL_PIXEL * 2.5)}px`)
const infoTitleFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.175)}px`)
const infoTitleMarginCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const infoTitlePaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.1)}px`)
const infoItemMarginCss = computed(() => `${Math.round(CELL_PIXEL * 0.1)}px`)

// 响应式视口尺寸
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1920)
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 1080)

// DOM 动态测量的元素边界结构
interface MeasuredRect {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

interface AlignmentIssue {
  name: string
  field: string
  value: number
  expected: number | string
}

// 从 DOM 动态测量的元素边界
const measuredPanels = ref<MeasuredRect[]>([])
const measuredDock = ref<MeasuredRect | null>(null)

// 对齐验证结果
const alignmentIssues = ref<AlignmentIssue[]>([])

/**
 * 更新视口尺寸
 */
function updateViewport() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

/**
 * 获取单个元素相对于视口的边界信息
 * @param {string} selector - CSS 选择器
 * @param {string} label - 显示标签
 * @returns {{ id: string, label: string, x: number, y: number, width: number, height: number } | null}
 */
function measureElement(selector: string, label: string): MeasuredRect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return {
    id: selector,
    label,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * 获取多个同类元素的边界信息
 * @param {string} selector - CSS 选择器
 * @param {string} prefix - 标签前缀
 * @returns {Array<{ id: string, label: string, x: number, y: number, width: number, height: number }>}
 */
function measureElements(selector: string, prefix: string): MeasuredRect[] {
  return Array.from(document.querySelectorAll(selector)).map((el, index) => {
    const rect = el.getBoundingClientRect()
    return {
      id: `${selector}-${index}`,
      label: `${prefix} ${index + 1}`,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  })
}

/**
 * 测量所有需要检查边界的元素
 * V2 变更：移除 Container 和 TopArea 检测（V2 无 Container，TopArea 已拆分为独立 Panel）
 */
function measureAll() {
  if (typeof window === 'undefined') return
  // Dock 使用独立的 GCSPanel，从 Panel 列表中排除，避免重复检测
  // 仅保留实际可见（尺寸大于 0）的 Panel
  measuredPanels.value = measureElements('.GCS-panel:not(.dock-panel)', 'Panel').filter(
    (panel) => panel.width > 0 && panel.height > 0
  )
  measuredDock.value = measureElement('.bottom-nav-bar', 'Dock')
  validateAlignment()
}

/**
 * 判断数值是否符合 PPS 定位模式（允许 1px 浮点误差）
 * PPS 公式有三种模式：
 * - left 锚点:   value = SAFE_MARGIN + n × CELL_PIXEL
 * - right 锚点:  value = W - SAFE_MARGIN - n × CELL_PIXEL
 * - center 锚点: value = (W - n × CELL_PIXEL) / 2
 * @param {number} value
 * @returns {boolean}
 */
function isPpsAligned(value: number) {
  const C = cellPixel.value
  const S = SAFE_MARGIN
  const W = viewportWidth.value

  // 模式 1: SAFE_MARGIN + n × CELL_PIXEL (left 锚点)
  const remainder1 = (value - S) % C
  if (remainder1 <= 1 || remainder1 >= C - 1) return true

  // 模式 2: W - SAFE_MARGIN - n × CELL_PIXEL (right 锚点)
  const remainder2 = (W - S - value) % C
  if (remainder2 <= 1 || remainder2 >= C - 1) return true

  // 模式 3: (W - n × CELL_PIXEL) / 2 (center 锚点)
  const remainder3 = (W - value * 2) % C
  if (remainder3 <= 1 || remainder3 >= C - 1) return true

  return false
}

/**
 * 判断数值是否对齐到 Cell 网格（允许 1px 浮点误差）
 * 用于验证 Panel 尺寸（width/height）是否为 CELL_PIXEL 的整数倍
 * @param {number} value
 * @returns {boolean}
 */
function isCellAligned(value: number) {
  const remainder = value % cellPixel.value
  return remainder <= 1 || remainder >= cellPixel.value - 1
}

/**
 * 记录对齐问题
 * @param {string} name - 元素名称
 * @param {string} field - 不对齐的字段
 * @param {number} value - 实际值
 * @param {string} [expected] - 预期值描述（默认 Cell 倍数）
 */
function recordIssue(name: string, field: string, value: number, expected?: number | string) {
  alignmentIssues.value.push({
    name,
    field,
    value: Math.round(value),
    expected: expected || `multiple of ${cellPixel.value}px`,
  })
}

/**
 * 验证单个矩形是否符合 PPS 定位 + Cell 尺寸
 * - 位置 (x, y)：必须符合 PPS 公式 SAFE_MARGIN + n × CELL_PIXEL
 * - 尺寸 (width, height)：必须是 CELL_PIXEL 的整数倍
 * @param {string} name
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {Object} options
 * @param {boolean} options.skipX
 * @param {boolean} options.skipY
 */
function validateRect(
  name: string,
  rect: MeasuredRect,
  options: { skipX?: boolean; skipY?: boolean } = {}
) {
  if (!options.skipX && !isPpsAligned(rect.x)) {
    recordIssue(name, 'x', rect.x, `PPS formula (left/right/center)`)
  }
  if (!options.skipY && !isPpsAligned(rect.y)) {
    recordIssue(name, 'y', rect.y, `PPS formula (left/right/center)`)
  }
  if (!isCellAligned(rect.width)) recordIssue(name, 'width', rect.width)
  if (!isCellAligned(rect.height)) recordIssue(name, 'height', rect.height)
}

/**
 * 验证 Dock 是否水平居中
 * 由于 Dock 需要吸附到 Cell 网格，允许在吸附后与绝对中心存在最多半个 Cell 的偏移
 * @param {{ x: number, width: number }} dockRect
 */
function validateDockCenter(dockRect: { x: number; width: number }) {
  const expectedX = (viewportWidth.value - dockRect.width) / 2
  const diff = Math.abs(dockRect.x - expectedX)
  if (diff > cellPixel.value / 2 + 1) {
    alignmentIssues.value.push({
      name: 'Dock',
      field: 'center',
      value: Math.round(dockRect.x),
      expected: Math.round(expectedX),
    })
  }
}

/**
 * 验证 Panel 到 Canvas 边缘的间距 >= SAFE_MARGIN
 * PPS 公式保证 offset=0 的 Panel 边缘恰好在 SAFE_MARGIN 处，
 * offset>0 的 Panel 边缘更远，所以只需检查最小间距
 * @param {{ label: string, x: number, y: number, width: number, height: number }} panel
 */
function validateEdgeSpacing(panel: {
  label: string
  x: number
  y: number
  width: number
  height: number
}) {
  const minSpacing = SAFE_MARGIN

  // 上边缘：必须 >= SAFE_MARGIN
  if (panel.y < minSpacing - 1) {
    recordIssue(panel.label, 'top-edge', panel.y, `>= ${minSpacing}px`)
  }
  // 左边缘：必须 >= SAFE_MARGIN
  if (panel.x < minSpacing - 1) {
    recordIssue(panel.label, 'left-edge', panel.x, `>= ${minSpacing}px`)
  }
  // 右边缘：必须 >= SAFE_MARGIN
  const rightEdge = viewportWidth.value - (panel.x + panel.width)
  if (rightEdge < minSpacing - 1) {
    recordIssue(panel.label, 'right-edge', rightEdge, `>= ${minSpacing}px`)
  }
  // 下边缘：必须 >= SAFE_MARGIN
  const bottomEdge = viewportHeight.value - (panel.y + panel.height)
  if (bottomEdge < minSpacing - 1) {
    recordIssue(panel.label, 'bottom-edge', bottomEdge, `>= ${minSpacing}px`)
  }
}

/**
 * 执行所有对齐验证
 * V2 变更：移除 Container/TopArea 验证，新增间距验证
 */
function validateAlignment() {
  alignmentIssues.value = []

  // 验证 Panel 的 Cell 对齐
  measuredPanels.value.forEach((panel) => validateRect(panel.label, panel))

  // 验证 Panel 到 Canvas 边缘的间距
  measuredPanels.value.forEach((panel) => validateEdgeSpacing(panel))

  // 验证 Dock 居中和 Cell 对齐
  if (measuredDock.value) {
    validateRect('Dock', measuredDock.value, { skipY: true })
    validateDockCenter(measuredDock.value)
  }
}

// 窗口大小变化时重新测量
function handleResize() {
  updateViewport()
  measureAll()
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  // 首次开启时 DOM 可能尚未完全渲染，延迟测量
  if (props.enabled) {
    requestAnimationFrame(measureAll)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// 当检查模式开启时重新测量
watch(
  () => props.enabled,
  (enabled) => {
    if (enabled) {
      requestAnimationFrame(measureAll)
    }
  }
)

// 计算 Grid 参考线行列数（V2 使用 GRID_SIZE 而非 cellPixel）
const gridCols = computed(() => Math.floor(viewportWidth.value / GRID_SIZE))
const gridRows = computed(() => Math.floor(viewportHeight.value / GRID_SIZE))

// 生成 Grid 参考线数据（V2 使用 GRID_SIZE）
const gridLines = computed(() => {
  const result: { id: string; row: number; col: number; x: number; y: number }[] = []
  for (let row = 0; row < gridRows.value; row++) {
    for (let col = 0; col < gridCols.value; col++) {
      result.push({
        id: `${row}-${col}`,
        row,
        col,
        x: col * GRID_SIZE,
        y: row * GRID_SIZE,
      })
    }
  }
  return result
})

// 对齐状态摘要
const alignmentStatus = computed(() => {
  return alignmentIssues.value.length === 0 ? 'PASS' : `FAIL (${alignmentIssues.value.length})`
})
</script>

<template>
  <div v-if="enabled" class="GCS-inspection-overlay">
    <!-- Grid 参考线层（V2 使用 GRID_SIZE = 100px） -->
    <svg class="cell-grid" :width="viewportWidth" :height="viewportHeight">
      <g class="cell-boundaries">
        <line
          v-for="col in gridCols + 1"
          :key="`v-${col}`"
          :x1="(col - 1) * GRID_SIZE"
          :y1="0"
          :x2="(col - 1) * GRID_SIZE"
          :y2="viewportHeight"
          :stroke="INSPECTION_COLORS.primary"
          stroke-width="1"
          stroke-dasharray="4,4"
          opacity="0.4"
        />
        <line
          v-for="row in gridRows + 1"
          :key="`h-${row}`"
          :x1="0"
          :y1="(row - 1) * GRID_SIZE"
          :x2="viewportWidth"
          :y2="(row - 1) * GRID_SIZE"
          :stroke="INSPECTION_COLORS.primary"
          stroke-width="1"
          stroke-dasharray="4,4"
          opacity="0.4"
        />
      </g>

      <g class="cell-labels">
        <text
          v-for="cell in gridLines"
          :key="cell.id"
          :x="cell.x + 4"
          :y="cell.y + 14"
          :fill="INSPECTION_COLORS.primary"
          font-size="10"
          font-family="monospace"
          opacity="0.6"
        >
          {{ cell.row }},{{ cell.col }}
        </text>
      </g>
    </svg>

    <!-- Panel 占用区域 -->
    <div
      v-for="panel in measuredPanels"
      :key="panel.id"
      class="panel-boundary"
      :class="{ misaligned: alignmentIssues.some((i) => i.name === panel.label) }"
      :style="{
        top: `${panel.y}px`,
        left: `${panel.x}px`,
        width: `${panel.width}px`,
        height: `${panel.height}px`,
      }"
    >
      <div class="panel-label">{{ panel.label }}</div>
    </div>

    <!-- Dock 占用区域 -->
    <div
      v-if="measuredDock"
      class="dock-boundary"
      :class="{ misaligned: alignmentIssues.some((i) => i.name === 'Dock') }"
      :style="{
        top: `${measuredDock.y}px`,
        left: `${measuredDock.x}px`,
        width: `${measuredDock.width}px`,
        height: `${measuredDock.height}px`,
      }"
    >
      <div class="dock-label">
        Dock ({{ Math.round(measuredDock.width / cellPixel) }}×{{
          Math.round(measuredDock.height / cellPixel)
        }})
      </div>
    </div>

    <!-- 参数信息面板 -->
    <div class="info-panel">
      <div class="info-title">GCS Inspection Mode</div>
      <div class="info-item">
        <span class="info-label">CELL_PIXEL:</span>
        <span class="info-value">{{ cellPixel }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">GAP:</span>
        <span class="info-value">{{ gap }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">PADDING:</span>
        <span class="info-value">{{ padding }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">SAFE_MARGIN:</span>
        <span class="info-value">{{ SAFE_MARGIN }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">PANEL_SPACING:</span>
        <span class="info-value">{{ PANEL_SPACING }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">GRID_SIZE:</span>
        <span class="info-value">{{ GRID_SIZE }}px</span>
      </div>
      <div class="info-item">
        <span class="info-label">Grid:</span>
        <span class="info-value">{{ gridCols }}×{{ gridRows }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Alignment:</span>
        <span class="info-value" :class="alignmentStatus === 'PASS' ? 'pass' : 'fail'">
          {{ alignmentStatus }}
        </span>
      </div>

      <!-- 对齐问题列表 -->
      <div v-if="alignmentIssues.length > 0" class="issues-list">
        <div v-for="(issue, index) in alignmentIssues" :key="index" class="issue-item">
          {{ issue.name }} {{ issue.field }}={{ issue.value }}px (expected {{ issue.expected }})
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.GCS-inspection-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 55;
}

/* 信息面板需要可交互（如果有交互元素） */
.info-panel {
  pointer-events: auto;
}

.cell-grid {
  position: absolute;
  inset: 0;
}

.panel-boundary {
  position: absolute;
  border: 2px dashed v-bind(INSPECTION_COLORS.warn);
  background: rgba(255, 165, 2, 0.08);
  pointer-events: none;
}

.panel-boundary.misaligned {
  border-color: v-bind(INSPECTION_COLORS.danger);
  background: rgba(255, 56, 56, 0.1);
}

.panel-label {
  position: absolute;
  top: v-bind(labelOffsetCss);
  left: v-bind(labelOffsetCss);
  color: v-bind(INSPECTION_COLORS.warn);
  font-size: v-bind(labelFontSizeSmallCss);
  font-family: monospace;
  font-weight: bold;
  background: rgba(0, 0, 0, 0.6);
  padding: v-bind(labelPaddingCss);
  border-radius: 3px;
}

.dock-boundary {
  position: absolute;
  border: 2px solid v-bind(INSPECTION_COLORS.primary);
  background: rgba(255, 107, 107, 0.08);
  pointer-events: none;
}

.dock-boundary.misaligned {
  border-color: v-bind(INSPECTION_COLORS.danger);
  background: rgba(255, 56, 56, 0.1);
}

.dock-label {
  position: absolute;
  top: v-bind(labelOffsetCss);
  left: v-bind(labelOffsetCss);
  color: v-bind(INSPECTION_COLORS.primary);
  font-size: v-bind(labelFontSizeMediumCss);
  font-family: monospace;
  font-weight: bold;
  background: rgba(0, 0, 0, 0.6);
  padding: v-bind(labelPaddingCss);
  border-radius: 3px;
}

.info-panel {
  position: absolute;
  top: v-bind(infoPanelOffsetCss);
  right: v-bind(infoPanelOffsetCss);
  background: rgba(0, 0, 0, 0.85);
  color: var(--GCS-bg-panel);
  padding: v-bind(infoPanelPaddingCss);
  border-radius: 8px;
  font-family: monospace;
  font-size: v-bind(infoPanelFontSizeCss);
  min-width: v-bind(infoPanelMinWidthCss);
  max-width: 320px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.info-title {
  font-size: v-bind(infoTitleFontSizeCss);
  font-weight: bold;
  margin-bottom: v-bind(infoTitleMarginCss);
  color: v-bind(INSPECTION_COLORS.highlight);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: v-bind(infoTitlePaddingCss);
}

.info-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: v-bind(infoItemMarginCss);
}

.info-label {
  color: v-bind(INSPECTION_COLORS.muted);
}

.info-value {
  color: v-bind(INSPECTION_COLORS.ok);
  font-weight: bold;
}

.info-value.pass {
  color: v-bind(INSPECTION_COLORS.ok);
}

.info-value.fail {
  color: v-bind(INSPECTION_COLORS.danger);
}

.issues-list {
  margin-top: v-bind(infoItemMarginCss);
  padding-top: v-bind(infoItemMarginCss);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.issue-item {
  color: v-bind(INSPECTION_COLORS.danger);
  font-size: v-bind(labelFontSizeSmallCss);
  margin-bottom: 4px;
  word-break: break-all;
}
</style>
