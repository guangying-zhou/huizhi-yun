<script setup lang="ts">
import type { ApiResponse, Employee, ListResponse } from '~/types'
import { resolveEmployeeDepartmentCodes } from '~/utils/employeeDepartmentCodes'

interface DirectoryUsersResponse {
  items: Array<{ uid: string }>
  total: number
}

const route = useRoute()
const selectingAssignment = computed(() => route.query.select === 'assignment')
const { label, color, money, date } = usePeopleFormat()
const { ensurePeoplePermission } = usePeopleAuthorization()
const { confirm } = useConfirm()
const toast = useToast()
usePageTitle(computed(() => selectingAssignment.value ? '选择变更员工' : '员工'))

interface EmployeeArchiveImportResult {
  dry_run: boolean
  total: number
  matched: number
  skipped: number
  profiles_updated: number
  facts_updated: number
  onboard_backfilled: number
}

const archiveFileInput = ref<HTMLInputElement | null>(null)
const archiveImporting = ref(false)
const canImportArchive = ref(false)

const page = ref(1)
const pageSize = ref(20)
const { search: keyword, debounced: debouncedKeyword } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const status = ref('all')
const selectedDeptCode = ref('')
const departmentSlideoverOpen = ref(false)
const { tree: departmentTree, flat: departments, loading: departmentsLoading } = useAccountDepartments()
const selectedOrganization = computed(() => (
  departments.value.find(item => item.deptCode === selectedDeptCode.value) || null
))
const selectedCommitteeCode = computed(() => (
  selectedOrganization.value?.orgType === 'committee' ? selectedDeptCode.value : ''
))
const selectedDepartmentCodes = computed(() => {
  // With no filter, directory hydration must not retrigger an identical search.
  if (!selectedDeptCode.value) return []
  if (selectedCommitteeCode.value) return []
  return resolveEmployeeDepartmentCodes(departmentTree.value, selectedDeptCode.value, true)
})
const committeeMemberUids = ref<string[]>([])
const loadedCommitteeCode = ref('')
const committeeMembersLoading = ref(false)
const committeeMembersError = ref('')
let committeeLoadVersion = 0

watch([status, selectedDeptCode], () => {
  page.value = 1
})

async function loadCommitteeMembers(committeeCode: string) {
  const loadVersion = ++committeeLoadVersion
  committeeMemberUids.value = []
  loadedCommitteeCode.value = ''
  committeeMembersError.value = ''

  if (!committeeCode) {
    committeeMembersLoading.value = false
    return
  }

  committeeMembersLoading.value = true
  try {
    const memberUids: string[] = []
    const pageSize = 100
    let directoryPage = 1
    let total = 0
    let complete = false

    while (directoryPage <= 100) {
      const result = await $fetch<ApiResponse<DirectoryUsersResponse>>('/api/directory/users', {
        params: {
          dept_code: committeeCode,
          status: 'active',
          page: directoryPage,
          pageSize
        }
      })
      if (loadVersion !== committeeLoadVersion) return

      const items = result.data?.items || []
      total = Number(result.data?.total || 0)
      memberUids.push(...items.map(item => String(item.uid || '').trim()).filter(Boolean))

      if (items.length === 0 || memberUids.length >= total) {
        complete = true
        break
      }
      directoryPage += 1
    }
    if (!complete) throw new Error('委员会成员数量超过当前查询上限')

    if (loadVersion !== committeeLoadVersion) return
    committeeMemberUids.value = [...new Set(memberUids)]
    loadedCommitteeCode.value = committeeCode
  } catch (error) {
    if (loadVersion !== committeeLoadVersion) return
    committeeMembersError.value = syncErrorMessage(error)
  } finally {
    if (loadVersion === committeeLoadVersion) {
      committeeMembersLoading.value = false
    }
  }
}

watch(selectedCommitteeCode, loadCommitteeMembers, { immediate: true })

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '在职', value: 'active' },
  { label: '离职中', value: 'leaving' },
  { label: '已离职', value: 'left' }
]

const searchBody = computed(() => ({
  page: page.value,
  page_size: pageSize.value,
  keyword: debouncedKeyword.value || undefined,
  employment_status: status.value === 'all' ? undefined : status.value,
  dept_codes: selectedDepartmentCodes.value.length > 0
    ? selectedDepartmentCodes.value
    : undefined,
  employee_uids: selectedCommitteeCode.value
    ? (
        loadedCommitteeCode.value === selectedCommitteeCode.value && committeeMemberUids.value.length > 0
          ? committeeMemberUids.value
          : '__no_committee_members__'
      )
    : undefined
}))

const { data: response, error, refresh, status: fetchStatus } = await useLazyFetch<ApiResponse<ListResponse<Employee>>>('/api/v1/employees:search', {
  method: 'POST',
  body: searchBody,
  watch: [searchBody]
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(async () => {
  setRefresh(refresh)
  const authorization = await ensurePeoplePermission('employees', 'admin')
  canImportArchive.value = authorization.authorized
})
onBeforeUnmount(clearRefresh)

const employeesErrorAlert = computed(() => resolvePeopleApiErrorAlert(error.value, {
  fallbackTitle: '员工数据暂不可用'
}))
const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  avatar_text: avatarText(item),
  status_label: label(item.employment_status),
  onboard_display: date(item.onboard_date),
  cost_display: money(item.monthly_standard_cost)
})))

const total = computed(() => response.value?.data.total || 0)
const totalLabel = computed(() => rows.value.length < total.value ? `显示 ${rows.value.length} / ${total.value} 人` : `${total.value} 人`)
const selectedDepartmentName = computed(() => {
  if (!selectedDeptCode.value) return '全部部门'
  return selectedOrganization.value?.name || selectedDeptCode.value
})

const columns = [
  { accessorKey: 'display_name', header: '姓名' },
  { accessorKey: 'employee_no', header: '工号' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'dept_name', header: '部门' },
  { accessorKey: 'position_name', header: '岗位' },
  { accessorKey: 'rank_code', header: '职级' },
  { accessorKey: 'manager_uid', header: '直属负责人' },
  { accessorKey: 'onboard_display', header: '入职日期' },
  { accessorKey: 'cost_display', header: '月标准成本' }
]

function handleEmployeeSelect(_event: Event, row: { original: Employee }) {
  const path = `/employees/${encodeURIComponent(row.original.employee_uid)}`
  if (selectingAssignment.value) {
    navigateTo({
      path,
      query: { action: 'assignment' }
    })
    return
  }
  navigateTo(path)
}

function selectDepartment(deptCode: string, closeSlideover = false) {
  selectedDeptCode.value = deptCode
  if (closeSlideover) departmentSlideoverOpen.value = false
}

function avatarText(item: Employee) {
  return firstAvatarGlyph(item.display_name, item.initials, item.employee_uid)
}

function firstAvatarGlyph(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim()
    const glyph = Array.from(text).find(char => char.trim())
    if (!glyph) continue
    return /[a-z]/i.test(glyph) ? glyph.toUpperCase() : glyph
  }
  return '人'
}

function syncErrorMessage(error: unknown) {
  const payload = error as {
    data?: { message?: string }
    message?: string
  }
  return payload.data?.message || payload.message || '请稍后重试'
}

function chooseArchiveFile() {
  if (archiveImporting.value) return
  archiveFileInput.value?.click()
}

async function sendArchiveFile(file: File, dryRun: boolean) {
  const body = new FormData()
  body.append('file', file, file.name)
  body.append('dryRun', String(dryRun))
  const response = await $fetch<ApiResponse<EmployeeArchiveImportResult>>('/api/admin/employee-archive-import', {
    method: 'POST',
    body
  })
  return response.data
}

async function importEmployeeArchive(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || archiveImporting.value) return

  archiveImporting.value = true
  try {
    const preview = await sendArchiveFile(file, true)
    const accepted = await confirm({
      tone: preview.skipped > 0 ? 'warning' : 'default',
      title: '导入 OA 历史员工档案',
      message: `共 ${preview.total} 行，匹配 ${preview.matched} 人，跳过 ${preview.skipped} 人；预计写入 ${preview.facts_updated} 个 OA 来源字段、补充 ${preview.onboard_backfilled} 个入职日期。钉钉已有值不会被覆盖。`,
      confirmLabel: '确认导入'
    })
    if (!accepted) return

    const result = await sendArchiveFile(file, false)
    toast.add({
      title: 'OA 历史档案已导入',
      description: `匹配 ${result.matched} 人，写入 ${result.facts_updated} 个 OA 来源字段、补充 ${result.onboard_backfilled} 个入职日期，跳过 ${result.skipped} 人。`,
      color: result.skipped > 0 ? 'warning' : 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({ title: 'OA 历史档案导入失败', description: syncErrorMessage(error), color: 'error' })
  } finally {
    archiveImporting.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-employees"
    grow
  >
    <template #body>
      <div class="flex h-[calc(100dvh-4rem)] min-h-0 flex-col gap-4 overflow-hidden p-4">
        <UAlert
          v-if="selectingAssignment"
          color="primary"
          variant="soft"
          icon="i-lucide-user-round-search"
          title="选择需要变更任职的员工"
          description="可按姓名、工号、UID 或部门筛选；点击员工后将自动打开任职调整表单。"
        />

        <UAlert
          v-if="employeesErrorAlert"
          :color="employeesErrorAlert.color"
          variant="soft"
          :icon="employeesErrorAlert.icon"
          :title="employeesErrorAlert.title"
          :description="employeesErrorAlert.description"
        />

        <UAlert
          v-if="committeeMembersError"
          color="error"
          variant="soft"
          icon="i-lucide-users"
          title="委员会成员暂不可用"
          :description="committeeMembersError"
        />

        <UCard class="shrink-0">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-1 flex-col gap-2 sm:flex-row">
              <UInput
                v-model="keyword"
                icon="i-lucide-search"
                placeholder="搜索姓名 / 工号 / UID / 登录名"
                class="w-full sm:max-w-md"
              />
              <USelect
                v-model="status"
                :items="statusOptions"
                class="w-full sm:w-36"
              />
              <UButton
                :label="selectedDepartmentName"
                icon="i-lucide-network"
                color="neutral"
                variant="outline"
                class="w-full justify-start sm:w-auto lg:hidden"
                @click="departmentSlideoverOpen = true"
              />
            </div>
            <div class="flex items-center justify-between gap-2 sm:justify-end">
              <input
                ref="archiveFileInput"
                type="file"
                accept=".csv,text/csv"
                class="hidden"
                @change="importEmployeeArchive"
              >
              <UButton
                v-if="canImportArchive && !selectingAssignment"
                icon="i-lucide-file-up"
                color="neutral"
                variant="outline"
                :loading="archiveImporting"
                @click="chooseArchiveFile"
              >
                导入 OA 档案
              </UButton>
              <UButton
                v-if="selectingAssignment"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                to="/assignments"
              >
                取消选择
              </UButton>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ totalLabel }}
              </UBadge>
            </div>
          </div>
        </UCard>

        <div class="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <aside class="hidden w-64 shrink-0 overflow-hidden rounded-lg border border-default bg-default lg:block">
            <EmployeeDepartmentFilter
              :nodes="departmentTree"
              :loading="departmentsLoading"
              :selected-dept-code="selectedDeptCode"
              @select="selectDepartment"
            />
          </aside>

          <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <div class="min-h-0 flex-1 overflow-hidden rounded-lg border border-default bg-default">
              <div class="h-full overflow-auto">
                <div
                  v-if="fetchStatus === 'pending' || committeeMembersLoading"
                  class="flex h-full items-center justify-center gap-2 text-sm text-muted"
                >
                  <UIcon
                    name="i-lucide-loader-circle"
                    class="size-5 animate-spin"
                  />
                  正在加载员工...
                </div>
                <div
                  v-else-if="rows.length === 0"
                  class="flex h-full items-center justify-center p-6"
                >
                  <CommonEmptyState
                    icon="i-lucide-users-round"
                    title="暂无员工"
                    description="调整筛选条件，或使用迁移工具从 Console 初始化 People 员工。"
                  />
                </div>
                <UTable
                  v-else
                  :data="rows"
                  :columns="columns"
                  class="min-w-[1120px]"
                  :ui="selectableTableUi"
                  @select="handleEmployeeSelect"
                >
                  <template #display_name-cell="{ row }">
                    <div class="flex min-w-0 items-center gap-3">
                      <UAvatar
                        :text="row.original.avatar_text"
                        size="sm"
                        class="shrink-0"
                      />
                      <div class="min-w-0">
                        <p class="truncate font-medium">
                          {{ row.original.display_name }}
                        </p>
                        <p class="truncate text-xs text-muted">
                          {{ row.original.employee_uid }}
                        </p>
                      </div>
                    </div>
                  </template>
                  <template #status_label-cell="{ row }">
                    <UBadge
                      :color="color(row.original.employment_status)"
                      variant="soft"
                    >
                      {{ row.original.status_label }}
                    </UBadge>
                  </template>
                </UTable>
              </div>
            </div>

            <div
              v-if="total > 0"
              class="flex shrink-0 items-center justify-between"
            >
              <span class="text-sm text-muted">共 {{ total }} 人</span>
              <UPagination
                v-model:page="page"
                :items-per-page="pageSize"
                :total="total"
              />
            </div>
          </div>
        </div>
      </div>

      <USlideover
        v-model:open="departmentSlideoverOpen"
        title="按部门查看员工"
        description="部门包含下级部门员工；委员会按成员显示"
        :ui="{ content: 'max-w-sm' }"
      >
        <template #body>
          <EmployeeDepartmentFilter
            :nodes="departmentTree"
            :loading="departmentsLoading"
            :selected-dept-code="selectedDeptCode"
            @select="selectDepartment($event, true)"
          />
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
