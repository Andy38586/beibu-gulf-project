<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

import { logger } from '@/shared/utils/logger'

const hasError = ref(false)

onErrorCaptured((err) => {
  // 错误上报（可集成 Sentry 等服务）
  if (import.meta.env.DEV) {
    logger.error('[ErrorBoundary]', err)
    logger.error('错误堆栈:', err.stack)
  }

  // 副-04：降级 UI 只展示友好文案，技术细节仅 DEV 记录（生产不暴露内部 message）
  hasError.value = true
  return false // 阻止冒泡到全局
})
function reset() {
  hasError.value = false
}
</script>

<template>
  <div v-if="hasError" class="eb-wrap">
    <!-- 副-04：友好文案，不暴露技术细节（生产同样安全） -->
    <p>页面出现异常，请点击重试；若持续发生请联系管理员</p>
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
