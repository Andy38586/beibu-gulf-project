<script setup>
import { ref, computed } from 'vue'
import { useGCS } from '@/core/layout/useGCS.js'

const props = defineProps({
  matchedXiaoqu: { type: Array, default: () => [] },
  selectedTypes: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-xiaoqu', 'close-xiaoqu'])

const activeXiaoqu = ref(null)

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)

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
  max-height: calc(47.5 * v-bind(unitPx));
  overflow-y: auto;
}
.result-panel h4 {
  margin: 0 0 calc(1.25 * v-bind(unitPx));
  font-size: calc(2 * v-bind(unitPx));
  color: #333;
}
.xiaoqu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: calc(0.5 * v-bind(unitPx));
}
.xiaoqu-item {
  display: flex;
  align-items: center;
  gap: v-bind(unitPx);
  padding: calc(0.75 * v-bind(unitPx)) calc(0.5 * v-bind(unitPx));
  font-size: calc(1.75 * v-bind(unitPx));
  cursor: pointer;
  border-radius: calc(0.5 * v-bind(unitPx));
  transition: background 0.15s;
}
.xiaoqu-item:hover {
  background: #f5f7fa;
}
.xiaoqu-item.active {
  background: rgba(64, 158, 255, 0.15);
}
.rank {
  width: calc(2.5 * v-bind(unitPx));
  color: #999;
  font-size: calc(1.5 * v-bind(unitPx));
}
.name {
  flex: 1;
}
.score {
  color: #409eff;
  font-weight: 500;
}
</style>