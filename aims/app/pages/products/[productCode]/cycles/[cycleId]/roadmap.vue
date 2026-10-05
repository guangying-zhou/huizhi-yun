<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '季度路线图', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const today = new Date()
const year = ref(String(today.getFullYear())), quarter = ref(String(Math.floor(today.getMonth() / 3) + 1)), unscheduled = ref(false), page = ref(1)
const pageSize = 20
const validYear = computed(() => /^[1-9]\d{3}$/.test(year.value))
const appliedYear = ref(year.value)
watch(year, (value) => {
  if (validYear.value) appliedYear.value = value
})
watch([appliedYear, quarter, unscheduled, code, cycleId], () => {
  page.value = 1
})
const selections = { candidate: '候选', selected: '已选入', deferred: '暂缓' }
const buckets = { now: '近期', next: '下一步', later: '以后' }
interface Item { biz_id: string, title: string, scope_summary: string, lifecycle: string, selection_status: keyof typeof selections, roadmap_bucket: keyof typeof buckets, decision_rank: number, revision: number, starts_on: string | null, ends_on: string | null }
interface Roadmap { year: number, quarter: number, unscheduled: boolean, cycle_biz_id: string, cycle_status: string, cycle_revision: number, queue_revision: number, workspace_revision: number, items: Item[], total: number, page: number, pageSize: number }
const query = computed(() => ({ cycleId: cycleId.value, year: appliedYear.value, quarter: quarter.value, unscheduled: String(unscheduled.value), page: page.value, pageSize }))
const date = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/quarter`, { server: false, query, transform: (response: { code: number, data: Roadmap }) => {
  const value = response.data
  if (response.code !== 0 || !value || value.cycle_biz_id !== cycleId.value || value.year !== Number(appliedYear.value) || value.quarter !== Number(quarter.value) || value.unscheduled !== unscheduled.value || value.page !== page.value || value.pageSize !== pageSize || !positive(value.workspace_revision) || !positive(value.cycle_revision) || !positive(value.queue_revision) || !['draft', 'open', 'closed'].includes(value.cycle_status) || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > pageSize || value.items.length > value.total || new Set(value.items.map(item => item?.biz_id)).size !== value.items.length || value.items.some(item => !item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.biz_id) || typeof item.title !== 'string' || !item.title.trim() || typeof item.scope_summary !== 'string' || !Object.hasOwn(selections, item.selection_status) || !Object.hasOwn(buckets, item.roadmap_bucket) || !positive(item.revision) || !Number.isSafeInteger(item.decision_rank) || item.decision_rank < 0 || !(value.unscheduled ? item.starts_on === null && item.ends_on === null : date(item.starts_on) && date(item.ends_on) && item.ends_on >= item.starts_on))) throw new Error('季度路线图响应不完整')
  return value
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '季度路线图加载失败' })
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <UButton :to="`/products/${encodeURIComponent(code)}/cycles/${encodeURIComponent(cycleId)}/items`" color="neutral" variant="ghost">
      返回周期事项
    </UButton>
    <ProductsSaveRoadmapView
      :product-code="code"
      :cycle-id="cycleId"
      :year="Number(year)"
      :quarter="Number(quarter)"
      :unscheduled="unscheduled"
    />
    <UButton :to="`/products/${encodeURIComponent(code)}/views`" color="neutral" variant="outline">
      保存视图与受众展示
    </UButton>
    <h1 class="text-xl font-semibold">
      季度路线图
    </h1>
    <p class="text-sm text-muted">
      按探索窗口展示当前周期事项，沿用优先级决定顺序。跨季度事项可出现在多个季度；时间安排不构成交付承诺。
    </p>
    <div class="flex flex-wrap items-end gap-4">
      <UFormField label="年份" :error="validYear ? undefined : '请输入 1000 至 9999 的年份'">
        <UInput
          v-model="year"
          type="number"
          min="1000"
          max="9999"
          class="w-32"
        />
      </UFormField>
      <UFormField label="季度">
        <USelect v-model="quarter" :items="[{ label: '第一季度', value: '1' }, { label: '第二季度', value: '2' }, { label: '第三季度', value: '3' }, { label: '第四季度', value: '4' }]" class="w-36" />
      </UFormField>
      <UCheckbox v-model="unscheduled" label="仅看未安排窗口" />
      <UButton
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载路线图…
    </p>
    <template v-else-if="status === 'success' && data && validYear">
      <p class="text-sm text-muted">
        {{ unscheduled ? '未安排窗口' : `${data.year} 年第 ${data.quarter} 季度` }} · 共 {{ data.total }} 项
      </p>
      <UCard v-if="!data.items.length">
        <p>当前筛选下没有规划事项。</p>
      </UCard>
      <ol v-else class="space-y-3">
        <li v-for="item in data.items" :key="item.biz_id">
          <UCard>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="min-w-0 break-words font-semibold">
                {{ item.title }}
              </h2>
              <div class="flex flex-wrap gap-2">
                <UBadge color="neutral" variant="subtle">
                  {{ selections[item.selection_status] }}
                </UBadge><UBadge variant="subtle">
                  {{ buckets[item.roadmap_bucket] }}
                </UBadge>
              </div>
            </div>
            <p class="my-2 whitespace-pre-wrap break-words text-sm text-muted">
              {{ item.scope_summary }}
            </p>
            <UButton v-if="item.selection_status === 'selected' && item.starts_on" :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${item.biz_id}/commit`" variant="link">
              确认路线承诺
            </UButton>
            <p class="text-sm">
              {{ item.starts_on ? `${item.starts_on} 至 ${item.ends_on}` : '未安排时间窗口' }}
            </p>
            <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${item.biz_id}/roadmap`" variant="link" class="mt-2">
              查看或调整探索窗口
            </UButton>
          </UCard>
        </li>
      </ol>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :items-per-page="pageSize"
        :total="data.total"
      />
    </template>
  </div>
</template>
