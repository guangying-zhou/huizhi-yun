<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '周期容量', layoutHeaderProjectSwitcher: false })
interface Issue { code: string, item_id?: string, predecessor_id?: string, category?: string }
interface Report {
  retained_person_days: string
  occupied_person_days: string
  selected_person_days: string
  available_person_days: string
  remaining_person_days: string
  by_category: Record<string, string>
  unknown_estimates: number
  issues: Issue[]
}
interface CapacityView {
  cycle_biz_id: string
  workspace_revision: number
  cycle_revision: number
  queue_revision: number
  budget: NonNullable<ProductPlanningCycle['budget']>
  confirmed: Report
  latest: Report
  changes: { item_id: string, confirmed_category: string, latest_category: string, confirmed_person_days: string | null, latest_person_days: string | null, delta_person_days: string | null }[]
}
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const categories: Record<string, string> = { reliability: '可靠性与治理', usability: '体验优化', growth: '新功能与增长' }
const issues: Record<string, string> = { assessment_required: '需要重新评估', effort_required: '投入尚未确认', dependency_unresolved: '前置依赖未解除', cross_dependency_unresolved: '跨产品依赖需协调', capacity_exceeded: '超过周期可用容量', category_capacity_exceeded: '超过类别预算' }
const issuePage = ref(1), changePage = ref(1)
const decimal = (value: unknown) => typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value) && Number.isFinite(Number(value))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${cycleId.value}/capacity`, {
  server: false,
  transform: (response: { code: number, data: CapacityView }) => {
    const value = response.data
    if (response.code !== 0 || !value || value.cycle_biz_id !== cycleId.value || !value.budget || !Array.isArray(value.changes)) throw new Error('容量响应不完整')
    for (const revision of [value.workspace_revision, value.cycle_revision, value.queue_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('容量版本无效')
    for (const key of ['total_person_days', 'reserve_person_days', 'reliability_person_days', 'usability_person_days', 'growth_person_days'] as const) if (!decimal(value.budget[key]) || Number(value.budget[key]) < 0) throw new Error('周期预算不完整')
    for (const report of [value.confirmed, value.latest]) {
      if (!report || !decimal(report.retained_person_days) || Number(report.retained_person_days) < 0 || !decimal(report.occupied_person_days) || Number(report.occupied_person_days) < 0 || !decimal(report.selected_person_days) || Number(report.selected_person_days) < 0 || !decimal(report.available_person_days) || !decimal(report.remaining_person_days) || !Number.isSafeInteger(report.unknown_estimates) || report.unknown_estimates < 0 || !Array.isArray(report.issues) || !report.by_category || typeof report.by_category !== 'object') throw new Error('容量汇总无效')
      if (Object.entries(report.by_category).some(([key, amount]) => !Object.hasOwn(categories, key) || !decimal(amount) || Number(amount) < 0)) throw new Error('分类占用无效')
    }
    if (value.changes.some(change => !change.item_id || !Object.hasOwn(categories, change.confirmed_category) || !Object.hasOwn(categories, change.latest_category) || [change.confirmed_person_days, change.latest_person_days, change.delta_person_days].some(amount => amount !== null && !decimal(amount)))) throw new Error('投入变化信息无效')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '周期容量加载失败' })
const itemLink = (id: string) => `/products/${encodeURIComponent(code.value)}/cycles/${cycleId.value}/items/${id}/assessments`
const budgetFor = (category: string) => data.value?.budget[`${category}_person_days` as keyof CapacityView['budget']]
const delta = (category: string, report: Report) => (Number(budgetFor(category)) - Number(report.by_category[category] || '0.00')).toFixed(2)
watch([code, cycleId, data], () => {
  issuePage.value = 1
  changePage.value = 1
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
      >
        返回周期候选
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新容量
      </UButton>
    </div>
    <p class="text-sm text-muted">
      以下为整个周期的规划预算。本期完成事项和撤回后已发生投入仍计入占用；最新估算用于复评，不自动改变已确认决定，也不代表人员排班或交付承诺。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载周期容量…
    </p>
    <template v-if="status === 'success' && data">
      <p class="text-sm">
        总容量 {{ data.budget.total_person_days }} 人日 · 应急预留 {{ data.budget.reserve_person_days }} 人日 · 正常可用 {{ data.confirmed.available_person_days }} 人日
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <section v-for="entry in [{ title: '已确认占用', report: data.confirmed }, { title: '最新估算测算', report: data.latest }]" :key="entry.title" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
          <h2 class="font-semibold">
            {{ entry.title }}
          </h2>
          <p>周期总占用 <strong>{{ entry.report.occupied_person_days }}</strong> 人日</p>
          <p>已选事项投入 {{ entry.report.selected_person_days }} 人日</p>
          <p>撤回后保留投入 {{ entry.report.retained_person_days }} 人日</p>
          <p :class="Number(entry.report.remaining_person_days) < 0 ? 'text-error' : ''">
            预算差额 {{ entry.report.remaining_person_days }} 人日
          </p>
          <p class="text-sm text-muted">
            未知估算 {{ entry.report.unknown_estimates }} 项
          </p>
          <p v-if="entry.report.unknown_estimates" class="text-sm text-warning">
            存在未知投入，差额仅扣除已知值，不能据此判断还有多少可用容量。
          </p>
        </section>
      </div>
      <section aria-label="投资类别容量" class="grid gap-3 md:grid-cols-3">
        <div v-for="(label, category) in categories" :key="category" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
          <h2 class="font-semibold">
            {{ label }}
          </h2>
          <p class="text-sm">
            预算 {{ budgetFor(category) }} 人日
          </p>
          <p class="text-sm">
            已确认 {{ data.confirmed.by_category[category] || '0.00' }} · 差额 {{ delta(category, data.confirmed) }} 人日
          </p>
          <p class="text-sm" :class="Number(delta(category, data.latest)) < 0 ? 'text-error' : ''">
            最新测算 {{ data.latest.by_category[category] || '0.00' }} · 差额 {{ delta(category, data.latest) }} 人日
          </p>
        </div>
      </section>
      <section class="space-y-3">
        <h2 class="font-semibold">
          投入与类别变化 · 共 {{ data.changes.length }} 项
        </h2>
        <p v-if="!data.changes.length" class="text-sm text-muted">
          当前投入和类别与冻结决定一致；仍需检查下方评估与依赖问题。
        </p>
        <div v-for="change in data.changes.slice((changePage - 1) * 20, changePage * 20)" :key="change.item_id" class="space-y-1 rounded-lg border border-default p-3">
          <NuxtLink :to="itemLink(change.item_id)" class="break-all text-sm text-primary hover:underline">事项 {{ change.item_id }}</NuxtLink>
          <p class="text-sm">
            已确认：{{ categories[change.confirmed_category] }}，{{ change.confirmed_person_days ?? '未知' }} 人日
          </p>
          <p class="text-sm">
            最新：{{ categories[change.latest_category] }}，{{ change.latest_person_days ?? '未知' }} 人日；变化 {{ change.delta_person_days ?? '无法计算' }}
          </p>
        </div>
        <UPagination
          v-if="data.changes.length > 20"
          v-model:page="changePage"
          :total="data.changes.length"
          :items-per-page="20"
          :sibling-count="0"
        />
      </section>
      <section class="space-y-3">
        <h2 class="font-semibold">
          最新测算的问题 · 共 {{ data.latest.issues.length }} 项
        </h2>
        <p class="text-sm text-muted">
          问题保留显示，已有例外不表示依赖解除或预算增加。正式选择还需核验对应例外与权限。
        </p>
        <CommonEmptyState
          v-if="!data.latest.issues.length"
          icon="i-lucide-list-checks"
          title="当前未发现容量或依赖问题"
          description="仍需完成期限、投入和交付安排的确认。"
        />
        <div v-for="(issue, index) in data.latest.issues.slice((issuePage - 1) * 20, issuePage * 20)" :key="index" class="space-y-1 rounded-lg border border-default p-3 text-sm">
          <p class="font-medium text-warning">
            {{ issues[issue.code] || '需要处理的规划问题' }}{{ issue.category ? ` · ${categories[issue.category] || issue.category}` : '' }}
          </p>
          <NuxtLink v-if="issue.item_id" :to="itemLink(issue.item_id)" class="block break-all text-primary hover:underline">查看事项 {{ issue.item_id }}</NuxtLink>
          <p v-if="issue.predecessor_id" class="break-all text-muted">
            前置事项 {{ issue.predecessor_id }}
          </p>
        </div>
        <UPagination
          v-if="data.latest.issues.length > 20"
          v-model:page="issuePage"
          :total="data.latest.issues.length"
          :items-per-page="20"
          :sibling-count="0"
        />
      </section>
    </template>
  </div>
</template>
