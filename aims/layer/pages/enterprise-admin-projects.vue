<script setup lang="ts">
import ContentPageHeader from '@hzy/foundation/app/components/ContentPageHeader.vue'
import ProjectAccessControlFields from '../../app/components/project/ProjectAccessControlFields.vue'
import { methodologyOptions, projectCategoryConfig, projectCategoryOptions, projectConfidentialityLevelConfig, projectSecurityLevelConfig, projectStatusConfig, projectStatusOptions } from '../../app/config/project'
import type { ProjectCategory, ProjectConfidentialityLevel, ProjectSecurityLevel } from '../../app/types/aims'
import { effectiveProjectSecurityLevel, projectAccessControlPatch, type ProjectAccessControl } from '../../app/utils/projectAccessControl'
import { useAimsModule } from '../useAimsModule'

interface AdminProject {
  id: number
  projectCode: string
  name: string
  shortName: string | null
  internalCode: string | null
  description: string | null
  category: ProjectCategory
  lifecycleStatus: string
  methodology: string
  portfolioId: number | null
  domainCode: string | null
  deptCode: string | null
  leaderUid: string | null
  startDate: string | null
  endDate: string | null
  securityLevel: ProjectSecurityLevel
  confidentialityLevel: ProjectConfidentialityLevel
  accessWhitelist: string[] | null
  editVersion: string
}

type EditableField = 'name' | 'shortName' | 'internalCode' | 'description' | 'methodology' | 'portfolioId' | 'domainCode' | 'deptCode' | 'leaderUid' | 'startDate' | 'endDate'
const editableFields: EditableField[] = ['name', 'shortName', 'internalCode', 'description', 'methodology', 'portfolioId', 'domainCode', 'deptCode', 'leaderUid', 'startDate', 'endDate']
type ProjectDraft = Pick<AdminProject, EditableField> & ProjectAccessControl

const { moduleUrl } = useAimsModule()
const { confirm } = useConfirm()
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const page = ref(1)
const pageSize = 20
// Nuxt UI v4 SelectItem rejects '' as a value; 'all' is the "no filter"
// sentinel (same convention as the project overview) and is never sent.
const ALL = 'all'
const category = ref(ALL)
const lifecycleStatus = ref(ALL)
const portfolioId = ref('')
const items = ref<AdminProject[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const forbidden = ref(false)
let listRequest = 0

const categoryOptions = [{ label: '全部类型', value: ALL }, ...projectCategoryOptions]
const lifecycleOptions = [{ label: '全部状态', value: ALL }, ...projectStatusOptions]
const filterValue = (value: string) => value && value !== ALL ? value : undefined
const columns = [
  { accessorKey: 'projectCode', header: '项目编码' },
  { accessorKey: 'name', header: '项目名称' },
  { accessorKey: 'category', header: '类型' },
  { accessorKey: 'lifecycleStatus', header: '状态' },
  { accessorKey: 'securityLevel', header: '可见范围' },
  { accessorKey: 'confidentialityLevel', header: '密级' },
  { id: 'actions', header: '操作' }
]

function statusOf(cause: unknown) {
  const failure = cause as { statusCode?: number, status?: number, response?: { status?: number } }
  return failure?.statusCode || failure?.status || failure?.response?.status || 0
}

async function loadProjects() {
  const request = ++listRequest
  loading.value = true
  error.value = ''
  forbidden.value = false
  items.value = []
  total.value = 0
  try {
    const response = await $fetch<{ code: number, data?: { items: AdminProject[], total: number, page: number, pageSize: number } }>(moduleUrl('/api/v1/admin/projects'), {
      query: { page: page.value, pageSize, search: debounced.value || undefined, category: filterValue(category.value), lifecycleStatus: filterValue(lifecycleStatus.value), portfolioId: portfolioId.value || undefined }
    })
    if (request !== listRequest) return
    if (response.code !== 0 || !Array.isArray(response.data?.items) || response.data.page !== page.value || response.data.pageSize !== pageSize || !Number.isSafeInteger(response.data.total)) throw Error('管理员项目列表响应无效')
    items.value = response.data.items
    total.value = response.data.total
  } catch (cause) {
    if (request !== listRequest) return
    items.value = []
    total.value = 0
    forbidden.value = statusOf(cause) === 403
    error.value = forbidden.value ? '你没有管理员项目查看权限。' : '项目列表暂不可用，请稍后重试。'
  } finally {
    if (request === listRequest) loading.value = false
  }
}

// Reset synchronously so a filter change issues one request for page 1.
watch([category, lifecycleStatus, portfolioId], () => {
  page.value = 1
}, { flush: 'sync' })
watch([page, debounced, category, lifecycleStatus, portfolioId], () => void loadProjects(), { immediate: true })

const editOpen = ref(false)
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
const pendingWrite = ref<{ key: string, body: Record<string, unknown> } | null>(null)
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
  editOpen.value = true
}

const patch = computed<Record<string, unknown>>(() => {
  if (!original.value || !draft.value) return {}
  const result: Record<string, unknown> = { ...projectAccessControlPatch(original.value, draft.value) }
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
  return [...editableFields, 'securityLevel', 'confidentialityLevel', 'accessWhitelist'].map(field => ({ field, draft: String(draft.value?.[field] ?? ''), latest: String(current[field] ?? '') })).filter(row => row.draft !== row.latest)
})
const differenceColumns = [{ accessorKey: 'field', header: '字段' }, { accessorKey: 'draft', header: '本地草稿' }, { accessorKey: 'latest', header: '最新值' }]

async function refreshComparison() {
  if (!editing.value) return
  latest.value = null
  try {
    const response = await $fetch<{ code: number, data?: { items: AdminProject[] } }>(moduleUrl('/api/v1/admin/projects'), {
      query: { page: 1, pageSize: 100, search: editing.value.projectCode }
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
    if (visibilityChanged && !(await confirm({ title: '确认变更项目可见范围', message: `项目“${editing.value.name}”的可见范围将改变，可能影响现有成员与白名单用户的访问。保存后请以服务端回读结果为准。`, confirmLabel: '确认变更', tone: 'warning' }))) return
    pendingWrite.value = { key: crypto.randomUUID(), body: { expectedVersion: editing.value.editVersion, ...changed } }
  }
  saving.value = true
  editError.value = ''
  editFeedback.value = ''
  try {
    const operation = pendingWrite.value
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/admin/projects/${editing.value.id}`), { method: 'PUT', headers: { 'Idempotency-Key': operation.key }, body: operation.body })
    if (response.code !== 0) throw Error('管理员项目保存响应无效')
    pendingWrite.value = null
    editOpen.value = false
    await loadProjects()
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
</script>

<template>
  <UDashboardPanel id="enterprise-admin-projects" :ui="{ body: 'min-h-0 overflow-y-auto p-4 sm:p-6' }">
    <template #body>
      <div class="space-y-5">
        <ContentPageHeader hosted title="项目管理" description="管理员查看项目并编辑基本信息与访问控制。">
          <template #actions>
            <UButton
              label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              :loading="loading"
              @click="loadProjects"
            />
          </template>
        </ContentPageHeader>
        <div class="flex flex-wrap gap-3">
          <UInput
            v-model="search"
            placeholder="搜索名称或编码"
            class="min-w-52 flex-1"
            @keyup.enter="flush"
          />
          <USelect
            v-model="category"
            :items="categoryOptions"
            value-key="value"
            aria-label="项目类型"
            class="w-40"
          />
          <USelect
            v-model="lifecycleStatus"
            :items="lifecycleOptions"
            value-key="value"
            aria-label="项目状态"
            class="w-40"
          />
          <UInput
            v-model="portfolioId"
            type="number"
            min="1"
            placeholder="项目集 ID"
            aria-label="项目集 ID"
            class="w-36"
          />
        </div>
        <CommonEmptyState v-if="forbidden" title="无权限" description="你没有管理员项目查看权限。" />
        <UAlert
          v-else-if="error"
          color="error"
          title="项目列表加载失败"
          :description="error"
        />
        <template v-else>
          <UTable
            :data="items"
            :columns="columns"
            :loading="loading"
            class="hidden w-full md:block"
          >
            <template #projectCode-cell="{ row }">
              <span class="font-mono text-xs">{{ row.original.projectCode }}</span>
            </template>
            <template #name-cell="{ row }">
              <span class="block max-w-72 truncate" :title="row.original.name">{{ row.original.name }}</span>
            </template>
            <template #category-cell="{ row }">
              {{ projectCategoryConfig[row.original.category]?.label || row.original.category }}
            </template>
            <template #lifecycleStatus-cell="{ row }">
              <UBadge :color="projectStatusConfig[row.original.lifecycleStatus]?.color || 'neutral'" variant="subtle">
                {{ projectStatusConfig[row.original.lifecycleStatus]?.label || row.original.lifecycleStatus }}
              </UBadge>
            </template>
            <template #securityLevel-cell="{ row }">
              {{ projectSecurityLevelConfig[row.original.securityLevel]?.label || row.original.securityLevel }}
            </template>
            <template #confidentialityLevel-cell="{ row }">
              {{ projectConfidentialityLevelConfig[row.original.confidentialityLevel]?.label || row.original.confidentialityLevel }}
            </template>
            <template #actions-cell="{ row }">
              <UButton
                label="编辑"
                size="sm"
                variant="soft"
                @click="openEdit(row.original)"
              />
            </template>
            <template #empty>
              <CommonEmptyState title="暂无项目" description="当前筛选条件下没有可查看的项目。" />
            </template>
          </UTable>
          <div class="grid gap-3 md:hidden">
            <USkeleton v-if="loading" class="h-28 w-full" />
            <CommonEmptyState v-else-if="items.length === 0" title="暂无项目" description="当前筛选条件下没有可查看的项目。" />
            <UCard v-for="project in items" v-else :key="project.id">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate font-medium" :title="project.name">
                    {{ project.name }}
                  </p>
                  <p class="mt-1 truncate font-mono text-xs text-muted">
                    {{ project.projectCode }}
                  </p>
                </div>
                <UButton
                  label="编辑"
                  size="sm"
                  variant="soft"
                  class="shrink-0"
                  @click="openEdit(project)"
                />
              </div>
              <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                <span>{{ projectCategoryConfig[project.category]?.label || project.category }}</span>
                <span>{{ projectStatusConfig[project.lifecycleStatus]?.label || project.lifecycleStatus }}</span>
                <span>{{ projectSecurityLevelConfig[project.securityLevel]?.label || project.securityLevel }}</span>
              </div>
            </UCard>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
          </div>
        </template>
      </div>
      <USlideover v-model:open="editOpen" :ui="{ content: 'w-full sm:max-w-3xl' }" title="编辑项目">
        <template #body>
          <div v-if="draft && editing" class="space-y-5 p-4">
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
              <UFormField label="项目集 ID">
                <UInput
                  v-model="portfolioValue"
                  type="number"
                  min="1"
                  :disabled="editDenied || !!pendingWrite"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="业务领域编码">
                <UInput v-model="draft.domainCode" :disabled="editDenied || !!pendingWrite" class="w-full" />
              </UFormField>
              <UFormField label="部门编码">
                <UInput v-model="draft.deptCode" :disabled="editDenied || !!pendingWrite" class="w-full" />
              </UFormField>
              <UFormField label="负责人 UID">
                <UInput v-model="draft.leaderUid" :disabled="editDenied || !!pendingWrite" class="w-full" />
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
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 p-4">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              @click="editOpen = false"
            />
            <UButton
              label="保存"
              :loading="saving"
              :disabled="!canSave"
              @click="saveEdit"
            />
          </div>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
