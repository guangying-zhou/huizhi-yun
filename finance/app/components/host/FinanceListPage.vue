<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { formatMoney } from '../../../../foundation/app/utils/format'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { createFinanceIntent, financeWriteMessage } from '../../utils/hostFinanceForms'
import { useFinancePagedList } from '../../composables/useFinancePagedList'
import type { BankAccount, BalanceSnapshot, PeopleCostParameter } from '../../types/hostFinance'
import FinanceColumnView from './FinanceColumnView.vue'
import FinanceBusinessObjectSelect from './FinanceBusinessObjectSelect.vue'
import { financeDateRange, financeListRouteQuery } from '../../utils/financeWorkbench'
import BankAccountEditor from './BankAccountEditor.vue'
import BalanceRegister from './BalanceRegister.vue'
import { w3AccountTypeLabel, w3BalanceFlags } from '../../utils/w3AccountPresentation'

const props = defineProps<{ kind: 'accounts' | 'snapshots' | 'parameters' }>()
const { hosted, moduleUrl, apiUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const { hasPermission, loaded, error: permissionError, loadPermissions } = usePermissions()
// Host composition does not run the standalone Finance permission middleware.
// Load explicitly: a loaded-first permission guard cannot trigger lazy loading.
onMounted(() => {
  void loadPermissions()
})
const resource = props.kind === 'parameters' ? 'settings' : 'bank_accounts'
const canView = computed(() => loaded.value && !permissionError.value && hasPermission(resource, props.kind === 'parameters' ? 'admin' : 'view'))
const register = ref<InstanceType<typeof BalanceRegister> | null>(null)
const canRegister = computed(() => canView.value && hasPermission('bank_accounts', 'edit'))
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission(resource, 'admin'))
const read = (query: Parameters<typeof api.accounts>[0]) => props.kind === 'accounts' ? api.accounts(query) : props.kind === 'snapshots' ? api.snapshots(query) : api.parameters(query)
const route = useRoute()
const router = useRouter()
const initial = props.kind === 'parameters' ? {} : financeListRouteQuery(route.query, props.kind)
const list = useFinancePagedList<BankAccount | BalanceSnapshot | PeopleCostParameter>(read, canView, { ...(props.kind === 'snapshots' ? financeDateRange(30) : {}), ...initial, page: Number(initial.page || 1) })
if (props.kind !== 'parameters') {
  watch(list.query, (value) => {
    const next = financeListRouteQuery({ ...value, page: String(value.page) }, props.kind as 'accounts' | 'snapshots')
    if (JSON.stringify(next) !== JSON.stringify(financeListRouteQuery(route.query, props.kind as 'accounts' | 'snapshots'))) void router.replace({ query: next })
  })
}
const { legalEntityCode, accountType, completeRequested, complete, page, pageSize, status, search, accountCode, startDate, endDate, items, total, balanceTotals, pending, error, flush, refresh } = list
const accountTypeItems = [{ label: '全部类型', value: 'all' }, { label: '银行', value: 'bank' }, { label: '现金', value: 'cash' }, { label: '第三方', value: 'third_party' }, { label: '内部', value: 'internal' }]
const title = { accounts: '银行账户', snapshots: '余额快照', parameters: '人力成本参数' }[props.kind]
const description = { accounts: '', snapshots: '', parameters: '按有效期和版本维护人力成本核算参数，同一时点只允许一条有效参数。' }[props.kind]
const emptyDescription = computed(() => props.kind === 'snapshots' || !canEdit.value ? '调整筛选条件后重试。' : '调整筛选条件，或使用页头入口新建。')
const statusItems = [{ label: '全部状态', value: 'all' }, { label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }, ...(props.kind === 'accounts' ? [{ label: '已关闭', value: 'closed' }] : [])]
interface DisplayRow { entity?: string, type?: string, balanceDate?: string, entryCount?: number | null, note?: string | null, fullName?: string, subtype?: string | null, owner?: string | null, branch?: string | null, sort?: number, id: number, code: string, name: string, detail: string, amount: string | null, currency: string, status: string, version: number | null, original: BankAccount | BalanceSnapshot | PeopleCostParameter }
const rows = computed<DisplayRow[]>(() => items.value.map((item) => {
  if (props.kind === 'accounts') {
    const row = item as BankAccount
    return { entity: row.legal_entity_name || row.legal_entity_code || '—', type: w3AccountTypeLabel(row), balanceDate: row.latest_balance_date?.slice(0, 10) || '—', fullName: row.account_name, subtype: row.account_subtype, owner: row.owner_dept_code, branch: row.bank_branch_code, sort: row.sort_no, id: row.id, code: row.code, name: row.short_name || row.account_name, detail: [row.bank_name, row.account_no_masked].filter(Boolean).join(' · '), amount: row.latest_balance_amount ?? null, currency: row.currency_code, status: row.status, version: row.row_version, original: row }
  }
  if (props.kind === 'snapshots') {
    const row = item as BalanceSnapshot
    return { entryCount: row.entry_count, note: row.note, id: row.id, code: row.account_code, name: row.account_name, detail: row.snapshot_date.slice(0, 10), amount: row.balance_amount, currency: row.currency_code, status: ({ manual: '手工录入', import: '导入', api: 'API' })[row.source_type], version: null, original: row }
  }
  const row = item as PeopleCostParameter
  return { id: row.id, code: row.code, name: row.name, detail: `${row.effective_from.slice(0, 10)} ~ ${row.effective_to?.slice(0, 10) || '长期'}`, amount: row.base_salary, currency: row.currency_code, status: row.status, version: row.row_version, original: row }
}))
const optionalColumns = computed(() => props.kind === 'accounts' ? [{ value: 'fullName', label: '开户名称' }, { value: 'subtype', label: '账户子类型' }, { value: 'owner', label: '归属部门' }, { value: 'branch', label: '行号' }, { value: 'sort', label: '排序号' }] : props.kind === 'snapshots' ? [{ value: 'note', label: '备注' }] : [])
const displayed = ref<string[]>([])
function accountLink(code: string) {
  const query = financeListRouteQuery({ ...list.query.value, page: String(page.value) }, 'accounts')
  return { path: moduleUrl(`/bank-accounts/${encodeURIComponent(code)}`), query: Object.fromEntries(Object.entries(query).map(([key, value]) => [`list_${key}`, value])) }
}
function restoreView(filters: Record<string, string>) {
  // Explicit URL filters take precedence over a local saved view.
  if (Object.keys(initial).length) return
  if (props.kind === 'accounts') {
    status.value = filters.status || 'all'
    accountType.value = filters.accountType || 'all'
  } else if (props.kind === 'snapshots') {
    if (filters.startDate) startDate.value = filters.startDate
    if (filters.endDate) endDate.value = filters.endDate
  }
}
function resetFilters() {
  search.value = ''
  flush()
  status.value = 'all'
  legalEntityCode.value = ''
  accountType.value = 'all'
  accountCode.value = ''
  completeRequested.value = false
  if (props.kind === 'snapshots') {
    const range = financeDateRange(30)
    startDate.value = range.startDate
    endDate.value = range.endDate
  }
}
const columns = computed<TableColumn<DisplayRow>[]>(() => [
  { accessorKey: 'code', header: '编码', meta: { class: { td: 'w-32 font-mono text-xs' } } },
  { accessorKey: 'name', header: props.kind === 'parameters' ? '参数名称' : '账户名称' },
  ...(props.kind === 'accounts' ? [{ accessorKey: 'entity', header: '法人主体' }, { accessorKey: 'type', header: '类型' }] : []),
  { accessorKey: 'detail', header: props.kind === 'accounts' ? '开户行 / 脱敏账号' : props.kind === 'snapshots' ? '快照日期' : '有效期' },
  { accessorKey: 'amount', header: props.kind === 'accounts' ? '最新快照余额（币种）' : props.kind === 'snapshots' ? '余额（币种）' : '基本工资（币种）', meta: { class: { th: 'text-right', td: 'w-44 text-right tabular-nums' } } },
  ...(props.kind !== 'parameters' ? [{ accessorKey: 'currency', header: '币种' }] : []),
  ...(props.kind === 'accounts' ? [{ accessorKey: 'balanceDate', header: '余额日期' }] : props.kind === 'snapshots' ? [{ accessorKey: 'entryCount', header: '当日登记数' }] : []),
  ...optionalColumns.value.filter(column => displayed.value.includes(column.value)).map(column => ({ accessorKey: column.value, header: column.label })),
  { accessorKey: 'status', header: props.kind === 'snapshots' ? '来源' : '状态' },
  ...(props.kind === 'parameters' ? [{ accessorKey: 'version' as const, header: '版本' }] : []),
  { id: 'actions', header: '操作' }
])
const statusLabel = (value: string) => ({ active: '启用', inactive: '停用', closed: '已关闭' })[value as 'active'] || value
const editorOpen = ref(false)
const editing = ref<BankAccount | null>(null)
watch(() => sessionScope?.value, () => {
  editorOpen.value = false
  editing.value = null
})
const toast = useToast()
const { confirm } = useConfirm()
const intent = createFinanceIntent()
const writePending = ref(false)
function edit(row: BankAccount | null) {
  editing.value = row
  editorOpen.value = true
}
async function deactivate(row: BankAccount) {
  if (!canEdit.value || writePending.value || !(await confirm({ tone: 'warning', title: '停用银行账户', message: `停用「${row.account_name}」后将不可用于新的资金业务，历史余额快照保留。` }))) return
  const body = { status: 'inactive' as const, expectedVersion: row.row_version }
  writePending.value = true
  try {
    await api.updateAccount(row.code, body, intent.key({ code: row.code, ...body }))
    intent.reset()
    toast.add({ title: '账户已停用', color: 'success' })
    await refresh()
  } catch (failure) {
    toast.add({ title: financeWriteMessage(failure), color: 'error' })
  } finally {
    writePending.value = false
  }
}
const historyCode = ref('')
const historyOpen = ref(false)
watch(() => sessionScope?.value, () => {
  historyOpen.value = false
  historyCode.value = ''
})
const historyAllowed = computed(() => historyOpen.value && canView.value && !!historyCode.value)
const history = useFinancePagedList<PeopleCostParameter>(query => api.parameterHistory(historyCode.value, query), historyAllowed)
function openHistory(row: PeopleCostParameter) {
  historyCode.value = row.code
  history.page.value = 1
  historyOpen.value = true
}
const historyColumns: TableColumn<PeopleCostParameter>[] = [{ accessorKey: 'row_version', header: '版本' }, { accessorKey: 'effective_from', header: '生效日期' }, { accessorKey: 'effective_to', header: '失效日期' }, { accessorKey: 'base_salary', header: '基本工资' }]
</script>

<template>
  <UDashboardPanel :ui="{ body: 'p-0' }">
    <template #body>
      <div class="min-w-0 space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          :title="title"
          :description="description"
          :breadcrumb="kind === 'parameters' ? '设置 / 业务配置' : '经营 / 账户与资金'"
        >
          <template #actions>
            <UButton
              v-if="kind === 'snapshots' && canRegister"
              icon="i-lucide-plus"
              @click="register?.register()"
            >
              登记余额
            </UButton>
            <UButton
              v-if="canEdit && kind === 'accounts'"
              icon="i-lucide-plus"
              @click="edit(null)"
            >
              新建账户
            </UButton>
            <UButton
              v-if="canEdit && kind === 'parameters'"
              :to="moduleUrl('/settings/people-cost-parameters/new')"
              icon="i-lucide-plus"
            >
              新建参数版本
            </UButton>
          </template>
        </ContentPageHeader>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField
            label="搜索"
            class="w-full sm:w-64"
          >
            <UInput
              v-model="search"
              aria-label="搜索名称或编码"
              placeholder="搜索名称或编码"
              icon="i-lucide-search"
              class="w-full"
              @keyup.enter="flush"
            />
          </UFormField>
          <UFormField
            v-if="kind !== 'parameters' && hasPermission('legal_entities', 'view')"
            label="法人主体"
            class="w-full sm:w-52"
          >
            <FinanceBusinessObjectSelect
              v-model="legalEntityCode"
              kind="legal-entities"
              :enabled="canView && hasPermission('legal_entities', 'view')"
            />
          </UFormField>
          <UFormField
            v-if="kind === 'accounts'"
            label="账户类型"
            class="w-full sm:w-36"
          >
            <USelect
              v-model="accountType"
              :items="accountTypeItems"
              aria-label="账户类型"
              class="w-full"
            />
          </UFormField>
          <UCheckbox
            v-if="kind === 'accounts'"
            v-model="completeRequested"
            label="完整结果（最多200条）"
          />
          <UFormField
            v-if="kind !== 'snapshots'"
            label="状态"
            class="w-full sm:w-36"
          >
            <USelect
              v-model="status"
              :items="statusItems"
              aria-label="筛选状态"
              class="w-full"
            />
          </UFormField>
          <template v-else>
            <UFormField
              label="银行账户"
              class="w-full sm:w-64"
            >
              <FinanceBusinessObjectSelect
                v-model="accountCode"
                kind="bank-accounts"
                account-value="code"
                :enabled="canView"
              />
            </UFormField>
            <UFormField
              label="起始日期"
              class="w-full sm:w-40"
            >
              <UInput
                v-model="startDate"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="结束日期"
              class="w-full sm:w-40"
            >
              <UInput
                v-model="endDate"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UButton
              color="neutral"
              variant="outline"
              @click="startDate = financeDateRange(30).startDate; endDate = financeDateRange(30).endDate"
            >
              近30天
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              @click="startDate = financeDateRange(1).endDate.slice(0, 4) + '-01-01'; endDate = financeDateRange(1).endDate"
            >
              本年
            </UButton>
          </template>
          <UButton
            v-if="kind !== 'parameters'"
            color="neutral"
            variant="ghost"
            @click="resetFilters"
          >
            重置筛选
          </UButton>
          <FinanceColumnView
            v-if="kind !== 'parameters'"
            v-model="displayed"
            :options="optionalColumns"
            :view-key="kind"
            :filters="kind === 'accounts' ? { status, accountType } : { startDate, endDate }"
            @restore="restoreView"
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
        <p
          v-if="kind === 'accounts' && completeRequested && !pending && !error && canView"
          class="text-sm text-muted"
        >
          {{ complete ? '已显示整个筛选结果' : '筛选结果超过200条，按分页显示；合计仍覆盖整个筛选结果' }}
        </p>
        <CommonEmptyState
          v-if="permissionError"
          icon="i-lucide-circle-alert"
          title="权限加载失败"
          description="无法加载财务权限，请稍后重试。"
        >
          <UButton
            color="neutral"
            variant="outline"
            @click="loadPermissions({ force: true })"
          >
            重试
          </UButton>
        </CommonEmptyState>
        <div
          v-else-if="!loaded"
          role="status"
          class="space-y-2"
        >
          <UProgress aria-label="加载财务权限" />
          <p class="text-sm text-muted">
            正在加载财务权限…
          </p>
        </div>
        <CommonEmptyState
          v-else-if="!canView"
          icon="i-lucide-lock-keyhole"
          title="无权查看"
          description="您没有查看这些财务数据的权限。"
        />
        <CommonEmptyState
          v-else-if="error"
          icon="i-lucide-circle-alert"
          title="加载失败"
          :description="error"
        >
          <UButton
            color="neutral"
            variant="outline"
            @click="refresh"
          >
            重试
          </UButton>
        </CommonEmptyState>
        <template v-else>
          <p
            v-if="kind === 'snapshots'"
            class="text-sm text-muted"
          >
            已登记快照，非实时余额；同日人工登记优先于导入。
          </p>
          <p
            v-if="kind === 'accounts' && balanceTotals.length"
            class="text-sm text-muted"
          >
            各账户最新已登记快照合计，日期可能不同
          </p>
          <div
            v-if="kind === 'accounts' && balanceTotals.length"
            class="flex flex-wrap gap-3"
          >
            <p
              v-for="sum in balanceTotals"
              :key="`${sum.legal_entity_code}-${sum.currency_code}`"
              class="rounded-lg border border-default p-3 text-sm tabular-nums"
            >
              {{ sum.legal_entity_code || '未登记主体' }} · {{ sum.account_count }} 个有快照账户：{{ formatMoney(sum.amount, { currency: sum.currency_code }) }}
            </p>
          </div>
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending || !loaded"
            class="hidden w-full sm:block"
            :ui="{ td: 'max-w-56 truncate' }"
          >
            <template #name-cell="{ row }">
              <NuxtLink
                v-if="kind === 'accounts'"
                :to="accountLink(row.original.code)"
                class="block max-w-64 truncate text-primary"
              >{{ row.original.name }}</NuxtLink>
              <span
                v-else
                class="block max-w-64 truncate"
              >{{ row.original.name }}</span>
            </template>
            <template #detail-cell="{ row }">
              <span class="block max-w-64 truncate">{{ row.original.detail || '-' }}</span>
            </template>
            <template #amount-cell="{ row }">
              {{ kind === 'accounts' && row.original.amount === null ? '无余额记录' : formatMoney(row.original.amount, { currency: row.original.currency }) }}
            </template>
            <template #entryCount-cell="{ row }">
              <span class="block text-right tabular-nums">{{ row.original.entryCount ?? '未跟踪' }}</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                :color="row.original.status === 'active' ? 'success' : 'neutral'"
                variant="subtle"
              >
                {{ statusLabel(row.original.status) }}
              </UBadge>
              <template v-if="kind === 'snapshots'">
                <UBadge
                  v-for="flag in w3BalanceFlags(row.original.original as BalanceSnapshot)"
                  :key="flag"
                  color="warning"
                  variant="subtle"
                >
                  {{ flag }}
                </UBadge>
              </template>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex gap-1">
                <template v-if="kind === 'accounts'">
                  <UButton
                    v-if="canEdit"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="edit(row.original.original as BankAccount)"
                  >
                    编辑
                  </UButton>
                  <UButton
                    v-if="canEdit && row.original.status === 'active'"
                    color="warning"
                    variant="ghost"
                    size="sm"
                    :disabled="writePending"
                    @click="deactivate(row.original.original as BankAccount)"
                  >
                    停用
                  </UButton>
                </template>
                <template v-else-if="kind === 'snapshots'">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="register?.showEntries(row.original.original as BalanceSnapshot)"
                  >
                    当日流水
                  </UButton>
                </template>
                <template v-else>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="openHistory(row.original.original as PeopleCostParameter)"
                  >
                    历史
                  </UButton>
                  <UButton
                    v-if="canEdit"
                    :to="moduleUrl(`/settings/people-cost-parameters/${encodeURIComponent(row.original.code)}/edit`)"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                  >
                    编辑
                  </UButton>
                </template>
              </div>
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-landmark"
                title="暂无记录"
                :description="emptyDescription"
              />
            </template>
          </UTable>
          <div class="space-y-3 sm:hidden">
            <UProgress
              v-if="pending || !loaded"
              aria-label="加载财务数据"
            />
            <CommonEmptyState
              v-else-if="!rows.length"
              icon="i-lucide-landmark"
              title="暂无记录"
              :description="emptyDescription"
            />
            <article
              v-for="row in rows"
              :key="row.id"
              class="min-w-0 rounded-lg border border-default p-3"
            >
              <NuxtLink
                v-if="kind === 'accounts'"
                :to="accountLink(row.code)"
                class="block truncate font-medium text-primary"
              >{{ row.name }}</NuxtLink>
              <p
                v-else
                class="truncate font-medium"
              >
                {{ row.name }}
              </p>
              <p class="break-all text-xs text-muted">
                {{ row.code }} · {{ row.detail }}
              </p>
              <p
                v-if="row.amount !== null"
                class="mt-2 text-right tabular-nums"
              >
                {{ formatMoney(row.amount, { currency: row.currency }) }}
              </p>
              <p
                v-if="kind === 'accounts'"
                class="text-xs text-muted"
              >
                {{ row.amount === null ? '无余额记录' : (row.original as BankAccount).latest_balance_date?.slice(0, 10) || '尚无快照' }}
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ statusLabel(row.status) }}
                </UBadge>
                <template v-if="kind === 'snapshots'">
                  <span class="text-xs text-muted">{{ (row.original as BalanceSnapshot).entry_count == null ? '登记条数未跟踪' : `${(row.original as BalanceSnapshot).entry_count} 条登记` }}</span>
                  <UBadge
                    v-for="flag in w3BalanceFlags(row.original as BalanceSnapshot)"
                    :key="flag"
                    color="warning"
                    variant="subtle"
                  >
                    {{ flag }}
                  </UBadge>
                </template>
                <span class="text-xs text-muted">{{ row.currency }}<template v-if="row.version"> · v{{ row.version }}</template></span>
                <template v-if="kind === 'accounts' && canEdit">
                  <UButton
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    @click="edit(row.original as BankAccount)"
                  >
                    编辑
                  </UButton><UButton
                    v-if="row.status === 'active'"
                    size="sm"
                    color="warning"
                    variant="ghost"
                    :disabled="writePending"
                    @click="deactivate(row.original as BankAccount)"
                  >
                    停用
                  </UButton>
                </template>
                <UButton
                  v-if="kind === 'snapshots'"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  @click="register?.showEntries(row.original as BalanceSnapshot)"
                >
                  当日流水
                </UButton>
                <template v-if="kind === 'parameters'">
                  <UButton
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    @click="openHistory(row.original as PeopleCostParameter)"
                  >
                    历史
                  </UButton><UButton
                    v-if="canEdit"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    :to="moduleUrl(`/settings/people-cost-parameters/${encodeURIComponent(row.code)}/edit`)"
                  >
                    编辑
                  </UButton>
                </template>
              </div>
            </article>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
              v-if="!complete"
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
              :sibling-count="0"
              :show-edges="false"
              size="sm"
            />
          </div>
        </template>
        <BalanceRegister
          v-if="kind === 'snapshots'"
          ref="register"
          :can-view="canView"
          :can-register="canRegister"
          @saved="refresh"
        />
        <BankAccountEditor
          v-model:open="editorOpen"
          :account="editing"
          :can-edit="canEdit"
          @saved="refresh"
        />
        <USlideover
          v-model:open="historyOpen"
          title="参数版本历史"
          :description="historyCode"
          :ui="{ content: 'w-full sm:max-w-2xl' }"
        >
          <template #body>
            <UAlert
              v-if="history.error.value"
              color="error"
              :title="history.error.value"
            />
            <UTable
              v-else
              :data="history.items.value"
              :columns="historyColumns"
              :loading="history.pending.value"
              class="hidden sm:block"
            >
              <template #base_salary-cell="{ row }">
                {{ formatMoney(row.original.base_salary, { currency: row.original.currency_code }) }}
              </template>
              <template #empty>
                <CommonEmptyState
                  title="暂无历史版本"
                  description="该参数尚无历史版本。"
                />
              </template>
            </UTable>
            <div
              v-if="!history.error.value"
              class="space-y-3 sm:hidden"
            >
              <UProgress
                v-if="history.pending.value"
                aria-label="加载版本历史"
              />
              <CommonEmptyState
                v-else-if="!history.items.value.length"
                title="暂无历史版本"
              />
              <article
                v-for="version in history.items.value"
                :key="version.row_version"
                class="rounded-lg border border-default p-3"
              >
                <p class="font-medium">
                  版本 {{ version.row_version }}
                </p>
                <p class="break-all text-sm text-muted">
                  {{ version.effective_from.slice(0, 10) }} ~ {{ version.effective_to?.slice(0, 10) || '长期' }}
                </p>
                <p class="text-right tabular-nums">
                  {{ formatMoney(version.base_salary, { currency: version.currency_code }) }}
                </p>
              </article>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <span>共 {{ history.total.value }} 条</span><UPagination
                v-model:page="history.page.value"
                :items-per-page="history.pageSize"
                :total="history.total.value"
                :sibling-count="0"
                :show-edges="false"
              />
            </div>
          </template>
        </USlideover>
      </div>
    </template>
  </UDashboardPanel>
</template>
