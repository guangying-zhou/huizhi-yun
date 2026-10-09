<script setup lang="ts">
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import UserTreeSelector from '@hzy/foundation/app/components/UserTreeSelector.vue'
import ProjectAccessControlFields from './ProjectAccessControlFields.vue'
import ProjectPortfolioSelect from './ProjectPortfolioSelect.vue'
import type { AdminProject } from '../../types/adminProject'
import { effectiveProjectSecurityLevel, projectAccessControlPatch, type ProjectAccessControl } from '../../utils/projectAccessControl'
import { methodologyOptions } from '../../config/project'
import { useAimsModule } from '../../../layer/useAimsModule'

const {
  moduleUrl } = useAimsModule()
const {
  confirm } = useConfirm()
function statusOf(cause: unknown) {
  const failure = cause as {
    statusCode?: number
    status?: number
    response?: {
      status?: number } }
  return failure?.statusCode || failure?.status || failure?.response?.status || 0
}
type EditableField = 'name' | 'shortName' | 'internalCode' | 'description' | 'methodology' | 'portfolioId' | 'domainCode' | 'deptCode' | 'leaderUid' | 'startDate' | 'endDate'
const editableFields: EditableField[] = ['name', 'shortName', 'internalCode', 'description', 'methodology', 'portfolioId', 'domainCode', 'deptCode', 'leaderUid', 'startDate', 'endDate']
type ProjectDraft = {
  [K in EditableField]: K extends 'portfolioId' ? number | null : string } & ProjectAccessControl
const emit = defineEmits<{
  saved: [] }>()
const props = defineProps<{
  project: AdminProject }>()
const editing = ref<AdminProject | null>(null)
const original = ref<ProjectDraft | null>(null)
const draft = ref<ProjectDraft | null>(null)
const portfolioValue = computed({
  get: () => draft.value?.portfolioId?.toString() || '',
  set: (value: string) => {
    if (draft.value) draft.value.portfolioId = value ? Number(value) : null
  }
})
const saving = ref(false)
const editError = ref('')
const editFeedback = ref<'conflict' | 'uncertain' | 'error' | ''>('')
const editDenied = ref(false)
const pendingWrite = ref<{
  key: string
  body: Record<string, unknown> } | null>(null)
const latest = ref<AdminProject | null>(null)

function toDraft(project: AdminProject): ProjectDraft {
  return {
    name: project.name, shortName: project.shortName || '', internalCode: project.internalCode || '', description: project.description || '', methodology: project.methodology,
    portfolioId: project.portfolioId, domainCode: project.domainCode || '', deptCode: project.deptCode || '', leaderUid: project.leaderUid || '',
    startDate: project.startDate?.slice(0, 10) || '', endDate: project.endDate?.slice(0, 10) || '',
    securityLevel: project.securityLevel, confidentialityLevel: project.confidentialityLevel,
    accessWhitelist: project.accessWhitelist ? [...project.accessWhitelist] : null
  }
}

function openEdit(project: AdminProject) {
  editing.value = project
  original.value = toDraft(project)
  draft.value = toDraft(project)
  editError.value = ''
  editFeedback.value = ''
  editDenied.value = false
  pendingWrite.value = null
  latest.value = null
}

const patch = computed<Record<string, unknown>>(() => {
  if (!original.value || !draft.value) return {}
  const result: Record<string, unknown> = {
    ...projectAccessControlPatch(original.value, draft.value) }
  for (const field of editableFields) {
    if (draft.value[field] !== original.value[field]) result[field] = draft.value[field]
  }
  return result
})
const whitelistError = computed(() => (draft.value?.accessWhitelist?.length || 0) > 100 ? '白名单最多选择 100 人' : '')
const canSave = computed(() => Boolean(editing.value && draft.value && !editDenied.value && !whitelistError.value && (Object.keys(patch.value).length || pendingWrite.value)))
const latestDifferences = computed(() => {
  if (!draft.value || !latest.value) return []
  const current = toDraft(latest.value)
  const fields: (keyof ProjectDraft)[] = [...editableFields, 'securityLevel', 'confidentialityLevel', 'accessWhitelist']
  return fields.map(field => ({
    field, draft: String(draft.value?.[field] ?? ''), latest: String(current[field] ?? '') })).filter(row => row.draft !== row.latest)
})
const differenceColumns = [{
  accessorKey: 'field', header: '字段' }, {
  accessorKey: 'draft', header: '本地草稿' }, {
  accessorKey: 'latest', header: '最新值' }]

async function refreshComparison() {
  if (!editing.value) return
  latest.value = null
  try {
    const response = await $fetch<{
      code: number
      data?: {
        items: AdminProject[] } }>(moduleUrl('/api/v1/admin/projects'), {
      query: {
        page: 1, pageSize: 20, projectId: String(editing.value.id) }
    })
    latest.value = response.code === 0 ? response.data?.items.find(project => project.id === editing.value?.id) || null : null
    if (!latest.value) editError.value = '未能在当前筛选结果中找到最新项目，草稿仍已保留。'
  } catch {
    editError.value = '无法读取最新内容，草稿仍已保留。'
  }
}

async function saveEdit() {
  if (!editing.value || !draft.value || !canSave.value || saving.value) return
  if (!pendingWrite.value) {
    const changed = patch.value
    const previous = original.value!
    const visibilityChanged = 'securityLevel' in changed || effectiveProjectSecurityLevel(previous.securityLevel, previous.confidentialityLevel) !== effectiveProjectSecurityLevel(draft.value.securityLevel, draft.value.confidentialityLevel)
    if (visibilityChanged && !(await confirm({
      title: '确认变更项目可见范围', message: `项目“${editing.value.name}”的可见范围将改变，可能影响现有成员与白名单用户的访问。保存后请以服务端回读结果为准。`, confirmLabel: '确认变更', tone: 'warning' }))) return
    pendingWrite.value = {
      key: crypto.randomUUID(), body: {
        expectedVersion: editing.value.editVersion, ...changed } }
  }
  saving.value = true
  editError.value = ''
  editFeedback.value = ''
  try {
    const operation = pendingWrite.value
    const response = await $fetch<{
      code: number }>(moduleUrl(`/api/v1/admin/projects/${editing.value.id}`), {
      method: 'PUT', headers: {
        'Idempotency-Key': operation.key }, body: operation.body })
    if (response.code !== 0) throw Error('管理员项目保存响应无效')
    pendingWrite.value = null
    emit('saved')
  } catch (cause) {
    const status = statusOf(cause)
    if (status === 409) {
      editFeedback.value = 'conflict'
      editError.value = '内容已被他人修改。草稿已保留，请刷新比较。'
      pendingWrite.value = null
    } else if (!status || status >= 500) {
      editFeedback.value = 'uncertain'
      editError.value = '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。草稿已保留。'
    } else {
      editFeedback.value = 'error'
      editDenied.value = status === 403
      editError.value = editDenied.value ? '管理员项目编辑权限已失效，表单已切为只读。' : '保存失败，请检查输入；草稿已保留。'
      pendingWrite.value = null
    }
  } finally {
    saving.value = false
  }
}

watch(() => props.project, openEdit, {
  immediate: true })
const leaderSelection = computed({
  get: () => draft.value?.leaderUid ? [draft.value.leaderUid] : [], set: (uids: string[]) => {
    if (draft.value) draft.value.leaderUid = uids[0] || ''
  } })
</script>

<template>
  <section class="mx-auto w-full max-w-[720px]">
    <div v-if="draft && editing" class="space-y-5">
      <p class="text-sm text-muted">
        {{ editing.projectCode }} · {{ editing.name }}
      </p>
      <UAlert
        v-if="editError"
        color="error"
        :title="editFeedback === 'conflict' ? '内容已被他人修改' : editFeedback === 'uncertain' ? '保存结果未确认' : '操作失败'"
        :description="editError"
      >
        <template v-if="editFeedback === 'conflict'" #actions>
          <UButton
            label="刷新比较"
            variant="outline"
            color="neutral"
            @click="refreshComparison"
          />
        </template>
      </UAlert>
      <UTable v-if="latest" :data="latestDifferences" :columns="differenceColumns">
        <template #empty>
          <CommonEmptyState title="暂无字段差异" />
        </template>
      </UTable>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="项目名称">
          <UInput v-model="draft.name" :disabled="editDenied || !!pendingWrite" class="w-full" />
        </UFormField>
        <UFormField label="项目简称">
          <UInput v-model="draft.shortName" :disabled="editDenied || !!pendingWrite" class="w-full" />
        </UFormField>
        <UFormField label="内部代号">
          <UInput v-model="draft.internalCode" :disabled="editDenied || !!pendingWrite" class="w-full" />
        </UFormField>
        <UFormField label="方法论">
          <USelect
            v-model="draft.methodology"
            :items="methodologyOptions"
            value-key="value"
            :disabled="editDenied || !!pendingWrite"
            class="w-full"
          />
        </UFormField>
        <UFormField label="项目集">
          <ProjectPortfolioSelect v-model="portfolioValue" :disabled="editDenied || !!pendingWrite" />
        </UFormField>
        <UFormField label="业务领域编码">
          <UInput v-model="draft.domainCode" :disabled="editDenied || !!pendingWrite" class="w-full" />
        </UFormField>
        <UFormField label="部门编码">
          <UInput v-model="draft.deptCode" :disabled="editDenied || !!pendingWrite" class="w-full" />
        </UFormField>
        <UFormField label="负责人">
          <UserTreeSelector
            v-model="leaderSelection"
            selection-mode="single"
            :disabled="editDenied || !!pendingWrite"
            width-class="w-full"
          />
        </UFormField>
        <UFormField label="开始日期">
          <UInput
            v-model="draft.startDate"
            type="date"
            :disabled="editDenied || !!pendingWrite"
            class="w-full"
          />
        </UFormField>
        <UFormField label="结束日期">
          <UInput
            v-model="draft.endDate"
            type="date"
            :disabled="editDenied || !!pendingWrite"
            class="w-full"
          />
        </UFormField>
        <UFormField label="项目说明" class="sm:col-span-2">
          <UTextarea v-model="draft.description" :disabled="editDenied || !!pendingWrite" class="w-full" />
        </UFormField>
      </div>
      <div class="border-t border-default pt-5">
        <h3 class="mb-3 font-semibold">
          访问控制
        </h3>
        <ProjectAccessControlFields
          v-model:security-level="draft.securityLevel"
          v-model:confidentiality-level="draft.confidentialityLevel"
          v-model:access-whitelist="draft.accessWhitelist"
          show-confidentiality
          always-show-whitelist
          :disabled="editDenied || !!pendingWrite"
        />
        <p v-if="whitelistError" class="mt-2 text-xs text-error">
          {{ whitelistError }}
        </p>
      </div>
    </div>
    <div class="flex justify-end gap-2 p-4">
      <UButton
        label="取消"
        color="neutral"
        variant="outline"
        :to="moduleUrl('/admin/projects')"
      />
      <UButton
        label="保存"
        :loading="saving"
        :disabled="!canSave"
        @click="saveEdit"
      />
    </div>
  </section>
</template>
