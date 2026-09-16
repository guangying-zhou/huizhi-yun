<script setup lang="ts">
import { validProductObjective, type ProductObjective } from '~/utils/productObjectiveView'
import type { ObjectiveDraft } from './ObjectiveFields.vue'

const props = defineProps<{ objective: ProductObjective, workspaceRevision: number, allowed: boolean, disabled: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
const selection = ref<{ objective: ProductObjective, revision: number } | null>(null)
const draft = ref<ObjectiveDraft>({ title: '', description: '', startsOn: '', endsOn: '', ownerUid: '', metric: { name: '', unit: '', measurementDefinition: '', direction: 'increase', baselineValue: '', targetValue: '' } })
const reason = ref(''), saving = ref(false), saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '目标编辑失败' })
const decimal = (v: string) => /^-?\d{1,14}(\.\d{1,6})?$/.test(v)
function scaled(v: string) {
  const negative = v.startsWith('-')
  const [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.')
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`) * (negative ? -1n : 1n)
}
const metricValid = computed(() => {
  const m = draft.value.metric
  return !!m.name.trim() && !!m.unit.trim() && !!m.measurementDefinition.trim() && decimal(m.baselineValue) && decimal(m.targetValue) && (m.direction === 'increase' ? scaled(m.targetValue) > scaled(m.baselineValue) : m.direction === 'decrease' && scaled(m.targetValue) < scaled(m.baselineValue))
})
const valid = computed(() => !!draft.value.title.trim() && !!draft.value.ownerUid && !!draft.value.startsOn && draft.value.endsOn >= draft.value.startsOn && metricValid.value && !!reason.value.trim())
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function start() {
  if (!props.allowed || props.disabled || saving.value) return
  const o = structuredClone(toRaw(props.objective))
  selection.value = { objective: o, revision: props.workspaceRevision }
  draft.value = { title: o.title, description: o.description, startsOn: o.starts_on, endsOn: o.ends_on, ownerUid: o.owner_uid, metric: { name: o.metric.name, unit: o.metric.unit, measurementDefinition: o.metric.measurement_definition, direction: o.metric.direction, baselineValue: o.metric.baseline_value, targetValue: o.metric.target_value } }
  reason.value = ''
  saveError.value = null
  retry = undefined
}
async function save() {
  const selected = selection.value
  if (!selected || saving.value || !valid.value) return
  saving.value = true
  emit('busy', true)
  saveError.value = null
  const body = { ...draft.value, metric: { ...draft.value.metric }, expectedRevision: selected.revision, expectedObjectiveRevision: selected.objective.revision, reason: reason.value }
  const payload = JSON.stringify({ id: selected.objective.id, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!await confirm({ title: '保存目标修改', message: `目标：${body.title}\n指标：${body.metric.name}（${body.metric.unit}），基线 ${body.metric.baselineValue} → 目标 ${body.metric.targetValue}\n原因：${body.reason}\n已有观测继续使用各自保存的指标口径。`, confirmLabel: '保存修改', tone: 'warning' })) return
    const url = `/api/v1/products/${encodeURIComponent(selected.objective.product_code)}/objectives/${selected.objective.id}/edit`
    const response = await $fetch<{ code: number, data: { value: { objective: ProductObjective, workspace_revision: number } } }, string>(url, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || result.workspace_revision !== selected.revision + 1 || !validProductObjective(result.objective, selected.objective.product_code) || result.objective.id !== selected.objective.id || result.objective.biz_id !== selected.objective.biz_id || result.objective.status !== selected.objective.status || result.objective.revision !== selected.objective.revision + 1 || result.objective.title !== body.title) throw new Error('编辑回执不完整，请重试')
    selection.value = null
    retry = undefined
    toast.add({ title: '产品目标已更新', color: 'success' })
    emit('saved')
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('编辑失败，请重试')
  } finally {
    saving.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <UButton
    v-if="allowed"
    color="neutral"
    variant="outline"
    :disabled="disabled || saving"
    @click="start"
  >
    编辑目标
  </UButton>
  <UModal
    :open="!!selection"
    title="编辑产品目标"
    description="修改目标信息及指标定义。已有观测保留原口径，修改不会重算历史结果。"
    :dismissible="!saving"
    :close="!saving"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="(open) => { if (!open && !saving) selection = null }"
  >
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <ProductsObjectiveFields v-model="draft" :saving="saving" :metric-valid="metricValid" />
        <UFormField label="变更原因" required>
          <UTextarea
            v-model="reason"
            :maxlength="2000"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="saveAlert" v-bind="saveAlert" />
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="selection = null"
          >
            取消
          </UButton>
          <UButton type="submit" :disabled="!valid" :loading="saving">
            保存修改
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
