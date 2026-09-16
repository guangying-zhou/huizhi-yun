<script setup lang="ts">
import { supportedRICECycleModel } from '~/utils/productRICEModel'
import type { ProductPlanningDetail } from '~/types/productPlanning'

type Model = { version: string, title: string, method: string, product_code: string, configuration: { reach_unit: string, reach_starts_on: string, reach_ends_on: string, reach_definition: string, source_definition: string } }
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '记录 Reach 观测', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.itemId || ''))
const base = computed(() => '/api/v1/products/' + encodeURIComponent(code.value))
const back = computed(() => '/products/' + encodeURIComponent(code.value) + '/planning-items/' + encodeURIComponent(id.value) + '/reach')
const page = ref(1)
const selected = ref<Model | null>(null)
const reach = ref<number | string>('')
const sourceReference = ref('')
const methodology = ref('')
const busy = ref(false)
const saveError = ref<Error | null>(null)
const { data: item, status, error, refresh } = await useAsyncData(() => 'reach-create:' + code.value + ':' + id.value, async () => {
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, revision: number, assess: boolean } }>(base.value + '/reach-observations/permissions')
  if (permission.code !== 0 || permission.data?.product_code !== code.value || permission.data.status !== 'active' || !permission.data.assess) throw new Error('当前不能记录 Reach，请确认产品状态与评估权限')
  const response = await $fetch<{ code: number, data: ProductPlanningDetail }>(base.value + '/planning-items/' + encodeURIComponent(id.value))
  const value = response.data
  if (response.code !== 0 || value?.biz_id !== id.value || value.product_code !== code.value || !['proposed', 'in_delivery'].includes(value.lifecycle) || value.workspace_revision !== permission.data.revision || [value.workspace_revision, value.revision, value.scope_revision, value.evidence_revision].some(revision => !Number.isSafeInteger(revision) || revision < 1)) throw new Error('事项或权限已变化，请重新读取')
  return value
}, { server: false })
const { data: models, status: modelStatus, error: modelError, refresh: refreshModels } = await useFetch(() => base.value + '/priority-models/list', {
  server: false, query: { page, pageSize: 20 },
  transform: (response: { code: number, data: { product_code: string, items: Model[], total: number, page: number, pageSize: number } }) => {
    const value = response.data
    if (response.code !== 0 || value?.product_code !== code.value || !Array.isArray(value.items) || value.items.some(model => model.product_code !== code.value || !model.version || !model.title || !model.configuration) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page.value || value.pageSize !== 20) throw new Error('模型列表不完整')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '事项加载失败' })
const modelAlert = useApiErrorAlert(modelError, { fallbackTitle: '模型加载失败' })
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '观测记录失败' })
const valid = computed(() => selected.value?.method === 'rice' && supportedRICECycleModel(selected.value.version, selected.value.configuration) && typeof reach.value === 'number' && Number.isSafeInteger(reach.value) && reach.value >= 0 && reach.value <= 1000000000 && sourceReference.value.trim() && methodology.value.trim())
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
async function reload() {
  if (busy.value) return
  selected.value = null
  retry = undefined
  saveError.value = null
  await Promise.all([refresh(), refreshModels()])
}
async function save() {
  if (busy.value || status.value !== 'success' || !item.value || !selected.value || !valid.value) return
  busy.value = true
  saveError.value = null
  const current = item.value
  const body = { expectedRevision: current.workspace_revision, expectedItemRevision: current.revision, expectedScopeRevision: current.scope_revision, expectedEvidenceRevision: current.evidence_revision, modelVersion: selected.value.version, reach: reach.value, sourceReference: sourceReference.value, methodology: methodology.value }
  const payload = JSON.stringify(body)
  try {
    if (!(await confirm({ title: '记录 Reach 观测', message: '为“' + current.title + '”记录 ' + reach.value + ' 个去重对象。保存会更新证据修订，使旧评估需要重新核对；历史记录保留。', tone: 'warning', confirmLabel: '确认记录' }))) return
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number, data: { value: { observation: { biz_id: string, product_code: string, item_biz_id: string, model_version: string, reach: number, scope_revision: number, evidence_revision: number }, item_revision: number, workspace_revision: number } } }>(base.value + '/reach-observations/items/' + encodeURIComponent(id.value), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    const observation = result?.observation
    if (response.code !== 0 || !observation?.biz_id || observation.product_code !== code.value || observation.item_biz_id !== id.value || observation.model_version !== body.modelVersion || observation.reach !== body.reach || observation.scope_revision !== body.expectedScopeRevision || observation.evidence_revision !== body.expectedEvidenceRevision + 1 || result.item_revision !== body.expectedItemRevision + 1 || result.workspace_revision !== body.expectedRevision + 1) throw new Error('观测回执不完整，请重试')
    retry = undefined
    toast.add({ title: 'Reach 观测已记录', color: 'success' })
    busy.value = false
    await navigateTo(back.value)
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('记录失败，请重试')
  } finally {
    busy.value = false
  }
}
watch([code, id], () => {
  selected.value = null
  reach.value = ''
  sourceReference.value = ''
  methodology.value = ''
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
      :to="back"
      :disabled="busy"
      color="neutral"
      variant="ghost"
    >
      返回 Reach 历史
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
      重新读取事项与模型
    </UButton>
    <template v-if="status === 'success' && item">
      <h1 class="break-words text-xl font-semibold">
        {{ item.title }}
      </h1>
      <p class="text-sm text-muted">
        先选择统计口径一致的 RICE 模型。未知数量请保持为空，不要用零代替；来源和取数方法需要可追溯。
      </p>
      <fieldset :disabled="busy" class="space-y-3">
        <legend class="font-medium">
          已发布模型（仅 RICE 可选）
        </legend>
        <div v-if="modelStatus === 'success'" class="grid gap-3 sm:grid-cols-2">
          <UButton
            v-for="model in models?.items || []"
            :key="model.version"
            :disabled="model.method !== 'rice' || !supportedRICECycleModel(model.version, model.configuration)"
            color="neutral"
            variant="outline"
            class="whitespace-normal text-left"
            @click="selected = model"
          >
            {{ model.title }} · {{ model.version }}
          </UButton>
        </div>
        <p v-if="modelStatus === 'success'" class="text-sm text-muted">
          共 {{ models?.total || 0 }} 个自定义模型版本（包含加权模型）
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
      <div v-if="selected" class="space-y-2 rounded-lg border border-default p-3">
        <p class="break-words font-medium">
          已选：{{ selected.title }} · {{ selected.version }}
        </p>
        <p>{{ selected.configuration.reach_unit === 'unique_users' ? '去重用户数' : '去重客户企业数' }} · {{ selected.configuration.reach_starts_on }} 至 {{ selected.configuration.reach_ends_on }}</p>
        <p class="whitespace-pre-wrap">
          {{ selected.configuration.reach_definition }}
        </p>
        <p class="whitespace-pre-wrap">
          来源定义：{{ selected.configuration.source_definition }}
        </p>
      </div>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="实际去重对象数量" required>
          <UInput
            v-model.number="reach"
            type="number"
            :min="0"
            :max="1000000000"
            :step="1"
            :disabled="busy"
          />
        </UFormField>
        <UFormField label="来源引用" description="例如可追溯报表编号或导出记录。请勿粘贴密钥或个人明细。" required>
          <UTextarea
            v-model="sourceReference"
            :maxlength="2000"
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
        <UFormField label="取数方法" required>
          <UTextarea
            v-model="methodology"
            :maxlength="2000"
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="saveAlert" v-bind="saveAlert" />
        <UButton type="submit" :disabled="!valid" :loading="busy">
          记录 Reach 观测
        </UButton>
      </form>
    </template>
  </div>
</template>
