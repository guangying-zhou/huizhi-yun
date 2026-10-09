<script setup lang="ts">
import APFUserSelect from './APFUserSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

type Row = Record<string, string | number>
type Detail = Row & { tasks: Row[] }
const route = useRoute()
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const { status: accessStatus, refresh: refreshAccess } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const canRead = computed(() => loaded.value && !permissionError.value && accessStatus.value === 'ready' && hasPermission('offboarding_tasks', 'view'))
const canAdmin = computed(() => canRead.value && hasPermission('offboarding_tasks', 'admin'))
const rows = ref<Row[]>([])
const detail = ref<Detail | null>(null)
const page = ref(1)
const total = ref(0)
const pending = ref(false)
const saving = ref(false)
const error = ref('')
const open = ref(false)
const draft = reactive({ employeeUid: '', leaveAssignmentCode: '', handoverResponsibleUid: '', handoverDueAt: '', assetRecoveryResponsibleUid: '', assetRecoveryDueAt: '' })
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const toast = useToast()
const { confirm } = useConfirm()
let intent = createConsoleMutationIntent('people-offboarding')
const frozen = ref<{ path: string, body: Record<string, unknown> } | null>(null)
let epoch = 0
const labels: Record<string, string> = { awaiting_arrangement: '待安排', active: '办理中', completed: '已完成', cancelled: '已取消', pending: '待完成', handover: '工作交接', asset_recovery_coordination: '资产回收协调' }
const columns: TableColumn<Row>[] = [{ accessorKey: 'case_code', header: '事项编号' }, { accessorKey: 'display_name', header: '员工' }, { accessorKey: 'effective_date', header: '离职生效日' }, { accessorKey: 'status', header: '状态' }]
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })

async function load() {
  const current = ++epoch
  rows.value = []
  detail.value = null
  total.value = 0
  if (!canRead.value || !scope.value) return
  pending.value = true
  error.value = ''
  try {
    if (id.value) {
      const result = await $fetch<{ data: { data: Detail } }>(`/enterprise/api/apf/people/offboarding/${id.value}`)
      if (current === epoch) detail.value = result.data.data
    } else {
      const result = await $fetch<{ data: { data: Row[], total: number } }>('/enterprise/api/apf/people/offboarding', { query: { page: page.value, pageSize: 20, search: debounced.value } })
      if (current === epoch) {
        rows.value = result.data.data
        total.value = result.data.total
      }
    }
  } catch (e) {
    if (current === epoch) error.value = Number((e as { statusCode?: number }).statusCode) === 503 ? '离职事项暂不可用，请确认安装候选已启用后重试' : '离职事项读取失败，请重试'
  } finally { if (current === epoch) pending.value = false }
}

function edit() {
  if (!canAdmin.value || !intent.reset()) return
  frozen.value = null
  formError.value = ''
  Object.assign(draft, { employeeUid: '', leaveAssignmentCode: '', handoverResponsibleUid: '', handoverDueAt: '', assetRecoveryResponsibleUid: '', assetRecoveryDueAt: '' })
  if (detail.value) {
    draft.employeeUid = String(detail.value.employee_uid)
    for (const [type, prefix] of [['handover', 'handover'], ['asset_recovery_coordination', 'assetRecovery']] as const) {
      const task = detail.value.tasks.find(t => t.task_type === type)
      if (task) {
        draft[`${prefix}ResponsibleUid`] = String(task.responsible_uid)
        draft[`${prefix}DueAt`] = new Date(String(task.due_at)).toISOString().slice(0, 16)
      }
    }
  }
  open.value = true
}

async function send(path: string, body: Record<string, unknown>, title: string) {
  if (!canRead.value || saving.value) return
  if (!intent.uncertain) frozen.value = { path, body: structuredClone(body) }
  if (!frozen.value) return
  const requestScope = scope.value
  const currentIntent = intent
  saving.value = true
  formError.value = ''
  try {
    const done = await currentIntent.submit({ method: 'POST', ...frozen.value }, async (request, key) => {
      const response = await $fetch<{ code: number, data: { data: { id: string | number } } }>(request.path, { method: 'POST', body: request.body, headers: { 'Idempotency-Key': key }, retry: 0 })
      if (response?.code !== 0 || !response.data?.data?.id) throw new Error('操作结果尚未确认')
    })
    if (requestScope !== scope.value) return
    if (done) {
      frozen.value = null
      open.value = false
      toast.add({ title, color: 'success' })
      await load()
    }
  } catch (e) {
    if (requestScope !== scope.value) return
    fieldErrors.value = apfServerFieldErrors(e, Object.keys(draft))
    const failure = e as { statusCode?: number, data?: { data?: { code?: string }, code?: string } }
    const code = failure.data?.data?.code || failure.data?.code
    formError.value = code === 'people_offboarding_assets_outstanding' ? '仍有未归还资产，请在 Assets 中办理归还后重新确认' : Number(failure.statusCode) === 409 ? '事项或责任人已变更，列表已刷新，请比较后重新确认；草稿已保留' : Number(failure.statusCode) === 403 ? '无权执行此操作，请核对当前职责与范围' : '保存结果未确认，请重试原操作；不会更换请求或重复生成事项'
    toast.add({ title: formError.value, color: 'error' })
    if (Number(failure.statusCode) === 409) await load()
  } finally { saving.value = false }
}

async function save() {
  if (!canAdmin.value) return
  fieldErrors.value = {}
  if (intent.uncertain && frozen.value) return send(frozen.value.path, frozen.value.body, '原操作已确认')
  if (detail.value) {
    if (!draft.handoverResponsibleUid || !draft.assetRecoveryResponsibleUid || !draft.handoverDueAt || !draft.assetRecoveryDueAt) {
      fieldErrors.value = Object.fromEntries(['handoverResponsibleUid', 'assetRecoveryResponsibleUid', 'handoverDueAt', 'assetRecoveryDueAt'].filter(k => !draft[k as keyof typeof draft]).map(k => [k, '请选择或填写此项']))
      formError.value = '请明确两类责任人和截止时间'
      return
    }
    await send(`/enterprise/api/apf/people/offboarding/${id.value}/arrange`, { employeeUid: draft.employeeUid, expectedVersion: Number(detail.value.row_version), handoverResponsibleUid: draft.handoverResponsibleUid, handoverDueAt: `${draft.handoverDueAt}:00Z`, assetRecoveryResponsibleUid: draft.assetRecoveryResponsibleUid, assetRecoveryDueAt: `${draft.assetRecoveryDueAt}:00Z` }, '离职事项已安排')
  } else {
    if (!draft.employeeUid || !draft.leaveAssignmentCode) {
      fieldErrors.value = Object.fromEntries(['employeeUid', 'leaveAssignmentCode'].filter(k => !draft[k as keyof typeof draft]).map(k => [k, '请选择此项']))
      return
    }
    await send('/enterprise/api/apf/people/offboarding', { employeeUid: draft.employeeUid, leaveAssignmentCode: draft.leaveAssignmentCode }, '离职事项已建立')
  }
}

async function transition(task: Row, action: 'confirm' | 'cancel') {
  if (!detail.value || !canRead.value || !hasPermission('offboarding_tasks', action) || saving.value || intent.uncertain || !intent.reset()) return
  if (!await confirm({ title: `${action === 'confirm' ? '确认完成' : '取消'} ${labels[String(task.task_type)] || apfEnumLabel(task.task_type)}`, message: `${detail.value.display_name} 的事项将记录当前操作者与结果；资产未归还不能确认完成，取消协调事项也不会延迟离职或恢复登录。`, tone: action === 'cancel' ? 'danger' : 'warning' })) return
  await send(`/enterprise/api/apf/people/offboarding/${id.value}/${action}`, { employeeUid: String(detail.value.employee_uid), expectedVersion: Number(detail.value.row_version), taskType: task.task_type, ...action === 'cancel' ? { reason: '当前责任人员经确认取消协调事项，实际资产回收仍由 Assets 处理' } : {} }, action === 'cancel' ? '协调事项已取消' : '协调事项已完成')
}

watch([canRead, scope, id, page, debounced], () => {
  void load()
}, { immediate: true })
watch(scope, () => {
  epoch++
  intent = createConsoleMutationIntent('people-offboarding')
  frozen.value = null
  open.value = false
  formError.value = ''
  Object.keys(draft).forEach((k) => {
    draft[k as keyof typeof draft] = ''
  })
})
onMounted(() => {
  void loadPermissions()
})
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div class="p-4 sm:p-6 space-y-4">
        <ContentPageHeader
          :hosted="true"
          :title="id ? '离职事项详情' : '离职事项'"
          description="资产回收不延迟离职生效或安全撤权；归还操作由 Assets 办理。"
        >
          <template #actions>
            <UButton
              v-if="id"
              to="/people/offboarding"
              variant="outline"
            >
              返回列表
            </UButton>
            <UButton
              v-if="canAdmin && (!detail || ['awaiting_arrangement', 'active'].includes(String(detail.status)))"
              @click="edit"
            >
              {{ id ? '安排责任人与期限' : '建立离职事项' }}
            </UButton>
          </template>
        </ContentPageHeader>
        <CommonEmptyState
          v-if="!loaded || ['idle', 'loading', 'refreshing'].includes(accessStatus)"
          icon="i-lucide-loader-circle"
          title="正在加载权限"
        />
        <CommonEmptyState
          v-else-if="permissionError || ['error', 'expired'].includes(accessStatus)"
          icon="i-lucide-triangle-alert"
          title="权限加载失败"
        >
          <UButton @click="loadPermissions(); refreshAccess()">
            重试
          </UButton>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!canRead"
          icon="i-lucide-lock"
          title="无权查看离职事项"
        />
        <CommonEmptyState
          v-else-if="error"
          icon="i-lucide-triangle-alert"
          :title="error"
        >
          <UButton @click="load">
            重试
          </UButton>
        </CommonEmptyState>
        <template v-else-if="!id">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="搜索事项编号、员工"
            class="w-full sm:w-80"
            @keyup.enter="flush()"
          />
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
          >
            <template #case_code-cell="{ row }">
              <NuxtLink
                :to="`/people/offboarding/${row.original.id}`"
                class="text-primary"
              >{{ row.original.case_code }}</NuxtLink>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                :color="row.original.status === 'completed' ? 'success' : row.original.status === 'awaiting_arrangement' ? 'warning' : row.original.status === 'cancelled' ? 'neutral' : 'info'"
                variant="subtle"
              >
                {{ labels[String(row.original.status)] || apfEnumLabel(row.original.status) }}
              </UBadge>
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-inbox"
                title="暂无离职事项"
              />
            </template>
          </UTable>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span>共 {{ total }} 条</span><UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="20"
            />
          </div>
        </template>
        <template v-else-if="detail">
          <UCard><p>{{ detail.display_name }} · {{ detail.effective_date }}</p><p>{{ labels[String(detail.status)] || apfEnumLabel(detail.status) }}</p></UCard>
          <div class="grid gap-4 md:grid-cols-2">
            <UCard
              v-for="task in detail.tasks"
              :key="String(task.task_type)"
            >
              <h2 class="font-semibold">
                {{ labels[String(task.task_type)] || apfEnumLabel(task.task_type) }}
              </h2>
              <p>责任人：{{ task.responsible_uid }} · 截止：{{ task.due_at }}</p>
              <p>{{ labels[String(task.status)] || apfEnumLabel(task.status) }}</p>
              <div
                v-if="task.status === 'pending'"
                class="flex flex-wrap gap-2 mt-3"
              >
                <UButton
                  v-if="hasPermission('offboarding_tasks', 'confirm')"
                  :disabled="intent.uncertain"
                  :loading="saving"
                  @click="transition(task, 'confirm')"
                >
                  确认完成
                </UButton>
                <UButton
                  v-if="hasPermission('offboarding_tasks', 'cancel')"
                  color="error"
                  variant="outline"
                  :disabled="intent.uncertain"
                  :loading="saving"
                  @click="transition(task, 'cancel')"
                >
                  取消协调
                </UButton>
              </div>
            </UCard>
          </div>
          <CommonEmptyState
            v-if="!detail.tasks.length"
            icon="i-lucide-user-round"
            title="尚未安排责任人和期限"
          />
        </template>
        <p
          v-if="formError"
          role="alert"
          class="text-error break-words"
        >
          {{ formError }}
        </p>
        <UButton
          v-if="intent.uncertain && frozen"
          :loading="saving"
          @click="send(frozen.path, frozen.body, '原操作已确认')"
        >
          重试原操作
        </UButton>
        <UModal
          v-model:open="open"
          :title="id ? '安排离职事项' : '建立离职事项'"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="save"
            >
              <template v-if="!id">
                <UFormField
                  label="员工"
                  required
                  :error="fieldErrors.employeeUid"
                >
                  <APFUserSelect v-model="draft.employeeUid" />
                </UFormField><UFormField
                  label="已批准离职任职单号"
                  required
                  :error="fieldErrors.leaveAssignmentCode"
                >
                  <AltocBusinessObjectSelect
                    v-model="draft.leaveAssignmentCode"
                    kind="assignments"
                    :employee-uid="draft.employeeUid"
                    :enabled="open && canAdmin"
                    :search-hint="draft.employeeUid"
                  />
                </UFormField>
              </template>
              <template v-else>
                <UFormField
                  label="交接责任人"
                  required
                  :error="fieldErrors.handoverResponsibleUid"
                >
                  <APFUserSelect v-model="draft.handoverResponsibleUid" />
                </UFormField>
                <UFormField
                  label="交接截止时间（UTC）"
                  required
                  :error="fieldErrors.handoverDueAt"
                >
                  <UInput
                    v-model="draft.handoverDueAt"
                    type="datetime-local"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="资产协调责任人 UID"
                  required
                  :error="fieldErrors.assetRecoveryResponsibleUid"
                >
                  <APFUserSelect v-model="draft.assetRecoveryResponsibleUid" />
                </UFormField>
                <UFormField
                  label="资产协调截止时间（UTC）"
                  required
                  :error="fieldErrors.assetRecoveryDueAt"
                >
                  <UInput
                    v-model="draft.assetRecoveryDueAt"
                    type="datetime-local"
                    class="w-full"
                  />
                </UFormField>
              </template>
              <p
                v-if="formError"
                role="alert"
                class="text-error"
              >
                {{ formError }}
              </p>
              <UButton
                type="submit"
                :loading="saving"
              >
                {{ intent.uncertain ? '重试原操作' : '保存' }}
              </UButton>
            </form>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
