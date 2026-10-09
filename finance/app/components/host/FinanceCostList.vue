<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { useFinanceCostAccess } from '../../composables/useFinanceCostAccess'
import { useFinanceCostList } from '../../composables/useFinanceCostList'
import { costTitles, costMoney, costReasons, validCostMonth, type CostKind, type CostRow } from '../../utils/hostFinanceCost'

const props = defineProps<{ kind: CostKind }>()
const route = useRoute()
const { hosted, moduleUrl } = useFinanceModule()
const month = ref(validCostMonth(route.query.periodMonth) ? route.query.periodMonth : new Date().toISOString().slice(0, 7))
const project = ref(typeof route.query.projectCode === 'string' ? route.query.projectCode : '')
const { allowed, permissionLoaded, permissionError, retryPermissions } = useFinanceCostAccess(props.kind === 'employee-costs')
const { items, total, page, pageSize, pending, error, search, flush, refresh } = useFinanceCostList(props.kind, allowed, month, project)
const sensitive = props.kind === 'employee-costs'
const amountField = props.kind === 'project-accounting' ? 'labor_cost_amount' : sensitive ? 'standard_cost_amount' : 'amount'
const columns: TableColumn<CostRow>[] = [
  { id: 'identity', header: sensitive ? '员工 / 月份' : '项目 / 编号' },
  { id: 'amount', header: sensitive ? '月标准成本' : '成本总额', meta: { class: { th: 'text-right', td: 'w-36 text-right tabular-nums' } } },
  { id: 'state', header: '状态', meta: { class: { td: 'w-32' } } }
]
function target(row: CostRow) {
  const identity = props.kind === 'project-accounting' ? row.project_code : sensitive ? row.id : row.code
  return `${moduleUrl(`/${props.kind}/${encodeURIComponent(String(identity))}`)}?periodMonth=${month.value}&projectCode=${encodeURIComponent(String(row.project_code || project.value))}`
}
const identity = (row: CostRow) => String(row.employee_uid || row.project_name || row.project_code || row.code || '—')
const readiness = (row: CostRow) => row.cost_readiness_status === 'ready' ? '已就绪' : props.kind === 'project-accounting' ? '缺少输入' : row.status === 'reversed' ? '已撤销' : '有效'
</script>

<template>
  <UDashboardPanel id="finance-cost-list">
    <template #body>
      <div class="p-4 sm:p-6 min-w-0">
        <ContentPageHeader
          v-if="hosted"
          :hosted="hosted"
          :title="costTitles[kind]"
          :description="sensitive ? '仅展示当前双重权限范围内的员工月成本，不返回工资组成或职级依据。' : '按月查看完整成本与收支，缺少输入时不展示估算毛利。'"
        />
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <UInput
            v-model="month"
            type="month"
            aria-label="核算月份"
            :disabled="pending"
          />
          <UInput
            v-model="search"
            :placeholder="sensitive ? '搜索员工 UID' : '搜索项目编码或名称'"
            aria-label="搜索成本记录"
            icon="i-lucide-search"
            class="min-w-0 flex-1 sm:max-w-sm"
            @keyup.enter="flush"
          />
          <UButton
            color="neutral"
            variant="outline"
            :loading="pending"
            @click="refresh"
          >
            刷新
          </UButton>
        </div>
        <UProgress
          v-if="!permissionLoaded && !permissionError"
          aria-label="加载财务权限"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
          description="无法确认当前权限，请重试。"
        >
          <template #actions>
            <UButton @click="retryPermissions">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
          :description="sensitive ? '员工月成本需要 Finance 项目核算管理及 People 标准成本查看两项权限。' : '您没有查看项目核算的权限。'"
        />
        <CommonEmptyState
          v-else-if="error"
          :title="error.startsWith('无权限') ? '无权限' : '加载失败'"
          :description="error"
        >
          <template #actions>
            <UButton @click="refresh">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <template v-else>
          <UTable
            :data="items"
            :columns="columns"
            :loading="pending"
            class="hidden sm:block"
          >
            <template #identity-cell="{ row }">
              <NuxtLink
                :to="target(row.original)"
                class="block max-w-72 truncate text-primary"
              >{{ identity(row.original) }}</NuxtLink><p class="text-sm text-muted">
                {{ row.original.period_month }}
              </p>
            </template>
            <template #amount-cell="{ row }">
              {{ costMoney(row.original[amountField]) }} {{ row.original.currency_code }}
            </template>
            <template #state-cell="{ row }">
              <UBadge
                :color="readiness(row.original) === '缺少输入' ? 'warning' : 'neutral'"
                variant="subtle"
              >
                {{ readiness(row.original) }}
              </UBadge><p
                v-if="kind === 'project-accounting'"
                class="mt-1 text-xs text-muted"
              >
                {{ costReasons(row.original.cost_missing_inputs_json).join('、') }}
              </p>
            </template>
            <template #empty>
              <CommonEmptyState
                title="暂无记录"
                description="所选月份没有当前范围内的核算记录。"
              />
            </template>
          </UTable>
          <div class="space-y-2 sm:hidden">
            <UProgress
              v-if="pending"
              aria-label="加载成本记录"
            />
            <NuxtLink
              v-for="(row, index) in items"
              :key="String(row.code || row.project_code || row.id || index)"
              :to="target(row)"
              class="block rounded-lg border border-default p-3"
            >
              <p class="truncate text-primary">{{ identity(row) }}</p><p class="text-sm text-muted">{{ row.period_month }} · {{ readiness(row) }}</p><p class="mt-1 tabular-nums">{{ costMoney(row[amountField]) }} {{ row.currency_code }}</p>
            </NuxtLink>
            <CommonEmptyState
              v-if="!pending && !items.length"
              title="暂无记录"
              description="所选月份没有当前范围内的核算记录。"
            />
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="pageSize"
              :sibling-count="0"
              :show-edges="false"
            />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
