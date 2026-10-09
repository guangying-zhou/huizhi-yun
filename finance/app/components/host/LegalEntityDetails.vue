<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { useFinancePagedList } from '../../composables/useFinancePagedList'
import type { LegalEntity, BankAccount } from '../../types/hostFinance'

const props = defineProps<{ code: string, allowed: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const { apiUrl, moduleUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const { hasPermission } = usePermissions()
const row = ref<LegalEntity | null>(null)
const pending = ref(false), error = ref(''), tab = ref('basic')
let generation = 0
async function refresh() {
  const epoch = ++generation
  row.value = null
  error.value = ''
  pending.value = false
  if (!open.value || !props.allowed) return
  pending.value = true
  try {
    const response = await api.entity(props.code)
    if (epoch === generation) row.value = response.data
  } catch {
    if (epoch === generation) error.value = '法人主体详情暂不可用，请重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch([open, () => props.code, () => props.allowed], () => {
  tab.value = 'basic'
  void refresh()
})
watch(() => sessionScope?.value, () => {
  generation++
  open.value = false
  row.value = null
})
onScopeDispose(() => {
  generation++
})
const accountsAllowed = computed(() => open.value && props.allowed && tab.value === 'accounts' && hasPermission('bank_accounts', 'view'))
const accounts = useFinancePagedList<BankAccount>(query => api.accounts({ ...query, legalEntityCode: props.code }), accountsAllowed)
watch(() => props.code, () => {
  accounts.page.value = 1
})
const columns: TableColumn<BankAccount>[] = [{ accessorKey: 'account_name', header: '账户名称' }, { accessorKey: 'bank_name', header: '开户行' }, { accessorKey: 'account_no_masked', header: '脱敏账号' }, { accessorKey: 'currency_code', header: '币种' }]
const fields = computed(() => !row.value ? [] : tab.value === 'invoice' ? [['开票抬头', row.value.invoice_title], ['税号', row.value.invoice_tax_no], ['注册地址', row.value.registered_address]] : [['名称', row.value.name], ['简称', row.value.short_name], ['编码', row.value.code], ['统一社会信用代码', row.value.unified_social_credit_code], ['主体类型', { company: '公司', branch: '分支机构', other: '其他' }[row.value.entity_type]], ['排序号', row.value.sort_no], ['备注', row.value.remark]])
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="row?.short_name || row?.name || '法人主体详情'"
    description="主体资料与授权账户"
    :ui="{ content: 'w-full sm:max-w-4xl', wrapper: 'min-w-0 flex-1 pe-8', title: 'break-words' }"
  >
    <template #body>
      <div class="min-w-0 space-y-4">
        <UProgress
          v-if="pending"
          aria-label="加载主体详情"
        />
        <CommonEmptyState
          v-else-if="error"
          title="详情加载失败"
          :description="error"
        >
          <UButton @click="refresh">
            重试
          </UButton>
        </CommonEmptyState>
        <template v-else-if="row">
          <div class="flex flex-wrap items-center gap-2">
            <span class="break-all text-sm text-muted">{{ row.code }}</span><UBadge :color="row.status === 'active' ? 'success' : 'neutral'">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </UBadge><span
              v-if="hasPermission('bank_accounts', 'view') && row.account_count !== undefined"
              class="text-sm"
            >{{ row.account_count }} 个账户</span>
          </div>
          <UTabs
            v-model="tab"
            :content="false"
            :items="[{ label: '基本信息', value: 'basic' }, { label: '银行账户', value: 'accounts' }, { label: '开票资料', value: 'invoice' }, { label: '来源与审计', value: 'source' }]"
            :ui="{ list: 'flex-wrap', trigger: 'min-w-0' }"
          />
          <template v-if="tab === 'accounts'">
            <CommonEmptyState
              v-if="!accountsAllowed"
              title="无权查看银行账户"
              icon="i-lucide-lock-keyhole"
            />
            <CommonEmptyState
              v-else-if="accounts.error.value"
              title="账户加载失败"
              :description="accounts.error.value"
            >
              <UButton @click="accounts.refresh">
                重试
              </UButton>
            </CommonEmptyState>
            <template v-else>
              <UTable
                :data="accounts.items.value"
                :columns="columns"
                :loading="accounts.pending.value"
                class="hidden sm:block"
              >
                <template #account_name-cell="{ row: account }">
                  <NuxtLink
                    :to="moduleUrl(`/bank-accounts/${encodeURIComponent(account.original.code)}`)"
                    class="block max-w-48 truncate text-primary"
                  >{{ account.original.account_name }}</NuxtLink>
                </template><template #empty>
                  <CommonEmptyState title="暂无关联账户" />
                </template>
              </UTable>
              <div class="space-y-2 sm:hidden">
                <UProgress v-if="accounts.pending.value" /><CommonEmptyState
                  v-else-if="!accounts.items.value.length"
                  title="暂无关联账户"
                /><NuxtLink
                  v-for="account in accounts.items.value"
                  :key="account.code"
                  :to="moduleUrl(`/bank-accounts/${encodeURIComponent(account.code)}`)"
                  class="block min-w-0 rounded-lg border border-default p-3"
                ><p class="truncate text-primary">{{ account.account_name }}</p><p class="break-words text-sm text-muted">{{ account.bank_name }} · {{ account.account_no_masked }} · {{ account.currency_code }}</p></NuxtLink>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span>共 {{ accounts.total.value }} 条</span><UPagination
                  v-model:page="accounts.page.value"
                  :total="accounts.total.value"
                  :items-per-page="accounts.pageSize"
                  :sibling-count="0"
                  :show-edges="false"
                />
              </div>
            </template>
          </template>
          <dl
            v-else-if="tab !== 'source'"
            class="grid gap-4 rounded-lg border border-default p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div
              v-for="[label, value] in fields"
              :key="String(label)"
              class="min-w-0"
            >
              <dt class="text-xs text-muted">
                {{ label }}
              </dt><dd class="mt-1 break-words text-sm">
                {{ value ?? '—' }}
              </dd>
            </div>
          </dl>
          <div
            v-else
            class="rounded-lg border border-default p-4 text-sm"
          >
            <p>当前记录版本：v{{ row.row_version }}</p><p class="mt-2 text-muted">
              当前接口未提供来源与审计事件。
            </p>
          </div>
        </template>
      </div>
    </template>
  </USlideover>
</template>
