<script setup lang="ts">
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

type Mapping = { externalDepartmentId: string, departmentName: string, state: string, suggestedDeptCode: string }
type Department = { deptCode: string, departmentName: string }
type Change = { deptCode: string, departmentName: string, canApply: boolean, blockedReasons: string[] }
type Preview = { items: Mapping[], departments: Department[], totals: Record<string, number> }
type Changes = { run: { runId: number, snapshotHash: string } | null, items: Change[] }
type Kind = 'mappings' | 'changes' | 'jobs-start' | 'jobs-cancel' | 'jobs-retry'
const { hasPermission, loaded, error: permissionError, loadPermissions } = usePermissions()
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission('hr_source_sync', 'view'))
const canAdmin = computed(() => loaded.value && !permissionError.value && hasPermission('hr_source_sync', 'admin'))
const canExecute = computed(() => loaded.value && !permissionError.value && hasPermission('hr_source_sync', 'execute'))
const { status: accessStatus } = useEnterpriseNavigationAccess()
const cacheScope = useState<string>('enterprise-cache-scope', () => '')
const base = '/enterprise/api/apf/people/hr-source/dingtalk'
const preview = ref<Preview | null>(null)
const changes = ref<Changes | null>(null)
const state = ref({ rowVersion: 1, remapPending: false, operationKey: '' })
const targets = reactive<Record<string, string>>({})
const selected = reactive<Record<string, boolean>>({})
const jobId = ref('')
const job = ref<Record<string, unknown> | null>(null)
const pending = ref(false)
const busy = ref(false)
const error = ref('')
const fieldErrors = ref<Record<string, string>>({})
// The shared helper retains the original key and request in RAM, never browser storage.
const intent = createConsoleMutationIntent('people-hr-source')
const retry = shallowRef<{ kind: Kind, command: Record<string, unknown>, expectedVersion: number, key: string } | null>(null)
const { confirm } = useConfirm()
const toast = useToast()
const columns = [{ accessorKey: 'departmentName', header: '钉钉部门' }, { accessorKey: 'state', header: '状态' }, { id: 'target', header: '稳定部门' }]
const changeColumns = [{ id: 'selected', header: '选择' }, { accessorKey: 'departmentName', header: '缺失部门' }, { accessorKey: 'blockedReasons', header: '限制' }]
const labels: Record<string, string> = { mapped: '已绑定', suggested: '待确认', conflict: '存在冲突', unmatched: '待选择', pending: '等待中', running: '处理中', succeeded: '成功', success: '成功', failed: '失败', cancelled: '已取消' }
const options = computed(() => preview.value?.departments.map(d => ({ label: d.departmentName, value: d.deptCode })) || [])
const ready = computed(() => !!preview.value && preview.value.totals.total === preview.value.totals.mapped && !state.value.remapPending)
let epoch = 0
async function load() {
  const current = ++epoch
  if (!canRead.value || accessStatus.value !== 'ready' || !cacheScope.value) {
    preview.value = null
    changes.value = null
    return
  }
  pending.value = true
  error.value = ''
  try {
    const [s, p, c] = await Promise.all([
      $fetch<{ data: typeof state.value }>(`${base}/state`),
      $fetch<{ data: Preview }>(`${base}/department-mappings`),
      $fetch<{ data: Changes }>(`${base}/department-changes`)
    ])
    if (current !== epoch) return
    state.value = s.data
    if ('resume' in s.data && s.data.resume && !retry.value) retry.value = s.data.resume as NonNullable<typeof retry.value>
    preview.value = p.data
    changes.value = c.data
    for (const row of p.data.items) if (!targets[row.externalDepartmentId] && row.suggestedDeptCode) targets[row.externalDepartmentId] = row.suggestedDeptCode
  } catch {
    if (current === epoch) error.value = '来源信息加载失败，请重试'
  } finally {
    if (current === epoch) pending.value = false
  }
}
async function mutate(kind: Kind, command: Record<string, unknown>, restoring = false) {
  if (busy.value || (!restoring && state.value.remapPending)) return
  const admin = kind === 'mappings' || kind === 'changes'
  if (admin ? !canAdmin.value : !canExecute.value) return
  if (!restoring && !await confirm({ title: admin ? '确认来源变更' : '确认同步作业操作', message: admin ? '将按已选择的稳定部门处理来源事实，未确认前禁止新的同步。' : '仅操作钉钉正式候选；不会批准任职变更。', tone: 'warning' })) return
  busy.value = true
  try {
    const payload = restoring && retry.value ? retry.value : { kind, command: structuredClone(command), expectedVersion: state.value.rowVersion, key: '' }
    retry.value = payload
    const path = payload.kind === 'mappings' ? 'department-mappings' : payload.kind === 'changes' ? 'department-changes' : `jobs/${payload.kind.slice(5)}`
    const request = { method: 'POST' as const, path: `${base}/${path}`, body: { expectedVersion: payload.expectedVersion, command: payload.command } }
    const send = async (req: typeof request, key: string) => {
      payload.key = key
      retry.value = payload
      const response = await $fetch<{ data: { target: Record<string, unknown> } }>(req.path, { method: req.method, headers: { 'Idempotency-Key': key }, body: req.body })
      if (response.data.target.jobId) jobId.value = String(response.data.target.jobId)
    }
    if (restoring && payload.key) await send(request, payload.key)
    else await intent.submit(request, (req, key) => send({ ...req, method: 'POST', body: request.body }, key))
    intent.reset()
    retry.value = null
    toast.add({ title: '操作已确认', color: 'success' })
    await load()
  } catch (failure) {
    fieldErrors.value = apfServerFieldErrors(failure, ['canonicalDeptCode', 'jobId', 'departmentCodes'])
    error.value = '操作尚未确认，请使用原键恢复；不要重新提交不同的命令'
  } finally {
    busy.value = false
  }
}
function applyMappings() {
  return mutate('mappings', { mappings: preview.value?.items.filter(r => r.state !== 'mapped' && targets[r.externalDepartmentId]).map(r => ({ externalDepartmentId: r.externalDepartmentId, canonicalDeptCode: targets[r.externalDepartmentId] })) || [] })
}
function applyChanges() {
  return mutate('changes', { snapshotRunId: changes.value?.run?.runId, snapshotHash: changes.value?.run?.snapshotHash, departmentCodes: changes.value?.items.filter(r => r.canApply && selected[r.deptCode]).map(r => r.deptCode) || [] })
}
async function loadJob() {
  if (!canRead.value || !jobId.value || busy.value) return
  try {
    job.value = (await $fetch<{ data: Record<string, unknown> }>(`${base}/jobs/${encodeURIComponent(jobId.value)}`)).data
  } catch {
    error.value = '作业状态读取失败'
  }
}
watch([canRead, accessStatus, cacheScope], () => {
  retry.value = null
  job.value = null
  jobId.value = ''
  void load()
})
onMounted(async () => {
  await loadPermissions()
  await load()
})
onBeforeUnmount(() => {
  epoch++
})
</script>

<template>
  <div class="space-y-4 min-w-0">
    <ContentPageHeader
      :hosted="true"
      title="人事事实源"
      breadcrumb="人力资源 / 组织与岗位 / 人事事实源"
      description="钉钉维护正式行政组织、主归属和在离职事实；岗位、职级、工资仍由 People 管理。冲突需复核，不自动批准任职。"
    />
    <UAlert
      v-if="permissionError"
      title="权限信息加载失败"
      color="error"
    />
    <CommonEmptyState
      v-else-if="loaded && !canRead"
      title="无权查看人事事实源"
    />
    <template v-else-if="canRead">
      <UAlert
        v-if="error"
        :title="error"
        color="error"
      />
      <UAlert
        v-if="state.remapPending"
        title="来源命令尚未确认"
        description="People 部门引用确认之前禁止新同步。刷新后仍需按原命令和原键恢复，不能跳过确认。"
        color="warning"
      />
      <UButton
        v-if="retry"
        :loading="busy"
        color="neutral"
        variant="outline"
        @click="mutate(retry.kind, retry.command, true)"
      >
        按原键恢复
      </UButton>
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">
              部门映射
            </h2><div class="flex gap-2">
              <UButton
                color="neutral"
                variant="outline"
                :loading="pending"
                @click="load"
              >
                刷新
              </UButton><UButton
                v-if="canAdmin"
                :disabled="state.remapPending || !preview?.items.some(r => r.state !== 'mapped' && targets[r.externalDepartmentId])"
                :loading="busy"
                @click="applyMappings"
              >
                确认映射
              </UButton>
            </div>
          </div>
        </template>
        <UTable
          :data="preview?.items || []"
          :columns="columns"
          :loading="pending"
        >
          <template #state-cell="{ row }">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ labels[row.original.state] || '待复核' }}
            </UBadge>
          </template>
          <template #target-cell="{ row }">
            <p
              v-if="fieldErrors.canonicalDeptCode"
              class="text-sm text-error"
            >
              {{ fieldErrors.canonicalDeptCode }}
            </p><APFDepartmentSelect
              v-if="canAdmin && row.original.state !== 'mapped'"
              v-model="targets[row.original.externalDepartmentId]"
              :allowed-codes="options.map(d => d.value)"
              class="w-48 max-w-full"

              :disabled="busy || state.remapPending"
            /><span v-else>{{ options.find(d => d.value === row.original.suggestedDeptCode)?.label || '待绑定' }}</span>
          </template>
          <template #empty>
            <CommonEmptyState
              title="暂无部门来源映射"
              description="请先在 Console 配置钉钉正式来源。"
            />
          </template>
        </UTable>
      </UCard>
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">
              来源差异复核
            </h2><UButton
              v-if="canAdmin"
              color="neutral"
              variant="outline"
              :disabled="!changes?.run || state.remapPending || !changes.items.some(r => r.canApply && selected[r.deptCode])"
              :loading="busy"
              @click="applyChanges"
            >
              确认已选差异
            </UButton>
          </div>
        </template>
        <UTable
          :data="changes?.items || []"
          :columns="changeColumns"
          :loading="pending"
        >
          <template #selected-cell="{ row }">
            <UCheckbox
              v-model="selected[row.original.deptCode]"
              :disabled="!canAdmin || !row.original.canApply || state.remapPending"
            />
          </template><template #empty>
            <CommonEmptyState title="暂无待确认部门差异" />
          </template>
        </UTable>
      </UCard>
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            组织与人员同步作业
          </h2>
        </template>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="canExecute"
            :disabled="!ready"
            :loading="busy"
            @click="mutate('jobs-start', {})"
          >
            启动同步
          </UButton><UInput
            v-model="jobId"
            placeholder="作业编码"
            class="w-full sm:w-72"
          /><UButton
            color="neutral"
            variant="outline"
            @click="loadJob"
          >
            查询状态
          </UButton><UButton
            v-if="canExecute"
            color="neutral"
            variant="outline"
            :disabled="!jobId || state.remapPending"
            @click="mutate('jobs-retry', { jobId })"
          >
            原作业重试
          </UButton><UButton
            v-if="canExecute"
            color="error"
            variant="outline"
            :disabled="!jobId || state.remapPending"
            @click="mutate('jobs-cancel', { jobId })"
          >
            取消作业
          </UButton>
        </div>
        <p
          v-if="job"
          class="mt-3 text-sm text-muted"
        >
          作业状态：{{ labels[String(job.status)] || '待核验' }}；目录投影、策略发布需以各自回执为准。
        </p>
      </UCard>
    </template>
  </div>
</template>
