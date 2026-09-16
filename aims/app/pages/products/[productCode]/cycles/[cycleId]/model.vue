<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import { supportedRICECycleModel } from '~/utils/productRICEModel'
import { supportedWeightedCycleModel } from '~/utils/productWeightedModel'

type Choice = { method: string, version: string, title: string, configuration: unknown }
type Model = Choice & { product_code: string }
const supported = (choice: Choice) => choice.method === 'rice' ? supportedRICECycleModel(choice.version, choice.configuration) : choice.method === 'weighted-value-effort' && supportedWeightedCycleModel(choice.version, choice.configuration)
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '选用周期评分模型', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.cycleId || ''))
const base = computed(() => '/api/v1/products/' + encodeURIComponent(code.value))
const page = ref(1)
const busy = ref(false)
const selected = ref<Choice | null>(null)
const reason = ref('')
const selectedWeights = computed(() => {
  if (!selected.value || !supportedWeightedCycleModel(selected.value.version, selected.value.configuration)) return null
  return (selected.value.configuration as { weights: Record<string, number> }).weights
})
const selectedRICE = computed(() => {
  if (!selected.value || selected.value.method !== 'rice' || !supported(selected.value)) return null
  return selected.value.configuration as { reach_unit: string, reach_starts_on: string, reach_ends_on: string, reach_definition: string, source_definition: string }
})
const saveError = ref<Error | null>(null)
const { data: cycle, status, error, refresh } = await useAsyncData(() => 'cycle-model:' + code.value + ':' + id.value, async () => {
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, admin: boolean, revision: number } }>(base.value + '/priority-models/permissions')
  if (permission.code !== 0 || permission.data?.product_code !== code.value || !permission.data.admin || permission.data.status !== 'active') throw new Error('当前没有选用评分模型的权限')
  const response = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(base.value + '/planning-cycles/' + id.value)
  const result = response.data
  if (response.code !== 0 || result?.biz_id !== id.value || result.product_code !== code.value || result.status !== 'draft' || result.workspace_revision !== permission.data.revision || [result.revision, result.workspace_revision, result.queue_revision].some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('周期或权限已变化，请重新读取；仅草稿周期可选用模型')
  return result
}, { server: false })
const { data: models, status: modelStatus, error: modelError, refresh: refreshModels } = await useFetch(() => base.value + '/priority-models/list', {
  server: false, query: { page, pageSize: 20 },
  transform: (response: { code: number, data: { product_code: string, items: Model[], builtin: unknown, total: number, page: number, pageSize: number } }) => {
    const result = response.data
    if (response.code !== 0 || result?.product_code !== code.value || !Array.isArray(result.items) || result.items.some(item => item.product_code !== code.value || !item.version || !item.title) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== 20 || !supportedWeightedCycleModel('weighted-value-effort-v1', result.builtin)) throw new Error('模型列表不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '周期模型加载失败' })
const modelAlert = useApiErrorAlert(modelError, { fallbackTitle: '模型列表加载失败' })
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '模型选用失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
const canSave = computed(() => status.value === 'success' && cycle.value && selected.value && selected.value.version !== cycle.value.model_version && reason.value.trim() && supported(selected.value))
async function reload() {
  if (busy.value) return
  selected.value = null
  retry = undefined
  saveError.value = null
  await Promise.all([refresh(), refreshModels()])
}
async function save() {
  if (busy.value || !canSave.value || !cycle.value || !selected.value) return
  busy.value = true
  saveError.value = null
  const source = cycle.value
  const choice = selected.value
  const body = { expectedRevision: source.workspace_revision, expectedCycleRevision: source.revision, modelVersion: choice.version, reason: reason.value }
  const payload = JSON.stringify(body)
  try {
    if (!(await confirm({ title: '选用周期评分模型', message: '将“' + source.title + '”的评分模型从 ' + source.model_version + ' 改为 ' + choice.version + '。开放后将使用该版本的冻结规则评估事项。', tone: 'warning', confirmLabel: '确认选用' }))) return
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number, data: { value: ProductPlanningCycle & { workspace_revision: number } } }>(base.value + '/priority-models/cycles/' + id.value, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || result?.biz_id !== source.biz_id || result.product_code !== code.value || result.model_version !== choice.version || result.revision !== source.revision + 1 || result.workspace_revision !== source.workspace_revision + 1 || result.queue_revision !== source.queue_revision || !supported({ ...choice, version: result.model_version, configuration: result.model_snapshot })) throw new Error('选用回执不完整，请重试')
    retry = undefined
    toast.add({ title: '周期评分模型已更新', color: 'success' })
    busy.value = false
    await navigateTo('/products/' + encodeURIComponent(code.value) + '/cycles')
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('选用失败，请重试')
  } finally {
    busy.value = false
  }
}
watch([code, id], () => {
  selected.value = null
  reason.value = ''
  page.value = 1
  retry = undefined
  saveError.value = null
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="'/products/' + encodeURIComponent(code) + '/cycles'"
      :disabled="busy"
      color="neutral"
      variant="ghost"
    >
      返回规划周期
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="modelAlert" v-bind="modelAlert" />
    <UButton
      :disabled="busy"
      :loading="status === 'pending' || modelStatus === 'pending'"
      color="neutral"
      variant="outline"
      @click="reload"
    >
      重新读取周期与模型
    </UButton>
    <template v-if="status === 'success' && cycle">
      <h1 class="break-words text-xl font-semibold">
        {{ cycle.title }}
      </h1>
      <p class="break-words text-sm">
        当前模型：{{ cycle.model_version }}
      </p>
      <p class="text-sm text-muted">
        仅无评估历史的草稿周期可以更换模型。选择不会改变候选顺序。
      </p>
      <fieldset :disabled="busy" class="space-y-3">
        <legend class="font-medium">
          选择已发布模型
        </legend>
        <UButton
          v-if="modelStatus === 'success' && models"
          color="neutral"
          variant="outline"
          @click="selected = { method: 'weighted-value-effort', version: 'weighted-value-effort-v1', title: '内置默认模型', configuration: models.builtin }"
        >
          内置默认模型（30 / 30 / 20 / 20）
        </UButton>
        <div v-if="modelStatus === 'success'" class="grid gap-3 sm:grid-cols-2">
          <UButton
            v-for="model in models?.items || []"
            :key="model.version"
            color="neutral"
            variant="outline"
            class="whitespace-normal text-left"
            :disabled="!supported(model)"
            @click="selected = model"
          >
            {{ model.title }} · {{ model.version }}
          </UButton>
        </div>
        <p v-if="modelStatus === 'success'" class="text-sm text-muted">
          共 {{ models?.total || 0 }} 个自定义版本
        </p>
        <UPagination
          v-if="modelStatus === 'success'"
          v-model:page="page"
          :disabled="busy"
          :total="models?.total || 0"
          :items-per-page="20"
          :sibling-count="0"
        />
      </fieldset>
      <form class="space-y-4" @submit.prevent="save">
        <p v-if="selected" class="break-words" role="status">
          已选择：{{ selected.title }} · {{ selected.version }}
        </p>
        <p v-if="selectedWeights" class="text-sm text-muted">
          战略匹配 {{ selectedWeights.strategic }}%、用户价值 {{ selectedWeights.user_value }}%、经营价值 {{ selectedWeights.business }}%、风险降低 {{ selectedWeights.risk }}%。
        </p>
        <div v-if="selectedRICE" class="space-y-2 break-words rounded-lg border border-default p-3 text-sm">
          <p>RICE 人日模型：{{ selectedRICE.reach_unit === 'unique_users' ? '去重用户' : '去重客户企业' }}；{{ selectedRICE.reach_starts_on }} 至 {{ selectedRICE.reach_ends_on }}。</p>
          <p>去重定义：{{ selectedRICE.reach_definition }}</p>
          <p>来源定义：{{ selectedRICE.source_definition }}</p>
          <p>选用及开放周期时，系统会检查本产品是否至少有一条当前有效且口径一致的 Reach 观测。每个事项评估仍须引用自身观测；来源定义不代表数据已自动核验。</p>
        </div>
        <UFormField label="选用原因" required>
          <UTextarea
            v-model="reason"
            :disabled="busy"
            :maxlength="2000"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="saveAlert" v-bind="saveAlert" />
        <UButton type="submit" :disabled="!canSave" :loading="busy">
          确认选用模型
        </UButton>
      </form>
    </template>
  </div>
</template>
