<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ProductPlanningCycle } from '../../app/types/productPlanningCycle'
import { productPlanningCycleStates } from '../../app/utils/productReadLabels'
import { useAimsModule } from '../useAimsModule'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '规划周期', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const { moduleUrl } = useAimsModule()
const code = computed(() => String(route.params.productCode || ''))
const page = ref(1)
const pageSize = 20
const cycleStatus = ref('all')
watch([code, cycleStatus], () => {
  page.value = 1
})
const query = computed(() => ({ page: page.value, pageSize, ...(cycleStatus.value === 'all' ? {} : { status: cycleStatus.value }) }))
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles`), {
  server: false,
  query,
  transform: (response: { code: number, data: { items: ProductPlanningCycle[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== code.value || !Object.hasOwn(productPlanningCycleStates, item.status))) {
      throw new Error('周期列表响应不完整')
    }
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '规划周期加载失败' })
const columns: TableColumn<ProductPlanningCycle>[] = [
  { accessorKey: 'title', header: '规划周期' },
  { accessorKey: 'starts_on', header: '期间' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'budget', header: '总容量（人日）' },
  { accessorKey: 'next_review_at', header: '下次复评' }
]
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">
          规划周期
        </h1>
        <p class="mt-1 text-sm text-muted">
          查看产品周期目标、状态与投入容量。
        </p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新周期
      </UButton>
    </div>
    <UFormField label="周期状态">
      <USelect v-model="cycleStatus" :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(productPlanningCycleStates).map(([value, state]) => ({ value, label: state.label }))]" />
    </UFormField>
    <UAlert v-if="alert" v-bind="alert" />
    <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
      <template #starts_on-cell="{ row }">
        {{ row.original.starts_on }} 至 {{ row.original.ends_on }}
      </template>
      <template #status-cell="{ row }">
        <UBadge :color="productPlanningCycleStates[row.original.status].color" variant="subtle">
          {{ productPlanningCycleStates[row.original.status].label }}
        </UBadge>
      </template>
      <template #budget-cell="{ row }">
        {{ row.original.budget?.total_person_days ?? '未确定' }}
      </template>
      <template #next_review_at-cell="{ row }">
        {{ row.original.next_review_at ? row.original.next_review_at.replace('T', ' ').replace('Z', ' UTC') : '未安排' }}
      </template>
      <template #empty>
        <CommonEmptyState icon="i-lucide-calendar-search" title="暂无符合条件的周期" description="可切换状态或刷新列表。" />
      </template>
    </UTable>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 个周期</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="pageSize"
        :sibling-count="1"
      />
    </div>
  </div>
</template>
