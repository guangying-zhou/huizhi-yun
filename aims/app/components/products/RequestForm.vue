<script setup lang="ts">
interface RequestDraft { biz_id: string, revision: number, title: string, problem_statement: string | null, source_type: string, urgency_level: string, component_id?: number | null, component_name?: string | null }
const props = defineProps<{ productCode: string, workspaceRevision: number, request?: RequestDraft, initialComponentId?: number | null, initialComponentName?: string }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const title = ref(props.request?.title || '')
const problem = ref(props.request?.problem_statement || '')
const source = ref(props.request?.source_type || 'internal')
const urgency = ref(props.request?.urgency_level || 'P2')
const componentId = ref<number | null>(props.request?.component_id ?? props.initialComponentId ?? null)
const componentName = ref(props.request?.component_name || props.initialComponentName || '')
const reason = ref('')
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '需求保存失败' })
const expectedRevision = props.workspaceRevision
const expectedRequestRevision = props.request?.revision
let retry: { payload: string, key: string } | undefined
async function save() {
  if (busy.value) return
  error.value = null
  if (!title.value.trim() || !problem.value.trim() || (props.request && !reason.value.trim())) {
    error.value = new Error('请填写标题、问题说明，以及修改时的原因')
    return
  }
  const body = { expectedRevision, title: title.value, problemStatement: problem.value, sourceType: source.value, urgencyLevel: urgency.value, componentId: componentId.value,
    ...(props.request ? { expectedRequestRevision, reason: reason.value } : {}) }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests${props.request ? `/${props.request.biz_id}` : ''}`, {
      method: props.request ? 'PATCH' : 'POST', body, headers: { 'Idempotency-Key': retry.key }
    })
    if (response.code !== 0) throw new Error('保存结果不完整，请重试')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('需求保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <UAlert v-if="alert" v-bind="alert" />
    <p class="text-sm text-muted">
      紧急程度为提交建议，采纳、排序与版本安排需另行评审。保存冲突时保留当前输入，可复制后关闭并刷新重开。
    </p>
    <UFormField label="需求标题" name="requestTitle" required>
      <UInput
        v-model="title"
        :disabled="busy"
        required
        :maxlength="500"
        class="w-full"
      />
    </UFormField>
    <UFormField label="问题说明" name="requestProblem" required>
      <UTextarea
        v-model="problem"
        :disabled="busy"
        required
        :maxlength="10000"
        :rows="5"
        class="w-full"
      />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="来源类型" name="requestSource" required>
        <USelect
          v-model="source"
          :disabled="busy"
          :items="[{ label: '内部', value: 'internal' }, { label: '客户', value: 'customer' }, { label: '工程治理', value: 'engineering' }, { label: '其他', value: 'other' }]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="建议紧急程度" name="requestUrgency" required>
        <USelect
          v-model="urgency"
          :disabled="busy"
          :items="['P0', 'P1', 'P2', 'P3']"
          class="w-full"
        />
      </UFormField>
    </div>
    <UFormField label="所属模块" description="可不分类；模块只用于查找和汇总。">
      <ProductsComponentPicker
        v-model="componentId"
        :product-code="productCode"
        :disabled="busy"
        :initial-label="componentName"
        @selected="componentName = $event.name"
      />
    </UFormField>
    <UFormField
      v-if="request"
      label="修改原因"
      name="requestReason"
      required
    >
      <UTextarea
        v-model="reason"
        :disabled="busy"
        required
        :maxlength="2000"
        class="w-full"
      />
    </UFormField>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy">
        {{ request ? '保存修改' : '提交需求' }}
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
