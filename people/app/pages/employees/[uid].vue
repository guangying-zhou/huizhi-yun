<script setup lang="ts">
import type { ApiResponse, Assignment, Employee, EmployeeProfile, ListResponse, StandardCostRate } from '~/types'

const route = useRoute()
const uid = computed(() => String(route.params.uid || ''))
const { label, color, money, date } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()
const editOpen = ref(false)
const savingEdit = ref(false)
const assignmentOpen = ref(false)
const savingAssignment = ref(false)
const canEditSensitiveCostFields = ref(false)

const editForm = reactive({
  employeeNo: '',
  displayName: '',
  loginName: '',
  employmentStatus: 'active',
  employmentType: 'full_time',
  deptCode: '',
  deptName: '',
  positionCode: '',
  positionName: '',
  rankCode: '',
  rankName: '',
  managerUid: '',
  onboardDate: '',
  leaveDate: '',
  workLocation: '',
  costCenterCode: '',
  monthlyStandardCost: '0'
})

const statusOptions = [
  { label: '在职', value: 'active' },
  { label: '离职中', value: 'leaving' },
  { label: '已离职', value: 'left' },
  { label: '停用', value: 'inactive' }
]

const employmentTypeOptions = [
  { label: '全职', value: 'full_time' },
  { label: '兼职', value: 'part_time' },
  { label: '外包/顾问', value: 'outsourced' },
  { label: '实习', value: 'intern' },
  { label: 'AI Agent', value: 'agent' }
]

const assignmentTypeOptions = [
  { label: '调级', value: 'rank_change' },
  { label: '调岗', value: 'transfer' },
  { label: '离职', value: 'leave' }
]

const assignmentForm = reactive({
  changeType: 'rank_change',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  deptCode: '',
  deptName: '',
  positionCode: '',
  positionName: '',
  rankSeries: 'P',
  rankCode: '',
  rankName: '',
  managerUid: '',
  monthlyStandardCost: '0',
  remarks: ''
})

const { data: response, error, refresh } = await useFetch<ApiResponse<EmployeeProfile>>(() => `/api/v1/employees/${uid.value}/profile`, {
  watch: [uid]
})

const { data: standardCostResponse, error: standardCostError, refresh: refreshStandardCosts } = await useFetch<ApiResponse<ListResponse<StandardCostRate>>>('/api/v1/standard-costs', {
  query: {
    page: 1,
    page_size: 100
  }
})

const profile = computed(() => response.value?.data)
const employee = computed(() => profile.value?.employee)
const employeeAvatarText = computed(() => avatarText(employee.value))
const standardCostRows = computed(() => (standardCostResponse.value?.data.items || []).filter(item => Boolean(textValue(item.rank_code)) && item.enabled !== false && item.enabled !== 0))
const latestRankRates = computed(() => {
  const byRankCode = new Map<string, StandardCostRate>()
  for (const item of standardCostRows.value) {
    const rankCode = textValue(item.rank_code).toUpperCase()
    if (!rankCode) continue

    const existing = byRankCode.get(rankCode)
    if (!existing || dateValue(item.effective_from) > dateValue(existing.effective_from)) {
      byRankCode.set(rankCode, item)
    }
  }

  return Array.from(byRankCode.values()).sort((left, right) => {
    const leftSeries = textValue(left.rank_series)
    const rightSeries = textValue(right.rank_series)
    if (leftSeries !== rightSeries) return leftSeries === 'M' ? -1 : 1
    return numberValue(left.rank_level) - numberValue(right.rank_level)
  })
})
const rankSeriesOptions = computed(() => {
  const seriesValues = Array.from(new Set(latestRankRates.value.map(item => textValue(item.rank_series)).filter(Boolean)))
  const values = seriesValues.length ? seriesValues : ['P', 'M']
  return values.sort((left, right) => (left === 'M' ? -1 : 1) - (right === 'M' ? -1 : 1)).map(value => ({
    label: value === 'M' ? '管理 M' : '专业 P',
    value
  }))
})
const rankOptions = computed(() => latestRankRates.value
  .filter(item => textValue(item.rank_series) === assignmentForm.rankSeries)
  .map(item => ({
    label: `${textValue(item.rank_code)} · ${textValue(item.rank_name) || textValue(item.rate_name)}`,
    value: textValue(item.rank_code)
  })))
const selectedRankRate = computed(() => latestRankRates.value.find(item => textValue(item.rank_code) === assignmentForm.rankCode))

const assignmentRows = computed(() => (profile.value?.assignments || []).map(item => ({
  ...item,
  change_label: label(item.change_type),
  approval_label: label(item.approval_status),
  effective_period: `${date(item.effective_from)} ~ ${date(item.effective_to) === '-' ? '至今' : date(item.effective_to)}`
})))

const costRows = computed(() => (profile.value?.cost_snapshots || []).map(item => ({
  ...item,
  standard_display: money(item.standard_cost),
  actual_display: money(item.actual_cost)
})))

const contributionRows = computed(() => (profile.value?.project_contributions || []).map(item => ({
  ...item,
  score_display: Number(item.contribution_score || 0).toFixed(0)
})))

const cycleRows = computed(() => (profile.value?.performance_cycles || []).map(item => ({
  ...item,
  period: `${date(item.period_start)} ~ ${date(item.period_end)}`,
  status_label: label(item.status)
})))

const documentRows = computed(() => profile.value?.documents || [])

const assignmentColumns = [
  { accessorKey: 'change_label', header: '类型' },
  { accessorKey: 'position_name', header: '岗位' },
  { accessorKey: 'rank_code', header: '职级' },
  { accessorKey: 'dept_name', header: '部门' },
  { accessorKey: 'manager_uid', header: '负责人' },
  { accessorKey: 'effective_period', header: '期间' },
  { accessorKey: 'approval_label', header: '审批' }
]

const costColumns = [
  { accessorKey: 'period_month', header: '月份' },
  { accessorKey: 'standard_display', header: '标准成本' },
  { accessorKey: 'actual_display', header: '实际成本' },
  { accessorKey: 'cost_source', header: '来源' }
]

const contributionColumns = [
  { accessorKey: 'cycle_code', header: '周期' },
  { accessorKey: 'project_code', header: '项目' },
  { accessorKey: 'role_code', header: '角色' },
  { accessorKey: 'work_hours', header: '工时' },
  { accessorKey: 'score_display', header: '贡献分' },
  { accessorKey: 'source_app', header: '来源' }
]

const cycleColumns = [
  { accessorKey: 'cycle_name', header: '绩效周期' },
  { accessorKey: 'period', header: '期间' },
  { accessorKey: 'status_label', header: '状态' }
]

const documentColumns = [
  { accessorKey: 'document_title', header: '文档' },
  { accessorKey: 'document_type', header: '类型' },
  { accessorKey: 'document_uuid', header: 'UUID' },
  { accessorKey: 'source_biz_type', header: '来源' }
]

function handleRefresh() {
  refresh()
}

function textValue(value: unknown) {
  return String(value || '').trim()
}

function dateValue(value: unknown) {
  return textValue(value).slice(0, 10)
}

function numberValue(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount : 0
}

function firstGlyph(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim()
    const glyph = Array.from(text).find(char => char.trim())
    if (glyph) return glyph
  }
  return '人'
}

function avatarText(item: Employee | null | undefined) {
  return firstGlyph(item?.display_name, item?.initials, item?.employee_uid)
}

function fillEditForm(item: Employee) {
  editForm.employeeNo = textValue(item.employee_no)
  editForm.displayName = textValue(item.display_name)
  editForm.loginName = textValue(item.login_name)
  editForm.employmentStatus = textValue(item.employment_status) || 'active'
  editForm.employmentType = textValue(item.employment_type) || 'full_time'
  editForm.deptCode = textValue(item.dept_code)
  editForm.deptName = textValue(item.dept_name)
  editForm.positionCode = textValue(item.position_code)
  editForm.positionName = textValue(item.position_name)
  editForm.rankCode = textValue(item.rank_code)
  editForm.rankName = textValue(item.rank_name)
  editForm.managerUid = textValue(item.manager_uid)
  editForm.onboardDate = dateValue(item.onboard_date)
  editForm.leaveDate = dateValue(item.leave_date)
  editForm.workLocation = textValue(item.work_location)
  editForm.costCenterCode = textValue(item.cost_center_code)
  editForm.monthlyStandardCost = textValue(item.monthly_standard_cost) || '0'
}

function rankSeriesFromCode(rankCode?: string | null) {
  const value = textValue(rankCode).toUpperCase()
  if (value.startsWith('M')) return 'M'
  if (value.startsWith('P')) return 'P'
  return ''
}

function previousDate(value: string) {
  const dateValue = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(dateValue.getTime())) return value
  dateValue.setUTCDate(dateValue.getUTCDate() - 1)
  return dateValue.toISOString().slice(0, 10)
}

function assignmentEndDate(item: Assignment, nextEffectiveFrom: string) {
  const endDate = previousDate(nextEffectiveFrom)
  const startDate = dateValue(item.effective_from)
  return startDate && startDate > endDate ? nextEffectiveFrom : endDate
}

function syncSelectedRank() {
  const selected = selectedRankRate.value
  if (!selected) return

  assignmentForm.rankCode = textValue(selected.rank_code)
  assignmentForm.rankName = textValue(selected.rank_name)
  assignmentForm.monthlyStandardCost = textValue(selected.monthly_standard_cost) || '0'
}

function ensureRankSelection() {
  if (assignmentForm.changeType !== 'rank_change') return

  const options = rankOptions.value
  const hasCurrentOption = options.some(option => option.value === assignmentForm.rankCode)
  if (!hasCurrentOption && options[0]) {
    assignmentForm.rankCode = options[0].value
  }
  syncSelectedRank()
}

function fillAssignmentForm(item: Employee) {
  assignmentForm.changeType = 'rank_change'
  assignmentForm.effectiveFrom = new Date().toISOString().slice(0, 10)
  assignmentForm.deptCode = textValue(item.dept_code)
  assignmentForm.deptName = textValue(item.dept_name)
  assignmentForm.positionCode = textValue(item.position_code)
  assignmentForm.positionName = textValue(item.position_name)
  assignmentForm.rankSeries = rankSeriesFromCode(item.rank_code) || rankSeriesOptions.value[0]?.value || 'P'
  assignmentForm.rankCode = textValue(item.rank_code)
  assignmentForm.rankName = textValue(item.rank_name)
  assignmentForm.managerUid = textValue(item.manager_uid)
  assignmentForm.monthlyStandardCost = textValue(item.monthly_standard_cost) || '0'
  assignmentForm.remarks = ''
  ensureRankSelection()
}

function editErrorMessage(error: unknown) {
  const payload = error as { data?: { message?: string }, message?: string }
  return payload.data?.message || payload.message || '请稍后重试'
}

function shouldDisableConsoleUser(status: unknown) {
  return ['left', 'inactive'].includes(textValue(status))
}

async function disableConsoleUserForOffboarding(input: {
  employeeUid: string
  activeRoleCode?: string | null
  operatorUid?: string | null
  leaveDate?: string | null
}) {
  return await $fetch<ApiResponse<Record<string, unknown>>>(
    peopleApiPath(`/api/admin/directory-users/${encodeURIComponent(input.employeeUid)}/disable`),
    {
      method: 'POST',
      body: {
        activeRoleCode: input.activeRoleCode || undefined,
        operatorUid: input.operatorUid || undefined,
        leaveDate: input.leaveDate || undefined,
        reason: 'people_offboarding'
      }
    }
  )
}

async function openEdit() {
  if (!employee.value) return

  const authorization = await ensurePeoplePermission('employees', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要员工编辑权限后才能维护员工事实。',
      color: 'warning'
    })
    return
  }

  const standardCostAuthorization = await ensurePeoplePermission('standard_costs', 'admin')
  canEditSensitiveCostFields.value = standardCostAuthorization.authorized
  fillEditForm(employee.value)
  editOpen.value = true
}

async function saveEdit() {
  if (savingEdit.value || !employee.value) return

  if (!editForm.displayName.trim() || !editForm.employeeNo.trim()) {
    toast.add({
      title: '请补齐员工信息',
      description: '姓名和工号为必填项。',
      color: 'warning'
    })
    return
  }

  const authorization = await ensurePeoplePermission('employees', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要员工编辑权限后才能维护员工事实。',
      color: 'warning'
    })
    return
  }

  savingEdit.value = true
  try {
    const nextEmploymentStatus = editForm.employmentStatus
    let consoleDisableWarning = ''

    const body: Record<string, unknown> = {
      employee_no: editForm.employeeNo.trim(),
      display_name: editForm.displayName.trim(),
      initials: firstGlyph(editForm.displayName, editForm.employeeNo),
      login_name: editForm.loginName.trim(),
      employment_status: editForm.employmentStatus,
      employment_type: editForm.employmentType,
      dept_code: editForm.deptCode.trim(),
      dept_name: editForm.deptName.trim(),
      position_code: editForm.positionCode.trim(),
      position_name: editForm.positionName.trim(),
      rank_code: editForm.rankCode.trim(),
      rank_name: editForm.rankName.trim(),
      manager_uid: editForm.managerUid.trim(),
      onboard_date: editForm.onboardDate,
      leave_date: editForm.leaveDate,
      work_location: editForm.workLocation.trim(),
      cost_center_code: editForm.costCenterCode.trim(),
      current_user: authorization.snapshot?.uid || undefined
    }
    if (canEditSensitiveCostFields.value) {
      body.monthly_standard_cost = numberValue(editForm.monthlyStandardCost)
    }

    await $fetch(`/api/v1/employees/${encodeURIComponent(employee.value.employee_uid)}`, {
      method: 'PATCH',
      body
    })

    if (shouldDisableConsoleUser(nextEmploymentStatus)) {
      try {
        await disableConsoleUserForOffboarding({
          employeeUid: employee.value.employee_uid,
          activeRoleCode: authorization.snapshot?.activeRoleCode,
          operatorUid: authorization.snapshot?.uid,
          leaveDate: editForm.leaveDate || new Date().toISOString().slice(0, 10)
        })
      } catch (error) {
        consoleDisableWarning = editErrorMessage(error)
      }
    }

    toast.add({
      title: consoleDisableWarning ? '员工已保存，Console 账号停用失败' : '已保存员工信息',
      description: consoleDisableWarning || undefined,
      color: consoleDisableWarning ? 'warning' : 'success'
    })
    editOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({
      title: '保存员工信息失败',
      description: editErrorMessage(error),
      color: 'error'
    })
  } finally {
    savingEdit.value = false
  }
}

async function openAssignmentAdjustment() {
  if (!employee.value) return

  const authorization = await ensurePeoplePermission('assignments', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要任职调整权限后才能维护任职记录。',
      color: 'warning'
    })
    return
  }

  const standardCostAuthorization = await ensurePeoplePermission('standard_costs', 'admin')
  canEditSensitiveCostFields.value = standardCostAuthorization.authorized
  if (canEditSensitiveCostFields.value) {
    try {
      await refreshStandardCosts()
    } catch {
      // 调级时会再次校验职级标准是否可用，这里不阻断打开弹窗。
    }
  }
  fillAssignmentForm(employee.value)
  assignmentOpen.value = true
}

async function closeCurrentAssignments(effectiveFrom: string, currentUser?: string | null) {
  const currentAssignments = (profile.value?.assignments || []).filter(item => !item.effective_to)
  await Promise.all(currentAssignments.map(item => $fetch(`/api/v1/assignments/${encodeURIComponent(item.assignment_code)}`, {
    method: 'PATCH',
    body: {
      effective_to: assignmentEndDate(item, effectiveFrom),
      current_user: currentUser || undefined
    }
  })))
}

async function saveAssignmentAdjustment() {
  if (savingAssignment.value || !employee.value) return

  if (!assignmentForm.effectiveFrom) {
    toast.add({
      title: '请填写生效日期',
      color: 'warning'
    })
    return
  }

  if (assignmentForm.changeType === 'rank_change' && !canEditSensitiveCostFields.value) {
    toast.add({
      title: '当前角色无权限',
      description: '需要职级设置管理权限后才能调整职级成本。',
      color: 'warning'
    })
    return
  }

  if (assignmentForm.changeType === 'rank_change' && !selectedRankRate.value) {
    toast.add({
      title: '请选择职级标准',
      description: '请先在职级设置中维护可用职级，然后选择职级序列和职级名称。',
      color: 'warning'
    })
    return
  }

  const authorization = await ensurePeoplePermission('assignments', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要任职调整权限后才能维护任职记录。',
      color: 'warning'
    })
    return
  }

  const currentUser = authorization.snapshot?.uid || undefined
  const nextRank = selectedRankRate.value
  const rankCode = assignmentForm.changeType === 'rank_change' ? textValue(nextRank?.rank_code) : assignmentForm.rankCode.trim()
  const rankName = assignmentForm.changeType === 'rank_change' ? textValue(nextRank?.rank_name) : assignmentForm.rankName.trim()
  const monthlyStandardCost = assignmentForm.changeType === 'rank_change'
    ? numberValue(nextRank?.monthly_standard_cost)
    : numberValue(employee.value.monthly_standard_cost)

  savingAssignment.value = true
  try {
    let consoleDisableWarning = ''

    await $fetch('/api/v1/assignments', {
      method: 'POST',
      body: {
        employee_uid: employee.value.employee_uid,
        change_type: assignmentForm.changeType,
        effective_from: assignmentForm.effectiveFrom,
        dept_code: assignmentForm.deptCode.trim(),
        dept_name: assignmentForm.deptName.trim(),
        position_code: assignmentForm.positionCode.trim(),
        position_name: assignmentForm.positionName.trim(),
        rank_code: rankCode,
        rank_name: rankName,
        manager_uid: assignmentForm.managerUid.trim(),
        approval_status: 'approved',
        source_app: 'people',
        source_biz_type: 'manual_assignment_adjustment',
        source_biz_id: `${employee.value.employee_uid}-${Date.now()}`,
        remarks: assignmentForm.remarks.trim(),
        current_user: currentUser
      }
    })
    await closeCurrentAssignments(assignmentForm.effectiveFrom, currentUser)
    const employeePatch: Record<string, unknown> = {
      employment_status: assignmentForm.changeType === 'leave' ? 'left' : employee.value.employment_status,
      dept_code: assignmentForm.deptCode.trim(),
      dept_name: assignmentForm.deptName.trim(),
      position_code: assignmentForm.positionCode.trim(),
      position_name: assignmentForm.positionName.trim(),
      rank_code: rankCode,
      rank_name: rankName,
      manager_uid: assignmentForm.managerUid.trim(),
      leave_date: assignmentForm.changeType === 'leave' ? assignmentForm.effectiveFrom : employee.value.leave_date,
      current_user: currentUser
    }
    if (assignmentForm.changeType === 'rank_change' && canEditSensitiveCostFields.value) {
      employeePatch.monthly_standard_cost = monthlyStandardCost
    }

    await $fetch(`/api/v1/employees/${encodeURIComponent(employee.value.employee_uid)}`, {
      method: 'PATCH',
      body: employeePatch
    })

    if (assignmentForm.changeType === 'leave') {
      try {
        await disableConsoleUserForOffboarding({
          employeeUid: employee.value.employee_uid,
          activeRoleCode: authorization.snapshot?.activeRoleCode,
          operatorUid: authorization.snapshot?.uid,
          leaveDate: assignmentForm.effectiveFrom
        })
      } catch (error) {
        consoleDisableWarning = editErrorMessage(error)
      }
    }

    toast.add({
      title: consoleDisableWarning ? '任职调整已保存，Console 账号停用失败' : '已保存任职调整',
      description: consoleDisableWarning || undefined,
      color: consoleDisableWarning ? 'warning' : 'success'
    })
    assignmentOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({
      title: '保存任职调整失败',
      description: editErrorMessage(error),
      color: 'error'
    })
  } finally {
    savingAssignment.value = false
  }
}

watch(() => assignmentForm.rankSeries, () => {
  ensureRankSelection()
})

watch(() => assignmentForm.rankCode, () => {
  syncSelectedRank()
})
</script>

<template>
  <UDashboardPanel
    id="people-employee-detail"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <div class="flex min-w-0 items-center gap-2">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="ghost"
            size="sm"
            to="/employees"
          />
          <h1 class="truncate text-base font-semibold">
            {{ employee?.display_name || uid }}
          </h1>
        </div>
      </Teleport>
      <Teleport to="#people-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="员工详情暂不可用"
          description="请确认 People data-runtime 已可访问，且员工 UID 存在。"
        />

        <UCard v-if="employee">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div class="flex min-w-0 items-center gap-4">
              <UAvatar
                :text="employeeAvatarText"
                size="3xl"
              />
              <div class="min-w-0 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-semibold">
                    {{ employee.display_name }}
                  </h2>
                  <UBadge
                    :color="color(employee.employment_status)"
                    variant="soft"
                  >
                    {{ label(employee.employment_status) }}
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ employee.employment_type }}
                  </UBadge>
                  <span class="text-sm text-muted">{{ employee.employee_no }} · {{ employee.employee_uid }}</span>
                </div>
                <div class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div><span class="text-muted">部门</span> {{ employee.dept_name || employee.dept_code || '-' }}</div>
                  <div><span class="text-muted">岗位</span> {{ employee.position_name || '-' }}</div>
                  <div><span class="text-muted">职级</span> {{ employee.rank_code || '-' }}</div>
                  <div><span class="text-muted">直属负责人</span> {{ employee.manager_uid || '-' }}</div>
                  <div><span class="text-muted">入职日期</span> {{ date(employee.onboard_date) }}</div>
                  <div><span class="text-muted">成本中心</span> {{ employee.cost_center_code || '-' }}</div>
                  <div><span class="text-muted">月标准成本</span> {{ money(employee.monthly_standard_cost) }}</div>
                  <div><span class="text-muted">办公地点</span> {{ employee.work_location || '-' }}</div>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 gap-2">
              <UButton
                icon="i-lucide-pencil"
                color="primary"
                variant="soft"
                @click="openEdit"
              >
                编辑
              </UButton>
              <UButton
                icon="i-lucide-arrow-left-right"
                color="neutral"
                variant="outline"
                @click="openAssignmentAdjustment"
              >
                调整任职
              </UButton>
            </div>
          </div>
        </UCard>

        <div class="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">任职历史</span>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ assignmentRows.length }} 条
                </UBadge>
              </div>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="assignmentRows"
                :columns="assignmentColumns"
              >
                <template #change_label-cell="{ row }">
                  <UBadge
                    :color="color(row.original.change_type)"
                    variant="soft"
                  >
                    {{ row.original.change_label }}
                  </UBadge>
                </template>
              </UTable>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold">月度成本快照</span>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="costRows"
                :columns="costColumns"
              />
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">项目参与与贡献</span>
              <span class="text-xs text-muted">固化自 Aims，不替代源系统</span>
            </div>
          </template>
          <div class="overflow-x-auto">
            <UTable
              :data="contributionRows"
              :columns="contributionColumns"
            />
          </div>
        </UCard>

        <div class="grid gap-4 xl:grid-cols-2">
          <UCard>
            <template #header>
              <span class="font-semibold">参与的绩效周期</span>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="cycleRows"
                :columns="cycleColumns"
              >
                <template #status_label-cell="{ row }">
                  <UBadge
                    :color="color(row.original.status)"
                    variant="soft"
                  >
                    {{ row.original.status_label }}
                  </UBadge>
                </template>
              </UTable>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">关联文档</span>
                <span class="text-xs text-muted">Codocs UUID 引用</span>
              </div>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="documentRows"
                :columns="documentColumns"
              />
            </div>
          </UCard>
        </div>

        <UModal
          v-model:open="editOpen"
          title="编辑员工"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="saveEdit"
            >
              <div class="grid gap-3 md:grid-cols-2">
                <UFormField
                  label="姓名"
                  required
                >
                  <UInput
                    v-model="editForm.displayName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="工号"
                  required
                >
                  <UInput
                    v-model="editForm.employeeNo"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="登录名">
                  <UInput
                    v-model="editForm.loginName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="状态">
                  <USelect
                    v-model="editForm.employmentStatus"
                    :items="statusOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="用工类型">
                  <USelect
                    v-model="editForm.employmentType"
                    :items="employmentTypeOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="直属负责人 UID">
                  <UInput
                    v-model="editForm.managerUid"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="部门编码">
                  <UInput
                    v-model="editForm.deptCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="部门名称">
                  <UInput
                    v-model="editForm.deptName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="岗位编码">
                  <UInput
                    v-model="editForm.positionCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="岗位名称">
                  <UInput
                    v-model="editForm.positionName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="职级编码">
                  <UInput
                    v-model="editForm.rankCode"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="职级名称">
                  <UInput
                    v-model="editForm.rankName"
                    disabled
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="入职日期">
                  <UInput
                    v-model="editForm.onboardDate"
                    type="date"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="离职日期">
                  <UInput
                    v-model="editForm.leaveDate"
                    type="date"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="成本中心">
                  <UInput
                    v-model="editForm.costCenterCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="办公地点">
                  <UInput
                    v-model="editForm.workLocation"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="月标准成本">
                  <UInput
                    v-model="editForm.monthlyStandardCost"
                    type="number"
                    min="0"
                    step="0.01"
                    :disabled="!canEditSensitiveCostFields"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="editOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  type="submit"
                  color="primary"
                  icon="i-lucide-save"
                  :loading="savingEdit"
                >
                  保存
                </UButton>
              </div>
            </form>
          </template>
        </UModal>

        <UModal
          v-model:open="assignmentOpen"
          title="任职调整"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="saveAssignmentAdjustment"
            >
              <UAlert
                v-if="assignmentForm.changeType === 'rank_change' && (!canEditSensitiveCostFields || standardCostError)"
                color="warning"
                variant="soft"
                icon="i-lucide-database-zap"
                :title="canEditSensitiveCostFields ? '职级标准暂不可用' : '当前角色无权限'"
                :description="canEditSensitiveCostFields ? '调级需要先读取职级设置，请确认 People data-runtime 可访问。' : '需要职级设置管理权限后才能调整职级成本。'"
              />

              <div class="grid gap-3 md:grid-cols-2">
                <UFormField label="调整类型">
                  <USelect
                    v-model="assignmentForm.changeType"
                    :items="assignmentTypeOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="生效日期"
                  required
                >
                  <UInput
                    v-model="assignmentForm.effectiveFrom"
                    type="date"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  v-if="assignmentForm.changeType === 'rank_change'"
                  label="职级序列"
                  required
                  class="md:col-span-2"
                >
                  <URadioGroup
                    v-model="assignmentForm.rankSeries"
                    :items="rankSeriesOptions"
                    orientation="horizontal"
                    variant="list"
                  />
                </UFormField>
                <UFormField
                  v-if="assignmentForm.changeType === 'rank_change'"
                  label="职级名称"
                  required
                >
                  <USelect
                    v-model="assignmentForm.rankCode"
                    :items="rankOptions"
                    :disabled="!rankOptions.length"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  v-if="assignmentForm.changeType === 'rank_change'"
                  label="月标准成本"
                >
                  <UInput
                    :model-value="money(assignmentForm.monthlyStandardCost)"
                    disabled
                    class="w-full"
                  />
                </UFormField>

                <UFormField label="部门编码">
                  <UInput
                    v-model="assignmentForm.deptCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="部门名称">
                  <UInput
                    v-model="assignmentForm.deptName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="岗位编码">
                  <UInput
                    v-model="assignmentForm.positionCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="岗位名称">
                  <UInput
                    v-model="assignmentForm.positionName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="直属负责人 UID">
                  <UInput
                    v-model="assignmentForm.managerUid"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="备注"
                  class="md:col-span-2"
                >
                  <UTextarea
                    v-model="assignmentForm.remarks"
                    :rows="3"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="assignmentOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  type="submit"
                  color="primary"
                  icon="i-lucide-check"
                  :loading="savingAssignment"
                >
                  保存调整
                </UButton>
              </div>
            </form>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
