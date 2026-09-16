<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '功能路线', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.featureId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}`)
const buckets = { now: '当前', next: '下一步', later: '以后' }
const states = { draft: '草案', open: '开放中', closed: '已关闭' }
const lifecycleLabels: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
const selectionLabels: Record<string, string> = { candidate: '候选', selected: '已选入', deferred: '暂缓' }
const { search, debounced, flush } = useDebouncedSearch()
const { page, pageSize } = useListPage({ pageSize: 20, filters: { keyword: search }, defaults: { keyword: '' } })
const selected = ref<ProductPlanningCycle | null>(null)
const roadmapPage = ref(1)
const unscheduledPage = ref(1)
interface RoadmapItem { biz_id: string, title: string, scope_summary: string, lifecycle: string, selection_status: string, roadmap_bucket: keyof typeof buckets, decision_rank: number, revision: number }
interface Roadmap { feature_biz_id: string, cycle_biz_id: string, cycle_status: keyof typeof states, workspace_revision: number, cycle_revision: number, queue_revision: number, items: RoadmapItem[], total: number, by_bucket: Record<keyof typeof buckets, number> }
const { data: cycles, status: cycleStatus, error: cycleError, refresh: refreshCycles } = await useFetch(() => `${base.value}/planning-cycles`, { server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined })), transform: (response: { code: number, data: { items: ProductPlanningCycle[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(c => c.product_code !== code.value || !c.biz_id || !Object.hasOwn(states, c.status))) throw new Error('规划周期响应不完整')
  return response.data
} })
const { data: feature, error: featureError } = await useFetch<{ code: number, data: { product_code: string, biz_id: string, title: string } }>(() => `${base.value}/features/${encodeURIComponent(id.value)}`, { server: false })
const { data, status, error, refresh } = await useAsyncData(() => `feature-roadmap:${code.value}:${id.value}`, async () => {
  if (!selected.value) return null
  const cycleId = selected.value.biz_id
  const response = await $fetch<{ code: number, data: Roadmap }>(`${base.value}/features/${encodeURIComponent(id.value)}/roadmap`, { query: { cycleId, page: roadmapPage.value, pageSize: 20 } })
  const value = response.data
  if (response.code !== 0 || value?.feature_biz_id !== id.value || value.cycle_biz_id !== cycleId || !Array.isArray(value.items) || !Object.hasOwn(states, value.cycle_status) || !Number.isSafeInteger(value.total) || value.total < 0 || [value.workspace_revision, value.cycle_revision, value.queue_revision].some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('功能路线响应不完整')
  if (!value.by_bucket || Object.keys(buckets).some(key => !Number.isSafeInteger(value.by_bucket[key as keyof typeof buckets]) || value.by_bucket[key as keyof typeof buckets] < 0) || Object.values(value.by_bucket).reduce((sum, n) => sum + n, 0) !== value.total) throw new Error('路线汇总无效')
  if (value.items.some(item => !item.biz_id || !Object.hasOwn(buckets, item.roadmap_bucket) || !Object.hasOwn(lifecycleLabels, item.lifecycle) || !Object.hasOwn(selectionLabels, item.selection_status) || !Number.isSafeInteger(item.decision_rank))) throw new Error('路线事项无效')
  return value
}, { server: false, watch: [selected, roadmapPage] })
interface UnscheduledItem { biz_id: string, product_code: string, title: string, scope_summary: string, lifecycle: string }
const { data: unscheduled, status: unscheduledStatus, error: unscheduledError, refresh: refreshUnscheduled } = await useFetch(() => `${base.value}/features/${encodeURIComponent(id.value)}/unscheduled`, {
  server: false,
  query: computed(() => ({ page: unscheduledPage.value, pageSize: 20 })),
  transform: (response: { code: number, data: { items: UnscheduledItem[], total: number, workspace_revision: number } }) => {
    const value = response.data
    if (response.code !== 0 || !Array.isArray(value?.items) || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.workspace_revision) || value.workspace_revision < 1 || value.items.some(item => item.product_code !== code.value || !item.biz_id || !Object.hasOwn(lifecycleLabels, item.lifecycle))) throw new Error('未排期事项响应不完整')
    return value
  }
})
const unscheduledAlert = useApiErrorAlert(unscheduledError, { fallbackTitle: '未排期事项加载失败' })
const cycleAlert = useApiErrorAlert(cycleError, { fallbackTitle: '周期加载失败' })
const featureAlert = useApiErrorAlert(featureError, { fallbackTitle: '功能加载失败' })
const alert = useApiErrorAlert(error, { fallbackTitle: '路线加载失败' })
function choose(cycle: ProductPlanningCycle) {
  roadmapPage.value = 1
  selected.value = cycle
}
watch([code, id], () => {
  selected.value = null
  roadmapPage.value = 1
  unscheduledPage.value = 1
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <UButton :to="`/products/${encodeURIComponent(code)}/features/${id}`" color="neutral" variant="ghost">
      返回功能详情
    </UButton>
    <UAlert v-if="featureAlert" v-bind="featureAlert" />
    <h1 class="break-words text-lg font-semibold">
      {{ feature?.code === 0 && feature.data.biz_id === id && feature.data.product_code === code ? feature.data.title : '功能' }} · 路线安排
    </h1>
    <p class="text-sm text-muted">
      选择规划周期查看该功能的事项安排。路线来自周期决定，不代表能力生命周期或交付承诺。
    </p>
    <details :open="!selected" class="space-y-3 rounded-lg border border-default p-4">
      <summary class="cursor-pointer font-medium">
        {{ selected ? `更换周期 · ${selected.title}` : '选择规划周期' }}
      </summary>
      <form class="mt-3 flex flex-wrap gap-2" @submit.prevent="flush">
        <UFormField label="搜索周期" class="min-w-0 flex-1">
          <UInput v-model="search" class="w-full" placeholder="周期标题或目标" />
        </UFormField>
        <UButton
          color="neutral"
          variant="outline"
          :loading="cycleStatus === 'pending'"
          @click="refreshCycles()"
        >
          刷新周期
        </UButton>
      </form>
      <UAlert v-if="cycleAlert" v-bind="cycleAlert" />
      <p v-if="cycleStatus === 'pending'" role="status">
        正在加载周期…
      </p>
      <template v-if="cycleStatus === 'success' && cycles">
        <p v-if="!cycles.items.length" class="text-sm text-muted">
          暂无符合条件的周期。
        </p>
        <div v-for="cycle in cycles.items" :key="cycle.biz_id" class="flex flex-wrap items-center justify-between gap-2 border-b border-default py-2">
          <p class="min-w-0 break-words">
            {{ cycle.title }} · {{ states[cycle.status] }}
          </p>
          <UButton color="neutral" variant="outline" @click="choose(cycle)">
            查看路线
          </UButton>
        </div>
        <UPagination
          v-if="cycles.total > pageSize"
          v-model:page="page"
          :total="cycles.total"
          :items-per-page="pageSize"
          :sibling-count="0"
        />
      </template>
    </details>
    <template v-if="selected">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="break-words font-semibold">
          {{ selected.title }}
        </h2>
        <UButton
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="refresh()"
        >
          刷新路线
        </UButton>
      </div>
      <UAlert v-if="alert" v-bind="alert" />
      <p v-if="status === 'pending'" role="status">
        正在加载路线…
      </p>
      <template v-if="status === 'success' && data && data.cycle_biz_id === selected.biz_id">
        <p class="text-sm text-muted">
          周期状态：{{ states[data.cycle_status] }} · 共 {{ data.total }} 项；下方统计覆盖整个周期，事项列表按页展示。
        </p>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <section v-for="(label, bucket) in buckets" :key="bucket" class="rounded-lg border border-default p-4">
            <h3 class="font-medium">
              {{ label }}
            </h3>
            <p class="text-xl">
              {{ data.by_bucket[bucket] }} 项
            </p>
          </section>
        </div>
        <p v-if="!data.items.length" class="text-sm text-muted">
          本页暂无关联事项；尚未进入该周期的事项不在此处统计。
        </p>
        <article v-for="item in data.items" :key="item.biz_id" class="space-y-2 rounded-lg border border-default p-4">
          <NuxtLink :to="`/products/${encodeURIComponent(code)}/planning-items/${item.biz_id}/feature`" class="break-words font-medium text-primary hover:underline">{{ item.title }}</NuxtLink>
          <p class="text-sm">
            {{ buckets[item.roadmap_bucket] }} · {{ selectionLabels[item.selection_status] }} · {{ lifecycleLabels[item.lifecycle] }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm text-muted">
            {{ item.scope_summary }}
          </p>
        </article>
        <UPagination
          v-if="data.total > 20"
          v-model:page="roadmapPage"
          :total="data.total"
          :items-per-page="20"
          :sibling-count="0"
        />
      </template>
    </template>
    <section class="space-y-3 border-t border-default pt-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">
          尚未排入周期
        </h2>
        <UButton
          color="neutral"
          variant="outline"
          :loading="unscheduledStatus === 'pending'"
          @click="refreshUnscheduled()"
        >
          刷新未排期事项
        </UButton>
      </div>
      <p class="text-sm text-muted">
        展示关联此功能、从未进入任何规划周期的事项，不计入上方周期路线。
      </p>
      <UAlert v-if="unscheduledAlert" v-bind="unscheduledAlert" />
      <p v-if="unscheduledStatus === 'pending'" role="status">
        正在加载未排期事项…
      </p>
      <template v-if="unscheduledStatus === 'success' && unscheduled">
        <p class="text-sm text-muted">
          共 {{ unscheduled.total }} 项
        </p>
        <CommonEmptyState
          v-if="!unscheduled.items.length"
          icon="i-lucide-calendar"
          title="本页没有未排期事项"
          description="可在规划事项中关联此功能，并通过规划周期安排路线。"
        />
        <article v-for="item in unscheduled.items" :key="item.biz_id" class="space-y-2 rounded-lg border border-default p-4">
          <NuxtLink :to="`/products/${encodeURIComponent(code)}/planning-items/${item.biz_id}/feature`" class="break-words font-medium text-primary hover:underline">{{ item.title }}</NuxtLink>
          <p class="text-sm">
            {{ lifecycleLabels[item.lifecycle] }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm text-muted">
            {{ item.scope_summary }}
          </p>
        </article>
        <UPagination
          v-if="unscheduled.total > 20"
          v-model:page="unscheduledPage"
          :total="unscheduled.total"
          :items-per-page="20"
          :sibling-count="0"
        />
      </template>
    </section>
  </div>
</template>
