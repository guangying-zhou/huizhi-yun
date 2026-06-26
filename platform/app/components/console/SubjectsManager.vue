<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, reactive, ref, watch } from 'vue'

interface SubjectItem {
  id: number
  tenantCode: string
  subjectType: string
  subjectCode: string
  displayName: string
  externalRef: string | null
  parentSubjectId: number | null
  status: string
}

interface SubjectMembershipItem {
  subjectId: number
  containerSubjectId: number
  relationType: string
  isPrimary: boolean
  status: string
}

interface SubjectsResponse {
  items: SubjectItem[]
  memberships?: SubjectMembershipItem[]
  total: number
  page: number
  pageSize: number
}

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface AssignableRoleItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  source: string
  sourceRoleCode: string | null
  status: string
  permissionCount: number
}

interface AssignableRoleResponse {
  items: AssignableRoleItem[]
  total: number
}

interface SubjectRoleItem {
  id: number
  subjectId: number
  subjectType: string
  subjectCode: string
  subjectDisplayName: string
  roleId: number
  roleCode: string
  roleName: string
  appCode: string | null
  roleSource: string
  sourceType: string
  sourceId: string | null
  grantedByUid: string | null
  grantedAt: string
  expiredAt: string | null
  active: boolean
}

interface SubjectRoleResponse {
  items: SubjectRoleItem[]
  total: number
}

interface SubjectTreeRow extends SubjectItem {
  key: string
  membershipContainerId: number | null
  membershipRelationType: string | null
  membershipIsPrimary: boolean
  children?: SubjectTreeRow[]
}

const props = withDefaults(defineProps<{
  scope?: 'admin' | 'dashboard'
}>(), {
  scope: 'dashboard'
})

const { currentTenantCode, setCurrentTenantCode } = useTenantContext()
const allFilterValue = '__all__'

const query = reactive({
  tenantCode: props.scope === 'dashboard' ? currentTenantCode.value : '',
  subjectType: allFilterValue,
  status: 'active',
  keyword: ''
})

const subjects = ref<SubjectItem[]>([])
const memberships = ref<SubjectMembershipItem[]>([])
const assignableRoles = ref<AssignableRoleItem[]>([])
const subjectRoleAssignments = ref<SubjectRoleItem[]>([])
const total = ref(0)
const expanded = ref<true | Record<string, boolean>>(true)
const pending = ref(false)
const rolesPending = ref(false)
const assignmentsPending = ref(false)
const roleSaving = ref(false)
const roleModalOpen = ref(false)
const error = ref('')
const success = ref('')
const activeId = ref<number | null>(null)

const roleForm = reactive({
  roleIds: [] as string[],
  expiredAt: ''
})

const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '暂停', value: 'suspended' },
  { label: '禁用', value: 'disabled' }
]

const subjectTypeOptions = [
  { label: '用户', value: 'user' },
  { label: '部门', value: 'department' },
  { label: '职位', value: 'job' }
]

function displaySubjectType(value: string) {
  return subjectTypeOptions.find(option => option.value === value)?.label ?? value
}

function displaySubjectStatus(value: string) {
  return statusOptions.find(option => option.value === value)?.label ?? value
}

const subjectColumns: TableColumn<SubjectTreeRow>[] = [
  {
    accessorKey: 'displayName',
    header: '主体'
  },
  {
    accessorKey: 'subjectType',
    header: '类型'
  },
  {
    id: 'parent',
    header: '父节点'
  },
  {
    accessorKey: 'externalRef',
    header: '外部标识'
  },
  {
    accessorKey: 'status',
    header: '状态'
  },
  {
    id: 'actions',
    header: '操作'
  }
]

const activeSubject = computed(() => subjects.value.find(item => item.id === activeId.value) || null)
const effectiveTenantCode = computed(() => props.scope === 'dashboard' ? currentTenantCode.value : query.tenantCode)
const apiPrefix = computed(() => props.scope === 'dashboard' ? '/api/platform/tenant-admin' : '/api/platform/ops')
const subjectTypeFilterOptions = computed(() => [
  { label: '全部类型', value: allFilterValue },
  ...subjectTypeOptions
])
const statusFilterOptions = computed(() => [
  { label: '全部状态', value: allFilterValue },
  ...statusOptions
])
const subjectById = computed(() => new Map(subjects.value.map(item => [item.id, item])))
const roleOptions = computed(() => assignableRoles.value.map(role => ({
  label: `${role.roleName} (${role.appCode || '全局'} / ${role.roleCode})`,
  value: String(role.id)
})))
const activeRoleCount = computed(() => subjectRoleAssignments.value.filter(item => item.active).length)
const visibleUniqueSubjectCount = computed(() => {
  const ids = new Set<number>()
  collectTreeRows(subjectTreeRows.value).forEach(item => ids.add(item.id))
  return ids.size
})

const subjectTreeRows = computed(() => {
  const nodeMap = new Map<number, SubjectTreeRow>()

  for (const subject of subjects.value) {
    nodeMap.set(subject.id, createTreeRow(subject, `subject-${subject.id}`))
  }

  const rows: SubjectTreeRow[] = []
  const membershipSubjectIds = new Set<number>()

  for (const subject of subjects.value) {
    const node = nodeMap.get(subject.id)
    if (!node || subject.subjectType === 'user') continue

    const parent = subject.parentSubjectId ? nodeMap.get(subject.parentSubjectId) : null
    if (parent && parent.id !== subject.id) {
      parent.children ||= []
      parent.children.push(node)
    } else {
      rows.push(node)
    }
  }

  for (const membership of memberships.value) {
    if (membership.status && membership.status !== 'active') continue

    const subject = subjectById.value.get(membership.subjectId)
    const container = nodeMap.get(membership.containerSubjectId)
    if (!subject || !container || subject.id === container.id) continue

    membershipSubjectIds.add(subject.id)
    container.children ||= []
    container.children.push({
      ...createTreeRow(subject, `membership-${membership.containerSubjectId}-${subject.id}`),
      membershipContainerId: membership.containerSubjectId,
      membershipRelationType: membership.relationType,
      membershipIsPrimary: membership.isPrimary
    })
  }

  for (const subject of subjects.value) {
    if (subject.subjectType !== 'user' || membershipSubjectIds.has(subject.id)) continue

    const node = nodeMap.get(subject.id)
    if (!node) continue

    const parent = subject.parentSubjectId ? nodeMap.get(subject.parentSubjectId) : null
    if (parent && parent.id !== subject.id) {
      parent.children ||= []
      parent.children.push(node)
    } else {
      rows.push(node)
    }
  }

  sortTreeRows(rows)
  return filterTreeRows(rows)
})

function createTreeRow(subject: SubjectItem, key: string): SubjectTreeRow {
  return {
    ...subject,
    key,
    membershipContainerId: null,
    membershipRelationType: null,
    membershipIsPrimary: false,
    children: []
  }
}

function collectTreeRows(rows: SubjectTreeRow[]) {
  const result: SubjectTreeRow[] = []

  function collect(items: SubjectTreeRow[]) {
    for (const item of items) {
      result.push(item)
      if (item.children?.length) {
        collect(item.children)
      }
    }
  }

  collect(rows)
  return result
}

function getSubjectSubRows(row: SubjectTreeRow) {
  return row.children || []
}

function normalizeFilterValue(value: string) {
  return value === allFilterValue ? undefined : value || undefined
}

function isCommitteeSubject(subject: Pick<SubjectItem, 'subjectType' | 'subjectCode' | 'displayName' | 'externalRef'>) {
  if (subject.subjectType === 'committee') return true
  if (subject.subjectType !== 'department') return false

  const searchable = [
    subject.subjectCode,
    subject.displayName,
    subject.externalRef || ''
  ].join(' ').toLowerCase()

  return searchable.includes('committee') || searchable.includes('委员会')
}

function subjectMatchesFilters(subject: SubjectItem) {
  const subjectType = normalizeFilterValue(query.subjectType)
  const status = normalizeFilterValue(query.status)
  const keyword = query.keyword.trim().toLowerCase()

  if (subjectType && subject.subjectType !== subjectType) return false
  if (status && subject.status !== status) return false
  if (!keyword) return true

  return [
    subject.subjectCode,
    subject.displayName,
    subject.externalRef || ''
  ].some(value => value.toLowerCase().includes(keyword))
}

function filterTreeRows(rows: SubjectTreeRow[]): SubjectTreeRow[] {
  const filtered: SubjectTreeRow[] = []

  for (const row of rows) {
    const children = filterTreeRows(row.children || [])
    if (!subjectMatchesFilters(row) && children.length === 0) continue

    filtered.push({
      ...row,
      children
    })
  }

  return filtered
}

function sortTreeRows(rows: SubjectTreeRow[]) {
  rows.sort((left, right) => {
    const typeCompare = subjectTypeRank(left.subjectType) - subjectTypeRank(right.subjectType)
    if (typeCompare !== 0) return typeCompare
    return left.subjectCode.localeCompare(right.subjectCode)
  })

  for (const row of rows) {
    if (row.children?.length) {
      sortTreeRows(row.children)
    }
  }
}

function subjectTypeRank(type: string) {
  if (type === 'department') return 1
  if (type === 'job') return 2
  if (type === 'user') return 3
  return 9
}

function subjectTypeColor(type: string) {
  if (type === 'user') return 'success'
  if (type === 'department') return 'info'
  if (type === 'job') return 'warning'
  return 'neutral'
}

function statusColor(status: string) {
  if (status === 'active') return 'success'
  if (status === 'suspended') return 'warning'
  if (status === 'disabled') return 'neutral'
  return 'neutral'
}

function isCommitteeShadowDepartment(subject: SubjectItem, committeeCodes: Set<string>) {
  return subject.subjectType === 'department' && committeeCodes.has(subject.subjectCode)
}

function relationLabel(row: SubjectTreeRow) {
  if (row.membershipContainerId) {
    const container = subjectById.value.get(row.membershipContainerId)
    const relation = row.membershipRelationType || 'member'
    const primary = row.membershipIsPrimary ? 'primary' : 'member'
    return `${container?.displayName || row.membershipContainerId} / ${relation} / ${primary}`
  }

  if (!row.parentSubjectId) return '根节点'

  const parent = subjectById.value.get(row.parentSubjectId)
  return parent ? `${parent.subjectCode}` : `parent#${row.parentSubjectId}`
}

function resetActiveRoleState() {
  activeId.value = null
  roleForm.roleIds = []
  roleForm.expiredAt = ''
  subjectRoleAssignments.value = []
}

async function openRoleModal(item: SubjectItem) {
  if (item.subjectType !== 'user') return

  error.value = ''
  success.value = ''
  activeId.value = item.id
  roleForm.roleIds = []
  roleForm.expiredAt = ''
  roleModalOpen.value = true

  await Promise.all([
    loadAssignableRoles(),
    loadSubjectRoleAssignments(item.id)
  ])
}

function errorMessage(caught: unknown, fallback: string) {
  if (caught instanceof Error) return caught.message || fallback
  return fallback
}

async function loadSubjects() {
  const tenantCode = effectiveTenantCode.value.trim()
  if (!tenantCode) {
    subjects.value = []
    memberships.value = []
    subjectRoleAssignments.value = []
    total.value = 0
    return
  }

  pending.value = true
  error.value = ''

  try {
    const response = await platformFetchJson<{ data: SubjectsResponse }>(`${apiPrefix.value}/subjects`, {
      query: {
        tenantCode,
        all: 'true'
      }
    })

    const committeeCodes = new Set(
      response.data.items
        .filter(item => item.subjectType === 'committee')
        .map(item => item.subjectCode)
    )
    const nextSubjects = response.data.items.filter(item =>
      !isCommitteeSubject(item) && !isCommitteeShadowDepartment(item, committeeCodes)
    )
    const nextSubjectIds = new Set(nextSubjects.map(item => item.id))

    subjects.value = nextSubjects
    memberships.value = (response.data.memberships || []).filter(item =>
      nextSubjectIds.has(item.subjectId) && nextSubjectIds.has(item.containerSubjectId)
    )
    total.value = nextSubjects.length

    if (activeId.value !== null) {
      const current = nextSubjects.find(item => item.id === activeId.value)
      if (current) {
        if (roleModalOpen.value) {
          await loadSubjectRoleAssignments(current.id)
        }
      } else {
        resetActiveRoleState()
        roleModalOpen.value = false
      }
    }
  } catch (caught) {
    error.value = errorMessage(caught, '加载主体列表失败')
  } finally {
    pending.value = false
  }
}

async function loadAssignableRoles() {
  const tenantCode = effectiveTenantCode.value.trim()
  if (!tenantCode) {
    assignableRoles.value = []
    return
  }

  rolesPending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<AssignableRoleResponse>>('/api/platform/tenant-admin/assignable-roles', {
      query: {
        tenantCode,
        page: 1,
        pageSize: 500
      }
    })
    assignableRoles.value = response.data.items
  } catch (caught) {
    error.value = errorMessage(caught, '加载可分配角色失败')
    assignableRoles.value = []
  } finally {
    rolesPending.value = false
  }
}

async function loadSubjectRoleAssignments(subjectId: number) {
  const tenantCode = effectiveTenantCode.value.trim()
  if (!tenantCode) {
    subjectRoleAssignments.value = []
    return
  }

  assignmentsPending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SubjectRoleResponse>>('/api/platform/tenant-admin/subject-roles', {
      query: {
        tenantCode,
        subjectId,
        includeExpired: 'true',
        page: 1,
        pageSize: 500
      }
    })
    subjectRoleAssignments.value = response.data.items
  } catch (caught) {
    error.value = errorMessage(caught, '加载用户角色授权失败')
    subjectRoleAssignments.value = []
  } finally {
    assignmentsPending.value = false
  }
}

async function assignRoleToActiveSubject() {
  const tenantCode = effectiveTenantCode.value.trim()
  const subject = activeSubject.value
  const roleIds = roleForm.roleIds
    .map(value => Number(value || 0))
    .filter(value => Number.isInteger(value) && value > 0)

  if (!tenantCode || !subject || subject.subjectType !== 'user' || roleIds.length === 0) {
    error.value = '请先选择用户和至少一个角色'
    return
  }

  roleSaving.value = true
  error.value = ''
  success.value = ''

  try {
    const results = await Promise.allSettled(roleIds.map(roleId => $fetch('/api/platform/tenant-admin/subject-roles', {
      method: 'POST',
      body: {
        tenantCode,
        subjectType: 'user',
        subjectId: subject.id,
        roleId,
        expiredAt: roleForm.expiredAt || null
      }
    })))

    const failed = results.filter(result => result.status === 'rejected')
    const succeeded = results.length - failed.length

    roleForm.roleIds = []
    roleForm.expiredAt = ''
    if (failed.length > 0) {
      const firstError = failed[0] as PromiseRejectedResult
      error.value = `已授予 ${succeeded} 个角色，${failed.length} 个失败：${errorMessage(firstError.reason, '授予角色失败')}`
    } else {
      success.value = `已授予 ${succeeded} 个角色`
    }
    await loadSubjectRoleAssignments(subject.id)
  } catch (caught) {
    error.value = errorMessage(caught, '授予角色失败')
  } finally {
    roleSaving.value = false
  }
}

async function revokeRoleAssignment(item: SubjectRoleItem) {
  const subject = activeSubject.value
  if (!subject) return

  roleSaving.value = true
  error.value = ''
  success.value = ''

  try {
    await $fetch(`/api/platform/tenant-admin/subject-roles/${item.id}`, {
      method: 'DELETE',
      query: {
        tenantCode: effectiveTenantCode.value.trim()
      }
    })
    success.value = `${item.roleName} 已撤销`
    await loadSubjectRoleAssignments(subject.id)
  } catch (caught) {
    error.value = errorMessage(caught, '撤销角色失败')
  } finally {
    roleSaving.value = false
  }
}

watch(() => currentTenantCode.value, (value) => {
  if (props.scope === 'dashboard') {
    query.tenantCode = value
  }
})

watch(() => effectiveTenantCode.value, async (value) => {
  if (props.scope === 'dashboard' && value) {
    setCurrentTenantCode(value)
  }

  resetActiveRoleState()
  assignableRoles.value = []
  await loadSubjects()
}, { immediate: true })
</script>

<template>
  <UDashboardPanel
    :id="`${scope}-subjects-manager`"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              主体目录
            </h1>
            <p class="mt-1 text-sm text-muted">
              企业的人员、部门与职位目录；可在此为用户分配角色权限。
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              color="neutral"
              variant="soft"
            >
              {{ visibleUniqueSubjectCount }} / {{ total }} 条
            </UBadge>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-refresh-cw"
              :loading="pending"
              @click="loadSubjects"
            >
              刷新
            </UButton>
          </div>
        </div>
      </section>

      <section class="space-y-4">
        <UCard>
          <template #header>
            <div class="space-y-3">
              <div class="grid gap-3 md:grid-cols-5">
                <label
                  v-if="scope === 'admin'"
                  class="tenant-field md:col-span-2"
                >
                  <span class="tenant-field__label">企业编码</span>
                  <UInput
                    v-model="query.tenantCode"
                    placeholder="输入企业编码"
                    @keyup.enter="loadSubjects"
                  />
                </label>
                <label class="tenant-field">
                  <span class="tenant-field__label">类型</span>
                  <USelect
                    v-model="query.subjectType"
                    :items="subjectTypeFilterOptions"
                  />
                </label>
                <label class="tenant-field">
                  <span class="tenant-field__label">状态</span>
                  <USelect
                    v-model="query.status"
                    :items="statusFilterOptions"
                  />
                </label>
                <label class="tenant-field md:col-span-3">
                  <span class="tenant-field__label">关键字</span>
                  <UInput
                    v-model="query.keyword"
                    icon="i-lucide-search"
                    placeholder="按编码、名称或外部标识搜索"
                  />
                </label>
              </div>
            </div>
          </template>

          <UAlert
            v-if="error"
            class="mb-4"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="error"
          />

          <UAlert
            v-if="success"
            class="mb-4"
            color="success"
            variant="soft"
            icon="i-lucide-circle-check"
            :title="success"
          />

          <UTable
            v-model:expanded="expanded"
            :data="subjectTreeRows"
            :columns="subjectColumns"
            :get-sub-rows="getSubjectSubRows"
            :loading="pending"
            sticky
            class="w-full"
            :ui="{
              root: 'w-full',
              base: 'min-w-[1080px] border-separate border-spacing-0',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              tr: 'group',
              th: 'text-xs font-semibold text-muted',
              td: 'align-middle empty:p-0 group-has-[td:not(:empty)]:border-b border-default'
            }"
          >
            <template #displayName-cell="{ row }">
              <div
                class="flex min-w-[260px] items-center gap-2"
                :style="{ paddingLeft: `${row.depth * 1.25}rem` }"
              >
                <UButton
                  :class="row.getCanExpand() ? '' : 'invisible'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  :icon="row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  @click.stop="row.toggleExpanded()"
                />
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-highlighted">
                    {{ row.original.subjectCode }}
                  </p>
                </div>
              </div>
            </template>

            <template #subjectType-cell="{ row }">
              <UBadge
                :color="subjectTypeColor(row.original.subjectType)"
                variant="soft"
              >
                {{ displaySubjectType(row.original.subjectType) }}
              </UBadge>
            </template>

            <template #externalRef-cell="{ row }">
              <span class="text-xs text-muted">
                {{ row.original.externalRef || '未设置' }}
              </span>
            </template>

            <template #status-cell="{ row }">
              <UBadge
                :color="statusColor(row.original.status)"
                variant="soft"
              >
                {{ displaySubjectStatus(row.original.status) }}
              </UBadge>
            </template>

            <template #parent-cell="{ row }">
              <span class="text-xs text-muted">
                {{ relationLabel(row.original) }}
              </span>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex justify-end gap-2">
                <UButton
                  v-if="row.original.subjectType === 'user'"
                  color="primary"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-shield-check"
                  @click="openRoleModal(row.original)"
                >
                  角色授权
                </UButton>
                <span
                  v-else
                  class="text-xs text-dimmed"
                >
                  容器
                </span>
              </div>
            </template>

            <template #empty>
              <div class="px-4 py-10 text-center text-sm text-muted">
                当前筛选下没有主体记录。
              </div>
            </template>
          </UTable>
        </UCard>
      </section>

      <UModal
        v-model:open="roleModalOpen"
        title="用户角色授权"
        :description="activeSubject ? `${displaySubjectType(activeSubject.subjectType)} · ${activeSubject.subjectCode}` : ''"
        :ui="{ content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="space-y-4">
            <div
              v-if="!activeSubject"
              class="rounded-lg border border-dashed border-default bg-muted px-4 py-8 text-center text-sm text-muted"
            >
              请先选择一个用户主体。
            </div>

            <template v-else>
              <div class="rounded-lg border border-default bg-default p-4">
                <form
                  class="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]"
                  @submit.prevent="assignRoleToActiveSubject"
                >
                  <UFormField
                    label="角色"
                    required
                  >
                    <USelect
                      v-model="roleForm.roleIds"
                      class="w-full"
                      :items="roleOptions"
                      :loading="rolesPending"
                      multiple
                      placeholder="选择一个或多个可分配角色"
                    />
                  </UFormField>

                  <UFormField label="过期时间">
                    <UInput
                      v-model="roleForm.expiredAt"
                      class="w-full"
                      type="datetime-local"
                    />
                  </UFormField>

                  <div class="flex items-end">
                    <UButton
                      type="submit"
                      color="primary"
                      icon="i-lucide-plus"
                      :loading="roleSaving"
                      :disabled="roleForm.roleIds.length === 0 || rolesPending"
                    >
                      授予角色
                    </UButton>
                  </div>
                </form>

                <div
                  v-if="!rolesPending && roleOptions.length === 0"
                  class="mt-4 rounded-lg border border-dashed border-default bg-muted px-4 py-5 text-center text-sm text-muted"
                >
                  当前租户暂无可分配角色，请先在授权分配页启用全局角色。
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <h2 class="text-sm font-semibold text-highlighted">
                    已授权角色
                  </h2>
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ activeRoleCount }} 个生效
                  </UBadge>
                </div>

                <div
                  v-if="assignmentsPending"
                  class="rounded-lg border border-default bg-muted px-4 py-6 text-center text-sm text-muted"
                >
                  正在加载角色授权...
                </div>

                <div
                  v-for="item in subjectRoleAssignments"
                  :key="item.id"
                  class="rounded-lg border border-default bg-default px-4 py-3"
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 space-y-1">
                      <p class="text-sm font-semibold text-highlighted">
                        {{ item.roleName }}
                      </p>
                      <p class="text-xs text-muted">
                        {{ item.appCode || '全局' }} / {{ item.roleCode }}
                      </p>
                      <p class="text-xs text-muted">
                        授权时间 {{ item.grantedAt }}<span v-if="item.expiredAt">，到期 {{ item.expiredAt }}</span>
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <UBadge
                        :color="item.active ? 'success' : 'neutral'"
                        variant="soft"
                      >
                        {{ item.active ? '生效中' : '已过期' }}
                      </UBadge>
                      <UButton
                        v-if="item.active"
                        color="error"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-ban"
                        :loading="roleSaving"
                        @click="revokeRoleAssignment(item)"
                      >
                        撤销
                      </UButton>
                    </div>
                  </div>
                </div>

                <div
                  v-if="!assignmentsPending && subjectRoleAssignments.length === 0"
                  class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
                >
                  当前用户还没有角色授权。
                </div>
              </div>
            </template>
          </div>
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="roleSaving"
            @click="roleModalOpen = false"
          >
            关闭
          </UButton>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
