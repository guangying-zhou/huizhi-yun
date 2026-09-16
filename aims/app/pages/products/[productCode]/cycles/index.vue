<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '高级规划 · 周期与评分选入', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const states = { draft: '草案', open: '开放中', closed: '已关闭' }
const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const cycleStatus = ref('all')
const reviewFilter = ref('all')
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { keyword: search, status: cycleStatus, review: reviewFilter }, defaults: { keyword: '', status: 'all', review: 'all' } })
flush()
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, status: cycleStatus.value === 'all' ? undefined : cycleStatus.value, reviewDue: reviewFilter.value === 'due' ? 'true' : undefined }))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles`, {
  server: false, query,
  transform: (response: { code: number, data: { items: ProductPlanningCycle[], total: number, workspace_revision: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== code.value || !item.biz_id || !Object.hasOwn(states, item.status))) throw new Error('周期列表响应不完整')
    return response.data
  }
})
const { data: permissions, status: permissionStatus, refresh: refreshPermissions } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, { server: false })
const canCreate = computed(() => permissionStatus.value === 'success' && permissions.value?.code === 0 && permissions.value.data.product_code === code.value && permissions.value.data.status === 'active' && permissions.value.data.edit)
const canPrioritize = computed(() => permissionStatus.value === 'success' && permissions.value?.code === 0 && permissions.value.data.product_code === code.value && permissions.value.data.status === 'active' && permissions.value.data.prioritize)
const alert = useApiErrorAlert(error, { fallbackTitle: '规划周期加载失败' })
const selected = ref<ProductPlanningCycle | null>(null)
const open = computed({ get: () => selected.value !== null, set: (value: boolean) => {
  if (!value) selected.value = null
} })
watch([code, query], () => {
  selected.value = null
})
const columns: TableColumn<ProductPlanningCycle>[] = [{ accessorKey: 'title', header: '规划周期' }, { accessorKey: 'starts_on', header: '期间' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'budget', header: '总容量（人日）' }, { accessorKey: 'next_review_at', header: '下次复评' }]
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
    <UAlert
      color="info"
      variant="subtle"
      title="高级周期规划"
      description="适合需要按周期分配容量、评分与选入的团队。日常需求可直接排入版本，无需先创建周期。"
    />
    <p class="text-sm text-muted">
      按月度或季度组织需求取舍：设定目标与投入预算，进入周期候选评估建设范围，确定本期要做的内容，再排入版本或转交项目。
    </p>
    <p class="text-sm text-muted">
      按周期明确产品目标与投入预算。草案用于准备，开放后评估事项并确定交付取舍。
    </p>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索规划周期" name="keyword" class="min-w-0 flex-1 basis-56">
        <UInput
          v-model="search"
          placeholder="周期标题或目标"
          icon="i-lucide-search"
          class="w-full"
        />
      </UFormField>
      <UFormField label="周期状态" name="status">
        <USelect v-model="cycleStatus" :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(states).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UFormField label="复评安排" name="review">
        <USelect v-model="reviewFilter" :items="[{ label: '全部周期', value: 'all' }, { label: '已到期需复评', value: 'due' }]" />
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
        刷新周期
      </UButton>
    </form>
    <p v-if="reviewFilter === 'due'" class="text-sm text-muted">
      仅显示开放且复评时间已到的周期，按服务器时间判断。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton v-if="canCreate" :to="`/products/${encodeURIComponent(code)}/cycles/new`" icon="i-lucide-plus">
      新增规划周期
    </UButton>
    <div class="min-w-0 overflow-hidden rounded-lg border border-default">
      <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
        <template #title-cell="{ row }">
          <UButton
            color="neutral"
            variant="link"
            class="max-w-72 whitespace-normal text-left"
            @click="selected = row.original"
          >
            {{ row.original.title }}
          </UButton>
        </template>
        <template #starts_on-cell="{ row }">
          {{ row.original.starts_on }} 至 {{ row.original.ends_on }}
        </template>
        <template #status-cell="{ row }">
          {{ states[row.original.status] }}
        </template>
        <template #next_review_at-cell="{ row }">
          {{ row.original.next_review_at ? row.original.next_review_at.replace('T', ' ').replace('Z', ' UTC') : '未安排' }}
        </template>
        <template #budget-cell="{ row }">
          {{ row.original.budget?.total_person_days ?? '未确定' }}
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-calendar-search" :title="status === 'error' ? '周期加载失败' : status === 'pending' ? '正在加载周期' : '暂无符合条件的周期'" description="可重置筛选或刷新列表。" />
        </template>
      </UTable>
    </div>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 个周期</span>
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
      :title="selected?.title || '规划周期'"
      description="周期目标与投入预算"
      :ui="{ title: 'break-words' }"
    >
      <template #body>
        <ProductsPlanningCycleReviews
          v-if="selected"
          :key="selected.biz_id"
          :product-code="code"
          :cycle-id="selected.biz_id"
        />
        <UButton
          v-if="selected?.status === 'open' && canPrioritize"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/review`"
          color="neutral"
          variant="outline"
        >
          记录周期复评
        </UButton>
        <UButton
          v-if="selected"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/items`"
          color="neutral"
          variant="outline"
          icon="i-lucide-list"
        >
          查看周期候选
        </UButton>
        <UButton
          v-if="canCreate && selected?.status === 'draft'"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/edit`"
          color="neutral"
          variant="outline"
          icon="i-lucide-pencil"
        >
          修改周期草案
        </UButton>
        <UButton
          v-if="canPrioritize && selected?.status === 'draft'"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/open`"
          color="primary"
          variant="outline"
          icon="i-lucide-play"
        >
          开放周期
        </UButton>
        <UButton
          v-if="canPrioritize && selected?.status === 'open'"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/close`"
          color="warning"
          variant="outline"
          icon="i-lucide-lock"
        >
          关闭周期
        </UButton>
        <UButton
          v-if="selected"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/observations`"
          color="neutral"
          variant="outline"
          icon="i-lucide-chart-no-axes-combined"
        >
          结果回看
        </UButton>
        <UButton
          v-if="canPrioritize && selected?.status === 'open'"
          :to="`/products/${encodeURIComponent(code)}/cycles/${selected.biz_id}/budget`"
          color="neutral"
          variant="outline"
          icon="i-lucide-calculator"
        >
          调整周期预算
        </UButton>
        <UButton
          v-if="selected?.status === 'draft'"
          :to="'/products/' + encodeURIComponent(code) + '/cycles/' + selected.biz_id + '/model'"
          color="neutral"
          variant="outline"
        >
          查看与选用评分模型
        </UButton>
        <ProductsPlanningCycleDetail
          v-if="selected"
          :key="selected.biz_id"
          :product-code="code"
          :cycle-id="selected.biz_id"
        />
      </template>
    </UModal>
  </div>
</template>
