<script setup lang="ts">
import DirectoryFormSurface from './DirectoryFormSurface.vue'
import type { ConsoleDirectoryDepartment as DirectoryDepartment } from '../types/consoleDirectory'
import { createConsoleMutationIntent, type ConsoleMutationRequest } from '../../shared/utils/consoleMutationIntent'

const props = defineProps<{ page?: boolean, initialDepartment?: DirectoryDepartment | null, apiPath: string, departments: DirectoryDepartment[], canEdit: boolean, refresh: () => Promise<unknown> }>()
const emit = defineEmits<{ denied: [status: number], closed: [] }>()
interface DepartmentPayload { deptCode: string, name: string, parentDeptCode: string | null, managerId: string | null, leaderId: string | null, orgType: string, deptCategory: string | null, description: string | null, sortOrder: number }
const surface = ref<InstanceType<typeof DirectoryFormSurface> | null>(null)
const toast = useToast()
const { confirm } = useConfirm()
const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const saving = ref(false)
const noSelectionValue = '__none__'
const initialEditPayload = ref<DepartmentPayload | null>(null)

const form = reactive({
  deptCode: '',
  name: '',
  parentDeptCode: noSelectionValue,
  managerId: '',
  leaderId: '',
  orgType: 'department',
  deptCategory: noSelectionValue,
  description: '',
  sortOrder: 100
})

const orgTypeOptions = [
  { label: '部门', value: 'department' },
  { label: '委员会', value: 'committee' },
  { label: '虚拟组织', value: 'virtual' }
]
const deptCategoryOptions = [
  { label: '未分类', value: noSelectionValue },
  { label: '行政', value: '1' },
  { label: '业务支撑', value: '2' },
  { label: '业务', value: '3' },
  { label: '核心管理', value: '4' }
]
const parentOptions = computed(() => [
  { label: '无父级', value: noSelectionValue },
  ...props.departments
    .filter(dept => modalMode.value === 'create' || dept.deptCode !== form.deptCode)
    .map(dept => ({
      label: `${'  '.repeat(Math.max(0, dept.level - 1))}${dept.name}`,
      value: dept.deptCode
    }))
])

function resetForm() {
  form.deptCode = ''
  form.name = ''
  form.parentDeptCode = noSelectionValue
  form.managerId = ''
  form.leaderId = ''
  form.orgType = 'department'
  form.deptCategory = noSelectionValue
  form.description = ''
  form.sortOrder = 100
  initialEditPayload.value = null
}

function openCreateDepartment() {
  if (!allowed()) return
  mutation.reset()
  resetForm()
  modalMode.value = 'create'
  modalOpen.value = true
}

function openEditDepartment(dept: DirectoryDepartment) {
  if (!allowed()) return
  mutation.reset()
  resetForm()
  modalMode.value = 'edit'
  form.deptCode = dept.deptCode
  form.name = dept.name
  form.parentDeptCode = dept.parentId || noSelectionValue
  form.managerId = dept.managerId || ''
  form.leaderId = dept.leaderId || ''
  form.orgType = dept.orgType || 'department'
  form.deptCategory = dept.deptCategory || noSelectionValue
  form.description = dept.description || ''
  form.sortOrder = dept.sortOrder ?? 100
  initialEditPayload.value = departmentPayload()
  modalOpen.value = true
}

function departmentPayload(): DepartmentPayload {
  return {
    deptCode: form.deptCode.trim(),
    name: form.name.trim(),
    parentDeptCode: form.parentDeptCode === noSelectionValue ? null : form.parentDeptCode,
    managerId: form.managerId.trim() || null,
    leaderId: form.leaderId.trim() || null,
    orgType: form.orgType,
    deptCategory: form.orgType === 'department' && form.deptCategory !== noSelectionValue
      ? form.deptCategory
      : null,
    description: form.description.trim() || null,
    sortOrder: form.sortOrder
  }
}

function departmentChanges(): Partial<DepartmentPayload> {
  const current = departmentPayload()
  const initial = initialEditPayload.value
  if (!initial) return current

  return Object.fromEntries(
    (Object.keys(current) as Array<keyof DepartmentPayload>)
      .filter(key => key !== 'deptCode' && current[key] !== initial[key])
      .map(key => [key, current[key]])
  ) as Partial<DepartmentPayload>
}

const mutation = createConsoleMutationIntent('directory:department')
const locked = ref(false)
const lastSuccess = ref<(() => void) | null>(null)
function allowed() {
  if (!props.canEdit || saving.value) return false
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
    const completed = await mutation.submit(request, (input, key) => $fetch<unknown, string>(input.path, { method: input.method, headers: { 'Idempotency-Key': key }, body: input.body }))
    if (!completed) return
    locked.value = false
    success()
    toast.add({ title: request.method === 'DELETE' ? '部门已删除' : '部门已保存', color: 'success' })
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
async function submitDepartment() {
  if (!props.canEdit || saving.value) return
  if (!form.deptCode.trim() || !form.name.trim()) {
    toast.add({ title: '部门编码和名称不能为空', color: 'warning' })
    return
  }
  const payload = modalMode.value === 'create' ? departmentPayload() : departmentChanges()
  if (modalMode.value === 'edit' && !Object.keys(payload).length) {
    surface.value?.markSaved()
    modalOpen.value = false
    return
  }
  await run({ method: modalMode.value === 'create' ? 'POST' : 'PATCH', path: modalMode.value === 'create' ? props.apiPath : `${props.apiPath}/${encodeURIComponent(form.deptCode)}`, body: payload }, () => {
    surface.value?.markSaved()
    modalOpen.value = false
  })
}
async function deleteDepartment(dept: DirectoryDepartment) {
  if (!allowed()) return
  if (!(await confirm({ title: '删除部门', message: `确认删除部门「${dept.name}」？删除后不可恢复。`, tone: 'danger' }))) return
  await run({ method: 'DELETE', path: `${props.apiPath}/${encodeURIComponent(dept.deptCode)}` }, () => {})
}
async function retry() {
  if (mutation.pending && lastSuccess.value) await run(mutation.pending, lastSuccess.value)
}
watch(modalOpen, (open, previous) => {
  if (props.page && previous && !open) emit('closed')
})
if (props.page) {
  if (props.initialDepartment) openEditDepartment(props.initialDepartment)
  else openCreateDepartment()
}
</script>

<template>
  <div>
    <slot
      :create="openCreateDepartment"
      :edit="openEditDepartment"
      :remove="deleteDepartment"
      :saving="saving"
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
      ref="surface"
      v-model:open="modalOpen"
      :page="props.page"
      :draft="JSON.stringify(form)"
      :busy="saving"
      :title="modalMode === 'create' ? '新建目录部门' : '编辑目录部门'"
      :ui="{ header: 'directory-editor-header', wrapper: 'directory-editor-heading', title: 'directory-editor-title', description: 'directory-editor-description', close: 'directory-editor-close', content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <fieldset :disabled="saving || locked || !canEdit" class="grid gap-4 md:grid-cols-2">
          <UFormField label="部门编码" required>
            <UInput
              v-model="form.deptCode"
              class="w-full"
              :disabled="modalMode === 'edit' || saving || locked"
              placeholder="例如：RD"
            />
          </UFormField>

          <UFormField label="部门名称" required>
            <UInput
              v-model="form.name"
              class="w-full"
              placeholder="例如：研发部"
            />
          </UFormField>

          <UFormField label="父级部门">
            <USelect
              v-model="form.parentDeptCode"
              class="w-full"
              :items="parentOptions"
            />
          </UFormField>

          <UFormField label="组织类型">
            <USelect
              v-model="form.orgType"
              class="w-full"
              :items="orgTypeOptions"
            />
          </UFormField>

          <UFormField label="负责人 UID">
            <UInput
              v-model="form.managerId"
              class="w-full"
              placeholder="留空表示未设置"
            />
          </UFormField>

          <UFormField label="Leader UID">
            <UInput
              v-model="form.leaderId"
              class="w-full"
              placeholder="留空表示未设置"
            />
          </UFormField>

          <UFormField
            v-if="form.orgType === 'department'"
            label="部门类别"
          >
            <USelect
              v-model="form.deptCategory"
              class="w-full"
              :items="deptCategoryOptions"
            />
          </UFormField>

          <UFormField label="排序">
            <UInput
              v-model.number="form.sortOrder"
              class="w-full"
              type="number"
            />
          </UFormField>

          <UFormField
            label="说明"
            class="md:col-span-2"
          >
            <UTextarea
              v-model="form.description"
              class="w-full"
              :rows="3"
              placeholder="部门说明"
            />
          </UFormField>
        </fieldset>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="modalOpen = false"
        >
          取消
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-save"
          :loading="saving"
          :disabled="!canEdit"
          @click="submitDepartment"
        >
          保存
        </UButton>
      </template>
    </DirectoryFormSurface>
  </div>
</template>

<style src="./directory-editor-header.css"></style>
