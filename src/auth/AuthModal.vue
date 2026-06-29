<script setup>
import { ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close'])

const { login, register } = useAuth()

const mode = ref('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

function switchMode(m) {
  mode.value = m
  errorMsg.value = ''
  confirmPassword.value = ''
}

async function handleSubmit() {
  errorMsg.value = ''
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请填写用户名和密码'
    return
  }
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      errorMsg.value = '密码长度不能少于 6 位'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = '两次密码输入不一致'
      return
    }
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await login(username.value.trim(), password.value)
    } else {
      await register(username.value.trim(), password.value)
    }
    emit('close')
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

function onOverlayClick() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="auth-overlay" @click.self="onOverlayClick">
      <div class="auth-card">
        <button class="close-btn" @click="emit('close')">x</button>
        <h3 class="auth-title">{{ mode === 'login' ? '登录' : '注册' }}</h3>
        <div class="tab-row">
          <button
            :class="['tab-btn', { active: mode === 'login' }]"
            @click="switchMode('login')"
          >登录</button>
          <button
            :class="['tab-btn', { active: mode === 'register' }]"
            @click="switchMode('register')"
          >注册</button>
        </div>
        <form class="auth-form" @submit.prevent="handleSubmit">
          <input
            v-model="username"
            class="input-field"
            placeholder="用户名"
            autocomplete="username"
          />
          <input
            v-model="password"
            class="input-field"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
          />
          <input
            v-if="mode === 'register'"
            v-model="confirmPassword"
            class="input-field"
            type="password"
            placeholder="确认密码"
            autocomplete="new-password"
          />
          <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
          <button type="submit" class="submit-btn" :disabled="loading">
            {{ loading ? '处理中...' : mode === 'login' ? '登录' : '注册' }}
          </button>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.auth-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.auth-card {
  background: white;
  border-radius: 10px;
  padding: 24px;
  width: 340px;
  position: relative;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}
.close-btn {
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
.auth-title {
  margin: 0 0 12px;
  font-size: 18px;
  text-align: center;
}
.tab-row {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #e0e0e0;
}
.tab-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  cursor: pointer;
  font-size: 14px;
  background: #f5f7fa;
  color: #666;
  transition: background 0.2s, color 0.2s;
}
.tab-btn.active {
  background: #409eff;
  color: white;
  font-weight: 500;
}
.tab-btn:not(.active):hover {
  background: #e9ecf1;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.input-field {
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.input-field:focus {
  border-color: #409eff;
}
.error-text {
  color: #e74c3c;
  font-size: 13px;
  margin: 0;
}
.submit-btn {
  padding: 10px 0;
  background: #409eff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s;
}
.submit-btn:hover:not(:disabled) {
  background: #337ecc;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
