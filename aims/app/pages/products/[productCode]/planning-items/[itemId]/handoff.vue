<script setup lang="ts">
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '转交项目需求', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const plannedVersionId = computed(() => /^\d+$/.test(String(route.query.versionId || '')) ? Number(route.query.versionId) : null)
const plannedVersionFeatureId = computed(() => /^\d+$/.test(String(route.query.scopeId || '')) ? Number(route.query.scopeId) : null)
const lightweightHandoff = computed(() => plannedVersionId.value !== null && plannedVersionFeatureId.value !== null)
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}`)
const { data: detail, status, error, refresh } = await useFetch(() => `${base.value}/planning-items/${itemId.value}`, { server: false, transform: (response: { code: number, data: ProductPlanningDetail }) => {
  if (response.code !== 0 || response.data?.biz_id !== itemId.value || response.data.product_code !== code.value || !Array.isArray(response.data.requests)) throw new Error('规划详情响应不完整')
  return response.data
} })
const { data: permission, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { handoff: boolean, status: string } }>(() => `${base.value}/planning-items/permissions`, { server: false })
const { data: cycles, error: cycleError, refresh: refreshCycles } = await useFetch(() => `${base.value}/planning-cycles`, { server: false, immediate: !lightweightHandoff.value, query: { status: 'open', page: 1, pageSize: 1 }, transform: (response: { code: number, data: { items: ProductPlanningCycle[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || response.data.total > 1 || response.data.items.some(c => c.product_code !== code.value || c.status !== 'open')) throw new Error('当前规划周期响应无效')
  return response.data.items[0] || null
} })
const { data: sources, error: sourceError, refresh: refreshSources } = await useAsyncData(() => `handoff-sources:${code.value}:${itemId.value}`, async () => {
  if (!detail.value) return []
  return await Promise.all(detail.value.requests.map(async (ref) => {
    const response = await $fetch<{ code: number, data: { biz_id: string, product_code: string, title: string, revision: number } }>(`${base.value}/requests/${ref.biz_id}`)
    if (response.code !== 0 || response.data?.biz_id !== ref.biz_id || response.data.product_code !== code.value) throw new Error('来源需求响应无效')
    return { label: response.data.title, value: ref.biz_id, revision: response.data.revision }
  }))
}, { server: false, watch: [detail] })
const project = ref<{ id: number, project_code: string, name: string, category: string, lifecycle_status: string } | null>(null)
const operation = ref<'create' | 'link'>('create')
const sourceId = ref('')
const title = ref(''), scope = ref(''), reason = ref(''), sliceKey = ref('default')
watch(detail, (value) => {
  if (value && !title.value && !scope.value) {
    title.value = value.title
    scope.value = value.scope_summary
  }
}, { immediate: true })
const requirement = ref<{ id: number, title: string, status: string } | null>(null)
const page = ref(1)
const pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const { data: requirements, status: requirementStatus, error: requirementError } = await useAsyncData(() => `handoff-requirements:${code.value}:${itemId.value}`, async () => {
  if (operation.value !== 'link' || !project.value) return null
  const selectedId = project.value.id
  const response = await $fetch<{ code: number, data: { items: { id: number, project_id: number, title: string, status: string }[], total: number } }>('/api/v1/requirements', { query: { project_id: selectedId, search: debounced.value || undefined, page: page.value, pageSize } })
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.items.some(r => Number(r.project_id) !== selectedId || !Number.isSafeInteger(Number(r.id)))) throw new Error('项目需求响应无效')
  return { ...response.data, projectId: selectedId, items: response.data.items.map(r => ({ ...r, id: Number(r.id) })) }
}, { server: false, watch: [project, operation, debounced, page] })
watch([project, operation], () => {
  requirement.value = null
  page.value = 1
})
const busy = ref(false)
const mutationError = ref<Error | null>(null)
const alerts = [useApiErrorAlert(permissionError, { fallbackTitle: '规划权限加载失败' }), useApiErrorAlert(error, { fallbackTitle: '规划加载失败' }), useApiErrorAlert(cycleError, { fallbackTitle: '周期加载失败' }), useApiErrorAlert(sourceError, { fallbackTitle: '来源加载失败' }), useApiErrorAlert(requirementError, { fallbackTitle: '项目需求加载失败' }), useApiErrorAlert(mutationError, { fallbackTitle: '转交失败' })]
const canSubmit = computed(() => status.value === 'success' && detail.value && !['merged', 'delivered', 'cancelled'].includes(detail.value.lifecycle) && permission.value?.code === 0 && permission.value.data.handoff && permission.value.data.status === 'active' && (lightweightHandoff.value || cycles.value) && project.value && (!detail.value.requests.length || sources.value?.some(s => s.value === sourceId.value)) && (operation.value === 'create' ? title.value.trim() : requirement.value) && scope.value.trim() && reason.value.trim())
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
async function reload() {
  if (busy.value) return
  retry = undefined
  await Promise.all([refresh(), refreshPermission(), refreshSources(), ...(lightweightHandoff.value ? [] : [refreshCycles()])])
}
async function save() {
  if (busy.value || !canSubmit.value || !detail.value || (!lightweightHandoff.value && !cycles.value) || !project.value) return
  busy.value = true
  mutationError.value = null
  const source = sources.value?.find(s => s.value === sourceId.value)
  const body = { expectedRevision: detail.value.workspace_revision, expectedItemRevision: detail.value.revision, projectCode: project.value.project_code, sliceKey: sliceKey.value, operation: operation.value, title: operation.value === 'create' ? title.value : '', requirementId: operation.value === 'link' ? requirement.value!.id : 0, scopeSummary: scope.value, reason: reason.value, ...(lightweightHandoff.value ? { plannedVersionId: plannedVersionId.value, plannedVersionFeatureId: plannedVersionFeatureId.value } : { cycleBizId: cycles.value!.biz_id, expectedCycleRevision: cycles.value!.revision, expectedQueueRevision: cycles.value!.queue_revision }), ...(source ? { requestBizId: source.value, expectedRequestRevision: source.revision } : {}) }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    if (!await confirm({ title: '确认转交项目需求', message: `事项：${detail.value.title}\n项目：${project.value.name}\n操作：${operation.value === 'create' ? `创建草稿「${title.value}」` : `关联「${requirement.value!.title}」`}\n交付切片：${sliceKey.value}\n范围：${scope.value}\n原因：${reason.value}\n项目后续仍须按评审与基线流程执行。`, confirmLabel: '确认转交', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { requirement_id: number } } }>(`${base.value}/planning-items/${itemId.value}/handoffs`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0 || !Number.isSafeInteger(response.data?.value?.requirement_id)) throw new Error('转交结果不完整，请使用原请求重试')
    retry = undefined
    toast.add({ title: '项目需求转交成功', color: 'success' })
    await Promise.all([refresh(), refreshPermission(), ...(lightweightHandoff.value ? [] : [refreshCycles()])])
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause : new Error('转交失败')
  } finally {
    busy.value = false
  }
}
watch([code, itemId], () => {
  project.value = null
  sourceId.value = ''
  title.value = ''
  scope.value = ''
  reason.value = ''
  sliceKey.value = 'default'
  requirement.value = null
  retry = undefined
  mutationError.value = null
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="lightweightHandoff ? `/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(plannedVersionId || '')}/features#delivery-scope` : `/products/${encodeURIComponent(code)}/planning`"
      color="neutral"
      variant="ghost"
      :disabled="busy"
    >
      {{ lightweightHandoff ? '返回研发交付' : '返回高级规划' }}
    </UButton>
    <h1 class="break-words text-lg font-semibold">
      {{ detail?.title || '规划事项' }} · 转交项目
    </h1>
    <template v-for="(alert, index) in alerts" :key="index">
      <UAlert v-if="alert.value" v-bind="alert.value" />
    </template>
    <p class="text-sm text-muted">
      {{ lightweightHandoff ? '仅当前已确认版本范围可转交；失效确认、已移出范围或错误项目会被拒绝。新增项目需求先保存为草稿。' : '事项须已正式选入当前周期且决定仍有效；新增项目需求先保存为草稿。' }}
    </p>
    <p v-if="!lightweightHandoff && cycles" class="text-sm">
      当前周期：{{ cycles.title }}
    </p>
    <UAlert
      v-else-if="!lightweightHandoff"
      title="尚无开放的规划周期"
      description="请先开启周期并正式选择事项。"
      color="warning"
    />
    <UButton
      color="neutral"
      variant="outline"
      :disabled="busy"
      @click="reload"
    >
      刷新决定与权限
    </UButton>
    <UAlert v-if="permission?.code === 0 && !permission.data.handoff" title="没有该产品的转交权限" color="warning" />
    <ProductsHandoffProjectPicker v-model="project" :product-code="code" :disabled="busy" />
    <UFormField v-if="detail?.requests.length" label="本次来源需求" required>
      <USelect
        v-model="sourceId"
        :items="sources || []"
        class="w-full"
        :disabled="busy"
        placeholder="选择来源需求"
      />
    </UFormField>
    <UFormField label="转交方式">
      <USelect
        v-model="operation"
        :items="[{ label: '创建项目需求草稿', value: 'create' }, { label: '关联已有项目需求', value: 'link' }]"
        class="w-full"
        :disabled="busy"
      />
    </UFormField>
    <UFormField v-if="operation === 'create'" label="项目需求标题" required>
      <UInput
        v-model="title"
        class="w-full"
        :maxlength="500"
        :disabled="busy"
      />
    </UFormField>
    <section v-else-if="project" class="space-y-3">
      <form @submit.prevent="flush">
        <UFormField label="搜索项目需求">
          <UInput v-model="search" class="w-full" :disabled="busy" />
        </UFormField>
      </form>
      <p v-if="requirement" class="break-words text-sm">
        已选：{{ requirement.title }}
      </p>
      <p v-if="requirementStatus === 'pending'" role="status">
        正在加载项目需求…
      </p>
      <template v-if="requirementStatus === 'success' && requirements?.projectId === project.id">
        <p class="text-sm text-muted">
          共 {{ requirements.total }} 条需求；已废弃需求不能关联。
        </p>
        <div v-for="r in requirements.items" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 border-b border-default py-2">
          <span class="min-w-0 break-words">{{ r.title }}</span><UButton
            color="neutral"
            variant="outline"
            :disabled="busy || r.status === 'deprecated'"
            @click="requirement = r"
          >
            选择需求
          </UButton>
        </div>
        <UPagination
          v-if="requirements.total > pageSize"
          v-model:page="page"
          :total="requirements.total"
          :items-per-page="pageSize"
          :sibling-count="0"
          :disabled="busy"
        />
      </template>
    </section>
    <UFormField label="交付切片" description="同一事项在同一项目分批交付时使用不同名称；默认切片为 default。" required>
      <UInput
        v-model="sliceKey"
        class="w-full"
        :maxlength="191"
        :disabled="busy"
      />
    </UFormField>
    <UFormField label="本次交付范围" description="仅冻结本次范围，不覆盖已有项目需求正文。" required>
      <UTextarea
        v-model="scope"
        class="w-full"
        :rows="5"
        :maxlength="2000"
        :disabled="busy"
      />
    </UFormField>
    <UFormField label="转交原因" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :maxlength="2000"
        :disabled="busy"
      />
    </UFormField>
    <UButton :loading="busy" :disabled="!canSubmit" @click="save">
      确认转交
    </UButton>
  </div>
</template>
