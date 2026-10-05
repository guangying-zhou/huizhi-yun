<script setup lang="ts">
const props = defineProps<{ ticketCode: string }>()
interface Feedback {
  submitted: boolean
  expectedSourceSha256?: string
  productCode: string
  title?: string
  description?: string
  requestBizId?: string
  decisionStatus?: string
  canonicalRequestBizId?: string
  canonicalDecisionStatus?: string
  progressPending?: boolean
  versions?: { versionCode: string, status: string, plannedReleaseDate: string | null, releasedAt: string | null, publicFeatureCount: number, deliveredFeatureCount: number }[]
  sourceRevision?: number
  status?: string
}
const open = ref(false)
const busy = ref(false)
const feedback = ref<Feedback | null>(null)
const error = ref('')
let generation = 0
const decisionLabels: Record<string, string> = { submitted: '待评估', evaluating: '评估中', accepted: '已采纳', deferred: '暂缓', rejected: '未采纳', merged: '已合并' }
const versionLabels: Record<string, string> = { planning: '规划中', developing: '开发中', released: '已发布', archived: '已归档' }
const statusLabels: Record<string, string> = {
  pending: '等待派发', processing: '正在派发', retry_wait: '等待重试', partial_unknown: '正在确认结果',
  succeeded: '已进入产品需求池', failed_permanent: '提交未成功，需管理员处理', dead_letter: '多次重试未成功，需管理员处理', cancelled: '派发已取消'
}
const canResume = computed(() => ['pending', 'retry_wait', 'partial_unknown'].includes(feedback.value?.status || ''))
const endpoint = computed(() => `/api/v1/service-tickets/${encodeURIComponent(props.ticketCode)}/product-request`)
async function load() {
  const current = ++generation
  busy.value = true
  error.value = ''
  feedback.value = null
  try {
    const response = await $fetch<{ code: number, data: Feedback }>(endpoint.value)
    if (current === generation) feedback.value = response.data
  } catch {
    if (current === generation) error.value = '无法读取产品反馈，请确认工单权限、产品绑定和服务状态后重试。'
  } finally {
    if (current === generation) busy.value = false
  }
}
async function submit() {
  const current = generation
  const value = feedback.value
  if (!value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await $fetch(value.submitted ? `${endpoint.value}-resume` : endpoint.value, {
      method: 'POST', body: value.submitted ? {} : { expectedSourceSha256: value.expectedSourceSha256 }
    })
    if (current === generation) await load()
  } catch {
    if (current === generation) {
      error.value = '未能确认提交结果。请刷新状态后再操作；已保存的提交会保留。'
      feedback.value = null
    }
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(open, (value) => {
  if (value) void load()
})
watch(() => props.ticketCode, () => {
  generation++
  feedback.value = null
  busy.value = false
  open.value = false
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="产品反馈"
    description="将客户需求提交到产品需求池，供产品经理评估。"
    :dismissible="!busy"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <UButton
      label="产品反馈"
      icon="i-lucide-message-square-plus"
      size="xs"
      variant="soft"
      color="neutral"
      class="ml-2"
    />
    <template #body>
      <div class="space-y-4 min-w-0">
        <p class="text-sm text-muted break-all">
          工单：{{ ticketCode }}
        </p>
        <UAlert v-if="error" color="error" :description="error" />
        <p v-if="busy" role="status" class="text-sm text-muted">
          正在处理…
        </p>
        <template v-if="feedback">
          <p class="text-sm break-all">
            产品：{{ feedback.productCode }}
          </p>
          <template v-if="feedback.submitted">
            <UAlert :color="feedback.status === 'succeeded' ? 'success' : 'info'" :title="statusLabels[feedback.status || ''] || '状态待确认'" />
            <p class="text-sm break-all">
              需求编号：{{ feedback.requestBizId }}
            </p>
            <div class="rounded-lg border border-default p-3 space-y-2">
              <p class="text-sm font-medium">
                产品评估
              </p>
              <p class="text-sm">
                {{ decisionLabels[feedback.decisionStatus || ''] || '尚未收到产品评估结果' }}
              </p>
              <p v-if="feedback.decisionStatus === 'merged' && feedback.canonicalRequestBizId" class="text-sm break-all">
                合并至需求：{{ feedback.canonicalRequestBizId }}
              </p>
            </div>
            <p v-if="feedback.canonicalDecisionStatus && feedback.decisionStatus === 'merged'" class="text-sm">
              合并后需求评估：{{ decisionLabels[feedback.canonicalDecisionStatus] || '待确认' }}
            </p>
            <section class="space-y-2" aria-label="关联版本进度">
              <h3 class="text-sm font-medium">
                关联版本进度
              </h3>
              <p v-if="feedback.progressPending !== false" class="text-sm text-muted" role="status">
                正在等待产品进度更新，可稍后刷新。
              </p>
              <template v-else>
                <p v-if="!feedback.versions?.length" class="text-sm text-muted">
                  暂无关联的公开版本信息。
                </p>
                <ul v-else class="space-y-2">
                  <li v-for="version in feedback.versions" :key="version.versionCode" class="rounded-lg border border-default p-3 space-y-1 text-sm break-words">
                    <p class="font-medium">
                      {{ version.versionCode }} · {{ versionLabels[version.status] || '待确认' }}
                    </p>
                    <p>相关公开特性：{{ version.deliveredFeatureCount }} / {{ version.publicFeatureCount }} 已交付</p>
                    <p>计划发布日期：{{ version.plannedReleaseDate || '未安排' }}</p>
                    <p>实际发布日期：{{ version.releasedAt || '未发布' }}</p>
                  </li>
                </ul>
                <p class="text-xs text-muted">
                  计划日期可能调整；产品发布不代表客户环境已部署。
                </p>
              </template>
            </section>
            <p class="text-sm text-muted">
              提交后的产品评估不改变服务工单状态。已进入需求池不代表已承诺版本或发布日期。
            </p>
          </template>
          <template v-else>
            <p class="font-medium break-words">
              {{ feedback.title }}
            </p>
            <p class="text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {{ feedback.description || '暂无说明' }}
            </p>
            <p class="text-sm text-muted">
              将提交以上产品、标题和说明。客户服务紧急度不会直接转换为产品优先级。
            </p>
          </template>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton
          label="刷新状态"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="load"
        />
        <UButton
          v-if="feedback && (!feedback.submitted || canResume)"
          :label="feedback.submitted ? '继续派发' : '确认提交需求'"
          :loading="busy"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
