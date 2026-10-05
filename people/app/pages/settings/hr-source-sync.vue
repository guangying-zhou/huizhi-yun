<script setup lang="ts">
type MappingState = 'mapped' | 'suggested' | 'conflict' | 'unmatched'
type MappingItem = {
  externalDepartmentId: string
  legacyDeptCode: string
  departmentName: string
  parentExternalId: string
  activeMemberCount: number
  state: MappingState
  suggestedDeptCode: string
  candidateDeptCodes: string[]
}
type Department = { deptCode: string, departmentName: string, parentDeptCode: string }
type Preview = {
  items: MappingItem[]
  departments: Department[]
  totals: Record<MappingState | 'total', number>
}
type Job = {
  jobId?: string
  status?: string
  originalActorUid?: string
  counts?: {
    departments?: number
    users?: number
    applied?: number
    skipped?: number
    batches?: number
    fieldCoverage?: Array<{
      field: string
      provided: number
      empty: number
      absent: number
      invalid: number
      observed: number
    }>
    partialFieldsMissing?: string[]
  }
  errorCode?: string
  errorMessage?: string
}
type StageTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'
type JobStage = { code: string, label: string, detail: string, state: string, color: StageTone }
type SnapshotRun = {
  runId: number
  jobId: string
  snapshotRevision: string
  snapshotHash: string
  reportedDepartmentCount: number
  seenDepartmentCount: number
  activeIdentityCount: number
  missingDepartmentCount: number
  missingDepartmentRatio: number
  policyMaxMissingCount: number
  policyMaxMissingRatio: number
  riskLevel: 'none' | 'normal' | 'high'
  rootMissing: boolean
  status: 'no_changes' | 'awaiting_confirmation' | 'partially_applied' | 'applied' | 'superseded'
}
type DepartmentChange = {
  externalDepartmentId: string
  deptCode: string
  departmentName: string
  parentDeptCode: string
  level: number
  status: 'pending' | 'applied' | 'superseded'
  activePrimaryUserCount: number
  blockingActiveChildCount: number
  blockedReasons: string[]
  canApply: boolean
}
type ChangePreview = { run: SnapshotRun | null, items: DepartmentChange[] }
type Envelope<T> = { code?: number, data?: T, message?: string }

usePageTitle('人事事实源')

const toast = useToast()
const { confirm } = useConfirm()
const { ensurePeoplePermission } = usePeopleAuthorization()
const mappingTargets = reactive<Record<string, string>>({})
const selectedChanges = reactive<Record<string, boolean>>({})
const applying = ref(false)
const reconcilingMappings = ref(false)
const applyingChanges = ref(false)
const confirmOpen = ref(false)
const starting = ref(false)
const jobLoading = ref(false)
const storedJobId = useLocalStorage<string | null>('people:dingtalk-hr-source:current-job-id', null)
const currentJob = ref<Job | null>(storedJobId.value ? { jobId: storedJobId.value } : null)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollFailureCount = 0

const { data: previewResponse, status, error, refresh } = await useLazyFetch<Preview | Envelope<Preview>>(
  peopleApiPath('/api/admin/hr-source-sync/dingtalk/department-mappings')
)
const preview = computed<Preview | null>(() => {
  const value = previewResponse.value
  if (!value) return null
  if ('items' in value) return value
  return value.data || null
})
const {
  data: changesResponse,
  status: changesStatus,
  error: changesError,
  refresh: refreshChanges
} = await useLazyFetch<ChangePreview | Envelope<ChangePreview>>(
  peopleApiPath('/api/admin/hr-source-sync/dingtalk/department-changes')
)
const changePreview = computed<ChangePreview | null>(() => {
  const value = changesResponse.value
  if (!value) return null
  if ('run' in value) return value
  return value.data || null
})
const changeRows = computed(() => changePreview.value?.items || [])
const selectedChangeCodes = computed(() => changeRows.value
  .filter(item => item.canApply && selectedChanges[item.deptCode])
  .map(item => item.deptCode))
const rows = computed(() => preview.value?.items || [])
const departmentOptions = computed(() => (preview.value?.departments || []).map(department => ({
  label: `${department.departmentName}（${department.deptCode}）`,
  value: department.deptCode
})))
const pendingMappings = computed(() => rows.value
  .filter(item => item.state !== 'mapped' && mappingTargets[item.externalDepartmentId])
  .map(item => ({
    externalDepartmentId: item.externalDepartmentId,
    canonicalDeptCode: mappingTargets[item.externalDepartmentId]
  })))
const mappedMappings = computed(() => rows.value
  .filter(item => item.state === 'mapped' && item.suggestedDeptCode)
  .map(item => ({
    externalDepartmentId: item.externalDepartmentId,
    canonicalDeptCode: item.suggestedDeptCode
  })))
const unresolvedCount = computed(() => rows.value.filter(item => item.state !== 'mapped').length)
const readyToSync = computed(() => Boolean(preview.value) && !error.value && unresolvedCount.value === 0)
const normalizedJobStatus = computed(() => String(currentJob.value?.status || 'pending').toLowerCase())
const jobTerminal = computed(() => ['success', 'succeeded', 'failed', 'cancelled'].includes(normalizedJobStatus.value))
const jobInProgress = computed(() => Boolean(currentJob.value?.jobId) && !jobTerminal.value)
const startSyncDisabled = computed(() => starting.value || jobInProgress.value || !readyToSync.value)
const jobStages = computed<JobStage[]>(() => {
  const status = normalizedJobStatus.value
  const failed = status === 'failed'
  const cancelled = status === 'cancelled'
  const running = status === 'running'
  const succeeded = ['success', 'succeeded'].includes(status)
  const interrupted = failed || cancelled
  const completedState = succeeded ? '已完成' : interrupted ? '未完成' : running ? '处理中' : '等待中'
  const completedColor: StageTone = succeeded ? 'success' : failed ? 'error' : cancelled ? 'warning' : running ? 'info' : 'neutral'
  return [
    {
      code: 'provider',
      label: '钉钉供应商快照',
      detail: succeeded ? '完整组织与人员快照已拉取并校验' : running ? '正在拉取组织、人员和在离职状态' : interrupted ? '供应商快照未完整交付' : '等待 Connector Runtime 执行',
      state: completedState,
      color: completedColor
    },
    {
      code: 'people',
      label: 'People 人事事实',
      detail: succeeded ? '人员主归属和在离职事实已提交' : running ? '按幂等批次写入 People 事实' : interrupted ? '本次事实写入未完成' : '等待供应商批次',
      state: completedState,
      color: completedColor
    },
    {
      code: 'console',
      label: 'Console 目录状态',
      detail: succeeded ? 'Connector 已接受事实；目录投影及账号关闭需以 Console lifecycle operation 为准' : running ? '等待 People 事实触发目录 lifecycle' : interrupted ? '本次目录投影未完整触发' : '等待 People 事实批次',
      state: succeeded ? '待核验' : interrupted ? '未完成' : '等待中',
      color: succeeded ? 'warning' : interrupted ? completedColor : 'neutral'
    },
    {
      code: 'platform',
      label: 'Platform 策略投影',
      detail: succeeded ? '是否生成并下发策略包需以 Console lifecycle operation 为准' : '等待 Console 产生并投递授权变更',
      state: succeeded ? '待核验' : interrupted ? '未触发' : '等待中',
      color: succeeded ? 'warning' : interrupted ? 'warning' : 'neutral'
    }
  ]
})

watch(preview, (value) => {
  for (const item of value?.items || []) {
    if (!mappingTargets[item.externalDepartmentId] && item.suggestedDeptCode) {
      mappingTargets[item.externalDepartmentId] = item.suggestedDeptCode
    }
  }
}, { immediate: true })

watch(() => currentJob.value?.jobId, (jobId) => {
  storedJobId.value = jobId || null
})

watch(changePreview, (value) => {
  const current = new Set((value?.items || []).map(item => item.deptCode))
  for (const code of Object.keys(selectedChanges)) {
    if (!current.has(code)) Reflect.deleteProperty(selectedChanges, code)
  }
  for (const item of value?.items || []) {
    if (selectedChanges[item.deptCode] === undefined) selectedChanges[item.deptCode] = item.canApply
  }
}, { immediate: true })

const stateMeta: Record<MappingState, { label: string, color: 'success' | 'info' | 'warning' | 'error' }> = {
  mapped: { label: '已绑定', color: 'success' },
  suggested: { label: '待确认', color: 'info' },
  conflict: { label: '名称冲突', color: 'warning' },
  unmatched: { label: '待选择', color: 'error' }
}

const columns = [
  { accessorKey: 'departmentName', header: '钉钉部门' },
  { accessorKey: 'legacyDeptCode', header: '重复目录编码' },
  { accessorKey: 'activeMemberCount', header: '在职成员' },
  { accessorKey: 'state', header: '映射状态' },
  { accessorKey: 'target', header: '汇智云稳定部门' }
]
const changeColumns = [
  { accessorKey: 'selected', header: '' },
  { accessorKey: 'departmentName', header: '缺失部门' },
  { accessorKey: 'deptCode', header: '稳定编码' },
  { accessorKey: 'activePrimaryUserCount', header: '活跃主归属' },
  { accessorKey: 'blockingActiveChildCount', header: '未纳入子部门' },
  { accessorKey: 'status', header: '处理状态' }
]

// 同步成功但整批缺字段时，作业带 partial_fields_missing 稳定码。
// 它不是失败，但也不能当作完全成功——否则 HR 只看到“同步 N 人”，
// 无法得知入职日期、手机号这类字段根本没有下发。
const partialFieldsMissing = computed(() => currentJob.value?.errorCode === 'partial_fields_missing')
const fieldLabel: Record<string, string> = {
  onboardDate: '入职日期',
  mobile: '手机号',
  email: '邮箱',
  employeeNumber: '工号'
}

function errorMessage(value: unknown) {
  const failure = value as { data?: { message?: string }, message?: string }
  return failure.data?.message || failure.message || '请稍后重试'
}

async function applyMappings() {
  if (applying.value || pendingMappings.value.length === 0) return
  const authorization = await ensurePeoplePermission('hr_source_sync', 'admin')
  if (!authorization.authorized) {
    toast.add({ title: '当前角色无权限', description: '需要 People 人事事实源管理权限。', color: 'warning' })
    return
  }
  applying.value = true
  try {
    const result = await $fetch<Envelope<{ console?: { applied?: number }, people?: { employeesUpdated?: number, assignmentsUpdated?: number } }>>(
      peopleApiPath('/api/admin/hr-source-sync/dingtalk/department-mappings'),
      { method: 'POST', body: { mappings: pendingMappings.value } }
    )
    toast.add({
      title: '部门映射已生效',
      description: `Console 归并 ${result.data?.console?.applied || pendingMappings.value.length} 个部门；People 更新员工 ${result.data?.people?.employeesUpdated || 0} 人、任职 ${result.data?.people?.assignmentsUpdated || 0} 条。`,
      color: 'success'
    })
    confirmOpen.value = false
    await refresh()
  } catch (failure) {
    toast.add({ title: '部门映射失败', description: errorMessage(failure), color: 'error' })
  } finally {
    applying.value = false
  }
}

async function reconcileMappedReferences() {
  if (reconcilingMappings.value || mappedMappings.value.length === 0) return
  const authorization = await ensurePeoplePermission('hr_source_sync', 'admin')
  if (!authorization.authorized) {
    toast.add({ title: '当前角色无权限', description: '需要 People 人事事实源管理权限。', color: 'warning' })
    return
  }
  reconcilingMappings.value = true
  try {
    const result = await $fetch<Envelope<{ people?: { employeesUpdated?: number, assignmentsUpdated?: number } }>>(
      peopleApiPath('/api/admin/hr-source-sync/dingtalk/department-mappings'),
      { method: 'POST', body: { mappings: mappedMappings.value } }
    )
    toast.add({
      title: 'People 部门引用已重新对账',
      description: `更新员工 ${result.data?.people?.employeesUpdated || 0} 人、任职 ${result.data?.people?.assignmentsUpdated || 0} 条。`,
      color: 'success'
    })
    await refresh()
  } catch (failure) {
    toast.add({ title: 'People 引用对账失败', description: errorMessage(failure), color: 'error' })
  } finally {
    reconcilingMappings.value = false
  }
}

function scheduleJobPoll(delay: number) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(loadJob, delay)
}

async function loadJob() {
  const jobId = currentJob.value?.jobId
  if (!jobId || jobLoading.value) return
  jobLoading.value = true
  try {
    const result = await $fetch<Envelope<Job>>(peopleApiPath(`/api/admin/hr-source-sync/dingtalk/jobs/${encodeURIComponent(jobId)}`))
    currentJob.value = result.data || currentJob.value
    pollFailureCount = 0
    if (!jobTerminal.value) scheduleJobPoll(2000)
    if (['success', 'succeeded'].includes(String(currentJob.value?.status).toLowerCase())) {
      await Promise.all([refresh(), refreshChanges()])
    }
  } catch (failure) {
    const statusCode = Number((failure as { statusCode?: number, response?: { status?: number } }).statusCode
      || (failure as { response?: { status?: number } }).response?.status || 0)
    if (statusCode === 403 || statusCode === 404) {
      currentJob.value = null
      pollFailureCount = 0
      return
    }
    if (statusCode === 401) {
      toast.add({ title: '登录状态已过期', description: '请重新登录后再加载同步状态。', color: 'warning' })
      return
    }
    if (statusCode >= 400 && statusCode < 500) {
      toast.add({ title: '同步状态无法继续读取', description: errorMessage(failure), color: 'error' })
      return
    }
    pollFailureCount += 1
    if (pollFailureCount === 1) toast.add({ title: '同步状态读取失败，正在重试', description: errorMessage(failure), color: 'warning' })
    if (pollFailureCount <= 5) {
      scheduleJobPoll(Math.min(15_000, 1000 * 2 ** Math.min(pollFailureCount, 4)))
    } else {
      toast.add({ title: '同步状态重试已暂停', description: '请检查运行时状态后点击“刷新状态”。', color: 'error' })
    }
  } finally {
    jobLoading.value = false
  }
}

async function applyDepartmentChanges() {
  const run = changePreview.value?.run
  if (!run || applyingChanges.value || selectedChangeCodes.value.length === 0) return
  const authorization = await ensurePeoplePermission('hr_source_sync', 'admin')
  if (!authorization.authorized) {
    toast.add({ title: '当前角色无权限', description: '需要 People 人事事实源管理权限。', color: 'warning' })
    return
  }
  const highRisk = run.riskLevel === 'high'
  const accepted = await confirm({
    title: highRisk ? '确认高风险部门停用差异' : '确认停用缺失部门',
    message: `将停用 ${selectedChangeCodes.value.length} 个已从完整钉钉快照中消失的正式部门。\n系统会再次检查活跃人员主归属和子部门；稳定 dept_code 与历史记录不会删除。`,
    confirmLabel: highRisk ? '确认高风险停用' : '确认停用',
    tone: 'warning'
  })
  if (!accepted) return
  applyingChanges.value = true
  try {
    const result = await $fetch<Envelope<{ applied?: number, remaining?: number, status?: string }>>(
      peopleApiPath('/api/admin/hr-source-sync/dingtalk/department-changes'),
      {
        method: 'POST',
        body: {
          snapshotRunId: run.runId,
          snapshotHash: run.snapshotHash,
          departmentCodes: selectedChangeCodes.value
        }
      }
    )
    toast.add({
      title: '部门停用差异已应用',
      description: `已停用 ${result.data?.applied || selectedChangeCodes.value.length} 个部门，剩余 ${result.data?.remaining || 0} 个待处理。`,
      color: 'success'
    })
    await refreshChanges()
  } catch (failure) {
    toast.add({ title: '部门停用失败', description: errorMessage(failure), color: 'error' })
  } finally {
    applyingChanges.value = false
  }
}

async function startSync() {
  if (startSyncDisabled.value) return
  starting.value = true
  try {
    const authorization = await ensurePeoplePermission('hr_source_sync', 'execute')
    if (!authorization.authorized) {
      toast.add({ title: '当前角色无权限', description: '需要 People 人事事实源执行权限。', color: 'warning' })
      return
    }
    const result = await $fetch<Envelope<Job>>(peopleApiPath('/api/admin/hr-source-sync/dingtalk/jobs'), { method: 'POST' })
    currentJob.value = result.data || null
    toast.add({ title: '钉钉同步已启动', description: '正式部门、主归属及在离职状态将作为 People 事实写入。', color: 'success' })
    if (currentJob.value?.jobId) scheduleJobPoll(1000)
  } catch (failure) {
    toast.add({ title: '钉钉同步启动失败', description: errorMessage(failure), color: 'error' })
  } finally {
    starting.value = false
  }
}

async function mutateJob(action: 'cancel' | 'retry') {
  const jobId = currentJob.value?.jobId
  if (!jobId) return
  if (action === 'cancel') {
    const accepted = await confirm({
      title: '确认取消本次同步',
      message: '取消只会停止后续分页和批次；已经成功写入的部门、人员事实和生命周期操作不会回滚。',
      confirmLabel: '确认取消',
      tone: 'warning'
    })
    if (!accepted) return
  }
  try {
    const result = await $fetch<Envelope<Job>>(peopleApiPath(`/api/admin/hr-source-sync/dingtalk/jobs/${encodeURIComponent(jobId)}/${action}`), { method: 'POST' })
    currentJob.value = result.data || currentJob.value
    if (action === 'retry') scheduleJobPoll(1000)
  } catch (failure) {
    toast.add({ title: action === 'retry' ? '重试失败' : '取消失败', description: errorMessage(failure), color: 'error' })
  }
}

async function refreshPage() {
  await Promise.all([refresh(), refreshChanges()])
}

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => {
  setRefresh(refreshPage)
  if (currentJob.value?.jobId) scheduleJobPoll(250)
})
onBeforeUnmount(() => {
  clearRefresh()
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<template>
  <UDashboardPanel
    id="people-hr-source-sync"
    grow
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-landmark"
          title="钉钉接管正式行政组织事实"
          description="同步正式部门、人员主归属和在离职状态；委员会、虚拟组织、项目组及稳定 dept_code 仍由汇智云维护。"
        />
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="映射预览读取失败"
          :description="errorMessage(error)"
        />

        <div class="grid gap-4 lg:grid-cols-4">
          <UCard
            v-for="entry in [
              ['重复部门', preview?.totals.total || 0],
              ['已绑定', preview?.totals.mapped || 0],
              ['待确认', preview?.totals.suggested || 0],
              ['冲突/未匹配', (preview?.totals.conflict || 0) + (preview?.totals.unmatched || 0)]
            ]"
            :key="String(entry[0])"
          >
            <div class="text-sm text-muted">
              {{ entry[0] }}
            </div>
            <div class="mt-1 text-2xl font-semibold text-highlighted">
              {{ entry[1] }}
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="font-semibold text-highlighted">
                  重复部门归并
                </h2>
                <p class="mt-1 text-sm text-muted">
                  确认后保留汇智云稳定编码，并把旧钉钉部门成员及 People 任职引用迁移到该部门。
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="soft"
                  :loading="reconcilingMappings"
                  :disabled="mappedMappings.length === 0"
                  @click="reconcileMappedReferences"
                >
                  重新对账 People 引用
                </UButton>
                <UButton
                  icon="i-lucide-git-merge"
                  color="primary"
                  :disabled="pendingMappings.length === 0"
                  @click="confirmOpen = true"
                >
                  确认 {{ pendingMappings.length }} 项映射
                </UButton>
              </div>
            </div>
          </template>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="status === 'pending'"
            >
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-badge-check"
                  title="没有待迁移的重复部门"
                  description="可直接启动钉钉同步。"
                />
              </template>
              <template #state-cell="{ row }">
                <UBadge
                  :color="stateMeta[row.original.state].color"
                  variant="soft"
                >
                  {{ stateMeta[row.original.state].label }}
                </UBadge>
              </template>
              <template #target-cell="{ row }">
                <span
                  v-if="row.original.state === 'mapped'"
                  class="text-sm text-muted"
                >
                  {{ row.original.suggestedDeptCode }}
                </span>
                <USelect
                  v-else
                  v-model="mappingTargets[row.original.externalDepartmentId]"
                  :items="departmentOptions"
                  value-key="value"
                  searchable
                  placeholder="选择稳定部门"
                  class="min-w-64"
                />
              </template>
            </UTable>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="font-semibold text-highlighted">
                  钉钉组织同步
                </h2>
                <p class="mt-1 text-sm text-muted">
                  明确离职事实生效后，Console 会先关闭系统访问，再由可靠链路自动推进 Platform 授权撤销与策略状态更新。
                </p>
              </div>
              <UButton
                icon="i-lucide-refresh-cw"
                :loading="starting"
                :disabled="startSyncDisabled"
                @click="startSync"
              >
                {{ jobInProgress ? '同步处理中' : '启动同步' }}
              </UButton>
            </div>
          </template>
          <UAlert
            v-if="!readyToSync"
            color="warning"
            variant="soft"
            icon="i-lucide-shield-alert"
            title="需先完成重复部门映射"
            :description="`仍有 ${unresolvedCount} 个部门未确认，当前禁止启动同步。`"
          />
          <div
            v-else-if="currentJob"
            class="space-y-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                color="info"
                variant="soft"
              >
                {{ currentJob.status || 'queued' }}
              </UBadge>
              <span class="font-mono text-sm text-muted">{{ currentJob.jobId }}</span>
            </div>
            <div class="grid gap-3 lg:grid-cols-4">
              <div
                v-for="stage in jobStages"
                :key="stage.code"
                class="rounded-lg border border-muted bg-elevated/40 p-3"
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="text-sm font-medium text-highlighted">{{ stage.label }}</span>
                  <UBadge
                    :color="stage.color"
                    variant="soft"
                    size="sm"
                  >
                    {{ stage.state }}
                  </UBadge>
                </div>
                <p class="mt-2 text-xs leading-5 text-muted">
                  {{ stage.detail }}
                </p>
              </div>
            </div>
            <div
              v-if="currentJob.counts"
              class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted"
            >
              <span>部门 {{ currentJob.counts.departments || 0 }}</span>
              <span>人员 {{ currentJob.counts.users || 0 }}</span>
              <span>已应用 {{ currentJob.counts.applied || 0 }}</span>
              <span>跳过 {{ currentJob.counts.skipped || 0 }}</span>
              <span>批次 {{ currentJob.counts.batches || 0 }}</span>
            </div>
            <div
              v-if="currentJob.counts?.fieldCoverage?.length"
              class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
            >
              <div
                v-for="coverage in currentJob.counts.fieldCoverage"
                :key="coverage.field"
                class="rounded-md border border-muted px-3 py-2 text-xs"
              >
                <div class="mb-1 flex items-center justify-between gap-2">
                  <span class="font-medium text-highlighted">{{ fieldLabel[coverage.field] || coverage.field }}</span>
                  <span class="text-muted">共 {{ coverage.observed }}</span>
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-muted">
                  <span class="text-success">有效 {{ coverage.provided }}</span>
                  <span>空值 {{ coverage.empty }}</span>
                  <span :class="coverage.absent ? 'text-warning' : ''">未下发 {{ coverage.absent }}</span>
                  <span :class="coverage.invalid ? 'text-error' : ''">无效 {{ coverage.invalid }}</span>
                </div>
              </div>
            </div>
            <UAlert
              v-if="partialFieldsMissing"
              color="warning"
              variant="soft"
              icon="i-lucide-circle-alert"
              title="钉钉未下发部分员工字段"
              :description="currentJob.errorMessage"
            />
            <UAlert
              v-else-if="currentJob.errorMessage"
              color="error"
              variant="soft"
              title="同步任务失败"
              :description="currentJob.errorMessage"
            />
            <div class="flex gap-2">
              <UButton
                v-if="!jobTerminal"
                color="neutral"
                variant="outline"
                icon="i-lucide-circle-stop"
                @click="mutateJob('cancel')"
              >
                取消
              </UButton>
              <UButton
                v-if="String(currentJob.status).toLowerCase() === 'failed'"
                color="primary"
                variant="soft"
                icon="i-lucide-rotate-ccw"
                @click="mutateJob('retry')"
              >
                重试
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="jobLoading"
                @click="loadJob"
              >
                刷新状态
              </UButton>
            </div>
          </div>
          <CommonEmptyState
            v-else
            icon="i-lucide-cloud-cog"
            title="尚未启动同步"
            description="确认部门映射后，由 People 管理员启动钉钉同步。"
          />
        </UCard>

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="font-semibold text-highlighted">
                  部门停用差异
                </h2>
                <p class="mt-1 text-sm text-muted">
                  仅展示通过 final marker、根部门、计数和快照哈希校验后，从完整组织快照中消失的正式部门。
                </p>
              </div>
              <UButton
                v-if="changePreview?.run && changeRows.length > 0"
                color="warning"
                icon="i-lucide-building-2"
                :loading="applyingChanges"
                :disabled="selectedChangeCodes.length === 0"
                @click="applyDepartmentChanges"
              >
                确认停用 {{ selectedChangeCodes.length }} 个部门
              </UButton>
            </div>
          </template>

          <UAlert
            v-if="changesError"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="部门差异读取失败"
            :description="errorMessage(changesError)"
          />
          <div
            v-else-if="changePreview?.run"
            class="space-y-4"
          >
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <UBadge
                :color="changePreview.run.riskLevel === 'high' ? 'error' : changePreview.run.riskLevel === 'normal' ? 'warning' : 'success'"
                variant="soft"
              >
                {{ changePreview.run.riskLevel === 'high' ? '高风险差异' : changePreview.run.riskLevel === 'normal' ? '常规差异' : '无缺失' }}
              </UBadge>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ changePreview.run.status }}
              </UBadge>
              <span class="text-muted">
                已验证 {{ changePreview.run.seenDepartmentCount }}/{{ changePreview.run.reportedDepartmentCount }} 个部门，缺失 {{ changePreview.run.missingDepartmentCount }} 个（{{ (changePreview.run.missingDepartmentRatio * 100).toFixed(1) }}%）
              </span>
            </div>
            <UAlert
              v-if="changePreview.run.riskLevel === 'high'"
              color="error"
              variant="soft"
              icon="i-lucide-shield-alert"
              title="差异超过租户安全阈值"
              :description="`当前阈值为最多 ${changePreview.run.policyMaxMissingCount} 个且不超过 ${(changePreview.run.policyMaxMissingRatio * 100).toFixed(1)}%；根部门变化也会直接升级为高风险。必须由 People 管理员逐项确认。`"
            />
            <UAlert
              v-if="changePreview.run.rootMissing"
              color="error"
              variant="soft"
              icon="i-lucide-git-compare-arrows"
              title="检测到根部门变化"
              description="请先核实钉钉应用可见范围和根部门配置，避免把供应商 ID 变化误判为部门删除。"
            />
            <div
              v-if="changeRows.length > 0"
              class="overflow-x-auto"
            >
              <UTable
                :data="changeRows"
                :columns="changeColumns"
                :loading="changesStatus === 'pending'"
              >
                <template #selected-cell="{ row }">
                  <UCheckbox
                    v-model="selectedChanges[row.original.deptCode]"
                    :disabled="!row.original.canApply"
                    :aria-label="`选择 ${row.original.departmentName}`"
                  />
                </template>
                <template #status-cell="{ row }">
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                      :color="row.original.status === 'applied' ? 'success' : row.original.canApply ? 'warning' : 'error'"
                      variant="soft"
                    >
                      {{ row.original.status === 'applied' ? '已停用' : row.original.canApply ? '待确认' : '暂不可停用' }}
                    </UBadge>
                    <span
                      v-if="row.original.activePrimaryUserCount > 0"
                      class="text-xs text-error"
                    >仍有活跃主归属</span>
                    <span
                      v-if="row.original.blockingActiveChildCount > 0"
                      class="text-xs text-error"
                    >仍有未纳入子部门</span>
                  </div>
                </template>
              </UTable>
            </div>
            <CommonEmptyState
              v-else
              icon="i-lucide-badge-check"
              title="完整快照没有部门缺失"
              description="本次同步不会停用任何正式部门。"
            />
          </div>
          <CommonEmptyState
            v-else
            icon="i-lucide-scan-search"
            title="尚无已验证组织快照"
            description="完成一次新版钉钉组织同步后，这里会显示部门缺失差异和安全阈值结果。"
          />
        </UCard>

        <UModal
          v-model:open="confirmOpen"
          title="确认归并重复部门"
        >
          <template #body>
            <div class="space-y-4">
              <UAlert
                color="warning"
                variant="soft"
                icon="i-lucide-triangle-alert"
                title="该操作会停用旧的 DT-* 部门"
                description="成员关系和 People 任职引用会迁移到所选稳定部门；已存在的外部身份映射不可改绑。"
              />
              <p class="text-sm text-muted">
                即将应用 {{ pendingMappings.length }} 项映射。请确认目标部门选择无误。
              </p>
              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="confirmOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-git-merge"
                  :loading="applying"
                  @click="applyMappings"
                >
                  确认归并
                </UButton>
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
