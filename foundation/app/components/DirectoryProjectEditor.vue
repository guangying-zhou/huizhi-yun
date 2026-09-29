<script setup lang="ts">
import DirectoryFormSurface from './DirectoryFormSurface.vue'
import type { ConsoleDirectoryProject as DirectoryProject, ConsoleDirectoryProjectMember as DirectoryProjectMember } from '../types/consoleDirectory'
import { createConsoleMutationIntent, type ConsoleMutationRequest } from '../../shared/utils/consoleMutationIntent'

const props = defineProps<{ page?: boolean, initialMode?: 'create' | 'edit' | 'members', initialProject?: DirectoryProject | null, apiPath: string, projects: DirectoryProject[], departments: Array<{ deptCode: string, name: string, level: number, orgType: string }>, canEdit: boolean, refresh: () => Promise<unknown> }>()
const emit = defineEmits<{ denied: [status: number], closed: [] }>()
const projectSurface = ref<InstanceType<typeof DirectoryFormSurface> | null>(null)
const membersSurface = ref<InstanceType<typeof DirectoryFormSurface> | null>(null)
const toast = useToast()
const { confirm } = useConfirm()
const noSelectionValue = '__none__'
const projectModalOpen = ref(false)
const projectModalMode = ref<'create' | 'edit'>('create')
const saving = ref(false)
const locked = ref(false)
const projectForm = reactive({ projectCode: '', name: '', parentProjectCode: noSelectionValue, projectType: 'project', deptCode: noSelectionValue, ownerUid: '', leaderUid: '', repoUrl: '', description: '', status: 'active' })
const initialPayload = ref<ReturnType<typeof projectPayload> | null>(null)
const formStatusOptions = [{ label: '正常', value: 'active' }, { label: '停用', value: 'inactive' }, { label: '归档', value: 'archived' }]
function associationOptions(options: Array<{ label: string, value: string }>, current: string) {
  return current !== noSelectionValue && !options.some(option => option.value === current) ? [...options, { label: current, value: current }] : options
}
const projectTypeOptions = [
  { label: '项目', value: 'project' },
  { label: '项目组', value: 'group' },
  { label: '模板', value: 'template' }
]
const parentProjectOptions = computed(() => associationOptions([
  { label: '无父级', value: noSelectionValue },
  ...props.projects
    .filter(project => projectModalMode.value === 'create' || project.projectCode !== projectForm.projectCode)
    .map(project => ({
      label: project.name,
      value: project.projectCode
    }))
], projectForm.parentProjectCode))
const departmentOptions = computed(() => associationOptions([
  { label: '未关联部门', value: noSelectionValue },
  ...(props.departments)
    .filter(dept => dept.orgType === 'department')
    .map(dept => ({
      label: `${'  '.repeat(Math.max(0, dept.level - 1))}${dept.name}`,
      value: dept.deptCode
    }))
], projectForm.deptCode))

function resetProjectForm() {
  projectForm.projectCode = ''
  projectForm.name = ''
  projectForm.parentProjectCode = noSelectionValue
  projectForm.projectType = 'project'
  projectForm.deptCode = noSelectionValue
  projectForm.ownerUid = ''
  projectForm.leaderUid = ''
  projectForm.repoUrl = ''
  projectForm.description = ''
  projectForm.status = 'active'
}

function getProjectType(project: DirectoryProject) {
  if (project.isTemplate) return 'template'
  if (project.isGroup) return 'group'
  return 'project'
}

function getProjectStatus(project: DirectoryProject) {
  if (project.statusKey) return project.statusKey
  if (project.status === 1) return 'active'
  if (project.status === -1) return 'deleted'
  return 'inactive'
}

function openCreateProject() {
  if (!allowed()) return
  mutation.reset()
  initialPayload.value = null
  resetProjectForm()
  projectModalMode.value = 'create'
  projectModalOpen.value = true
}

function openEditProject(project: DirectoryProject) {
  if (!allowed() || project.status === -1) return
  mutation.reset()
  resetProjectForm()
  projectModalMode.value = 'edit'
  projectForm.projectCode = project.projectCode
  projectForm.name = project.name
  projectForm.parentProjectCode = project.parentId || noSelectionValue
  projectForm.projectType = getProjectType(project)
  projectForm.deptCode = project.deptCode || noSelectionValue
  projectForm.ownerUid = project.ownerUid || ''
  projectForm.leaderUid = project.leaderUid || ''
  projectForm.repoUrl = project.repoUrl || ''
  projectForm.description = project.description || ''
  projectForm.status = getProjectStatus(project)
  initialPayload.value = projectPayload()
  projectModalOpen.value = true
}

function projectPayload() {
  return {
    projectCode: projectForm.projectCode.trim(),
    name: projectForm.name.trim(),
    parentProjectCode: projectForm.parentProjectCode === noSelectionValue ? null : projectForm.parentProjectCode,
    projectType: projectForm.projectType,
    deptCode: projectForm.deptCode === noSelectionValue ? null : projectForm.deptCode,
    ownerUid: projectForm.ownerUid.trim() || null,
    leaderUid: projectForm.leaderUid.trim() || null,
    repoUrl: projectForm.repoUrl.trim() || null,
    description: projectForm.description.trim() || null,
    status: projectForm.status
  }
}

const mutation = createConsoleMutationIntent('directory:project')
const lastSuccess = ref<(() => void) | null>(null)
function allowed() {
  if (!props.canEdit || saving.value || membersPending.value) return false
  if (mutation.uncertain) {
    toast.add({ title: '请先重试未完成的操作', color: 'warning' })
    return false
  }
  return true
}
function errorStatus(error: unknown) {
  const record = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return Number(record.statusCode || record.status || record.response?.status || 0)
}
async function run(request: ConsoleMutationRequest, success: () => void) {
  if (!props.canEdit || saving.value) return
  saving.value = true
  lastSuccess.value = success
  try {
    if (!(await mutation.submit(request, (input, key) => $fetch<unknown, string>(input.path, { method: input.method, headers: { 'Idempotency-Key': key }, body: input.body })))) return
    locked.value = false
    success()
    toast.add({ title: request.method === 'DELETE' ? '项目已删除' : '项目已保存', color: 'success' })
    try {
      await props.refresh()
    } catch {
      toast.add({ title: '已保存，刷新失败', description: '请重试刷新列表。', color: 'warning' })
    }
  } catch (error) {
    locked.value = mutation.uncertain
    const status = errorStatus(error)
    if (status === 401 || status === 403) emit('denied', status)
    toast.add({ title: request.method === 'DELETE' ? '删除失败' : '保存失败', description: mutation.uncertain ? '操作结果未确认，请重试原请求。' : '请检查输入或权限后重试。', color: 'error' })
  } finally { saving.value = false }
}
async function submitProject() {
  if (!allowed()) return
  if (!projectForm.projectCode.trim() || !projectForm.name.trim()) {
    toast.add({ title: '项目编码和名称不能为空', color: 'warning' })
    return
  }
  const current = projectPayload()
  const body = projectModalMode.value === 'create' ? current : Object.fromEntries(Object.entries(current).filter(([key, value]) => key !== 'projectCode' && value !== initialPayload.value?.[key as keyof typeof current]))
  if (projectModalMode.value === 'edit' && !Object.keys(body).length) {
    projectSurface.value?.markSaved()
    projectModalOpen.value = false
    return
  }
  await run({ method: projectModalMode.value === 'create' ? 'POST' : 'PATCH', path: projectModalMode.value === 'create' ? props.apiPath : `${props.apiPath}/${encodeURIComponent(current.projectCode)}`, body }, () => {
    projectSurface.value?.markSaved()
    projectModalOpen.value = false
  })
}
async function deleteProject(project: DirectoryProject) {
  if (!allowed()) return
  if (!(await confirm({ title: '删除项目', message: `确认删除项目「${project.name}」？删除后不可恢复。`, tone: 'danger' }))) return
  await run({ method: 'DELETE', path: `${props.apiPath}/${encodeURIComponent(project.projectCode)}` }, () => {})
}
async function retry() {
  if (mutation.pending && lastSuccess.value) await run(mutation.pending, lastSuccess.value)
}
const selectedProject = ref<DirectoryProject | null>(null)
const members = ref<DirectoryProjectMember[]>([])
const membersPending = ref(false)
const membersError = ref('')
const membersReady = ref(false)
const editableMembersText = ref('')
const isMembersModalOpen = ref(false)
async function loadMembers(project: DirectoryProject) {
  if (saving.value || membersPending.value || mutation.uncertain) return
  mutation.reset()
  selectedProject.value = project
  isMembersModalOpen.value = true
  members.value = []
  editableMembersText.value = ''
  membersError.value = ''
  membersReady.value = false
  membersPending.value = true
  try {
    const response = await $fetch<{ code: number, data: { items: DirectoryProjectMember[], total: number } }>(`${props.apiPath}/members`, { query: { projectCode: project.projectCode, page: 1, pageSize: 100, status: 'active' } })
    members.value = response.data.items
    if (!Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.total > 100 || response.data.items.length !== response.data.total) {
      membersError.value = '未取得完整成员列表，不能执行全量替换。'
      return
    }
    editableMembersText.value = members.value.map(member => `${member.uid}:${member.role || 'member'}`).join('\n')
    membersReady.value = true
  } catch (error) {
    membersError.value = '加载成员失败，请重新打开重试。'
    const status = errorStatus(error)
    if (status === 401 || status === 403) emit('denied', status)
  } finally { membersPending.value = false }
}
async function saveMembers() {
  if (!allowed() || !membersReady.value || !selectedProject.value) return
  const entries = editableMembersText.value.split(/\r?\n|,/).map(line => line.trim()).filter(Boolean).map(line => line.split(':').map(part => part.trim()))
  const seen = new Set<string>()
  const invalidMembers = entries.length > 100 || entries.some(([uid, role, extra]) => {
    if (!uid || extra !== undefined || !/^[A-Za-z0-9_.-]{1,128}$/.test(uid) || uid === '.' || uid === '..' || (role && !['owner', 'admin', 'member', 'viewer'].includes(role)) || seen.has(uid)) return true
    seen.add(uid)
    return false
  })
  if (invalidMembers) {
    membersError.value = '成员最多 100 人，UID 不可重复，角色需为 owner/admin/member/viewer。'
    return
  }
  if (!(await confirm({ title: '保存项目成员', message: `项目「${selectedProject.value.name}」将以当前列表替换全部成员；未列出的成员将被移除。`, tone: 'warning' }))) return
  membersError.value = ''
  await run({ method: 'POST', path: `${props.apiPath}/members`, body: { projectCode: selectedProject.value.projectCode, members: entries.map(([uid, role]) => ({ uid, role: role || 'member' })) } }, () => {
    membersSurface.value?.markSaved()
    isMembersModalOpen.value = false
    membersReady.value = false
  })
}
watch([projectModalOpen, isMembersModalOpen], ([projectOpen, membersOpen], [wasProjectOpen, wereMembersOpen]) => {
  if (props.page && ((wasProjectOpen && !projectOpen) || (wereMembersOpen && !membersOpen))) emit('closed')
})
if (props.page) {
  if (props.initialMode === 'members' && props.initialProject) void loadMembers(props.initialProject)
  else if (props.initialMode === 'edit' && props.initialProject) openEditProject(props.initialProject)
  else if (props.initialMode === 'create') openCreateProject()
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <slot
      :create="openCreateProject"
      :edit="openEditProject"
      :remove="deleteProject"
      :members="loadMembers"
      :saving="saving || membersPending || locked"
    />
    <UAlert
      v-if="locked"
      color="warning"
      title="操作结果未确认"
      description="请重试原请求；确认结果前不能开始新的修改。"
    >
      <template #actions>
        <UButton
          label="重试原请求"
          :loading="saving"
          :disabled="!canEdit"
          @click="retry"
        />
      </template>
    </UAlert>
    <DirectoryFormSurface
      v-if="!props.page || props.initialMode !== 'members'"
      ref="projectSurface"
      v-model:open="projectModalOpen"
      :page="props.page"
      :draft="JSON.stringify(projectForm)"
      :busy="saving"
      :title="projectModalMode === 'create' ? '新建项目注册' : '编辑项目注册'"
      :ui="{ header: 'directory-editor-header', wrapper: 'directory-editor-heading', title: 'directory-editor-title', description: 'directory-editor-description', close: 'directory-editor-close', content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <fieldset :disabled="saving || locked || !canEdit" class="grid gap-4 md:grid-cols-2">
          <UFormField label="项目编码" required>
            <UInput
              v-model="projectForm.projectCode"
              class="w-full"
              :disabled="projectModalMode === 'edit'"
              placeholder="例如：platform-workflow"
            />
          </UFormField>

          <UFormField label="项目名称" required>
            <UInput
              v-model="projectForm.name"
              class="w-full"
              placeholder="项目显示名称"
            />
          </UFormField>

          <UFormField label="父级项目">
            <USelect
              v-model="projectForm.parentProjectCode"
              class="w-full"
              :items="parentProjectOptions"
            />
          </UFormField>

          <UFormField label="项目类型">
            <USelect
              v-model="projectForm.projectType"
              class="w-full"
              :items="projectTypeOptions"
            />
          </UFormField>

          <UFormField label="关联部门">
            <USelect
              v-model="projectForm.deptCode"
              class="w-full"
              :items="departmentOptions"
            />
          </UFormField>

          <UFormField label="状态">
            <USelect
              v-model="projectForm.status"
              class="w-full"
              :items="formStatusOptions"
            />
          </UFormField>

          <UFormField label="Owner UID">
            <UInput
              v-model="projectForm.ownerUid"
              class="w-full"
              placeholder="留空表示未设置"
            />
          </UFormField>

          <UFormField label="负责人 UID">
            <UInput
              v-model="projectForm.leaderUid"
              class="w-full"
              placeholder="留空表示未设置"
            />
          </UFormField>

          <UFormField
            label="仓库地址"
            class="md:col-span-2"
          >
            <UInput
              v-model="projectForm.repoUrl"
              class="w-full"
              placeholder="https://gitlab.example.com/group/project"
            />
          </UFormField>

          <UFormField
            label="说明"
            class="md:col-span-2"
          >
            <UTextarea
              v-model="projectForm.description"
              class="w-full"
              :rows="3"
              placeholder="项目注册说明"
            />
          </UFormField>
        </fieldset>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="projectModalOpen = false"
        >
          取消
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-save"
          :loading="saving"
          :disabled="locked || !canEdit"
          @click="submitProject"
        >
          保存
        </UButton>
      </template>
    </DirectoryFormSurface>

    <DirectoryFormSurface
      v-if="!props.page || (props.initialMode === 'members' && !membersPending)"
      ref="membersSurface"
      v-model:open="isMembersModalOpen"
      :page="props.page"
      :draft="editableMembersText"
      :busy="saving"
      :title="`项目成员：${selectedProject?.name || ''}`"
      :ui="{ header: 'directory-editor-header', wrapper: 'directory-editor-heading', title: 'directory-editor-title', description: 'directory-editor-description', close: 'directory-editor-close', content: 'sm:max-w-4xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm text-muted">
                {{ selectedProject?.projectCode }}
              </p>
            </div>
            <UBadge color="neutral" variant="soft">
              {{ members.length }} 人
            </UBadge>
          </div>

          <UFormField label="成员">
            <UTextarea
              v-model="editableMembersText"
              :disabled="saving || locked || !canEdit || !membersReady"
              class="w-full"
              :rows="5"
              placeholder="每行一个：uid 或 uid:role，role 可为 owner/admin/member/viewer"
            />
          </UFormField>

          <UAlert
            v-if="membersError"
            color="error"
            variant="soft"
            title="成员操作未完成"
            :description="membersError"
          />

          <DirectoryProjectMembersTable :items="members" :loading="membersPending" />
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="关闭"
            color="neutral"
            variant="soft"
            :disabled="saving"
            @click="isMembersModalOpen = false"
          />
          <UButton
            v-if="canEdit"
            color="primary"
            icon="i-lucide-save"
            :loading="saving"
            :disabled="locked || !canEdit || !membersReady"
            @click="saveMembers"
          >
            保存成员
          </UButton>
        </div>
      </template>
    </DirectoryFormSurface>
  </div>
</template>

<style src="./directory-editor-header.css"></style>
