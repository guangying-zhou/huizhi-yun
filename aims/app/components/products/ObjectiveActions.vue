<script setup lang="ts">
import type { ProductObjective, ProductObjectiveObservationView } from '~/utils/productObjectiveView'

const props = defineProps<{ objective: ProductObjective, workspaceRevision: number }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean], canCorrect: [value: boolean] }>()
defineExpose({ correct })
type Action = 'activate' | 'close' | 'reopen' | 'archive' | 'observe'
const labels: Record<Action, string> = { observe: '录入观测', activate: '启用目标', close: '结束目标', reopen: '重开目标', archive: '归档目标' }
const effects: Record<Action, string> = { observe: '实测结果及当前指标口径将保存为历史记录，不能直接覆盖。', activate: '目标进入进行中，可记录实际指标观测。', close: '目标结束后仍可补录期间内观测，结束不代表目标已达成。', reopen: '目标重新进入进行中，已有观测历史保留。', archive: '归档后不能重开或录入观测，已有历史保留。' }
const permitted: Record<ProductObjective['status'], Action[]> = { draft: ['activate', 'archive'], active: ['observe', 'close'], closed: ['observe', 'reopen', 'archive'], archived: [] }
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.objective.product_code)}/objectives`)
const { data, status, error, refresh } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number } & Record<Action | 'edit', boolean> }>(() => `${base.value}/permissions`, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '目标操作权限加载失败' })
const available = computed(() => status.value === 'success' && data.value?.code === 0 && data.value.data.product_code === props.objective.product_code && data.value.data.status === 'active' && data.value.data.revision === props.workspaceRevision ? permitted[props.objective.status].filter(action => data.value!.data[action] === true) : [])
const editing = ref(false)
const canEdit = computed(() => status.value === 'success' && data.value?.code === 0 && data.value.data.product_code === props.objective.product_code && data.value.data.status === 'active' && data.value.data.revision === props.workspaceRevision && data.value.data.edit === true && ['draft', 'active'].includes(props.objective.status))
const selected = ref<{ action: Action, objective: ProductObjective, workspaceRevision: number, correction?: ProductObjectiveObservationView } | null>(null)
const reason = ref(''), saving = ref(false), saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '目标操作失败' })
const observation = reactive({ observedOn: '', measuredValue: '', evidence: '', note: '', correctionReason: '' })
const selectedMetric = computed(() => selected.value?.correction?.metric_snapshot ?? selected.value?.objective.metric)
const valid = computed(() => {
  if (selected.value?.action !== 'observe') return !!reason.value.trim()
  const value = observation.observedOn
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && (selected.value.correction ? value === selected.value.correction.observed_on && !!observation.correctionReason.trim() : value >= selected.value.objective.starts_on && value <= selected.value.objective.ends_on) && value <= new Date().toISOString().slice(0, 10) && /^-?\d{1,14}(\.\d{1,6})?$/.test(observation.measuredValue) && !!observation.evidence.trim()
})
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function start(action: Action) {
  if (saving.value || !available.value.includes(action)) return
  selected.value = { action, objective: structuredClone(toRaw(props.objective)), workspaceRevision: props.workspaceRevision }
  reason.value = ''
  Object.assign(observation, { observedOn: '', measuredValue: '', evidence: '', note: '', correctionReason: '' })
  saveError.value = null
  retry = undefined
}
function correct(record: ProductObjectiveObservationView) {
  if (saving.value || !available.value.includes('observe') || record.superseded_by_id !== null || record.objective_id !== props.objective.id || record.product_code !== props.objective.product_code) return
  start('observe')
  if (!selected.value) return
  selected.value.correction = structuredClone(toRaw(record))
  Object.assign(observation, { observedOn: record.observed_on, measuredValue: record.measured_value, evidence: record.evidence, note: record.note, correctionReason: '' })
}
watch(() => available.value.includes('observe') && !saving.value, value => emit('canCorrect', value), { immediate: true })
async function save() {
  const selection = selected.value
  if (!selection || saving.value || !valid.value) return
  saving.value = true
  emit('busy', true)
  saveError.value = null
  const body = { expectedRevision: selection.workspaceRevision, expectedObjectiveRevision: selection.objective.revision, ...(selection.action === 'observe' ? { observedOn: observation.observedOn, measuredValue: observation.measuredValue, evidence: observation.evidence, note: observation.note, ...(selection.correction ? { correctionOfId: selection.correction.id, correctionReason: observation.correctionReason } : {}) } : { reason: reason.value }) }
  const payload = JSON.stringify({ id: selection.objective.id, action: selection.action, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!(await confirm({ title: selection.correction ? '更正观测' : labels[selection.action], message: `目标：${selection.objective.title}\n${selection.correction ? '更正沿用原观测日期和指标口径，原记录保留。' : effects[selection.action]}\n${selection.action === 'observe' ? `观测日期：${observation.observedOn}\n实测值：${observation.measuredValue} ${selectedMetric.value?.unit}\n证据：${observation.evidence}\n备注：${observation.note || '无'}${selection.correction ? `\n更正原因：${observation.correctionReason}\n原记录将保留为历史。` : ''}` : `原因：${reason.value}`}`, tone: selection.action === 'archive' ? 'danger' : 'warning', confirmLabel: selection.correction ? '保存更正' : labels[selection.action] }))) return
    const response = await $fetch<{ code: number, data: { value: { objective?: ProductObjective, workspace_revision: number, id?: number, biz_id?: string, product_code?: string, objective_id?: number, objective_revision?: number, observed_on?: string, correction_of_id?: number | null } } }, string>(`${base.value}/${selection.objective.id}/${selection.action}`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    const next = selection.action === 'activate' || selection.action === 'reopen' ? 'active' : selection.action === 'close' ? 'closed' : 'archived'
    if (response.code !== 0 || !result || result.workspace_revision !== selection.workspaceRevision + 1) throw new Error('操作回执不完整，请重试')
    if (selection.action === 'observe') {
      if (!Number.isSafeInteger(result.id) || Number(result.id) < 1 || !result.biz_id || result.product_code !== selection.objective.product_code || result.objective_id !== selection.objective.id || result.objective_revision !== (selection.correction?.objective_revision ?? selection.objective.revision) || result.observed_on !== observation.observedOn || (selection.correction && result.correction_of_id !== selection.correction.id)) throw new Error('观测回执不完整，请重试')
    } else if (!result.objective || result.objective.id !== selection.objective.id || result.objective.biz_id !== selection.objective.biz_id || result.objective.product_code !== selection.objective.product_code || result.objective.status !== next || result.objective.revision !== selection.objective.revision + 1) throw new Error('状态变更回执不完整，请重试')

    selected.value = null
    retry = undefined
    toast.add({ title: selection.correction ? '观测更正已保存' : `${labels[selection.action]}成功`, color: 'success' })
    emit('saved')
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('操作失败，请重试')
  } finally {
    saving.value = false
    emit('busy', false)
  }
}
watch(() => props.workspaceRevision, () => {
  if (!saving.value) refresh()
})
</script>

<template>
  <div class="space-y-3">
    <UAlert v-if="alert" v-bind="alert" />
    <div class="flex flex-wrap gap-2">
      <ProductsObjectiveEdit
        :objective="objective"
        :workspace-revision="workspaceRevision"
        :allowed="canEdit"
        :disabled="saving"
        @saved="emit('saved')"
        @busy="(value) => { editing = value; emit('busy', value) }"
      />
      <UButton
        v-for="action in available"
        :key="action"
        :disabled="saving || editing"
        color="neutral"
        variant="outline"
        @click="start(action)"
      >
        {{ labels[action] }}
      </UButton>
    </div>
    <UModal
      :open="!!selected"
      :title="selected?.correction ? '更正观测' : selected ? labels[selected.action] : '目标状态'"
      :description="selected?.correction ? '保留原日期及指标口径，新增更正记录，原记录不被覆盖。' : selected ? effects[selected.action] : ''"
      :dismissible="!saving"
      :close="!saving"
      @update:open="(open) => { if (!open && !saving) selected = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <p class="break-words font-medium">
            {{ selected?.objective.title }}
          </p>
          <template v-if="selected?.action === 'observe'">
            <p class="text-sm text-muted">
              {{ selectedMetric?.name }}（{{ selectedMetric?.unit }}）· 基线 {{ selectedMetric?.baseline_value }} → 目标 {{ selectedMetric?.target_value }}
            </p>
            <UFormField label="观测日期" required>
              <UInput
                v-model="observation.observedOn"
                :readonly="!!selected.correction"
                type="date"
                :min="selected.objective.starts_on"
                :max="selected.objective.ends_on"
                :disabled="saving"
                class="w-full"
              />
            </UFormField>
            <UFormField label="实测值" required>
              <UInput
                v-model="observation.measuredValue"
                inputmode="decimal"
                :disabled="saving"
                class="w-full"
              />
            </UFormField>
            <UFormField label="观测证据" required>
              <UTextarea
                v-model="observation.evidence"
                :maxlength="10000"
                :disabled="saving"
                class="w-full"
                placeholder="数据来源及统计结果"
              />
            </UFormField>
            <UFormField label="备注">
              <UTextarea
                v-model="observation.note"
                :maxlength="10000"
                :disabled="saving"
                class="w-full"
              />
            </UFormField>
            <UFormField v-if="selected.correction" label="更正原因" required>
              <UTextarea
                v-model="observation.correctionReason"
                :maxlength="2000"
                :disabled="saving"
                class="w-full"
              />
            </UFormField>
            <p class="text-sm text-muted">
              {{ selected.correction ? '更正沿用原观测日期和指标口径。' : '日期须在目标期间内且不晚于今天。' }}数值最多14位整数、6位小数。
            </p>
          </template>
          <UFormField v-else label="变更原因" required>
            <UTextarea
              v-model="reason"
              :disabled="saving"
              :maxlength="2000"
              class="w-full"
            />
          </UFormField>
          <UAlert v-if="saveAlert" v-bind="saveAlert" />
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="selected = null"
            >
              取消
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!valid">
              继续
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
