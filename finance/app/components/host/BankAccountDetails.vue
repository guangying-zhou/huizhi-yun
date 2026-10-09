<script setup lang="ts">
import { financeDateRange, financeListRouteQuery } from '../../utils/financeWorkbench'
import SourceRecordInfo from '../../../../foundation/app/components/SourceRecordInfo.vue'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '../../../../foundation/app/utils/format'
import { useFinancePagedList } from '../../composables/useFinancePagedList'
import { w3BalanceFlags, w3AccountTypeLabel } from '../../utils/w3AccountPresentation'
import type { BankAccount, BalanceSnapshot } from '../../types/hostFinance'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import BankAccountEditor from './BankAccountEditor.vue'
import BalanceRegister from './BalanceRegister.vue'
import AccountNumberReveal from './AccountNumberReveal.vue'

const { hosted, moduleUrl, apiUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const route = useRoute()
const backQuery = computed(() => financeListRouteQuery(Object.fromEntries(Object.entries(route.query || {}).filter(([key]) => key.startsWith('list_')).map(([key, value]) => [key.slice(5), value])), 'accounts'))
const { hasPermission, loaded, error: permissionError, loadPermissions } = usePermissions()
// Host composition does not run the standalone Finance permission middleware.
// Load explicitly: a loaded-first permission guard cannot trigger lazy loading.
onMounted(() => {
  void loadPermissions()
})
const canView = computed(() => loaded.value && !permissionError.value && hasPermission('bank_accounts', 'view'))
const register = ref<InstanceType<typeof BalanceRegister> | null>(null)
const canRegister = computed(() => canView.value && hasPermission('bank_accounts', 'edit'))
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('bank_accounts', 'admin'))
const account = ref<BankAccount | null>(null)
const pending = ref(false)
const error = ref('')
const editorOpen = ref(false)
watch(() => sessionScope?.value, () => {
  editorOpen.value = false
})
let generation = 0
async function refresh() {
  const epoch = ++generation
  account.value = null
  error.value = ''
  if (!canView.value) {
    pending.value = false
    return
  }
  pending.value = true
  try {
    const response = await api.account(String(route.params.code || ''))
    if (epoch === generation) account.value = response.data
  } catch {
    if (epoch === generation) error.value = '账户详情暂不可用，请重试；账户可能不存在或您无权查看。'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch(() => [route.params.code, canView.value, sessionScope?.value], () => {
  void refresh()
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
const tab = ref('basic')
const balancesAllowed = computed(() => canView.value && !!account.value && tab.value === 'balances')
const balances = useFinancePagedList<BalanceSnapshot>(query => api.snapshots(query), balancesAllowed, { accountCode: String(route.params.code || ''), ...financeDateRange(30) })
watch(() => route.params.code, (code) => {
  balances.accountCode.value = String(code || '')
  balances.page.value = 1
})
const balanceColumns: TableColumn<BalanceSnapshot>[] = [{ accessorKey: 'snapshot_date', header: '日期' }, { accessorKey: 'balance_amount', header: '余额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }, { id: 'actions', header: '当日登记' }]
const fields = computed(() => account.value
  ? [
      ['账户编码', account.value.code], ['账户名称', account.value.account_name], ['开户行', account.value.bank_name], ['脱敏账号', account.value.account_no_masked], ['币种', account.value.currency_code], ['归属部门', account.value.owner_dept_code], ['状态', ({ active: '启用', inactive: '停用', closed: '已关闭' })[account.value.status]], ['版本', `v${account.value.row_version}`],
      ...(Object.hasOwn(account.value, 'short_name') ? [['简称', account.value.short_name], ['行号', account.value.bank_branch_code], ['类型', w3AccountTypeLabel(account.value)], ['排序号', account.value.sort_no], ['法人主体', account.value.legal_entity_name || account.value.legal_entity_code], ['最新余额日期', account.value.latest_balance_date?.slice(0, 10)], ['最新余额', account.value.latest_balance_amount == null ? '—' : `${account.value.latest_balance_amount} ${account.value.currency_code}`]] : [])
    ]
  : [])
</script>

<template>
  <UDashboardPanel :ui="{ body: 'p-0' }">
    <template #body>
      <div class="min-w-0 space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          :title="account?.account_name || '账户详情'"
          breadcrumb="经营 / 账户与资金"
        >
          <template #actions>
            <UButton
              v-if="canRegister && account"
              @click="register?.register()"
            >
              登记余额
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              :to="{ path: moduleUrl('/bank-accounts'), query: backQuery }"
            >
              返回列表
            </UButton><UButton
              v-if="canEdit && account"
              @click="editorOpen = true"
            >
              编辑账户
            </UButton>
          </template>
        </ContentPageHeader>
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
        <UProgress
          v-else-if="pending"
          aria-label="加载账户详情"
        />
        <CommonEmptyState
          v-else-if="!canView"
          icon="i-lucide-lock-keyhole"
          title="无权查看账户"
        />
        <CommonEmptyState
          v-else-if="error"
          title="详情加载失败"
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
        <template v-else-if="account">
          <div class="grid gap-3 rounded-lg border border-default p-4 sm:grid-cols-3">
            <div class="min-w-0">
              <p class="truncate font-medium">
                {{ account.short_name || account.account_name }}
              </p><p class="break-words text-sm text-muted">
                {{ account.bank_name || '—' }} · {{ account.account_no_masked || '—' }}
              </p>
            </div>
            <div class="min-w-0">
              <p class="text-xs text-muted">
                法人主体
              </p><p class="break-words text-sm">
                {{ account.legal_entity_name || account.legal_entity_code || '—' }}
              </p><UBadge :color="account.status === 'active' ? 'success' : 'neutral'">
                {{ { active: '启用', inactive: '停用', closed: '已关闭' }[account.status] }}
              </UBadge>
            </div>
            <div class="min-w-0">
              <p class="text-xs text-muted">
                最新已登记余额 · {{ account.latest_balance_date?.slice(0, 10) || '尚无快照' }}
              </p><p class="break-words font-semibold tabular-nums">
                {{ account.latest_balance_amount == null ? '无余额记录' : formatMoney(account.latest_balance_amount, { currency: account.currency_code }) }}
              </p>
            </div>
          </div>
          <UTabs
            v-model="tab"
            :content="false"
            :items="[{ label: '基本信息', value: 'basic' }, { label: '余额记录', value: 'balances' }, { label: '来源与审计', value: 'source' }]"
            :ui="{ list: 'flex-wrap' }"
          />
          <dl
            v-if="tab === 'basic'"
            class="grid gap-4 rounded-lg border border-default p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div
              v-for="[label, value] in fields"
              :key="label || ''"
              class="min-w-0"
            >
              <dt class="text-xs text-muted">
                {{ label }}
              </dt><dd class="mt-1 break-words text-sm">
                <NuxtLink
                  v-if="label === '法人主体' && account.legal_entity_code"
                  :to="{ path: moduleUrl('/legal-entities'), query: { search: account.legal_entity_code } }"
                  class="text-primary"
                >{{ value || '-' }}</NuxtLink><template v-else>
                  {{ value ?? '—' }}
                </template>
              </dd>
            </div>
          </dl>
          <AccountNumberReveal
            v-if="tab === 'basic'"
            :code="account.code"
            :allowed="canView && hasPermission('bank_accounts', 'reveal-account-no')"
            :available="account.account_type !== 'cash' && !!account.account_no_masked"
          />
          <section
            v-if="tab === 'balances'"
            class="space-y-3"
          >
            <h2 class="font-semibold">
              余额快照（非实时余额）
            </h2>
            <div class="flex flex-wrap items-end gap-3">
              <UFormField label="起始日期">
                <UInput
                  v-model="balances.startDate.value"
                  type="date"
                />
              </UFormField>
              <UFormField label="结束日期">
                <UInput
                  v-model="balances.endDate.value"
                  type="date"
                />
              </UFormField>
              <UButton
                color="neutral"
                variant="outline"
                @click="balances.startDate.value = financeDateRange(30).startDate; balances.endDate.value = financeDateRange(30).endDate"
              >
                近30天
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                @click="balances.startDate.value = financeDateRange(1).endDate.slice(0, 4) + '-01-01'; balances.endDate.value = financeDateRange(1).endDate"
              >
                本年
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                :loading="balances.pending.value"
                @click="balances.refresh"
              >
                刷新
              </UButton>
            </div>
            <CommonEmptyState
              v-if="balances.error.value"
              title="余额加载失败"
              :description="balances.error.value"
            >
              <UButton @click="balances.refresh">
                重试
              </UButton>
            </CommonEmptyState>
            <template v-else>
              <UTable
                :data="balances.items.value"
                :columns="balanceColumns"
                :loading="balances.pending.value"
                class="hidden sm:block"
              >
                <template #snapshot_date-cell="{ row }">
                  <span class="whitespace-nowrap">{{ row.original.snapshot_date.slice(0, 10) }}</span>
                </template>
                <template #balance_amount-cell="{ row }">
                  {{ formatMoney(row.original.balance_amount, { currency: row.original.currency_code }) }}<span
                    v-for="flag in w3BalanceFlags(row.original)"
                    :key="flag"
                    class="block text-xs text-warning"
                  >{{ flag }}</span>
                </template>
                <template #actions-cell="{ row }">
                  <UButton
                    color="neutral"
                    variant="link"
                    size="sm"
                    @click="register?.showEntries(row.original)"
                  >
                    流水
                  </UButton>
                </template>
                <template #empty>
                  <CommonEmptyState
                    title="所选日期范围无余额记录"
                    description="可扩大日期范围，或由有权用户登记余额。"
                  />
                </template>
              </UTable>
              <div class="space-y-3 sm:hidden">
                <UProgress
                  v-if="balances.pending.value"
                  aria-label="加载余额记录"
                />
                <CommonEmptyState
                  v-else-if="!balances.items.value.length"
                  title="所选日期范围无余额记录"
                  description="可扩大日期范围，或由有权用户登记余额。"
                />
                <article
                  v-for="snapshot in balances.items.value"
                  :key="snapshot.id"
                  class="min-w-0 space-y-2 rounded-lg border border-default p-3"
                >
                  <p class="text-sm">
                    {{ snapshot.snapshot_date.slice(0, 10) }}
                  </p>
                  <p class="break-all text-right tabular-nums">
                    {{ formatMoney(snapshot.balance_amount, { currency: snapshot.currency_code }) }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <UBadge
                      v-for="flag in w3BalanceFlags(snapshot)"
                      :key="flag"
                      color="warning"
                      variant="subtle"
                    >
                      {{ flag }}
                    </UBadge><UButton
                      color="neutral"
                      variant="link"
                      size="sm"
                      @click="register?.showEntries(snapshot)"
                    >
                      当日流水
                    </UButton>
                  </div>
                </article>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span>共 {{ balances.total.value }} 条</span><UPagination
                  v-model:page="balances.page.value"
                  :total="balances.total.value"
                  :items-per-page="balances.pageSize"
                  :sibling-count="0"
                  :show-edges="false"
                />
              </div>
            </template>
          </section>
          <UButton
            v-if="tab === 'balances'"
            color="neutral"
            variant="outline"
            :to="{ path: moduleUrl('/bank-accounts/balances'), query: { accountCode: account.code } }"
          >
            查看余额快照（非实时余额）
          </UButton>
          <SourceRecordInfo
            v-if="tab === 'source' && account.source_info"
            :source="account.source_info"
          />
          <CommonEmptyState
            v-else-if="tab === 'source'"
            title="暂无来源资料"
            description="当前接口未提供来源与审计事件。"
          />
        </template>
        <BalanceRegister
          ref="register"
          :account-code="account?.code"
          :can-view="canView"
          :can-register="canRegister"
          @saved="refresh"
        />
        <BankAccountEditor
          v-model:open="editorOpen"
          :account="account"
          :can-edit="canEdit"
          @saved="refresh"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
