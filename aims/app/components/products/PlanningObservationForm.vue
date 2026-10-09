<script setup lang="ts">
import type { ProductObservation } from '~/types/productObservation'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, cycle: ProductPlanningCycle, workspaceRevision: number, correction?: ProductObservation }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const known = ref(true), value = ref(''), observedAt = ref(''), evidenceSummary = ref(''), evidenceSource = ref(''), conclusion = ref(''), reason = ref('')
const busy = ref(false), error = ref<Error | null>(null)
const versions = ref({ workspace: props.workspaceRevision, cycle: props.cycle.revision })
const blocked = ref(false), refreshed = ref(false)
async function reloadPreservingDraft() {
  if (busy.value) return
  busy.value = true
  error.value = null
  refreshed.value = false
  try {
    const base = `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles`
    const permission = await $fetch<{ code: number, data: { product_code: string, status: string, observe: boolean } }>(`${base}/permissions`, { timeout: 15000 })
    if (permission.code !== 0 || permission.data?.product_code !== props.productCode || permission.data.status !== 'active' || !permission.data.observe) {
      blocked.value = true
      throw new Error('当前无观测权限或产品已归档，草稿已保留')
    }
    const response = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`${base}/${props.cycle.biz_id}`, { timeout: 15000 })
    const latest = response.data
    if (response.code !== 0 || latest?.biz_id !== props.cycle.biz_id || latest.product_code !== props.productCode || !['open', 'closed'].includes(latest.status) || !Number.isSafeInteger(latest.revision) || latest.revision < 1 || !Number.isSafeInteger(latest.workspace_revision) || latest.workspace_revision < 1) throw new Error('周期信息无效，草稿已保留')
    if (props.correction) {
      const original = await $fetch<{ code: number, data: ProductObservation & { cycle_biz_id: string, workspace_revision: number, cycle_revision: number } }>(`${base}/${props.cycle.biz_id}/observations/${props.correction.id}`, { timeout: 15000 })
      const record = original.data
      if (original.code !== 0 || record?.id !== props.correction.id || record.cycle_biz_id !== props.cycle.biz_id || record.workspace_revision !== latest.workspace_revision || record.cycle_revision !== latest.revision) throw new Error('读取期间记录发生变化，请重试；草稿已保留')
      if (record.corrected_by_id !== null) {
        blocked.value = true
        throw new Error(`原记录已由 #${record.corrected_by_id} 更正。请保留草稿并回看最新记录，不能继续更正旧记录。`)
      }
    } else if ((['name', 'unit', 'direction', 'measurement_method'] as const).some(key => latest.metric_definition?.[key] !== props.cycle.metric_definition?.[key]) || latest.baseline_value !== props.cycle.baseline_value || latest.target_value !== props.cycle.target_value) {
      blocked.value = true
      throw new Error('指标口径发生变化，请保留草稿并返回结果回看核对')
    }
    versions.value = { workspace: latest.workspace_revision, cycle: latest.revision }
    blocked.value = false
    refreshed.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('重新读取失败，草稿已保留')
  } finally {
    busy.value = false
  }
}
const alert = useApiErrorAlert(error, { fallbackTitle: '观测登记失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function save() {
  if (busy.value || blocked.value) return
  error.value = null
  const date = new Date(observedAt.value)
  if (!observedAt.value || !Number.isFinite(date.getTime()) || date.getTime() > Date.now() || (known.value && !/^-?\d{1,14}(?:\.\d{1,6})?$/.test(value.value)) || [evidenceSummary.value, evidenceSource.value, conclusion.value, reason.value].some(text => !text.trim())) {
    error.value = new Error('请填写有效观测时间、精确数值或明确未知，以及证据、结论和原因')
    return
  }
  const body = { expectedRevision: versions.value.workspace, expectedCycleRevision: versions.value.cycle, valueMode: known.value ? 'known' : 'unknown', observedValue: known.value ? value.value : null, observedAt: date.toISOString(), evidenceSummary: evidenceSummary.value, evidenceSource: evidenceSource.value, conclusion: conclusion.value, reason: reason.value, correctionOfId: props.correction?.id ?? null }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (!(await confirm({ title: props.correction ? '确认追加观测更正' : '确认登记结果观测', message: `${props.cycle.title}\n${props.correction ? `更正记录 #${props.correction.id}，原值：${props.correction.observed_value ?? '未知'}\n` : ''}指标：${props.cycle.metric_definition?.name}\n观测值：${known.value ? value.value : '未知'}\n观测时间（UTC）：${body.observedAt}\n原因：${reason.value}\n登记后保留原文，只能追加更正；不会改写周期基线或目标。`, tone: 'warning', confirmLabel: props.correction ? '追加更正' : '登记观测' }))) return
    const result = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles/${props.cycle.biz_id}/observations`, { method: 'POST', timeout: 15000, body, headers: { 'Idempotency-Key': retry.key } })
    if (result.code !== 0) throw new Error('观测登记响应不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('登记失败，填写内容已保留')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="min-w-0 space-y-4" @submit.prevent="save">
    <h1 class="break-words text-xl font-semibold">
      {{ cycle.title }} · {{ correction ? '追加更正' : '登记观测' }}
    </h1>
    <p class="break-words text-sm">
      指标：{{ cycle.metric_definition?.name }}（{{ cycle.metric_definition?.unit }}）
    </p>
    <p class="whitespace-pre-wrap break-words text-sm text-muted">
      {{ cycle.metric_definition?.measurement_method }}
    </p>
    <p class="text-sm">
      基线：{{ cycle.baseline_value ?? '未知' }} · 目标：{{ cycle.target_value ?? '未知' }}
    </p>
    <section v-if="correction" class="space-y-2 rounded-lg border border-default p-3 text-sm">
      <h2 class="font-semibold">
        原记录 #{{ correction.id }}（保留原文）
      </h2>
      <p class="break-words">
        原值：{{ correction.observed_value ?? '未知' }} · 观测时间：{{ correction.observed_at }}
      </p>
      <p class="whitespace-pre-wrap break-words">
        原证据：{{ correction.evidence.summary }} · {{ correction.evidence.source }}
      </p>
      <p class="whitespace-pre-wrap break-words">
        原结论：{{ correction.conclusion }}
      </p>
      <p class="text-muted">
        请填写完整更正结果及原因，不填写的数值需明确标为未知。
      </p>
    </section>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :disabled="busy"
      @click="reloadPreservingDraft"
    >
      重新读取并保留草稿
    </UButton>
    <UAlert
      v-if="refreshed"
      color="info"
      title="已读取最新版本，填写内容已保留"
      description="请核对观测结果和原因，再确认提交。"
    />
    <UCheckbox v-model="known" label="观测值已知" :disabled="busy" />
    <UFormField
      v-if="known"
      label="观测值"
      required
      description="最多 14 位整数、6 位小数；未知时取消勾选，不填零。"
    >
      <UInput
        v-model="value"
        class="w-full"
        :disabled="busy"
        required
        inputmode="decimal"
      />
    </UFormField>
    <UFormField label="观测时间（本地时区）" required description="按当前浏览器时区输入，提交时转换为 UTC。">
      <UInput
        v-model="observedAt"
        type="datetime-local"
        class="w-full"
        :disabled="busy"
        required
      />
    </UFormField>
    <UFormField label="证据摘要" required>
      <UTextarea
        v-model="evidenceSummary"
        class="w-full"
        :maxlength="2000"
        :disabled="busy"
        required
      />
    </UFormField>
    <UFormField label="证据来源" required description="填写人工报表、访谈或统计记录的可追溯引用。">
      <UTextarea
        v-model="evidenceSource"
        class="w-full"
        :maxlength="2000"
        :disabled="busy"
        required
      />
    </UFormField>
    <UFormField label="结论" required>
      <UTextarea
        v-model="conclusion"
        class="w-full"
        :maxlength="2000"
        :disabled="busy"
        required
      />
    </UFormField>
    <UFormField :label="correction ? '更正原因' : '登记原因'" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :maxlength="2000"
        :disabled="busy"
        required
      />
    </UFormField>
    <div class="flex flex-wrap gap-2">
      <UButton type="submit" :loading="busy" :disabled="busy || blocked">
        {{ correction ? '追加更正' : '登记观测' }}
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        返回结果回看
      </UButton>
    </div>
  </form>
</template>
