<script setup>
import { ref, computed } from 'vue'
import * as turf from '@turf/turf'

const props = defineProps({
  ports: { type: Array, default: () => [] },
})
const emit = defineEmits(['buffer-result', 'overlay-result'])

const MAX_BUFFERS = 5

const selectedPortName = ref('')
const radius = ref(10)
const buffers = ref([])
const calculating = ref(false)
const calcError = ref('')

const selectedCount = computed(() => buffers.value.filter((b) => b.selected).length)
const canOverlay = computed(() => selectedCount.value >= 2)
function generateBuffer() {
  calcError.value = ''
  if (buffers.value.length >= MAX_BUFFERS) {
    calcError.value = '最多只能生成${MAX_BUFFERS}个缓冲区'
    return
  }
  const port = props.ports.find((p) => p.name === selectedPortName.value)
  if (!port) {
    calcError.value = '请先选择一个港口'
    return
  }
  if (!radius.value || radius.value <= 0) {
    calcError.value = '请输入有效半径'
    return
  }
  calculating.value = true
  try {
    const point = turf.point([port.lon, port.lat])
    const geojson = turf.buffer(point, radius.value, { units: 'kilometers' })
    buffers.value.push({
      id: Date.now(),
      label: `${port.name}-${radius.value}km`,
      geojson,
      selected: false,
    })
    emitBuffersUpdate()
  } catch (error) {
    console.error('缓冲区计算失败:', error)
    calcError.value = '计算失败,请检查'
  } finally {
    calculating.value = false
  }
}
function removeBuffer(id) {
  buffers.value = buffers.value.filter((b) => b.id !== id)
  emitBuffersUpdate()
}
function emitBuffersUpdate() {
  emit(
    'buffers-result',
    buffers.value.map((b) => ({ id: b.id, geojson: b.geojson })),
  )
}
function runOverlay() {
  calcError.value = ''
  const picked = buffers.value.filter((b) => b.selected)
  if (picked.length < 2) {
    calcError.value = '请至少选两个缓冲区进行叠加'
    return
  }
  try {
    let result = picked[0].geojson
    for (let i = 1; i < picked.length; i++) {
      result = turf.intersect(turf.featureCollection([result, picked[i].geojson]))
      if (!result) break
    }
    if (!result) {
      calcError.value = '所选缓冲区间没有可叠加区域'
      emit('overlay-result', null)
      return
    }
    emit('overlay-result', result)
  } catch (error) {
    console.error('叠加分析失败', error)
    calcError.value = '叠加分析失败'
  }
}
function clearAll() {
  buffers.value = []
  calcError.value = ''
  emitBuffersUpdate()
  emit('overlay-result', null)
}
</script>

<template>
  <div class="buffer-control">
    <h3>选址分析</h3>
    <label>
      选择港口：
      <select v-model="selectedPortName">
        <option value="" disabled>请选择</option>
        <option v-for="p in ports" :key="p.name" :value="p.name">{{ p.name }}</option>
      </select>
    </label>
    <label>
      半径（公里）：
      <input type="number" v-model.number="radius" min="0.1" step="0.5" />
    </label>
    <button @click="generateBuffer" :disabled="buffers.length >= MAX_BUFFERS">
      生成缓冲区 ({{ buffers.length }}/{{ MAX_BUFFERS }})
    </button>
    <div v-if="buffers.length" class="buffer-list">
      <div v-for="b in buffers" :key="b.id" class="buffer-item">
        <label>
          <input type="checkbox" v-model="b.selected" />
          {{ b.label }}
        </label>
        <button class="remove-btn" @click="removeBuffer(b.id)">×</button>
      </div>
    </div>
    <button @click="runOverlay" :disabled="!canOverlay" class="overlay-btn">
      叠加分析（已选 {{ selectedCount }} 个）
    </button>
    <button @click="clearAll">清空全部</button>
    <p v-if="calcError" class="error-text">{{ calcError }}</p>
  </div>
</template>

<style scoped>
.buffer-control {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 260px;
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.buffer-list {
  border-top: 1px solid #eee;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}
.buffer-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.remove-btn {
  background: none;
  border: none;
  color: #e74c3c;
  cursor: pointer;
  font-size: 14px;
}
.overlay-btn {
  background: #409eff;
  color: white;
}
.error-text {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
</style>
