<script setup lang="ts">
import type { ApiResponse, ListPayload, PurchaseOrderItem, SummaryMetric } from '~/types'

usePageTitle('采购单')

const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
await loadPermissions()
const canApprovePurchaseOrder = computed(() => permissionsLoaded.value && hasPermission('purchase_orders', 'approve'))

interface RuntimeInstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

interface RuntimeInstanceConflictExplanation {
  tenantCode: string
  uid: string
  requested: {
    appCode: string
    resourceCode: string
    action: string
  }
  principals: RuntimeInstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: Array<{
    ruleCode?: string
    ruleName?: string
    enforcement?: string
    status?: string
    reasonCode?: string
    message?: string
    counterpart?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
    requested?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
  }>
}

interface AssetsInstanceConflictExplainData {
  targetType: 'purchase_order'
  id: string
  code: string | null
  action: 'approve'
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplanation
}

const createOpen = ref(false)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'draft' | 'pending_approval' | 'approved'>('all')
const conflictModalOpen = ref(false)
const conflictLoading = ref(false)
const conflictResult = ref<AssetsInstanceConflictExplainData | null>(null)
const conflictTarget = ref<PurchaseOrderItem | null>(null)
const toast = useToast()
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<PurchaseOrderItem>>>('/api/v1/purchase-orders', {
  query
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<PurchaseOrderItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  purchase_type_label: getLabel('purchase_type', item.purchase_type),
  status_label: getLabel('purchase_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = computed(() => [
  { accessorKey: 'order_no', header: '采购单号' },
  { accessorKey: 'purchase_type_label', header: '采购类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'supplier_name', header: '供应商' },
  { accessorKey: 'budget_amount', header: '预算金额' },
  ...(canApprovePurchaseOrder.value ? [{ id: 'conflict_actions', header: '风险' }] : [])
])

const handleRowSelect = (_event: Event, row: { original: PurchaseOrderItem }) => {
  navigateTo(`/procurement/orders/${row.original.id}`)
}

const handleCreated = async (id: number) => {
  await refresh()
  await navigateTo(`/procurement/orders/${id}`)
}

function conflictDecisionColor(result: RuntimeInstanceConflictExplanation | null | undefined) {
  if (!result) return 'neutral'
  if (result.hasBlockingViolation) return 'error'
  if (result.hasWarningViolation || result.hasViolation) return 'warning'
  return 'success'
}

function conflictDecisionLabel(result: RuntimeInstanceConflictExplanation | null | undefined) {
  if (!result) return '未解释'
  if (result.hasBlockingViolation) return '阻断风险'
  if (result.hasWarningViolation || result.hasViolation) return '预警风险'
  return '未触发'
}

function conflictRuleStatusColor(status: unknown) {
  if (status === 'violated') return 'warning'
  if (status === 'satisfied') return 'success'
  return 'neutral'
}

function conflictRuleStatusLabel(status: unknown) {
  if (status === 'violated') return '已触发'
  if (status === 'satisfied') return '已通过'
  return '未适用'
}

function permissionText(permission: { appCode?: string, resourceCode?: string, action?: string } | null | undefined) {
  if (!permission) return '-'
  return [permission.appCode, permission.resourceCode, permission.action].filter(Boolean).join(':') || '-'
}

function principalLabel(kind: string) {
  const labels: Record<string, string> = {
    requester: '请求人',
    applicant: '申请人'
  }
  return labels[kind] || kind
}

async function openConflictExplanation(row: PurchaseOrderItem) {
  conflictTarget.value = row
  conflictResult.value = null
  conflictModalOpen.value = true
  conflictLoading.value = true
  try {
    const response = await $fetch<ApiResponse<AssetsInstanceConflictExplainData>>('/api/v1/authorization/instance-conflict-explain', {
      method: 'POST',
      body: {
        targetType: 'purchase_order',
        id: row.id,
        action: 'approve'
      }
    })
    if (!response.data) {
      throw new Error('实例职责冲突解释结果为空。')
    }
    conflictResult.value = response.data
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.add({
      title: '职责冲突解释失败',
      description: message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
    conflictModalOpen.value = false
  } finally {
    conflictLoading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="purchase-orders" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">采购单列表</span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                class="shrink-0"
                @click="createOpen = true"
              >
                新增采购单
              </UButton>
            </div>
          </template>

          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索采购单号、项目、合同、供应商或申请人"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'draft' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'draft'"
                >
                  草稿
                </UButton>
                <UButton
                  :variant="selectedStatus === 'pending_approval' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'pending_approval'"
                >
                  待审批
                </UButton>
                <UButton
                  :variant="selectedStatus === 'approved' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'approved'"
                >
                  已批准
                </UButton>
              </div>
            </div>
          </div>

          <UTable
            :data="displayItems"
            :columns="columns"
            :loading="loading"
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-shopping-cart"
                title="暂无采购单"
              />
            </template>
            <template #conflict_actions-cell="{ row }">
              <UButton
                v-if="canApprovePurchaseOrder"
                size="xs"
                color="warning"
                variant="soft"
                icon="i-lucide-shield-alert"
                :loading="conflictLoading && conflictTarget?.id === row.original.id"
                @click.stop="openConflictExplanation(row.original)"
              >
                冲突
              </UButton>
            </template>
          </UTable>

          <div
            v-if="total > 0"
            class="mt-4 flex items-center justify-between border-t border-default pt-4"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsPurchaseOrderCreateModal
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />

  <UModal
    v-model:open="conflictModalOpen"
    title="职责冲突解释"
    :description="conflictTarget ? `采购单 ${conflictTarget.order_no}` : '采购审批风险解释'"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div
        v-if="conflictLoading"
        class="flex min-h-36 items-center justify-center gap-2 text-sm text-muted"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        正在解释职责冲突...
      </div>

      <div
        v-else-if="conflictResult"
        class="space-y-4"
      >
        <UAlert
          :color="conflictDecisionColor(conflictResult.explanation)"
          variant="soft"
          icon="i-lucide-shield-alert"
          :title="conflictDecisionLabel(conflictResult.explanation)"
          :description="`${conflictResult.explanation.requested.appCode}:${conflictResult.explanation.requested.resourceCode}:${conflictResult.explanation.requested.action}`"
        />

        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="principal in conflictResult.explanation.principals"
              :key="`${principal.kind}:${principal.uid}`"
              :color="principal.matchesActor ? 'warning' : 'neutral'"
              variant="soft"
              class="font-mono"
            >
              {{ principalLabel(principal.kind) }}={{ principal.uid }}
            </UBadge>
            <span
              v-if="conflictResult.explanation.principals.length === 0"
              class="text-sm text-muted"
            >
              当前采购单没有可解释的申请人主体。
            </span>
          </div>
        </div>

        <div
          v-if="conflictResult.explanation.rules.length > 0"
          class="grid gap-2"
        >
          <div
            v-for="rule in conflictResult.explanation.rules"
            :key="String(rule.ruleCode || rule.ruleName)"
            class="rounded-lg border border-default bg-default px-4 py-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-highlighted">
                {{ rule.ruleName || rule.ruleCode }}
              </p>
              <UBadge
                :color="conflictRuleStatusColor(rule.status)"
                variant="soft"
              >
                {{ conflictRuleStatusLabel(rule.status) }}
              </UBadge>
              <UBadge
                :color="rule.enforcement === 'enforce' ? 'error' : 'warning'"
                variant="soft"
              >
                {{ rule.enforcement || 'warning' }}
              </UBadge>
            </div>
            <p class="mt-2 text-sm text-muted">
              {{ rule.message || rule.reasonCode || '未返回解释消息' }}
            </p>
            <p class="mt-2 font-mono text-xs text-muted">
              {{ permissionText(rule.counterpart?.permission) }}
              ↔
              {{ permissionText(rule.requested?.permission) }}
            </p>
          </div>
        </div>

        <div
          v-else
          class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
        >
          当前采购审批动作未命中 active 职责冲突规则。
        </div>
      </div>
    </template>
  </UModal>
</template>
