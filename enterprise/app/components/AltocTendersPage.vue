<script setup lang="ts">
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import type { TableColumn } from '@nuxt/ui'
import { tenderReadFailure } from '../../shared/altoc-tender-availability'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { formatMoney } from '../../../foundation/app/utils/format'
import { tenderFields, tenderStatuses, tenderTypes, tenderRoles, tenderMilestoneStatuses } from '../../shared/altoc-tenders'

const props = defineProps<{
  mode: 'list' | 'new' | 'detail'
}>()
type Row = Record<string, string | number | null>
type Detail = Row & {
  members: Row[]
  milestones: Row[]
}
const route = useRoute()
const id = computed(() => String(route.params.tenderId || ''))
const { user } = useAuth()
const { loaded, error: permissionError, loadPermissions, hasPermission } = usePermissions()
onMounted(() => void loadPermissions())
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('opportunity', 'edit'))
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission('opportunity', 'view'))
const scope = useState<string>('enterprise-cache-scope', () => '')
const { status: accessStatus } = useEnterpriseNavigationAccess()
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<Row[]>([])
const record = ref<Detail | null>(null)
const total = ref(0)
const busy = ref(false)
const saving = ref(false)
const error = ref('')
const unavailable = ref(false)
let epoch = 0
const ownerUids = computed(() => [...rows.value.map(r => String(r.owner_user_id || '')), String(record.value?.owner_user_id || ''), String(record.value?.presales_user_id || ''), ...(record.value?.members || []).map(r => String(r.user_id || '')), ...(record.value?.milestones || []).map(r => String(r.assignee_user_id || ''))])
const { userName, departmentName, directoryError } = useAltocDirectoryLabels(ownerUids)
const columns: TableColumn<Row>[] = [{ accessorKey: 'code', header: '编号' }, { accessorKey: 'name', header: '投标项目' }, { accessorKey: 'owner_user_id', header: '负责人' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'bid_submission_deadline', header: '投标截止' }, { accessorKey: 'bid_amount', header: '投标金额' }]
const memberColumns: TableColumn<Row>[] = [{ accessorKey: 'user_id', header: '成员' }, { accessorKey: 'role', header: '分工' }, { id: 'actions', header: '操作' }]
const milestoneColumns: TableColumn<Row>[] = [{ accessorKey: 'name', header: '节点' }, { accessorKey: 'due_date', header: '截止日期' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'assignee_user_id', header: '责任人' }, { id: 'actions', header: '操作' }]
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }))
const statusLabel = (v: unknown) => tenderStatuses[String(v) as keyof typeof tenderStatuses] || '未知状态'
async function load() {
  const n = ++epoch
  if (!scope.value || accessStatus.value !== 'ready' || !canRead.value || props.mode === 'new') {
    rows.value = []
    record.value = null
    return
  }
  busy.value = true
  error.value = ''
  unavailable.value = false
  try {
    const result = await $fetch<{
      code: number
      data: Detail & {
        items: Row[]
        total: number
      }
    }>(`/altoc/api/v1/tenders${props.mode === 'detail' ? `/${id.value}` : ''}`, { query: props.mode === 'list' ? { page: page.value, pageSize: 20, search: debounced.value } : {} })
    if (n !== epoch)
      return
    if (props.mode === 'detail')
      record.value = result.data
    else {
      rows.value = result.data.items
      total.value = result.data.total
    }
  } catch (failure) {
    if (n === epoch) {
      const state = tenderReadFailure(failure)
      unavailable.value = state.unavailable
      error.value = state.message
    }
  } finally {
    if (n === epoch)
      busy.value = false
  }
}
watch([id, scope, accessStatus, canRead, page, debounced], load, { immediate: true })

onBeforeUnmount(() => {
  epoch++
  rows.value = []
  record.value = null
})
const editing = ref(props.mode === 'new')
const draft = reactive<Record<string, string>>({})
const fieldErrors = ref<Record<string, string>>({})
watch(scope, () => {
  rows.value = []
  record.value = null
  editing.value = props.mode === 'new'
  for (const key of Object.keys(draft)) Reflect.deleteProperty(draft, key)
  if (props.mode === 'new') {
    draft.owner_uid = String(user.value || '')
    draft.status = 'info_gathering'
  }
})
const labels: Record<string, string> = { name: '项目名称', owner_uid: '负责人', owner_dept_code: '归属部门', opportunity_id: '关联商机', customer_id: '客户', agency_id: '招标代理 ID', contact_id: '客户联系人', status: '状态', tender_type: '招标方式', project_code: '甲方项目编号', tenderer_name: '招标人名称', budget_amount: '项目预算', bid_amount: '投标金额', bid_bond_amount: '保证金', publish_date: '公告日期', registration_deadline: '报名截止', bid_submission_deadline: '投标截止', bid_opening_date: '开标日期', winning_notice_date: '中标通知日期', winning_amount: '中标金额', presales_user_id: '售前负责人', contact_phone: '电话', contact_email: '邮箱', competitors: '竞争情况', key_requirements: '关键要求', lost_to: '中标方', lost_to_amount: '中标方金额', lost_reason_type: '落标原因类别', lost_reason_detail: '落标分析', improvement_suggestion: '改进建议', remark: '备注' }
const groups = [{ title: '基本信息', fields: ['name', 'owner_uid', 'owner_dept_code', 'status', 'tender_type', 'opportunity_id', 'customer_id', 'project_code', 'tenderer_name', 'agency_id', 'contact_id'] }, { title: '日期与金额', fields: ['publish_date', 'registration_deadline', 'bid_submission_deadline', 'bid_opening_date', 'winning_notice_date', 'budget_amount', 'bid_amount', 'bid_bond_amount', 'winning_amount'] }, { title: '联系与复盘', fields: ['presales_user_id', 'contact_phone', 'contact_email', 'competitors', 'key_requirements', 'lost_to', 'lost_to_amount', 'lost_reason_type', 'lost_reason_detail', 'improvement_suggestion', 'remark'] }]
const selectedOwner = computed({ get: () => draft.owner_uid ? [draft.owner_uid] : [], set: (v: string[]) => {
  draft.owner_uid = v[0] || ''
} })
const selectedPresales = computed({ get: () => draft.presales_user_id ? [draft.presales_user_id] : [], set: (v: string[]) => {
  draft.presales_user_id = v[0] || ''
} })
function beginEdit() {
  if (!intent.reset()) {
    error.value = '请先重试未完成的操作。'
    return
  }
  for (const k of tenderFields)
    draft[k] = String(record.value?.[k === 'owner_uid' ? 'owner_user_id' : k] || '').slice(0, k.endsWith('_date') || k.endsWith('_deadline') ? 10 : undefined)
  fieldErrors.value = {}
  editing.value = true
}
if (props.mode === 'new') {
  for (const k of tenderFields)
    draft[k] = ''
  draft.owner_uid = String(user.value || '')
  draft.status = 'info_gathering'
}
const intent = createConsoleMutationIntent('altoc-tender')
async function mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  if (saving.value)
    return
  saving.value = true
  error.value = ''
  try {
    let result: {
      id: string
    } | undefined
    await intent.submit({ path, method, body }, async (request, key) => {
      result = (await $fetch<{
        code: number
        data: {
          id: string
        }
      }>(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } })).data
    })
    return result
  } catch (e) {
    fieldErrors.value = apfServerFieldErrors(e, tenderFields)
    const failure = e as {
      statusCode?: number
      data?: {
        message?: string
      }
    }
    error.value = failure.statusCode === 409 ? '资料已变化，请刷新后重试。' : failure.statusCode === 403 ? '当前无权执行此操作。' : failure.statusCode === 400 ? (failure.data?.message || '请检查必填项、日期与金额。') : '操作未完成，可使用原操作重试。'
  } finally {
    saving.value = false
  }
}
async function save() {
  fieldErrors.value = {}
  for (const k of ['name', 'owner_uid'])
    if (!draft[k]?.trim())
      fieldErrors.value[k] = `${labels[k]}为必填项`
  for (const k of ['budget_amount', 'bid_amount', 'bid_bond_amount', 'winning_amount', 'lost_to_amount'])
    if (draft[k] && !/^\d{1,16}(\.\d{1,2})?$/.test(draft[k]!))
      fieldErrors.value[k] = '请输入非负金额，最多两位小数'
  if (Object.keys(fieldErrors.value).length)
    return
  const payload: Record<string, unknown> = Object.fromEntries(tenderFields.filter(k => draft[k]).map(k => [k, draft[k]]))
  if (props.mode !== 'new') {
    payload.expectedVersion = Number(record.value?.row_version)
    for (const k of tenderFields)
      if (!draft[k] && record.value?.[k])
        payload[k] = ''
  }
  const result = await mutate(`/altoc/api/v1/tenders${props.mode === 'new' ? '' : `/${id.value}`}`, props.mode === 'new' ? 'POST' : 'PATCH', payload)
  if (result) {
    editing.value = false
    if (props.mode === 'new')
      await navigateTo(`/altoc/tenders/${result.id}`)
    else
      await load()
  }
}
const childOpen = ref(false)
const childKind = ref<'member' | 'milestone' | 'agency'>('member')
const child = reactive<Record<string, string>>({})
const memberUids = computed({ get: () => child.user_id ? [String(child.user_id)] : [], set: (v: string[]) => {
  child.user_id = v[0] || ''
} })
const assigneeUids = computed({ get: () => child.assignee_user_id ? [String(child.assignee_user_id)] : [], set: (v: string[]) => {
  child.assignee_user_id = v[0] || ''
} })
function beginChild(kind: typeof childKind.value, row?: Row) {
  if (!intent.reset()) {
    error.value = '请先重试未完成的操作。'
    return
  }
  childKind.value = kind
  for (const k of Object.keys(child))
    Reflect.deleteProperty(child, k)
  Object.assign(child, Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, v === null ? '' : String(v)])))
  if (kind === 'member')
    child.role = 'member'
  if (kind === 'milestone' && !row)
    child.status = 'todo'
  childOpen.value = true
}
async function saveChild() {
  const kind = childKind.value
  const required = kind === 'member' ? 'user_id' : 'name'
  if (!String(child[required] || '').trim()) {
    error.value = '请填写名称或选择成员'
    return
  }
  const existing = child.id
  const keys = kind === 'member' ? ['user_id', 'role'] : kind === 'agency' ? ['name', 'agency_type', 'address', 'contact_name', 'contact_phone', 'contact_email'] : ['name', 'due_date', 'status', 'assignee_user_id', 'sort_no', 'remark']
  const body: Record<string, unknown> = Object.fromEntries(keys.filter(k => child[k] !== undefined && child[k] !== '').map(k => [k, child[k]]))
  if (kind === 'milestone' && body.sort_no !== undefined)
    body.sort_no = Number(body.sort_no)
  if (kind !== 'agency')
    body.expectedVersion = Number(record.value?.row_version)
  const path = kind === 'agency' ? '/altoc/api/v1/tenders/agencies' : `/altoc/api/v1/tenders/${id.value}/${kind === 'member' ? 'members' : 'milestones'}${existing ? `/${existing}` : ''}`
  const result = await mutate(path, existing ? 'PATCH' : 'POST', body)
  if (result) {
    childOpen.value = false
    if (kind === 'agency')
      draft.agency_id = result.id
    else
      await load()
  }
}
const agencyPicker = ref(false)
const agencyPage = ref(1)
const agencyRows = ref<Row[]>([])
const agencyTotal = ref(0)
const agencyLoading = ref(false)
const agencyError = ref('')
const { search: agencySearch, debounced: agencyDebounced, flush: agencyFlush } = useDebouncedSearch({ onChange: () => {
  agencyPage.value = 1
} })
const agencyColumns: TableColumn<Row>[] = [{ accessorKey: 'name', header: '招标代理' }, { accessorKey: 'contact_name', header: '联系人' }, { id: 'actions', header: '操作' }]
let agencyEpoch = 0
async function loadAgencies() {
  const n = ++agencyEpoch
  if (!agencyPicker.value || !canRead.value) {
    agencyRows.value = []
    return
  }
  agencyLoading.value = true
  agencyError.value = ''
  try {
    const result = await $fetch<{ code: number, data: { items: Row[], total: number } }>('/altoc/api/v1/tenders/agencies', { query: { page: agencyPage.value, pageSize: 20, search: agencyDebounced.value } })
    if (n === agencyEpoch) {
      agencyRows.value = result.data.items
      agencyTotal.value = result.data.total
    }
  } catch {
    if (n === agencyEpoch) agencyError.value = '招标代理加载失败，请重试。'
  } finally {
    if (n === agencyEpoch) agencyLoading.value = false
  }
}
watch([agencyPicker, agencyPage, agencyDebounced, scope, canRead], loadAgencies)
function selectAgency(row: Row) {
  draft.agency_id = String(row.id)
  agencyPicker.value = false
}
onBeforeUnmount(() => {
  agencyEpoch++
})
const { confirm } = useConfirm()
async function removeMember(row: Row) {
  if (!await confirm({ title: `移除 ${userName(row.user_id)}`, message: '将从此投标团队移除该成员，不改变其应用权限。', tone: 'danger' }))
    return
  if (await mutate(`/altoc/api/v1/tenders/${id.value}/members/${row.id}`, 'DELETE', { expectedVersion: Number(record.value?.row_version) }))
    await load()
}
</script>

<template>
  <UDashboardPanel id="altoc-tenders">
    <template #header>
      <ContentPageHeader
        :title="mode === 'list' ? '投标' : mode === 'new' ? '新建投标' : String(record?.name || '投标详情')"
        hosted
        breadcrumb="销售 / 商机推进 / 投标"
        description="维护投标信息、团队分工与关键节点；不改变商机权限。"
      >
        <template #actions>
          <UButton
            v-if="mode !== 'list'"
            to="/altoc/tenders"
            color="neutral"
            variant="outline"
          >
            返回投标列表
          </UButton>
          <UButton
            v-if="canEdit && !unavailable && mode === 'list'"
            to="/altoc/tenders/new"
          >
            新建投标
          </UButton>
          <UButton
            v-if="canEdit && !unavailable && mode === 'detail' && !editing"
            @click="beginEdit"
          >
            编辑投标
          </UButton>
        </template>
      </ContentPageHeader>
    </template>
    <template #body>
      <UAlert
        v-if="permissionError"
        color="error"
        title="权限信息加载失败"
      />
      <UAlert
        v-if="error"
        color="error"
        :title="error"
      />
      <UAlert
        v-if="directoryError"
        color="warning"
        title="目录姓名暂不可用"
      />
      <template v-if="mode === 'list' && canRead && !error">
        <UInput
          v-model="search"
          placeholder="搜索投标名称"
          class="w-full sm:max-w-sm"
          @keydown.enter="flush"
        />
        <div class="overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="busy"
          >
            <template #name-cell="{ row }">
              <NuxtLink
                :to="`/altoc/tenders/${row.original.id}`"
                class="block max-w-64 truncate text-primary"
              >{{ row.original.name }}</NuxtLink>
            </template>
            <template #owner_user_id-cell="{ row }">
              {{ userName(row.original.owner_user_id) }}
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ statusLabel(row.original.status) }}
              </UBadge>
            </template>
            <template #bid_amount-cell="{ row }">
              <span class="block text-right tabular-nums">{{ formatMoney(row.original.bid_amount) }}</span>
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-gavel"
                title="暂无投标"
                :description="canEdit ? '调整搜索条件，或新建投标。' : '调整搜索条件后重试。'"
              >
                <UButton
                  v-if="canEdit"
                  to="/altoc/tenders/new"
                >
                  新建投标
                </UButton>
              </CommonEmptyState>
            </template>
          </UTable>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <p>共 {{ total }} 条</p><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </div>
      </template>
      <template v-if="editing && canEdit">
        <form
          class="space-y-5"
          @submit.prevent="save"
        >
          <UCard
            v-for="group in groups"
            :key="group.title"
          >
            <template #header>
              <h2 class="font-semibold">
                {{ group.title }}
              </h2>
            </template>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UFormField
                v-for="key in group.fields"
                :key="key"
                :label="labels[key]"
                :error="fieldErrors[key]"
                :required="['name', 'owner_uid'].includes(key)"
              >
                <UserTreeSelector
                  v-if="key === 'owner_uid'"
                  v-model="selectedOwner"
                  selection-mode="single"
                  hide-committees
                  width-class="w-full"
                />
                <UserTreeSelector
                  v-else-if="key === 'presales_user_id'"
                  v-model="selectedPresales"
                  selection-mode="single"
                  hide-committees
                  width-class="w-full"
                />
                <APFDepartmentSelect
                  v-else-if="key === 'owner_dept_code'"
                  v-model="draft.owner_dept_code"
                />
                <div
                  v-else-if="key === 'agency_id'"
                  class="flex flex-wrap gap-2"
                >
                  <p class="text-sm text-muted">
                    {{ agencyRows.find(a => String(a.id) === draft.agency_id)?.name || '尚未选择招标代理' }}
                  </p>
                  <UButton
                    color="neutral"
                    variant="outline"
                    @click="agencyPicker = true"
                  >
                    选择招标代理
                  </UButton>
                </div>
                <AltocBusinessObjectSelect
                  v-else-if="key === 'customer_id'"
                  v-model="draft[key]!"
                  kind="customers"
                  :enabled="canEdit && mode !== 'list'"
                />
                <AltocBusinessObjectSelect
                  v-else-if="key === 'opportunity_id'"
                  v-model="draft[key]!"
                  kind="opportunities"
                  :enabled="canEdit && mode !== 'list'"
                />
                <AltocBusinessObjectSelect
                  v-else-if="key === 'contact_id'"
                  v-model="draft[key]!"
                  kind="contacts"
                  :parent-id="draft.customer_id"
                  :enabled="canEdit && mode !== 'list'"
                />
                <USelectMenu
                  v-else-if="key === 'status'"
                  v-model="draft[key]"
                  value-key="value"
                  :items="options(tenderStatuses)"
                  class="w-full"
                />
                <USelectMenu
                  v-else-if="key === 'tender_type'"
                  v-model="draft[key]"
                  value-key="value"
                  :items="options(tenderTypes)"
                  class="w-full"
                />
                <USelectMenu
                  v-else-if="key === 'lost_reason_type'"
                  v-model="draft[key]"
                  value-key="value"
                  :items="options({ price: '价格', technical: '技术', qualification: '资质', relationship: '关系', other: '其他' })"
                  class="w-full"
                />
                <UTextarea
                  v-else-if="['competitors', 'key_requirements', 'lost_reason_detail', 'improvement_suggestion', 'remark'].includes(key)"
                  v-model="draft[key]"
                  class="w-full"
                />
                <UInput
                  v-else
                  v-model="draft[key]"
                  :type="key.endsWith('_date') || key.endsWith('_deadline') ? 'date' : 'text'"
                  class="w-full"
                />
              </UFormField>
            </div>
          </UCard>
          <div class="flex flex-wrap gap-2">
            <UButton
              type="submit"
              :loading="saving"
            >
              保存投标
            </UButton><UButton
              v-if="mode === 'detail'"
              color="neutral"
              variant="outline"
              @click="editing = false"
            >
              取消
            </UButton><UButton
              color="neutral"
              variant="outline"
              @click="beginChild('agency')"
            >
              新建招标代理
            </UButton>
          </div>
        </form>
      </template>
      <template v-else-if="mode === 'detail' && record">
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              投标信息
            </h2>
          </template><dl class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <template
              v-for="key in tenderFields.filter(k => record?.[k === 'owner_uid' ? 'owner_user_id' : k] !== null && record?.[k === 'owner_uid' ? 'owner_user_id' : k] !== undefined && record?.[k === 'owner_uid' ? 'owner_user_id' : k] !== '')"
              :key="key"
            >
              <div class="min-w-0">
                <dt class="text-sm text-muted">
                  {{ labels[key] }}
                </dt><dd class="break-words">
                  {{ key === 'owner_uid' ? userName(record.owner_user_id) : key === 'presales_user_id' ? userName(record.presales_user_id) : key === 'owner_dept_code' ? departmentName(record.owner_dept_code) : key === 'status' ? statusLabel(record.status) : key === 'tender_type' ? tenderTypes[String(record.tender_type) as keyof typeof tenderTypes] : record[key] }}
                </dd>
              </div>
            </template>
          </dl>
        </UCard>
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold">
                投标团队
              </h2><UButton
                v-if="canEdit"
                color="neutral"
                variant="outline"
                @click="beginChild('member')"
              >
                添加成员
              </UButton>
            </div>
          </template><div class="overflow-x-auto">
            <UTable
              :data="record.members"
              :columns="memberColumns"
              :loading="busy"
            >
              <template #user_id-cell="{ row }">
                {{ userName(row.original.user_id) }}
              </template><template #role-cell="{ row }">
                {{ tenderRoles[String(row.original.role) as keyof typeof tenderRoles] }}
              </template><template #actions-cell="{ row }">
                <UButton
                  v-if="canEdit"
                  color="error"
                  variant="ghost"
                  @click="removeMember(row.original)"
                >
                  移除
                </UButton>
              </template><template #empty>
                <CommonEmptyState
                  icon="i-lucide-users"
                  title="暂无团队成员"
                  description="按投标分工添加团队成员。"
                />
              </template>
            </UTable>
          </div>
        </UCard>
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold">
                关键节点
              </h2><UButton
                v-if="canEdit"
                color="neutral"
                variant="outline"
                @click="beginChild('milestone')"
              >
                添加节点
              </UButton>
            </div>
          </template><div class="overflow-x-auto">
            <UTable
              :data="record.milestones"
              :columns="milestoneColumns"
              :loading="busy"
            >
              <template #status-cell="{ row }">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ tenderMilestoneStatuses[String(row.original.status) as keyof typeof tenderMilestoneStatuses] }}
                </UBadge>
              </template><template #assignee_user_id-cell="{ row }">
                {{ userName(row.original.assignee_user_id) }}
              </template><template #actions-cell="{ row }">
                <UButton
                  v-if="canEdit"
                  color="neutral"
                  variant="ghost"
                  @click="beginChild('milestone', row.original)"
                >
                  编辑
                </UButton>
              </template><template #empty>
                <CommonEmptyState
                  icon="i-lucide-flag"
                  title="暂无关键节点"
                  description="维护投标的截止日期和责任人。"
                />
              </template>
            </UTable>
          </div>
        </UCard>
      </template>
      <CommonEmptyState
        v-if="loaded && !permissionError && !canRead"
        title="无权查看投标"
        description="需要商机查看权限。"
      />
      <UModal
        v-model:open="agencyPicker"
        title="选择招标代理"
        description="搜索并选择共享代理字典，不改变投标或应用权限。"
      >
        <template #body>
          <UAlert
            v-if="agencyError"
            color="error"
            :title="agencyError"
          />
          <UInput
            v-model="agencySearch"
            placeholder="搜索代理名称"
            class="w-full"
            @keydown.enter="agencyFlush"
          />
          <div class="overflow-x-auto">
            <UTable
              :data="agencyRows"
              :columns="agencyColumns"
              :loading="agencyLoading"
            >
              <template #actions-cell="{ row }">
                <UButton
                  color="neutral"
                  variant="outline"
                  @click="selectAgency(row.original)"
                >
                  选择
                </UButton>
              </template><template #empty>
                <CommonEmptyState
                  icon="i-lucide-building"
                  title="暂无招标代理"
                  description="调整搜索条件，或在投标编辑页新建代理。"
                />
              </template>
            </UTable>
          </div>
          <p>共 {{ agencyTotal }} 条</p><UPagination
            v-model:page="agencyPage"
            :total="agencyTotal"
            :items-per-page="20"
          />
        </template>
      </UModal>
      <UModal
        v-model:open="childOpen"
        :title="childKind === 'agency' ? '新建招标代理' : childKind === 'member' ? '添加投标成员' : '维护关键节点'"
        description="仅维护当前投标的业务信息，不授予应用权限。"
      >
        <template #body>
          <div class="space-y-4">
            <UAlert
              v-if="error"
              color="error"
              :title="error"
            />
            <template v-if="childKind === 'member'">
              <UFormField
                label="成员"
                required
              >
                <UserTreeSelector
                  v-model="memberUids"
                  selection-mode="single"
                  hide-committees
                  width-class="w-full"
                />
              </UFormField><UFormField label="分工">
                <USelectMenu
                  v-model="child.role"
                  value-key="value"
                  :items="options(tenderRoles)"
                  class="w-full"
                />
              </UFormField>
            </template>
            <template v-else>
              <UFormField
                label="名称"
                required
              >
                <UInput
                  v-model="child.name"
                  class="w-full"
                />
              </UFormField><template v-if="childKind === 'milestone'">
                <UFormField label="截止日期">
                  <UInput
                    v-model="child.due_date"
                    type="date"
                    class="w-full"
                  />
                </UFormField><UFormField label="状态">
                  <USelectMenu
                    v-model="child.status"
                    value-key="value"
                    :items="options(tenderMilestoneStatuses)"
                    class="w-full"
                  />
                </UFormField><UFormField label="责任人">
                  <UserTreeSelector
                    v-model="assigneeUids"
                    selection-mode="single"
                    hide-committees
                    width-class="w-full"
                  />
                </UFormField><UFormField label="排序">
                  <UInput
                    v-model="child.sort_no"
                    type="number"
                  />
                </UFormField><UFormField label="备注">
                  <UTextarea
                    v-model="child.remark"
                    class="w-full"
                  />
                </UFormField>
              </template><template v-else>
                <UFormField
                  label="代理类型"
                  required
                >
                  <USelectMenu
                    v-model="child.agency_type"
                    value-key="value"
                    :items="options({ government: '政府', group: '集团', third_party: '第三方' })"
                    class="w-full"
                  />
                </UFormField><UFormField
                  v-for="key in ['address', 'contact_name', 'contact_phone', 'contact_email']"
                  :key="key"
                  :label="({ address: '地址', contact_name: '联系人', contact_phone: '电话', contact_email: '邮箱' } as Record<string, string>)[key]"
                >
                  <UInput
                    v-model="child[key]"
                    class="w-full"
                  />
                </UFormField>
              </template>
            </template>
            <UButton
              :loading="saving"
              @click="saveChild"
            >
              保存
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
