<script setup lang="ts">
import type { ApiResponse, ListResponse } from '~/types'

usePageTitle('入职管理')

interface OnboardingCase {
  onboarding_code: string
  provider_code: string
  provider_subject: string
  candidate_name: string
  employee_no: string | null
  canonical_uid: string | null
  corporate_email: string | null
  mobile: string | null
  dept_code: string | null
  position_code: string | null
  rank_code: string | null
  source_onboard_date: string | null
  source_field_status: string | SourceFieldStatus[] | null
  planned_onboard_date: string | null
  manager_uid: string | null
  manager_provider_subject: string | null
  status: string
  object_version: number
  last_error_code: string | null
  updated_at: string
}

interface SourceFieldStatus {
  field: string
  provided: number
  empty: number
  absent: number
  invalid: number
  observed: number
}

const statusMeta: Record<string, { label: string, color: 'neutral' | 'info' | 'warning' | 'success' | 'error' }> = {
  awaiting_profile: { label: '待完善', color: 'neutral' },
  ready_for_provisioning: { label: '待开通', color: 'info' },
  reserving_identity: { label: '预留身份中', color: 'info' },
  provisioning_account: { label: '账号开通中', color: 'info' },
  activating_employee: { label: '激活员工中', color: 'info' },
  projecting_authorization: { label: '待授权', color: 'info' },
  completed: { label: '已完成', color: 'success' },
  profile_conflict: { label: '资料冲突', color: 'warning' },
  identity_conflict: { label: '身份冲突', color: 'error' },
  reservation_expired: { label: '预留已过期', color: 'warning' },
  provisioning_failed: { label: '开通失败', color: 'error' },
  authorization_failed: { label: '授权失败', color: 'error' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待完善', value: 'awaiting_profile' },
  { label: '待开通', value: 'ready_for_provisioning' },
  { label: '预留身份中', value: 'reserving_identity' },
  { label: '账号开通中', value: 'provisioning_account' },
  { label: '激活员工中', value: 'activating_employee' },
  { label: '待授权', value: 'projecting_authorization' },
  { label: '资料冲突', value: 'profile_conflict' },
  { label: '身份冲突', value: 'identity_conflict' },
  { label: '预留已过期', value: 'reservation_expired' },
  { label: '开通失败', value: 'provisioning_failed' },
  { label: '授权失败', value: 'authorization_failed' },
  { label: '已完成', value: 'completed' }
]

function sourceFieldStatuses(value: OnboardingCase['source_field_status']): SourceFieldStatus[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as SourceFieldStatus[] : []
  } catch {
    return []
  }
}

function sourceFieldState(item: OnboardingCase, field: string) {
  return sourceFieldStatuses(item.source_field_status).find(entry => entry.field === field)
}

function sourceFieldDisplay(item: OnboardingCase, field: string, value: string | null) {
  const state = sourceFieldState(item, field)
  if (state?.invalid) return '格式无效'
  if (state?.absent) return '未提供'
  if (state?.empty) return '明确为空'
  return value || '未提供'
}

const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const status = ref('all')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, status },
  defaults: { search: '', status: 'all' }
})

const query = computed(() => ({
  page: page.value,
  page_size: pageSize,
  search: debounced.value || undefined,
  status: status.value === 'all' ? undefined : status.value
}))

const { data: response, error, refresh, status: fetchStatus } = await useLazyFetch<ApiResponse<ListResponse<OnboardingCase>>>(
  '/api/v1/onboarding-cases',
  { query }
)
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const errorAlert = computed(() => resolvePeopleApiErrorAlert(error.value, {
  fallbackTitle: '入职候选数据暂不可用'
}))

const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => fetchStatus.value === 'pending')
const hasFilters = computed(() => Boolean(debounced.value) || status.value !== 'all')

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  status_meta: statusMeta[item.status] || { label: item.status, color: 'neutral' as const },
  onboard_display: item.planned_onboard_date || item.source_onboard_date || '',
  account_display: item.canonical_uid || ''
})))

const columns = [
  { accessorKey: 'candidate_name', header: '姓名' },
  { accessorKey: 'employee_no', header: '工号' },
  { accessorKey: 'account_display', header: '登录账号' },
  { accessorKey: 'onboard_display', header: '入职日期' },
  { accessorKey: 'dept_code', header: '部门' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'updated_at', header: '更新时间' },
  { accessorKey: 'actions', header: '操作' }
]

function resetFilters() {
  resetSearch()
  resetListFilters()
}

const { ensurePeoplePermission } = usePeopleAuthorization()
const { confirm } = useConfirm()
const toast = useToast()

const editOpen = ref(false)
const saving = ref(false)
const provisioning = ref('')
const editing = ref<OnboardingCase | null>(null)
const cancelOpen = ref(false)
const cancelling = ref(false)
const cancellingCase = ref<OnboardingCase | null>(null)
const cancellationReason = ref('')
const form = reactive({
  employee_no: '',
  dept_code: '',
  position_code: '',
  rank_code: '',
  canonical_uid: '',
  corporate_email: '',
  planned_onboard_date: '',
  manager_uid: '',
  employment_type: 'full_time'
})

const employmentTypeOptions = [
  { label: '全职', value: 'full_time' },
  { label: '兼职', value: 'part_time' },
  { label: '外包', value: 'outsourced' },
  { label: '实习', value: 'intern' },
  { label: '代理', value: 'agent' }
]

// 与服务端同一份必填清单；缺失项在提交前就地提示，不必等 400 回来。
const requiredFields: Array<{ key: keyof typeof form, label: string }> = [
  { key: 'dept_code', label: '部门' },
  { key: 'position_code', label: '岗位' },
  { key: 'rank_code', label: '职级' },
  { key: 'canonical_uid', label: '登录账号' },
  { key: 'corporate_email', label: '企业邮箱' },
  { key: 'planned_onboard_date', label: '入职日期' }
]
const missingLabels = computed(() =>
  requiredFields.filter(field => !String(form[field.key] || '').trim()).map(field => field.label)
)
const syntheticUid = computed(() => form.canonical_uid.trim().toLowerCase().startsWith('dt-'))

function messageOf(error: unknown, fallback: string) {
  const data = (error as { data?: { message?: string } })?.data
  return data?.message || (error instanceof Error ? error.message : fallback)
}

async function openEdit(item: OnboardingCase) {
  if (!await ensurePeoplePermission('employees', 'edit')) return
  editing.value = item
  form.employee_no = item.employee_no || ''
  form.dept_code = item.dept_code || ''
  form.position_code = item.position_code || ''
  form.rank_code = item.rank_code || ''
  form.canonical_uid = item.canonical_uid || ''
  form.corporate_email = item.corporate_email || ''
  form.planned_onboard_date = item.planned_onboard_date || item.source_onboard_date || ''
  form.manager_uid = item.manager_uid || ''
  form.employment_type = 'full_time'
  editOpen.value = true
}

async function saveProfile(submit: boolean) {
  const item = editing.value
  if (!item || saving.value) return
  if (syntheticUid.value) {
    toast.add({ title: '不能使用合成的 dt-* 标识作为 UID', color: 'warning' })
    return
  }
  if (submit && missingLabels.value.length > 0) {
    toast.add({ title: '提交确认失败', description: `还缺少：${missingLabels.value.join('、')}`, color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/v1/onboarding-cases/${encodeURIComponent(item.onboarding_code)}/profile`, {
      method: 'PATCH',
      body: {
        dept_code: form.dept_code,
        position_code: form.position_code,
        rank_code: form.rank_code,
        canonical_uid: form.canonical_uid,
        corporate_email: form.corporate_email,
        planned_onboard_date: form.planned_onboard_date,
        manager_uid: form.manager_uid,
        employment_type: form.employment_type,
        object_version: item.object_version,
        submit
      }
    })
    toast.add({ title: submit ? '已提交确认' : '已保存资料', color: 'success' })
    editOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({ title: submit ? '提交确认失败' : '保存失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    saving.value = false
  }
}

// 下游状态由 Console 报告，前端不猜测：刷新会读取目录生效情况与 Platform
// 下一跳状态，并据此推进入职单终态。
async function refreshStatus(item: OnboardingCase) {
  provisioning.value = item.onboarding_code
  try {
    const response = await $fetch<{ data: { status?: string, changed?: boolean } }>(
      `/api/admin/onboarding-cases/${encodeURIComponent(item.onboarding_code)}/refresh-status`,
      { method: 'POST' }
    )
    const next = response.data?.status || item.status
    toast.add({
      title: response.data?.changed ? '状态已更新' : '状态未变化',
      description: response.data?.changed
        ? `当前状态：${statusMeta[next]?.label || next}`
        : '下游授权仍在进行中，稍后再试。',
      color: response.data?.changed ? 'success' : 'info'
    })
    await refresh()
  } catch (error) {
    toast.add({ title: '状态刷新失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    provisioning.value = ''
  }
}

async function activate(item: OnboardingCase) {
  if (!await ensurePeoplePermission('employees', 'admin')) return
  provisioning.value = item.onboarding_code
  try {
    await $fetch(`/api/admin/onboarding-cases/${encodeURIComponent(item.onboarding_code)}/activate`, {
      method: 'POST'
    })
    toast.add({ title: '已激活为正式员工', description: '目录与授权投影将在后台继续完成。', color: 'success' })
    await refresh()
  } catch (error) {
    toast.add({ title: '激活失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    provisioning.value = ''
  }
}

async function provision(item: OnboardingCase) {
  if (!await ensurePeoplePermission('employees', 'admin')) return
  // 开通会真实创建企业账号；账号创建成功后再由“激活员工”投递一次性链接。
  const confirmed = await confirm({
    tone: 'warning',
    title: `为「${item.candidate_name}」开通账号`,
    message: `将以 ${item.canonical_uid} 预留身份并创建企业账号。账号创建后需要走离职或停用流程才能撤销。`,
    confirmLabel: '开通账号'
  })
  if (!confirmed) return

  provisioning.value = item.onboarding_code
  try {
    await $fetch(
      `/api/admin/onboarding-cases/${encodeURIComponent(item.onboarding_code)}/provision`,
      { method: 'POST', body: { object_version: item.object_version } }
    )
    toast.add({
      title: '账号开通已提交',
      description: '目录连接器正在创建账号；成功后即可激活员工。',
      color: 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({ title: '开通失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    provisioning.value = ''
  }
}

async function resendActivationLink(item: OnboardingCase) {
  if (!await ensurePeoplePermission('employees', 'admin')) return
  const confirmed = await confirm({
    tone: 'warning',
    title: `重发「${item.candidate_name}」的激活链接`,
    message: '发送成功后，之前尚未使用的激活链接会立即失效。',
    confirmLabel: '确认重发'
  })
  if (!confirmed) return
  provisioning.value = item.onboarding_code
  try {
    await $fetch(`/api/admin/onboarding-cases/${encodeURIComponent(item.onboarding_code)}/activation-link`, {
      method: 'POST'
    })
    toast.add({ title: '激活链接已通过钉钉发送', color: 'success' })
  } catch (error) {
    toast.add({ title: '激活链接发送失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    provisioning.value = ''
  }
}

async function openCancel(item: OnboardingCase) {
  if (!await ensurePeoplePermission('employees', 'admin')) return
  cancellingCase.value = item
  cancellationReason.value = ''
  cancelOpen.value = true
}

async function cancelOnboarding() {
  const item = cancellingCase.value
  if (!item || cancelling.value || [...cancellationReason.value.trim()].length < 5) return
  cancelling.value = true
  try {
    await $fetch(`/api/admin/onboarding-cases/${encodeURIComponent(item.onboarding_code)}/cancel`, {
      method: 'POST',
      body: { reason: cancellationReason.value.trim(), object_version: item.object_version }
    })
    toast.add({ title: '入职单已取消', color: 'success' })
    cancelOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({ title: '取消失败', description: messageOf(error, '请稍后重试'), color: 'error' })
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="errorAlert"
      color="error"
      variant="soft"
      :title="errorAlert.title"
      :description="errorAlert.description"
    />

    <UAlert
      color="info"
      variant="soft"
      icon="i-lucide-info"
      title="入职候选还不是正式员工"
      description="钉钉同步中未命中既有身份的员工先落在这里，不会写入员工档案，也不参与任职、成本、绩效和权限计算。账号开通与资料确认能力正在分阶段上线。"
    />

    <div class="flex flex-wrap items-center gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索姓名、工号、UID 或邮箱"
        class="w-full sm:w-72"
        @keydown.enter="flush"
      />
      <USelectMenu
        v-model="status"
        :items="statusOptions"
        value-key="value"
        class="w-full sm:w-44"
      />
      <UButton
        v-if="hasFilters"
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        @click="resetFilters"
      >
        重置
      </UButton>
      <span class="ml-auto text-sm text-muted">共 {{ total }} 条</span>
    </div>

    <UTable
      :data="rows"
      :columns="columns"
      :loading="loading"
    >
      <template #account_display-cell="{ row }">
        <span
          v-if="row.original.account_display"
          class="font-mono text-sm"
        >{{ row.original.account_display }}</span>
        <span
          v-else
          class="text-sm text-dimmed"
        >未预留</span>
      </template>
      <template #employee_no-cell="{ row }">
        <span v-if="row.original.employee_no">{{ row.original.employee_no }}</span>
        <span
          v-else
          class="text-sm text-dimmed"
        >待填写</span>
      </template>
      <template #dept_code-cell="{ row }">
        <span v-if="row.original.dept_code">{{ row.original.dept_code }}</span>
        <span
          v-else
          class="text-sm text-dimmed"
        >待确认</span>
      </template>
      <template #onboard_display-cell="{ row }">
        <span v-if="row.original.onboard_display">{{ row.original.onboard_display }}</span>
        <span
          v-else
          class="text-sm text-dimmed"
        >{{ sourceFieldDisplay(row.original, 'onboard_date', row.original.source_onboard_date) }}</span>
      </template>
      <template #status-cell="{ row }">
        <div class="space-y-1">
          <UBadge
            :color="row.original.status_meta.color"
            variant="subtle"
            size="sm"
          >
            {{ row.original.status_meta.label }}
          </UBadge>
          <p
            v-if="row.original.last_error_code"
            class="max-w-44 truncate font-mono text-xs text-dimmed"
            :title="row.original.last_error_code"
          >
            {{ row.original.last_error_code }}
          </p>
        </div>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex flex-wrap items-center gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-pencil"
            :disabled="!['awaiting_profile', 'ready_for_provisioning', 'profile_conflict', 'identity_conflict', 'reservation_expired', 'provisioning_failed'].includes(row.original.status)"
            @click="openEdit(row.original)"
          >
            完善
          </UButton>
          <UButton
            v-if="['ready_for_provisioning', 'reserving_identity', 'reservation_expired', 'provisioning_failed'].includes(row.original.status)"
            color="primary"
            variant="ghost"
            size="xs"
            icon="i-lucide-user-check"
            :loading="provisioning === row.original.onboarding_code"
            @click="provision(row.original)"
          >
            {{ row.original.status === 'ready_for_provisioning' ? '开通' : '继续开通' }}
          </UButton>
          <UButton
            v-if="row.original.status === 'provisioning_account'"
            color="primary"
            variant="ghost"
            size="xs"
            icon="i-lucide-user-round-check"
            :loading="provisioning === row.original.onboarding_code"
            @click="activate(row.original)"
          >
            激活员工
          </UButton>
          <UButton
            v-if="['provisioning_account', 'activating_employee', 'projecting_authorization', 'authorization_failed', 'completed'].includes(row.original.status)"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-send"
            :loading="provisioning === row.original.onboarding_code"
            @click="resendActivationLink(row.original)"
          >
            重发激活链接
          </UButton>
          <UButton
            v-if="['activating_employee', 'projecting_authorization', 'authorization_failed'].includes(row.original.status)"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-refresh-cw"
            :loading="provisioning === row.original.onboarding_code"
            @click="refreshStatus(row.original)"
          >
            刷新状态
          </UButton>
          <UButton
            v-if="['awaiting_profile', 'ready_for_provisioning', 'profile_conflict', 'identity_conflict', 'reservation_expired', 'provisioning_failed'].includes(row.original.status)"
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-x-circle"
            @click="openCancel(row.original)"
          >
            取消入职
          </UButton>
        </div>
      </template>
      <template #empty>
        <CommonEmptyState
          icon="i-lucide-user-plus"
          :title="hasFilters ? '没有符合条件的入职候选' : '暂无入职候选'"
          :description="hasFilters
            ? '换个关键词或状态再试一次。'
            : '钉钉同步到未命中既有身份的新员工时，会自动在这里生成入职候选。'"
        />
      </template>
    </UTable>

    <USlideover
      v-model:open="editOpen"
      title="完善入职资料"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="editing"
            color="neutral"
            variant="subtle"
            :title="editing.candidate_name"
            :description="`系统工号 ${editing.employee_no || '保存资料时自动分配'} · 钉钉入职日期 ${sourceFieldDisplay(editing, 'onboard_date', editing.source_onboard_date)} · 钉钉手机号 ${sourceFieldDisplay(editing, 'mobile', editing.mobile)}`"
          />
          <UAlert
            v-if="missingLabels.length > 0"
            color="warning"
            variant="soft"
            icon="i-lucide-circle-alert"
            title="提交确认前还需补齐"
            :description="missingLabels.join('、')"
          />

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="工号"
              help="由 People 自动递增分配，不使用钉钉工号。"
            >
              <UInput
                v-model="form.employee_no"
                disabled
                placeholder="保存资料时自动分配"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="部门编码"
              required
            >
              <UInput
                v-model="form.dept_code"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="岗位编码"
              required
            >
              <UInput
                v-model="form.position_code"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="职级"
              required
            >
              <UInput
                v-model="form.rank_code"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="登录账号"
              required
              :error="syntheticUid ? '不能使用合成的 dt-* 标识' : undefined"
              description="确定后即用于开户，开通前不建议再改。"
            >
              <UInput
                v-model="form.canonical_uid"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="企业邮箱"
              required
            >
              <UInput
                v-model="form.corporate_email"
                type="email"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="入职日期"
              required
            >
              <UInput
                v-model="form.planned_onboard_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField label="用工类型">
              <USelectMenu
                v-model="form.employment_type"
                :items="employmentTypeOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="上级 UID"
              class="sm:col-span-2"
              description="上级尚未在目录中落地时请留空，不要填写钉钉标识。"
            >
              <UInput
                v-model="form.manager_uid"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="editOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            :loading="saving"
            @click="saveProfile(false)"
          >
            保存草稿
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-check"
            :loading="saving"
            :disabled="missingLabels.length > 0 || syntheticUid"
            @click="saveProfile(true)"
          >
            提交确认
          </UButton>
        </div>
      </template>
    </USlideover>

    <UModal
      v-model:open="cancelOpen"
      title="取消入职"
      description="仅能取消尚未开户或已经确认无在途建号的入职单；操作会保留审计记录。"
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #body>
        <UFormField
          label="取消原因"
          required
          :error="cancellationReason && [...cancellationReason.trim()].length < 5 ? '至少填写 5 个字符' : undefined"
        >
          <UTextarea
            v-model="cancellationReason"
            :rows="4"
            placeholder="请说明取消本次入职的原因"
            class="w-full"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="cancelling"
            @click="cancelOpen = false"
          >
            返回
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-x-circle"
            :loading="cancelling"
            :disabled="[...cancellationReason.trim()].length < 5"
            @click="cancelOnboarding"
          >
            确认取消
          </UButton>
        </div>
      </template>
    </UModal>

    <div
      v-if="total > pageSize"
      class="flex justify-end"
    >
      <UPagination
        v-model:page="page"
        :items-per-page="pageSize"
        :total="total"
      />
    </div>
  </div>
</template>
