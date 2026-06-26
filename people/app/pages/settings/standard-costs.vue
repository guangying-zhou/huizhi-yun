<script setup lang="ts">
import type { ApiResponse, ListResponse, StandardCostRate } from '~/types'

type FinanceCostParameters = {
  code?: string
  name?: string
  base_salary?: number | string
  baseSalary?: number | string
  welfare_cost_rate?: number | string
  welfareCostRate?: number | string
  management_allocation_rate?: number | string
  managementAllocationRate?: number | string
  resource_allocation_cost?: number | string
  resourceAllocationCost?: number | string
  currency_code?: string
  currencyCode?: string
}

type RankSeriesSettings = {
  managementCount?: number | string
  professionalCount?: number | string
  source?: 'console' | 'fallback'
}

type RankSeries = 'M' | 'P'

type RankSettingRow = {
  rate_code: string
  rate_name: string
  rank_series: RankSeries
  rank_code: string
  rank_name: string
  rank_level: number
  rank_salary: number | string
  performance_salary_min: number | string
  performance_salary_max: number | string
  effective_from: string
  effective_to?: string | null
  monthly_standard_cost: number | string
  enabled: number | boolean
  remarks?: string | null
  configured: boolean
  base_salary_display: string
  rank_salary_display: string
  performance_range_display: string
  performance_mid_display: string
  welfare_display: string
  management_display: string
  resource_display: string
  monthly_display: string
  effective_display: string
  enabled_label: string
}

const { money, date } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()

const keyword = ref('')
const activeSeries = ref<RankSeries>('M')
const editOpen = ref(false)
const saving = ref(false)

const form = reactive({
  rateCode: '',
  rateName: '',
  rankSeries: 'M' as RankSeries,
  rankCode: '',
  rankName: '',
  rankLevel: '1',
  rankSalary: '0',
  performanceSalaryMin: '0',
  performanceSalaryMax: '0',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  remarks: ''
})

const query = computed(() => ({
  page: 1,
  page_size: 200,
  keyword: undefined
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<StandardCostRate>>>('/api/v1/standard-costs', {
  query,
  watch: [query]
})

const { data: parameterResponse, error: parameterError, refresh: refreshParameters } = await useFetch<ApiResponse<FinanceCostParameters>>(peopleApiPath('/api/admin/cost-parameters/current'))
const { data: rankSettingResponse, error: rankSettingError, refresh: refreshRankSettings } = await useFetch<ApiResponse<RankSeriesSettings>>(peopleApiPath('/api/admin/rank-settings/current'))

const parameters = computed<FinanceCostParameters>(() => parameterResponse.value?.data || {})
const parameterSummary = computed(() => ({
  code: textValue(parameters.value.code || parameters.value.name) || '未配置',
  baseSalary: numberValue(parameters.value.base_salary ?? parameters.value.baseSalary),
  welfareCostRate: numberValue(parameters.value.welfare_cost_rate ?? parameters.value.welfareCostRate),
  managementAllocationRate: numberValue(parameters.value.management_allocation_rate ?? parameters.value.managementAllocationRate),
  resourceAllocationCost: numberValue(parameters.value.resource_allocation_cost ?? parameters.value.resourceAllocationCost),
  currency: textValue(parameters.value.currency_code || parameters.value.currencyCode) || 'CNY'
}))

const rankSettings = computed(() => rankSettingResponse.value?.data || {
  managementCount: 5,
  professionalCount: 10,
  source: 'fallback'
})
const rankCounts = computed(() => ({
  M: clampCount(rankSettings.value.managementCount, 5, 20),
  P: clampCount(rankSettings.value.professionalCount, 10, 30)
}))
const seriesTabs = computed(() => [
  { label: `管理 M (${rankCounts.value.M})`, value: 'M' },
  { label: `专业 P (${rankCounts.value.P})`, value: 'P' }
])

const latestRatesByRankCode = computed(() => {
  const map = new Map<string, StandardCostRate>()
  for (const item of response.value?.data.items || []) {
    const rankCode = textValue(item.rank_code).toUpperCase()
    if (!rankCode) continue

    const existing = map.get(rankCode)
    if (!existing || dateValue(item.effective_from) > dateValue(existing.effective_from)) {
      map.set(rankCode, item)
    }
  }
  return map
})

const rowsBySeries = computed<Record<RankSeries, RankSettingRow[]>>(() => ({
  M: buildSeriesRows('M', rankCounts.value.M),
  P: buildSeriesRows('P', rankCounts.value.P)
}))
const rows = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  const sourceRows = rowsBySeries.value[activeSeries.value]
  if (!search) return sourceRows
  return sourceRows.filter(row => [
    row.rate_code,
    row.rate_name,
    row.rank_code,
    row.rank_name
  ].some(value => textValue(value).toLowerCase().includes(search)))
})

const previewComponents = computed(() => calculateComponents({
  rank_salary: form.rankSalary,
  performance_salary_min: form.performanceSalaryMin,
  performance_salary_max: form.performanceSalaryMax
} as Pick<StandardCostRate, 'rank_salary' | 'performance_salary_min' | 'performance_salary_max'>))

const columns = [
  { accessorKey: 'rank_code', header: '职级' },
  { accessorKey: 'rank_name', header: '名称' },
  { accessorKey: 'base_salary_display', header: '基本工资' },
  { accessorKey: 'rank_salary_display', header: '职级工资' },
  { accessorKey: 'performance_range_display', header: '绩效工资范围' },
  { accessorKey: 'welfare_display', header: '福利成本' },
  { accessorKey: 'management_display', header: '管理分摊' },
  { accessorKey: 'resource_display', header: '资源分摊' },
  { accessorKey: 'monthly_display', header: '月标准成本' },
  { accessorKey: 'effective_display', header: '有效期' },
  { accessorKey: 'enabled_label', header: '状态' },
  { id: 'actions', header: '操作' }
]

function textValue(value: unknown) {
  return String(value || '').trim()
}

function dateValue(value: unknown) {
  return textValue(value).slice(0, 10)
}

function numberValue(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount : 0
}

function clampCount(value: unknown, fallback: number, max: number) {
  const parsed = Number(value || fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

function seriesLabel(series: RankSeries) {
  return series === 'M' ? '管理' : '专业'
}

function rankCodeFor(series: RankSeries, level: number) {
  return `${series}${level}`
}

function rankNameFor(series: RankSeries, level: number) {
  return `${seriesLabel(series)} ${rankCodeFor(series, level)}`
}

function rateCodeFor(series: RankSeries, level: number) {
  return `SCR-${rankCodeFor(series, level)}-2026`
}

function sortOrderFor(series: RankSeries, level: number) {
  return series === 'M' ? level * 10 : 100 + level * 10
}

function calculateComponents(item: Pick<StandardCostRate, 'rank_salary' | 'performance_salary_min' | 'performance_salary_max'>) {
  const baseSalary = parameterSummary.value.baseSalary
  const rankSalary = numberValue(item.rank_salary)
  const performanceMin = numberValue(item.performance_salary_min)
  const performanceMax = numberValue(item.performance_salary_max)
  const performanceMidpoint = performanceMin || performanceMax ? (performanceMin + performanceMax) / 2 : 0
  const welfareCost = (baseSalary + rankSalary + performanceMidpoint) * parameterSummary.value.welfareCostRate
  const managementAllocation = (baseSalary + rankSalary + performanceMidpoint + welfareCost) * parameterSummary.value.managementAllocationRate
  const resourceAllocation = parameterSummary.value.resourceAllocationCost
  const monthlyStandardCost = baseSalary + rankSalary + performanceMidpoint + welfareCost + managementAllocation + resourceAllocation
  return {
    baseSalary,
    rankSalary,
    performanceMidpoint,
    welfareCost,
    managementAllocation,
    resourceAllocation,
    monthlyStandardCost
  }
}

function buildSeriesRows(series: RankSeries, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const level = index + 1
    const rankCode = rankCodeFor(series, level)
    const item = latestRatesByRankCode.value.get(rankCode)
    const base = {
      rate_code: textValue(item?.rate_code),
      rate_name: textValue(item?.rate_name) || `${rankCode} 职级设置`,
      rank_series: series,
      rank_code: rankCode,
      rank_name: textValue(item?.rank_name) || rankNameFor(series, level),
      rank_level: level,
      rank_salary: item?.rank_salary ?? 0,
      performance_salary_min: item?.performance_salary_min ?? 0,
      performance_salary_max: item?.performance_salary_max ?? 0,
      effective_from: dateValue(item?.effective_from) || new Date().toISOString().slice(0, 10),
      effective_to: item?.effective_to || null,
      monthly_standard_cost: item?.monthly_standard_cost ?? 0,
      enabled: item?.enabled ?? true,
      remarks: item?.remarks || null,
      configured: Boolean(item)
    }
    const components = calculateComponents(base)
    return {
      ...base,
      base_salary_display: money(components.baseSalary),
      rank_salary_display: money(base.rank_salary),
      performance_range_display: `${money(base.performance_salary_min)} ~ ${money(base.performance_salary_max)}`,
      performance_mid_display: money(components.performanceMidpoint),
      welfare_display: money(components.welfareCost),
      management_display: money(components.managementAllocation),
      resource_display: money(components.resourceAllocation),
      monthly_display: money(components.monthlyStandardCost),
      effective_display: `${date(base.effective_from)} ~ ${date(base.effective_to)}`,
      enabled_label: base.configured ? (base.enabled ? '启用' : '停用') : '未配置'
    }
  })
}

function errorMessage(error: unknown) {
  const payload = error as { data?: { message?: string }, message?: string }
  return payload.data?.message || payload.message || '请稍后重试'
}

function editRow(row: RankSettingRow) {
  form.rateCode = textValue(row.rate_code)
  form.rateName = textValue(row.rate_name)
  form.rankSeries = row.rank_series
  form.rankCode = textValue(row.rank_code)
  form.rankName = textValue(row.rank_name)
  form.rankLevel = textValue(row.rank_level) || '1'
  form.rankSalary = textValue(row.rank_salary)
  form.performanceSalaryMin = textValue(row.performance_salary_min)
  form.performanceSalaryMax = textValue(row.performance_salary_max)
  form.effectiveFrom = dateValue(row.effective_from) || new Date().toISOString().slice(0, 10)
  form.remarks = textValue(row.remarks)
  editOpen.value = true
}

async function handleSave() {
  if (saving.value) return

  const authorization = await ensurePeoplePermission('standard_costs', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要职级成本设置权限后才能维护。',
      color: 'warning'
    })
    return
  }

  const rankLevel = numberValue(form.rankLevel)
  const rateCode = form.rateCode || rateCodeFor(form.rankSeries, rankLevel)
  const body = {
    rateCode,
    rateName: form.rateName.trim() || `${form.rankCode} 职级设置`,
    rankSeries: form.rankSeries,
    rankCode: form.rankCode,
    rankName: form.rankName.trim() || rankNameFor(form.rankSeries, rankLevel),
    rankLevel,
    rankSalary: numberValue(form.rankSalary),
    performanceSalaryMin: numberValue(form.performanceSalaryMin),
    performanceSalaryMax: numberValue(form.performanceSalaryMax),
    effectiveFrom: form.effectiveFrom,
    currency: parameterSummary.value.currency,
    monthlyStandardCost: previewComponents.value.monthlyStandardCost,
    sourceApp: 'people',
    sourceBizType: 'rank_standard',
    sourceBizId: form.rankCode,
    sortOrder: sortOrderFor(form.rankSeries, rankLevel),
    remarks: form.remarks || undefined,
    currentUser: authorization.snapshot?.uid || undefined
  }

  saving.value = true
  try {
    await $fetch(form.rateCode ? `/api/v1/standard-costs/${encodeURIComponent(form.rateCode)}` : '/api/v1/standard-costs', {
      method: form.rateCode ? 'PATCH' : 'POST',
      body
    })
    toast.add({ title: '已保存职级设置', color: 'success' })
    editOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({
      title: '保存职级设置失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function refreshAll() {
  await Promise.all([refresh(), refreshParameters(), refreshRankSettings()])
}
</script>

<template>
  <UDashboardPanel
    id="people-settings-standard-costs"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          职级设置
        </h1>
      </Teleport>
      <Teleport to="#people-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="refreshAll"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="职级设置暂不可用"
          description="请先执行 People 标准成本增量 SQL，并确认 data-runtime 已更新。"
        />
        <UAlert
          v-if="parameterError"
          color="warning"
          variant="soft"
          icon="i-lucide-plug-zap"
          title="Finance 参数暂不可用"
          description="请先在 Finance 执行人力成本参数 SQL 并确认 Finance data-runtime 已更新。"
        />
        <UAlert
          v-if="rankSettingError"
          color="warning"
          variant="soft"
          icon="i-lucide-settings"
          title="Console 职级参数暂不可用"
          description="页面将按默认 M5 / P10 展示；请执行 Console 参数 SQL 并确认 People service client 已授权 system_settings:view。"
        />

        <UCard>
          <div class="grid gap-3 md:grid-cols-5">
            <div>
              <p class="text-xs text-muted">
                Console 参数
              </p>
              <p class="mt-1 font-medium">
                M{{ rankCounts.M }} / P{{ rankCounts.P }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Finance 参数
              </p>
              <p class="mt-1 font-medium">
                {{ parameterSummary.code }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                基本工资
              </p>
              <p class="mt-1 font-medium">
                {{ money(parameterSummary.baseSalary) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                福利 / 管理
              </p>
              <p class="mt-1 font-medium">
                {{ (parameterSummary.welfareCostRate * 100).toFixed(2) }}% / {{ (parameterSummary.managementAllocationRate * 100).toFixed(2) }}%
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                资源分摊
              </p>
              <p class="mt-1 font-medium">
                {{ money(parameterSummary.resourceAllocationCost) }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UTabs
              v-model="activeSeries"
              :items="seriesTabs"
              :content="false"
              variant="pill"
              class="w-full md:max-w-sm"
            />
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <UInput
                v-model="keyword"
                icon="i-lucide-search"
                placeholder="搜索职级 / 名称"
                class="w-full sm:w-64"
              />
              <UBadge
                color="neutral"
                variant="soft"
                class="justify-center"
              >
                {{ rows.length }} 个职级
              </UBadge>
            </div>
          </div>

          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
            >
              <template #enabled_label-cell="{ row }">
                <UBadge
                  :color="row.original.configured ? (row.original.enabled ? 'success' : 'neutral') : 'warning'"
                  variant="soft"
                >
                  {{ row.original.enabled_label }}
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="editRow(row.original)"
                >
                  编辑
                </UButton>
              </template>
            </UTable>
          </div>
        </UCard>

        <UModal
          v-model:open="editOpen"
          title="编辑职级设置"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="handleSave"
            >
              <div class="grid gap-3 md:grid-cols-2">
                <UFormField label="职级序列">
                  <UInput
                    :model-value="form.rankSeries === 'M' ? '管理 M' : '专业 P'"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="职级编码">
                  <UInput
                    v-model="form.rankCode"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="职级名称"
                  required
                >
                  <UInput
                    v-model="form.rankName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="规则编码">
                  <UInput
                    :model-value="form.rateCode || rateCodeFor(form.rankSeries, numberValue(form.rankLevel))"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="职级工资">
                  <UInput
                    v-model="form.rankSalary"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="绩效工资下限">
                  <UInput
                    v-model="form.performanceSalaryMin"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="绩效工资上限">
                  <UInput
                    v-model="form.performanceSalaryMax"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="生效日期">
                  <UInput
                    v-model="form.effectiveFrom"
                    type="date"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="月标准成本">
                  <UInput
                    :model-value="money(previewComponents.monthlyStandardCost)"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="备注"
                  class="md:col-span-2"
                >
                  <UTextarea
                    v-model="form.remarks"
                    :rows="3"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="editOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  type="submit"
                  color="primary"
                  icon="i-lucide-save"
                  :loading="saving"
                >
                  保存
                </UButton>
              </div>
            </form>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
