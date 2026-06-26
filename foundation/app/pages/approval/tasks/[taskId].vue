<script setup lang="ts">
/**
 * 统一流程处理页面
 *
 * 左侧：业务详情（WorkflowBusinessView）
 * 右侧：审批操作（WorkflowPanel）
 *
 * 支持两种模式（通过 query 参数区分）：
 * - 默认：task 模式（taskId 为任务 ID）
 * - ?mode=instance：instance 模式（taskId 参数实际为 instanceId）
 */
import type {
  WorkflowBusinessView as BusinessViewType
} from '../../../types/workflow'
// fetchTaskDetail, fetchInstanceDetail are auto-imported from useWorkflow

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '审批处理'
})

const route = useRoute()
const taskId = computed(() => route.params.taskId as string)
const isInstanceMode = computed(() => route.query.mode === 'instance')

const loading = ref(true)
const error = ref<string | null>(null)
const businessView = ref<BusinessViewType | null>(null)
const bizTitle = ref('')
const resolvedTaskId = ref<number | null>(null)
const resolvedInstanceId = ref<number | null>(null)

async function loadData() {
  loading.value = true
  error.value = null

  try {
    if (isInstanceMode.value) {
      const res = await fetchInstanceDetail(taskId.value)
      if (res.code === 0 && res.data) {
        businessView.value = res.data.business_view
        bizTitle.value = res.data.biz_title
        resolvedInstanceId.value = res.data.id
      }
    } else {
      const res = await fetchTaskDetail(taskId.value)
      if (res.code === 0 && res.data) {
        businessView.value = res.data.business_view
        bizTitle.value = res.data.instance.biz_title
        resolvedTaskId.value = res.data.task.id
        resolvedInstanceId.value = res.data.instance.id
      }
    }
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null) {
      const withMessage = err as { message?: string, data?: { message?: string } }
      error.value = withMessage.data?.message || withMessage.message || '加载失败'
    } else {
      error.value = '加载失败'
    }
  } finally {
    loading.value = false
  }
}

if (import.meta.client) {
  onMounted(loadData)
}

function handleApproved() {
  // 审批完成后可跳回列表
  navigateTo('/approval/tasks')
}

function handleRejected() {
  navigateTo('/approval/tasks')
}
</script>

<template>
  <div class="flex h-full">
    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-dimmed" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <UIcon name="i-lucide-alert-circle" class="size-12 text-error mb-3" />
        <p class="text-sm text-muted">
          {{ error }}
        </p>
        <UButton
          size="sm"
          variant="outline"
          class="mt-3"
          @click="loadData"
        >
          重试
        </UButton>
      </div>
    </div>

    <template v-else>
      <!-- 左侧：业务详情 -->
      <div class="flex-1 min-w-0 border-r border-default">
        <WorkflowBusinessView
          v-if="businessView"
          :business-view="businessView"
          :biz-title="bizTitle"
        />
        <div v-else class="flex items-center justify-center h-full text-dimmed">
          <p class="text-sm">
            暂无业务详情视图
          </p>
        </div>
      </div>

      <!-- 右侧：审批操作面板 -->
      <div class="w-80 shrink-0 bg-default">
        <WorkflowPanel
          v-if="!isInstanceMode && resolvedTaskId"
          :task-id="resolvedTaskId"
          @approved="handleApproved"
          @rejected="handleRejected"
        />
        <WorkflowPanel
          v-else-if="isInstanceMode && resolvedInstanceId"
          :instance-id="resolvedInstanceId"
        />
      </div>
    </template>
  </div>
</template>
