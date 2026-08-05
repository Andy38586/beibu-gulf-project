<!--
  PerfPanel.vue —— 性能监控悬浮面板
  展示埋点聚合数据（shared/utils/perfReporter）：
  - FAB 按钮（右下角）：实时平均 FPS，点击展开/收起
  - 面板：FPS(avg/min/长帧) / 接口 TOP(慢接口 p50/p95) / 错误计数 / 首屏(FCP/LCP/CLS/TTI) / 业务耗时(timers)
  1s 轮询 buildPerfReport()；埋点关闭（VITE_PERF_ENABLED=false）时整体隐藏。
  纯原生 DOM + CSS 变量（--GCS-*），零新增依赖。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { buildPerfReport, isPerfEnabled } from '@/shared/utils/perfReporter'

const open = ref(false)
const report = ref<Record<string, unknown>>({})
let timer: ReturnType<typeof setInterval> | null = null

function refresh(): void {
  report.value = buildPerfReport()
}

const enabled = isPerfEnabled()

onMounted(() => {
  if (!enabled) return
  refresh()
  timer = setInterval(refresh, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

/** FAB 上的实时 FPS（面板收起时可见） */
const fabFps = computed(() => {
  const f = report.value.fps as { avg?: number } | undefined
  const avg = f?.avg ?? 0
  return avg > 0 ? avg.toFixed(0) : '--'
})

const fpsSection = computed(() => {
  const f = report.value.fps as
    | { avg?: number; min?: number; longFrames?: number }
    | undefined
  return {
    avg: (f?.avg ?? 0).toFixed(1),
    min: (f?.min ?? 0).toFixed(1),
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

/** 慢接口 TOP5（按 max 排序） */
const slowApis = computed<ApiRow[]>(() => {
  const api = report.value.api as Record<string, Omit<ApiRow, 'path'>> | undefined
  if (!api) return []
  return Object.entries(api)
    .map(([path, b]) => ({ path, ...b }))
    .sort((a, b) => b.max - a.max)
    .slice(0, 5)
})

const errors = computed(() => {
  const e = report.value.errors as Record<string, number> | undefined
  return e ?? {}
})
const errorTotal = computed(() =>
  Object.values(errors.value).reduce((s, n) => s + n, 0)
)

const timers = computed(() => {
  const t = report.value.timers as
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

const webVitals = computed(() => {
  const r = report.value as {
    fcp?: number
    lcp?: number
    cls?: number
    tti?: number
    longtasks?: number
  }
  return {
    fcp: r.fcp != null ? r.fcp.toFixed(0) + 'ms' : '—',
    lcp: r.lcp != null ? r.lcp.toFixed(0) + 'ms' : '—',
    cls: r.cls != null ? r.cls.toFixed(3) : '—',
    tti: r.tti != null ? r.tti.toFixed(0) + 'ms' : '—',
    longtasks: r.longtasks ?? 0,
  }
})
</script>

<template>
  <div v-if="enabled" class="perf-panel">
    <button
      class="perf-fab"
      :class="{ active: open }"
      :title="open ? '收起性能面板' : '展开性能面板'"
      @click="open = !open"
    >
      <span class="fab-fps">{{ fabFps }}</span>
      <span class="fab-label">FPS</span>
    </button>

    <div v-if="open" class="perf-body">
      <div class="perf-title">性能监控（window.__perf.print() 看控制台详情）</div>

      <div class="perf-section">
        <div class="perf-sec-title">帧率</div>
        <div class="perf-grid">
          <span>avg <b>{{ fpsSection.avg }}</b></span>
          <span>min <b>{{ fpsSection.min }}</b></span>
          <span>长帧&gt;50ms <b class="warn">{{ fpsSection.longFrames }}</b></span>
        </div>
      </div>

      <div class="perf-section">
        <div class="perf-sec-title">接口 TOP（p50 / p95 ms）</div>
        <div v-if="slowApis.length" class="perf-api">
          <div v-for="a in slowApis" :key="a.path" class="perf-api-row">
            <span class="api-path">{{ a.path }}</span>
            <span class="api-ms">{{ a.p50.toFixed(0) }} / {{ a.p95.toFixed(0) }} ({{ a.count }})</span>
          </div>
        </div>
        <div v-else class="perf-empty">暂无接口数据</div>
      </div>

      <div class="perf-section">
        <div class="perf-sec-title">错误 <b class="warn">{{ errorTotal }}</b></div>
        <div class="perf-grid">
          <span>vue <b>{{ errors.vue ?? 0 }}</b></span>
          <span>script <b>{{ errors.script ?? 0 }}</b></span>
          <span>promise <b>{{ errors.promise ?? 0 }}</b></span>
        </div>
      </div>

      <div class="perf-section">
        <div class="perf-sec-title">首屏 / 加载</div>
        <div class="perf-grid">
          <span>FCP <b>{{ webVitals.fcp }}</b></span>
          <span>LCP <b>{{ webVitals.lcp }}</b></span>
          <span>CLS <b>{{ webVitals.cls }}</b></span>
        </div>
        <div class="perf-grid">
          <span>TTI <b>{{ webVitals.tti }}</b></span>
          <span>longtask <b>{{ webVitals.longtasks }}</b></span>
        </div>
      </div>

      <div v-if="timers.length" class="perf-section">
        <div class="perf-sec-title">图层 / 图表耗时（avg / max ms）</div>
        <div v-for="t in timers" :key="t.name" class="perf-api-row">
          <span class="api-path">{{ t.name }}</span>
          <span class="api-ms">{{ t.avg.toFixed(1) }} / {{ t.max.toFixed(0) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.perf-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  font-family: var(--font-sans, -apple-system, 'Segoe UI', sans-serif);
  pointer-events: none;
}
.perf-fab {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--GCS-border-default, rgba(255, 255, 255, 0.3));
  background: var(--GCS-bg-panel-translucent, rgba(18, 24, 38, 0.9));
  color: var(--GCS-text-primary, #e5eaf3);
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.perf-fab.active {
  border-color: var(--GCS-color-primary, #409eff);
}
.fab-fps {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.1;
}
.fab-label {
  font-size: 10px;
  opacity: 0.7;
}
.perf-body {
  pointer-events: auto;
  position: absolute;
  right: 0;
  bottom: 60px;
  width: 300px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--GCS-border-default, rgba(255, 255, 255, 0.2));
  background: var(--GCS-bg-panel, rgba(22, 28, 44, 0.96));
  color: var(--GCS-text-primary, #e5eaf3);
  font-size: 12px;
  line-height: 1.6;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}
.perf-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--GCS-color-primary, #409eff);
  margin-bottom: 8px;
}
.perf-section {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.perf-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
.perf-sec-title {
  font-size: 11px;
  opacity: 0.75;
  margin-bottom: 4px;
}
.perf-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}
.perf-grid b {
  color: var(--GCS-text-primary, #fff);
}
.perf-grid .warn {
  color: #e6a23c;
}
.perf-api {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.perf-api-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.api-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
.api-ms {
  flex-shrink: 0;
  color: var(--GCS-color-primary, #409eff);
}
.perf-empty {
  font-size: 11px;
  opacity: 0.5;
}
</style>
