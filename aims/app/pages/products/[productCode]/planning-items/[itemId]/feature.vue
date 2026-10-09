<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '规划功能关联', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}`)
const path = computed(() => `${base.value}/planning-items/${encodeURIComponent(itemId.value)}/feature`)
interface Feature { biz_id: string, product_code: string, title: string, lifecycle: string, revision: number }
interface View { item_biz_id: string, item_title: string, lifecycle: string, workspace_revision: number, item_revision: number, scope_revision: number, requires_impact_note: boolean, feature: Feature | null }
interface Permission { product_code: string, status: string, revision: number, edit: boolean }
const positive = (value: number) => Number.isSafeInteger(value) && value > 0
const { data, status, error, refresh } = await useFetch(path, { server: false, transform: (response: { code: number, data: View }) => {
  const value = response.data
  if (response.code !== 0 || value?.item_biz_id !== itemId.value || ![value.workspace_revision, value.item_revision, value.scope_revision].every(positive) || typeof value.requires_impact_note !== 'boolean' || (value.feature && (value.feature.product_code !== code.value || !value.feature.biz_id || !positive(value.feature.revision)))) throw new Error('规划功能关联响应不完整')
  return value
} })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: Permission }>(() => `${base.value}/planning-items/permissions`, { server: false })
const { search, debounced, flush } = useDebouncedSearch()
const { page, pageSize } = useListPage({ pageSize: 20, filters: { keyword: search }, defaults: { keyword: '' } })
const { data: features, status: listStatus, error: listError, refresh: refreshFeatures } = await useFetch(() => `${base.value}/features`, { server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined })), transform: (response: { code: number, data: { items: Feature[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(f => f.product_code !== code.value || !f.biz_id || !positive(f.revision))) throw new Error('功能目录响应不完整')
  return response.data
} })
const canChange = computed(() => status.value === 'success' && data.value && !['merged', 'delivered', 'cancelled'].includes(data.value.lifecycle) && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && permission.value.data.revision === data.value.workspace_revision)
const selected = ref<{ feature: Feature, operation: 'link' | 'unlink' } | null>(null)
const reason = ref(''), impactNote = ref('')
const busy = ref(false)
const mutationError = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '关联加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '规划权限加载失败' })
const listAlert = useApiErrorAlert(listError, { fallbackTitle: '功能目录加载失败' })
const mutationAlert = useApiErrorAlert(mutationError, { fallbackTitle: '关联变更失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function choose(feature: Feature, operation: 'link' | 'unlink') {
  if (busy.value || !canChange.value) return
  selected.value = { feature, operation }
  retry = undefined
  mutationError.value = null
}
async function reload() {
  if (busy.value) return
  busy.value = true
  selected.value = null
  retry = undefined
  try {
    await Promise.all([refresh(), refreshPermission(), refreshFeatures()])
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !canChange.value || !data.value || !selected.value || !reason.value.trim() || (data.value.requires_impact_note && !impactNote.value.trim())) return
  busy.value = true
  mutationError.value = null
  const selection = selected.value
  const body = { featureBizId: selection.feature.biz_id, expectedRevision: data.value.workspace_revision, expectedItemRevision: data.value.item_revision, expectedFeatureRevision: selection.feature.revision, operation: selection.operation, reason: reason.value, impactNote: impactNote.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const label = selection.operation === 'link' ? '关联功能' : '解除功能关联'
    if (!(await confirm({ title: label, message: `事项：${data.value.item_title}\n功能：${selection.feature.title}\n原因：${body.reason}\n影响：${body.impactNote || '无补充'}\n变更将更新范围版本，相关评估和决定需重新核验。`, tone: 'warning', confirmLabel: label }))) return
    const response = await $fetch<{ code: number }>(path.value, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('关联结果不完整，请重试')
    selected.value = null
    retry = undefined
    reason.value = ''
    impactNote.value = ''
    toast.add({ title: `${label}成功`, color: 'success' })
    await Promise.all([refresh(), refreshPermission(), refreshFeatures()])
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause : new Error('关联变更失败')
  } finally {
    busy.value = false
  }
}
watch([code, itemId], () => {
  selected.value = null
  reason.value = ''
  impactNote.value = ''
  retry = undefined
  mutationError.value = null
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        :to="`/products/${encodeURIComponent(code)}/planning`"
        color="neutral"
        variant="ghost"
        :disabled="busy"
      >
        返回高级规划
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
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="mutationAlert" v-bind="mutationAlert" />
    <p v-if="status === 'pending'" role="status">
      正在加载关联…
    </p>
    <template v-if="status === 'success' && data">
      <h1 class="break-words text-lg font-semibold">
        {{ data.item_title }} · 长期功能
      </h1>
      <section class="space-y-3 rounded-lg border border-default p-4">
        <p class="break-words">
          当前功能：{{ data.feature?.title || '尚未关联' }}
        </p>
        <UButton
          v-if="canChange && data.feature"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="choose(data.feature, 'unlink')"
        >
          解除当前关联
        </UButton>
      </section>
      <form v-if="selected" class="space-y-3 rounded-lg border border-default p-4" @submit.prevent="save">
        <p class="break-words">
          {{ selected.operation === 'link' ? '关联' : '解除' }}：{{ selected.feature.title }}
        </p>
        <UFormField label="变更原因" required>
          <UTextarea
            v-model="reason"
            class="w-full"
            :maxlength="2000"
            :disabled="busy"
          />
        </UFormField>
        <UFormField label="影响说明" :required="data.requires_impact_note">
          <UTextarea
            v-model="impactNote"
            class="w-full"
            :maxlength="2000"
            :disabled="busy"
          />
        </UFormField>
        <p class="text-sm text-muted">
          重新读取保留原因和影响说明，请重新选择目标功能。
        </p>
        <UButton type="submit" :loading="busy" :disabled="!canChange || !reason.trim() || (data.requires_impact_note && !impactNote.trim())">
          确认变更
        </UButton>
      </form>
      <section v-if="canChange && !data.feature" class="space-y-3">
        <h2 class="font-semibold">
          选择长期功能
        </h2>
        <form @submit.prevent="flush">
          <UFormField label="搜索功能">
            <UInput
              v-model="search"
              class="w-full"
              :disabled="busy"
              placeholder="标题或说明"
            />
          </UFormField>
        </form>
        <UAlert v-if="listAlert" v-bind="listAlert" />
        <p v-if="listStatus === 'pending'" role="status">
          正在加载功能目录…
        </p>
        <template v-if="listStatus === 'success' && features">
          <p v-if="!features.items.length" class="text-sm text-muted">
            暂无符合条件的功能。
          </p>
          <article v-for="feature in features.items" :key="feature.biz_id" class="space-y-2 rounded-lg border border-default p-3">
            <p class="break-words">
              {{ feature.title }}
            </p>
            <UButton
              v-if="feature.lifecycle !== 'deprecated'"
              variant="outline"
              :disabled="busy"
              @click="choose(feature, 'link')"
            >
              选择关联
            </UButton>
            <p v-else class="text-sm text-muted">
              已弃用，不能新关联。
            </p>
          </article>
          <UPagination
            v-if="features.total > pageSize"
            v-model:page="page"
            :total="features.total"
            :items-per-page="pageSize"
            :sibling-count="0"
            :disabled="busy"
          />
        </template>
      </section>
    </template>
  </div>
</template>
