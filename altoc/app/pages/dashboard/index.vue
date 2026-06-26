<script setup lang="ts">
import { FORECAST_CATEGORY_OPTIONS, OPPORTUNITY_LOST_REASON_OPTIONS, OPPORTUNITY_PIPELINE_OPTIONS, OPPORTUNITY_WON_REASON_OPTIONS, SOURCE_TYPE_OPTIONS } from '~/types/altoc'

const router = useRouter()
const pipelineFilter = ref('default')
const pipelineSelectOptions = OPPORTUNITY_PIPELINE_OPTIONS
const opportunityDashboardQuery = computed(() => ({ pipeline_code: pipelineFilter.value }))

interface KpiCard {
  key: string
  label: string
  value: number | null
  unit: 'percent' | 'amount' | 'days'
  health: 'good' | 'warning' | 'bad' | null
  sub?: string
}

interface DashboardKpis {
  kpis?: KpiCard[]
}

interface FunnelStage {
  id: number
  name: string
  sort_no?: number
  win_rate?: number | null
  opp_count: number
  total_amount: number | null
}

interface ForecastBucket {
  forecast_category: 'pipeline' | 'best_case' | 'commit' | string
  opp_count: number
  total_amount: number | null
}

interface ForecastData {
  forecast?: ForecastBucket[]
  weighted_amount?: number | null
  win_rate?: number
  avg_cycle_days?: number
}

interface ReceivableAging {
  aging: string
  count: number
  amount: number | null
}

interface ReceivableItem {
  id: number
  plan_name: string
  customer_name: string | null
  contract_name: string | null
  unreceived_amount: number | null
  planned_payment_date: string | null
  overdue_days?: number | null
}

interface ReceivablesData {
  overdue_breakdown?: ReceivableAging[]
  upcoming?: ReceivableItem[]
  overdue_list?: ReceivableItem[]
}

interface SourceConversion {
  source_type: string
  lead_count: number
  converted_count: number
  conversion_rate: number | null
}

interface StageAging {
  id: number | null
  name: string | null
  sort_no: number | null
  opp_count: number
  total_amount: number | null
  avg_days_in_stage: number | null
}

interface SignDateSlippage {
  overdue_count: number
  overdue_amount: number
  avg_overdue_days: number | null
}

interface ActionRisks {
  total_open_count: number
  no_next_action_count: number
  next_action_overdue_count: number
  follow_up_stale_count: number
  never_followed_count: number
}

interface ReasonBreakdown {
  reason_code: string
  opp_count: number
  total_amount: number | null
}

interface ForecastAccuracy {
  forecast_category: string
  closed_count: number
  won_count: number
  actual_win_rate: number | null
  won_amount: number | null
  total_amount: number | null
}

interface SalesCycleSummary {
  closed_count: number
  avg_days: number | null
  won_avg_days: number | null
  lost_avg_days: number | null
}

interface SalesCycleSource {
  source_type: string
  closed_count: number
  won_count: number
  win_rate: number | null
  avg_days: number | null
}

interface SalesCycle {
  summary?: SalesCycleSummary
  by_source?: SalesCycleSource[]
}

interface WinLossSource {
  source_type: string
  closed_count: number
  won_count: number
  lost_count: number
  win_rate: number | null
  won_amount: number | null
  lost_amount: number | null
  total_amount: number | null
}

interface SalesInsights {
  source_conversion?: SourceConversion[]
  stage_aging?: StageAging[]
  sign_date_slippage?: SignDateSlippage
  action_risks?: ActionRisks
  lead_action_risks?: ActionRisks
  sales_cycle?: SalesCycle
  win_loss_by_source?: WinLossSource[]
  forecast_accuracy?: ForecastAccuracy[]
  won_reasons?: ReasonBreakdown[]
  lost_reasons?: ReasonBreakdown[]
}

// P0-9：统一 KPI API — 返回 Design Doc §5 列出的 8 个经营指标
const { data: kpis } = useFetch('/api/v1/dashboard/kpis', {
  query: opportunityDashboardQuery,
  transform: (res: { data?: DashboardKpis }) => res.data?.kpis || []
})

// 原有细节数据（漏斗 / 预测分类 / 回款明细）仍由各自 API 提供
const { data: funnel } = useFetch('/api/v1/dashboard/funnel', {
  query: opportunityDashboardQuery,
  transform: (res: { data?: FunnelStage[] }) => res.data || []
})
const { data: forecast } = useFetch('/api/v1/dashboard/forecast', {
  query: opportunityDashboardQuery,
  transform: (res: { data?: ForecastData }) => res.data
})
const { data: receivables } = useFetch('/api/v1/dashboard/receivables', {
  transform: (res: { data?: ReceivablesData }) => res.data
})
const { data: salesInsights } = useFetch('/api/v1/dashboard/sales-insights', {
  query: opportunityDashboardQuery,
  transform: (res: { data?: SalesInsights }) => res.data || {}
})

const sourceTypeLabels: Record<string, string> = Object.fromEntries(SOURCE_TYPE_OPTIONS.map(item => [item.value, item.label]))
const wonReasonLabels: Record<string, string> = Object.fromEntries(OPPORTUNITY_WON_REASON_OPTIONS.map(item => [item.value, item.label]))
const lostReasonLabels: Record<string, string> = Object.fromEntries(OPPORTUNITY_LOST_REASON_OPTIONS.map(item => [item.value, item.label]))
const forecastCategoryLabels: Record<string, string> = Object.fromEntries(FORECAST_CATEGORY_OPTIONS.map(item => [item.value, item.label]))

function formatMoney(val: number | null | undefined) {
  if (val == null || val === 0) return '--'
  if (val >= 10000) return (val / 10000).toFixed(1) + '万'
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0 }).format(val)
}

function formatFullMoney(val: number | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(val)
}

/**
 * 按 KPI unit + health 渲染一张卡片的主文本
 */
function formatKpiValue(k: KpiCard): string {
  if (k.value === null || k.value === undefined) return '--'
  if (k.unit === 'percent') return String(k.value)
  if (k.unit === 'days') return String(k.value)
  if (k.unit === 'amount') return formatMoney(k.value)
  return String(k.value)
}

function kpiValueSuffix(k: KpiCard): string {
  if (k.value === null) return ''
  if (k.unit === 'percent') return '%'
  if (k.unit === 'days') return '天'
  return ''
}

/**
 * KPI 卡片文字颜色 — Design Doc 要求异常指标高亮 error 色
 */
function kpiValueClass(k: KpiCard): string {
  if (k.value === null) return 'text-muted'
  switch (k.health) {
    case 'good': return 'text-success'
    case 'warning': return 'text-warning'
    case 'bad': return 'text-error'
    default: return ''
  }
}

function formatPercent(val: number | null | undefined) {
  if (val == null) return '--'
  return `${val}%`
}

function formatDays(val: number | null | undefined) {
  if (val == null) return '--'
  return `${val}天`
}

function sourceLabel(value: string | null | undefined) {
  if (!value || value === 'unknown') return '未标记'
  return sourceTypeLabels[value] || value
}

function lostReasonLabel(value: string | null | undefined) {
  if (!value || value === 'uncategorized') return '未分类'
  return lostReasonLabels[value] || value
}

function wonReasonLabel(value: string | null | undefined) {
  if (!value || value === 'uncategorized') return '未分类'
  return wonReasonLabels[value] || value
}

function forecastCategoryLabel(value: string | null | undefined) {
  if (!value) return '未分类'
  return forecastCategoryLabels[value] || value
}

function stageAgingKey(stage: StageAging) {
  return stage.id != null ? `stage-${stage.id}` : `stage-${stage.name || 'unknown'}`
}

// 漏斗最大金额（用于计算柱状图宽度比例）
const maxFunnelAmount = computed(() => {
  if (!funnel.value?.length) return 1
  return Math.max(...funnel.value.map(stage => stage.total_amount || 0), 1)
})

const maxSourceLeadCount = computed(() => {
  const rows = salesInsights.value?.source_conversion || []
  return Math.max(...rows.map(item => item.lead_count || 0), 1)
})

const maxStageAgingDays = computed(() => {
  const rows = salesInsights.value?.stage_aging || []
  return Math.max(...rows.map(item => item.avg_days_in_stage || 0), 1)
})

const maxLostReasonCount = computed(() => {
  const rows = salesInsights.value?.lost_reasons || []
  return Math.max(...rows.map(item => item.opp_count || 0), 1)
})

const maxWonReasonCount = computed(() => {
  const rows = salesInsights.value?.won_reasons || []
  return Math.max(...rows.map(item => item.opp_count || 0), 1)
})

const maxForecastClosedCount = computed(() => {
  const rows = salesInsights.value?.forecast_accuracy || []
  return Math.max(...rows.map(item => item.closed_count || 0), 1)
})

const maxSalesCycleDays = computed(() => {
  const rows = salesInsights.value?.sales_cycle?.by_source || []
  return Math.max(...rows.map(item => item.avg_days || 0), 1)
})

const maxWinLossSourceClosedCount = computed(() => {
  const rows = salesInsights.value?.win_loss_by_source || []
  return Math.max(...rows.map(item => item.closed_count || 0), 1)
})
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          经营看板
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <USelect
          v-model="pipelineFilter"
          :items="pipelineSelectOptions"
          class="w-44"
        />
      </Teleport>

      <div class="p-4 space-y-6">
        <!-- P0-9 看板 KPI 卡片行（Design Doc §5 的 8 个指标，统一由 /kpis API 驱动） -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <UCard v-for="kpi in kpis" :key="kpi.key">
            <div class="text-center">
              <div class="text-3xl font-bold font-[Geist] tabular-nums" :class="kpiValueClass(kpi)">
                {{ formatKpiValue(kpi) }}<span v-if="kpiValueSuffix(kpi)" class="text-lg">{{ kpiValueSuffix(kpi) }}</span>
              </div>
              <div class="text-xs text-muted mt-1">
                {{ kpi.label }}
              </div>
              <div v-if="kpi.sub" class="text-[10px] text-muted/70 mt-0.5 truncate">
                {{ kpi.sub }}
              </div>
            </div>
          </UCard>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- 销售漏斗 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">销售漏斗</span>
            </template>
            <div v-if="funnel?.length" class="space-y-3">
              <div v-for="stage in funnel" :key="stage.id" class="flex items-center gap-3">
                <div class="w-20 text-xs text-right shrink-0 truncate">
                  {{ stage.name }}
                </div>
                <div class="flex-1 h-8 bg-elevated rounded relative overflow-hidden">
                  <div
                    class="h-full bg-primary/20 rounded flex items-center px-2 transition-all"
                    :style="{ width: Math.max(2, (stage.total_amount || 0) / maxFunnelAmount * 100) + '%' }"
                  >
                    <span class="text-xs font-mono whitespace-nowrap">{{ formatMoney(stage.total_amount) }}</span>
                  </div>
                </div>
                <div class="w-8 text-xs text-muted text-center shrink-0">
                  {{ stage.opp_count }}
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无数据
            </div>
          </UCard>

          <!-- 预测分类 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm flex items-center gap-1">商机预测分类
                <UTooltip>
                  <template #content>
                    <div class="text-xs space-y-1 p-1">
                      <div>管线：有可能成交的机会</div>
                      <div>最佳预期：如果顺利，3个月到半年内能签单</div>
                      <div>承诺：客户已口头确认，3个月内定能下单</div>
                    </div>
                  </template>
                  <UIcon name="i-lucide-info" class="text-muted w-3.5 h-3.5" />
                </UTooltip>
              </span>
            </template>
            <div v-if="forecast?.forecast?.length" class="space-y-4">
              <div v-for="cat in forecast.forecast" :key="cat.forecast_category" class="flex items-center justify-between">
                <div>
                  <span class="font-medium text-sm">{{ forecastCategoryLabel(cat.forecast_category) }}</span>
                  <span class="text-xs text-muted ml-2">{{ cat.opp_count }} 个商机</span>
                </div>
                <span class="font-mono font-bold">{{ formatFullMoney(cat.total_amount) }}</span>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无数据
            </div>
          </UCard>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">来源转化率</span>
            </template>
            <div v-if="salesInsights?.source_conversion?.length" class="space-y-3">
              <div v-for="item in salesInsights.source_conversion" :key="item.source_type" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ sourceLabel(item.source_type) }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ item.converted_count || 0 }} / {{ item.lead_count || 0 }} 条线索
                    </div>
                  </div>
                  <UBadge :color="(item.conversion_rate || 0) >= 30 ? 'success' : (item.conversion_rate || 0) >= 15 ? 'warning' : 'neutral'" variant="subtle" size="xs">
                    {{ formatPercent(item.conversion_rate) }}
                  </UBadge>
                </div>
                <div class="h-2 bg-elevated rounded overflow-hidden">
                  <div
                    class="h-full bg-primary/35 rounded"
                    :style="{ width: Math.max(3, (item.lead_count || 0) / maxSourceLeadCount * 100) + '%' }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无数据
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold text-sm">赢输来源</span>
            </template>
            <div v-if="salesInsights?.win_loss_by_source?.length" class="space-y-3">
              <div v-for="item in salesInsights.win_loss_by_source" :key="item.source_type" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ sourceLabel(item.source_type) }}
                    </div>
                    <div class="text-xs text-muted">
                      赢 {{ item.won_count || 0 }} / 输 {{ item.lost_count || 0 }}
                    </div>
                  </div>
                  <UBadge :color="(item.win_rate || 0) >= 50 ? 'success' : (item.win_rate || 0) >= 25 ? 'warning' : 'neutral'" variant="subtle" size="xs">
                    {{ formatPercent(item.win_rate) }}
                  </UBadge>
                </div>
                <div class="flex h-2 overflow-hidden rounded bg-elevated">
                  <div
                    class="h-full bg-success/40"
                    :style="{ width: Math.max(0, (item.won_count || 0) / Math.max(item.closed_count || 0, 1) * 100) + '%' }"
                  />
                  <div
                    class="h-full bg-error/35"
                    :style="{ width: Math.max(0, (item.lost_count || 0) / Math.max(item.closed_count || 0, 1) * 100) + '%' }"
                  />
                </div>
                <div class="flex items-center justify-between text-xs text-muted">
                  <span>关闭 {{ item.closed_count || 0 }} 个</span>
                  <span class="font-mono">{{ formatMoney(item.total_amount) }}</span>
                </div>
                <div class="h-1 bg-elevated rounded overflow-hidden">
                  <div
                    class="h-full bg-info/35 rounded"
                    :style="{ width: Math.max(3, (item.closed_count || 0) / maxWinLossSourceClosedCount * 100) + '%' }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无已关闭商机
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold text-sm">阶段停留与滑移</span>
            </template>
            <div class="space-y-4">
              <div v-if="salesInsights?.stage_aging?.length" class="space-y-3">
                <div v-for="stage in salesInsights.stage_aging" :key="stageAgingKey(stage)" class="space-y-1.5">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium truncate">
                        {{ stage.name || '未分阶段' }}
                      </div>
                      <div class="text-xs text-muted">
                        {{ stage.opp_count || 0 }} 个商机 · {{ formatMoney(stage.total_amount) }}
                      </div>
                    </div>
                    <span class="font-mono text-xs shrink-0">{{ formatDays(stage.avg_days_in_stage) }}</span>
                  </div>
                  <div class="h-2 bg-elevated rounded overflow-hidden">
                    <div
                      class="h-full bg-warning/40 rounded"
                      :style="{ width: Math.max(3, (stage.avg_days_in_stage || 0) / maxStageAgingDays * 100) + '%' }"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="text-center py-4 text-muted text-sm">
                暂无阶段停留数据
              </div>

              <div class="grid grid-cols-3 gap-3 pt-3 border-t border-default">
                <div>
                  <div class="text-xs text-muted">
                    滑移商机
                  </div>
                  <div class="font-mono text-lg font-semibold text-warning">
                    {{ salesInsights?.sign_date_slippage?.overdue_count || 0 }}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    滑移金额
                  </div>
                  <div class="font-mono text-lg font-semibold">
                    {{ formatMoney(salesInsights?.sign_date_slippage?.overdue_amount) }}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    平均滑移
                  </div>
                  <div class="font-mono text-lg font-semibold">
                    {{ formatDays(salesInsights?.sign_date_slippage?.avg_overdue_days) }}
                  </div>
                </div>
              </div>

              <div class="space-y-3 pt-3 border-t border-default">
                <div class="text-xs font-medium text-muted">
                  商机行动风险
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <div class="text-xs text-muted">
                      无下一步
                    </div>
                    <div class="font-mono text-lg font-semibold text-warning">
                      {{ salesInsights?.action_risks?.no_next_action_count || 0 }}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-muted">
                      行动逾期
                    </div>
                    <div class="font-mono text-lg font-semibold text-error">
                      {{ salesInsights?.action_risks?.next_action_overdue_count || 0 }}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-muted">
                      跟进超期
                    </div>
                    <div class="font-mono text-lg font-semibold text-warning">
                      {{ salesInsights?.action_risks?.follow_up_stale_count || 0 }}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-muted">
                      未跟进
                    </div>
                    <div class="font-mono text-lg font-semibold text-warning">
                      {{ salesInsights?.action_risks?.never_followed_count || 0 }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="space-y-3 pt-3 border-t border-default">
                <div class="text-xs font-medium text-muted">
                  线索行动风险
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <div class="text-xs text-muted">
                      无下一步
                    </div>
                    <div class="font-mono text-lg font-semibold text-warning">
                      {{ salesInsights?.lead_action_risks?.no_next_action_count || 0 }}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-muted">
                      行动逾期
                    </div>
                    <div class="font-mono text-lg font-semibold text-error">
                      {{ salesInsights?.lead_action_risks?.next_action_overdue_count || 0 }}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-muted">
                      跟进超期
                    </div>
                    <div class="font-mono text-lg font-semibold text-warning">
                      {{ salesInsights?.lead_action_risks?.follow_up_stale_count || 0 }}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-muted">
                      未跟进
                    </div>
                    <div class="font-mono text-lg font-semibold text-warning">
                      {{ salesInsights?.lead_action_risks?.never_followed_count || 0 }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold text-sm">销售周期</span>
            </template>
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-xs text-muted">
                    已关闭
                  </div>
                  <div class="font-mono text-lg font-semibold">
                    {{ salesInsights?.sales_cycle?.summary?.closed_count || 0 }}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    平均周期
                  </div>
                  <div class="font-mono text-lg font-semibold">
                    {{ formatDays(salesInsights?.sales_cycle?.summary?.avg_days) }}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    赢单周期
                  </div>
                  <div class="font-mono text-lg font-semibold text-success">
                    {{ formatDays(salesInsights?.sales_cycle?.summary?.won_avg_days) }}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    输单周期
                  </div>
                  <div class="font-mono text-lg font-semibold text-error">
                    {{ formatDays(salesInsights?.sales_cycle?.summary?.lost_avg_days) }}
                  </div>
                </div>
              </div>

              <div v-if="salesInsights?.sales_cycle?.by_source?.length" class="space-y-3 pt-3 border-t border-default">
                <div v-for="item in salesInsights.sales_cycle.by_source" :key="item.source_type" class="space-y-1.5">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium truncate">
                        {{ sourceLabel(item.source_type) }}
                      </div>
                      <div class="text-xs text-muted">
                        赢 {{ item.won_count || 0 }} / 关 {{ item.closed_count || 0 }}
                      </div>
                    </div>
                    <div class="text-right shrink-0">
                      <div class="font-mono text-xs">
                        {{ formatDays(item.avg_days) }}
                      </div>
                      <div class="text-[10px] text-muted">
                        {{ formatPercent(item.win_rate) }}
                      </div>
                    </div>
                  </div>
                  <div class="h-2 bg-elevated rounded overflow-hidden">
                    <div
                      class="h-full bg-success/35 rounded"
                      :style="{ width: Math.max(3, (item.avg_days || 0) / maxSalesCycleDays * 100) + '%' }"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="text-center py-4 text-muted text-sm">
                暂无已关闭商机
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold text-sm">赢单原因</span>
            </template>
            <div v-if="salesInsights?.won_reasons?.length" class="space-y-3">
              <div v-for="item in salesInsights.won_reasons" :key="item.reason_code" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ wonReasonLabel(item.reason_code) }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ item.opp_count || 0 }} 个商机
                    </div>
                  </div>
                  <span class="font-mono text-xs shrink-0">{{ formatMoney(item.total_amount) }}</span>
                </div>
                <div class="h-2 bg-elevated rounded overflow-hidden">
                  <div
                    class="h-full bg-success/35 rounded"
                    :style="{ width: Math.max(3, (item.opp_count || 0) / maxWonReasonCount * 100) + '%' }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无赢单记录
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold text-sm">输单原因</span>
            </template>
            <div v-if="salesInsights?.lost_reasons?.length" class="space-y-3">
              <div v-for="item in salesInsights.lost_reasons" :key="item.reason_code" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ lostReasonLabel(item.reason_code) }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ item.opp_count || 0 }} 个商机
                    </div>
                  </div>
                  <span class="font-mono text-xs shrink-0">{{ formatMoney(item.total_amount) }}</span>
                </div>
                <div class="h-2 bg-elevated rounded overflow-hidden">
                  <div
                    class="h-full bg-error/35 rounded"
                    :style="{ width: Math.max(3, (item.opp_count || 0) / maxLostReasonCount * 100) + '%' }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无输单记录
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold text-sm">预测准确率</span>
            </template>
            <div v-if="salesInsights?.forecast_accuracy?.length" class="space-y-3">
              <div v-for="item in salesInsights.forecast_accuracy" :key="item.forecast_category" class="space-y-1.5">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ forecastCategoryLabel(item.forecast_category) }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ item.won_count || 0 }} / {{ item.closed_count || 0 }} 个已关闭
                    </div>
                  </div>
                  <UBadge :color="(item.actual_win_rate || 0) >= 50 ? 'success' : (item.actual_win_rate || 0) >= 25 ? 'warning' : 'neutral'" variant="subtle" size="xs">
                    {{ formatPercent(item.actual_win_rate) }}
                  </UBadge>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-2 bg-elevated rounded overflow-hidden">
                    <div
                      class="h-full bg-info/40 rounded"
                      :style="{ width: Math.max(3, (item.closed_count || 0) / maxForecastClosedCount * 100) + '%' }"
                    />
                  </div>
                  <span class="font-mono text-xs text-muted shrink-0">{{ formatMoney(item.won_amount) }}</span>
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              暂无已关闭商机
            </div>
          </UCard>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- 逾期应收账龄 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">逾期应收账龄</span>
            </template>
            <div v-if="receivables?.overdue_breakdown?.length" class="space-y-3">
              <div v-for="item in receivables.overdue_breakdown" :key="item.aging" class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UBadge color="error" variant="subtle" size="xs">
                    {{ item.aging }}
                  </UBadge>
                  <span class="text-xs text-muted">{{ item.count }} 笔</span>
                </div>
                <span class="font-mono font-medium text-error">{{ formatFullMoney(item.amount) }}</span>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              无逾期应收
            </div>
          </UCard>

          <!-- 未来30天到期回款 -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold text-sm">未来30天到期回款</span>
                <NuxtLink to="/payments" class="text-xs text-primary hover:underline">查看全部</NuxtLink>
              </div>
            </template>
            <div v-if="receivables?.upcoming?.length" class="divide-y divide-default">
              <div
                v-for="item in receivables.upcoming"
                :key="item.id"
                class="flex items-center justify-between py-2 cursor-pointer hover:bg-elevated/50 -mx-4 px-4 transition-colors"
                @click="router.push(`/payments/${item.id}`)"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-sm truncate">
                    {{ item.plan_name }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ item.customer_name }} · {{ item.contract_name }}
                  </div>
                </div>
                <div class="text-right ml-3 shrink-0">
                  <div class="font-mono text-sm">
                    {{ formatFullMoney(item.unreceived_amount) }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ item.planned_payment_date }}
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-muted text-sm">
              未来30天无到期回款
            </div>
          </UCard>
        </div>

        <!-- 逾期回款列表 -->
        <UCard v-if="receivables?.overdue_list?.length">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm text-error">逾期回款 ({{ receivables.overdue_list.length }})</span>
              <NuxtLink to="/payments?status=overdue" class="text-xs text-primary hover:underline">查看全部</NuxtLink>
            </div>
          </template>
          <div class="divide-y divide-default">
            <div
              v-for="item in receivables.overdue_list"
              :key="item.id"
              class="flex items-center justify-between py-2 cursor-pointer hover:bg-elevated/50 -mx-4 px-4 transition-colors"
              @click="router.push(`/payments/${item.id}`)"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm truncate">
                  {{ item.plan_name }}
                </div>
                <div class="text-xs text-muted">
                  {{ item.customer_name }} · {{ item.contract_name }}
                </div>
              </div>
              <div class="text-right ml-3 shrink-0">
                <div class="font-mono text-sm text-error">
                  {{ formatFullMoney(item.unreceived_amount) }}
                </div>
                <div class="text-xs text-error">
                  逾期 {{ item.overdue_days || '?' }} 天
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
