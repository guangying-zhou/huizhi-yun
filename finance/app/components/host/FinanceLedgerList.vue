<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { useFinancePagedList } from '../../composables/useFinancePagedList'
import { ledgerTitles, ledgerResource, ledgerPath, ledgerApi, isSpend, ledgerStatusLabel, ledgerAmount, type FinanceLedgerKind, type FinanceLedgerRow, type FinanceLedgerPage } from '../../utils/hostFinanceLedger'

const props = defineProps<{ kind: FinanceLedgerKind, projectOnly?: boolean, embedded?: boolean, initialStatus?: string, initialSearch?: string }>()
const { hosted, moduleUrl, apiUrl } = useFinanceModule()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => {
  void loadPermissions()
})
const resource = computed(() => ledgerResource[props.kind])
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission(resource.value, 'view'))
const createAction = computed(() => props.kind === 'receipts' ? 'confirm' : props.kind === 'reconciliation' ? 'confirm' : 'edit')
const canCreate = computed(() => props.kind !== 'invoices' && loaded.value && !permissionError.value && hasPermission(resource.value, createAction.value))
const list = useFinancePagedList<FinanceLedgerRow>(query => $fetch<FinanceLedgerPage>(apiUrl(`/${ledgerApi(props.kind)}`), { query: { page: query.page, pageSize: query.pageSize, ...(props.projectOnly ? { projectOnly: 'true' } : {}), ...(query.search ? { search: query.search } : {}), ...(query.status ? { status: query.status } : {}) }, retry: 0 }), allowed, { status: props.initialStatus, search: props.initialSearch })
const { items, total, page, pageSize, pending, error, search, status, refresh, flush } = list
const states = isSpend(props.kind) ? props.kind === 'expenses' ? ['draft', 'confirmed', 'canceled'] : ['draft', 'pending_approval', 'approved', 'rejected', 'paid', 'canceled'] : props.kind === 'invoice-requests' ? ['draft', 'pending_approval', 'approved', 'rejected', 'issued', 'canceled'] : props.kind === 'invoices' ? ['issued', 'red_reversed', 'canceled'] : props.kind === 'receipts' ? ['draft', 'confirmed', 'partially_reconciled', 'reconciled', 'canceled'] : ['active', 'reversed']
const stateItems = [{ label: '全部状态', value: 'all' }, ...states.map(value => ({ label: ledgerStatusLabel(value, props.kind), value }))]
const columns: TableColumn<FinanceLedgerRow>[] = [
  { accessorKey: 'code', header: '单据编号', meta: { class: { td: 'w-44 font-mono text-xs' } } },
  { accessorKey: 'customer_name', header: isSpend(props.kind) ? '事由 / 项目' : '客户 / 合同' },
  { id: 'amount', header: '金额', meta: { class: { th: 'text-right', td: 'w-40 text-right tabular-nums' } } },
  { accessorKey: 'status', header: '状态', meta: { class: { td: 'w-28' } } },
  { id: 'actions', header: '操作', meta: { class: { td: 'w-20' } } }
]
defineExpose({ refresh })
</script>

<template>
  <UDashboardPanel :id="`finance-${kind}${embedded ? `-${initialStatus || 'all'}` : ''}`">
    <template #body>
      <div class="p-4 sm:p-6">
        <ContentPageHeader
          v-if="hosted && !embedded"
          :hosted="hosted"
          :title="projectOnly ? '项目支出台账' : ledgerTitles[kind]"
          :description="isSpend(kind) ? '审批通过不代表已付款，须由另一位获权人员明确确认实际支出。' : '发票、到账与核销分别记录，不将审批通过视为已开票。'"
        >
          <template #actions>
            <UButton
              v-if="canCreate"
              :to="moduleUrl(`${ledgerPath(kind)}/new`)"
              icon="i-lucide-plus"
            >
              {{ kind === 'reconciliation' ? '新建核销' : '新建' }}
            </UButton>
          </template>
        </ContentPageHeader>
        <p
          v-if="kind === 'receipts'"
          class="mb-4 text-sm text-muted"
        >
          登记并确认到账后，由另一位财务办理分配。
        </p>
        <div class="mb-4 flex flex-wrap gap-2">
          <UInput
            v-model="search"
            class="min-w-0 flex-1 sm:max-w-sm"
            placeholder="搜索编号或合同"
            aria-label="搜索单据"
            icon="i-lucide-search"
            @keyup.enter="flush"
          />
          <USelect
            v-model="status"
            :items="stateItems"
            aria-label="筛选状态"
            class="w-36"
          />
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="pending"
            @click="refresh"
          >
            刷新
          </UButton>
        </div>
        <UProgress
          v-if="!loaded"
          aria-label="加载财务权限"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
          description="请重试加载权限。"
        >
          <template #actions>
            <UButton @click="loadPermissions()">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
          description="您没有查看这些财务单据的权限。"
        />
        <CommonEmptyState
          v-else-if="error"
          title="加载失败"
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
            <template #code-cell="{ row }">
              <NuxtLink
                v-if="kind !== 'reconciliation'"
                :to="moduleUrl(`${ledgerPath(kind)}/${row.original.code}`)"
                class="text-primary"
              >{{ row.original.code }}</NuxtLink><span v-else>{{ row.original.code }}</span>
            </template>
            <template #customer_name-cell="{ row }">
              <div class="max-w-64 truncate">
                {{ row.original.title || row.original.description || row.original.project_code || row.original.customer_name || row.original.contract_code || '—' }}
              </div>
            </template>
            <template #amount-cell="{ row }">
              {{ ledgerAmount(row.original) }} {{ row.original.currency_code }}
            </template>
            <template #status-cell="{ row }">
              <UBadge
                :color="['canceled', 'reversed', 'red_reversed'].includes(row.original.status) ? 'neutral' : 'info'"
                variant="subtle"
              >
                {{ ledgerStatusLabel(row.original.status, kind) }}
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                v-if="kind !== 'reconciliation'"
                :to="moduleUrl(`${ledgerPath(kind)}/${row.original.code}`)"
                variant="link"
                size="xs"
              >
                详情
              </UButton><UButton
                v-else-if="hasPermission('reconciliation', 'confirm') && row.original.status === 'active'"
                :to="moduleUrl(`/reconciliation/${row.original.code}/void`)"
                variant="link"
                color="warning"
                size="xs"
              >
                撤销
              </UButton>
            </template>
            <template #empty>
              <CommonEmptyState
                title="暂无记录"
                description="调整筛选条件后重试。"
              />
            </template>
          </UTable>
          <div class="space-y-3 sm:hidden">
            <UProgress
              v-if="pending"
              aria-label="加载财务单据"
            />
            <CommonEmptyState
              v-else-if="!items.length"
              title="暂无记录"
            />
            <article
              v-for="row in items"
              :key="row.id"
              class="min-w-0 rounded-lg border border-default p-3"
            >
              <NuxtLink
                v-if="kind !== 'reconciliation'"
                :to="moduleUrl(`${ledgerPath(kind)}/${row.code}`)"
                class="break-all text-primary"
              >{{ row.code }}</NuxtLink><p
                v-else
                class="break-all"
              >
                {{ row.code }}
              </p>
              <p class="truncate text-muted">
                {{ row.title || row.description || row.project_code || row.customer_name || row.contract_code || '—' }}
              </p>
              <div class="mt-2 flex justify-between gap-2">
                <UBadge
                  color="info"
                  variant="subtle"
                >
                  {{ ledgerStatusLabel(row.status, kind) }}
                </UBadge><span class="text-right tabular-nums">{{ ledgerAmount(row) }} {{ row.currency_code }}</span>
              </div>
              <UButton
                v-if="kind === 'reconciliation' && hasPermission('reconciliation', 'confirm') && row.status === 'active'"
                :to="moduleUrl(`/reconciliation/${row.code}/void`)"
                color="warning"
                variant="link"
              >
                撤销
              </UButton>
            </article>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span>共 {{ total }} 条</span><UPagination
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
