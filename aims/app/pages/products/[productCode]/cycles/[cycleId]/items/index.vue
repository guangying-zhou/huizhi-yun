<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '周期候选事项', layoutHeaderProjectSwitcher: false })
interface Candidate {
  lifecycle: string
  biz_id: string
  product_code: string
  title: string
  scope_summary: string
  urgency_level: string
  selection_status: 'candidate' | 'selected' | 'deferred'
  roadmap_bucket: string
  current_assessment_id: number | null
  investment_category: string
  assessment: { model_method?: 'weighted-value-effort' | 'rice', rice_impact?: string | null, value_score: number | null, priority_score: string | null, effort_person_days: string | null, confidence: string | null, model_version: string, stale: boolean } | null
}
interface CandidatePage {
  items: Candidate[]
  total: number
  cycle_biz_id: string
  cycle_status: 'draft' | 'open' | 'closed'
  cycle_revision: number
  queue_revision: number
  workspace_revision: number
}
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const selections = { candidate: '候选', selected: '已选入', deferred: '暂缓' }
const cycles = { draft: '草案', open: '开放中', closed: '已关闭' }
const selection = ref('all'), ordering = ref('decision'), category = ref('all')
const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { keyword: search, selectionStatus: selection, sort: ordering, investmentCategory: category }, defaults: { keyword: '', selectionStatus: 'all', sort: 'decision', investmentCategory: 'all' } })
flush()
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, selectionStatus: selection.value === 'all' ? undefined : selection.value, sort: ordering.value, investmentCategory: category.value === 'all' ? undefined : category.value }))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${encodeURIComponent(cycleId.value)}/items`, {
  server: false, query,
  transform: (response: { code: number, data: CandidatePage }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.cycle_biz_id !== cycleId.value || !Object.hasOwn(cycles, result.cycle_status) || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.some(item => item.product_code !== code.value || !item.biz_id || !Object.hasOwn(selections, item.selection_status))) throw new Error('候选列表响应不完整')
    return result
  }
})
const { data: permission, status: permissionStatus } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, { server: false })
const canAdd = computed(() => status.value === 'success' && data.value && ['draft', 'open'].includes(data.value.cycle_status) && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit)
const canMove = computed(() => status.value === 'success' && data.value?.cycle_status === 'open' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.prioritize)
const canConfirmConsumption = computed(() => status.value === 'success' && data.value?.cycle_status === 'open' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.assess)
const alert = useApiErrorAlert(error, { fallbackTitle: '候选事项加载失败' })
const columns: TableColumn<Candidate>[] = [{ accessorKey: 'title', header: '事项与范围' }, { accessorKey: 'investment_category', header: '投资类别' }, { accessorKey: 'assessment', header: '价值／投入与推荐分' }, { accessorKey: 'selection_status', header: '选择结果' }, { accessorKey: 'urgency_level', header: '紧急程度' }, { accessorKey: 'current_assessment_id', header: '评估记录' }, { id: 'actions', header: '操作' }]
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="min-w-0 space-y-4 p-4 sm:p-6">
    <UButton :to="`/products/${encodeURIComponent(code)}/cycles/${encodeURIComponent(cycleId)}/roadmap`" color="neutral" variant="outline">
      季度路线图
    </UButton>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles`"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
    >
      返回规划周期
    </UButton>
    <p class="text-sm text-muted">
      按周期决定顺序查看事项。推荐分仅在同类别内比较；过期分数需复评，未知投入不代表零成本。
    </p>
    <UBadge v-if="status === 'success' && data" color="neutral" variant="subtle">
      {{ cycles[data.cycle_status] }}
    </UBadge>
    <UButton v-if="canAdd" :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/add-item`" icon="i-lucide-plus">
      添加候选事项
    </UButton>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/matrix`"
      color="neutral"
      variant="outline"
      icon="i-lucide-chart-scatter"
    >
      查看价值／投入矩阵
    </UButton>
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/capacity`"
      color="neutral"
      variant="outline"
      icon="i-lucide-gauge"
    >
      查看周期容量
    </UButton>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索事项" class="min-w-0 flex-1 basis-56">
        <UInput v-model="search" placeholder="事项标题或范围" class="w-full" />
      </UFormField>
      <UFormField label="查看顺序">
        <USelect v-model="ordering" :items="[{ label: '已确定顺序', value: 'decision' }, { label: '分类内推荐分', value: 'recommended' }]" />
      </UFormField>
      <UFormField label="投资类别">
        <USelect v-model="category" :items="[{ label: '全部类别', value: 'all' }, { label: '可靠性与治理', value: 'reliability' }, { label: '体验优化', value: 'usability' }, { label: '新功能与增长', value: 'growth' }]" />
      </UFormField>
      <UFormField label="选择结果">
        <USelect v-model="selection" :items="[{ label: '全部结果', value: 'all' }, ...Object.entries(selections).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UButton color="neutral" variant="outline" @click="resetFilters(); resetSearch()">
        重置
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新候选
      </UButton>
    </form>
    <p v-if="ordering === 'recommended'" class="text-sm text-muted">
      当前为只读推荐视图。按类别分组，有效且未进入交付的完整评分在前；其他事项随后展示。切换视图不会改变已确定顺序。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <div class="min-w-0 overflow-hidden rounded-lg border border-default">
      <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
        <template #title-cell="{ row }">
          <div class="min-w-48 max-w-96 whitespace-normal break-words">
            <p class="font-medium">
              {{ row.original.title }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ row.original.scope_summary }}
            </p>
          </div>
        </template>
        <template #investment_category-cell="{ row }">
          {{ ({ reliability: '可靠性与治理', usability: '体验优化', growth: '新功能与增长' } as Record<string, string>)[row.original.investment_category] || row.original.investment_category }}
        </template>
        <template #assessment-cell="{ row }">
          <div v-if="row.original.assessment" class="min-w-40 space-y-1 whitespace-normal text-sm">
            <p v-if="row.original.assessment.model_method === 'rice'">
              RICE 影响：{{ row.original.assessment.rice_impact ?? '未知' }} · 置信度：{{ row.original.assessment.confidence ?? '未知' }}
            </p>
            <p v-else>
              价值：{{ row.original.assessment.value_score ?? '未知' }} · 置信度：{{ row.original.assessment.confidence ?? '未知' }}
            </p>
            <p>投入：{{ row.original.assessment.effort_person_days ?? '未知' }} 人日</p>
            <p>推荐分：{{ row.original.assessment.priority_score ?? '待评估' }}</p>
            <UBadge v-if="row.original.assessment.stale" color="warning" variant="subtle">
              已过期，需复评
            </UBadge>
          </div>
          <span v-else class="text-muted">尚无评估</span>
        </template>
        <template #selection_status-cell="{ row }">
          {{ selections[row.original.selection_status] }}
        </template>
        <template #current_assessment_id-cell="{ row }">
          <UButton :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${row.original.biz_id}/assessments`" color="neutral" variant="link">
            {{ row.original.current_assessment_id === null ? '尚无评估 · 查看记录' : '查看评估历史' }}
          </UButton>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="canConfirmConsumption && row.original.selection_status === 'selected' && row.original.lifecycle === 'in_delivery'"
            :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${row.original.biz_id}/consumption`"
            color="neutral"
            variant="outline"
          >
            核验已发生投入
          </UButton>
          <UButton
            v-if="canMove && ordering === 'decision'"
            :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${row.original.biz_id}/move`"
            color="neutral"
            variant="outline"
          >
            调整顺序
          </UButton>
          <UButton
            v-if="canMove && row.original.selection_status === 'selected' && ['proposed', 'in_delivery'].includes(row.original.lifecycle)"
            :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${row.original.biz_id}/withdraw`"
            color="warning"
            variant="outline"
          >
            撤回选择
          </UButton>
          <UButton
            v-if="canMove && row.original.selection_status !== 'selected' && row.original.lifecycle === 'proposed' && row.original.assessment && !row.original.assessment.stale && row.original.assessment.priority_score !== null"
            :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${row.original.biz_id}/select`"
            color="primary"
            variant="outline"
          >
            选入周期
          </UButton>
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-list-filter" :title="status === 'error' ? '候选加载失败' : status === 'pending' ? '正在加载候选' : '暂无符合条件的事项'" description="可重置筛选或刷新列表。" />
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
  </div>
</template>
