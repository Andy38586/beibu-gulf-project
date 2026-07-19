<!-- src/components/common/ErrorBoundary.vue -->
<script setup>
import { ref, onErrorCaptured } from 'vue'

const hasError = ref(false)
const errorMsg = ref('')

onErrorCaptured((err) => {
  // AUDIT-015 (错误): 错误上报（可集成 Sentry 等服务）
  console.error('[ErrorBoundary]', err)
  if (import.meta.env.DEV) {
    console.error('错误堆栈:', err.stack)
  }
  // TODO: 集成错误上报服务
  // reportErrorToService(err)
  
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
