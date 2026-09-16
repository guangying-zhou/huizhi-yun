<script setup lang="ts">
import type { Department } from '@hzy/foundation/app/types/account'
import type { CreateWorkItemRequest, RoutineScope } from '~/types/aims'

const props = defineProps<{
  open: boolean
  projectId: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [itemId: number]
}>()

const projectStore = useProjectStore()
const workItemStore = useWorkItemStore()
const toast = useToast()
const { user: currentUserUid } = useAuth()
const { users: accountUsers } = useAccountUsers()
const { accessibleDepartments } = useAccessibleDepartments()

const creating = ref(false)
const touched = ref(false)
const pendingDocIds = ref<string[]>([])
const newDocId = ref('')
const form = ref<CreateWorkItemRequest>(createEmptyForm())

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const routineDepartmentTree = computed<Department[]>(() => accessibleDepartments.value)

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    if (user.realName?.trim()) map.set(user.uid, user.realName.trim())
  }
  return map
})

const memberOptions = computed(() => {
  return (projectStore.currentProject?.members || [])
    .filter(member => member.status !== 'suspended')
    .map((member) => {
      const name = member.realName?.trim() || userNameMap.value.get(member.uid)
      return {
        label: name ? `${name}(${member.uid})` : member.uid,
        value: member.uid
      }
    })
})

const errors = computed(() => {
  if (!touched.value) return {} as Record<string, string>
  const nextErrors: Record<string, string> = {}
  if (!form.value.title.trim()) nextErrors.title = '请输入标题'
  if (!form.value.dueDate) nextErrors.dueDate = '请选择截止日期'
  if (form.value.routineScope === 'cross_dept' && !form.value.beneficiaryDeptCode) {
    nextErrors.beneficiaryDeptCode = '请选择受益部门'
  }
  return nextErrors
})

function createEmptyForm(): CreateWorkItemRequest {
  const memberUids = new Set(
    (projectStore.currentProject?.members || [])
      .filter(member => member.status !== 'suspended')
      .map(member => member.uid)
  )
  const defaultAssignee = currentUserUid.value && memberUids.has(currentUserUid.value)
    ? currentUserUid.value
    : null

  return {
    type: 'task',
    tier: 'matter',
    title: '',
    milestoneId: null,
    description: '',
    priority: 'P2',
    severity: null,
    assigneeUid: defaultAssignee,
    dueDate: '',
    routineScope: 'department',
    beneficiaryDeptCode: null,
    isUnplanned: false
  }
}

function resetForm() {
  form.value = createEmptyForm()
  touched.value = false
  pendingDocIds.value = []
  newDocId.value = ''
}

function updateRoutineScope(value: unknown) {
  form.value.routineScope = value as RoutineScope
  if (form.value.routineScope === 'department') {
    form.value.beneficiaryDeptCode = null
  }
}

function updateAssignee(value: unknown) {
  form.value.assigneeUid = typeof value === 'string' && value ? value : null
}

function addPendingDoc() {
  const id = newDocId.value.trim()
  if (!id || pendingDocIds.value.includes(id)) return
  pendingDocIds.value.push(id)
  newDocId.value = ''
}

function removePendingDoc(id: string) {
  pendingDocIds.value = pendingDocIds.value.filter(docId => docId !== id)
}

async function createRoutineTask() {
  if (newDocId.value.trim()) addPendingDoc()
  touched.value = true
  if (Object.keys(errors.value).length > 0) return

  creating.value = true
  try {
    const item = await workItemStore.createItem(props.projectId, {
      ...form.value,
      type: 'task',
      tier: 'matter',
      milestoneId: null,
      beneficiaryDeptCode: form.value.routineScope === 'cross_dept'
        ? form.value.beneficiaryDeptCode
        : null
    })

    let failedDocuments = 0
    for (const documentId of pendingDocIds.value) {
      try {
        await $fetch(`/api/v1/work-items/${item.id}/documents`, {
          method: 'POST',
          body: { documentId }
        })
      } catch {
        failedDocuments++
      }
    }

    toast.add({
      title: '事务已创建',
      description: failedDocuments > 0 ? `${failedDocuments} 个文档未能关联，请稍后重试` : undefined,
      color: failedDocuments > 0 ? 'warning' : 'success'
    })
    emit('update:open', false)
    emit('created', item.id)
    resetForm()
  } catch (error: unknown) {
    const candidate = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: '创建事务失败',
      description: candidate.data?.message || candidate.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) resetForm()
})
</script>

<template>
  <UModal v-model:open="modalOpen" :ui="{ content: 'sm:max-w-2xl' }">
    <template #header>
      <div>
        <h3 class="text-lg font-semibold">
          新建日常事务
        </h3>
        <p class="mt-1 text-xs text-muted">
          创建后直接进入任务看板，无需选择工作项类型或里程碑。
        </p>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <div class="rounded-lg border border-default bg-elevated/30 p-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="事务归属" required>
              <URadioGroup
                :model-value="form.routineScope ?? undefined"
                :items="[
                  { label: '部门事务', value: 'department' },
                  { label: '跨部门协助', value: 'cross_dept' }
                ]"
                orientation="horizontal"
                @update:model-value="updateRoutineScope"
              />
            </UFormField>
            <UFormField label="计划属性">
              <UCheckbox v-model="form.isUnplanned" label="计划外事务" />
            </UFormField>
          </div>

          <UFormField
            v-if="form.routineScope === 'cross_dept'"
            label="受益部门"
            required
            :error="errors.beneficiaryDeptCode"
            class="mt-4"
          >
            <div class="max-h-52 overflow-y-auto rounded-lg border border-default bg-default p-2">
              <DeptTreeSelector
                v-for="department in routineDepartmentTree"
                :key="department.deptCode"
                :node="department"
                :selected-dept-code="form.beneficiaryDeptCode || ''"
                @select="form.beneficiaryDeptCode = $event"
              />
            </div>
          </UFormField>
        </div>

        <UFormField label="标题" required :error="errors.title">
          <UInput
            v-model="form.title"
            placeholder="输入事务标题"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField label="描述">
          <UTextarea
            v-model="form.description!"
            placeholder="输入事务描述"
            class="w-full"
            :rows="3"
          />
        </UFormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="优先级">
            <URadioGroup
              v-model="(form.priority as string)"
              :items="[
                { label: 'P0 紧急', value: 'P0' },
                { label: 'P1 高', value: 'P1' },
                { label: 'P2 中', value: 'P2' },
                { label: 'P3 低', value: 'P3' }
              ]"
              orientation="horizontal"
              size="sm"
            />
          </UFormField>
          <UFormField label="截止日期" required :error="errors.dueDate">
            <UInput
              v-model="form.dueDate!"
              type="date"
              class="w-full"
              required
            />
          </UFormField>
          <UFormField label="负责人">
            <USelectMenu
              :model-value="form.assigneeUid ?? undefined"
              :items="memberOptions"
              value-key="value"
              label-key="label"
              placeholder="选择成员"
              class="w-full"
              searchable
              @update:model-value="updateAssignee"
            />
          </UFormField>
        </div>

        <UFormField label="关联文档">
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <UInput
                v-model="newDocId"
                placeholder="粘贴 Codocs 文档 UUID，回车添加"
                class="flex-1"
                @keydown.enter.prevent="addPendingDoc"
                @paste="nextTick(() => addPendingDoc())"
              />
              <UButton
                label="添加"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="!newDocId.trim()"
                @click="addPendingDoc"
              />
            </div>
            <div v-if="pendingDocIds.length" class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="documentId in pendingDocIds"
                :key="documentId"
                color="info"
                variant="subtle"
                size="sm"
                class="font-mono"
              >
                {{ documentId.slice(0, 8) }}...
                <button class="ml-1 hover:text-error" @click="removePendingDoc(documentId)">
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </UBadge>
            </div>
          </div>
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="modalOpen = false"
        />
        <UButton
          label="创建事务"
          color="primary"
          :loading="creating"
          @click="createRoutineTask"
        />
      </div>
    </template>
  </UModal>
</template>
