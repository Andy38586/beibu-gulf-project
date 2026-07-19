<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: Boolean,
  saving: Boolean,
  errorMsg: String,
  initialName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'save'])

const planName = ref('')
const dialogVisible = ref(false)

watch(
  () => props.visible,
  (v) => {
    dialogVisible.value = v
    if (v) planName.value = props.initialName || ''
  },
)

function handleConfirm() {
  const name = planName.value.trim()
  if (!name) return
  emit('save', name)
}

function onClose() {
  dialogVisible.value = false
  emit('close')
}
</script>

<template>
  <el-dialog v-model="dialogVisible" title="保存方案" width="320px" @close="onClose">
    <el-form class="save-form" @submit.prevent="handleConfirm">
      <el-input v-model="planName" placeholder="请输入方案名称" size="small" maxlength="50" show-word-limit autofocus />
      <div v-if="errorMsg" class="modal-error">{{ errorMsg }}</div>
    </el-form>
    <template #footer>
      <el-button size="small" @click="onClose">取消</el-button>
      <el-button
        size="small"
        type="primary"
        :loading="saving"
        :disabled="!planName.trim()"
        @click="handleConfirm"
      >
        {{ saving ? '保存中...' : '保存' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.save-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-error {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
</style>
