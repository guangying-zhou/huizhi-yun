<script setup lang="ts">
/**
 * 目标编辑弹窗 — 用于看板「目标规划」列卡片编辑
 *
 * 编辑内容：标题/描述/里程碑/控制工时/评审级别/起止日期 + 成果要求列表
 * 支持：目标信息完备后，一键任务分配（目标 planning -> todo）并跳转 breakdown 页面
 */
import type { WorkItem } from '~/types/aims'
import {
  reviewLevelOptions,
  deliverableTypeOptions,
  deliverableTypeLabel,
  deliverableTypeIcon
} from '~/config/work-item'

interface DeliverableItem {
  id: number
  name: string
  description: string | null
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  sortOrder: number
  status: string
}

interface Milestone {
  id: number
  name: string
}

const props = defineProps<{
  open: boolean
  workItem: WorkItem | null
  milestones: Milestone[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()

const form = reactive({
  title: '',
  description: '',
  milestoneId: 0,
  estimatedHours: '',
  reviewLevel: 1,
  startDate: '',
  dueDate: ''
})

const deliverables = ref<DeliverableItem[]>([])
const loading = ref(false)
const saving = ref(false)
const assigning = ref(false)

// 新增/编辑成果要求行
const showAddDeliverable = ref(false)
const newDeliverableName = ref('')
const newDeliverableCriteria = ref('')
const newDeliverableDescription = ref('')
const newDeliverableType = ref('document')
const addingDeliverable = ref(false)

// 行内编辑
const editingDeliverableId = ref<number | null>(null)
const editDeliverableForm = reactive({
  name: '',
  description: '',
  acceptanceCriteria: '',
  deliverableType: 'document'
})

async function loadDeliverables(workItemId: number) {
  try {
    const res = await $fetch<{ code: number, data: DeliverableItem[] }>(
      '/api/v1/deliverables',
      { params: { entity_type: 'work_item', entity_id: workItemId } }
    )
    if (res.code === 0) {
      deliverables.value = res.data
    }
  } catch {
    deliverables.value = []
  }
}

async function openModal(item: WorkItem) {
  form.title = item.title || ''
  form.description = item.description || ''
  form.milestoneId = item.milestoneId || 0
  form.estimatedHours = item.estimatedHours ? String(item.estimatedHours) : ''
  form.reviewLevel = (item as WorkItem & { reviewLevel?: number }).reviewLevel ?? 1
  form.startDate = item.startDate || ''
  form.dueDate = item.dueDate || ''
  loading.value = true
  try {
    await loadDeliverables(item.id)
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.workItem?.id] as const,
  async ([open, id]) => {
    if (open && props.workItem && id) {
      await openModal(props.workItem)
    } else if (!open) {
      // 重置
      showAddDeliverable.value = false
      editingDeliverableId.value = null
      newDeliverableName.value = ''
      newDeliverableCriteria.value = ''
      newDeliverableDescription.value = ''
      newDeliverableType.value = 'document'
    }
  },
  { immediate: true }
)

function startEdit(d: DeliverableItem) {
  editingDeliverableId.value = d.id
  editDeliverableForm.name = d.name
  editDeliverableForm.description = d.description || ''
  editDeliverableForm.acceptanceCriteria = d.acceptanceCriteria || ''
  editDeliverableForm.deliverableType = d.deliverableType
}

function cancelEdit() {
  editingDeliverableId.value = null
}

async function saveEditDeliverable(id: number) {
  if (!editDeliverableForm.name.trim()) {
    toast.add({ title: '成果名称不能为空', color: 'warning' })
    return
  }
  try {
    await $fetch(`/api/v1/deliverables/${id}`, {
      method: 'PUT',
      body: {
        name: editDeliverableForm.name.trim(),
        description: editDeliverableForm.description.trim() || null,
        acceptanceCriteria: editDeliverableForm.acceptanceCriteria.trim() || null,
        deliverableType: editDeliverableForm.deliverableType
      }
    })
    editingDeliverableId.value = null
    if (props.workItem) await loadDeliverables(props.workItem.id)
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error' })
  }
}

async function addDeliverable() {
  if (!props.workItem) return
  if (!newDeliverableName.value.trim()) return
  addingDeliverable.value = true
  try {
    await $fetch('/api/v1/deliverables/batch', {
      method: 'POST',
      body: {
        items: [{
          entityType: 'work_item',
          entityId: props.workItem.id,
          name: newDeliverableName.value.trim(),
          description: newDeliverableDescription.value.trim() || null,
          acceptanceCriteria: newDeliverableCriteria.value.trim() || null,
          deliverableType: newDeliverableType.value,
          required: true,
          projectId: props.workItem.projectId
        }]
      }
    })
    newDeliverableName.value = ''
    newDeliverableCriteria.value = ''
    newDeliverableDescription.value = ''
    newDeliverableType.value = 'document'
    showAddDeliverable.value = false
    await loadDeliverables(props.workItem.id)
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '添加失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    addingDeliverable.value = false
  }
}

async function removeDeliverable(d: DeliverableItem) {
  if (!confirm(`确定删除成果要求「${d.name}」？`)) return
  try {
    await $fetch(`/api/v1/deliverables/${d.id}`, { method: 'DELETE' })
    if (props.workItem) await loadDeliverables(props.workItem.id)
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '删除失败'
    toast.add({ title: msg, color: 'error' })
  }
}

const formErrors = computed(() => {
  const errors: Record<string, string> = {}
  if (!form.title.trim()) errors.title = '请输入标题'
  if (!form.milestoneId) errors.milestone = '请选择里程碑'
  if (!form.estimatedHours) errors.hours = '请填写控制工时'
  if (!form.startDate) errors.startDate = '请选择开始日期'
  if (!form.dueDate) errors.dueDate = '请选择结束日期'
  if (form.startDate && form.dueDate && new Date(form.startDate) > new Date(form.dueDate)) {
    errors.dueDate = '结束日期不能早于开始日期'
  }
  return errors
})

const assignmentIssues = computed(() => {
  const issues: string[] = []
  if (!form.title.trim()) issues.push('缺少标题')
  if (!form.milestoneId) issues.push('缺少里程碑')
  if (!form.estimatedHours || Number(form.estimatedHours) <= 0) issues.push('缺少控制工时')
  if (!form.startDate) issues.push('缺少开始日期')
  if (!form.dueDate) issues.push('缺少结束日期')
  if (form.startDate && form.dueDate && new Date(form.startDate) > new Date(form.dueDate)) {
    issues.push('起止日期不合法')
  }
  if (deliverables.value.length === 0) issues.push('至少需要 1 条成果要求')
  return issues
})

const canAssign = computed(() =>
  !!props.workItem
  && props.workItem.status === 'planning'
  && !loading.value
  && assignmentIssues.value.length === 0
)

function buildUpdatePayload() {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    milestoneId: form.milestoneId,
    estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
    reviewLevel: form.reviewLevel,
    startDate: form.startDate || null,
    dueDate: form.dueDate || null
  }
}

async function handleSave() {
  if (Object.keys(formErrors.value).length > 0) {
    toast.add({ title: '请完善必填项', color: 'warning' })
    return
  }
  if (!props.workItem) return
  saving.value = true
  try {
    await $fetch(`/api/v1/work-items/${props.workItem.id}`, {
      method: 'PUT',
      body: buildUpdatePayload()
    })
    toast.add({ title: '已保存', color: 'success', icon: 'i-lucide-check' })
    emit('saved')
    emit('update:open', false)
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function handleAssign() {
  if (!props.workItem || assigning.value) return
  if (assignmentIssues.value.length > 0) {
    toast.add({
      title: '目标信息不完整',
      description: assignmentIssues.value.join('；'),
      color: 'warning'
    })
    return
  }

  assigning.value = true
  try {
    await $fetch(`/api/v1/work-items/${props.workItem.id}`, {
      method: 'PUT',
      body: {
        ...buildUpdatePayload(),
        status: 'todo'
      }
    })
    toast.add({ title: '任务分配已开始', color: 'success', icon: 'i-lucide-list-checks' })
    emit('saved')
    emit('update:open', false)
    await navigateTo(`/projects/${props.workItem.projectId}/work-items/${props.workItem.id}/breakdown`)
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '任务分配失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    assigning.value = false
  }
}

const milestoneItems = computed(() =>
  props.milestones.map(m => ({ label: m.name, value: m.id }))
)
</script>

<template>
  <UModal
    :open="open"
    :ui="{ content: 'sm:max-w-4xl' }"
    @update:open="$emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-target" class="size-5 text-primary" />
        <h3 class="text-lg font-semibold">
          编辑目标 · {{ workItem?.itemKey }}
        </h3>
      </div>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <!-- 基本信息 -->
        <div class="grid gap-4 md:grid-cols-6">
          <UFormField
            class="md:col-span-4"
            label="标题"
            required
            :error="formErrors.title"
          >
            <UInput v-model="form.title" placeholder="目标标题" class="w-full" />
          </UFormField>
          <UFormField
            class="md:col-span-2"
            label="里程碑"
            required
            :error="formErrors.milestone"
          >
            <USelect
              v-model="form.milestoneId"
              :items="milestoneItems"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="描述">
          <UTextarea
            v-model="form.description"
            :rows="3"
            placeholder="说明目标的背景、范围边界、关键输入和交付约束"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-4">
          <UFormField label="控制工时" required :error="formErrors.hours">
            <UInput
              v-model="form.estimatedHours"
              type="number"
              min="0"
              step="0.5"
              placeholder="如 16"
              class="w-full"
            />
          </UFormField>
          <UFormField label="评审级别">
            <USelect
              v-model="form.reviewLevel"
              :items="reviewLevelOptions"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField label="开始日期" required :error="formErrors.startDate">
            <UInput v-model="form.startDate" type="date" class="w-full" />
          </UFormField>
          <UFormField label="结束日期" required :error="formErrors.dueDate">
            <UInput v-model="form.dueDate" type="date" class="w-full" />
          </UFormField>
        </div>

        <!-- 成果要求 -->
        <div class="rounded-lg border border-default p-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-clipboard-check" class="size-4 text-primary" />
              <span class="text-sm font-medium">成果要求</span>
              <span class="text-xs text-muted">{{ deliverables.length }} 条</span>
            </div>
            <UButton
              v-if="!showAddDeliverable"
              size="xs"
              variant="ghost"
              color="primary"
              icon="i-lucide-plus"
              label="添加"
              @click="showAddDeliverable = true"
            />
          </div>

          <!-- 新增表单 -->
          <div
            v-if="showAddDeliverable"
            class="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2"
          >
            <div class="grid gap-2 md:grid-cols-8">
              <USelect
                v-model="newDeliverableType"
                :items="deliverableTypeOptions"
                value-key="value"
                label-key="label"
                class="md:col-span-2"
              />
              <UInput
                v-model="newDeliverableName"
                placeholder="成果名称（必填）"
                class="md:col-span-6"
              />
            </div>
            <UTextarea
              v-model="newDeliverableDescription"
              placeholder="成果说明（选填）"
              :rows="2"
              class="w-full"
            />
            <UInput
              v-model="newDeliverableCriteria"
              placeholder="验收标准（建议填写）"
              class="w-full"
            />
            <div class="flex items-center justify-end gap-2">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                label="取消"
                @click="showAddDeliverable = false; newDeliverableName = ''; newDeliverableCriteria = ''; newDeliverableDescription = ''; newDeliverableType = 'document'"
              />
              <UButton
                size="xs"
                color="primary"
                label="确认添加"
                :loading="addingDeliverable"
                :disabled="!newDeliverableName.trim()"
                @click="addDeliverable"
              />
            </div>
          </div>

          <div v-if="deliverables.length === 0 && !showAddDeliverable" class="text-center text-sm text-muted py-4">
            暂未配置成果要求，建议至少添加一条
          </div>

          <div
            v-for="d in deliverables"
            :key="d.id"
            class="rounded-md border border-default p-3"
          >
            <div v-if="editingDeliverableId !== d.id">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <UIcon
                    :name="deliverableTypeIcon[d.deliverableType] || 'i-lucide-pocket-knife'"
                    class="size-4 text-muted shrink-0"
                  />
                  <span class="font-medium text-sm truncate">{{ d.name }}</span>
                  <UBadge variant="subtle" color="neutral" size="xs">
                    {{ deliverableTypeLabel[d.deliverableType] || d.deliverableType }}
                  </UBadge>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    icon="i-lucide-pencil"
                    @click="startEdit(d)"
                  />
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-trash-2"
                    :disabled="d.status !== 'pending'"
                    @click="removeDeliverable(d)"
                  />
                </div>
              </div>
              <div v-if="d.description" class="ml-6 mt-1 text-xs text-muted whitespace-pre-wrap">
                {{ d.description }}
              </div>
              <div v-if="d.acceptanceCriteria" class="ml-6 mt-1 text-xs text-muted">
                验收标准：{{ d.acceptanceCriteria }}
              </div>
            </div>
            <!-- 行内编辑 -->
            <div v-else class="space-y-2">
              <div class="grid gap-2 md:grid-cols-8">
                <USelect
                  v-model="editDeliverableForm.deliverableType"
                  :items="deliverableTypeOptions"
                  value-key="value"
                  label-key="label"
                  class="md:col-span-2"
                />
                <UInput
                  v-model="editDeliverableForm.name"
                  placeholder="成果名称"
                  class="md:col-span-6"
                />
              </div>
              <UTextarea
                v-model="editDeliverableForm.description"
                placeholder="成果说明"
                :rows="2"
                class="w-full"
              />
              <UInput
                v-model="editDeliverableForm.acceptanceCriteria"
                placeholder="验收标准"
                class="w-full"
              />
              <div class="flex items-center justify-end gap-2">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  label="取消"
                  @click="cancelEdit"
                />
                <UButton
                  size="xs"
                  color="primary"
                  label="保存"
                  @click="saveEditDeliverable(d.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          v-if="canAssign"
          label="任务分配"
          color="info"
          variant="soft"
          icon="i-lucide-list-checks"
          :loading="assigning"
          :disabled="saving"
          @click="handleAssign"
        />
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
        <UButton
          label="保存"
          color="primary"
          :loading="saving"
          @click="handleSave"
        />
      </div>
    </template>
  </UModal>
</template>
