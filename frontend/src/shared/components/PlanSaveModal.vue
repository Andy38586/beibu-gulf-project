<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  visible?: boolean
  saving?: boolean
  errorMsg?: string
  initialName?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialName: '',
  errorMsg: '',
})
// 对外只有两个事件：`error` 曾是第三个，但组件内没有任何 emit('error') 的站点，
// 而父级绑了它 ⇒ 一条永不触发的事件通道 + 一个永不写入的父级状态。校验失败的真实
// 通道是 `errorMsg` prop（后端 400001 文案回传），故删除声明与绑定，不留注释当占位。
const emit = defineEmits<{
  close: []
  save: [name: string]
}>()

const planName = ref('')
const dialogVisible = ref(false)
/** 本地可判定的失败就地提示；字符集/长度这类权威判据的失败仍走 errorMsg */
const localError = ref('')

watch(
  () => props.visible,
  (v) => {
    dialogVisible.value = v
    if (v) {
      planName.value = props.initialName || ''
      localError.value = ''
    }
  }
)

function handleConfirm() {
  const name = planName.value.trim()
  // 只拦"空"这一类本地可判定的问题；命名字符集/长度的权威判据在后端 `PLAN_NAME_REGEX`
  //（backend/src/modules/plans/dto/plans.dto.ts 导出），非法名由后端 400001 + 文案回传，
  // 经 errorMsg 在此展示。09-11 双轨消除：此处原有一份逐字节相同的 `nameRegex` 副本，
  // 双端并行维护同一规则 → 改一端不报错、另一端静默放行，故删除。
  if (!name) {
    // 按钮路径靠 :disabled 挡住，但表单 submit（输入框内回车）绕得过它——
    // 早退若无提示，用户按了回车什么也没发生（04-D5：不许承诺驱动不了的恢复路径）
    localError.value = '请输入方案名称'
    return
  }

  localError.value = ''
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
      <el-input
        v-model="planName"
        placeholder="请输入方案名称"
        size="small"
        maxlength="50"
        show-word-limit
        autofocus
      />
      <div v-if="localError || errorMsg" class="modal-error">{{ localError || errorMsg }}</div>
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
  color: var(--GCS-color-error);
  font-size: 13px;
  margin: 0;
}
</style>
