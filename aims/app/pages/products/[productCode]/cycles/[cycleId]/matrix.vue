<script setup lang="ts">
import { productMatrixY, validProductMatrixPoint } from '~/utils/productMatrixPoint'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '评分／投入矩阵', layoutHeaderProjectSwitcher: false })
interface MatrixItem {
  biz_id: string
  product_code: string
  title: string
  investment_category: string
  lifecycle: string
  assessment: { model_method?: 'weighted-value-effort' | 'rice', rice_impact?: string | null, value_score: number | null, effort_person_days: string | null, confidence: string | null, priority_score: string | null, stale: boolean } | null
}
interface Matrix {
  model_method: 'weighted-value-effort' | 'rice'
  points: MatrixItem[]
  unplotted: MatrixItem[]
  total: number
  returned: number
  limit: number
  truncated: boolean
  cycle_biz_id: string
  value_threshold: string
  effort_threshold_person_days: string
}
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const category = ref('all'), selection = ref('all'), listPage = ref(1), mobileChart = ref(false)
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  listPage.value = 1
} })
const categories: Record<string, string> = { reliability: '可靠性与治理', usability: '体验优化', growth: '新功能与增长' }
const colors: Record<string, string> = { reliability: 'fill-warning', usability: 'fill-info', growth: 'fill-primary' }
watch([category, selection], () => {
  listPage.value = 1
})
const query = computed(() => ({ keyword: debounced.value || undefined, investmentCategory: category.value === 'all' ? undefined : category.value, selectionStatus: selection.value === 'all' ? undefined : selection.value }))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${cycleId.value}/matrix`, {
  server: false, query,
  transform: (response: { code: number, data: Matrix }) => {
    const value = response.data
    if (response.code !== 0 || !value || !['weighted-value-effort', 'rice'].includes(value.model_method) || value.cycle_biz_id !== cycleId.value || !Array.isArray(value.points) || !Array.isArray(value.unplotted) || value.limit !== 200 || !Number.isSafeInteger(value.total) || value.total < 0 || value.returned !== value.points.length + value.unplotted.length || value.returned > value.limit || value.returned > value.total || value.truncated !== (value.total > value.returned)) throw new Error('矩阵响应不完整')
    if ([...value.points, ...value.unplotted].some(item => item.product_code !== code.value || !item.biz_id || !Object.hasOwn(categories, item.investment_category))) throw new Error('矩阵事项信息无效')
    if (value.points.some(item => !validProductMatrixPoint(value.model_method, item.assessment))) throw new Error('矩阵坐标数据无效')
    if (!Number.isFinite(Number(value.value_threshold)) || Number(value.value_threshold) < 0 || Number(value.value_threshold) > 100 || !Number.isFinite(Number(value.effort_threshold_person_days)) || Number(value.effort_threshold_person_days) <= 0) throw new Error('矩阵分区阈值无效')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '矩阵加载失败' })
const maxEffort = computed(() => Math.max(10, Number(data.value?.effort_threshold_person_days || 5), ...(data.value?.points || []).map(item => Number(item.assessment?.effort_person_days))))
const x = (effort: number) => 60 + effort / maxEffort.value * 600
const rice = computed(() => data.value?.model_method === 'rice')
const scoreLabel = computed(() => rice.value ? 'RICE 人日分' : '价值分')
const pointValue = (item: MatrixItem) => rice.value ? Number(item.assessment?.priority_score) : Number(item.assessment?.value_score)
const maxValue = computed(() => rice.value ? Math.max(1, ...(data.value?.points || []).map(pointValue)) : 100)
const y = (value: number) => productMatrixY(value, maxValue.value)
const rows = computed(() => [...(data.value?.points || []).map(item => ({ item, plotted: true })), ...(data.value?.unplotted || []).map(item => ({ item, plotted: false }))])
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items`"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
    >
      返回周期候选
    </UButton>
    <p class="text-sm text-muted">
      加权模型比较价值与投入；RICE 比较人日推荐分与投入，其纵轴随当前点集缩放，不使用加权价值分区线。推荐分只在同投资类别内比较，位置不代表正式顺序或交付承诺。
    </p>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索事项" class="min-w-0 flex-1 basis-48">
        <UInput v-model="search" class="w-full" />
      </UFormField>
      <UFormField label="投资类别">
        <USelect v-model="category" :items="[{ label: '全部类别', value: 'all' }, ...Object.entries(categories).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UFormField label="选择结果">
        <USelect v-model="selection" :items="[{ label: '全部结果', value: 'all' }, { label: '候选', value: 'candidate' }, { label: '已选入', value: 'selected' }, { label: '暂缓', value: 'deferred' }]" />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        @click="reset(); category = 'all'; selection = 'all'; listPage = 1"
      >
        重置
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新矩阵
      </UButton>
    </form>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载矩阵…
    </p>
    <template v-if="status === 'success' && data">
      <UAlert
        v-if="data.truncated"
        color="warning"
        title="当前未展示全部事项"
        :description="`符合筛选共 ${data.total} 项，仅返回 ${data.returned} 项。请缩小筛选范围；图中点数不代表全部事项。`"
      />
      <p class="text-sm text-muted">
        共 {{ data.total }} 项，已返回 {{ data.returned }} 项；可绘制 {{ data.points.length }} 项，未绘制 {{ data.unplotted.length }} 项。
      </p>
      <UButton
        class="sm:hidden"
        color="neutral"
        variant="outline"
        :aria-expanded="mobileChart"
        @click="mobileChart = !mobileChart"
      >
        {{ mobileChart ? '收起矩阵，查看列表' : '展开矩阵' }}
      </UButton>
      <div :class="mobileChart ? 'block' : 'hidden sm:block'" class="rounded-lg border border-default p-2">
        <svg
          viewBox="0 0 720 360"
          role="img"
          :aria-label="`${scoreLabel}与投入散点矩阵，完整数值及评估链接见下方事项列表`"
          class="w-full text-muted"
        >
          <line
            x1="60"
            y1="50"
            x2="60"
            y2="310"
            stroke="currentColor"
          />
          <line
            x1="60"
            y1="310"
            x2="660"
            y2="310"
            stroke="currentColor"
          />
          <line
            :x1="x(Number(data.effort_threshold_person_days))"
            y1="50"
            :x2="x(Number(data.effort_threshold_person_days))"
            y2="310"
            stroke="currentColor"
            stroke-dasharray="5 5"
            opacity="0.5"
          />
          <line
            v-if="!rice"
            x1="60"
            :y1="y(Number(data.value_threshold))"
            x2="660"
            :y2="y(Number(data.value_threshold))"
            stroke="currentColor"
            stroke-dasharray="5 5"
            opacity="0.5"
          />
          <text
            x="15"
            y="35"
            fill="currentColor"
            font-size="13"
          >{{ scoreLabel }}</text>
          <text
            x="28"
            y="55"
            fill="currentColor"
            font-size="12"
          >{{ maxValue }}</text>
          <text
            x="40"
            y="315"
            fill="currentColor"
            font-size="12"
          >0</text>
          <text
            x="330"
            y="350"
            fill="currentColor"
            font-size="13"
          >投入（人日）</text>
          <text
            x="620"
            y="330"
            fill="currentColor"
            font-size="12"
          >{{ maxEffort }}</text>
          <circle
            v-for="point in data.points"
            :key="point.biz_id"
            :cx="x(Number(point.assessment!.effort_person_days))"
            :cy="y(pointValue(point))"
            r="5"
            :class="colors[point.investment_category]"
            :opacity="Number(point.assessment!.confidence)"
          >
            <title>{{ point.title }}：{{ scoreLabel }} {{ pointValue(point) }}，投入 {{ point.assessment!.effort_person_days }} 人日，置信度 {{ point.assessment!.confidence }}</title>
          </circle>
        </svg>
        <p class="px-2 text-xs text-muted">
          虚线：{{ rice ? '' : '价值 ' + data.value_threshold + '／' }}投入 {{ data.effort_threshold_person_days }} 人日。透明度表示置信度；重叠点可在下方列表逐项查看。
        </p>
        <div class="flex flex-wrap gap-4 p-2 text-sm">
          <span class="text-warning">● 可靠性与治理</span><span class="text-info">● 体验优化</span><span class="text-primary">● 新功能与增长</span>
        </div>
      </div>
      <CommonEmptyState
        v-if="!rows.length"
        icon="i-lucide-chart-scatter"
        title="暂无符合条件的事项"
        description="请调整筛选或添加周期候选。"
      />
      <div v-for="row in rows.slice((listPage - 1) * 20, listPage * 20)" :key="row.item.biz_id" class="space-y-2 rounded-lg border border-default p-3">
        <NuxtLink :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items/${row.item.biz_id}/assessments`" class="break-words font-medium text-primary hover:underline">{{ row.item.title }}</NuxtLink>
        <p class="text-sm text-muted">
          {{ categories[row.item.investment_category] }} · {{ row.plotted ? '已绘制' : row.item.assessment?.stale ? '未绘制：评估已过期' : '未绘制：评估缺失或不完整' }}
        </p>
        <p class="text-sm">
          {{ row.item.assessment?.model_method === 'rice' ? 'RICE 影响 ' + (row.item.assessment.rice_impact ?? '未知') : '价值 ' + (row.item.assessment?.value_score ?? '未知') }} · 投入 {{ row.item.assessment?.effort_person_days ?? '未知' }} 人日 · 置信度 {{ row.item.assessment?.confidence ?? '未知' }} · 推荐分 {{ row.item.assessment?.priority_score ?? '待评估' }}
        </p>
      </div>
      <UPagination
        v-if="rows.length > 20"
        v-model:page="listPage"
        :total="rows.length"
        :items-per-page="20"
        :sibling-count="0"
      />
    </template>
  </div>
</template>
