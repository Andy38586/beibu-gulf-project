<script setup>
/**
 * ProfilePage - 个人中心（用户工作台）
 *
 * 职责：承载用户认证与方案管理，不继承首页四象限布局。
 * Phase 5-A：改为左右分区结构，使用 GCS Cell/Panel 统一设计语言。
 * - 左侧 4×4 Panel：登录/注册 或 用户信息
 * - 右侧 4×4 Panel：我的方案列表
 * - 整体占用 8×4 Cell 的居中工作台
 */

import { ref, onMounted, computed } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { usePlans } from '@/composables/usePlans'
import { useRouter } from 'vue-router'
import { inject } from 'vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import { useGCS } from '@/core/layout/useGCS.js'
import { GAP } from '@/core/layout/config.js'

const router = useRouter()
const { login, register, logout, user } = useAuth()
const { getPlans, deletePlan } = usePlans()
const { cell } = useGCS()

const restorePlanData = inject('restorePlanData', ref(null))
const editingPlan = inject('editingPlan', ref(null))

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

onMounted(() => {
  if (user.value) {
    fetchPlans()
  }
})

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
      const tB = new Date(b.updatedAt)
      return tB - tA
    })
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
  } catch (e) {
  } finally {
    deleting.value = null
    confirmDeleteId.value = null
  }
}

function handleLoad(plan) {
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  router.push('/site-selection')
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

// 用户工作台尺寸：8×4 Cell，居中显示
const workspaceStyle = computed(() => ({
  width: cell(8, 4).width,
  height: cell(8, 4).height,
  gap: `${GAP}px`,
}))
</script>

<template>
  <div class="profile-page">
    <!-- 8×4 用户工作台：左右两个 4×4 Panel -->
    <div class="profile-workspace" :style="workspaceStyle">
      <!-- 左侧：登录/注册 或 用户信息 -->
      <GcsPanel :w="4" :h="4" class="profile-panel">
        <div class="panel-header">
          <h3>{{ user ? '个人主页' : '登录/注册' }}</h3>
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
        </div>
      </GcsPanel>

      <!-- 右侧：我的方案 -->
      <GcsPanel :w="4" :h="4" class="profile-panel">
        <div class="panel-header">
          <h3>我的方案</h3>
        </div>

        <div class="panel-body plans-body">
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
      </GcsPanel>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 用户工作台：8×4 Cell，居中定位 */
.profile-workspace {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: stretch;
  pointer-events: auto;
  padding: 0;
}

/* 左右 Panel 统一内容样式 */
.profile-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 12px;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  color: #fff;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 12px;
}

.plans-body {
  padding-top: 12px;
}

.tab-row {
  margin-bottom: 12px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.error-text {
  color: #ff8a80;
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
}

.avatar {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.15);
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
  color: #fff;
}

.section-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
}

.status-text {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  margin-top: 8px;
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
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  transition: background 0.15s;
}

.plan-item:hover {
  background: rgba(255, 255, 255, 0.15);
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
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.plan-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.confirm-hint {
  font-size: 11px;
  color: #ff8a80;
  line-height: 22px;
}
</style>
