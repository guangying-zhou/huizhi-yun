<script setup lang="ts">
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import AltocFinancialSummaryPanel from './AltocFinancialSummaryPanel.vue'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { agreementFields, coverageFields } from '../../shared/altoc-service-agreements'

const props = defineProps<{ mode: 'list' | 'new' | 'detail' }>()
type Row = Record<string, string | number | boolean | null>
const route = useRoute()
const id = computed(() => String(route.params.agreementId || ''))
const { user } = useAuth()
const { loaded, error: permissionError, loadPermissions, hasPermission } = usePermissions()
onMounted(() => void loadPermissions())
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission('contract', 'view'))
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('contract', 'edit'))
const scope = useState<string>('enterprise-cache-scope', () => '')
const { status: accessStatus } = useEnterpriseNavigationAccess()
const ready = computed(() => Boolean(scope.value) && accessStatus.value === 'ready' && canRead.value)
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<Row[]>([])
const total = ref(0)
const record = ref<Row | null>(null)
const coverages = ref<Row[]>([])
const projects = ref<Row[]>([])
const coverageTotal = ref(0)
const projectTotal = ref(0)
const coveragePage = ref(1)
const projectPage = ref(1)
const busy = ref(false)
const saving = ref(false)
const error = ref('')
const api = computed(() => `/altoc/api/v1/service-agreements${props.mode === 'detail' ? `/${id.value}` : ''}`)
let epoch = 0
const draft = reactive<Record<string, string>>({})
const names = computed(() => [...rows.value.map(r => String(r.owner_user_id || '')), String(record.value?.owner_user_id || ''), String(draft.owner_user_id || '')])
const { userName, directoryError } = useAltocDirectoryLabels(names)
const statuses: Record<string, string> = { planned: '待生效', active: '有效', suspended: '已暂停', expired: '已到期', terminated: '已终止', cancelled: '已取消', ended: '已结束', pending: '待解析', resolved: '已解析', needs_review: '待核对' }
const targets: Record<string, string> = { pending_plan: '合同资产计划', delivery_asset: '正式交付资产', environment: '正式环境', delivery_asset_environment: '交付资产与环境' }
const roles: Record<string, string> = { maintenance: '维保', operation: '运营', inspection: '巡检', upgrade: '升级', special: '专项' }
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }))
const columns: TableColumn<Row>[] = [{ accessorKey: 'code', header: '协议编号' }, { accessorKey: 'name', header: '服务协议' }, { accessorKey: 'owner_user_id', header: '负责人' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'service_end_date', header: '服务截止' }]
const coverageColumns: TableColumn<Row>[] = [{ accessorKey: 'coverage_code', header: '覆盖编号' }, { accessorKey: 'target_type', header: '对象类型' }, { id: 'target', header: '覆盖对象' }, { accessorKey: 'resolution_status', header: '解析状态' }, { accessorKey: 'coverage_status', header: '状态' }, { id: 'actions', header: '操作' }]
const projectColumns: TableColumn<Row>[] = [{ accessorKey: 'project_code', header: '项目编码' }, { accessorKey: 'project_role', header: '用途' }, { accessorKey: 'is_default', header: '默认项目' }, { accessorKey: 'status', header: '状态' }, { id: 'actions', header: '操作' }]
async function load() {
  const n = ++epoch

  if (!ready.value || props.mode === 'new') {
    rows.value = []
    record.value = null
    coverages.value = []
    projects.value = []
    return
  }

  busy.value = true

  error.value = ''

  try {
    const result = await $fetch<{ code: number, data: Row & { items: Row[], total: number } }>(api.value, { query: props.mode === 'list' ? { page: page.value, pageSize: 20, search: debounced.value } : {} })

    if (n !== epoch) return

    if (props.mode === 'list') {
      rows.value = result.data.items
      total.value = result.data.total
    } else {
      record.value = result.data

      const [c, p] = await Promise.all([
        $fetch<{ data: { items: Row[], total: number } }>(`${api.value}/coverages`, { query: { page: coveragePage.value, pageSize: 20 } }),
        $fetch<{ data: { items: Row[], total: number } }>(`${api.value}/projects`, { query: { page: projectPage.value, pageSize: 20 } })
      ])

      if (n !== epoch) return

      coverages.value = c.data.items
      coverageTotal.value = c.data.total

      projects.value = p.data.items
      projectTotal.value = p.data.total
    }
  } catch {
    if (n === epoch) error.value = '服务协议资料加载失败，请重试。'
  } finally {
    if (n === epoch) busy.value = false
  }
}
watch([ready, id, scope, page, debounced, coveragePage, projectPage], load, { immediate: true })
onBeforeUnmount(() => {
  epoch++
  record.value = null
  rows.value = []
  coverages.value = []
  projects.value = []
})
const editing = ref(props.mode === 'new')
const selectedOwner = computed({ get: () => draft.owner_user_id ? [draft.owner_user_id] : [], set: (v: string[]) => {
  draft.owner_user_id = v[0] || ''
} })
const labels: Record<string, string> = { name: '协议名称', contract_id: '所属合同', contract_line_id: '合同行 ID（可选）', owner_user_id: '负责人', service_level: '服务等级', service_start_date: '服务开始', service_end_date: '服务结束', service_window: '服务窗口', billing_mode: '计费方式', renewal_policy: '续约规则', response_minutes: '响应时限（分钟）', resolution_minutes: '解决时限（分钟）', included_quota: '包含额度', quota_unit: '额度单位', renewal_remind_at: '续约提醒日期', status: '协议状态' }
const groups = [{ title: '基本信息', fields: ['name', 'owner_user_id', 'service_level', 'status'] }, { title: '服务与响应', fields: ['service_start_date', 'service_end_date', 'service_window', 'response_minutes', 'resolution_minutes'] }, { title: '额度与续约', fields: ['billing_mode', 'included_quota', 'quota_unit', 'renewal_policy', 'renewal_remind_at'] }]
const fieldErrors = ref<Record<string, string>>({})
const intent = createConsoleMutationIntent('altoc-service-agreement')
function startEdit() {
  if (!intent.reset()) {
    error.value = '请先重试未完成的操作。'
    return
  }

  for (const field of agreementFields) draft[field] = String(record.value?.[field] ?? '').slice(0, field.endsWith('_date') || field.endsWith('_at') ? 10 : undefined)

  fieldErrors.value = {}
  editing.value = true
}
function resetDraft() {
  for (const key of Object.keys(draft)) Reflect.deleteProperty(draft, key)

  if (props.mode === 'new') {
    draft.owner_user_id = String(user.value || '')
    draft.status = 'planned'
  }
}
resetDraft()
watch(scope, () => {
  resetDraft()
  editing.value = props.mode === 'new'
  dialog.value = false
})
async function mutate(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  if (saving.value || !canEdit.value || !ready.value) return

  saving.value = true
  error.value = ''

  try {
    let created = ''

    await intent.submit({ path, method, body }, async (request, key) => {
      const response = await $fetch<{ data: { id: string } }>(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } })

      created = String(response.data.id)
    })

    intent.reset()
    dialog.value = false
    editing.value = false

    if (props.mode === 'new') await navigateTo(`/altoc/service-agreements/${created}`)
    else await load()
  } catch (failure) {
    fieldErrors.value = apfServerFieldErrors(failure, Object.keys(body))
    error.value = '操作未完成。请核对权限、对象归属和版本；结果未确认时请保持原内容重试。'
  } finally {
    saving.value = false
  }
}
async function save() {
  fieldErrors.value = {}

  if (!draft.name?.trim()) fieldErrors.value.name = '请填写协议名称'

  if (props.mode === 'new' && !draft.contract_id) fieldErrors.value.contract_id = '请选择所属合同'

  if (Object.keys(fieldErrors.value).length) return

  const body: Record<string, unknown> = {}

  for (const k of agreementFields) {
    const value = draft[k]?.trim()

    body[k] = value ? (k.endsWith('_minutes') ? Number(value) : value) : null
  }

  if (props.mode === 'new') {
    body.contract_id = draft.contract_id
    if (draft.contract_line_id) body.contract_line_id = draft.contract_line_id
  } else body.expectedVersion = Number(record.value?.row_version)

  await mutate(api.value, props.mode === 'new' ? 'POST' : 'PATCH', body)
}
const dialog = ref(false)
const dialogMode = ref<'coverage' | 'resolve' | 'project'>('coverage')
const childId = ref('')
const childDraft = reactive<Record<string, string>>({})
function openChild(mode: 'coverage' | 'resolve' | 'project', row?: Row) {
  if (!intent.reset()) {
    error.value = '请先重试未完成的操作。'
    return
  }

  for (const key of Object.keys(childDraft)) Reflect.deleteProperty(childDraft, key)

  dialogMode.value = mode
  childId.value = String(row?.id || '')

  childDraft.target_type = mode === 'resolve' ? 'delivery_asset' : 'pending_plan'

  childDraft.project_role = 'maintenance'
  dialog.value = true
}
async function saveChild() {
  const body: Record<string, unknown> = { expectedVersion: Number(record.value?.row_version) }

  if (dialogMode.value === 'project') {
    if (!childDraft.project_code?.trim()) {
      error.value = '请填写项目编码。'
      return
    }

    body.project_code = childDraft.project_code.trim()
    body.project_role = childDraft.project_role

    await mutate(`${api.value}/projects`, 'POST', body)
  } else {
    for (const k of coverageFields) if (childDraft[k]?.trim()) body[k] = childDraft[k].trim()

    const target = childDraft.target_type

    if ((target === 'pending_plan' && !body.source_plan_code) || (target !== 'pending_plan' && ((target !== 'environment' && !body.delivery_asset_code) || (target !== 'delivery_asset' && !body.environment_code)))) {
      error.value = '请填写完整的覆盖对象编码。'
      return
    }

    await mutate(dialogMode.value === 'resolve' ? `${api.value}/coverages/${childId.value}/resolve` : `${api.value}/coverages`, 'POST', body)
  }
}
watch(() => childDraft.target_type, () => {
  // Switching target types cannot retain a hidden contradictory reference.

  for (const k of ['source_plan_code', 'delivery_asset_code', 'environment_code']) Reflect.deleteProperty(childDraft, k)
})
const { confirm } = useConfirm()
async function action(family: 'coverages' | 'projects', row: Row, op: 'suspend' | 'end' | 'set-default') {
  const label = String(row.coverage_code || row.project_code)

  const verb = op === 'suspend' ? '暂停' : op === 'end' ? '结束' : '设为默认'

  if (!await confirm({ title: `${verb}「${label}」`, message: op === 'set-default' ? '将替换此协议当前默认项目，不改变项目权限。' : '该关系将不再用于有效服务匹配，不删除资产或项目。', tone: 'warning' })) return

  if (!intent.reset()) {
    error.value = '请先重试未完成的操作。'
    return
  }

  await mutate(`${api.value}/${family}/${row.id}/${op}`, 'POST', { expectedVersion: Number(record.value?.row_version) })
}
</script>

<template>
  <div class="space-y-5">
    <ContentPageHeader
      :title="mode === 'list' ? '服务协议' : mode === 'new' ? '新建服务协议' : String(record?.name || '服务协议详情')"
      description="协议、正式覆盖与项目关系集中维护；旧维保和权益只读。"
      hosted
      breadcrumb="交付与服务 / 维护服务 / 服务协议"
    >
      <template #actions>
        <UButton
          v-if="mode === 'list' && canEdit"
          to="/altoc/service-agreements/new"
          icon="i-lucide-plus"
        >
          新建协议
        </UButton>
        <UButton
          v-else-if="mode === 'detail' && canEdit && record && !editing"
          @click="startEdit"
        >
          编辑协议
        </UButton>
        <UButton
          v-if="mode !== 'new'"
          color="neutral"
          variant="outline"
          :loading="busy"
          @click="load"
        >
          刷新
        </UButton>
      </template>
    </ContentPageHeader>
    <UAlert
      v-if="permissionError"
      title="权限信息加载失败"
      color="error"
    />
    <UAlert
      v-if="directoryError"
      title="目录姓名加载失败"
      color="warning"
    />
    <UAlert
      v-if="error"
      :title="error"
      color="error"
    />
    <CommonEmptyState
      v-if="loaded && !permissionError && !canRead"
      icon="i-lucide-lock-keyhole"
      title="无权查看服务协议"
      description="请联系授权负责人。"
    />
    <template v-else-if="ready">
      <template v-if="mode === 'list'">
        <UInput
          v-model="search"
          placeholder="搜索协议名称"
          icon="i-lucide-search"
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
                :to="`/altoc/service-agreements/${row.original.id}`"
                class="text-primary"
              >{{ row.original.name }}</NuxtLink>
            </template>
            <template #owner_user_id-cell="{ row }">
              {{ userName(String(row.original.owner_user_id || '')) }}
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ statuses[String(row.original.status)] || apfEnumLabel(row.original.status) }}
              </UBadge>
            </template>
            <template #service_end_date-cell="{ row }">
              {{ String(row.original.service_end_date || '').slice(0, 10) || '未设置' }}
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-file-check"
                title="暂无服务协议"
                :description="canEdit ? '新建协议后维护覆盖与项目关系。' : '暂无可查看的协议。'"
              >
                <UButton
                  v-if="canEdit"
                  to="/altoc/service-agreements/new"
                >
                  新建协议
                </UButton>
              </CommonEmptyState>
            </template>
          </UTable>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :items-per-page="20"
            :total="total"
          />
        </div>
      </template>
      <template v-else>
        <template v-if="editing && canEdit">
          <UCard v-if="mode === 'new'">
            <template #header>
              <h2 class="font-semibold">
                选择所属合同 <span class="text-error">*</span>
              </h2>
            </template>
            <UFormField
              label="所属合同"
              :error="fieldErrors.contract_id"
            >
              <AltocBusinessObjectSelect
                v-model="draft.contract_id!"
                kind="contracts"
                :enabled="canEdit && mode === 'new'"
              />
            </UFormField>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3" />
            <UFormField
              label="合同行 ID（可选）"
              class="mt-3"
              :error="fieldErrors.contract_line_id"
            >
              <AltocBusinessObjectSelect
                v-model="draft.contract_line_id!"
                kind="contract-lines"
                :parent-id="draft.contract_id"
                :enabled="canEdit && mode === 'new'"
              />
            </UFormField>
          </UCard>
          <UCard
            v-for="group in groups"
            :key="group.title"
            class="mt-4"
          >
            <template #header>
              <h2 class="font-semibold">
                {{ group.title }}
              </h2>
            </template>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UFormField
                v-for="field in group.fields"
                :key="field"
                :label="labels[field]"
                :required="field === 'name'"
                :error="fieldErrors[field]"
              >
                <UserTreeSelector
                  v-if="field === 'owner_user_id'"
                  v-model="selectedOwner"
                  :multiple="false"
                  placeholder="选择负责人"
                />
                <USelectMenu
                  v-else-if="field === 'status'"
                  v-model="draft[field]"
                  value-key="value"
                  :items="options(Object.fromEntries(Object.entries(statuses).filter(([k]) => ['planned', 'active', 'suspended', 'expired', 'terminated', 'cancelled'].includes(k))))"
                  class="w-full"
                />
                <USelectMenu
                  v-else-if="field === 'quota_unit'"
                  v-model="draft[field]"
                  value-key="value"
                  :items="[{ value: 'ticket', label: '工单' }, { value: 'hour', label: '小时' }, { value: 'day', label: '天' }]"
                  class="w-full"
                />
                <UInput
                  v-else
                  v-model="draft[field]"
                  :type="field.endsWith('_date') || field.endsWith('_at') ? 'date' : field.endsWith('_minutes') ? 'number' : 'text'"
                  class="w-full"
                />
              </UFormField>
            </div>
          </UCard>
          <div class="mt-4 flex flex-wrap gap-3">
            <UButton
              :loading="saving"
              @click="save"
            >
              保存协议
            </UButton><UButton
              v-if="mode === 'detail'"
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="editing = false"
            >
              取消
            </UButton>
          </div>
        </template>
        <template v-else-if="record">
          <AltocFinancialSummaryPanel :agreement-id="String(record.id)" />
          <UCard>
            <template #header>
              <h2 class="font-semibold">
                协议概要
              </h2>
            </template><dl class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <template
                v-for="field in ['code', ...agreementFields]"
                :key="field"
              >
                <div v-if="record[field] !== null && record[field] !== ''">
                  <dt class="text-sm text-muted">
                    {{ labels[field] || '协议编号' }}
                  </dt><dd class="mt-1 break-words">
                    {{ field === 'owner_user_id' ? userName(String(record[field] || '')) : field === 'status' ? statuses[String(record[field])] : field === 'quota_unit' ? ({ ticket: '工单', hour: '小时', day: '天' } as Record<string, string>)[String(record[field])] : record[field] }}
                  </dd>
                </div>
              </template>
            </dl>
          </UCard>
          <UCard class="mt-4">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="font-semibold">
                  覆盖对象
                </h2><UButton
                  v-if="canEdit"
                  color="neutral"
                  variant="outline"
                  @click="openChild('coverage')"
                >
                  添加覆盖
                </UButton>
              </div>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="coverages"
                :columns="coverageColumns"
                :loading="busy"
              >
                <template #target_type-cell="{ row }">
                  {{ targets[String(row.original.target_type)] || '未识别对象' }}
                </template>
                <template #target-cell="{ row }">
                  <span class="break-all">{{ [row.original.source_plan_code, row.original.delivery_asset_code, row.original.environment_code].filter(Boolean).join(' / ') }}</span>
                </template>
                <template #resolution_status-cell="{ row }">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    {{ statuses[String(row.original.resolution_status)] }}
                  </UBadge>
                </template>
                <template #coverage_status-cell="{ row }">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    {{ statuses[String(row.original.coverage_status)] }}
                  </UBadge>
                </template>
                <template #actions-cell="{ row }">
                  <div
                    v-if="canEdit"
                    class="flex flex-wrap gap-2"
                  >
                    <UButton
                      v-if="row.original.resolution_status === 'pending' && row.original.target_type === 'pending_plan'"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      @click="openChild('resolve', row.original)"
                    >
                      解析
                    </UButton><template v-if="!['ended', 'cancelled'].includes(String(row.original.coverage_status))">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="saving"
                        @click="action('coverages', row.original, 'suspend')"
                      >
                        暂停
                      </UButton><UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="saving"
                        @click="action('coverages', row.original, 'end')"
                      >
                        结束
                      </UButton>
                    </template>
                  </div>
                </template>
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-box"
                    title="暂无覆盖对象"
                    :description="canEdit ? '可添加合同计划或已确认的资产、环境。' : '暂无可查看的覆盖。'"
                  />
                </template>
              </UTable>
            </div><div class="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted">共 {{ coverageTotal }} 条</span><UPagination
                v-model:page="coveragePage"
                :items-per-page="20"
                :total="coverageTotal"
              />
            </div>
          </UCard>
          <UCard class="mt-4">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="font-semibold">
                  服务项目
                </h2><UButton
                  v-if="canEdit"
                  color="neutral"
                  variant="outline"
                  @click="openChild('project')"
                >
                  关联项目
                </UButton>
              </div>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="projects"
                :columns="projectColumns"
                :loading="busy"
              >
                <template #project_role-cell="{ row }">
                  {{ roles[String(row.original.project_role)] || '未识别用途' }}
                </template>
                <template #is_default-cell="{ row }">
                  {{ row.original.is_default ? '默认' : '否' }}
                </template>
                <template #status-cell="{ row }">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    {{ statuses[String(row.original.status)] }}
                  </UBadge>
                </template>
                <template #actions-cell="{ row }">
                  <div
                    v-if="canEdit && row.original.status !== 'ended'"
                    class="flex flex-wrap gap-2"
                  >
                    <UButton
                      v-if="row.original.status === 'active' && !row.original.is_default"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      :disabled="saving"
                      @click="action('projects', row.original, 'set-default')"
                    >
                      设为默认
                    </UButton><UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="saving"
                      @click="action('projects', row.original, 'suspend')"
                    >
                      暂停
                    </UButton><UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="saving"
                      @click="action('projects', row.original, 'end')"
                    >
                      结束
                    </UButton>
                  </div>
                </template>
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-folder-kanban"
                    title="暂无关联项目"
                    description="关联不会赋予项目权限。"
                  />
                </template>
              </UTable>
            </div><div class="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted">共 {{ projectTotal }} 条</span><UPagination
                v-model:page="projectPage"
                :items-per-page="20"
                :total="projectTotal"
              />
            </div>
          </UCard>
        </template>
        <UAlert
          v-if="mode === 'new' && !canEdit"
          title="无权新建服务协议"
          color="warning"
        />
      </template>
    </template>
    <USlideover
      v-model:open="dialog"
      :title="dialogMode === 'project' ? '关联服务项目' : dialogMode === 'resolve' ? '解析覆盖对象' : '添加覆盖对象'"
      description="对象归属由服务端核验；不会改变项目或资产权限。"
      :ui="{ content: 'max-w-xl' }"
    >
      <template #body>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <template v-if="dialogMode === 'project'">
            <UFormField
              label="项目编码"
              required
              :error="fieldErrors.project_code"
            >
              <AltocBusinessObjectSelect
                v-model="childDraft.project_code!"
                kind="projects"
                :enabled="dialog && canEdit"
              />
            </UFormField><UFormField
              label="项目用途"
              required
              :error="fieldErrors.project_role"
            >
              <USelectMenu
                v-model="childDraft.project_role"
                value-key="value"
                :items="options(roles)"
                class="w-full"
              />
            </UFormField>
          </template>
          <template v-else>
            <UFormField
              label="对象类型"
              required
              :error="fieldErrors.target_type"
            >
              <USelectMenu
                v-model="childDraft.target_type"
                value-key="value"
                :items="options(Object.fromEntries(Object.entries(targets).filter(([k]) => dialogMode !== 'resolve' || k !== 'pending_plan')))"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="childDraft.target_type === 'pending_plan'"
              label="合同计划编码"
              required
              :error="fieldErrors.source_plan_code"
            >
              <UInput
                v-model="childDraft.source_plan_code"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="['delivery_asset', 'delivery_asset_environment'].includes(childDraft.target_type || '')"
              label="正式交付资产编码"
              required
              :error="fieldErrors.delivery_asset_code"
            >
              <UInput
                v-model="childDraft.delivery_asset_code"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="['environment', 'delivery_asset_environment'].includes(childDraft.target_type || '')"
              label="正式环境编码"
              required
              :error="fieldErrors.environment_code"
            >
              <UInput
                v-model="childDraft.environment_code"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="覆盖范围"
              :error="fieldErrors.coverage_scope"
            >
              <UInput
                v-model="childDraft.coverage_scope"
                class="w-full"
              />
            </UFormField><UFormField
              label="生效日期"
              :error="fieldErrors.effective_from"
            >
              <UInput
                v-model="childDraft.effective_from"
                type="date"
                class="w-full"
              />
            </UFormField><UFormField
              label="结束日期"
              :error="fieldErrors.effective_to"
            >
              <UInput
                v-model="childDraft.effective_to"
                type="date"
                class="w-full"
              />
            </UFormField><UFormField
              label="排除说明"
              :error="fieldErrors.exclusion_note"
            >
              <UTextarea
                v-model="childDraft.exclusion_note"
                class="w-full"
              />
            </UFormField>
          </template>
        </div>
        <UAlert
          v-if="error"
          :title="error"
          color="error"
          class="mt-4"
        />
      </template>
      <template #footer>
        <UButton
          :loading="saving"
          @click="saveChild"
        >
          保存
        </UButton><UButton
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="dialog = false"
        >
          取消
        </UButton>
      </template>
    </USlideover>
  </div>
</template>
