<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本计划', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/versions`)
const displayMode = ref('list')
const versionQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const states = { planning: '规划中', developing: '开发中', released: '已发布', archived: '已归档' }
interface Version { planning_mode: 'simple' | 'cycle', id: number, product_code: string, version_code: string, name: string | null, description: string | null, status: keyof typeof states, planned_release_date: string | null }
const page = ref(1), pageSize = 20, filter = ref('all')
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
watch(filter, () => {
  page.value = 1
})
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, status: filter.value === 'all' ? undefined : filter.value }))
const { data, status, error, refresh } = await useFetch(base, { server: false, query, transform: (response: { code: number, data: { items: Version[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== code.value || !Number.isSafeInteger(item.id) || item.id < 1 || !Object.hasOwn(states, item.status))) throw new Error('版本列表响应不完整')
  return response.data
} })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, edit: boolean, revision: number } }>(() => `${base.value}/permissions`, { server: false })
const canCreate = computed(() => permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && Number.isSafeInteger(permission.value.data.revision) && permission.value.data.revision > 0)
const alert = useApiErrorAlert(error, { fallbackTitle: '版本列表加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '版本权限加载失败' })
const editing = ref(false), saving = ref(false), revision = ref(0)
const navigatingToPlan = ref(false)
const draft = reactive({ versionCode: '', name: '', description: '', plannedReleaseDate: '', businessOwnerUid: '' })
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '版本创建失败' })
let retry: { payload: string, key: string } | undefined
const toast = useToast()
function start() {
  if (!canCreate.value || !permission.value || saving.value) return
  revision.value = permission.value.data.revision
  saveError.value = null
  editing.value = true
}
async function reload() {
  if (saving.value) return
  await Promise.all([refresh(), refreshPermission()])
  if (canCreate.value && permission.value) revision.value = permission.value.data.revision
}
function clearDraft() {
  Object.assign(draft, { versionCode: '', name: '', description: '', plannedReleaseDate: '', businessOwnerUid: '' })
  retry = undefined
  saveError.value = null
}
async function save() {
  if (saving.value || !canCreate.value || (!draft.versionCode.trim() || !draft.businessOwnerUid)) return
  saving.value = true
  saveError.value = null
  const body = { ...draft, expectedRevision: revision.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const response = await $fetch<{ code: number, data?: { value?: { id?: number, version_id?: number } } }>(base.value, { method: 'POST', body: { ...body, planningMode: 'simple' }, headers: { 'Idempotency-Key': retry.key } })
    const versionId = response.data?.value?.id ?? response.data?.value?.version_id
    if (response.code !== 0 || typeof versionId !== 'number' || !Number.isSafeInteger(versionId) || versionId < 1) throw new Error('保存结果不完整，请重试')
    const createdVersionId = versionId
    editing.value = false
    clearDraft()
    toast.add({ title: '产品版本已创建', color: 'success' })
    await Promise.all([refresh(), refreshPermission()])
    navigatingToPlan.value = true
    await navigateTo({ path: `/products/${encodeURIComponent(code.value)}/versions/${createdVersionId}/plan`, query: versionQuery.value })
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('创建失败，请重试')
  } finally {
    saving.value = false
  }
}
watch(code, () => {
  editing.value = false
  clearDraft()
  page.value = 1
  filter.value = 'all'
  search.value = ''
})
onBeforeRouteLeave(() => !saving.value || navigatingToPlan.value)
onBeforeRouteUpdate(() => !saving.value || navigatingToPlan.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">
          {{ route.query.view === 'gtm' ? '版本发布' : '版本计划' }}
        </h1>
        <p class="mt-1 text-sm text-muted">
          确定版本目标与投入，安排需求范围，确认后跟踪研发交付和验收发布。
        </p>
      </div>
      <ProductsVersionTools :product-code="code" index />
    </div>
    <div class="flex flex-wrap gap-2" role="group" aria-label="版本显示方式">
      <UButton
        :color="displayMode === 'list' ? 'primary' : 'neutral'"
        :variant="displayMode === 'list' ? 'soft' : 'ghost'"
        :aria-pressed="displayMode === 'list'"
        icon="i-lucide-list"
        @click="displayMode = 'list'"
      >
        列表
      </UButton>
      <UButton
        :color="displayMode === 'timeline' ? 'primary' : 'neutral'"
        :variant="displayMode === 'timeline' ? 'soft' : 'ghost'"
        :aria-pressed="displayMode === 'timeline'"
        icon="i-lucide-calendar-range"
        @click="displayMode = 'timeline'"
      >
        时间视图
      </UButton>
    </div>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索版本" class="min-w-0 flex-1">
        <UInput v-model="search" class="w-full" placeholder="版本号或名称" />
      </UFormField>
      <UFormField label="版本状态">
        <USelect v-model="filter" :items="[{ label: '全部', value: 'all' }, ...Object.entries(states).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="saving"
        @click="reload"
      >
        重新读取
      </UButton>
      <UButton v-if="canCreate" icon="i-lucide-plus" @click="start">
        新建版本计划
      </UButton>
    </form>
    <p v-if="displayMode === 'timeline'" class="text-sm text-muted">
      按计划发布日期查看当前页版本；日期仅表示发布计划，完整版本可翻页查看。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <p v-if="status === 'pending'" role="status">
      正在加载产品版本…
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-package"
        title="暂无符合条件的版本"
        description="调整筛选条件，或新建产品版本。"
      />
      <article
        v-for="item in displayMode === 'timeline' ? [...data.items].sort((a, b) => (a.planned_release_date || '9999').localeCompare(b.planned_release_date || '9999')) : data.items"
        :key="item.id"
        class="min-w-0 space-y-2 rounded-lg border border-default p-4"
        :class="displayMode === 'timeline' ? 'border-l-4 border-l-primary' : ''"
      >
        <p v-if="displayMode === 'timeline'" class="text-sm font-medium text-primary">
          {{ item.planned_release_date || '尚未排期' }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <NuxtLink :to="{ path: `/products/${encodeURIComponent(code)}/versions/${item.id}/${item.planning_mode === 'simple' ? 'plan' : 'features'}`, query: versionQuery }" class="min-w-0 break-words font-medium text-primary hover:underline">
            {{ item.version_code }}{{ item.name ? ` · ${item.name}` : '' }}
          </NuxtLink>
          <UBadge color="neutral" variant="subtle">
            {{ states[item.status] }}
          </UBadge>
        </div>
        <p class="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted">
          {{ item.description || '暂无说明' }}
        </p>
        <p class="text-sm text-muted">
          计划发布：{{ item.planned_release_date || '待安排' }}
        </p>
      </article>
      <p class="text-sm text-muted">
        共 {{ data.total }} 个版本
      </p>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :total="data.total"
        :items-per-page="pageSize"
        :sibling-count="0"
      />
    </template>
    <UModal
      v-model:open="editing"
      title="新建版本计划"
      description="创建轻量计划版本后，立即进入范围、预算与确认工作区。"
      :dismissible="!saving"
      :close="!saving"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <UAlert v-if="saveAlert" v-bind="saveAlert" />
          <UFormField label="业务负责人" required>
            <UserTreeSelector
              :model-value="draft.businessOwnerUid ? [draft.businessOwnerUid] : []"
              selection-mode="single"
              :disabled="saving"
              @update:model-value="(uids) => { draft.businessOwnerUid = uids[0] || '' }"
            />
            <p class="mt-1 text-sm text-muted">
              请选择有效产品成员；负责人仍需具备版本验收权限。
            </p>
          </UFormField>
          <UFormField label="版本号" required>
            <UInput
              v-model="draft.versionCode"
              required
              :maxlength="64"
              :disabled="saving"
              class="w-full"
              placeholder="例如 v1.0"
            />
          </UFormField>
          <UFormField label="版本名称">
            <UInput
              v-model="draft.name"
              :maxlength="200"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="计划发布日期">
            <UInput
              v-model="draft.plannedReleaseDate"
              type="date"
              min="1000-01-01"
              max="9999-12-31"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="版本说明">
            <UTextarea
              v-model="draft.description"
              :maxlength="10000"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <p v-if="saveError" class="text-sm text-muted">
            输入已保留。如产品信息已变化，可重新读取后再提交。
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" :loading="saving" :disabled="!canCreate || (!draft.versionCode.trim() || !draft.businessOwnerUid)">
              创建版本
            </UButton>
            <UButton
              v-if="saveError"
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="reload"
            >
              重新读取
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="editing = false"
            >
              取消
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
