<script setup lang="ts">
import type { ApiResponse, Employee, EmployeePrivateProfile, EmployeeProfile, ListResponse, Rank, StandardCostRate } from '~/types'

const route = useRoute()
const router = useRouter()
const uid = computed(() => String(route.params.uid || ''))
const { label, color, money, date } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()
const editOpen = ref(false)
const savingEdit = ref(false)
const assignmentOpen = ref(false)
const savingAssignment = ref(false)
const canEditSensitiveCostFields = ref(false)
const assignmentSourceBizId = ref('')
const canManagePrivateProfile = ref(false)
const privateProfile = ref<EmployeePrivateProfile | null>(null)
const privateProfileLoading = ref(false)
const privateEditOpen = ref(false)
const savingPrivateProfile = ref(false)

const privateForm = reactive({
  id_number: '',
  birth_date: '',
  education_level: '',
  major: '',
  graduation_school: '',
  graduation_date: ''
})
const privateInitial = ref<Record<string, string>>({})

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

const { data: standardCostResponse, error: standardCostError, refresh: refreshStandardCosts } = useFetch<ApiResponse<ListResponse<StandardCostRate>>>('/api/v1/standard-costs', {
  query: {
    page: 1,
    page_size: 500
  },
  immediate: false
})
const { data: rankResponse, error: rankError, refresh: refreshRanks } = useFetch<ApiResponse<ListResponse<Rank>>>('/api/v1/ranks', {
  query: {
    page: 1,
    page_size: 500
  },
  immediate: false
})

const profile = computed(() => response.value?.data)
const employee = computed(() => profile.value?.employee)
usePageTitle(computed(() => employee.value?.display_name || uid.value))
const employeeAvatarText = computed(() => avatarText(employee.value))
const standardCostRows = computed(() => (standardCostResponse.value?.data.items || []).filter(item => Boolean(textValue(item.rank_code)) && item.enabled !== false && item.enabled !== 0))
const enabledRanks = computed(() => (rankResponse.value?.data.items || [])
  .filter(item => item.enabled !== false && item.enabled !== 0 && (item.rank_series === 'M' || item.rank_series === 'P'))
  .sort((left, right) => {
    if (left.rank_series !== right.rank_series) return left.rank_series === 'M' ? -1 : 1
    return numberValue(left.rank_level) - numberValue(right.rank_level) || numberValue(left.sort_order) - numberValue(right.sort_order)
  }))
const latestRankRateByCode = computed(() => {
  const byRankCode = new Map<string, StandardCostRate>()
  for (const item of standardCostRows.value) {
    const rankCode = textValue(item.rank_code).toUpperCase()
    if (!rankCode) continue

    const existing = byRankCode.get(rankCode)
    if (!existing || dateValue(item.effective_from) > dateValue(existing.effective_from)) {
      byRankCode.set(rankCode, item)
    }
  }

  return byRankCode
})
const rankSeriesOptions = computed(() => {
  const seriesValues = Array.from(new Set(enabledRanks.value.map(item => textValue(item.rank_series)).filter(Boolean)))
  const values = seriesValues.length ? seriesValues : ['P', 'M']
  return values.sort((left, right) => (left === 'M' ? -1 : 1) - (right === 'M' ? -1 : 1)).map(value => ({
    label: value === 'M' ? '管理 M' : '专业 P',
    value
  }))
})
const rankOptions = computed(() => enabledRanks.value
  .filter(item => textValue(item.rank_series) === assignmentForm.rankSeries)
  .map(item => ({
    label: `${textValue(item.rank_code)} · ${textValue(item.rank_name)}`,
    value: textValue(item.rank_code)
  })))
const selectedRank = computed(() => enabledRanks.value.find(item => textValue(item.rank_code) === assignmentForm.rankCode))
const selectedRankRate = computed(() => latestRankRateByCode.value.get(textValue(assignmentForm.rankCode).toUpperCase()))

const assignmentRows = computed(() => (profile.value?.assignments || []).map(item => ({
  ...item,
  change_label: label(item.change_type),
  approval_label: label(item.approval_status),
  effective_period: `${date(item.effective_from)} ~ ${date(item.effective_to) === '-' ? '至今' : date(item.effective_to)}`
})))

const costRows = computed(() => (profile.value?.cost_snapshots || []).map(item => ({
  ...item,
  standard_display: money(item.standard_cost),
  actual_display: money(item.actual_cost),
  source_label: label(item.cost_source)
})))

const contributionRows = computed(() => (profile.value?.project_contributions || []).map(item => ({
  ...item,
  score_display: item.score_status === 'scored' && item.contribution_score !== null
    ? Number(item.contribution_score).toFixed(1)
    : '未评分'
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
  { accessorKey: 'source_label', header: '来源' }
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

async function handleRefresh() {
  await refresh()
  if (canManagePrivateProfile.value) await loadPrivateProfile()
}
const { setRefresh, clearRefresh } = usePageActions()
onMounted(async () => {
  setRefresh(handleRefresh)
  const privateAuthorization = await ensurePeoplePermission('employees', 'edit')
  canManagePrivateProfile.value = privateAuthorization.authorized
  if (canManagePrivateProfile.value) await loadPrivateProfile()
  if (route.query.action !== 'assignment') return

  await openAssignmentAdjustment()
  const nextQuery = { ...route.query }
  delete nextQuery.action
  await router.replace({ query: nextQuery })
})
onBeforeUnmount(clearRefresh)

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

function syncSelectedRank() {
  const rank = selectedRank.value
  if (!rank) return

  assignmentForm.rankCode = textValue(rank.rank_code)
  assignmentForm.rankName = textValue(rank.rank_name)
  assignmentForm.monthlyStandardCost = textValue(selectedRankRate.value?.monthly_standard_cost) || '0'
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
  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  assignmentSourceBizId.value = `${item.employee_uid}-${requestId}`.slice(0, 128)
  assignmentForm.changeType = 'rank_change'
  assignmentForm.effectiveFrom = new Date().toISOString().slice(0, 10)
  assignmentForm.deptCode = textValue(item.dept_code)
  assignmentForm.deptName = textValue(item.dept_name)
  assignmentForm.positionCode = textValue(item.position_code)
  assignmentForm.positionName = textValue(item.position_name)
  const currentRank = enabledRanks.value.find(rank => textValue(rank.rank_code) === textValue(item.rank_code))
  assignmentForm.rankSeries = textValue(currentRank?.rank_series) || rankSeriesOptions.value[0]?.value || 'P'
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

const privateFieldLabels: Record<string, string> = {
  id_number: '身份证号',
  birth_date: '出生日期',
  education_level: '学历',
  major: '专业',
  graduation_school: '毕业学校',
  graduation_date: '毕业时间'
}
const privateFieldCodes = Object.keys(privateFieldLabels) as Array<keyof typeof privateForm>

const privateSourceLabels: Record<string, string> = {
  dingtalk: '钉钉',
  manual: 'People 维护',
  oa_archive: 'OA 历史档案'
}

async function loadPrivateProfile() {
  if (!uid.value || privateProfileLoading.value) return
  privateProfileLoading.value = true
  try {
    const result = await $fetch<ApiResponse<EmployeePrivateProfile>>(`/api/v1/employees/${encodeURIComponent(uid.value)}/private-profile`)
    privateProfile.value = result.data
  } catch (error) {
    toast.add({ title: '人事档案暂不可用', description: editErrorMessage(error), color: 'warning' })
  } finally {
    privateProfileLoading.value = false
  }
}

function privateFieldValue(field: keyof typeof privateForm) {
  return privateProfile.value?.fields[field]?.value || ''
}

function privateFieldSource(field: keyof typeof privateForm) {
  return privateProfile.value?.fields[field]?.source || ''
}

function privateFieldEditable(field: keyof typeof privateForm) {
  return privateProfile.value?.fields[field]?.editable !== false
}

async function openPrivateEdit() {
  const authorization = await ensurePeoplePermission('employees', 'edit')
  if (!authorization.authorized) return
  if (!privateProfile.value) await loadPrivateProfile()
  for (const key of Object.keys(privateForm) as Array<keyof typeof privateForm>) {
    // 身份证号只由服务端返回掩码；留空表示不修改。
    privateForm[key] = key === 'id_number' ? '' : privateFieldValue(key)
  }
  privateInitial.value = { ...privateForm }
  privateEditOpen.value = true
}

async function savePrivateProfile() {
  if (savingPrivateProfile.value) return
  const authorization = await ensurePeoplePermission('employees', 'edit')
  if (!authorization.authorized) return
  const body: Record<string, string> = {}
  for (const key of Object.keys(privateForm) as Array<keyof typeof privateForm>) {
    if (!privateFieldEditable(key)) continue
    if (key === 'id_number') {
      if (privateForm[key].trim()) body[key] = privateForm[key].trim()
      continue
    }
    if (privateForm[key] !== privateInitial.value[key]) body[key] = privateForm[key].trim()
  }
  if (Object.keys(body).length === 0) {
    toast.add({ title: '没有需要保存的变更', color: 'info' })
    return
  }
  savingPrivateProfile.value = true
  try {
    const result = await $fetch<ApiResponse<EmployeePrivateProfile>>(`/api/v1/employees/${encodeURIComponent(uid.value)}/private-profile`, {
      method: 'PATCH',
      body
    })
    privateProfile.value = result.data
    privateEditOpen.value = false
    toast.add({ title: '人事档案已保存', color: 'success' })
  } catch (error) {
    toast.add({ title: '保存人事档案失败', description: editErrorMessage(error), color: 'error' })
  } finally {
    savingPrivateProfile.value = false
  }
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

  if (!editForm.displayName.trim()) {
    toast.add({
      title: '请补齐员工信息',
      description: '姓名为必填项。',
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
    const body: Record<string, unknown> = {
      display_name: editForm.displayName.trim(),
      initials: firstGlyph(editForm.displayName, editForm.employeeNo),
      login_name: editForm.loginName.trim(),
      employment_status: editForm.employmentStatus,
      employment_type: editForm.employmentType,
      dept_code: editForm.deptCode.trim(),
      dept_name: editForm.deptName.trim(),
      position_code: editForm.positionCode.trim(),
      position_name: editForm.positionName.trim(),
      manager_uid: editForm.managerUid.trim(),
      leave_date: editForm.leaveDate,
      work_location: editForm.workLocation.trim(),
      current_user: authorization.snapshot?.uid || undefined
    }
    if (employee.value.onboard_date_source !== 'dingtalk') {
      body.onboard_date = editForm.onboardDate
    }
    if (canEditSensitiveCostFields.value) {
      body.cost_center_code = editForm.costCenterCode.trim()
      body.monthly_standard_cost = numberValue(editForm.monthlyStandardCost)
    }

    await $fetch(`/api/v1/employees/${encodeURIComponent(employee.value.employee_uid)}`, {
      method: 'PATCH',
      body
    })

    toast.add({
      title: '已保存员工信息',
      color: 'success'
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
  await refreshRanks()
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

  if (assignmentForm.changeType === 'rank_change' && !selectedRank.value) {
    toast.add({
      title: '请选择有效职级',
      description: '请先在职级字典中维护并启用职级，然后选择职级类型和职级名称。',
      color: 'warning'
    })
    return
  }

  if (assignmentForm.changeType === 'rank_change' && !selectedRankRate.value) {
    toast.add({
      title: '该职级尚未维护标准成本',
      description: '请先在职级设置中维护当前职级的有效标准成本。',
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

  const nextRank = selectedRank.value
  const nextRankRate = selectedRankRate.value
  const rankCode = assignmentForm.changeType === 'rank_change' ? textValue(nextRank?.rank_code) : assignmentForm.rankCode.trim()
  const rankName = assignmentForm.changeType === 'rank_change' ? textValue(nextRank?.rank_name) : assignmentForm.rankName.trim()
  const monthlyStandardCost = assignmentForm.changeType === 'rank_change'
    ? numberValue(nextRankRate?.monthly_standard_cost)
    : numberValue(employee.value.monthly_standard_cost)

  savingAssignment.value = true
  try {
    const body: Record<string, unknown> = {
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
      source_biz_id: assignmentSourceBizId.value,
      remarks: assignmentForm.remarks.trim()
    }
    if (assignmentForm.changeType === 'rank_change') {
      body.monthly_standard_cost = monthlyStandardCost
    }

    await $fetch('/api/v1/assignments:change', {
      method: 'POST',
      body
    })

    toast.add({
      title: '已保存任职调整',
      color: 'success'
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
      <div class="space-y-4 p-4">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/employees"
        >
          返回员工列表
        </UButton>
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
                    {{ label(employee.employment_type) }}
                  </UBadge>
                  <span class="text-sm text-muted">{{ employee.employee_no }} · {{ employee.employee_uid }}</span>
                </div>
                <div class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div><span class="text-muted">部门</span> {{ employee.dept_name || employee.dept_code || '-' }}</div>
                  <div><span class="text-muted">岗位</span> {{ employee.position_name || '-' }}</div>
                  <div><span class="text-muted">职级</span> {{ employee.rank_code || '-' }}</div>
                  <div><span class="text-muted">直属负责人</span> {{ employee.manager_uid || '-' }}</div>
                  <div class="flex items-center gap-1.5">
                    <span class="text-muted">入职日期</span>
                    <span>{{ date(employee.onboard_date) }}</span>
                    <UBadge
                      v-if="employee.onboard_date_source"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    >
                      {{ privateSourceLabels[employee.onboard_date_source] || employee.onboard_date_source }}
                    </UBadge>
                  </div>
                  <div>
                    <span class="text-muted">手机号</span>
                    <span v-if="employee.mobile">{{ employee.mobile }}</span>
                    <span
                      v-else
                      class="text-dimmed"
                    >钉钉未提供</span>
                  </div>
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

        <UCard v-if="employee && canManagePrivateProfile">
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-semibold">
                  人事档案
                </p>
                <p class="mt-1 text-xs text-muted">
                  人力资源管理人员可见；有效值按钉钉、People 维护、OA 历史档案顺序选择。
                </p>
              </div>
              <UButton
                icon="i-lucide-shield-user"
                color="neutral"
                variant="outline"
                :loading="privateProfileLoading"
                @click="openPrivateEdit"
              >
                维护档案
              </UButton>
            </div>
          </template>
          <div
            v-if="privateProfileLoading && !privateProfile"
            class="flex items-center gap-2 text-sm text-muted"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            />
            正在读取人事档案...
          </div>
          <div
            v-else
            class="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3"
          >
            <div
              v-for="field in privateFieldCodes"
              :key="field"
              class="min-w-0"
            >
              <p class="text-muted">
                {{ privateFieldLabels[field] }}
              </p>
              <div class="mt-1 flex min-w-0 items-center gap-2">
                <span class="truncate font-medium">{{ privateFieldValue(field) || '-' }}</span>
                <UBadge
                  v-if="privateFieldSource(field)"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                >
                  {{ privateSourceLabels[privateFieldSource(field)] || privateFieldSource(field) }}
                </UBadge>
              </div>
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
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-arrow-left-right"
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
              >
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-wallet-cards"
                    title="暂无成本快照"
                  />
                </template>
              </UTable>
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
            >
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-chart-no-axes-column"
                  title="暂无项目贡献"
                />
              </template>
            </UTable>
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
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-target"
                    title="暂无参与的绩效周期"
                  />
                </template>
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
              >
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-file-text"
                    title="暂无关联文档"
                  />
                </template>
              </UTable>
            </div>
          </UCard>
        </div>

        <UModal
          v-model:open="privateEditOpen"
          title="维护人事档案"
          description="钉钉已提供的字段不可在 People 覆盖；身份证号保存后只显示掩码。"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="savePrivateProfile"
            >
              <UAlert
                color="info"
                variant="soft"
                icon="i-lucide-shield-check"
                title="字段来源受控"
                description="钉钉有值时以钉钉为准；钉钉没有时才使用 People 维护值，OA 历史档案作为最后补充。"
              />
              <div class="grid gap-3 md:grid-cols-2">
                <UFormField
                  label="身份证号"
                  help="留空表示保持现有值；保存后不会回显明文。"
                >
                  <UInput
                    v-model="privateForm.id_number"
                    autocomplete="off"
                    placeholder="18 位身份证号"
                    :disabled="!privateFieldEditable('id_number')"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="出生日期">
                  <UInput
                    v-model="privateForm.birth_date"
                    type="date"
                    :disabled="!privateFieldEditable('birth_date')"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="学历"
                  help="OA 导入保留原系统代码，可在此完善为可读名称。"
                >
                  <UInput
                    v-model="privateForm.education_level"
                    :disabled="!privateFieldEditable('education_level')"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="专业">
                  <UInput
                    v-model="privateForm.major"
                    :disabled="!privateFieldEditable('major')"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="毕业学校">
                  <UInput
                    v-model="privateForm.graduation_school"
                    :disabled="!privateFieldEditable('graduation_school')"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="毕业时间"
                  help="钉钉仅提供月份时按 YYYY-MM 展示。"
                >
                  <UInput
                    v-model="privateForm.graduation_date"
                    :type="privateForm.graduation_date.length === 7 ? 'month' : 'date'"
                    :disabled="!privateFieldEditable('graduation_date')"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="privateEditOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  type="submit"
                  icon="i-lucide-save"
                  :loading="savingPrivateProfile"
                >
                  保存档案
                </UButton>
              </div>
            </form>
          </template>
        </UModal>

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
                  help="由 People 自动分配，不支持人工修改。"
                >
                  <UInput
                    v-model="editForm.employeeNo"
                    class="w-full"
                    disabled
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
                    :disabled="employee?.onboard_date_source === 'dingtalk'"
                    class="w-full"
                  />
                  <template
                    v-if="employee?.onboard_date_source === 'dingtalk'"
                    #help
                  >
                    钉钉已提供该日期，请在钉钉中维护。
                  </template>
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
                    :disabled="!canEditSensitiveCostFields"
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
                v-if="assignmentForm.changeType === 'rank_change' && (!canEditSensitiveCostFields || rankError || standardCostError)"
                color="warning"
                variant="soft"
                icon="i-lucide-database-zap"
                :title="canEditSensitiveCostFields ? '职级数据暂不可用' : '当前角色无权限'"
                :description="canEditSensitiveCostFields ? '调级需要读取职级字典和标准成本，请确认 People data-runtime 可访问。' : '需要职级设置管理权限后才能调整职级成本。'"
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
