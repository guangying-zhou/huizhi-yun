<script setup lang="ts">
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import AltocKnowledgePanel from './AltocKnowledgePanel.vue'
import AltocProductFeedbackPanel from './AltocProductFeedbackPanel.vue'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { ticketFields } from '../../shared/altoc-service-tickets'

const fieldErrors = ref<Record<string, string>>({})

const props = defineProps<{ mode: 'list' | 'new' | 'detail' }>()
type Row = Record<string, string | number | null>
const route = useRoute()
const id = computed(() => String(route.params.ticketId || ''))
const { user } = useAuth()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => void loadPermissions())
const canRead = computed(() => loaded.value && !permissionError.value && hasPermission('service_ticket', 'view'))
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('service_ticket', 'edit'))
const canClose = computed(() => loaded.value && !permissionError.value && hasPermission('service_ticket', 'close'))
const canReopen = computed(() => loaded.value && !permissionError.value && hasPermission('service_ticket', 'reopen'))
const { status: accessStatus } = useEnterpriseNavigationAccess()
const cache = useState<string>('enterprise-cache-scope', () => '')
const ready = computed(() => canRead.value && accessStatus.value === 'ready' && Boolean(cache.value))
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<Row[]>([])
const record = ref<Row | null>(null)
const total = ref(0)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const api = computed(() => `/altoc/api/v1/service-tickets${props.mode === 'detail' ? `/${id.value}` : ''}`)
const types = [{ label: '故障', value: 'incident' }, { label: '咨询', value: 'consulting' }, { label: '需求', value: 'requirement' }, { label: '变更', value: 'change' }]
const priorities = [{ label: '低', value: 'low' }, { label: '普通', value: 'normal' }, { label: '高', value: 'high' }, { label: '紧急', value: 'urgent' }]
const labels: Record<string, string> = { open: '待处理', accepted: '已派发', processing: '处理中', waiting_customer: '等待客户', resolved: '已解决', closed: '已关闭', cancelled: '已取消', not_started: '未开始', on_track: '正常', warning: '预警', breached: '已超时', met: '达标', unknown: '待核对', in_service: '服务期内', out_of_service: '服务期外', over_quota: '超额度', idle: '未派发', pending: '待确认', succeeded: '已确认' }
const terminal = computed(() => ['resolved', 'closed', 'cancelled'].includes(String(record.value?.status)))
const draft = reactive<Record<string, string>>({ title: '', description: '', service_agreement_id: '', ticket_type: 'incident', priority: 'normal', owner_user_id: '', handler_user_id: '' })
watch(() => user.value, (uid) => {
  if (props.mode === 'new' && !draft.owner_user_id) draft.owner_user_id = String(uid || '')
}, { immediate: true })
const selectedOwner = computed({ get: () => draft.owner_user_id ? [draft.owner_user_id] : [], set: (uids: string[]) => {
  draft.owner_user_id = uids[0] || ''
} })
const selectedHandler = computed({ get: () => draft.handler_user_id ? [draft.handler_user_id] : [], set: (uids: string[]) => {
  draft.handler_user_id = uids[0] || ''
} })
const uids = computed(() => [...rows.value.map(r => String(r.owner_user_id || '')), String(record.value?.owner_user_id || ''), String(record.value?.handler_user_id || '')])
const { userName, directoryError } = useAltocDirectoryLabels(uids)
const columns: TableColumn<Row>[] = [{ accessorKey: 'code', header: '工单编号' }, { accessorKey: 'title', header: '标题' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'owner_user_id', header: '负责人' }, { accessorKey: 'sla_status', header: 'SLA' }]
let epoch = 0
async function load() {
  const n = ++epoch

  if (!ready.value || props.mode === 'new') {
    rows.value = []
    record.value = null
    return
  }

  loading.value = true

  message.value = ''

  try {
    const result = await $fetch<{ data: Row & { items: Row[], total: number } }>(api.value, { query: props.mode === 'list' ? { page: page.value, pageSize: 20, search: debounced.value } : {} })

    if (n !== epoch) return

    if (props.mode === 'list') {
      rows.value = result.data.items
      total.value = result.data.total
    } else record.value = result.data
  } catch {
    if (n === epoch) message.value = '工单读取失败，请稍后重试'
  } finally {
    if (n === epoch) loading.value = false
  }
}
watch([ready, id, page, debounced, cache], () => void load(), { immediate: true })
const editOpen = ref(false)
const dispatchOpen = ref(false)
const projectCode = ref('')
const estimatedHours = ref('')
const intent = createConsoleMutationIntent('altoc-service-ticket')
const { confirm } = useConfirm()
async function write(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  if (saving.value) return

  saving.value = true

  message.value = ''

  try {
    let newId = ''

    await intent.submit({ path, method, body }, async (request, key) => {
      const r = await $fetch<{ data: { id: string } }>(request.path, { method: request.method as 'POST' | 'PATCH', body: request.body, headers: { 'Idempotency-Key': key } })

      newId = String(r.data.id)
    })

    intent.reset()

    editOpen.value = false

    dispatchOpen.value = false

    if (props.mode === 'new') await navigateTo(`/altoc/service-tickets/${newId}`)
    else await load()
  } catch (e: unknown) {
    fieldErrors.value = apfServerFieldErrors(e, Object.keys(body))
    const r = e as { data?: { code?: string, message?: string } }

    const safeErrors: Record<string, string> = {
      service_ticket_quota_exceeded: '服务额度不足，无法派单，请补充合同或额度',
      service_ticket_out_of_service: '服务协议当前无效，不能派单',
      service_ticket_version_conflict: '工单版本已变化，请刷新后重新确认',
      service_ticket_terminal: '当前工单已结束，请使用明确的重开操作',
      service_project_default_required: '请指定执行项目，或先配置协议唯一默认项目',
      service_ticket_binding_conflict: '工单已绑定其他项目，不能改绑',
      altoc_scope_denied: '当前权限范围不允许此操作',
      permission_denied: '当前权限不允许此操作'
    }
    message.value = safeErrors[String(r.data?.code || '')] || '操作未确认，请保持原意图重试；版本变化时先刷新'
  } finally {
    saving.value = false
  }
}
function beginEdit() {
  if (!intent.reset()) {
    message.value = '请先确认上次操作结果'
    return
  }

  for (const k of ticketFields) draft[k] = String(record.value?.[k] || '')

  editOpen.value = true
}
async function save() {
  if (!canEdit.value || !String(draft.title || '').trim() || !String(draft.owner_user_id || '').trim() || (props.mode === 'new' && !draft.service_agreement_id)) {
    message.value = '请填写标题、负责人并选择服务协议'
    return
  }

  const body = Object.fromEntries(ticketFields.filter(k => draft[k] !== undefined).map(k => [k, draft[k]]))

  if (props.mode === 'new') body.service_agreement_id = draft.service_agreement_id
  else Object.assign(body, { expectedVersion: Number(record.value?.row_version) })

  await write(api.value, props.mode === 'new' ? 'POST' : 'PATCH', body)
}
async function act(action: 'close' | 'reopen') {
  if (!record.value || (action === 'close' && !canClose.value) || (action === 'reopen' && !canReopen.value)) return

  const verb = action === 'close' ? '关闭' : '重开'

  if (!await confirm({ title: `${verb}「${record.value.title}」`, message: action === 'reopen' ? '工单回到待处理；不重复扣减已消费额度，也不会自动重开Aims事项。' : '工单将进入关闭状态，迟到执行结果不会重开它。', tone: 'warning' })) return

  if (!intent.reset()) {
    message.value = '请先确认上次操作结果'
    return
  }

  await write(`${api.value}/${action}`, 'POST', { expectedVersion: Number(record.value.row_version), reason: `${verb}工单：${record.value.code}` })
}
async function dispatch(resume = false) {
  if (!canEdit.value || !record.value) return

  const body: Record<string, unknown> = { expectedVersion: Number(record.value.row_version) }

  if (!resume) {
    if (projectCode.value.trim()) body.project_code = projectCode.value.trim()

    if (estimatedHours.value) body.estimated_hours = estimatedHours.value
  }

  await write(`${api.value}/${resume ? 'dispatch-resume' : 'dispatch'}`, 'POST', body)
}
</script>

<template>
  <div class="space-y-5 p-4 sm:p-6">
    <ContentPageHeader
      hosted
      :title="mode === 'new' ? '新建服务工单' : mode === 'detail' ? String(record?.title || '工单详情') : '服务工单'"
      breadcrumb="交付与服务 / 维护服务 / 服务工单"
      description="按服务协议派发，SLA沿用现有分钟规则；超额度时拒绝派单。"
    >
      <template #actions>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="mode === 'list' && canEdit"
            to="/altoc/service-tickets/new"
            icon="i-lucide-plus"
          >
            新建工单
          </UButton>
          <UButton
            v-if="mode === 'detail' && canEdit && !terminal"
            @click="beginEdit"
          >
            编辑资料
          </UButton>
          <UButton
            v-if="mode === 'detail' && canEdit && !terminal"
            color="neutral"
            variant="outline"
            @click="dispatchOpen = true"
          >
            派发到项目
          </UButton>
          <UButton
            v-if="mode === 'detail' && canClose && record?.status !== 'closed'"
            color="neutral"
            variant="outline"
            @click="act('close')"
          >
            关闭
          </UButton>
          <UButton
            v-if="mode === 'detail' && canReopen && terminal"
            color="neutral"
            variant="outline"
            @click="act('reopen')"
          >
            重开
          </UButton>
          <UButton
            v-if="mode !== 'list'"
            to="/altoc/service-tickets"
            color="neutral"
            variant="ghost"
          >
            返回工单列表
          </UButton>
        </div>
      </template>
    </ContentPageHeader>
    <UAlert
      v-if="permissionError"
      title="权限信息加载失败"
      color="error"
    />
    <UAlert
      v-else-if="loaded && !canRead"
      title="无权查看服务工单"
      color="warning"
    />
    <UAlert
      v-if="directoryError"
      title="目录信息暂不可用"
      color="warning"
    />
    <UAlert
      v-if="message"
      :title="message"
      color="warning"
    />
    <template v-if="ready">
      <template v-if="mode === 'list'">
        <UInput
          v-model="search"
          placeholder="搜索编号或标题"
          class="w-full sm:w-80"
          @keydown.enter="flush"
        />
        <div class="overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="loading"
          >
            <template #title-cell="{ row }">
              <NuxtLink
                :to="`/altoc/service-tickets/${row.original.id}`"
                class="text-primary"
              >{{ row.original.title }}</NuxtLink>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[String(row.original.status)] || apfEnumLabel(row.original.status) }}
              </UBadge>
            </template>
            <template #sla_status-cell="{ row }">
              {{ labels[String(row.original.sla_status)] || apfEnumLabel(row.original.sla_status) }}
            </template>
            <template #owner_user_id-cell="{ row }">
              {{ userName(String(row.original.owner_user_id || '')) }}
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-ticket"
                title="暂无服务工单"
                :description="canEdit ? '从有效服务协议新建工单。' : '当前范围暂无工单。'"
              />
            </template>
          </UTable>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span>共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :items-per-page="20"
            :total="total"
          />
        </div>
      </template>
      <template v-else-if="mode === 'new' && canEdit">
        <UAlert
          v-if="!hasPermission('contract', 'view')"
          title="无权读取服务协议，请由有协议查看权限的人员处理"
          color="warning"
        />
        <UCard>
          <template #header>
            <h2>选择服务协议 *</h2>
          </template>
          <AltocBusinessObjectSelect
            v-model="draft.service_agreement_id!"
            kind="service-agreements"
            :enabled="canEdit && mode === 'new'"
          />
          <div class="mt-3 flex flex-wrap justify-between gap-3" />
        </UCard>
      </template>
      <UCard v-else-if="record">
        <template #header>
          <h2>服务与执行状态</h2>
        </template>
        <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-muted">
              工单编号
            </dt><dd>{{ record.code }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              服务协议
            </dt><dd>{{ record.service_agreement_code }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              工单状态
            </dt><dd>{{ labels[String(record.status)] || apfEnumLabel(record.status) }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              SLA
            </dt><dd>{{ labels[String(record.sla_status)] || apfEnumLabel(record.sla_status) }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              响应截止
            </dt><dd>{{ record.response_due_at }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              解决截止
            </dt><dd>{{ record.resolution_due_at }}</dd>
          </div>
          <div v-if="record.aims_work_item_key">
            <dt class="text-muted">
              Aims 执行
            </dt><dd class="break-all">
              {{ record.aims_project_code }} / {{ record.aims_work_item_key }}
            </dd>
          </div>
          <div v-if="record.description">
            <dt class="text-muted">
              描述
            </dt><dd class="whitespace-pre-wrap break-words">
              {{ record.description }}
            </dd>
          </div>
        </dl>
      </UCard>
      <UCard v-if="mode === 'new' && canEdit">
        <template #header>
          <h2>工单资料</h2>
        </template>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField
            label="标题"
            required
            class="sm:col-span-2"
            :error="fieldErrors.title"
          >
            <UInput
              v-model="draft.title"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="类型"
            required
            :error="fieldErrors.ticket_type"
          >
            <USelectMenu
              v-model="draft.ticket_type"
              value-key="value"
              :items="types"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="优先级"
            :error="fieldErrors.priority"
          >
            <USelectMenu
              v-model="draft.priority"
              value-key="value"
              :items="priorities"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="负责人"
            required
          >
            <UserTreeSelector
              v-model="selectedOwner"
              selection-mode="single"
              hide-committees
              width-class="w-full"
            />
          </UFormField>
          <UFormField label="处理人">
            <UserTreeSelector
              v-model="selectedHandler"
              selection-mode="single"
              hide-committees
              width-class="w-full"
            />
          </UFormField>
          <UFormField
            label="描述"
            class="sm:col-span-2"
            :error="fieldErrors.description"
          >
            <UTextarea
              v-model="draft.description"
              class="w-full"
            />
          </UFormField>
        </div><UButton
          :loading="saving"
          class="mt-4"
          @click="save"
        >
          创建工单
        </UButton>
      </UCard>
    </template>
    <AltocKnowledgePanel
      v-if="props.mode === 'detail' && record"
      :ticket-id="id"
      :row-version="Number(record.row_version)"
      :can-edit="canEdit"
      @changed="load"
    />
    <AltocProductFeedbackPanel
      v-if="record?.ticket_type === 'requirement' && canEdit"
      :ticket-id="id"
      :can-edit="canEdit"
    />
    <USlideover
      v-model:open="editOpen"
      title="编辑工单资料"
      description="仅编辑业务资料，不更改执行状态、协议或项目绑定。"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="标题"
            required
            :error="fieldErrors.title"
          >
            <UInput
              v-model="draft.title"
              class="w-full"
            />
          </UFormField><UFormField
            label="描述"
            :error="fieldErrors.description"
          >
            <UTextarea
              v-model="draft.description"
              class="w-full"
            />
          </UFormField><UFormField
            label="优先级"
            :error="fieldErrors.priority"
          >
            <USelectMenu
              v-model="draft.priority"
              value-key="value"
              :items="priorities"
              class="w-full"
            />
          </UFormField>
        </div>
      </template><template #footer>
        <UButton
          :loading="saving"
          @click="save"
        >
          保存
        </UButton>
      </template>
    </USlideover>
    <USlideover
      v-model:open="dispatchOpen"
      title="派发到项目"
      description="留空项目时使用协议当前默认服务项目；已有绑定不能更换。超过额度将拒绝派单。"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="项目编码">
            <AltocBusinessObjectSelect
              v-model="projectCode"
              kind="projects"
              :enabled="dispatchOpen && canEdit"
            />
          </UFormField><UFormField label="预计工时">
            <UInput
              v-model="estimatedHours"
              class="w-full"
            />
          </UFormField><p class="text-muted">
            重复派发和恢复使用原工单关系，不重复创建工作项。
          </p>
        </div>
      </template><template #footer>
        <div class="flex flex-wrap gap-2">
          <UButton
            :loading="saving"
            @click="dispatch()"
          >
            派发
          </UButton><UButton
            :loading="saving"
            color="neutral"
            variant="outline"
            @click="dispatch(true)"
          >
            恢复原派发
          </UButton>
        </div>
      </template>
    </USlideover>
  </div>
</template>
