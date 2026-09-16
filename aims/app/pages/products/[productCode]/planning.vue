<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '高级规划 · 建设事项', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
interface Item { biz_id: string, title: string, scope_summary: string, investment_category: string, lifecycle: string, urgency_level: string, deadline: string | null }
const categories: Record<string, string> = { reliability: '可靠性与技术治理', usability: '体验优化', growth: '新功能与业务增长' }
const states: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const lifecycle = ref('all'), category = ref('all')
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { keyword: search, lifecycle, investmentCategory: category }, defaults: { keyword: '', lifecycle: 'all', investmentCategory: 'all' } })
flush()
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, lifecycle: lifecycle.value === 'all' ? undefined : lifecycle.value, investmentCategory: category.value === 'all' ? undefined : category.value }))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-items`, {
  server: false, query,
  transform: (response: { code: number, data: { items: Item[], total: number, workspace_revision: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0) throw new Error('规划事项响应不完整')
    return response.data
  }
})
const { data: permissions, status: permissionStatus, error: permissionError, refresh: refreshPermissions } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-items/permissions`, {
  server: false, transform: (response: { code: number, data: { product_code: string, status: string, edit: boolean } }) => {
    if (response.code !== 0 || response.data?.product_code !== code.value) throw new Error('规划权限响应不完整')
    return response.data
  }
})
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '规划权限加载失败' })
const canCreate = computed(() => status.value === 'success' && permissionStatus.value === 'success' && permissions.value?.status === 'active' && permissions.value.edit)
const editingId = ref<string | null>(null)
const editingOpen = computed(() => editingId.value !== null)
function editSelected() {
  if (!canCreate.value || !selected.value || !['proposed', 'in_delivery'].includes(selected.value.lifecycle)) return
  editingId.value = selected.value.biz_id
  selected.value = null
}
const creation = ref<{ revision: number } | null>(null)
const creationOpen = computed(() => creation.value !== null)
function startCreate() {
  if (!canCreate.value || !data.value) return
  selected.value = null
  creation.value = { revision: data.value.workspace_revision }
}
const toast = useToast()
async function created() {
  creation.value = null
  editingId.value = null
  toast.add({ title: '规划事项已保存', color: 'success' })
  await Promise.all([refresh(), refreshPermissions()])
}
const alert = useApiErrorAlert(error, { fallbackTitle: '规划事项加载失败' })
const selected = ref<Item | null>(null)
const open = computed({ get: () => selected.value !== null, set: (value: boolean) => {
  if (!value) selected.value = null
} })
watch([code, query], () => {
  selected.value = null
})
const columns: TableColumn<Item>[] = [{ accessorKey: 'title', header: '规划事项' }, { accessorKey: 'investment_category', header: '投资类别' }, { accessorKey: 'lifecycle', header: '状态' }, { accessorKey: 'urgency_level', header: '紧急程度建议' }, { accessorKey: 'deadline', header: '期限' }]
async function reload() {
  selected.value = null
  await Promise.all([refresh(), refreshPermissions()])
}
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(reload))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="min-w-0 space-y-4 p-4 sm:p-6">
    <ProductsVersionTools :product-code="code" />
    <p class="text-sm text-muted">
      将一条或多条需求整理为本次建设范围，也可补充工程治理事项。范围明确后，进入优先级安排，评估价值与投入并选入周期。
    </p>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles`"
      color="neutral"
      variant="outline"
      trailing-icon="i-lucide-arrow-right"
    >
      安排优先级
    </UButton>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索规划事项" name="keyword" class="min-w-0 flex-1 basis-56">
        <UInput
          v-model="search"
          placeholder="标题或本次范围"
          icon="i-lucide-search"
          class="w-full"
        />
      </UFormField>
      <UFormField label="状态" name="lifecycle">
        <USelect v-model="lifecycle" :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(states).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UFormField label="投资类别" name="investmentCategory">
        <USelect v-model="category" :items="[{ label: '全部类别', value: 'all' }, ...Object.entries(categories).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        @click="resetFilters(); resetSearch()"
      >
        重置
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="reload"
      >
        刷新事项
      </UButton>
    </form>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UButton v-if="canCreate" icon="i-lucide-plus" @click="startCreate">
      新增规划事项
    </UButton>
    <UModal
      :open="creationOpen"
      :dismissible="false"
      :close="false"
      title="新增规划事项"
      description="明确本次建设范围与投资类别"
    >
      <template #body>
        <ProductsPlanningItemForm
          v-if="creation"
          :product-code="code"
          :workspace-revision="creation.revision"
          @saved="created"
          @cancel="creation = null"
        />
      </template>
    </UModal>
    <UModal
      :open="editingOpen"
      :dismissible="false"
      :close="false"
      title="修改规划事项"
      description="核对当前范围与来源，记录修改原因"
    >
      <template #body>
        <ProductsPlanningItemEditor
          v-if="editingId"
          :product-code="code"
          :item-id="editingId"
          @saved="created"
          @cancel="editingId = null"
        />
      </template>
    </UModal>
    <div class="min-w-0 overflow-hidden rounded-lg border border-default">
      <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
        <template #title-cell="{ row }">
          <UButton
            color="neutral"
            variant="link"
            class="max-w-80 whitespace-normal text-left"
            @click="selected = row.original"
          >
            {{ row.original.title }}
          </UButton>
        </template>
        <template #investment_category-cell="{ row }">
          {{ categories[row.original.investment_category] || row.original.investment_category }}
        </template>
        <template #lifecycle-cell="{ row }">
          {{ states[row.original.lifecycle] || row.original.lifecycle }}
        </template>
        <template #deadline-cell="{ row }">
          {{ row.original.deadline || '未确定' }}
        </template>
        <template #empty>
          <p class="p-4 text-sm text-muted">
            {{ status === 'error' ? '加载失败，请重试' : '当前筛选下暂无规划事项' }}
          </p>
        </template>
      </UTable>
    </div>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 个事项</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="pageSize"
        :sibling-count="0"
        show-edges
      />
    </div>
    <UModal
      v-model:open="open"
      :title="selected?.title || '规划事项'"
      description="本次建设范围"
      :ui="{ title: 'break-words' }"
    >
      <template #body>
        <UButton
          v-if="canCreate && selected && ['proposed', 'in_delivery'].includes(selected.lifecycle)"
          color="neutral"
          variant="outline"
          icon="i-lucide-pencil"
          @click="editSelected"
        >
          修改事项
        </UButton>
        <UButton
          v-if="canCreate && selected && ['proposed', 'in_delivery'].includes(selected.lifecycle)"
          :to="`/products/${encodeURIComponent(code)}/planning-items/${selected.biz_id}/dependencies`"
          color="neutral"
          variant="outline"
          icon="i-lucide-git-branch"
        >
          维护前置依赖
        </UButton>
        <UButton
          v-if="selected"
          :to="`/products/${encodeURIComponent(code)}/planning-items/${selected.biz_id}/feature`"
          color="neutral"
          variant="outline"
          icon="i-lucide-box"
        >
          关联长期功能
        </UButton>
        <UButton
          v-if="selected"
          :to="`/products/${encodeURIComponent(code)}/planning-items/${selected.biz_id}/handoff`"
          color="neutral"
          variant="outline"
          icon="i-lucide-send"
        >
          转交项目需求
        </UButton>
        <UButton
          v-if="selected"
          :to="`/products/${encodeURIComponent(code)}/planning-items/${selected.biz_id}/version`"
          color="neutral"
          variant="outline"
        >
          排入产品版本
        </UButton>
        <ProductsPlanningItemDetail
          v-if="selected"
          :key="selected.biz_id"
          :product-code="code"
          :item-id="selected.biz_id"
        />
      </template>
    </UModal>
  </div>
</template>
