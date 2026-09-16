<script setup lang="ts">
interface Candidate { biz_id: string, title: string, problem_statement: string | null, revision: number, decision_status: string }
const props = defineProps<{ productCode: string, workspaceRevision: number, request: Candidate }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const { search, debounced } = useDebouncedSearch()
const page = ref(1)
watch(debounced, () => {
  page.value = 1
})
const target = ref<Candidate | null>(null)
const reason = ref(''), impact = ref(''), busy = ref(false)
const submitError = ref<Error | null>(null)
const submitAlert = useApiErrorAlert(submitError, { fallbackTitle: '需求合并失败' })
const expectedRevision = props.workspaceRevision, expectedRequestRevision = props.request.revision
const { data, status, error } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/requests`, {
  server: false, query: computed(() => ({ page: page.value, pageSize: 10, keyword: debounced.value || undefined })),
  transform: (response: { code: number, data: { items: Candidate[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0) throw new Error('目标需求响应不完整')
    return response.data
  }
})
const candidates = computed(() => status.value === 'success' ? (data.value?.items || []).filter(row => row.biz_id !== props.request.biz_id && row.decision_status !== 'merged') : [])
const loadAlert = useApiErrorAlert(error, { fallbackTitle: '目标需求加载失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
async function submit() {
  if (busy.value || !target.value) return
  submitError.value = null
  if (!reason.value.trim() || (props.request.decision_status === 'accepted' && !impact.value.trim())) {
    submitError.value = new Error('请填写合并原因及必要的影响说明')
    return
  }
  const chosen = { ...target.value }
  const body = { targetBizId: chosen.biz_id, expectedRevision, expectedRequestRevision, expectedTargetRevision: chosen.revision, reason: reason.value, impactNote: impact.value }
  const endpoint = `/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.request.biz_id}/merge`
  busy.value = true
  try {
    if (!(await confirm({ title: '确认合并产品需求', message: `将「${props.request.title}」合并到「${chosen.title}」\n原因：${body.reason}\n影响：${body.impactNote || '未补充'}\n源需求将只读保留，原证据和项目工作保留，关联评估需要复评。`, tone: 'warning', confirmLabel: '确认合并' }))) return
    const payload = JSON.stringify(body)
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const result = await $fetch<{ code: number }>(endpoint, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (result.code !== 0) throw new Error('合并结果不完整，请重试')
    emit('saved')
  } catch (cause) {
    submitError.value = cause instanceof Error ? cause : new Error('需求合并失败')
  } finally { busy.value = false }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div class="space-y-1">
      <p class="font-medium break-words">
        源需求：{{ request.title }}
      </p>
      <p class="text-sm whitespace-pre-wrap break-words">
        {{ request.problem_statement || '未填写问题说明' }}
      </p>
    </div>
    <UAlert v-if="submitAlert" v-bind="submitAlert" />
    <UFormField label="搜索目标需求" name="mergeSearch">
      <UInput
        v-model="search"
        :disabled="busy"
        placeholder="搜索同产品的需求标题或问题"
        class="w-full"
      />
    </UFormField>
    <UAlert v-if="loadAlert" v-bind="loadAlert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载目标需求…
    </p>
    <div v-else-if="status === 'success'" class="space-y-2">
      <p class="text-xs text-muted">
        匹配 {{ data?.total || 0 }} 条需求；当前页排除自身与已合并需求。
      </p>
      <p v-if="!candidates.length" class="text-sm text-muted">
        当前页没有可选目标，可换页或调整搜索。
      </p>
      <UButton
        v-for="candidate in candidates"
        :key="candidate.biz_id"
        color="neutral"
        :variant="target?.biz_id === candidate.biz_id ? 'soft' : 'outline'"
        :disabled="busy"
        class="w-full justify-start whitespace-normal text-left"
        :aria-pressed="target?.biz_id === candidate.biz_id"
        @click="target = { ...candidate }"
      >
        {{ candidate.title }}
      </UButton>
      <UPagination
        v-model:page="page"
        :disabled="busy"
        :total="data?.total || 0"
        :items-per-page="10"
        :sibling-count="0"
        show-edges
      />
    </div>
    <div v-if="target" class="space-y-1 rounded-lg border border-default p-3">
      <p class="font-medium break-words">
        合并到：{{ target.title }}
      </p>
      <p class="text-sm whitespace-pre-wrap break-words">
        {{ target.problem_statement || '未填写问题说明' }}
      </p>
    </div>
    <UFormField label="合并原因" name="mergeReason" required>
      <UTextarea
        v-model="reason"
        required
        :maxlength="2000"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <UFormField label="影响说明" name="mergeImpact" :required="request.decision_status === 'accepted'">
      <UTextarea
        v-model="impact"
        :required="request.decision_status === 'accepted'"
        :maxlength="2000"
        :disabled="busy"
        placeholder="对已规划或执行工作的影响及后续安排"
        class="w-full"
      />
    </UFormField>
    <p class="text-xs text-muted">
      合并后源需求只读保留。若需求已变化，请保留输入，取消并刷新后重新核对双方内容。
    </p>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :disabled="!target" :loading="busy">
        合并需求
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </form>
</template>
