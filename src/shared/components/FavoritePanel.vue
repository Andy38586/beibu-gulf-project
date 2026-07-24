<!--
  FavoritePanel — 通用收藏列表面板
  独立组件，不修改核心架构。
-->
<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useFavoriteStore } from '@/stores/favoriteStore'

const router = useRouter()
const favoriteStore = useFavoriteStore()

const favorites = computed(() => favoriteStore.items)

const typeLabels = {
  page: '页面',
  plan: '方案',
  location: '位置',
  analysis: '分析',
}

function removeFavorite(id) {
  favoriteStore.remove(id)
}

function navigateTo(fav) {
  if (fav.route) {
    router.push(fav.route)
  }
}

function formatTime(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="favorite-panel">
    <div class="panel-title">我的收藏</div>
    <div v-if="favorites.length === 0" class="empty-hint">
      暂无收藏
    </div>
    <div v-else class="favorite-list">
      <div
        v-for="fav in favorites"
        :key="fav.id"
        class="favorite-item"
        @click="navigateTo(fav)"
      >
        <div class="fav-header">
          <el-tag size="small" type="info">
            {{ typeLabels[fav.type] || fav.type }}
          </el-tag>
          <span class="fav-time">{{ formatTime(fav.createdAt) }}</span>
        </div>
        <div class="fav-title">{{ fav.title }}</div>
        <div v-if="fav.description" class="fav-desc">{{ fav.description }}</div>
        <el-button
          class="fav-remove"
          size="small"
          type="danger"
          text
          @click.stop="removeFavorite(fav.id)"
        >
          删除
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.favorite-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  padding: 12px 12px 8px;
  flex-shrink: 0;
}

.empty-hint {
  padding: 24px 12px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.favorite-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.favorite-item {
  padding: 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: #f5f7fa;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}

.favorite-item:hover {
  background: #ecf5ff;
}

.fav-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.fav-time {
  font-size: 11px;
  color: #c0c4cc;
}

.fav-title {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 2px;
}

.fav-desc {
  font-size: 12px;
  color: #909399;
}

.fav-remove {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 4px;
  font-size: 11px;
}
</style>
