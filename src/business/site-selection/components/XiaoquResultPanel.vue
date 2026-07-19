<script setup lang="ts">
/**
 * XiaoquResultPanel - 小区结果面板（双状态）
 *
 * 布局：4×4 Panel，内部 2 列 × 4 行网格（8个小区按钮）
 *
 * 两种状态：
 * - 显示模式：白色按钮，显示小区名称+分数
 * - 操作模式：蓝色背景，显示"保存"和"取消保存"两个按钮
 *
 * 交互流程：
 * 1. 点击显示模式按钮 → 进入操作模式
 * 2. 操作模式3秒无操作 → 自动返回显示模式
 * 3. 点击"保存" → 检查登录状态，未登录弹提示框
 * 4. 点击"取消保存" → 小区变为未保存状态（白色），返回显示模式
 */

import { ref, computed, onUnmounted } from 'vue'
import { useAuth } from '@/shared/composables/useAuth'
import ErrorPopup from './ErrorPopup.vue'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

interface Props {
  /** 分析结果小区列表（最多8个） */
  xiaoquList: ScoredXiaoqu[]
  /** 当前方案ID */
  planId: string | null
}

interface Emits {
  (e: 'save-xiaoqu', data: { planId: string | null; xiaoqu: ScoredXiaoqu }): void
  (e: 'remove-xiaoqu', data: { planId: string | null; xiaoquId: string }): void
  (e: 'select-xiaoqu', xiaoqu: ScoredXiaoqu): void
}

const { isAuthenticated } = useAuth()

const props = withDefaults(defineProps<Props>(), {
  xiaoquList: () => [],
  planId: null
})

const emit = defineEmits<Emits>()

/** 未登录提示弹窗状态 */
const showLoginPopup = ref<boolean>(false)
const pendingSaveXiaoquId = ref<string | null>(null)

/** 自动返回延迟（毫秒） */
const AUTO_RETURN_DELAY = 500

/** 操作模式中的小区ID */
const operatingXiaoquId = ref<string | null>(null)

/** 已保存的小区ID集合 */
const savedXiaoquIds = ref<Set<string>>(new Set())

/** 计时器存储 */
const returnTimer = ref<ReturnType<typeof setTimeout> | null>(null)

/** 面板元素引用 */
const panelRef = ref<HTMLElement | null>(null)

/** 获取小区数据 */
function getXiaoquById(id: string): ScoredXiaoqu | undefined {
  return props.xiaoquList.find(xq => xq.id === id)
}

/** 切换操作模式 */
function toggleOperation(xqId: string): void {
  // 如果已经在操作这个小区，不做处理
  if (operatingXiaoquId.value === xqId) return
  
  // 清除之前的计时器
  clearReturnTimer()
  
  // 进入操作模式
  operatingXiaoquId.value = xqId
  
  // 启动自动返回计时器
  startReturnTimer()
}

/** 启动自动返回计时器 */
function startReturnTimer(): void {
  returnTimer.value = setTimeout(() => {
    operatingXiaoquId.value = null
    returnTimer.value = null
  }, AUTO_RETURN_DELAY)
}

/** 清除自动返回计时器 */
function clearReturnTimer(): void {
  if (returnTimer.value) {
    clearTimeout(returnTimer.value)
    returnTimer.value = null
  }
}

/** 保存小区（检查登录状态） */
function handleSave(xqId: string): void {
  // 检查登录状态
  if (!isAuthenticated.value) {
    pendingSaveXiaoquId.value = xqId
    showLoginPopup.value = true
    return
  }
  
  // 已登录，执行保存逻辑
  performSave(xqId)
}

/** 执行保存操作 */
function performSave(xqId: string): void {
  const xq = getXiaoquById(xqId)
  if (!xq) return
  
  // 添加到已保存集合
  savedXiaoquIds.value.add(xqId)
  
  // 触发保存事件
  emit('save-xiaoqu', {
    planId: props.planId,
    xiaoqu: xq
  })
  
  // 退出操作模式
  operatingXiaoquId.value = null
  clearReturnTimer()
}

/** 关闭未登录提示弹窗 */
function handleCloseLoginPopup(): void {
  showLoginPopup.value = false
  pendingSaveXiaoquId.value = null
}

/** 取消保存小区 */
function handleRemove(xqId: string): void {
  // 从已保存集合移除
  savedXiaoquIds.value.delete(xqId)
  
  // 触发移除事件
  emit('remove-xiaoqu', {
    planId: props.planId,
    xiaoquId: xqId
  })
  
  // 退出操作模式
  operatingXiaoquId.value = null
  clearReturnTimer()
}

/** 选择小区（点击显示模式时触发） */
function handleSelect(xq: ScoredXiaoqu): void {
  emit('select-xiaoqu', xq)
}

/** 判断小区是否已保存 */
function isSaved(xqId: string): boolean {
  return savedXiaoquIds.value.has(xqId)
}

/** 判断是否在操作模式 */
function isOperating(xqId: string): boolean {
  return operatingXiaoquId.value === xqId
}

/** 清理计时器 */
onUnmounted(() => {
  clearReturnTimer()
})

/**
 * 获取已保存的小区ID列表（用于状态保存）
 */
function getSavedIds(): string[] {
  return Array.from(savedXiaoquIds.value)
}

/**
 * 恢复已保存的小区ID列表（用于状态恢复）
 */
function restoreSavedIds(ids: string[]): void {
  if (!ids || !Array.isArray(ids)) return
  savedXiaoquIds.value = new Set(ids)
}

/**
 * 暴露方法供父组件调用
 */
defineExpose({
  getSavedIds,
  restoreSavedIds,
})
</script>

<template>
  <div class="xiaoqu-result-panel" ref="panelRef">
    <!-- 8个小区按钮，2列×4行 -->
    <div class="xiaoqu-grid">
      <div
        v-for="(xq, index) in xiaoquList"
        :key="xq.id"
        class="xiaoqu-item"
        :class="{
          saved: isSaved(xq.id),
          operating: isOperating(xq.id)
        }"
      >
        <!-- 显示模式：白色按钮，显示名称+分数 -->
        <button
          v-if="!isOperating(xq.id)"
          class="xiaoqu-btn display-mode"
          :class="{ saved: isSaved(xq.id) }"
          @click.stop="handleSelect(xq); toggleOperation(xq.id)"
        >
          <span class="xiaoqu-rank">{{ index + 1 }}</span>
          <span class="xiaoqu-name">{{ xq.name }}</span>
          <span class="xiaoqu-score">{{ xq.score }}分</span>
        </button>

        <!-- 操作模式：蓝色背景，显示保存/取消保存按钮 -->
        <div
          v-else
          class="xiaoqu-btn operation-mode"
          @mousedown.stop
          @click.stop
        >
          <button
            class="op-btn save-btn"
            :class="{ active: isSaved(xq.id) }"
            @click.stop="handleSave(xq.id)"
          >
            保存
          </button>
          <button
            class="op-btn remove-btn"
            :class="{ active: !isSaved(xq.id) }"
            @click.stop="handleRemove(xq.id)"
          >
            取消保存
          </button>
        </div>
      </div>

      <!-- 空状态提示 -->
      <div v-if="xiaoquList.length === 0" class="empty-hint">
        暂无分析结果
      </div>
    </div>

    <!-- 未登录提示弹窗 -->
    <ErrorPopup
      :visible="showLoginPopup"
      message="请先登录后再保存小区"
      mode="login"
      @close="handleCloseLoginPopup"
    />
  </div>
</template>

<style scoped>
.xiaoqu-result-panel {
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
}

/* 按钮网格：2列×4行 */
.xiaoqu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(4, 1fr);
  gap: 10px;
  height: 100%;
}

.xiaoqu-item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  height: 100%;
}

/* 小区按钮基础样式 */
.xiaoqu-btn {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: all 0.2s ease;
  padding: 6px 4px;
  box-sizing: border-box;
}

.xiaoqu-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

/* 已保存状态：蓝色 */
.xiaoqu-btn.saved {
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

.xiaoqu-btn.saved:hover {
  background: #66b1ff;
  border-color: #66b1ff;
}

/* 排名 */
.xiaoqu-rank {
  font-size: 11px;
  opacity: 0.7;
  line-height: 1;
}

/* 小区名称 */
.xiaoqu-name {
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  max-width: 100%;
}

/* 分数 */
.xiaoqu-score {
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.xiaoqu-btn.saved .xiaoqu-score {
  color: rgba(255, 255, 255, 0.9);
}

.xiaoqu-btn:not(.saved) .xiaoqu-score {
  color: #409eff;
}

/* 操作模式容器 */
.operation-mode {
  background: #409eff;
  border-radius: 12px;
  padding: 8px;
  gap: 6px;
}

/* 操作按钮 */
.op-btn {
  flex: 1;
  height: 100%;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* 保存按钮 */
.save-btn {
  background: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.8);
}

.save-btn:hover {
  background: rgba(255, 255, 255, 0.4);
}

.save-btn.active {
  background: #fff;
  color: #409eff;
}

/* 取消保存按钮 */
.remove-btn {
  background: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.8);
}

.remove-btn:hover {
  background: rgba(255, 255, 255, 0.4);
}

.remove-btn.active {
  background: #fff;
  color: #f56c6c;
}

/* 空状态提示 */
.empty-hint {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
  text-align: center;
}
</style>
