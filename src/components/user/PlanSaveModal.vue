<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ visible: Boolean, saving: Boolean, errorMsg: String, initialName: { type: String, default: "" } })
const emit = defineEmits(['close', 'save'])

const planName = ref('')

watch(() => props.visible, (v) => {
  if (v) planName.value = props.initialName || ""
})

function handleConfirm() {
  const name = planName.value.trim()
  if (!name) return
  emit('save', name)
}

function onOverlayClick() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="save-overlay" @click.self="onOverlayClick">
      <div class="save-card">
        <button class="save-close-btn" @click="onOverlayClick">x</button>
        <h3 class="save-title">保存方案</h3>
        <form class="save-form" @submit.prevent="handleConfirm">
          <input
            v-model="planName"
            class="save-input"
            placeholder="请输入方案名称"
            autofocus
          />
          <div class="save-actions">
            <button type="button" class="cancel-btn" @click="onOverlayClick">取消</button>
            <button type="submit" class="confirm-btn" :disabled="saving || !planName.trim()">{{ saving ? '保存中...' : '保存' }}</button>
          </div>
          <p v-if="errorMsg" class="modal-error">{{ errorMsg }}</p>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.save-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}
.save-card {
  background: white;
  border-radius: 10px;
  padding: 24px;
  width: 320px;
  position: relative;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}
.save-close-btn {
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  line-height: 1;
}
.save-title {
  margin: 0 0 16px;
  font-size: 18px;
  text-align: center;
}
.save-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.save-input {
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.save-input:focus {
  border-color: #409eff;
}
.save-actions {
  display: flex;
  gap: 10px;
}
.cancel-btn {
  flex: 1;
  padding: 10px 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.15s;
}
.cancel-btn:hover {
  background: #f5f7fa;
}
.confirm-btn {
  flex: 1;
  padding: 10px 0;
  background: #409eff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s;
}
.confirm-btn:hover:not(:disabled) {
  background: #337ecc;
}
.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.modal-error {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
</style>
