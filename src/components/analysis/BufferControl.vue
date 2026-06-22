<script setup>
import { ref } from 'vue'
import * as turf from '@turf/turf'

const props = defineProps({
  ports: { type: Array, default: () => [] },
})
const emit = defineEmits(['buffer-result'])
const selectedPortName = ref('')
const radius = ref(10)
const calculating = ref(false)
const calcError = ref('')

function generateBuffer() {
  calcError.value = ''
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
    const buffered = turf.buffer(point, radius.value, { units: 'kilometers' })
    emit('buffer-result', buffered)
  } catch (error) {
    console.error('缓冲区计算失败:', error)
    calcError.value = '计算失败,请检查'
  } finally {
    calculating.value = false
  }
}
function clearBuffer() {
  emit('buffer-result', null)
}
</script>

<template>
  <div class="buffer-control">
    <h3>缓冲区分析</h3>
    <label>
      选择港口:
      <select v-model="selectedPortName">
        <option value="" disabled>请选择</option>
        <option v-for="p in ports" :key="p.name" :value="p.name">
          {{ p.name }}
        </option>
      </select>
    </label>
    <label>
      半径(公里):
      <input type="number" v-model.number="radius" min="0.1" step="0.5" />
    </label>
    <button @click="generateBuffer" :disabled="calculating">
      {{ calculating ? '计算中...' : '生成缓冲区' }}
    </button>
    <button @click="clearBuffer">清除</button>
    <p v-if="calcError" class="error-text">
      {{ calcError }}
    </p>
  </div>
</template>

<style scoped>
.buffer-control {
  position: absolute;
  top: 10px;
  right: 10px;
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.error-text {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
</style>
