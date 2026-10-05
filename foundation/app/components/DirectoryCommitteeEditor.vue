<script setup lang="ts">
import type { ConsoleCommitteeMemberRole as CommitteeMemberRole, ConsoleDirectoryCommittee as DirectoryCommittee, ConsoleDirectoryCommitteeMember as DirectoryCommitteeMember } from '../types/consoleDirectory'
import { createConsoleMutationIntent, type ConsoleMutationRequest } from '../../shared/utils/consoleMutationIntent'

interface SelectedUser { uid: string, realName: string, deptCode?: string | null, deptName?: string | null, avatar?: string | null }
interface ApiResponse<T> { code: number, data: T }
interface CommitteeMemberListResponse { items: DirectoryCommitteeMember[], total: number, page: number, pageSize: number }
const props = defineProps<{ apiPath: string, committees: DirectoryCommittee[], departments: Array<{ deptCode: string, name: string, level: number, orgType: string }>, canEdit: boolean, refresh: () => Promise<unknown> }>()
const emit = defineEmits<{ denied: [status: number] }>()
const toast = useToast()
const { confirm } = useConfirm()
const saving = ref(false)
const locked = ref(false)
const initialPayload = ref<ReturnType<typeof committeePayload> | null>(null)
const mutation = createConsoleMutationIntent('directory:committee')
const lastSuccess = ref<(() => void) | null>(null)
const lastMemberWrite = ref(false)
const memberReadFailed = ref(false)
const roleRevision = ref(0)
const refreshing = ref(false)
const formStatusOptions = [{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]
const roleOptions: Array<{ label: string, value: CommitteeMemberRole }> = [
  { label: '主任', value: 'leader' },
  { label: '秘书', value: 'manager' },
  { label: '委员', value: 'member' },
  { label: '观察员', value: 'observer' }
]
const roleFilterOptions = [
  { label: '全部角色', value: 'all' },
  ...roleOptions
]
const noParentDepartmentValue = '__none__'
const parentDepartmentOptions = computed(() => {
  const options = [
    { label: '不归属具体部门', value: noParentDepartmentValue },
    ...(props.departments)
      .filter(department => department.orgType === 'department')
      .map(department => ({
        label: `${'  '.repeat(Math.max(0, department.level - 1))}${department.name}`,
        value: department.deptCode
      }))
  ]
  return form.parentDeptCode !== noParentDepartmentValue && !options.some(option => option.value === form.parentDeptCode) ? [...options, { label: form.parentDeptCode, value: form.parentDeptCode }] : options
})

const committeeModalOpen = ref(false)
const committeeModalMode = ref<'create' | 'edit'>('create')
const formError = ref('')
const form = reactive({
  committeeCode: '',
  name: '',
  parentDeptCode: noParentDepartmentValue,
  description: '',
  sortOrder: 100,
  status: 'active'
})

function resetCommitteeForm() {
  form.committeeCode = ''
  form.name = ''
  form.parentDeptCode = noParentDepartmentValue
  form.description = ''
  form.sortOrder = 100
  form.status = 'active'
  formError.value = ''
}

function openCreateCommittee() {
  if (!allowed()) return
  mutation.reset()
  initialPayload.value = null
  resetCommitteeForm()
  committeeModalMode.value = 'create'
  committeeModalOpen.value = true
}

function openEditCommittee(committee: DirectoryCommittee) {
  if (!allowed() || committee.status === 'deleted') return
  mutation.reset()
  resetCommitteeForm()
  committeeModalMode.value = 'edit'
  form.committeeCode = committee.committeeCode
  form.name = committee.name
  form.parentDeptCode = committee.parentDeptCode || noParentDepartmentValue
  form.description = committee.description || ''
  form.sortOrder = committee.sortOrder
  form.status = committee.status
  initialPayload.value = committeePayload()
  committeeModalOpen.value = true
}

function committeePayload() {
  return {
    committeeCode: form.committeeCode.trim(),
    name: form.name.trim(),
    parentDeptCode: form.parentDeptCode === noParentDepartmentValue ? null : form.parentDeptCode,
    description: form.description.trim() || null,
    sortOrder: form.sortOrder,
    status: form.status
  }
}

const selectedCommittee = ref<DirectoryCommittee | null>(null)
const memberCanEdit = computed(() => props.canEdit && selectedCommittee.value?.status !== 'deleted' && !memberReadFailed.value)
const membersOpen = ref(false)
const members = ref<DirectoryCommitteeMember[]>([])
const memberTotal = ref(0)
const memberPage = ref(1)
const memberPageSize = 10
const membersPending = ref(false)
const membersError = ref('')
const memberRoleFilter = ref('all')
const memberUpdatingUid = ref('')
const newMemberUids = ref<string[]>([])
const newMemberUsers = ref<SelectedUser[]>([])
const newMemberRole = ref<CommitteeMemberRole>('member')
const {
  search: memberSearch,
  debounced: debouncedMemberSearch,
  flush: flushMemberSearch,
  reset: resetMemberSearch
} = useDebouncedSearch()

let memberRequest = 0
async function loadMembers() {
  if (!selectedCommittee.value) return false
  const request = ++memberRequest
  membersPending.value = true
  membersError.value = ''
  try {
    const response = await $fetch<ApiResponse<CommitteeMemberListResponse>>(`${props.apiPath}/${encodeURIComponent(selectedCommittee.value.committeeCode)}/members`, { query: { page: memberPage.value, pageSize: memberPageSize, search: debouncedMemberSearch.value || undefined, role: memberRoleFilter.value === 'all' ? undefined : memberRoleFilter.value } })
    if (request !== memberRequest) return false
    members.value = response.data.items
    memberTotal.value = response.data.total
    memberReadFailed.value = false
    return true
  } catch (error) {
    if (request !== memberRequest) return false
    members.value = []
    memberTotal.value = 0
    memberReadFailed.value = true
    membersError.value = '加载委员会成员失败，请重试刷新。'
    const status = errorStatus(error)
    if (status === 401 || status === 403) emit('denied', status)
    return false
  } finally { if (request === memberRequest) membersPending.value = false }
}
async function openMembers(committee: DirectoryCommittee) {
  if (saving.value || refreshing.value || locked.value) return
  mutation.reset()
  selectedCommittee.value = committee
  membersOpen.value = false
  memberPage.value = 1
  memberRoleFilter.value = 'all'
  resetMemberSearch()
  members.value = []
  memberTotal.value = 0
  newMemberUids.value = []
  newMemberUsers.value = []
  newMemberRole.value = 'member'
  membersOpen.value = true
  await loadMembers()
}
watch([debouncedMemberSearch, memberRoleFilter], () => {
  if (!membersOpen.value || saving.value || refreshing.value || locked.value) return
  if (memberPage.value !== 1) {
    memberPage.value = 1
    return
  }
  void loadMembers()
})

watch(memberPage, () => {
  if (membersOpen.value && !saving.value && !refreshing.value && !locked.value) void loadMembers()
})

function allowed() {
  return props.canEdit && !saving.value && !refreshing.value && !membersPending.value && !mutation.uncertain
}
function errorStatus(error: unknown) {
  const record = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return Number(record.statusCode || record.status || record.response?.status || 0)
}
async function refreshAfterWrite(memberWrite: boolean) {
  const results = await Promise.allSettled([props.refresh(), ...(memberWrite ? [loadMembers()] : [])])
  if (memberWrite && results[1]?.status === 'fulfilled' && results[1].value === true && !members.value.length && memberPage.value > 1) {
    memberPage.value = Math.max(1, Math.min(memberPage.value - 1, Math.ceil(memberTotal.value / memberPageSize) || 1))
    if (!(await loadMembers())) throw Error('Member refresh failed')
  }
  const current = props.committees.find(item => item.committeeCode === selectedCommittee.value?.committeeCode)
  if (current) selectedCommittee.value = current
  if (results.some(result => result.status === 'rejected' || result.value === false)) throw Error('Refresh failed')
}
async function refreshMembers() {
  if (saving.value || refreshing.value) return
  refreshing.value = true
  try {
    await refreshAfterWrite(true)
  } catch {
    toast.add({ title: '刷新失败', description: '请稍后重试。', color: 'warning' })
  } finally { refreshing.value = false }
}
async function run(request: ConsoleMutationRequest, success: () => void, memberWrite = false) {
  if (!props.canEdit || saving.value || refreshing.value) return
  saving.value = true
  lastSuccess.value = success
  lastMemberWrite.value = memberWrite
  formError.value = ''
  membersError.value = ''
  try {
    if (!(await mutation.submit(request, (input, key) => $fetch<unknown, string>(input.path, { method: input.method, headers: { 'Idempotency-Key': key }, body: input.body })))) return
    locked.value = false
    success()
    toast.add({ title: request.method === 'DELETE' ? '已移除' : '已保存', color: 'success' })
    try {
      await refreshAfterWrite(memberWrite)
    } catch {
      toast.add({ title: '已保存，刷新失败', description: '请重试刷新；无需再次提交。', color: 'warning' })
    }
  } catch (error) {
    locked.value = mutation.uncertain
    const message = mutation.uncertain ? '操作结果未确认，请重试原请求。' : '操作失败，请检查输入或权限后重试。'
    if (memberWrite) membersError.value = message
    else formError.value = message
    const status = errorStatus(error)
    if (status === 401 || status === 403) emit('denied', status)
    toast.add({ title: '操作未完成', description: message, color: 'error' })
  } finally {
    saving.value = false
    memberUpdatingUid.value = ''
    roleRevision.value++
  }
}
async function retry() {
  if (mutation.pending && lastSuccess.value) await run(mutation.pending, lastSuccess.value, lastMemberWrite.value)
}
async function submitCommittee() {
  if (!allowed()) return
  if (!form.committeeCode.trim() || !form.name.trim()) {
    formError.value = '委员会编码和名称不能为空'
    return
  }
  const current = committeePayload()
  const body = committeeModalMode.value === 'create' ? current : Object.fromEntries(Object.entries(current).filter(([key, value]) => key !== 'committeeCode' && value !== initialPayload.value?.[key as keyof typeof current]))
  if (committeeModalMode.value === 'edit' && !Object.keys(body).length) {
    committeeModalOpen.value = false
    return
  }
  await run({ method: committeeModalMode.value === 'create' ? 'POST' : 'PATCH', path: committeeModalMode.value === 'create' ? props.apiPath : `${props.apiPath}/${encodeURIComponent(current.committeeCode)}`, body }, () => {
    committeeModalOpen.value = false
  })
}
async function deleteCommittee(committee: DirectoryCommittee) {
  if (!allowed()) return
  if (!(await confirm({ title: '删除委员会', message: `确认删除委员会「${committee.name}」？请先移除全部成员；删除后不可恢复。`, tone: 'danger' }))) return
  await run({ method: 'DELETE', path: `${props.apiPath}/${encodeURIComponent(committee.committeeCode)}` }, () => {})
}
function memberPath(uid?: string) {
  return `${props.apiPath}/${encodeURIComponent(selectedCommittee.value!.committeeCode)}/members${uid ? `/${encodeURIComponent(uid)}` : ''}`
}
async function addMembers() {
  if (!allowed() || !memberCanEdit.value || !selectedCommittee.value) return
  if (!newMemberUids.value.length || newMemberUids.value.length > 100 || new Set(newMemberUids.value).size !== newMemberUids.value.length) {
    membersError.value = '请选择1至100位不同成员'
    return
  }
  if (['leader', 'manager'].includes(newMemberRole.value) && newMemberUids.value.length > 1) {
    membersError.value = '主任或秘书每次只能选择一人'
    return
  }
  await run({ method: 'POST', path: memberPath(), body: { members: newMemberUids.value.map(uid => ({ uid, role: newMemberRole.value })) } }, () => {
    newMemberUids.value = []
    newMemberUsers.value = []
    memberPage.value = 1
  }, true)
}
async function updateMemberRole(member: DirectoryCommitteeMember, role: CommitteeMemberRole) {
  if (!allowed() || !memberCanEdit.value || !selectedCommittee.value || role === member.role) return
  memberUpdatingUid.value = member.uid
  await run({ method: 'PATCH', path: memberPath(member.uid), body: { role } }, () => {}, true)
}
async function removeMember(member: DirectoryCommitteeMember) {
  if (!allowed() || !memberCanEdit.value || !selectedCommittee.value) return
  if (!(await confirm({ title: '移除委员会成员', message: `确认将「${member.displayName}」从委员会「${selectedCommittee.value.name}」移除？`, tone: 'warning' }))) return
  memberUpdatingUid.value = member.uid
  await run({ method: 'DELETE', path: memberPath(member.uid) }, () => {}, true)
}
const fields = computed(() => selectedCommittee.value
  ? [
      ['委员会编码', selectedCommittee.value.committeeCode], ['名称', selectedCommittee.value.name], ['归属部门', selectedCommittee.value.parentDeptName || selectedCommittee.value.parentDeptCode],
      ['主任', selectedCommittee.value.leaderName || selectedCommittee.value.leaderUid], ['秘书', selectedCommittee.value.managerName || selectedCommittee.value.managerUid],
      ['状态', selectedCommittee.value.status === 'active' ? '启用' : selectedCommittee.value.status === 'deleted' ? '已删除' : '停用'], ['说明', selectedCommittee.value.description]
    ]
  : [])
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <slot
      :create="openCreateCommittee"
      :edit="openEditCommittee"
      :remove="deleteCommittee"
      :members="openMembers"
      :saving="saving || refreshing || membersPending || locked"
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
    <USlideover
      v-model:open="committeeModalOpen"
      :title="committeeModalMode === 'create' ? '新建委员会' : '编辑委员会'"
      :description="committeeModalMode === 'create' ? '创建后可继续维护委员会成员与角色。' : form.committeeCode"
      :ui="{ header: 'directory-editor-header', wrapper: 'directory-editor-heading', title: 'directory-editor-title', description: 'directory-editor-description', close: 'directory-editor-close', content: 'max-w-2xl', footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <fieldset :disabled="saving || locked || !canEdit" class="grid gap-4 sm:grid-cols-2">
          <UFormField label="委员会编码" required>
            <UInput
              v-model="form.committeeCode"
              class="w-full"
              :disabled="committeeModalMode === 'edit'"
              placeholder="例如：ARCH-COMMITTEE"
            />
          </UFormField>

          <UFormField label="委员会名称" required>
            <UInput
              v-model="form.name"
              class="w-full"
              placeholder="例如：架构委员会"
            />
          </UFormField>

          <UFormField label="归属部门">
            <USelect
              v-model="form.parentDeptCode"
              class="w-full"
              :items="parentDepartmentOptions"
            />
          </UFormField>

          <UFormField label="状态">
            <USelect
              v-model="form.status"
              class="w-full"
              :items="formStatusOptions"
            />
          </UFormField>

          <UFormField label="排序">
            <UInput
              v-model.number="form.sortOrder"
              class="w-full"
              type="number"
              min="0"
            />
          </UFormField>

          <UFormField
            label="说明"
            class="sm:col-span-2"
          >
            <UTextarea
              v-model="form.description"
              class="w-full"
              :rows="3"
              placeholder="委员会职责或适用范围"
            />
          </UFormField>
        </fieldset>

        <UAlert
          v-if="formError"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="保存失败"
          :description="formError"
          class="mt-4"
        />
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="committeeModalOpen = false"
        >
          取消
        </UButton>
        <UButton
          v-if="canEdit"
          color="primary"
          icon="i-lucide-save"
          :loading="saving"
          :disabled="locked || !canEdit"
          @click="submitCommittee"
        >
          保存
        </UButton>
      </template>
    </USlideover>

    <USlideover
      v-model:open="membersOpen"
      :title="`委员会成员：${selectedCommittee?.name || ''}`"
      :description="selectedCommittee?.committeeCode || ''"
      :ui="{ header: 'directory-editor-header', wrapper: 'directory-editor-heading', title: 'directory-editor-title', description: 'directory-editor-description', close: 'directory-editor-close', content: 'sm:max-w-4xl', body: 'space-y-4' }"
    >
      <template #body>
        <dl class="space-y-3">
          <div v-for="[label, value] in fields" :key="label || ''" class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 text-sm">
            <dt class="text-muted">
              {{ label }}
            </dt><dd class="break-words">
              {{ value || '—' }}
            </dd>
          </div>
        </dl>
        <UButton
          label="刷新成员与资料"
          color="neutral"
          variant="outline"
          :loading="refreshing || membersPending"
          :disabled="saving"
          @click="refreshMembers"
        />
        <UCard v-if="memberCanEdit" variant="subtle">
          <template #header>
            <div>
              <p class="font-medium text-highlighted">
                添加成员
              </p>
              <p class="mt-1 text-sm text-muted">
                主任、秘书和委员属于委员会授权主体；观察员仅用于名册展示。
              </p>
            </div>
          </template>

          <fieldset :disabled="saving || refreshing || locked || membersPending || memberReadFailed" class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
            <UFormField label="选择用户">
              <UserTreeSelector
                v-model="newMemberUids"
                v-model:users="newMemberUsers"
                width-class="w-full"
                hide-committees
                placeholder="选择一个或多个用户"
              />
            </UFormField>
            <UFormField label="角色">
              <USelect
                v-model="newMemberRole"
                class="w-full"
                :items="roleOptions"
              />
            </UFormField>
            <UButton
              color="primary"
              icon="i-lucide-user-plus"
              :loading="saving"
              :disabled="!newMemberUids.length || saving || refreshing || locked || membersPending || memberReadFailed"
              @click="addMembers"
            >
              添加
            </UButton>
          </fieldset>
        </UCard>

        <div class="grid gap-2 sm:grid-cols-2">
          <UInput
            v-model="memberSearch"
            :disabled="saving || refreshing || locked"
            icon="i-lucide-search"
            placeholder="搜索姓名 / UID / 邮箱"
            @keyup.enter="flushMemberSearch"
          />
          <USelect
            v-model="memberRoleFilter"
            :disabled="saving || refreshing || locked"
            :items="roleFilterOptions"
          />
        </div>

        <UAlert
          v-if="membersError"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="成员操作失败"
          :description="membersError"
        />

        <div class="overflow-x-auto">
          <DirectoryCommitteeMembersTable
            :items="members"
            :loading="membersPending"
            :can-edit="memberCanEdit"
            :mutating="saving || refreshing || locked || membersPending"
            :member-updating-uid="memberUpdatingUid"
            :role-revision="roleRevision"
            empty-description="调整筛选条件，或从上方选择用户加入委员会。"
            @update-role="updateMemberRole"
            @remove="removeMember"
          />
        </div>

        <div
          v-if="memberTotal > 0"
          class="flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <span class="text-sm text-muted">共 {{ memberTotal }} 人</span>
          <UPagination
            v-model:page="memberPage"
            :disabled="saving || refreshing || locked"
            :items-per-page="memberPageSize"
            :total="memberTotal"
          />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<style src="./directory-editor-header.css"></style>
