<script setup lang="ts">
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '排入产品版本', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}`)
const { data: detail, status, error, refresh } = await useFetch(() => `${base.value}/planning-items/${itemId.value}`, { server: false, transform: (response: { code: number, data: ProductPlanningDetail }) => {
  if (response.code !== 0 || response.data?.biz_id !== itemId.value || response.data.product_code !== code.value) throw new Error('规划事项响应无效')
  return response.data
} })
const { data: permission, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, scope_create: boolean, status: string } }>(() => `${base.value}/versions/permissions`, { server: false })
const { data: cycle, error: cycleError, refresh: refreshCycle } = await useFetch(() => `${base.value}/planning-cycles`, { server: false, query: { status: 'open', page: 1, pageSize: 1 }, transform: (response: { code: number, data: { items: ProductPlanningCycle[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.total > 1 || response.data.items.length !== response.data.total || response.data.items.some(c => c.product_code !== code.value || c.status !== 'open')) throw new Error('当前周期响应无效')
  return response.data.items[0] || null
} })
const version = ref<{ id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number } | null>(null)
const deferring = ref(false)
const deferredSource = ref<{ versionId: number, scopeId: number, expectedVersionRevision: number, expectedScopeRevision: number, label: string } | null>(null)
watch(deferring, () => {
  deferredSource.value = null
})
const draft = reactive({ title: '', description: '', acceptanceCriteria: '', changeType: 'new', reason: '' })
const busy = ref(false), reloading = ref(false)
const mutationError = ref<Error | null>(null)
const alerts = [useApiErrorAlert(error, { fallbackTitle: '规划加载失败' }), useApiErrorAlert(permissionError, { fallbackTitle: '版本权限加载失败' }), useApiErrorAlert(cycleError, { fallbackTitle: '周期加载失败' }), useApiErrorAlert(mutationError, { fallbackTitle: '排入版本失败' })]
const allowed = computed(() => status.value === 'success' && detail.value?.product_code === code.value && ['proposed', 'in_delivery'].includes(detail.value.lifecycle) && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.scope_create && cycle.value)
watch(detail, (value) => {
  if (value && !draft.title && !draft.description) {
    draft.title = [...value.title].slice(0, 255).join('')
    draft.description = value.scope_summary
  }
}, { immediate: true })
const canSubmit = computed(() => allowed.value && (!deferring.value || (deferredSource.value && deferredSource.value.versionId !== version.value?.id)) && version.value?.product_code === code.value && ['planning', 'developing'].includes(version.value.status) && draft.title.trim() && draft.acceptanceCriteria.trim() && draft.reason.trim())
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
async function reload() {
  if (busy.value || reloading.value) return
  reloading.value = true
  deferredSource.value = null
  try {
    await Promise.all([refresh(), refreshPermission(), refreshCycle()])
    if (version.value) {
      const response = await $fetch<{ code: number, data: NonNullable<typeof version.value> }>(`${base.value}/versions/${version.value.id}`)
      if (response.code !== 0 || response.data?.product_code !== code.value || response.data.id !== version.value.id) throw new Error('目标版本响应无效')
      version.value = response.data
    }
  } catch (cause) {
    version.value = null
    mutationError.value = cause instanceof Error ? cause : new Error('刷新失败')
  } finally {
    reloading.value = false
  }
}
async function save() {
  if (busy.value || reloading.value || !canSubmit.value || !detail.value || !cycle.value || !version.value) return
  busy.value = true
  mutationError.value = null
  const targetID = version.value.id
  const source = deferring.value ? deferredSource.value : null
  const body = { ...draft, ...(source ? { deferredFrom: { versionId: source.versionId, scopeId: source.scopeId, expectedVersionRevision: source.expectedVersionRevision, expectedScopeRevision: source.expectedScopeRevision } } : {}), itemBizId: itemId.value, cycleBizId: cycle.value.biz_id, expectedRevision: detail.value.workspace_revision, expectedItemRevision: detail.value.revision, expectedCycleRevision: cycle.value.revision, expectedQueueRevision: cycle.value.queue_revision, expectedVersionRevision: version.value.revision }
  const payload = JSON.stringify({ targetID, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  let saved = false
  try {
    if (!await confirm({ title: '确认排入产品版本', message: `规划事项：${detail.value.title}\n目标版本：${version.value.version_code} ${version.value.name || ''}\n延期来源：${source?.label || '无'}\n${source ? '原范围保留并标记顺延，原版本验收失效。\n' : ''}范围标题：${draft.title}\n范围说明：${draft.description || '无'}\n验收标准：${draft.acceptanceCriteria}\n原因：${draft.reason}`, confirmLabel: '确认排入', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { id: number, version_id: number } } }>(`${base.value}/versions/${targetID}/features`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0 || !Number.isSafeInteger(response.data?.value?.id) || response.data.value.id < 1 || response.data.value.version_id !== targetID) throw new Error('保存结果不完整，请重试')
    saved = true
    retry = undefined
    toast.add({ title: '规划事项已排入版本', color: 'success' })
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause : new Error('排入版本失败')
  } finally {
    busy.value = false
  }
  if (saved) await navigateTo(`/products/${encodeURIComponent(code.value)}/versions/${targetID}/features`)
}
watch([code, itemId], () => {
  deferring.value = false
  deferredSource.value = null
  version.value = null
  Object.assign(draft, { title: '', description: '', acceptanceCriteria: '', changeType: 'new', reason: '' })
  mutationError.value = null
  retry = undefined
})
onBeforeRouteLeave(() => !busy.value && !reloading.value)
onBeforeRouteUpdate(() => !busy.value && !reloading.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(itemId)}`"
      color="neutral"
      variant="ghost"
      :disabled="busy || reloading"
    >
      返回规划事项
    </UButton>
    <p class="text-sm text-muted">
      事项须已选入当前开放周期，且范围、证据与估算仍符合原决定。排入后形成计划范围，后续单独验收。
    </p>
    <template v-for="(alert, index) in alerts" :key="index">
      <UAlert v-if="alert.value" v-bind="alert.value" />
    </template>
    <UButton
      color="neutral"
      variant="outline"
      :loading="reloading"
      :disabled="busy"
      @click="reload"
    >
      重新读取，保留输入
    </UButton>
    <p v-if="detail" class="break-words font-medium">
      规划事项：{{ detail.title }}
    </p>
    <UAlert
      v-if="!allowed && !error && !permissionError && !cycleError"
      color="warning"
      title="当前不能安排版本"
      description="请确认产品及事项可编辑、存在开放周期，并具备版本编辑和规划决定权限。"
    />
    <form class="space-y-4" @submit.prevent="save">
      <ProductsVersionPicker v-model="version" :product-code="code" :disabled="busy || reloading" />
      <UCheckbox v-model="deferring" label="承接其他版本的延期范围" :disabled="busy || reloading" />
      <ProductsVersionDeferralPicker
        v-if="deferring"
        v-model="deferredSource"
        :product-code="code"
        :target-version-id="version?.id"
        :disabled="busy || reloading"
      />
      <p v-if="deferring && !deferredSource" class="text-sm text-muted">
        请选择原范围。重新读取后需要重新选择，以确认最新范围及版本修订。
      </p>
      <UFormField label="范围标题" required>
        <UInput
          v-model="draft.title"
          required
          :maxlength="255"
          class="w-full"
          :disabled="busy || reloading"
        />
      </UFormField>
      <UFormField label="范围说明">
        <UTextarea
          v-model="draft.description"
          :maxlength="10000"
          class="w-full"
          :disabled="busy || reloading"
        />
      </UFormField>
      <UFormField label="变更类型" required>
        <USelect v-model="draft.changeType" :items="[{ label: '新增能力', value: 'new' }, { label: '功能增强', value: 'enhancement' }, { label: '修复', value: 'fix' }, { label: '能力退役', value: 'retirement' }]" :disabled="busy || reloading" />
      </UFormField>
      <UFormField label="验收标准" required>
        <UTextarea
          v-model="draft.acceptanceCriteria"
          required
          :maxlength="10000"
          class="w-full"
          :disabled="busy || reloading"
        />
      </UFormField>
      <UFormField label="安排原因" required>
        <UTextarea
          v-model="draft.reason"
          required
          :maxlength="2000"
          class="w-full"
          :disabled="busy || reloading"
        />
      </UFormField>
      <UButton type="submit" :loading="busy" :disabled="reloading || !canSubmit">
        排入版本
      </UButton>
    </form>
  </div>
</template>
