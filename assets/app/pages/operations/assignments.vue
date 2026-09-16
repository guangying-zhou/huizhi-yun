<script setup lang="ts">
import type { ApiResponse, AssignmentItem, ListPayload, SummaryMetric } from '~/types'

usePageTitle('资产操作记录')

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
  targetType: 'assignment'
  id: string
  code: string | null
  action: 'approve'
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplanation
}

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
await loadPermissions()
const canRequestAssignment = computed(() => permissionsLoaded.value && hasPermission('assignments', 'request'))
const canEditAssignment = computed(() => permissionsLoaded.value && hasPermission('assignments', 'edit'))
const canApproveAssignment = computed(() => permissionsLoaded.value && hasPermission('assignments', 'approve'))
const canCreateAssignment = computed(() => canRequestAssignment.value || canEditAssignment.value)
const requestOnly = computed(() => canRequestAssignment.value && !canEditAssignment.value)
const createOpen = ref(false)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'pending' | 'active' | 'completed'>('all')
const conflictModalOpen = ref(false)
const conflictLoading = ref(false)
const conflictResult = ref<AssetsInstanceConflictExplainData | null>(null)
const conflictTarget = ref<AssignmentItem | null>(null)
const toast = useToast()

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<AssignmentItem>>>('/api/v1/assignments', {
  query
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<AssignmentItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  action_type_label: getLabel('assignment_action_type', item.action_type),
  status_label: getLabel('assignment_status', item.status),
  target_type_label: getLabel('assignment_target_type', item.target_type)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = computed(() => [
  { accessorKey: 'assignment_no', header: '操作编号' },
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'action_type_label', header: '操作类型' },
  { accessorKey: 'target_ref', header: '目标' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'workflow_instance_id', header: '流程实例' },
  ...(canApproveAssignment.value ? [{ id: 'conflict_actions', header: '风险' }] : [])
])

const handleCreated = async () => {
  await refresh()
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
    operator: '经办人',
    target_user: '目标用户',
    applicant: '申请人'
  }
  return labels[kind] || kind
}

async function openConflictExplanation(row: AssignmentItem) {
  conflictTarget.value = row
  conflictResult.value = null
  conflictModalOpen.value = true
  conflictLoading.value = true
  try {
    const response = await $fetch<ApiResponse<AssetsInstanceConflictExplainData>>('/api/v1/authorization/instance-conflict-explain', {
      method: 'POST',
      body: {
        targetType: 'assignment',
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
  <UDashboardPanel id="assignments" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">记录列表</span>
              <UButton
                v-if="canCreateAssignment"
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                class="shrink-0"
                @click="createOpen = true"
              >
                {{ requestOnly ? '发起申请' : '新增操作' }}
              </UButton>
            </div>
          </template>
          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索操作编号、资产编号、资产名称、动作或目标"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'pending' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'pending'"
                >
                  待处理
                </UButton>
                <UButton
                  :variant="selectedStatus === 'active' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'active'"
                >
                  进行中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'completed' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'completed'"
                >
                  已完成
                </UButton>
              </div>
            </div>
          </div>
          <UTable
            :data="displayItems"
            :columns="columns"
            :loading="loading"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-clipboard-list"
                title="暂无领用记录"
              />
            </template>
            <template #conflict_actions-cell="{ row }">
              <UButton
                v-if="canApproveAssignment"
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

  <AssetsAssignmentCreateModal
    :open="createOpen"
    :request-only="requestOnly"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />

  <UModal
    v-model:open="conflictModalOpen"
    title="职责冲突解释"
    :description="conflictTarget ? `资产操作 ${conflictTarget.assignment_no}` : '资产操作审批风险解释'"
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
              当前资产操作没有可解释的经办人或目标用户。
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
          当前资产操作审批动作未命中 active 职责冲突规则。
        </div>
      </div>
    </template>
  </UModal>
</template>
