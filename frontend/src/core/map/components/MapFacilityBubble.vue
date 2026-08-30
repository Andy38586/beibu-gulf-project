<script setup lang="ts">
/**
 * MapFacilityBubble - 附近设施信息气泡（2D）
 * 与港口气泡（MapFeatureBubble）共用 UnifiedMap 的唯一气泡宿主与 OL Overlay 锚点：
 * 全图同一时刻仅一个气泡，点其他要素即切换、点空白即关闭（切换逻辑在 UnifiedMap）。
 * 设施点不常显名称——名字只在此气泡出现；仅点击驱动（无 hover 通道）。
 * 收藏走全局 favorites 单例（itemType 'facility' 与浸没设施同型，后端白名单已含）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { FACILITY_LABELS, showModal, showToast, useAuth, useFavorites } from '@/shared'
import type { FavoriteAddInput } from '@/types'

interface FacilityBubbleData {
  id?: string
  name: string
  poiType: string
  lng: number
  lat: number
}

interface Props {
  facility: FacilityBubbleData
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (_e: 'close'): void
}>()

const router = useRouter()
const { isFavorite, addFavorite, removeFavorite, queuePendingFavorite } = useFavorites()
const { isAuthenticated } = useAuth()

const typeLabel = computed(() => FACILITY_LABELS[props.facility.poiType] ?? props.facility.poiType)
const isFav = computed(() =>
  props.facility.id ? isFavorite('facility', props.facility.id) : false
)

/** 收藏入参：snapshot 带类型与坐标（个人中心展示与恢复用） */
function toFavoriteInput(): FavoriteAddInput {
  return {
    itemType: 'facility',
    itemId: props.facility.id ?? '',
    name: props.facility.name,
    lng: props.facility.lng,
    lat: props.facility.lat,
    snapshot: {
      score: null,
      breakdown: {},
      type: props.facility.poiType,
      loss: null,
    },
  }
}

async function toggleFavorite(): Promise<void> {
  if (!props.facility.id) return
  if (!isAuthenticated.value) {
    // 未登录：记录收藏意图 + 登录引导（登录成功后自动补完，与列表收藏同一条链路）
    queuePendingFavorite(toFavoriteInput())
    showModal({
      message: '收藏功能需要登录，是否前往登录？',
      mode: 'login',
      onConfirm: () => void router.push('/profile'),
    })
    return
  }
  const already = isFav.value
  try {
    if (already) {
      await removeFavorite('facility', props.facility.id)
      showToast(`已取消收藏：${props.facility.name}`, 'success')
    } else {
      const { existed } = await addFavorite(toFavoriteInput())
      showToast(existed ? '已在收藏中' : `已收藏：${props.facility.name}`, 'success')
    }
  } catch {
    showToast('收藏操作失败，请重试', 'error')
  }
}

function handleClose(): void {
  emit('close')
}
</script>

<template>
  <div class="map-facility-bubble">
    <div class="bubble-header">
      <span class="bubble-title">{{ facility.name }}</span>
      <span class="bubble-type">{{ typeLabel }}</span>
      <button class="bubble-close" aria-label="关闭气泡" @click.stop="handleClose">×</button>
    </div>
    <div class="bubble-row">
      <span class="bubble-label">坐标</span>
      <span class="bubble-value">{{ facility.lng.toFixed(4) }}, {{ facility.lat.toFixed(4) }}</span>
    </div>
    <div class="bubble-actions">
      <button
        v-if="facility.id"
        class="bubble-fav-btn"
        :class="{ favored: isFav }"
        @click.stop="toggleFavorite"
      >
        {{ isFav ? '★ 已收藏' : '☆ 收藏' }}
      </button>
    </div>
    <!-- 尾针：指向 POI（与港口气泡同构） -->
    <div class="bubble-tail"></div>
  </div>
</template>

<style scoped>
.map-facility-bubble {
  position: relative;
  min-width: 170px;
  padding: 8px 10px;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-md);
  box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
  box-sizing: border-box;
  font-size: var(--GCS-font-size-xs);
  color: var(--GCS-text-primary);
}

.bubble-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.bubble-title {
  font-weight: 600;
  color: var(--GCS-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bubble-type {
  flex-shrink: 0;
  padding: 0 4px;
  background: var(--GCS-bg-hover);
  border-radius: var(--GCS-radius-sm);
  color: var(--GCS-text-secondary);
}

.bubble-close {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--GCS-text-secondary);
  font-size: var(--GCS-font-size-body);
  line-height: 1;
  cursor: pointer;
}

.bubble-close:hover {
  color: var(--GCS-text-primary);
}

.bubble-row {
  display: flex;
  gap: 6px;
  line-height: 1.6;
}

.bubble-label {
  flex-shrink: 0;
  color: var(--GCS-text-secondary);
}

.bubble-value {
  color: var(--GCS-text-primary);
  word-break: break-all;
}

.bubble-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}

.bubble-fav-btn {
  padding: 2px 8px;
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-sm);
  background: transparent;
  color: var(--GCS-text-secondary);
  font-size: var(--GCS-font-size-xs);
  line-height: 1.4;
  cursor: pointer;
}

.bubble-fav-btn:hover {
  color: var(--GCS-color-primary);
  border-color: var(--GCS-color-primary);
}

.bubble-fav-btn.favored {
  color: var(--GCS-color-primary);
  border-color: var(--GCS-color-primary);
}

.bubble-tail {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 9px solid var(--GCS-border-default);
}

.bubble-tail::after {
  content: '';
  position: absolute;
  left: -7px;
  top: -10px;
  width: 0;
  height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 8px solid var(--GCS-bg-panel);
}
</style>
