<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  matchedXiaoqu: { type: Array, default: () => [] },
  selectedTypes: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-xiaoqu', 'close-xiaoqu'])

const activeXiaoqu = ref(null)

function selectXiaoqu(xq) {
  activeXiaoqu.value = xq
  emit('select-xiaoqu', xq)
}
function closeDetail() {
  activeXiaoqu.value = null
  emit('close-xiaoqu')
}

const hasResult = computed(() => props.matchedXiaoqu.length > 0)

defineExpose({
  selectXiaoqu,
  closeDetail,
  activeXiaoqu,
})
</script>

<template>
  <div v-if="hasResult" class="result-panel">
    <h4>推荐小区名单</h4>
    <ul class="xiaoqu-list">
      <li
        v-for="(xq, i) in matchedXiaoqu"
        :key="xq.id"
        :class="['xiaoqu-item', { active: activeXiaoqu?.id === xq.id }]"
        @click="selectXiaoqu(xq)"
      >
        <span class="rank">{{ i + 1 }}</span>
        <span class="name">{{ xq.name }}</span>
        <span class="score">{{ xq.score }}分</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.result-panel {
  max-height: 380px;
  overflow-y: auto;
}
.result-panel h4 {
  margin: 0 0 calc(1.25 * var(--unit));
  font-size: 16px;
  color: #333;
}
.xiaoqu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.xiaoqu-item {
  display: flex;
  align-items: center;
  gap: var(--unit);
  padding: calc(0.75 * var(--unit)) calc(0.5 * var(--unit));
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}
.xiaoqu-item:hover {
  background: #f5f7fa;
}
.xiaoqu-item.active {
  background: rgba(64, 158, 255, 0.15);
}
.rank {
  width: calc(2.5 * var(--unit));
  color: #999;
  font-size: 12px;
}
.name {
  flex: 1;
}
.score {
  color: #409eff;
  font-weight: 500;
}
</style>