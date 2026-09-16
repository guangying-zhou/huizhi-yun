<script setup lang="ts">
import type { ProductObservation } from '~/types/productObservation'

interface ObservationPage {
  items: ProductObservation[]
  total: number
  page: number
  pageSize: number
  cycle_biz_id: string
  cycle_status: string
  workspace_revision: number
  cycle_revision: number
}
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '周期结果回看', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.cycleId || ''))
const page = ref(1)
watch([code, id], () => {
  page.value = 1
})
const exact = (value: unknown) => value === null || (typeof value === 'string' && /^-?\d{1,14}(?:\.\d{1,6})?$/.test(value))
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${id.value}/observations`, {
  server: false, timeout: 15000, query: computed(() => ({ page: page.value, pageSize: 20 })),
  transform: (response: { code: number, data: ObservationPage }) => {
    const result = response.data
    if (response.code !== 0 || result?.cycle_biz_id !== id.value || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || !positive(result.page) || result.pageSize !== 20 || !positive(result.workspace_revision) || !positive(result.cycle_revision)) throw new Error('观测分页数据不完整')
    if (result.items.some(item => !positive(item.id) || !item.metric_snapshot?.name || !item.metric_snapshot.unit || !item.metric_snapshot.measurement_method || !exact(item.observed_value) || !exact(item.metric_snapshot.baseline_value) || !exact(item.metric_snapshot.target_value) || !item.evidence?.summary || !item.evidence.source || !item.conclusion || !item.recorded_by || !Number.isFinite(Date.parse(item.observed_at)) || !Number.isFinite(Date.parse(item.recorded_at)) || (item.correction_of_id !== null && !positive(item.correction_of_id)) || (item.corrected_by_id !== null && !positive(item.corrected_by_id)))) throw new Error('观测历史记录不完整')
    return result
  }
})
const { data: permission } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, { server: false, timeout: 15000,
  transform: (response: { code: number, data: { product_code: string, status: string, observe: boolean } }) => {
    if (response.code !== 0 || response.data?.product_code !== code.value) throw new Error('观测权限数据不完整')
    return response.data
  }
})
const canObserve = computed(() => permission.value?.status === 'active' && permission.value.observe && status.value === 'success' && data.value && ['open', 'closed'].includes(data.value.cycle_status))
const alert = useApiErrorAlert(error, { fallbackTitle: '观测历史加载失败' })
// Decimal strings must never pass through Number: large values lose precision.
const amount = (value: string | null) => value === null ? '未知' : value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
</script>

<template>
  <div class="mx-auto max-w-5xl min-w-0 space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton :to="`/products/${encodeURIComponent(code)}/cycles`" color="neutral" variant="ghost">
        返回周期列表
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新观测
      </UButton>
    </div>
    <UButton v-if="canObserve" :to="`/products/${encodeURIComponent(code)}/cycles/${id}/observe`" icon="i-lucide-plus">
      登记观测
    </UButton>
    <p class="text-sm text-muted">
      按登记顺序回看人工观测及证据。更正保留原文；观测值不代表任务完成率。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在读取观测历史…
    </p>
    <template v-else-if="status === 'success' && data">
      <p class="text-sm">
        共 {{ data.total }} 条记录（含更正）
      </p>
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-chart-no-axes-combined"
        title="本页暂无观测记录"
        description="正式观测将保留指标口径、观测值、证据与更正历史。"
      />
      <article v-for="item in data.items" :key="item.id" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="break-words font-semibold">
            {{ item.metric_snapshot.name }} · 记录 #{{ item.id }}
          </h2>
          <UBadge v-if="item.corrected_by_id" color="warning" variant="soft">
            已由 #{{ item.corrected_by_id }} 更正
          </UBadge>
          <UBadge v-if="item.correction_of_id" color="neutral" variant="soft">
            更正 #{{ item.correction_of_id }}
          </UBadge>
        </div>
        <p class="break-words text-lg font-semibold">
          观测值：{{ amount(item.observed_value) }} {{ item.metric_snapshot.unit }}
        </p>
        <p class="break-words text-sm">
          基线：{{ amount(item.metric_snapshot.baseline_value) }} · 目标：{{ amount(item.metric_snapshot.target_value) }}
        </p>
        <UButton
          v-if="canObserve && !item.corrected_by_id"
          :to="`/products/${encodeURIComponent(code)}/cycles/${id}/observations/${item.id}/correct`"
          color="neutral"
          variant="outline"
        >
          追加更正
        </UButton>
        <dl class="space-y-2 text-sm">
          <div>
            <dt class="text-muted">
              测量口径
            </dt><dd class="whitespace-pre-wrap break-words">
              {{ item.metric_snapshot.measurement_method }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              证据摘要及来源
            </dt><dd class="whitespace-pre-wrap break-words">
              {{ item.evidence.summary }}<br>{{ item.evidence.source }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              结论
            </dt><dd class="whitespace-pre-wrap break-words">
              {{ item.conclusion }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              登记／更正原因
            </dt><dd class="whitespace-pre-wrap break-words">
              {{ item.evidence.reason }}
            </dd>
          </div>
        </dl>
        <p class="break-all text-xs text-muted">
          观测时间：{{ item.observed_at }} · 登记人：{{ item.recorded_by }} · 登记时间：{{ item.recorded_at }}
        </p>
      </article>
      <UPagination
        v-model:page="page"
        :items-per-page="20"
        :total="data.total"
        :sibling-count="0"
      />
    </template>
  </div>
</template>
