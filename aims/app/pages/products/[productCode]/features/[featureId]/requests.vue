<script setup lang="ts">
import type { ProductRequestRecord } from '~/types/productRequest'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '功能关联需求', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const featureId = computed(() => String(route.params.featureId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}`)
const featurePath = computed(() => `${base.value}/features/${encodeURIComponent(featureId.value)}`)
interface Page { items: ProductRequestRecord[], total: number, workspace_revision: number }
interface Feature { biz_id: string, product_code: string, title: string, lifecycle: string, revision: number }
interface Permission { product_code: string, status: string, revision: number, edit: boolean }
const linkedPage = ref(1)
const { search, debounced, flush } = useDebouncedSearch()
const { page, pageSize } = useListPage({ pageSize: 20, filters: { keyword: search }, defaults: { keyword: '' } })
const pageData = (response: { code: number, data: Page }) => {
  const value = response.data
  if (response.code !== 0 || !Array.isArray(value?.items) || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.workspace_revision) || value.workspace_revision < 1 || value.items.some(item => item.product_code !== code.value || !item.biz_id || !Number.isSafeInteger(item.revision) || item.revision < 1)) throw new Error('需求列表响应不完整')
  return value
}
const { data: linked, status: linkedStatus, error: linkedError, refresh: refreshLinked } = await useFetch(() => `${featurePath.value}/requests`, { server: false, query: computed(() => ({ page: linkedPage.value, pageSize: 20 })), transform: pageData })
const { data: candidates, status: candidateStatus, error: candidateError, refresh: refreshCandidates } = await useFetch(() => `${base.value}/requests`, { server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined })), transform: pageData })
const { data: feature, status: featureStatus, error: featureError, refresh: refreshFeature } = await useFetch<{ code: number, data: Feature }>(featurePath, { server: false })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: Permission }>(() => `${base.value}/requests/permissions`, { server: false })
const canChange = computed(() => featureStatus.value === 'success' && feature.value?.code === 0 && feature.value.data.biz_id === featureId.value && feature.value.data.product_code === code.value && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true)
const linkedAlert = useApiErrorAlert(linkedError, { fallbackTitle: '关联需求加载失败' })
const candidateAlert = useApiErrorAlert(candidateError, { fallbackTitle: '需求池加载失败' })
const featureAlert = useApiErrorAlert(featureError, { fallbackTitle: '功能加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '关联权限加载失败' })
const selected = ref<{ item: ProductRequestRecord, operation: 'link' | 'unlink' } | null>(null)
const reason = ref('')
const busy = ref(false)
const mutationError = ref<Error | null>(null)
const mutationAlert = useApiErrorAlert(mutationError, { fallbackTitle: '关联变更失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function choose(item: ProductRequestRecord, operation: 'link' | 'unlink') {
  if (busy.value) return
  selected.value = { item, operation }
  reason.value = ''
  mutationError.value = null
  retry = undefined
}
async function reload() {
  if (busy.value) return
  retry = undefined
  busy.value = true
  try {
    await Promise.all([refreshLinked(), refreshCandidates(), refreshFeature(), refreshPermission()])
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !selected.value || !canChange.value || !reason.value.trim()) return
  busy.value = true
  mutationError.value = null
  try {
    const selection = selected.value
    const [currentFeature, currentRequest, currentPermission] = await Promise.all([
      $fetch<{ code: number, data: Feature }>(featurePath.value),
      $fetch<{ code: number, data: ProductRequestRecord }>(`${base.value}/requests/${selection.item.biz_id}`),
      $fetch<{ code: number, data: Permission }>(`${base.value}/requests/permissions`)
    ])
    const f = currentFeature.data, r = currentRequest.data, p = currentPermission.data
    if (currentFeature.code !== 0 || currentRequest.code !== 0 || currentPermission.code !== 0 || f?.product_code !== code.value || r?.product_code !== code.value || p?.product_code !== code.value || f.biz_id !== featureId.value || r.biz_id !== selection.item.biz_id || !p.edit || p.status !== 'active' || [f.revision, r.revision, p.revision].some(v => !Number.isSafeInteger(v) || v < 1)) throw new Error('对象或权限已变化，请重新读取')
    if (r.decision_status === 'merged' || (selection.operation === 'link' && f.lifecycle === 'deprecated')) throw new Error('已合并需求或已弃用功能不能新增关联')
    const body = { requestBizId: r.biz_id, expectedRevision: p.revision, expectedFeatureRevision: f.revision, expectedRequestRevision: r.revision, operation: selection.operation, reason: reason.value }
    if (retry) {
      const previous = JSON.parse(retry.payload) as typeof body
      if (previous.requestBizId === body.requestBizId && previous.operation === body.operation && previous.reason === body.reason) Object.assign(body, previous)
    }
    const label = selection.operation === 'link' ? '关联需求' : '解除关联'
    if (!(await confirm({ title: label, message: `功能：${f.title}\n需求：${r.title}\n原因：${body.reason}\n关联变化将触发相关规划证据重新核验。`, confirmLabel: label, tone: 'warning' }))) return
    const payload = JSON.stringify(body)
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number }>(`${featurePath.value}/requests`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('关联结果不完整，请重试')
    selected.value = null
    retry = undefined
    reason.value = ''
    toast.add({ title: `${label}成功`, color: 'success' })
    await Promise.all([refreshLinked(), refreshCandidates(), refreshFeature(), refreshPermission()])
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause : new Error('关联操作失败')
  } finally {
    busy.value = false
  }
}
watch([code, featureId], () => {
  selected.value = null
  reason.value = ''
  retry = undefined
  mutationError.value = null
  linkedPage.value = 1
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        :to="`/products/${encodeURIComponent(code)}/features/${featureId}`"
        color="neutral"
        variant="ghost"
        :disabled="busy"
      >
        返回功能详情
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="busy"
        @click="reload"
      >
        重新读取
      </UButton>
    </div>
    <UAlert v-if="featureAlert" v-bind="featureAlert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <h1 class="break-words text-lg font-semibold">
      {{ feature?.data?.title || '功能' }} · 关联需求
    </h1>
    <p class="text-sm text-muted">
      关联需求说明能力来源，不代表已承诺版本或研发完成。
    </p>
    <UAlert v-if="mutationAlert" v-bind="mutationAlert" />
    <form v-if="selected" class="space-y-3 rounded-lg border border-default p-4" @submit.prevent="save">
      <p class="break-words">
        {{ selected.operation === 'link' ? '关联' : '解除关联' }}：{{ selected.item.title }}
      </p>
      <UFormField label="变更原因" required>
        <UTextarea
          v-model="reason"
          :maxlength="2000"
          class="w-full"
          :disabled="busy"
        />
      </UFormField>
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" :loading="busy" :disabled="!canChange || !reason.trim()">
          确认变更
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="selected = null"
        >
          取消
        </UButton>
      </div>
    </form>
    <section class="space-y-3">
      <h2 class="font-semibold">
        已关联需求 · {{ linked?.total || 0 }}
      </h2>
      <UAlert v-if="linkedAlert" v-bind="linkedAlert" />
      <p v-if="linkedStatus === 'pending'" role="status">
        正在加载关联…
      </p>
      <template v-if="linkedStatus === 'success' && linked">
        <p v-if="!linked.items.length" class="text-sm text-muted">
          本页暂无关联需求。
        </p>
        <article v-for="item in linked.items" :key="item.biz_id" class="space-y-2 rounded-lg border border-default p-3">
          <p class="break-words font-medium">
            {{ item.title }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm text-muted">
            {{ item.problem_statement }}
          </p>
          <UButton
            v-if="canChange && item.decision_status !== 'merged'"
            color="neutral"
            variant="outline"
            :disabled="busy"
            @click="choose(item, 'unlink')"
          >
            解除关联
          </UButton>
        </article>
        <UPagination
          v-if="linked.total > 20"
          v-model:page="linkedPage"
          :total="linked.total"
          :items-per-page="20"
          :sibling-count="0"
          :disabled="busy"
        />
      </template>
    </section>
    <section v-if="canChange && feature?.data.lifecycle !== 'deprecated'" class="space-y-3">
      <h2 class="font-semibold">
        从需求池关联
      </h2>
      <form @submit.prevent="flush">
        <UFormField label="搜索需求">
          <UInput
            v-model="search"
            class="w-full"
            :disabled="busy"
            placeholder="标题或问题说明"
          />
        </UFormField>
      </form>
      <UAlert v-if="candidateAlert" v-bind="candidateAlert" />
      <p v-if="candidateStatus === 'pending'" role="status">
        正在加载需求池…
      </p>
      <template v-if="candidateStatus === 'success' && candidates">
        <p v-if="!candidates.items.length" class="text-sm text-muted">
          暂无符合条件的需求。
        </p>
        <article v-for="item in candidates.items" :key="item.biz_id" class="space-y-2 rounded-lg border border-default p-3">
          <p class="break-words font-medium">
            {{ item.title }}
          </p>
          <UButton
            v-if="item.decision_status !== 'merged'"
            variant="outline"
            :disabled="busy"
            @click="choose(item, 'link')"
          >
            选择关联
          </UButton>
          <p v-else class="text-sm text-muted">
            已合并需求保留原关联。
          </p>
        </article>
        <UPagination
          v-if="candidates.total > pageSize"
          v-model:page="page"
          :total="candidates.total"
          :items-per-page="pageSize"
          :sibling-count="0"
          :disabled="busy"
        />
      </template>
    </section>
  </div>
</template>
