<script setup lang="ts">
/**
 * GCSDebugOverlay - 调试模式覆盖层（原 GCSInspectionOverlay 改名 + 扩展，2026-08-05）
 * 职责：
 * 1. 可视化 Cell 网格边界和编号（GCS 验收）
 * 2. 动态检测并显示 Panel / Dock / Container / TopArea 的实际边界 + 对齐验证
 * 3. 性能监控信息（MC F3 风格）：FPS / 长帧 / 接口 TOP / 错误 / 首屏 / 图层图表耗时
 *    —— 数据来自 shared/utils/perfReporter（生产可用，VITE_PERF_ENABLED=false 时为空）
 * 4. 地图上下文：当前引擎（2D/3D）/ 渲染器 / 路由
 * 设计说明：
 * - 覆盖层整体 pointer-events: none，网格 + 信息面板均不拦截鼠标（可正常操作地图）
 * - 信息面板左上角半透明文字风格（仿 MC F3），不遮挡内容
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { INSPECTION_COLORS } from '@/shared'
import { CELL_PIXEL, GRID_SIZE, PANEL_SPACING, SAFE_MARGIN } from '@/shared'
import { useGCS } from '@/shared'
import { buildPerfReport } from '@/shared/utils/perfReporter'
import { useMapStore } from '@/stores'

interface Props {
  enabled?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  enabled: false,
})

const { cellPixel, gap, padding } = useGCS()

// ===== GCS 反馈测试入口（2026-08-08 打磨）=====
// 调试面板可直接触发 modal/toast 预览——走与生产完全相同的 gcsFeedback 单例，
// 确保调试看到的反馈层与正式一致（不用再靠业务操作触发）
import { showModal, showToast } from '@/shared/utils/gcsFeedback'

function testErrorModal(): void {
  showModal({
    message: '网络异常，请检查网络连接后重试',
    mode: 'error',
    onConfirm: () => showToast('已重试', 'success'),
  })
}
function testLoginModal(): void {
  showModal({ message: '收藏功能需要登录，是否前往登录？', mode: 'login' })
}
function testConfirmModal(): void {
  showModal({
    message: '确定要删除方案"调试测试方案"吗？',
    mode: 'confirm',
    onConfirm: () => showToast('已删除', 'success'),
  })
}
function testSuccessToast(): void {
  showToast('操作成功', 'success')
}
function testWarningToast(): void {
  showToast('警告：数据未保存', 'warning')
}
function testErrorToast(): void {
  showToast('操作失败，请重试', 'error')
}

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

// 当调试模式开启时重新测量（挂载/事件监听统一在下方 onMounted/onUnmounted）

// 当调试模式开启时重新测量
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

// ===== 性能监控数据（MC F3 风格信息面板） =====
const route = useRoute()
const mapStore = useMapStore()
const perfReport = ref<Record<string, unknown>>({})
let perfTimer: ReturnType<typeof setInterval> | null = null

function refreshPerf(): void {
  perfReport.value = buildPerfReport()
}

// 地图上下文
const engineInfo = computed(() => {
  const rendererType = mapStore.currentRenderer?.getType?.() ?? 'none'
  return {
    engine: mapStore.mapType,
    renderer: rendererType,
    route: String(route.name ?? '-'),
  }
})

// FPS 区
const fpsInfo = computed(() => {
  const f = perfReport.value.fps as { avg?: number; min?: number; longFrames?: number } | undefined
  return {
    avg: (f?.avg ?? 0).toFixed(1),
    min: f?.min != null && f.min > 0 ? f.min.toFixed(1) : '—',
    longFrames: f?.longFrames ?? 0,
  }
})

interface ApiRow {
  path: string
  count: number
  avg: number
  max: number
  p50: number
  p95: number
}

// 慢接口 TOP5（按 max 排序）
const slowApis = computed<ApiRow[]>(() => {
  const api = perfReport.value.api as Record<string, Omit<ApiRow, 'path'>> | undefined
  if (!api) return []
  return Object.entries(api)
    .map(([path, b]) => ({ path, ...b }))
    .sort((a, b) => b.max - a.max)
    .slice(0, 5)
})

// 错误计数
const errorInfo = computed(() => {
  const e = perfReport.value.errors as Record<string, number> | undefined
  return e ?? {}
})
const errorTotal = computed(() => Object.values(errorInfo.value).reduce((s, n) => s + n, 0))

// 首屏 / Web Vitals
const vitalsInfo = computed(() => {
  const r = perfReport.value as {
    fcp?: number
    lcp?: number
    cls?: number
    tti?: number
    longtasks?: number
  }
  return {
    fcp: r.fcp != null ? r.fcp.toFixed(0) : '—',
    lcp: r.lcp != null ? r.lcp.toFixed(0) : '—',
    cls: r.cls != null ? r.cls.toFixed(3) : '—',
    tti: r.tti != null ? r.tti.toFixed(0) : '—',
    longtasks: r.longtasks ?? 0,
  }
})

// 图层 / 图表耗时 TOP4（按 max 排序）
const timerInfo = computed(() => {
  const t = perfReport.value.timers as
    | Record<string, { count: number; total: number; max: number }>
    | undefined
  if (!t) return []
  return Object.entries(t)
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 4)
    .map(([name, v]) => ({
      name,
      avg: v.count > 0 ? v.total / v.count : 0,
      max: v.max,
    }))
})

onMounted(() => {
  window.addEventListener('resize', handleResize)
  refreshPerf()
  perfTimer = setInterval(refreshPerf, 1000)
  // 首次开启时 DOM 可能尚未完全渲染，延迟测量
  if (props.enabled) {
    requestAnimationFrame(measureAll)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (perfTimer) clearInterval(perfTimer)
})
</script>

<template>
  <div v-if="enabled" class="GCS-debug-overlay">
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

    <!-- 调试信息面板（MC F3 风格：左上角半透明文字，不拦截鼠标） -->
    <div class="debug-hud">
      <div class="hud-title">调试模式 Debug Mode</div>

      <div class="hud-sec">── 地图 ──</div>
      <div class="hud-item">
        <span class="hud-k">引擎</span><span class="hud-v">{{ engineInfo.engine }}</span>
        <span class="hud-k">渲染器</span><span class="hud-v">{{ engineInfo.renderer }}</span>
      </div>
      <div class="hud-item">
        <span class="hud-k">路由</span><span class="hud-v">{{ engineInfo.route }}</span>
      </div>

      <div class="hud-sec">── 性能 ──</div>
      <div class="hud-item">
        <span class="hud-k">FPS</span><span class="hud-v">{{ fpsInfo.avg }}</span>
        <span class="hud-k">min</span><span class="hud-v">{{ fpsInfo.min }}</span>
        <span class="hud-k">长帧&gt;50ms</span><span class="hud-v warn">{{ fpsInfo.longFrames }}</span>
      </div>
      <div v-for="a in slowApis" :key="a.path" class="hud-item">
        <span class="hud-k api-path">{{ a.path }}</span>
        <span class="hud-v">{{ a.p50.toFixed(0) }}/{{ a.p95.toFixed(0) }}ms ({{ a.count }})</span>
      </div>
      <div class="hud-item">
        <span class="hud-k">错误</span><span class="hud-v warn">{{ errorTotal }}</span>
        <span class="hud-k">vue</span><span class="hud-v">{{ errorInfo.vue ?? 0 }}</span>
        <span class="hud-k">script</span><span class="hud-v">{{ errorInfo.script ?? 0 }}</span>
        <span class="hud-k">promise</span><span class="hud-v">{{ errorInfo.promise ?? 0 }}</span>
      </div>
      <div class="hud-item">
        <span class="hud-k">FCP</span><span class="hud-v">{{ vitalsInfo.fcp }}</span>
        <span class="hud-k">LCP</span><span class="hud-v">{{ vitalsInfo.lcp }}</span>
        <span class="hud-k">CLS</span><span class="hud-v">{{ vitalsInfo.cls }}</span>
        <span class="hud-k">TTI</span><span class="hud-v">{{ vitalsInfo.tti }}</span>
      </div>
      <div v-for="t in timerInfo" :key="t.name" class="hud-item">
        <span class="hud-k api-path">{{ t.name }}</span>
        <span class="hud-v">{{ t.avg.toFixed(1) }}/{{ t.max.toFixed(0) }}ms</span>
      </div>

      <div class="hud-sec">── GCS ──</div>
      <div class="hud-item">
        <span class="hud-k">CELL</span><span class="hud-v">{{ cellPixel }}px</span>
        <span class="hud-k">GAP</span><span class="hud-v">{{ gap }}px</span>
        <span class="hud-k">PAD</span><span class="hud-v">{{ padding }}px</span>
      </div>
      <div class="hud-item">
        <span class="hud-k">SAFE</span><span class="hud-v">{{ SAFE_MARGIN }}px</span>
        <span class="hud-k">SPACING</span><span class="hud-v">{{ PANEL_SPACING }}px</span>
        <span class="hud-k">GRID</span><span class="hud-v">{{ GRID_SIZE }}px</span>
      </div>
      <div class="hud-item">
        <span class="hud-k">Grid</span><span class="hud-v">{{ gridCols }}×{{ gridRows }}</span>
        <span class="hud-k">对齐</span>
        <span class="hud-v" :class="alignmentStatus === 'PASS' ? 'pass' : 'fail'">
          {{ alignmentStatus }}
        </span>
      </div>

      <div v-if="alignmentIssues.length > 0" class="hud-issues">
        <div v-for="(issue, index) in alignmentIssues" :key="`${issue.name}-${index}`">
          {{ issue.name }} {{ issue.field }}={{ issue.value }}px (expected {{ issue.expected }})
        </div>
      </div>

      <!-- GCS 反馈测试（2026-08-08 打磨：modal/toast 预览入口，与生产共用 gcsFeedback 单例） -->
      <div class="hud-sec">── GCS 反馈测试 ──</div>
      <div class="feedback-test">
        <button class="feedback-btn" @click="testErrorModal">Error Modal</button>
        <button class="feedback-btn" @click="testLoginModal">Login Modal</button>
        <button class="feedback-btn" @click="testConfirmModal">Confirm Modal</button>
      </div>
      <div class="feedback-test">
        <button class="feedback-btn" @click="testSuccessToast">Toast ✓</button>
        <button class="feedback-btn" @click="testWarningToast">Toast ⚠</button>
        <button class="feedback-btn" @click="testErrorToast">Toast ✗</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.GCS-debug-overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
}

/* 关键：pointer-events 不继承，仅根容器 none 不够——SVG 网格线/标签/HUD 子元素
   默认 auto 仍会拦截鼠标。通配符强制全层穿透：调试模式只展示、不接收任何事件，
   拖拽地图/操作面板/切换路由均不受影响。 */
.GCS-debug-overlay,
.GCS-debug-overlay * {
  pointer-events: none !important;
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

/* 调试信息 HUD（MC F3 风格）：左上角、半透明、纯文字、不拦截鼠标 */
.debug-hud {
  position: absolute;
  top: v-bind(infoPanelOffsetCss);
  left: v-bind(infoPanelOffsetCss);
  background: rgba(0, 0, 0, 0.45);
  color: #e8e8e8;
  padding: v-bind(infoPanelPaddingCss);
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  min-width: v-bind(infoPanelMinWidthCss);
  max-width: 340px;
  pointer-events: none;
}

.hud-title {
  font-size: v-bind(infoTitleFontSizeCss);
  font-weight: bold;
  margin-bottom: v-bind(infoTitleMarginCss);
  color: v-bind(INSPECTION_COLORS.highlight);
  border-bottom: 1px solid rgba(255, 255, 255, 0.25);
  padding-bottom: v-bind(infoTitlePaddingCss);
}

.hud-sec {
  margin-top: v-bind(infoItemMarginCss);
  color: v-bind(INSPECTION_COLORS.primary);
  font-weight: bold;
}

.hud-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 1px;
  flex-wrap: wrap;
}

.hud-k {
  color: v-bind(INSPECTION_COLORS.muted);
}

.hud-v {
  color: v-bind(INSPECTION_COLORS.ok);
  font-weight: bold;
}

.hud-v.warn {
  color: v-bind(INSPECTION_COLORS.warn);
}

.hud-v.pass {
  color: v-bind(INSPECTION_COLORS.ok);
}

.hud-v.fail {
  color: v-bind(INSPECTION_COLORS.danger);
}

.api-path {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hud-issues {
  margin-top: v-bind(infoItemMarginCss);
  padding-top: v-bind(infoItemMarginCss);
  border-top: 1px solid rgba(255, 255, 255, 0.25);
  color: v-bind(INSPECTION_COLORS.danger);
  word-break: break-all;
}

/* GCS 反馈测试按钮：覆盖层整体 pointer-events:none !important（通配符），
   按钮需 auto !important 才能抢回点击（普通 auto 被 !important 压制，按不动） */
.feedback-test {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: v-bind(infoItemMarginCss);
}
.feedback-btn {
  pointer-events: auto !important;
  padding: 4px 8px;
  font-size: 11px;
  line-height: 1.4;
  background: rgba(0, 0, 0, 0.35);
  color: #e6f4ff;
  border: 1px solid rgba(230, 244, 255, 0.4);
  border-radius: 4px;
  cursor: pointer;
  font-family: monospace;
}
.feedback-btn:hover {
  background: rgba(0, 0, 0, 0.55);
}
</style>
