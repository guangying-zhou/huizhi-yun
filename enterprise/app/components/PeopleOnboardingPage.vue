<script setup lang="ts">
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import APFUserSelect from './APFUserSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import type { TableColumn } from '@nuxt/ui'
import { parseProvisioningRecovery, serializeProvisioningRecovery, provisioningIdentityScope, provisioningStatusLabels, type ProvisioningAction } from '../utils/peopleProvisioningRecovery'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

type Row = Record<string, string | number | null>
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const canRead = computed(() => loaded.value && !permissionError.value && accessStatus.value === 'ready' && hasPermission('employees', 'view'))
const canEdit = computed(() => canRead.value && hasPermission('employees', 'edit'))
const rows = ref<Row[]>([])
const page = ref(1)
const total = ref(0)
const pending = ref(false)
const error = ref('')
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const columns: TableColumn<Row>[] = [{ accessorKey: 'onboarding_code', header: '入职单号' }, { accessorKey: 'candidate_name', header: '姓名' }, { accessorKey: 'planned_onboard_date', header: '计划入职' }, { accessorKey: 'status', header: '阶段' }, { id: 'actions', header: '操作' }]
const open = ref(false)
const editing = ref<Row | null>(null)
const draft = reactive({ candidate_name: '', planned_onboard_date: '', dept_code: '', employment_type: 'full_time', canonical_uid: '', corporate_email: '', position_code: '', manager_uid: '' })
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const intent = createConsoleMutationIntent('people-onboarding')
const { confirm } = useConfirm()
const recoveryStorageKey = 'people-onboarding-recovery'
let recoveryKey = ''
let accountIntent = createConsoleMutationIntent('people-onboarding-account', () => recoveryKey || `people-onboarding-account:${crypto.randomUUID()}`)
const diagnostic = ref<{ candidate: string, provisionStatus: string, directoryStatus: string, platformStatus: string } | null>(null)
const accountPending = ref(false)
const accountRetry = ref<{ row: Row, action: ProvisioningAction } | null>(null)
const manualMessage = '手工候选暂不支持自动开通，请在 Console 中处理'
const stages: Record<string, string> = { awaiting_profile: '待完善资料', ready_for_provisioning: '待开通', reserving_identity: '正在预留身份', provisioning_account: '正在开通账号', activating_employee: '正在建立任职', projecting_authorization: '等待权限同步', completed: '已完成', cancelled: '已取消', provisioning_failed: '开通失败', reservation_expired: '预留已过期', authorization_failed: '权限同步失败' }
async function account(row: Row, action: ProvisioningAction) {
  if (!canEdit.value || !scope.value || accountPending.value) return
  if (row.provider_code !== 'dingtalk' && !accountRetry.value) {
    error.value = manualMessage
    return
  }
  if (!accountIntent.uncertain && !recoveryKey) {
    if (!accountIntent.reset()) return
    if (action === 'cancel' && !await confirm({ title: `取消 ${row.candidate_name} 的入职`, message: '将释放该入职单的身份预留并取消入职；已在开通中的账号不能通过此操作停用。', tone: 'danger' })) return
    accountRetry.value = { row: { ...row }, action }
    recoveryKey = `people-onboarding-account:${crypto.randomUUID()}`
  }
  const original = accountRetry.value
  if (!original) return
  const currentScope = scope.value
  try {
    sessionStorage.setItem(recoveryStorageKey, serializeProvisioningRecovery({ id: String(original.row.id), action: original.action, expectedVersion: Number(original.row.object_version), key: recoveryKey }, provisioningIdentityScope(currentScope)))
  } catch {
    error.value = '无法保存原操作恢复信息，本次未发起开通。请检查浏览器存储。'
    return
  }
  accountPending.value = true
  error.value = ''
  try {
    const done = await accountIntent.submit({ method: 'POST', path: `/enterprise/api/apf/people/onboarding/${original.row.id}/${original.action}`, body: { expectedVersion: Number(original.row.object_version), ...original.action === 'cancel' ? { reason: '用户确认取消入职候选并释放身份预留' } : {} } }, async (request, key) => {
      const response = await $fetch<{ data: { activationDelivered?: boolean, provisionStatus?: string, directoryStatus?: string, platformStatus?: string } }>(request.path, { method: 'POST', body: request.body, headers: { 'Idempotency-Key': key } })
      if (scope.value !== currentScope) return
      if (response.data.provisionStatus) diagnostic.value = { candidate: String(original.row.candidate_name || '入职候选'), provisionStatus: response.data.provisionStatus, directoryStatus: response.data.directoryStatus || 'unknown', platformStatus: response.data.platformStatus || 'unknown' }
      if (original.action === 'activation-link' && response.data.activationDelivered === false) error.value = '账号激活消息尚未送达，请刷新状态；页面不会显示激活凭据。'
    })
    if (done && scope.value === currentScope) {
      sessionStorage.removeItem(recoveryStorageKey)
      recoveryKey = ''
      accountRetry.value = null
      await load()
    }
  } catch (e) {
    if (scope.value !== currentScope) return
    const status = Number((e as { statusCode?: number }).statusCode)
    error.value = status === 409 ? '入职版本或阶段已变化，请刷新；结果不确定时请重试原操作。' : status === 403 ? '无权开通此入职候选' : '开通链暂不可用，请重试原操作；已确认的阶段不会重复执行。'
  } finally { accountPending.value = false }
}
let epoch = 0
async function load() {
  const current = ++epoch
  rows.value = []
  total.value = 0
  if (!canRead.value || !scope.value)
    return
  pending.value = true
  error.value = ''
  try {
    const result = await $fetch<{ data: { data: Row[], total: number } }>('/enterprise/api/apf/people/onboarding', { query: { page: page.value, pageSize: 20, search: debounced.value } })
    if (current === epoch) {
      rows.value = result.data.data
      total.value = result.data.total
    }
  } catch {
    if (current === epoch)
      error.value = '入职候选读取失败，请重试'
  } finally {
    if (current === epoch)
      pending.value = false
  }
}
async function edit(row?: Row) {
  if (!canEdit.value || !intent.reset())
    return
  editing.value = null
  formError.value = ''
  try {
    if (row) {
      const result = await $fetch<{ data: { data: Row } }>(`/enterprise/api/apf/people/onboarding/${row.id}`)
      editing.value = result.data.data
    }
    for (const key of Object.keys(draft) as (keyof typeof draft)[])
      draft[key] = String(editing.value?.[key] || (key === 'employment_type' ? 'full_time' : ''))
    open.value = true
  } catch {
    error.value = '候选详情读取失败，请重试'
  }
}
async function save() {
  if (!canEdit.value || saving.value)
    return
  fieldErrors.value = {}
  if (!draft.candidate_name.trim()) {
    fieldErrors.value.candidate_name = '请填写姓名'
    formError.value = '请填写姓名'
    return
  }
  const body: Record<string, unknown> = { ...draft }
  if (editing.value)
    body.expectedVersion = Number(editing.value.row_version || editing.value.object_version)
  saving.value = true
  formError.value = ''
  try {
    const done = await intent.submit({ method: editing.value ? 'PATCH' : 'POST', path: `/enterprise/api/apf/people/onboarding${editing.value ? `/${editing.value.id}` : ''}`, body }, async (request, key) => {
      await $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } })
    })
    if (done) {
      open.value = false
      await load()
    }
  } catch (e) {
    fieldErrors.value = apfServerFieldErrors(e, Object.keys(draft))
    formError.value = Number((e as { statusCode?: number }).statusCode) === 409 ? '候选版本或阶段已变化，请刷新；未确认的操作请使用原内容重试' : '保存失败，请检查权限、姓名与日期后重试'
  } finally {
    saving.value = false
  }
}
watch(scope, (value) => {
  diagnostic.value = null
  accountRetry.value = null
  recoveryKey = ''
  accountIntent = createConsoleMutationIntent('people-onboarding-account', () => recoveryKey || `people-onboarding-account:${crypto.randomUUID()}`)
  if (!import.meta.client || !value) return
  try {
    const recovered = parseProvisioningRecovery(sessionStorage.getItem(recoveryStorageKey), provisioningIdentityScope(value))
    if (recovered) {
      recoveryKey = recovered.key
      accountRetry.value = { row: { id: recovered.id, object_version: recovered.expectedVersion, provider_code: 'dingtalk' }, action: recovered.action }
    }
  } catch { error.value = '无法读取原操作恢复信息，请勿重复开通。' }
}, { immediate: true })
onMounted(() => {
  void loadPermissions()
})
watch([canRead, page, debounced, scope], () => {
  open.value = false
  void load()
}, { immediate: true })
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div class="p-4 space-y-4 min-w-0">
        <ContentPageHeader
          hosted
          title="入职候选"
          breadcrumb="人力资源 / 员工管理 / 入职候选"
          description="候选不是正式员工，不参与人员范围；真实钉钉候选按预留、开通、激活与同步确认逐段推进；手工候选只维护资料。"
        >
          <template #actions>
            <UButton
              v-if="canEdit"
              @click="edit()"
            >
              新建入职候选
            </UButton>
          </template>
        </ContentPageHeader>
        <UAlert
          v-if="permissionError"
          color="error"
          title="权限信息加载失败"
        /><UAlert
          v-if="error"
          color="error"
          :title="error"
        />
        <UAlert
          color="info"
          :title="manualMessage"
          description="手工候选的身份绑定与激活合同暂未开放。候选保存不会创建 Directory 用户，正式完成须经目标端确认。"
        />
        <UButton
          v-if="accountRetry"
          color="neutral"
          variant="outline"
          :loading="accountPending"
          @click="account(accountRetry.row, accountRetry.action)"
        >
          重试原开通操作
        </UButton>
        <UAlert
          v-if="diagnostic"
          color="info"
          :title="`${diagnostic.candidate}：开通链状态`"
          :description="`Console 开通：${provisioningStatusLabels[diagnostic.provisionStatus] || '尚未确认'}；Directory 同步：${provisioningStatusLabels[diagnostic.directoryStatus] || '尚未确认'}；Platform 授权：${provisioningStatusLabels[diagnostic.platformStatus] || '尚未确认'}。部分成功不代表整链完成；未知结果应先刷新状态或重试原操作。`"
        />
        <UInput
          v-model="search"
          placeholder="搜索入职单号或姓名"
          class="w-full sm:max-w-xs"
          @keyup.enter="flush"
        />
        <div class="overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
          >
            <template #empty>
              <CommonEmptyState :title="canRead ? '暂无入职候选' : '无权查看'" />
            </template><template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ stages[String(row.original.status)] || '该阶段只读' }}
              </UBadge>
            </template><template #actions-cell="{ row }">
              <UButton
                v-if="canEdit && row.original.status === 'awaiting_profile'"
                color="neutral"
                variant="outline"
                size="xs"
                @click="edit(row.original)"
              >
                完善资料
              </UButton>
              <span
                v-if="row.original.provider_code !== 'dingtalk'"
                class="text-xs text-muted"
              >{{ manualMessage }}</span>
              <div
                v-else-if="canEdit"
                class="flex flex-wrap gap-2"
              >
                <UButton
                  v-if="['awaiting_profile', 'ready_for_provisioning', 'reservation_expired', 'provisioning_failed'].includes(String(row.original.status))"
                  size="xs"
                  :loading="accountPending"
                  :disabled="Boolean(accountRetry)"
                  @click="account(row.original, 'provision')"
                >
                  开通账号
                </UButton>
                <UButton
                  v-if="['provisioning_account', 'activating_employee', 'projecting_authorization', 'authorization_failed'].includes(String(row.original.status))"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :disabled="accountPending || Boolean(accountRetry)"
                  @click="account(row.original, 'refresh-status')"
                >
                  刷新开通状态
                </UButton>
                <UButton
                  v-if="['provisioning_account', 'activating_employee', 'projecting_authorization', 'completed'].includes(String(row.original.status))"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :disabled="accountPending || Boolean(accountRetry)"
                  @click="account(row.original, 'activation-link')"
                >
                  发送激活通知
                </UButton>
                <UButton
                  v-if="['awaiting_profile', 'ready_for_provisioning', 'reserving_identity', 'reservation_expired', 'provisioning_failed'].includes(String(row.original.status))"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  :disabled="accountPending || Boolean(accountRetry)"
                  @click="account(row.original, 'cancel')"
                >
                  取消入职
                </UButton>
              </div>
            </template>
          </UTable>
        </div>
        <div class="flex flex-col sm:flex-row sm:justify-between gap-2">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </div>
        <USlideover
          v-model:open="open"
          :title="editing ? '完善入职候选' : '新建入职候选'"
          description="仅保存候选资料，不触发身份或账号开通。"
          :dismissible="!saving && !intent.uncertain"
          :ui="{ content: 'w-full sm:max-w-3xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="save"
            >
              <UAlert
                v-if="formError"
                color="error"
                :title="formError"
              /><UFormField
                label="姓名"
                :error="fieldErrors.candidate_name"
                required
              >
                <UInput
                  v-model="draft.candidate_name"
                  class="w-full"
                />
              </UFormField><UFormField
                label="计划入职日期"
                :error="fieldErrors.planned_onboard_date"
              >
                <UInput
                  v-model="draft.planned_onboard_date"
                  type="date"
                  class="w-full"
                />
              </UFormField><UFormField
                label="部门"
                :error="fieldErrors.dept_code"
              >
                <APFDepartmentSelect v-model="draft.dept_code" />
              </UFormField><UFormField
                label="用工类型"
                :error="fieldErrors.employment_type"
              >
                <USelect
                  v-model="draft.employment_type"
                  :items="[{ label: '全职', value: 'full_time' }, { label: '兼职', value: 'part_time' }, { label: '实习', value: 'intern' }, { label: '外包', value: 'outsourced' }, { label: '代理', value: 'agent' }]"
                  class="w-full"
                />
              </UFormField>
              <section
                class="grid grid-cols-1 sm:grid-cols-2 gap-4"
                aria-label="开通资料"
              >
                <UFormField
                  label="新账号名称（非已有员工）"
                  :error="fieldErrors.canonical_uid"
                >
                  <UInput
                    v-model="draft.canonical_uid"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="企业邮箱"
                  :error="fieldErrors.corporate_email"
                >
                  <UInput
                    v-model="draft.corporate_email"
                    type="email"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="岗位"
                  :error="fieldErrors.position_code"
                >
                  <AltocBusinessObjectSelect
                    v-model="draft.position_code"
                    kind="positions"
                    :enabled="open && canEdit"
                  />
                </UFormField>
                <UFormField
                  label="直属经理"
                  :error="fieldErrors.manager_uid"
                >
                  <APFUserSelect v-model="draft.manager_uid" />
                </UFormField>
              </section>
              <UButton
                type="submit"
                :loading="saving"
              >
                {{ intent.uncertain ? '重试原操作' : '保存资料' }}
              </UButton>
            </form>
          </template>
        </USlideover>
      </div>
    </template>
  </UDashboardPanel>
</template>
