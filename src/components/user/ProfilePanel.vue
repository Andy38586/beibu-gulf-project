<script setup>
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { usePlans } from '@/composables/usePlans'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'load-plan'])

const { login, register, logout, user } = useAuth()
const { getPlans, deletePlan } = usePlans()

const mode = ref('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

const plans = ref([])
const plansLoading = ref(false)
const deleting = ref(null)
const confirmDeleteId = ref(null)

watch(
  () => props.visible,
  (v) => {
    if (v && user.value) {
      fetchPlans()
    }
  },
)

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
    fetchPlans()
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

async function fetchPlans() {
  plansLoading.value = true
  try {
    const raw = await getPlans()
    plans.value = raw.slice().sort((a, b) => {
      const tA = new Date(a.updatedAt || a.createdAt)
      const tB = new Date(b.updatedeatedAt)
      return tB - tA
    })
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

async function handleDelete(id) {
  deleting.value = id
  try {
    await deletePlan(id)
    plans.value = plans.value.filter((p) => p.id !== id)
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
  } finally {
    deleting.value = null
    confirmDeleteId.value = null
  }
}

function handleLoad(plan) {
  emit('load-plan', plan)
}
async function handleLogout() {
  await logout()
  mode.value = 'login'
  plans.value = []
}
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="profile-panel" v-if="visible">
    <div class="panel-header">
      <h3>{{ user ? '个人主页' : '登录/注册' }}</h3>
      <el-button type="text" class="close-btn" @click="emit('close')">×</el-button>
    </div>

    <div class="panel-body" v-if="!user">
      <el-tabs v-model="mode" class="tab-row" @tab-change="switchMode">
        <el-tab-pane label="登录" name="login">
          <el-form :model="form" class="auth-form" @submit.prevent="handleSubmit">
            <el-input
              v-model="username"
              placeholder="用户名"
              autocomplete="username"
              size="small"
            />
            <el-input
              v-model="password"
              type="password"
              placeholder="密码"
              autocomplete="current-password"
              size="small"
            />
            <div v-if="errorMsg" class="error-text">{{ errorMsg }}</div>
            <el-button
              type="primary"
              size="small"
              class="submit-btn"
              :loading="loading"
              @click="handleSubmit"
            >
              {{ loading ? '处理中...' : '登录' }}
            </el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="注册" name="register">
          <el-form :model="form" class="auth-form" @submit.prevent="handleSubmit">
            <el-input
              v-model="username"
              placeholder="用户名"
              autocomplete="username"
              size="small"
            />
            <el-input
              v-model="password"
              type="password"
              placeholder="密码"
              autocomplete="current-password"
              size="small"
            />
            <el-input
              v-model="confirmPassword"
              type="password"
              placeholder="确认密码"
              autocomplete="new-password"
              size="small"
            />
            <div v-if="errorMsg" class="error-text">{{ errorMsg }}</div>
            <el-button
              type="primary"
              size="small"
              class="submit-btn"
              :loading="loading"
              @click="handleSubmit"
            >
              {{ loading ? '处理中...' : '注册' }}
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>

    <div class="panel-body" v-else>
      <div class="user-info">
        <div class="avatar">👤</div>
        <div class="user-details">
          <span class="user-name">{{ user.username }}</span>
          <el-button size="small" @click="handleLogout">退出</el-button>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="plans-section">
        <h4 class="section-title">我的方案</h4>
        <div v-if="plansLoading" class="status-text">加载中...</div>
        <div v-else-if="plans.length === 0" class="status-text">暂无保存的方案</div>
        <div v-else class="plan-list">
          <div v-for="plan in plans" :key="plan.id" class="plan-item">
            <div class="plan-info">
              <span class="plan-name">{{ plan.name }}</span>
              <span class="plan-time">{{ formatDate(plan.createdAt) }}</span>
            </div>
            <div class="plan-actions">
              <template v-if="confirmDeleteId === plan.id">
                <span class="confirm-hint">确认?</span>
                <el-button size="small" type="danger" @click="handleDelete(plan.id)"
                  >确认</el-button
                >
                <el-button size="small" @click="confirmDeleteId = null">取消</el-button>
              </template>
              <template v-else>
                <el-button size="small" type="primary" @click="handleLoad(plan)">加载</el-button>
                <el-button
                  size="small"
                  type="danger"
                  :loading="deleting === plan.id"
                  @click="confirmDeleteId = plan.id"
                >
                  删除
                </el-button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-panel {
  position: fixed;
  top: 70px;
  right: 20px;
  width: 280px;
  z-index: 55;
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
  padding: 15px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
  padding-bottom: 15px;
}
.panel-header h3 {
  margin: 0;
  font-size: 16px;
  color: #333;
}
.close-btn {
  font-size: 18px;
  color: #999;
  line-height: 1;
  padding: 0;
}
.panel-body {
  overflow-y: auto;
}
.tab-row {
  margin-bottom: 12px;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.error-text {
  color: #e74c3c;
  font-size: 12px;
  margin: 0;
}
.submit-btn {
  width: 100%;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 15px;
}
.avatar {
  width: 48px;
  height: 48px;
  background: #f0f2f5;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}
.user-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.user-name {
  font-size: 16px;
  font-weight: 500;
  color: #333;
}
.section-divider {
  height: 1px;
  background: #eee;
  margin: 0 -15px 15px;
}
.section-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}
.status-text {
  text-align: center;
  color: #999;
  font-size: 13px;
  margin-top: 10px;
}
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.plan-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 6px;
  transition: background 0.15s;
}
.plan-item:hover {
  background: #f0f2f5;
}
.plan-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.plan-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-time {
  font-size: 11px;
  color: #999;
}
.plan-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.confirm-hint {
  font-size: 11px;
  color: #e74c3c;
  line-height: 22px;
}
</style>
