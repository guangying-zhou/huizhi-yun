<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import W3MigrationSnapshot from './W3MigrationSnapshot.vue'
import { formatMoney } from '../../../foundation/app/utils/format'
import { w3OwnerLabel, type W3Record } from '../utils/w3Presentation'

const props = defineProps<{ customer: W3Record }>()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const { status } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const page = ref(1)
const children = ref<W3Record[]>([])
const total = ref(0)
const ownerUids = computed(() => children.value.map(row => String(row.owner_uid || '')))
const { userName } = useAltocDirectoryLabels(ownerUids)
const pending = ref(false)
const error = ref('')
const summaries = ref<{ label: string, data: W3Record }[]>([])
const summaryError = ref('')
const summaryPending = ref(false)
const canSummarize = computed(() => loaded.value && !permissionError.value && hasPermission('contract', 'view'))
const childContracts = ref<Record<string, W3Record>>({})
const childContractError = ref('')
const childContractPending = ref(false)
let contractEpoch = 0
async function loadChildContracts() {
  const epoch = ++contractEpoch
  childContracts.value = {}
  childContractError.value = ''
  childContractPending.value = false
  if (!canSummarize.value || !scope.value || status.value !== 'ready' || !children.value.length) return
  childContractPending.value = true
  try {
    const result = await $fetch<{ data: { customerSummaries: Record<string, W3Record> } }>('/altoc/api/v1/contracts', { query: { customerIds: children.value.map(row => String(row.id)).join(','), page: 1, pageSize: 1 }, retry: 0 })
    if (epoch === contractEpoch) childContracts.value = result.data.customerSummaries
  } catch {
    if (epoch === contractEpoch) childContractError.value = '下属合同汇总加载失败，请重试'
  } finally {
    if (epoch === contractEpoch) childContractPending.value = false
  }
}
watch([children, canSummarize, scope, status], () => void loadChildContracts(), { immediate: true })
const columns: TableColumn<W3Record>[] = [{ accessorKey: 'name', header: '直接下属客户' }, { accessorKey: 'status', header: '状态', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } } }, { id: 'contracts', header: '可见合同 / 金额' }, { accessorKey: 'owner_uid', header: '负责人', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } } }]
let childEpoch = 0, summaryEpoch = 0
async function loadChildren() {
  const epoch = ++childEpoch
  children.value = []
  total.value = 0
  error.value = ''
  pending.value = false
  if (!scope.value || status.value !== 'ready') return
  pending.value = true
  try {
    const result = await $fetch<{ data: { items: W3Record[], total: number } }>('/altoc/api/v1/customers', { query: { parentId: String(props.customer.id), page: page.value, pageSize: 20 }, retry: 0 })
    if (epoch === childEpoch) {
      children.value = result.data.items
      total.value = result.data.total
    }
  } catch (failure) {
    if (epoch === childEpoch) error.value = Number((failure as { statusCode?: number }).statusCode) === 403 ? '无查看下属客户的权限' : '下属客户加载失败，请重试'
  } finally {
    if (epoch === childEpoch) pending.value = false
  }
}
async function loadSummaries() {
  const epoch = ++summaryEpoch
  summaries.value = []
  summaryError.value = ''
  summaryPending.value = false
  if (!canSummarize.value || !scope.value || status.value !== 'ready') return
  summaryPending.value = true
  try {
    const values = await Promise.all([false, true].map(async (includeDescendants) => {
      const result = await $fetch<{ data: { rollup: W3Record } }>('/altoc/api/v1/contracts', { query: { customerId: String(props.customer.id), page: 1, pageSize: 1, ...(includeDescendants ? { includeDescendants: true } : {}) }, retry: 0 })
      return { label: includeDescendants ? '含下属' : '本客户', data: result.data.rollup }
    }))
    if (epoch === summaryEpoch) summaries.value = values
  } catch (failure) {
    if (epoch === summaryEpoch) summaryError.value = Number((failure as { statusCode?: number }).statusCode) === 422 ? '客户层级范围过大，请选择更小的下属范围查看汇总' : Number((failure as { statusCode?: number }).statusCode) === 403 ? '无合同汇总查看权限' : '合同汇总加载失败，请重试'
  } finally {
    if (epoch === summaryEpoch) summaryPending.value = false
  }
}
watch([() => props.customer.id, scope, status, canSummarize], () => {
  page.value = 1
  void loadSummaries()
}, { immediate: true })
watch([() => props.customer.id, scope, status, page], () => void loadChildren(), { immediate: true })
onScopeDispose(() => {
  childEpoch++
  summaryEpoch++
  contractEpoch++
})
function amounts(value: unknown): W3Record[] {
  return Array.isArray(value) ? value : []
}
const snapshotCurrent = computed(() => {
  const direct = summaries.value.find(row => row.label === '本客户')?.data
  const subtree = summaries.value.find(row => row.label === '含下属')?.data
  const result: W3Record = {}
  if (direct) result.contract_count_direct = direct.count
  if (subtree) result.contract_count_subtree = subtree.count
  // Never compare a currencyless legacy total against a multi-currency sum.
  for (const [key, summary] of [['direct', direct], ['subtree', subtree]] as const) {
    const values = amounts(summary?.amounts)
    if (values.length === 1 && values[0]?.currency_code === 'CNY') result[`contract_amount_${key}`] = values[0].amount
  }
  if (direct) for (const [field, source] of [['1y', direct?.signedLast12Months], ['ytd', direct?.signedThisYear]] as const) {
    if (!Array.isArray(source)) continue
    const values = amounts(source)
    result[`contract_count_${field}`] = values.reduce((n, row) => n + Number(row.count || 0), 0)
    if (values.length === 1 && values[0]?.currency_code === 'CNY') result[`contract_amount_${field}`] = values[0].amount
  }
  return result
})
</script>

<template>
  <div
    v-if="canSummarize && summaries.length"
    class="grid gap-3 sm:grid-cols-2"
  >
    <section
      v-for="summary in summaries"
      :key="summary.label"
      class="rounded border border-muted p-3"
    >
      <p class="text-sm font-medium">
        {{ summary.label }} · 可见合同工作量
      </p><p class="text-sm text-muted">
        {{ summary.data.count }} 份合同
      </p><p
        v-for="metric in amounts(summary.data.effectiveMetrics)"
        :key="String(metric.currency_code)"
        class="text-sm tabular-nums"
      >
        {{ metric.currency_code }} · 有效额 {{ metric.effective_amount === null ? '未记录' : formatMoney(String(metric.effective_amount), { currency: String(metric.currency_code) }) }} · {{ metric.missing_count }} 份未记录
      </p>
    </section>
  </div>
  <section class="space-y-3">
    <h2 class="font-semibold">
      客户层级
    </h2>
    <nav
      aria-label="上级客户路径"
      class="flex flex-wrap gap-2 text-sm"
    >
      <NuxtLink
        v-for="ancestor in (customer.ancestors as W3Record[] || [])"
        :key="String(ancestor.id)"
        :to="`/altoc/customers/${ancestor.id}`"
        class="max-w-64 truncate text-primary"
      >{{ ancestor.name }} /</NuxtLink>
      <span>{{ customer.name }}</span>
    </nav>
    <p
      v-if="customer.parentHidden"
      class="text-sm text-muted"
    >
      部分上级客户无权查看
    </p>
    <p
      v-if="customer.hasHiddenChildren === true"
      class="text-sm text-muted"
    >
      部分下属不可见
    </p>
    <CommonEmptyState
      v-if="error"
      title="下属客户不可用"
      :description="error"
    >
      <UButton
        color="neutral"
        variant="outline"
        @click="loadChildren"
      >
        重试
      </UButton>
    </CommonEmptyState>
    <template v-else>
      <UAlert
        v-if="childContractError"
        color="error"
        :description="childContractError"
      >
        <template #actions>
          <UButton
            color="neutral"
            @click="loadChildContracts"
          >
            重试
          </UButton>
        </template>
      </UAlert>
      <UTable
        :data="children"
        :columns="columns"
        :loading="pending"
        class="hidden sm:block"
      >
        <template #name-cell="{ row }">
          <NuxtLink
            :to="`/altoc/customers/${row.original.id}`"
            class="block max-w-40 truncate text-primary sm:max-w-64"
          >{{ row.original.name }}</NuxtLink>
        </template>
        <template #contracts-cell="{ row }">
          <span v-if="!canSummarize">无合同查看权限</span>
          <span v-else-if="childContractPending">加载中</span>
          <span v-else-if="childContractError">未加载</span>
          <div
            v-else-if="childContracts[String(row.original.id)]"
            class="text-right tabular-nums"
          >
            <p>{{ childContracts[String(row.original.id)]?.count }} 份</p>
            <p
              v-for="amount in amounts(childContracts[String(row.original.id)]?.amounts)"
              :key="String(amount.currency_code)"
            >
              {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}
            </p>
          </div>
        </template>
        <template #owner_uid-cell="{ row }">
          {{ w3OwnerLabel(row.original.owner_uid, userName(row.original.owner_uid)) }}
        </template>
        <template #status-cell="{ row }">
          {{ ({ active: '有效', draft: '草稿', archived: '归档', inactive: '停用', approved: '已批准', approval_pending: '审批中' } as Record<string, string>)[String(row.original.status)] || '—' }}
        </template>
        <template #empty>
          <CommonEmptyState
            title="暂无可查看的下属客户"
            description="此处仅显示您有权查看的直接下属。"
          />
        </template>
      </UTable>
      <div class="space-y-3 sm:hidden">
        <p
          v-if="pending"
          role="status"
          class="text-sm text-muted"
        >
          正在加载下属客户…
        </p>
        <CommonEmptyState
          v-else-if="!children.length"
          title="暂无可查看的下属客户"
        />
        <article
          v-for="child in children"
          :key="String(child.id)"
          class="min-w-0 space-y-2 rounded-lg border border-default p-3"
        >
          <NuxtLink
            :to="`/altoc/customers/${child.id}`"
            class="block break-words font-medium text-primary"
          >{{ child.name }}</NuxtLink>
          <p class="text-xs text-muted">
            {{ w3OwnerLabel(child.owner_uid, userName(child.owner_uid)) }}
          </p>
          <p
            v-if="!canSummarize"
            class="text-sm text-muted"
          >
            无合同查看权限
          </p>
          <p
            v-else-if="childContractPending"
            role="status"
            class="text-sm text-muted"
          >
            正在加载合同摘要…
          </p>
          <p
            v-else-if="childContractError"
            class="text-sm text-muted"
          >
            合同摘要未加载
          </p>
          <div
            v-else-if="childContracts[String(child.id)]"
            class="space-y-1 text-sm"
          >
            <p>可见合同 {{ childContracts[String(child.id)]?.count }} 份</p>
            <p
              v-for="amount in amounts(childContracts[String(child.id)]?.amounts)"
              :key="String(amount.currency_code)"
              class="break-all text-right tabular-nums"
            >
              {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}
            </p>
          </div>
        </article>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p>共 {{ total }} 条</p><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="20"
        />
      </div>
    </template>
  </section>
  <section class="space-y-3">
    <h2 class="font-semibold">
      合同汇总
    </h2>
    <CommonEmptyState
      v-if="permissionError"
      title="权限加载失败"
      description="无法确认合同汇总权限，请重试加载权限。"
    />
    <p
      v-else-if="!loaded || summaryPending"
      role="status"
      class="text-sm text-muted"
    >
      正在加载合同汇总
    </p>
    <CommonEmptyState
      v-else-if="!canSummarize"
      title="无合同汇总查看权限"
      description="客户资料权限不会扩大合同范围。"
    />
    <CommonEmptyState
      v-else-if="summaryError"
      title="合同汇总不可用"
      :description="summaryError"
    >
      <UButton
        color="neutral"
        variant="outline"
        @click="loadSummaries"
      >
        重试
      </UButton>
    </CommonEmptyState>
    <div
      v-else
      class="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <UCard
        v-for="summary in summaries"
        :key="summary.label"
      >
        <h3 class="font-medium">
          {{ summary.label }}
        </h3>
        <p class="text-sm">
          {{ summary.data.count }} 份销售合同，中止 {{ summary.data.terminatedCount }} 份
        </p>
        <p
          v-for="amount in amounts(summary.data.amounts)"
          :key="String(amount.currency_code)"
          class="tabular-nums"
        >
          当前合同额 {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}
        </p>
        <p
          v-for="amount in amounts(summary.data.effectiveAmounts)"
          :key="`effective-${amount.currency_code}`"
          class="text-sm tabular-nums"
        >
          有效合同额 {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}<span v-if="Number(amount.missingCount)">（{{ amount.missingCount }} 份未填有效额）</span>
        </p>
        <p
          v-for="amount in amounts(summary.data.signedLast12Months)"
          :key="`year-${amount.currency_code}`"
          class="text-sm"
        >
          近一年 {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}
        </p>
        <p
          v-for="amount in amounts(summary.data.signedThisYear)"
          :key="`current-${amount.currency_code}`"
          class="text-sm"
        >
          当年 {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}
        </p>
        <p
          v-if="summary.data.excluded"
          class="text-sm text-warning"
        >
          部分下属合同无权查看，未计入
        </p>
      </UCard>
    </div>
  </section>
  <W3MigrationSnapshot
    v-if="customer.migration_snapshot"
    :snapshot="customer.migration_snapshot as W3Record"
    :current="snapshotCurrent"
  />
</template>
