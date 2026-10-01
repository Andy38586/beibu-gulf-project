<script setup lang="ts">
/**
 * 三港分摊明细面板（分流分析页左下 4×4）：
 * 数据直接消费页面已加载的 /diversion/breakdown `result.byPort`，本组件不发任何请求。
 * 港口键完全来自响应（不维护封闭港口清单）；字段缺失/undefined 按 0 容错
 *（HTTP 边界已有 schema 校验，这里再兜一层，防旧缓存/字段增删把整面板打崩）。
 */
import { computed } from 'vue'

/** byPort 值的宽松形状：数值字段全部可选，渲染层统一按 0 兜底 */
interface PortSplitRow {
  coal?: number
  grain?: number
  ironOre?: number
  total?: number
}

const props = defineProps<{
  /** /diversion/breakdown 的 byPort；null/undefined/空对象 = 尚无结果 */
  byPort?: Record<string, PortSplitRow | null | undefined> | null
  /** 页面加载中：无数据时给加载态，绝不渲染一屏 0 造成"算出来全是 0"的误读 */
  loading?: boolean
}>()

/**
 * 行预算：本面板 4×4，最多渲染 MAX_PORT_ROWS 个港口行（合计行另计，始终保留）。
 * 响应若超过上限只展示前 MAX_PORT_ROWS 个港口；合计与占比始终按**全部**港口计算
 *（不随截断缩水），并在表尾明示截断 —— "合计与可见行相加对不上"必须可解释。
 */
const MAX_PORT_ROWS = 8

/** 数值兜底：缺失/undefined/NaN/Infinity 一律按 0（负值保留，渲染崩溃比数字可疑更糟） */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const details = computed(() => {
  const byPort = props.byPort
  const rows = byPort
    ? Object.entries(byPort).map(([name, row]) => ({
        name,
        coal: num(row?.coal),
        grain: num(row?.grain),
        ironOre: num(row?.ironOre),
        total: num(row?.total),
      }))
    : []

  const total = rows.reduce(
    (acc, r) => ({
      coal: acc.coal + r.coal,
      grain: acc.grain + r.grain,
      ironOre: acc.ironOre + r.ironOre,
      total: acc.total + r.total,
    }),
    { coal: 0, grain: 0, ironOre: 0, total: 0 }
  )

  /** 占比分母 = 全部港口合计；为 0 时统一 0.0，避免 NaN/Infinity 进入 DOM */
  const pct = (value: number): string =>
    total.total > 0 ? ((value / total.total) * 100).toFixed(1) : '0.0'

  return {
    rows: rows.slice(0, MAX_PORT_ROWS).map((r) => ({ ...r, pct: pct(r.total) })),
    total,
    totalPct: pct(total.total),
    isEmpty: rows.length === 0,
    truncated: rows.length > MAX_PORT_ROWS,
    portCount: rows.length,
  }
})
</script>

<template>
  <div class="port-panel">
    <div class="port-title">三港分摊明细</div>
    <div v-if="loading && details.isEmpty" class="port-state">加载中…</div>
    <div v-else-if="details.isEmpty" class="port-state">暂无数据</div>
    <div v-else class="port-body">
      <table class="port-table">
        <thead>
          <tr>
            <th class="col-name">港口</th>
            <th>煤炭</th>
            <th>粮食</th>
            <th>铁矿石</th>
            <th>合计</th>
            <th>占比(%)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in details.rows" :key="row.name">
            <td class="col-name" :title="row.name">{{ row.name }}</td>
            <td>{{ row.coal.toFixed(2) }}</td>
            <td>{{ row.grain.toFixed(2) }}</td>
            <td>{{ row.ironOre.toFixed(2) }}</td>
            <td>{{ row.total.toFixed(2) }}</td>
            <td>{{ row.pct }}</td>
          </tr>
          <tr class="total-row">
            <td class="col-name">合计</td>
            <td>{{ details.total.coal.toFixed(2) }}</td>
            <td>{{ details.total.grain.toFixed(2) }}</td>
            <td>{{ details.total.ironOre.toFixed(2) }}</td>
            <td>{{ details.total.total.toFixed(2) }}</td>
            <td>{{ details.totalPct }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="details.truncated" class="port-hint">
        仅显示前 {{ MAX_PORT_ROWS }} / {{ details.portCount }} 个港口，合计与占比按全部港口计算
      </div>
    </div>
  </div>
</template>

<style scoped>
.port-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.port-title {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.port-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--GCS-text-muted);
  font-size: 13px;
}

.port-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.port-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11px;
}

.port-table th,
.port-table td {
  padding: 3px 2px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.port-table th {
  color: var(--GCS-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--GCS-border-default);
}

.port-table td {
  color: var(--GCS-text-regular);
}

.port-table .col-name {
  width: 22%;
  text-align: left;
}

.port-table .total-row td {
  color: var(--GCS-color-primary);
  font-weight: 600;
  border-top: 1px solid var(--GCS-border-default);
}

.port-hint {
  padding-top: 4px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--GCS-text-muted);
}
</style>
