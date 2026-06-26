<script setup lang="ts">
usePageTitle('成员权限')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface MemberListItem {
  id: number
  uid: string
  subjectCode: string
  displayName: string
  status: string
  activeRoleCount: number
}

interface MemberListResponse {
  items: MemberListItem[]
  total: number
  page: number
  pageSize: number
}

interface MemberDetailRole {
  roleCode: string
  roleName: string
  roleType: string
  source: string
  category: string
  sourceTypes: string[]
  subjectTypes: string[]
  permissionCount: number
}

interface MemberDetailPermission {
  appCode: string
  resourceCode: string
  action: string
  sources: Array<{
    roleCode: string | null
    sourceType: string
    scopes: string[]
  }>
}

interface MemberDetailResponse {
  member: MemberListItem
  simulation: {
    authorizationMode: string
    activeRoleCode: string | null
    selectedRoleCodes: string[]
    availableRoleCodes: string[]
  }
  memberships: Array<{
    subjectType: string
    subjectCode: string
    displayName: string
    relationType: string
    primary: boolean
  }>
  roles: MemberDetailRole[]
  permissions: MemberDetailPermission[]
}

interface AuthorizationExplainScope {
  dimension: string
  predicate: string
  value: string | null
  source: string
}

interface AuthorizationExplainGrant {
  grantId: string
  roleCode: string | null
  subjectType: string
  sourceType: string
  permission: {
    appCode: string
    resourceCode: string
    action: string
  }
  scopeMatched: boolean
  defaultScopes: AuthorizationExplainScope[]
  assignmentScopes: AuthorizationExplainScope[]
  relationScopes: AuthorizationExplainScope[]
}

interface AuthorizationExplainResponse {
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: AuthorizationExplainGrant | null
  candidateGrants: AuthorizationExplainGrant[]
  selectedRoleCodes: string[]
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const ALL_EFFECTIVE_ROLES_VALUE = '__all_effective_roles__'

const { currentTenantCode } = useTenantContext()
const toast = useToast()
const tenantCode = computed(() => String(currentTenantCode.value || '').trim())

const members = ref<MemberListItem[]>([])
const memberTotal = ref(0)
const memberKeyword = ref('')
const selectedUid = ref('')
const detail = ref<MemberDetailResponse | null>(null)
const explainResult = ref<AuthorizationExplainResponse | null>(null)
const selectedRoleCode = ref(ALL_EFFECTIVE_ROLES_VALUE)
const pending = reactive({
  members: false,
  detail: false,
  explain: false
})
const explainForm = reactive({
  appCode: '',
  resourceCode: '',
  action: 'view',
  ownerUid: '',
  departmentCode: '',
  departmentTree: '',
  projectCode: '',
  projectMemberUids: '',
  matchedRelations: ''
})

const roleSimulationOptions = computed(() => [
  { label: '全部有效角色', value: ALL_EFFECTIVE_ROLES_VALUE },
  ...(detail.value?.simulation.availableRoleCodes || []).map(roleCode => ({
    label: roleCode,
    value: roleCode
  }))
])
const activeSimulationRoleCode = computed(() =>
  selectedRoleCode.value && selectedRoleCode.value !== ALL_EFFECTIVE_ROLES_VALUE
    ? selectedRoleCode.value
    : ''
)
const permissionGroups = computed(() => {
  const groups = new Map<string, MemberDetailPermission[]>()
  for (const permission of detail.value?.permissions || []) {
    const items = groups.get(permission.appCode) || []
    items.push(permission)
    groups.set(permission.appCode, items)
  }
  return Array.from(groups.entries()).map(([appCode, permissions]) => ({ appCode, permissions }))
})
const selectedMember = computed(() => detail.value?.member || members.value.find(item => item.uid === selectedUid.value) || null)
const explainDecisionColor = computed<BadgeColor>(() => explainResult.value?.allowed ? 'success' : 'error')

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as { data?: { message?: string, statusMessage?: string }, message?: string }
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

function categoryLabel(category: string) {
  if (category === 'main_position') return '主岗位'
  if (category === 'management_duty') return '管理职责'
  if (category === 'approval_duty') return '审批职责'
  if (category === 'high_risk_privilege') return '高风险特权'
  if (category === 'custom_role') return '自定义角色'
  return '专业职责'
}

function categoryColor(category: string): BadgeColor {
  if (category === 'high_risk_privilege') return 'error'
  if (category === 'approval_duty') return 'warning'
  if (category === 'management_duty') return 'info'
  return 'neutral'
}

function reasonLabel(reasonCode: string) {
  if (reasonCode === 'allowed') return '允许'
  if (reasonCode === 'scope_not_matched') return '权限存在但对象范围不匹配'
  if (reasonCode === 'no_permission') return '没有匹配权限'
  return reasonCode || '未知'
}

function scopeText(scope: AuthorizationExplainScope) {
  const value = scope.value ? `:${scope.value}` : ''
  return `${scope.dimension}:${scope.predicate}${value}`
}

function grantScopeText(grant: AuthorizationExplainGrant) {
  const scopes = [
    ...grant.defaultScopes,
    ...grant.assignmentScopes,
    ...grant.relationScopes
  ]
  return scopes.length ? scopes.map(scope => `${scopeText(scope)} (${scope.source})`).join(' / ') : '无范围限制'
}

function permissionSourceText(permission: MemberDetailPermission) {
  return permission.sources
    .slice(0, 3)
    .map(source => `${source.roleCode || 'unknown'} / ${source.sourceType}${source.scopes.length ? ` / ${source.scopes.join(', ')}` : ''}`)
    .join('；') || '无来源'
}

async function loadMembers() {
  if (!tenantCode.value) {
    members.value = []
    detail.value = null
    selectedUid.value = ''
    return
  }

  pending.members = true
  try {
    const response = await platformFetchJson<ApiEnvelope<MemberListResponse>>('/api/platform/tenant-admin/member-permissions', {
      query: {
        tenantCode: tenantCode.value,
        keyword: memberKeyword.value.trim() || undefined,
        page: 1,
        pageSize: 200
      }
    })
    members.value = response.data.items
    memberTotal.value = response.data.total
    if (!selectedUid.value || !members.value.some(member => member.uid === selectedUid.value)) {
      selectedUid.value = members.value[0]?.uid || ''
    }
  } catch (error) {
    toast.add({ title: errorMessage(error, '成员权限列表加载失败'), color: 'error' })
    members.value = []
  } finally {
    pending.members = false
  }
}

async function loadDetail() {
  if (!tenantCode.value || !selectedUid.value) {
    detail.value = null
    return
  }

  pending.detail = true
  explainResult.value = null
  try {
    const simulatedRoleCode = activeSimulationRoleCode.value
    const response = await platformFetchJson<ApiEnvelope<MemberDetailResponse>>('/api/platform/tenant-admin/member-permissions', {
      query: {
        tenantCode: tenantCode.value,
        uid: selectedUid.value,
        authorizationMode: simulatedRoleCode ? 'role_simulation' : undefined,
        activeRoleCode: simulatedRoleCode || undefined
      }
    })
    detail.value = response.data
    const firstPermission = response.data.permissions[0]
    if (firstPermission && (!explainForm.appCode || !explainForm.resourceCode)) {
      explainForm.appCode = firstPermission.appCode
      explainForm.resourceCode = firstPermission.resourceCode
      explainForm.action = firstPermission.action
    }
    if (!explainForm.ownerUid) explainForm.ownerUid = selectedUid.value
  } catch (error) {
    toast.add({ title: errorMessage(error, '成员权限详情加载失败'), color: 'error' })
    detail.value = null
  } finally {
    pending.detail = false
  }
}

function usePermissionForExplain(permission: MemberDetailPermission) {
  explainForm.appCode = permission.appCode
  explainForm.resourceCode = permission.resourceCode
  explainForm.action = permission.action
}

async function runExplain() {
  if (!tenantCode.value || !selectedUid.value) return
  if (!explainForm.appCode.trim() || !explainForm.resourceCode.trim() || !explainForm.action.trim()) {
    toast.add({ title: '请填写 app、resource 和 action。', color: 'warning' })
    return
  }

  pending.explain = true
  try {
    const simulatedRoleCode = activeSimulationRoleCode.value
    const response = await platformFetchJson<ApiEnvelope<AuthorizationExplainResponse>>('/api/platform/tenant-admin/authorization-explain', {
      query: {
        tenantCode: tenantCode.value,
        uid: selectedUid.value,
        appCode: explainForm.appCode.trim(),
        resourceCode: explainForm.resourceCode.trim(),
        action: explainForm.action.trim(),
        authorizationMode: simulatedRoleCode ? 'role_simulation' : undefined,
        activeRoleCode: simulatedRoleCode || undefined,
        ownerUid: explainForm.ownerUid.trim() || undefined,
        departmentCode: explainForm.departmentCode.trim() || undefined,
        departmentTree: explainForm.departmentTree.trim() || undefined,
        projectCode: explainForm.projectCode.trim() || undefined,
        projectMemberUids: explainForm.projectMemberUids.trim() || undefined,
        matchedRelations: explainForm.matchedRelations.trim() || undefined
      }
    })
    explainResult.value = response.data
  } catch (error) {
    toast.add({ title: errorMessage(error, '权限解释失败'), color: 'error' })
    explainResult.value = null
  } finally {
    pending.explain = false
  }
}

watch(tenantCode, () => {
  loadMembers()
}, { immediate: true })

watch(selectedUid, () => {
  if (activeSimulationRoleCode.value) {
    selectedRoleCode.value = ALL_EFFECTIVE_ROLES_VALUE
    return
  }
  loadDetail()
})

watch(selectedRoleCode, () => {
  loadDetail()
})
</script>

<template>
  <UDashboardPanel
    id="tenant-member-permissions"
    class="h-[calc(100dvh-var(--topbar-h,52px)-0.5rem)] min-h-0"
    :ui="{ body: 'console-page flex flex-col min-h-0 overflow-hidden' }"
  >
    <template #body>
      <UAlert
        v-if="!tenantCode"
        color="warning"
        variant="soft"
        icon="i-lucide-building-2"
        title="请先在企业工作台选择企业"
        description="未选择企业时无法加载成员权限。"
      />

      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              成员权限
            </h1>
            <p class="mt-1 text-sm text-muted">
              按成员查看有效角色、权限来源和对象范围，并在当前页进行内联模拟解释。
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="pending.members || pending.detail"
            @click="loadMembers"
          >
            刷新
          </UButton>
        </div>
      </section>

      <div class="grid flex-1 min-h-0 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="space-y-3">
              <div>
                <h2 class="text-base font-semibold text-highlighted">
                  成员
                </h2>
                <p class="mt-1 text-sm text-muted">
                  {{ memberTotal }} 个用户主体
                </p>
              </div>
              <UInput
                v-model="memberKeyword"
                icon="i-lucide-search"
                placeholder="搜索姓名 / uid"
                @keyup.enter="loadMembers"
              />
            </div>
          </template>

          <div class="max-h-[calc(100dvh-18rem)] overflow-y-auto p-2">
            <button
              v-for="member in members"
              :key="member.uid"
              type="button"
              class="w-full rounded-lg px-3 py-2 text-left transition hover:bg-muted"
              :class="selectedUid === member.uid ? 'bg-muted ring-1 ring-primary' : ''"
              @click="selectedUid = member.uid"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium text-highlighted">{{ member.displayName }}</span>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ member.activeRoleCount }}
                </UBadge>
              </div>
              <p class="mt-1 truncate font-mono text-xs text-muted">
                {{ member.uid }}
              </p>
            </button>
            <div
              v-if="!pending.members && members.length === 0"
              class="px-3 py-8 text-center text-sm text-muted"
            >
              没有匹配成员。
            </div>
          </div>
        </UCard>

        <div class="min-h-0 overflow-y-auto space-y-4">
          <UCard>
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-semibold text-highlighted">
                    {{ selectedMember?.displayName || '未选择成员' }}
                  </h2>
                  <p class="mt-1 font-mono text-xs text-muted">
                    {{ selectedMember?.uid || '选择左侧成员后查看权限' }}
                  </p>
                </div>
                <USelect
                  v-model="selectedRoleCode"
                  class="w-56"
                  :items="roleSimulationOptions"
                  :disabled="!detail"
                />
              </div>
            </template>

            <div
              v-if="pending.detail"
              class="permission-state"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />
              正在加载成员权限...
            </div>
            <div
              v-else-if="detail"
              class="grid gap-3 md:grid-cols-3"
            >
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs text-muted">
                  有效角色
                </p>
                <p class="mt-2 text-lg font-semibold text-highlighted">
                  {{ detail.roles.length }}
                </p>
              </div>
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs text-muted">
                  有效权限
                </p>
                <p class="mt-2 text-lg font-semibold text-highlighted">
                  {{ detail.permissions.length }}
                </p>
              </div>
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs text-muted">
                  授权模式
                </p>
                <p class="mt-2 text-sm font-semibold text-highlighted">
                  {{ activeSimulationRoleCode ? 'role_simulation' : 'merged' }}
                </p>
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <h2 class="text-base font-semibold text-highlighted">
                角色来源
              </h2>
            </template>
            <div class="grid gap-2 lg:grid-cols-2">
              <div
                v-for="role in detail.roles"
                :key="role.roleCode"
                class="rounded-lg border border-default bg-default px-4 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-highlighted">{{ role.roleName }}</span>
                  <UBadge
                    :color="categoryColor(role.category)"
                    variant="soft"
                  >
                    {{ categoryLabel(role.category) }}
                  </UBadge>
                </div>
                <p class="mt-1 font-mono text-xs text-muted">
                  {{ role.roleCode }}
                </p>
                <p class="mt-2 text-xs text-muted">
                  {{ role.sourceTypes.join(' / ') }} · {{ role.subjectTypes.join(' / ') }} · {{ role.permissionCount }} permissions
                </p>
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <h2 class="text-base font-semibold text-highlighted">
                内联权限解释
              </h2>
            </template>
            <div class="space-y-4">
              <div class="grid gap-3 lg:grid-cols-4">
                <UFormField label="app">
                  <UInput v-model="explainForm.appCode" />
                </UFormField>
                <UFormField label="resource">
                  <UInput v-model="explainForm.resourceCode" />
                </UFormField>
                <UFormField label="action">
                  <UInput v-model="explainForm.action" />
                </UFormField>
                <div class="flex items-end">
                  <UButton
                    class="w-full"
                    icon="i-lucide-search-check"
                    :loading="pending.explain"
                    @click="runExplain"
                  >
                    解释
                  </UButton>
                </div>
              </div>
              <div class="grid gap-3 lg:grid-cols-3">
                <UInput
                  v-model="explainForm.ownerUid"
                  placeholder="ownerUid"
                />
                <UInput
                  v-model="explainForm.departmentCode"
                  placeholder="departmentCode"
                />
                <UInput
                  v-model="explainForm.projectCode"
                  placeholder="projectCode"
                />
              </div>
              <div
                v-if="explainResult"
                class="rounded-lg border border-default bg-muted px-4 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="explainDecisionColor"
                    variant="soft"
                  >
                    {{ reasonLabel(explainResult.reasonCode) }}
                  </UBadge>
                  <span class="text-xs text-muted">
                    selected roles: {{ explainResult.selectedRoleCodes.join(' / ') || 'none' }}
                  </span>
                </div>
                <div
                  v-if="explainResult.matchedGrant"
                  class="mt-3 text-sm"
                >
                  <p class="font-semibold text-highlighted">
                    {{ explainResult.matchedGrant.roleCode || 'unknown role' }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    {{ explainResult.matchedGrant.sourceType }} · {{ grantScopeText(explainResult.matchedGrant) }}
                  </p>
                </div>
                <div
                  v-else-if="explainResult.candidateGrants.length > 0"
                  class="mt-3 grid gap-2"
                >
                  <div
                    v-for="grant in explainResult.candidateGrants"
                    :key="grant.grantId"
                    class="rounded-lg border border-default bg-default px-3 py-2 text-sm"
                  >
                    {{ grant.roleCode || 'unknown role' }} · {{ grantScopeText(grant) }}
                  </div>
                </div>
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <h2 class="text-base font-semibold text-highlighted">
                有效权限
              </h2>
            </template>
            <div class="space-y-3">
              <div
                v-for="group in permissionGroups"
                :key="group.appCode"
                class="rounded-lg border border-default bg-default"
              >
                <div class="border-b border-default px-4 py-3">
                  <h3 class="font-semibold text-highlighted">
                    {{ group.appCode }}
                  </h3>
                </div>
                <div class="divide-y divide-default">
                  <button
                    v-for="permission in group.permissions"
                    :key="`${permission.appCode}:${permission.resourceCode}:${permission.action}`"
                    type="button"
                    class="w-full px-4 py-3 text-left hover:bg-muted"
                    @click="usePermissionForExplain(permission)"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-sm text-highlighted">
                        {{ permission.resourceCode }}:{{ permission.action }}
                      </span>
                      <UBadge
                        color="neutral"
                        variant="soft"
                      >
                        {{ permission.sources.length }} sources
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-xs text-muted">
                      {{ permissionSourceText(permission) }}
                    </p>
                  </button>
                </div>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
