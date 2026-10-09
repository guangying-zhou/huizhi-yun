<script setup lang="ts">
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import { validProductAssessmentReceipt } from '~/utils/productAssessmentReceipt'
import { supportedRICECycleModel } from '~/utils/productRICEModel'
import type { AssessmentDimension } from '~/types/productAssessment'

const props = defineProps<{ productCode: string, cycle: ProductPlanningCycle, item: ProductPlanningDetail, workspaceRevision: number }>()
type Dimension = AssessmentDimension | 'impact'
const rice = supportedRICECycleModel(props.cycle.model_version, props.cycle.model_snapshot)
const observationId = ref('')
const modelWeights = computed(() => {
  const snapshot = props.cycle.model_snapshot as { weights?: Record<string, number> } | undefined
  return snapshot?.weights
})
const emit = defineEmits<{ saved: [], cancel: [] }>()
const labels: Partial<Record<Dimension, string>> = rice ? { impact: '影响系数', confidence: '置信度', effort_person_days: '总投入（人日）' } : { strategic: '战略匹配', user_value: '用户价值', business: '经营价值', risk: '风险降低', confidence: '置信度', effort_person_days: '总投入（人日）' }
const values = reactive<Record<Dimension, string>>({ impact: 'unknown', strategic: 'unknown', user_value: 'unknown', business: 'unknown', risk: 'unknown', confidence: 'unknown', effort_person_days: '' })
const reasons = reactive<Record<Dimension, string>>({ impact: '', strategic: '', user_value: '', business: '', risk: '', confidence: '', effort_person_days: '' })
const references = reactive<Record<Dimension, string[]>>({ impact: [], strategic: [], user_value: [], business: [], risk: [], confidence: [], effort_person_days: [] })
interface Evidence { key: string, summary: string, observed_on: string, kind: string, polarity: string }
const evidence = ref<Evidence[]>([]), confirmed = ref(false), busy = ref(false), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '评估保存失败' })
const { confirm } = useConfirm()
const code = props.productCode, cycleId = props.cycle.biz_id, itemId = props.item.biz_id
const versions = { expectedRevision: props.workspaceRevision, expectedCycleRevision: props.cycle.revision, expectedItemRevision: props.item.revision, expectedScopeRevision: props.item.scope_revision, expectedEvidenceRevision: props.item.evidence_revision }
const scoreOptions = [{ label: '未知／待评估', value: 'unknown' }, ...[0, 1, 2, 3, 4, 5].map(value => ({ label: String(value), value: String(value) }))]
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
function addEvidence() {
  if (busy.value || evidence.value.length >= 100) return
  evidence.value.push({ key: `e-${crypto.randomUUID()}`, summary: '', observed_on: '', kind: 'hypothesis', polarity: 'neutral' })
}
function reference(dimension: Dimension, key: string, checked: boolean | 'indeterminate') {
  references[dimension] = checked === true ? [...new Set([...references[dimension], key])] : references[dimension].filter(value => value !== key)
}
async function removeEvidence(entry: Evidence) {
  if (busy.value) return
  busy.value = true
  try {
    if (!(await confirm({ title: '移除证据草稿', message: `移除“${entry.summary || '未填写证据'}”及各维度对它的引用。尚未保存的内容将丢失。`, tone: 'warning', confirmLabel: '移除' }))) return
    evidence.value = evidence.value.filter(value => value.key !== entry.key)
    for (const key of Object.keys(references) as Dimension[]) references[key] = references[key].filter(value => value !== entry.key)
  } finally { busy.value = false }
}
async function save() {
  if (busy.value) return
  error.value = null
  if (rice && observationId.value.trim() && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(observationId.value.trim())) {
    error.value = new Error('Reach 观测标识无效')
    return
  }
  const assessment = { model_version: props.cycle.model_version, effort_unit: 'person_day', ...(rice ? { observation_biz_id: observationId.value.trim() } : {}), ...Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(labels, key)).map(([key, value]) => [key, value === 'unknown' || value === '' ? null : key === 'impact' || key === 'confidence' || key === 'effort_person_days' ? value : Number(value)])) }
  const rationale = Object.fromEntries(Object.entries(reasons).filter(([key, value]) => Object.hasOwn(labels, key) && value.trim()))
  const evidenceReferences = Object.fromEntries(Object.entries(references).filter(([key, refs]) => Object.hasOwn(labels, key) && refs.length))
  for (const key of Object.keys(labels) as Dimension[]) {
    if ((values[key] !== 'unknown' && values[key] !== '') || reasons[key].trim()) {
      if (!reasons[key].trim() || !references[key].length) {
        error.value = new Error(`${labels[key]}需要填写依据并关联证据`)
        return
      }
    }
  }
  if (values.effort_person_days && !confirmed.value) {
    error.value = new Error('请确认总投入估计')
    return
  }
  const body = { ...versions, assessment, rationale, evidence: evidence.value.map(value => ({ ...value })), evidenceReferences, estimateConfirmed: !!values.effort_person_days && confirmed.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    const summary = Object.entries(labels).map(([key, label]) => `${label}：${values[key as Dimension] === 'unknown' || !values[key as Dimension] ? '未知' : values[key as Dimension]}`).join('\n')
    if (!(await confirm({ title: '保存评估快照', message: `${props.item.title}\n${rice ? `Reach 观测：${observationId.value.trim() || '未知'}\n` : ''}${summary}\n证据 ${evidence.value.length} 条。保存后历史不可覆盖；分数由服务端计算，不会改变已确定顺序或交付承诺。`, tone: 'warning', confirmLabel: '保存评估' }))) return
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${cycleId}/items/${itemId}/${rice ? 'rice-assessments' : 'assessments'}`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (!validProductAssessmentReceipt(response, { cycleId, itemId, workspaceRevision: props.workspaceRevision, cycleRevision: props.cycle.revision, queueRevision: props.cycle.queue_revision, rice })) throw new Error('评估回执身份或修订不完整，请使用当前内容重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('评估保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="min-w-0 space-y-5" @submit.prevent="save">
    <h1 class="break-words text-xl font-semibold">
      评估：{{ item.title }}
    </h1>
    <p class="whitespace-pre-wrap break-words text-sm">
      {{ item.scope_summary }}
    </p>
    <p class="text-sm text-muted">
      周期：{{ cycle.title }}。{{ rice ? 'RICE 人日模型；影响系数 0.25～3。' : '价值维度 0～5 分；' }}未知请保留待评估。投入包含设计、研发、测试及发布准备。
    </p>
    <p v-if="!rice" class="break-words text-sm text-muted">
      模型版本：{{ cycle.model_version }}。战略匹配 {{ modelWeights?.strategic }}%、用户价值 {{ modelWeights?.user_value }}%、经营价值 {{ modelWeights?.business }}%、风险降低 {{ modelWeights?.risk }}%。
    </p>
    <section v-if="rice" class="space-y-3 rounded-lg border border-default p-3">
      <p class="break-words text-sm">
        模型版本：{{ cycle.model_version }}。Reach 来自本事项已保存的观测，保存时核对模型和范围修订。未知可留空，分数将保持待评估。
      </p>
      <ProductsRICEObservationPicker
        :product-code="productCode"
        :item-id="item.biz_id"
        :model-version="cycle.model_version"
        :workspace-revision="workspaceRevision"
        :item-revision="item.revision"
        :scope-revision="item.scope_revision"
        :evidence-revision="item.evidence_revision"
        :disabled="busy"
        @selected="observationId = $event"
      />
      <UButton
        :to="`/products/${encodeURIComponent(productCode)}/planning-items/${item.biz_id}/reach`"
        target="_blank"
        color="neutral"
        variant="link"
        :disabled="busy"
      >
        打开 Reach 观测历史
      </UButton>
    </section>
    <section class="space-y-3">
      <h2 class="font-semibold">
        本次证据
      </h2>
      <div v-for="(entry, index) in evidence" :key="entry.key" class="space-y-3 rounded-lg border border-default p-3">
        <h3 class="font-medium">
          证据 {{ index + 1 }}
        </h3>
        <UFormField label="证据说明" required>
          <UTextarea
            v-model="entry.summary"
            :disabled="busy"
            required
            :maxlength="2000"
            class="w-full"
          />
        </UFormField>
        <div class="flex flex-wrap gap-3">
          <UFormField label="观察日期" required>
            <UInput
              v-model="entry.observed_on"
              type="date"
              :disabled="busy"
              required
            />
          </UFormField>
          <UFormField label="证据性质">
            <USelect v-model="entry.kind" :disabled="busy" :items="[{ label: '待验证假设', value: 'hypothesis' }, { label: '人工记录事实', value: 'fact' }]" />
          </UFormField>
          <UFormField label="立场">
            <USelect v-model="entry.polarity" :disabled="busy" :items="[{ label: '中性', value: 'neutral' }, { label: '支持', value: 'supporting' }, { label: '反对', value: 'opposing' }]" />
          </UFormField>
        </div>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="removeEvidence(entry)"
        >
          移除证据 {{ index + 1 }}
        </UButton>
      </div>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :disabled="busy || evidence.length >= 100"
        @click="addEvidence"
      >
        添加证据
      </UButton>
    </section>
    <section v-for="(label, dimension) in labels" :key="dimension" class="min-w-0 space-y-3 rounded-lg border border-default p-3">
      <UFormField :label="label">
        <UInput
          v-if="dimension === 'effort_person_days'"
          v-model="values[dimension]"
          :disabled="busy"
          inputmode="decimal"
          placeholder="未知可留空，最少 0.5 人日"
          pattern="[0-9]+(\.[0-9]{1,2})?"
        />
        <USelect
          v-else
          v-model="values[dimension]"
          :disabled="busy"
          :items="dimension === 'confidence' ? [{ label: '未知／待评估', value: 'unknown' }, { label: '0.50 · 合理假设', value: '0.50' }, { label: '0.80 · 有核验依据', value: '0.80' }, { label: '1.00 · 多项一致验证', value: '1.00' }] : dimension === 'impact' ? [{ label: '未知／待评估', value: 'unknown' }, ...['0.25', '0.50', '1.00', '2.00', '3.00'].map(value => ({ label: value, value }))] : scoreOptions"
        />
      </UFormField>
      <UFormField :label="`${label}依据`">
        <UTextarea
          v-model="reasons[dimension]"
          :disabled="busy"
          :maxlength="2000"
          class="w-full"
        />
      </UFormField>
      <fieldset v-if="evidence.length" class="space-y-2">
        <legend class="mb-2 text-sm">
          关联证据
        </legend>
        <UCheckbox
          v-for="(entry, index) in evidence"
          :key="entry.key"
          :model-value="references[dimension].includes(entry.key)"
          :aria-label="`${label} · 证据 ${index + 1}`"
          :label="`${label} · 证据 ${index + 1}：${entry.summary.slice(0, 60) || '尚未填写'}`"
          :disabled="busy"
          @update:model-value="reference(dimension, entry.key, $event)"
        />
      </fieldset>
    </section>
    <UCheckbox
      v-if="values.effort_person_days"
      v-model="confirmed"
      :disabled="busy"
      label="我确认本次范围的总投入估计，系统将记录我为本次确认者"
    />
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="error" class="text-sm text-muted">
      内容已保留。若版本冲突，请先保存需要保留的文字，再返回核对当前范围并重新评估。
    </p>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy">
        保存评估
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        返回评估历史
      </UButton>
    </div>
  </form>
</template>
