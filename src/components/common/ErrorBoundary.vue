<!-- src/components/common/ErrorBoundary.vue -->
<script setup>
import { ref, onErrorCaptured } from 'vue'

const hasError = ref(false)
const errorMsg = ref('')

onErrorCaptured((err) => {
  console.error('[ErrorBoundary]', err)
  errorMsg.value = err.message || '未知异常'
  hasError.value = true
  return false // 阻止冒泡到全局
})
function reset() {
  hasError.value = false
  errorMsg.value = ''
}
</script>

<template>
  <div v-if="hasError" class="eb-wrap">
    <p>应用异常: {{ errorMsg }}</p>
    <button @click="reset">重试</button>
  </div>
  <slot v-else />
</template>

<style scoped>
.eb-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 12px;
}
</style>
