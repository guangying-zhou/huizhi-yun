<script setup lang="ts">
import type { ApiResponse, Assignment, ListResponse } from '~/types'

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

interface PeopleInstanceConflictExplainData {
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

const { label, color, date } = usePeopleFormat()
usePageTitle('任职变更')

const page = ref(1)
const pageSize = ref(20)
const { search: keyword, debounced: debouncedKeyword } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const conflictModalOpen = ref(false)
const conflictLoading = ref(false)
const conflictResult = ref<PeopleInstanceConflictExplainData | null>(null)
const conflictTarget = ref<Assignment | null>(null)
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()
const openingNewAssignment = ref(false)

const query = computed(() => ({
  page: page.value,
  page_size: pageSize.value,
  keyword: debouncedKeyword.value || undefined
}))

const { data: response, error, refresh, status } = await useLazyFetch<ApiResponse<ListResponse<Assignment>>>('/api/v1/assignments', {
  query,
  watch: [query]
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const total = computed(() => response.value?.data.total || 0)

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  change_label: label(item.change_type),
  approval_label: label(item.approval_status),
  effective_period: `${date(item.effective_from)} ~ ${date(item.effective_to) === '-' ? '至今' : date(item.effective_to)}`
})))

const columns = [
  { accessorKey: 'assignment_code', header: '编号' },
  { accessorKey: 'employee_uid', header: '员工' },
  { accessorKey: 'change_label', header: '变更类型' },
  { accessorKey: 'dept_name', header: '部门' },
  { accessorKey: 'position_name', header: '岗位' },
  { accessorKey: 'rank_code', header: '职级' },
  { accessorKey: 'manager_uid', header: '负责人' },
  { accessorKey: 'effective_period', header: '生效期间' },
  { accessorKey: 'approval_label', header: '审批状态' },
  { accessorKey: 'source_app', header: '来源' },
  { id: 'conflict_actions', header: '风险' }
]

async function openNewAssignment() {
  if (openingNewAssignment.value) return

  openingNewAssignment.value = true
  try {
    const authorization = await ensurePeoplePermission('assignments', 'edit')
    if (!authorization.authorized) {
      toast.add({
        title: '当前角色无权限',
        description: '需要任职调整权限后才能新增任职变更。',
        color: 'warning'
      })
      return
    }

    await navigateTo({
      path: '/employees',
      query: { select: 'assignment' }
    })
  } finally {
    openingNewAssignment.value = false
  }
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
    employee: '员工'
  }
  return labels[kind] || kind
}

async function openConflictExplanation(row: Assignment) {
  conflictTarget.value = row
  conflictResult.value = null
  conflictModalOpen.value = true
  conflictLoading.value = true
  try {
    const response = await $fetch<ApiResponse<PeopleInstanceConflictExplainData>>('/api/v1/authorization/instance-conflict-explain', {
      method: 'POST',
      body: {
        targetType: 'assignment',
        id: row.assignment_code || row.id,
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
  <UDashboardPanel
    id="people-assignments"
    grow
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="任职变更暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索员工 / 岗位 / 来源单据"
              class="w-full md:max-w-md"
            />
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              :loading="openingNewAssignment"
              @click="openNewAssignment"
            >
              新增变更
            </UButton>
          </div>
        </UCard>

        <UCard>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="status === 'pending'"
            >
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-refresh-cw"
                  title="暂无任职记录"
                />
              </template>
              <template #change_label-cell="{ row }">
                <UBadge
                  :color="color(row.original.change_type)"
                  variant="soft"
                >
                  {{ row.original.change_label }}
                </UBadge>
              </template>
              <template #approval_label-cell="{ row }">
                <UBadge
                  :color="color(row.original.approval_status)"
                  variant="soft"
                >
                  {{ row.original.approval_label }}
                </UBadge>
              </template>
              <template #conflict_actions-cell="{ row }">
                <UButton
                  size="xs"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-shield-alert"
                  :loading="conflictLoading && conflictTarget?.id === row.original.id"
                  @click.stop="openConflictExplanation(row.original)"
                >
                  检查
                </UButton>
              </template>
            </UTable>
          </div>

          <div
            v-if="total > 0"
            class="flex items-center justify-between border-t border-default px-4 py-3"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>

        <UModal
          v-model:open="conflictModalOpen"
          title="职责冲突解释"
          :description="conflictTarget ? `任职变更 ${conflictTarget.assignment_code}` : '任职变更审批风险解释'"
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
                    当前任职变更没有可解释的经办人或员工主体。
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
                当前任职变更审批动作未命中 active 职责冲突规则。
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
