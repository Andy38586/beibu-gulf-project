<!--
  新选址分析页（单元五）：**左侧雷达图 + 候选格名单（样式对齐旧版选址页）** + 右控制面板
  （五准则权重卡片）+ 地图热力图层。
  链路复刻预测页：状态变化 → 防抖 300ms → 启动事务（取消旧请求）→ 图层更新。
-->
<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel, useMapControls } from '@/core'
import { logger, PaginatedListPanel, useProfileSnapshot } from '@/shared'
import { useMapStore } from '@/stores'
import { useSiteSuitabilityStore } from '@/stores'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

import type { SuitabilityCriterionKey } from './constants/criteria'
import SiteSuitabilityControlPanel from './components/SiteSuitabilityControlPanel.vue'
import SuitabilityRadarPanel from './components/SuitabilityRadarPanel.vue'
import { useSiteSuitabilityLayer } from './composables/useSiteSuitabilityLayer'
import { useSiteSuitabilityRequest } from './composables/useSiteSuitabilityRequest'

const mapStore = useMapStore()
const state = useSiteSuitabilityStore()
const { flyTo } = useMapControls()

/**
 * 契约缺口（局部窄化）：⑯ schema 目前只声明 properties 的 {id, score}，而响应实际带五准则
 * 子分（后端 scoreCell 全量返回，实测线上有 inundation/terrain/land/access/demand）。
 * 雷达与列表都要用到它们 ⇒ 在此就地窄化取值；把 schema 补全（含契约快照重生成）另开一笔做。
 */
type CellProperties = { id: number; score: number } & Partial<
  Record<SuitabilityCriterionKey, number>
>

/** 列表展示上限：面板只分页展示，取前 60 足够，避免把 14 万格全塞进列表 */
const CANDIDATE_LIMIT = 60

/**
 * 候选格名单：复用共享 PaginatedListPanel（与旧版选址页的「小区名单」同一组件、同一视觉）。
 * 其 items 契约是「带坐标的评分点 + breakdown」，本页把格子按同一形状映射，
 * 五准则子分装进 breakdown（既满足契约也语义正确）。
 */
const candidates = computed<ScoredXiaoqu[]>(() => {
  const features = state.data?.features ?? []
  // 单趟 top-K（K=60）取代「全量 sort」：格网可达 14 万+，对全量做 O(n log n) 排序会在
  // 每次数据落地时白烧几十毫秒（性能取证 2026-10-02）。此处只保留前 K 个并沿途剔除。
  const top: Array<(typeof features)[number]> = []
  for (const f of features) {
    const s = f.properties?.score
    if (!Number.isFinite(s)) continue
    if (top.length < CANDIDATE_LIMIT) {
      top.push(f)
      if (top.length === CANDIDATE_LIMIT)
        top.sort((a, b) => b.properties.score - a.properties.score)
      continue
    }
    if (s > top[top.length - 1].properties.score) {
      top[top.length - 1] = f
      top.sort((a, b) => b.properties.score - a.properties.score)
    }
  }
  if (top.length < CANDIDATE_LIMIT) top.sort((a, b) => b.properties.score - a.properties.score)
  return top.map((f) => {
    const p = f.properties as CellProperties
    return {
      id: String(p.id),
      name: `格 #${p.id}`,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      score: p.score,
      breakdown: {
        inundation: p.inundation ?? 0,
        terrain: p.terrain ?? 0,
        land: p.land ?? 0,
        access: p.access ?? 0,
        demand: p.demand ?? 0,
      },
    }
  })
})

/** 点击候选格 → 地图定位（复用既有 useMapControls 通道，与浸没页/旧版选址同款） */
function flyToCandidate(item: ScoredXiaoqu): void {
  flyTo({ lng: item.lng, lat: item.lat }, { height: 1000 })
}
const { updateLayer, renderer } = useSiteSuitabilityLayer()
const { startTransaction, cancelAll } = useSiteSuitabilityRequest()

let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

// 跳转个人中心（登录）时清空交互态（无快照需求——权重为实验性交互）
useProfileSnapshot({
  save: () => undefined,
  clear: () => state.reset(),
})

async function doUpdate() {
  if (!renderer.value) return
  const { transactionId, signal } = startTransaction()
  await updateLayer(transactionId, signal)
}

watch(
  () => mapStore.currentRenderer,
  (r) => {
    if (r) {
      logger.debug('[SiteSuitabilityPage] renderer ready, loading...')
      void doUpdate()
    }
  },
  { immediate: true }
)

// 权重/过滤变化 → 防抖 300ms 统一刷新（复刻 ForecastPage 合并监听模式）
watch(
  () => [...Object.values(state.weights), state.minLandFrac],
  () => {
    clearTimeout(debounceTimer ?? undefined)
    debounceTimer = setTimeout(() => doUpdate(), DEBOUNCE_DELAY)
  }
)

onUnmounted(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  cancelAll()
  state.reset()
})
</script>

<template>
  <div class="ss-page">
    <AppLayout>
      <!-- 左侧（样式对齐旧版选址页）：左上雷达图 + 左下候选格名单 -->
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <SuitabilityRadarPanel :data="state.data" :loading="state.isRequesting" />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <PaginatedListPanel
            :items="candidates"
            :page-size="4"
            :loading="state.isRequesting"
            title="候选格名单"
            empty-text="暂无候选"
            :show-favorite="false"
            :fly-to="flyToCandidate"
          >
            <template #item="{ item, index }">
              <span class="cell-rank">{{ index + 1 }}</span>
              <span class="cell-name">{{ item.name }}</span>
              <span class="cell-score">{{ item.score.toFixed(3) }}</span>
            </template>
          </PaginatedListPanel>
        </GCSPanel>
      </template>
      <template #right>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <SiteSuitabilityControlPanel />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.ss-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ss-page :deep(.GCS-panel) {
  pointer-events: auto;
}

/* 候选名单三列（对齐旧版选址页名单的排布：排名 / 名称 / 得分） */
.cell-rank {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  color: var(--GCS-text-secondary);
}

.cell-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-score {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--GCS-text-primary);
}
</style>
