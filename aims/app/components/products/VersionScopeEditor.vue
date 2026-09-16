<script setup lang="ts">
import type { ProductVersionScope } from '~/types/productVersionScope'
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, scope: ProductVersionScope, versionRevision: number }>()
const emit = defineEmits<{ saved: [], cancel: [], busy: [value: boolean] }>()
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}`)
const draft = reactive({ title: props.scope.title, description: props.scope.description || '', acceptanceCriteria: props.scope.acceptance_criteria || '', changeType: props.scope.change_type || 'new', reason: '' })
const saving = ref(false)
const mutationError = ref<Error | null>(null)
const { data: item, status, error } = await useFetch(() => `${base.value}/planning-items/${props.scope.planning_item_biz_id}`, { server: false, transform: (response: { code: number, data: ProductPlanningDetail }) => {
  if (response.code !== 0 || response.data?.product_code !== props.productCode || response.data.biz_id !== props.scope.planning_item_biz_id) throw new Error('范围来源事项响应无效')
  return response.data
} })
const { data: cycle, status: cycleStatus, error: cycleError } = await useFetch(() => `${base.value}/planning-cycles`, { server: false, query: { page: 1, pageSize: 1, status: 'open' }, transform: (response: { code: number, data: { items: ProductPlanningCycle[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.total > 1 || response.data.items.length !== response.data.total || response.data.items.some(c => c.product_code !== props.productCode || c.status !== 'open')) throw new Error('当前规划周期响应无效')
  return response.data.items[0] || null
} })
const alerts = [useApiErrorAlert(error, { fallbackTitle: '规划事项加载失败' }), useApiErrorAlert(cycleError, { fallbackTitle: '周期加载失败' }), useApiErrorAlert(mutationError, { fallbackTitle: '范围修改失败' })]
const canSave = computed(() => status.value === 'success' && item.value && ['proposed', 'in_delivery'].includes(item.value.lifecycle) && cycle.value && props.scope.status === 'planned' && Number.isSafeInteger(props.versionRevision) && props.versionRevision > 0 && draft.title.trim() && draft.acceptanceCriteria.trim() && draft.reason.trim())
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
async function save() {
  if (saving.value || !canSave.value || !item.value || !cycle.value) return
  saving.value = true
  emit('busy', true)
  mutationError.value = null
  const body = { ...draft, itemBizId: item.value.biz_id, cycleBizId: cycle.value.biz_id, expectedRevision: item.value.workspace_revision, expectedItemRevision: item.value.revision, expectedCycleRevision: cycle.value.revision, expectedQueueRevision: cycle.value.queue_revision, expectedVersionRevision: props.versionRevision }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  let saved = false
  try {
    if (!await confirm({ title: '确认修改版本范围', message: `原范围：${props.scope.title}\n新标题：${draft.title}\n范围说明：${draft.description || '无'}\n验收标准：${draft.acceptanceCriteria}\n原因：${draft.reason}\n修改后需要按新范围重新验收。`, confirmLabel: '保存范围', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { id: number, version_id: number } } }>(`${base.value}/versions/${props.scope.version_id}/features/${props.scope.id}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0 || response.data?.value?.id !== props.scope.id || response.data.value.version_id !== props.scope.version_id) throw new Error('保存结果不完整，请使用原请求重试')
    saved = true
    retry = undefined
    toast.add({ title: '版本范围已更新', color: 'success' })
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause : new Error('范围修改失败')
  } finally {
    saving.value = false
    emit('busy', false)
  }
  if (saved) emit('saved')
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <template v-for="(alert, index) in alerts" :key="index">
      <UAlert v-if="alert.value" v-bind="alert.value" />
    </template>
    <p v-if="mutationError" class="text-sm text-muted">
      输入已保留。若版本或决定已变化，请复制需要保留的修改，关闭后重新读取范围并对照修改。
    </p>
    <p v-if="status === 'pending' || cycleStatus === 'pending'" role="status" class="text-sm text-muted">
      正在读取当前规划依据…
    </p>
    <UAlert
      v-if="cycleStatus === 'success' && !cycle"
      color="warning"
      title="没有开放的规划周期"
      description="请先建立有效的周期决定，再修改版本范围。"
    />
    <p class="text-sm text-muted">
      只修改本次版本范围；事项与长期功能关联保持原有绑定。
    </p>
    <UFormField label="范围标题" required>
      <UInput
        v-model="draft.title"
        required
        :maxlength="255"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <UFormField label="范围说明">
      <UTextarea
        v-model="draft.description"
        :maxlength="10000"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <UFormField label="变更类型" required>
      <USelect v-model="draft.changeType" :items="[{ label: '新增能力', value: 'new' }, { label: '功能增强', value: 'enhancement' }, { label: '修复', value: 'fix' }, { label: '能力退役', value: 'retirement' }]" :disabled="saving" />
    </UFormField>
    <UFormField label="验收标准" required>
      <UTextarea
        v-model="draft.acceptanceCriteria"
        required
        :maxlength="10000"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <UFormField label="修改原因" required>
      <UTextarea
        v-model="draft.reason"
        required
        :maxlength="2000"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <div class="flex flex-wrap gap-2">
      <UButton type="submit" :loading="saving" :disabled="!canSave">
        保存范围
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </form>
</template>
