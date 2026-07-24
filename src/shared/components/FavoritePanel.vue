<!--
  FavoritePanel — 收藏夹抽屉面板
  右侧滑出，文件夹结构：默认收藏夹 + 私人收藏夹
  折叠时只显名称，展开后显示内容
-->
<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useFavoriteStore } from '@/stores/favoriteStore'
import { ElMessage } from 'element-plus'

defineProps({ visible: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const router = useRouter()
const store = useFavoriteStore()

const newFolderName = ref('')

/** 可移动到的文件夹列表（排除当前项所在文件夹） */
function targetFolders(excludeId) {
  return store.folders.filter(f => f.id !== excludeId)
}

function handleAddFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  store.addFolder(name)
  newFolderName.value = ''
}

function handleRemoveFolder(id) {
  store.removeFolder(id)
}

function handleToggleFolder(id) {
  store.toggleFolder(id)
}

function handleRemoveItem(itemId, folderId) {
  store.removeFromFolder(itemId, folderId)
}

function handleMoveItem(itemId, fromFolderId, toFolderId) {
  store.moveItem(itemId, fromFolderId, toFolderId)
}

function navigateTo(item) {
  if (item.route) {
    router.push(item.route)
    emit('close')
  }
}

function formatTime(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const typeLabels = { page: '页面', plan: '方案', location: '位置', analysis: '分析' }
const totalItems = computed(() => store.folders.reduce((s, f) => s + f.items.length, 0))
</script>

<template>
  <Transition name="drawer">
    <div v-if="visible" class="drawer-overlay" @click.self="emit('close')">
      <div class="drawer-panel">
        <!-- 标题 -->
        <div class="drawer-title">
          <span class="close-btn" @click="emit('close')">←</span>
          <span class="title-text">收藏夹</span>
          <span class="count-badge" v-if="totalItems">{{ totalItems }}</span>
        </div>

        <!-- 文件夹管理行 -->
        <div class="folder-toolbar">
          <span class="toolbar-label">收藏夹</span>
          <div class="add-folder-row">
            <input
              v-model="newFolderName"
              class="folder-input"
              placeholder="新收藏夹名称"
              @keyup.enter="handleAddFolder"
            />
            <button class="add-btn" @click="handleAddFolder">+ 新增</button>
          </div>
        </div>

        <!-- 文件夹列表 -->
        <div class="folder-list">
          <div
            v-for="folder in store.folders"
            :key="folder.id"
            class="folder-card"
          >
            <!-- 文件夹头部 -->
            <div class="folder-header" @click="handleToggleFolder(folder.id)">
              <span class="folder-arrow">{{ folder.expanded ? '▼' : '▶' }}</span>
              <span class="folder-name">{{ folder.name }}</span>
              <span class="folder-count">{{ folder.items.length }} 项</span>
              <button
                v-if="folder.id !== 'default'"
                class="folder-delete"
                @click.stop="handleRemoveFolder(folder.id)"
                title="删除文件夹"
              >×</button>
            </div>

            <!-- 文件夹内容（展开时） -->
            <div v-if="folder.expanded" class="folder-items">
              <div v-if="folder.items.length === 0" class="empty-hint">暂无收藏</div>
              <div
                v-for="item in folder.items"
                :key="item.id"
                class="fav-item"
                @click="navigateTo(item)"
              >
                <div class="item-main">
                  <el-tag size="small" type="info">{{ typeLabels[item.type] || item.type }}</el-tag>
                  <span class="item-title">{{ item.title }}</span>
                </div>
                <div class="item-meta">
                  <span class="item-time">{{ formatTime(item.createdAt) }}</span>
                  <div class="item-actions">
                    <!-- 移动到其他文件夹 -->
                    <select
                      v-if="targetFolders(folder.id).length > 0"
                      class="move-select"
                      @change="(e) => { if (e.target.value) handleMoveItem(item.id, folder.id, e.target.value); e.target.value = '' }"
                      @click.stop
                    >
                      <option value="">移至...</option>
                      <option v-for="t in targetFolders(folder.id)" :key="t.id" :value="t.id">{{ t.name }}</option>
                    </select>
                    <button class="item-delete" @click.stop="handleRemoveItem(item.id, folder.id)">×</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.2);
}
.drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 320px;
  height: 100%;
  background: #fff;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.drawer-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 12px 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.title-text {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.count-badge {
  background: #409eff;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
}
.close-btn {
  position: absolute;
  left: 12px;
  cursor: pointer;
  font-size: 18px;
  color: #909399;
  line-height: 1;
}
.folder-toolbar {
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.toolbar-label {
  font-size: 13px;
  font-weight: 500;
  color: #606266;
  display: block;
  margin-bottom: 6px;
}
.add-folder-row {
  display: flex;
  gap: 6px;
}
.folder-input {
  flex: 1;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
  outline: none;
}
.folder-input:focus { border-color: #409eff; }
.add-btn {
  flex-shrink: 0;
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.add-btn:hover { background: #66b1ff; }

.folder-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.folder-card {
  margin-bottom: 6px;
  border-radius: 6px;
  background: #f5f7fa;
  overflow: hidden;
}
.folder-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.folder-header:hover { background: #ecf5ff; }
.folder-arrow { font-size: 10px; color: #909399; width: 12px; }
.folder-name { font-size: 14px; font-weight: 500; color: #303133; flex: 1; }
.folder-count { font-size: 11px; color: #c0c4cc; }
.folder-delete {
  border: none; background: none; color: #c0c4cc;
  font-size: 16px; cursor: pointer; padding: 0 2px;
}
.folder-delete:hover { color: #f56c6c; }

.folder-items { padding: 0 8px 6px; }
.empty-hint {
  padding: 12px 0;
  text-align: center;
  font-size: 12px;
  color: #c0c4cc;
}
.fav-item {
  padding: 8px 10px;
  margin-bottom: 4px;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.fav-item:hover { background: #f0f7ff; }
.item-main {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.item-title { font-size: 13px; color: #303133; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.item-time { font-size: 11px; color: #c0c4cc; }
.item-actions { display: flex; gap: 4px; align-items: center; }
.move-select {
  font-size: 11px;
  border: 1px solid #e4e7ed;
  border-radius: 3px;
  padding: 1px 2px;
  color: #606266;
  background: #fff;
  cursor: pointer;
}
.item-delete {
  border: none; background: none; color: #c0c4cc;
  font-size: 14px; cursor: pointer; padding: 0 2px;
}
.item-delete:hover { color: #f56c6c; }

.drawer-enter-active,
.drawer-leave-active { transition: all 0.25s ease; }
.drawer-enter-from { opacity: 0; }
.drawer-enter-from .drawer-panel { transform: translateX(100%); }
.drawer-leave-to { opacity: 0; }
.drawer-leave-to .drawer-panel { transform: translateX(100%); }
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel { transition: transform 0.25s ease; }
</style>
