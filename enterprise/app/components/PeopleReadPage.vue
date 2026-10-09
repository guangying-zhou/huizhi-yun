<script setup lang="ts">
import { apfEnumLabels, apfEnumLabel } from '../utils/apfFormPresentation'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import PeoplePrivateProfile from './PeoplePrivateProfile.vue'
import PeopleFactsEditor from './PeopleFactsEditor.vue'
import { useAltocDirectoryLabels as useDirectoryLabels } from '../composables/useAltocDirectoryLabels'

const { user } = useAuth()
const recoveryIntent = createConsoleMutationIntent('people-assignment-recovery')
const recovering = ref(false)
const recoveryError = ref('')
const props = defineProps<{ kind: 'employees' | 'assignments', detail?: boolean }>()
type Row = Record<string, string | number | null>
const route = useRoute()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission(props.kind, 'view'))
const canPrivate = computed(() => loaded.value && !permissionError.value && accessStatus.value === 'ready' && hasPermission('employees', 'edit'))
const title = computed(() => props.kind === 'employees' ? '员工' : '任职')
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<Row[]>([])
const total = ref(0)
const pending = ref(false)
const error = ref('')
let epoch = 0
const ownerUids = computed(() => rows.value.flatMap(r => [String(r.employee_uid || ''), String(r.manager_uid || '')]))
const { userName, departmentName, directoryError } = useDirectoryLabels(ownerUids)
const columns = computed<TableColumn<Row>[]>(() => props.kind === 'employees'
  ? [
      { accessorKey: 'employee_no', header: '员工编号' }, { accessorKey: 'display_name', header: '姓名' }, { accessorKey: 'employment_status', header: '状态' }, { accessorKey: 'dept_code', header: '部门' }, { accessorKey: 'position_name', header: '岗位' }, { id: 'actions', header: '详情' }
    ]
  : [
      { accessorKey: 'assignment_code', header: '任职编号' }, { accessorKey: 'employee_uid', header: '员工' }, { accessorKey: 'change_type', header: '变更类型' }, { accessorKey: 'dept_code', header: '部门' }, { accessorKey: 'position_name', header: '岗位' }, { accessorKey: 'approval_status', header: '审批状态' }, { id: 'actions', header: '详情' }
    ])
const labels: Record<string, string> = { active: '在职', inactive: '停用', left: '离职', pending: '待审批', approved: '已批准', rejected: '已拒绝', none: '无需审批', draft: '草稿', cancelled: '已取消', onboard: '入职', transfer: '调动', rank_change: '调级', leave: '离职', full_time: '全职', part_time: '兼职', outsourced: '外包', intern: '实习', agent: '代理' }
const recoveryPending = computed(() => props.detail && props.kind === 'assignments' && rows.value[0]?.approval_status === 'pending' && !rows.value[0]?.workflow_instance_id)
const canRecover = computed(() => recoveryPending.value && loaded.value && !permissionError.value && hasPermission('assignments', 'edit') && rows.value[0]?.created_by === user.value)
async function recover() {
  if (!canRecover.value || recovering.value) return
  recovering.value = true
  recoveryError.value = ''
  try {
    const row = rows.value[0]!
    const path = `/enterprise/api/apf/people/assignments/${row.id}/recover`
    const body = { employeeUid: row.employee_uid, expectedVersion: Number(row.row_version) }
    await recoveryIntent.submit({ method: 'POST', path, body }, async (request, key) => {
      await $fetch(request.path, { method: 'POST', body: request.body, headers: { 'Idempotency-Key': key } })
    })
    await load()
  } catch (e) {
    const status = Number((e as { statusCode?: number }).statusCode)
    recoveryError.value = status === 403 ? '仅发起人可恢复提交，且需任职编辑权限' : status === 409 ? '冻结记录或任职状态已变化，请刷新后检查' : '恢复结果尚未确认，请重试；不会创建重复审批'
  } finally { recovering.value = false }
}
const fieldLabels: Record<string, string> = { employee_no: '员工编号', display_name: '姓名', employment_status: '在职状态', employment_type: '用工类型', dept_code: '部门', position_name: '岗位', manager_uid: '负责人', onboard_date: '入职日期', leave_date: '离职日期', assignment_code: '任职编号', change_type: '变更类型', approval_status: '审批状态', effective_from: '生效日期', effective_to: '截止日期', rank_code: '职级编码', rank_name: '职级名称', cost_center_code: '成本中心', row_version: '版本' }
const visibleFields = computed(() => Object.entries(rows.value[0] || {}).filter(([k, v]) => fieldLabels[k] && v !== null && v !== ''))
function valueLabel(key: string, value: unknown) {
  if (key === 'manager_uid' || key === 'employee_uid')
    return userName(value)
  if (key === 'dept_code')
    return departmentName(value)
  return ['change_type', 'approval_status', 'employment_status', 'employment_type'].includes(key) ? labels[String(value)] || apfEnumLabels[String(value)] || apfEnumLabel(value) : String(value)
}
async function load() {
  const current = ++epoch
  rows.value = []
  if (!canRead.value || !scope.value || accessStatus.value !== 'ready') {
    total.value = 0
    return
  }
  pending.value = true
  error.value = ''
  try {
    const id = String(route.params.id || '')
    const base = `/enterprise/api/apf/people/${props.kind}`
    const response = await $fetch<{ data: { data: Row[] | Row, total?: number } }>(props.detail ? `${base}/${encodeURIComponent(id)}` : base, { query: props.detail ? {} : { page: page.value, pageSize: 20, search: debounced.value } })
    if (current !== epoch)
      return
    rows.value = Array.isArray(response.data.data) ? response.data.data : [response.data.data]
    total.value = response.data.total || 0
  } catch (e) {
    if (current === epoch)
      error.value = [403, 404].includes(Number((e as { statusCode?: number }).statusCode)) ? '该记录不在可访问范围内' : '读取失败，请重试'
  } finally {
    if (current === epoch)
      pending.value = false
  }
}
onMounted(() => {
  void loadPermissions()
})
watch([canRead, loaded, page, debounced, scope, accessStatus, () => route.params.id], () => {
  void load()
}, { immediate: true })
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div class="space-y-4 min-w-0 p-4">
        <ContentPageHeader
          :hosted="true"
          :title="`${title}${props.detail ? '详情' : '列表'}`"
          description="仅查看获授权范围内的人员事实；账号开通与激活暂未开放；私密档案另需员工编辑权限"
          :breadcrumb="`人力资源 / 员工管理 / ${title}`"
        >
          <template #actions>
            <UButton
              v-if="props.detail"
              :to="`/people/${props.kind}`"
              color="neutral"
              variant="outline"
            >
              返回列表
            </UButton>
          </template>
        </ContentPageHeader>
        <PeopleFactsEditor
          :kind="kind"
          :row="detail ? rows[0] : undefined"
          :allowed="loaded && !permissionError && accessStatus === 'ready' && hasPermission(kind, 'edit')"
          @saved="load"
        />
        <UAlert
          v-if="recoveryPending"
          color="warning"
          title="审批已提交但尚未关联流程实例"
          description="发起人可按原请求恢复提交，不会重复创建审批"
        >
          <template #actions>
            <UButton
              v-if="canRecover"
              :loading="recovering"
              @click="recover"
            >
              恢复提交
            </UButton>
          </template>
        </UAlert>
        <UAlert
          v-if="recoveryError"
          color="error"
          :title="recoveryError"
        />
        <UButton
          v-if="props.detail && props.kind === 'assignments' && rows[0]?.workflow_instance_id"
          :to="`/enterprise/approvals/${rows[0].workflow_instance_id}`"
          color="neutral"
          variant="outline"
        >
          查看审批流程
        </UButton>
        <PeoplePrivateProfile
          v-if="props.detail && props.kind === 'employees' && rows.length"
          :uid="String(rows[0]?.employee_uid || route.params.id || '')"
          :allowed="canPrivate"
        />
        <UAlert
          v-if="permissionError"
          color="error"
          title="权限信息加载失败"
        /><UAlert
          v-if="error"
          color="error"
          :title="error"
        /><UAlert
          v-if="directoryError"
          color="warning"
          title="目录姓名或部门信息暂不可用"
        />
        <UAlert
          v-if="props.kind === 'employees'"
          color="info"
          title="私密档案暂未开放"
          description="普通员工查看权限不包含薪资或私密信息"
        />
        <UCard v-if="props.detail && rows.length">
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              v-for="[key, value] in visibleFields"
              :key="key"
            >
              <dt class="text-sm text-muted">
                {{ fieldLabels[key] }}
              </dt><dd class="break-words">
                {{ valueLabel(key, value) }}
              </dd>
            </div>
          </dl>
        </UCard>
        <template v-else-if="!props.detail">
          <UInput
            v-model="search"
            placeholder="搜索编号或姓名"
            icon="i-lucide-search"
            class="w-full sm:max-w-xs"
            @keyup.enter="flush"
          /><div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="pending"
            >
              <template #empty>
                <CommonEmptyState
                  :title="canRead ? '暂无记录' : '无权查看'"
                  description="仅显示当前授权范围内的数据"
                />
              </template><template #employee_uid-cell="{ row }">
                {{ userName(row.original.employee_uid) }}
              </template><template #dept_code-cell="{ row }">
                {{ departmentName(row.original.dept_code) }}
              </template><template #employment_status-cell="{ row }">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ valueLabel('employment_status', row.original.employment_status) }}
                </UBadge>
              </template><template #approval_status-cell="{ row }">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ valueLabel('approval_status', row.original.approval_status) }}
                </UBadge>
              </template><template #change_type-cell="{ row }">
                {{ valueLabel('change_type', row.original.change_type) }}
              </template><template #actions-cell="{ row }">
                <UButton
                  :to="`/people/${props.kind}/${encodeURIComponent(String(props.kind === 'employees' ? row.original.employee_uid : row.original.id))}`"
                  color="neutral"
                  variant="outline"
                  size="xs"
                >
                  查看
                </UButton>
              </template>
            </UTable>
          </div><div class="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
              v-model:page="page"
              :items-per-page="20"
              :total="total"
            />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
