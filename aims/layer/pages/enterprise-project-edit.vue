<script setup lang="ts">
import ProjectSettingsOverview from '../../app/components/project/ProjectSettingsOverview.vue'
import ProjectModuleSettings from '../../app/components/project/ProjectModuleSettings.vue'
import ProjectLifecycleSettings from '../../app/components/project/ProjectLifecycleSettings.vue'
import type { ProjectCategory, ProjectConfidentialityLevel, ProjectSecurityLevel } from '../../app/types/aims'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import { useAimsModule } from '../useAimsModule'
import { projectNameError } from '../../shared/projectName'
import { useAccountDepartments, useBusinessDomains } from '@hzy/foundation/app/composables/useAccount'
import ProjectAccessControlFields from '../../app/components/project/ProjectAccessControlFields.vue'
import { effectiveProjectSecurityLevel, projectAccessControlPatch, type ProjectAccessControl } from '../../app/utils/projectAccessControl'

const route = useRoute(), router = useRouter(), { moduleUrl } = useAimsModule(), id = computed(() => String(route.params.id || '')), loading = ref(true), saving = ref(false), error = ref(''), operationKey = ref('')
const projectContext = useProvidedEnterpriseProjectObjectContext()
const { user: currentUid } = useAuth()
const { confirm } = useConfirm()
const { flat: departments } = useAccountDepartments(), { domains } = useBusinessDomains()
const form = reactive({ expectedVersion: '', name: '', shortName: '', internalCode: '', description: '', methodology: 'PIVR', portfolioId: null as number | null, domainCode: '', deptCode: '', leaderUid: '', startDate: '', endDate: '' })
const accessForm = reactive<ProjectAccessControl>({ securityLevel: 'company', confidentialityLevel: 'L1', accessWhitelist: null })
const originalAccess = ref<ProjectAccessControl | null>(null)
const accessSaving = ref(false)
const accessError = ref('')
const accessFeedback = ref<'uncertain' | 'conflict' | 'error' | ''>('')
const accessOperation = ref<{ key: string, body: Record<string, unknown> } | null>(null)
const settingsProject = ref<Record<string, unknown> | null>(null)
const { hasPermission } = usePermissions()
const hasManagementRelationship = computed(() => projectLeaderUid.value === currentUid.value || projectCurrentRole.value === 'manager')
const canManageSettings = computed(() => settingsProject.value?.canEditProject === true && hasPermission('projects', 'edit') && hasManagementRelationship.value)
const projectCategory = computed(() => String(settingsProject.value?.category || 'custom_dev') as ProjectCategory)
const projectLifecycle = computed(() => String(settingsProject.value?.lifecycleStatus ?? settingsProject.value?.lifecycle_status ?? ''))
const projectName = ref('')
const projectLeaderUid = ref('')
const projectCurrentRole = ref('')
const canEditAccess = computed(() => Boolean(
  projectContext?.model.value?.groups.some(group => group.items.some(item => item.path === '/edit'))
  && (projectLeaderUid.value === currentUid.value || projectCurrentRole.value === 'manager')
))
const effectiveSecurityLevel = computed(() => effectiveProjectSecurityLevel(accessForm.securityLevel, accessForm.confidentialityLevel))
const accessPatch = computed(() => originalAccess.value ? projectAccessControlPatch(originalAccess.value, accessForm) : {})
const accessChanged = computed(() => Object.keys(accessPatch.value).length > 0)
const accessWhitelistError = computed(() => (accessForm.accessWhitelist?.length || 0) > 100 ? '白名单最多选择 100 人' : '')
const selectedLeader = computed({ get: () => form.leaderUid ? [form.leaderUid] : [], set: (uids: string[]) => {
  form.leaderUid = uids[0] || ''
} })
const departmentName = computed(() => departments.value.find(d => d.deptCode === form.deptCode)?.name || '未设置')
const domainName = computed(() => domains.value.find(d => d.domainCode === form.domainCode)?.domainName || '未设置')
// The Runtime validates `name` only when the command carries it. A project whose
// stored name predates the shared rule stays editable while the name is
// untouched, so the name is validated and sent only after the user changes it.
const nameChanged = computed(() => form.name !== projectName.value)
const nameError = computed(() => nameChanged.value ? projectNameError(form.name) : '')
const feedbackKind = ref<'uncertain' | 'conflict' | 'error' | ''>('')
const errorTitle = computed(() => feedbackKind.value === 'uncertain' ? '保存结果未确认' : feedbackKind.value === 'conflict' ? '内容已被他人修改' : '操作失败')
const comparing = ref(false)
const comparisonError = ref('')
const latestProject = ref<Record<string, unknown> | null>(null)
const comparisonFields = [
  ['name', '项目名称'], ['shortName', '项目简称'], ['internalCode', '内部代号'], ['description', '说明'],
  ['methodology', '方法论'], ['portfolioId', '项目集'], ['domainCode', '业务领域'], ['deptCode', '所属部门'],
  ['leaderUid', '负责人'], ['startDate', '开始日期'], ['endDate', '结束日期'],
  ['securityLevel', '可见范围'], ['confidentialityLevel', '密级'], ['accessWhitelist', '白名单']
] as const
const comparisonColumns = [{ accessorKey: 'field', header: '字段' }, { accessorKey: 'draft', header: '本地草稿' }, { accessorKey: 'latest', header: '最新内容' }]
const comparisonRows = computed(() => comparisonFields.map(([key, field]) => ({
  field,
  draft: String(key in accessForm ? accessForm[key as keyof ProjectAccessControl] ?? '' : form[key as keyof typeof form] ?? ''),
  latest: String(latestProject.value?.[key] ?? '')
})).filter(row => row.draft !== row.latest))
function requestStatus(cause: unknown) {
  const failure = cause as { statusCode?: number, status?: number, response?: { status?: number } } | null
  return failure?.statusCode || failure?.status || failure?.response?.status || 0
}
async function refreshComparison() {
  comparing.value = true
  comparisonError.value = ''
  latestProject.value = null
  try {
    const response = await $fetch<{ code?: number, data?: Record<string, unknown> }>(moduleUrl(`/api/v1/projects/${id.value}`))
    if (response.code !== 0 || !response.data?.editVersion) throw Error('最新资料暂不可用')
    latestProject.value = { ...response.data, startDate: String(response.data.startDate || '').slice(0, 10), endDate: String(response.data.endDate || '').slice(0, 10) }
  } catch {
    comparisonError.value = '无法读取最新内容，请稍后重试。你的草稿仍已保留。'
  } finally {
    comparing.value = false
  }
}
const nameValidationVisible = ref(false)
// Neutral until blur or submit; the save button is never silently disabled by
// the name, so submitting always reveals why a name cannot be saved.
const nameFieldError = computed(() => nameValidationVisible.value ? nameError.value || false : false)
async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await $fetch<{
      code?: number
      data?: Record<string, unknown>
    }>(moduleUrl(`/api/v1/projects/${id.value}`))
    if (r.code !== 0 || !r.data?.editVersion)
      throw Error('项目资料版本暂不可用')
    const p = r.data
    settingsProject.value = p
    projectName.value = String(p.name || '')
    projectLeaderUid.value = String(p.leaderUid || '')
    projectCurrentRole.value = String(p.currentUserRole ?? p.current_user_role ?? '')
    const access: ProjectAccessControl = {
      securityLevel: (p.securityLevel || 'company') as ProjectSecurityLevel,
      confidentialityLevel: (p.confidentialityLevel || 'L1') as ProjectConfidentialityLevel,
      accessWhitelist: Array.isArray(p.accessWhitelist) ? [...p.accessWhitelist] as string[] : null
    }
    Object.assign(accessForm, access)
    originalAccess.value = { ...access, accessWhitelist: access.accessWhitelist ? [...access.accessWhitelist] : null }
    Object.assign(form, { expectedVersion: p.editVersion, name: p.name || '', shortName: p.shortName || '', internalCode: p.internalCode || '', description: p.description || '', methodology: p.methodology || 'PIVR', portfolioId: p.portfolioId || null, domainCode: p.domainCode || '', deptCode: p.deptCode || '', leaderUid: p.leaderUid || '', startDate: String(p.startDate || '').slice(0, 10), endDate: String(p.endDate || '').slice(0, 10) })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '项目资料暂不可用'
  } finally {
    loading.value = false
  }
}
function updateBody() {
  const { name, ...rest } = form
  return nameChanged.value ? { ...rest, name } : rest
}
async function save() {
  nameValidationVisible.value = true
  if (nameError.value)
    return
  saving.value = true
  error.value = ''
  feedbackKind.value = ''
  operationKey.value ||= crypto.randomUUID()
  try {
    const r = await $fetch<{
      code?: number
    }>(moduleUrl(`/api/v1/projects/${id.value}`), { method: 'PUT', headers: { 'Idempotency-Key': operationKey.value }, body: updateBody() })
    if (r.code !== 0)
      throw Error('项目编辑响应无效')
    operationKey.value = ''
    if (projectContext)
      await projectContext.refresh().catch(() => { })
    await router.push(moduleUrl(`/projects/${id.value}`))
  } catch (e) {
    const status = requestStatus(e)
    const failure = e as { data?: { code?: string, data?: { code?: string } } }
    const code = failure?.data?.data?.code || failure?.data?.code
    if (status === 409 && code === 'idempotency_payload_mismatch') {
      feedbackKind.value = 'error'
      error.value = '该请求与先前保存内容不同。你的草稿已保留，请返回项目核对保存结果。'
    } else if (status === 409) {
      feedbackKind.value = 'conflict'
      error.value = '内容已被他人修改。你的草稿已保留，请刷新比较后再决定如何处理。'
    } else if (!status || status >= 500) {
      feedbackKind.value = 'uncertain'
      error.value = '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。你的草稿已保留。'
    } else {
      feedbackKind.value = 'error'
      error.value = status === 403 ? '你没有保存项目资料的权限。你的草稿已保留。' : '保存失败，请检查输入后重试。你的草稿已保留。'
    }
  } finally {
    saving.value = false
  }
}
async function saveAccess() {
  if (!canEditAccess.value || !originalAccess.value || !form.expectedVersion || (!accessChanged.value && !accessOperation.value)) return
  if (accessWhitelistError.value) return
  if (!accessOperation.value) {
    const patch = accessPatch.value
    const visibilityChanged = 'securityLevel' in patch
      || effectiveSecurityLevel.value !== effectiveProjectSecurityLevel(originalAccess.value.securityLevel, originalAccess.value.confidentialityLevel)
    if (visibilityChanged && !(await confirm({
      title: '确认变更项目可见范围',
      message: `项目“${projectName.value}”的可见范围将改变，可能影响现有成员及白名单用户的访问。服务端还会按密级收紧最终范围，保存后请重新核对项目访问。`,
      confirmLabel: '确认变更',
      tone: 'warning'
    }))) return
    accessOperation.value = { key: crypto.randomUUID(), body: { expectedVersion: form.expectedVersion, ...patch } }
  }
  accessSaving.value = true
  accessError.value = ''
  accessFeedback.value = ''
  try {
    const operation = accessOperation.value
    const result = await $fetch<{ code?: number }>(moduleUrl(`/api/v1/projects/${id.value}`), {
      method: 'PUT', headers: { 'Idempotency-Key': operation.key }, body: operation.body
    })
    if (result.code !== 0) throw Error('项目访问控制响应无效')
    accessOperation.value = null
    const basicDraft = { ...form }
    await load()
    Object.assign(form, { ...basicDraft, expectedVersion: form.expectedVersion })
    if (projectContext) await projectContext.refresh().catch(() => {})
  } catch (cause) {
    const status = requestStatus(cause)
    const failure = cause as { data?: { code?: string, data?: { code?: string } } }
    const code = failure?.data?.data?.code || failure?.data?.code
    if (status === 409 && code !== 'idempotency_payload_mismatch') {
      accessFeedback.value = 'conflict'
      accessError.value = '内容已被他人修改。访问控制草稿已保留，请刷新比较后再决定如何处理。'
      accessOperation.value = null
    } else if (!status || status >= 500) {
      accessFeedback.value = 'uncertain'
      accessError.value = '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。访问控制草稿已保留。'
    } else {
      accessFeedback.value = 'error'
      accessError.value = status === 403 ? '你没有修改此项目访问控制的权限。草稿已保留。' : '保存访问控制失败，请核对输入。草稿已保留。'
      accessOperation.value = null
    }
  } finally {
    accessSaving.value = false
  }
}
async function refreshSettings() {
  const basicDraft = { ...form }
  const accessDraft = { ...accessForm, accessWhitelist: accessForm.accessWhitelist ? [...accessForm.accessWhitelist] : null }
  await load()
  Object.assign(form, { ...basicDraft, expectedVersion: form.expectedVersion })
  Object.assign(accessForm, accessDraft)
  if (projectContext) await projectContext.refresh().catch(() => {})
}
onMounted(load)
</script>

<template>
  <UDashboardPanel id="enterprise-project-edit" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              v-if="!loading"
              class="shrink-0 whitespace-nowrap"
              size="sm"
              :loading="saving"
              :disabled="!form.shortName.trim()||!form.leaderUid.trim()"
              @click="save"
            >
              保存基本信息
            </UButton>
          </template>
        </ProjectNavbar>
        <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <section class="w-full min-w-0 space-y-5">
            <div>
              <UButton
                :to="moduleUrl(`/projects/${id}`)"
                variant="link"
                color="neutral"
                size="sm"
                icon="i-lucide-arrow-left"
              >
                返回项目
              </UButton><h2 class="mt-1 text-xl font-semibold text-highlighted">
                项目设置
              </h2>
            </div>
            <ProjectSettingsOverview
              v-if="settingsProject"
              :project-id="id"
              :project="settingsProject"
              :can-manage="canManageSettings"
            />
            <ProjectLifecycleSettings
              v-if="settingsProject"
              :project-id="id"
              :name="projectName"
              :status="projectLifecycle"
              :expected-version="form.expectedVersion"
              :can-manage="hasManagementRelationship"
              @refresh="refreshSettings"
            />
            <ProjectModuleSettings
              v-if="settingsProject"
              :project-id="id"
              :category="projectCategory"
              :config="settingsProject.moduleConfig ?? settingsProject.module_config ?? null"
              :expected-version="form.expectedVersion"
              :can-manage="canManageSettings"
              @saved="refreshSettings"
              @refresh="refreshSettings"
            />
            <UAlert
              v-if="error"
              color="error"
              :title="errorTitle"
              :description="error"
            >
              <template v-if="feedbackKind === 'conflict'" #actions>
                <UButton
                  label="刷新比较"
                  color="neutral"
                  variant="outline"
                  :loading="comparing"
                  @click="refreshComparison"
                />
              </template>
            </UAlert>
            <UAlert v-if="comparisonError" color="error" :description="comparisonError" />
            <UCard v-if="latestProject">
              <template #header>
                <h3 class="text-base font-semibold">
                  草稿与最新内容比较
                </h3>
              </template>
              <p class="mb-3 text-sm text-muted">
                刷新比较不会覆盖你的草稿，也不会自动提交。
              </p>
              <UTable
                class="project-save-comparison"
                :data="comparisonRows"
                :columns="comparisonColumns"
                :loading="comparing"
                :ui="{ td: 'whitespace-pre-wrap break-words' }"
              >
                <template #empty>
                  <CommonEmptyState title="暂无字段差异" description="版本已变化，请返回项目确认最新状态。" />
                </template>
              </UTable>
            </UCard><USkeleton v-if="loading" class="h-64" /><UCard v-else class="max-w-3xl">
              <template #header>
                <h3 class="font-semibold">
                  基本信息编辑
                </h3>
              </template>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField label="项目名称" required :error="nameFieldError">
                  <UInput v-model="form.name" @blur="nameValidationVisible=true" />
                </UFormField><UFormField label="项目简称" required>
                  <UInput v-model="form.shortName" />
                </UFormField><UFormField label="内部代号">
                  <UInput v-model="form.internalCode" />
                </UFormField><UFormField label="负责人" required>
                  <UserTreeSelector v-model="selectedLeader" selection-mode="single" :scope-dept-code="form.deptCode" />
                </UFormField><div>
                  <p class="text-sm text-muted">
                    所属部门
                  </p><p class="mt-1">
                    {{ departmentName }}
                  </p>
                </div><div>
                  <p class="text-sm text-muted">
                    业务领域
                  </p><p class="mt-1">
                    {{ domainName }}
                  </p>
                </div><UFormField label="开始日期">
                  <UInput v-model="form.startDate" type="date" />
                </UFormField><UFormField label="结束日期">
                  <UInput v-model="form.endDate" type="date" />
                </UFormField><UFormField label="说明" class="sm:col-span-2">
                  <UTextarea v-model="form.description" />
                </UFormField>
              </div>
            </UCard>
            <UCard v-if="!loading" class="mt-5 max-w-3xl">
              <template #header>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 class="font-semibold">
                      访问控制
                    </h3>
                    <p class="text-sm text-muted">
                      设置项目可见范围、密级与白名单。
                    </p>
                  </div>
                  <UButton
                    v-if="canEditAccess"
                    label="保存访问控制"
                    :loading="accessSaving"
                    :disabled="!!accessWhitelistError || (!accessChanged && !accessOperation)"
                    @click="saveAccess"
                  />
                </div>
              </template>
              <div class="space-y-4">
                <UAlert
                  v-if="!canEditAccess"
                  color="neutral"
                  title="访问控制只读"
                  description="仅拥有项目编辑范围权限的当前负责人或在职项目经理可修改。"
                />
                <UAlert
                  v-if="accessError"
                  color="error"
                  :title="accessFeedback === 'conflict' ? '内容已被他人修改' : accessFeedback === 'uncertain' ? '保存结果未确认' : '操作失败'"
                  :description="accessError"
                >
                  <template v-if="accessFeedback === 'conflict'" #actions>
                    <UButton
                      label="刷新比较"
                      color="neutral"
                      variant="outline"
                      :loading="comparing"
                      @click="refreshComparison"
                    />
                  </template>
                </UAlert>
                <ProjectAccessControlFields
                  v-model:security-level="accessForm.securityLevel"
                  v-model:confidentiality-level="accessForm.confidentialityLevel"
                  v-model:access-whitelist="accessForm.accessWhitelist"
                  show-confidentiality
                  always-show-whitelist
                  :disabled="!canEditAccess || !!accessOperation"
                />
                <p class="text-xs text-muted">
                  未调整白名单时不会提交该字段，原有空值保持不变。
                </p>
                <p v-if="accessWhitelistError" class="text-xs text-error">
                  {{ accessWhitelistError }}
                </p>
              </div>
            </UCard>
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.project-save-comparison :deep(table) { width: 100%; table-layout: fixed; }
.project-save-comparison :deep(td) { white-space: pre-wrap; overflow-wrap: anywhere; }
.project-save-comparison :deep(th:first-child) { width: 6rem; }
</style>
