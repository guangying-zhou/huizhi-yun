<script setup lang="ts">
interface RequirementBrief {
  id: number
  reqCode: string
  title: string
  priority: string
  milestoneId: number | null
  milestoneName: string | null
  type?: 'functional' | 'non_functional'
}

interface MilestoneOption {
  id: number
  name: string
  pivrStage: string | null
}

interface UserOption {
  uid: string
  realName?: string
}

interface DeliverableForm {
  name: string
  deliverableType: 'document' | 'code' | 'artifact' | 'task'
  description: string
  acceptanceCriteria: string
  required: boolean
}

interface RequirementContentItem {
  id: number
  sourceParentId?: number | null
  title: string
  headingDepth: number
  sortOrder: number
  status: string
  contentMd: string | null
}

interface RequirementContextModule {
  id: number
  title: string
  headingDepth: number
  sortOrder: number
  contentMd: string | null
}

interface RequirementDetailResponse {
  type: 'functional' | 'non_functional'
  scopeNote: string | null
  contents: RequirementContentItem[]
  contextModules?: RequirementContextModule[]
}

const props = defineProps<{
  requirement: RequirementBrief
  projectId: number
  milestones: MilestoneOption[]
  users: UserOption[]
}>()

const emit = defineEmits<{
  close: []
  created: [taskId: number, itemKey: string]
}>()

const toast = useToast()
const submitting = ref(false)
const loadingContent = ref(false)
const reqType = ref<'functional' | 'non_functional'>(props.requirement.type || 'functional')

const form = reactive({
  title: props.requirement.title,
  description: '',
  milestoneId: props.requirement.milestoneId,
  assigneeUid: '',
  priority: props.requirement.priority || 'P1',
  estimatedHours: null as number | null,
  startDate: '',
  dueDate: '',
  reviewLevel: 1
})

const deliverables = ref<DeliverableForm[]>([])

function buildDefaultDeliverables(type: 'functional' | 'non_functional'): DeliverableForm[] {
  if (type === 'functional') {
    return [{
      name: '代码',
      deliverableType: 'code',
      description: '实现该需求并提交代码',
      acceptanceCriteria: '代码满足需求要求，并通过单元测试',
      required: true
    }]
  }
  return []
}

function inferRequirementHeadingLevel(title: string): number | null {
  const normalizedTitle = title.trim()
  const match = normalizedTitle.match(/^(\d+(?:\.\d+)+)\b/)
  if (!match || !match[1]) return null

  const segments = match[1].split('.').length
  return Math.min(6, Math.max(3, segments + 1))
}

function buildDescriptionFromContents(
  items: RequirementContentItem[],
  scopeNote?: string | null,
  contextModules: RequirementContextModule[] = []
): string {
  const headerLines = [
    '## 需求来源',
    '',
    `- 编号：${props.requirement.reqCode}`,
    `- 标题：${props.requirement.title}`
  ]
  if (scopeNote?.trim()) {
    headerLines.push(`- 范围说明：${scopeNote.trim()}`)
  }
  const header = `${headerLines.join('\n')}\n`
  if (!items.length) return header
  const sortedModules = [...contextModules].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  const moduleMap = new Map(sortedModules.map(module => [module.id, module]))
  const moduleSections = new Map<number, RequirementContentItem[]>()
  const standaloneItems: RequirementContentItem[] = []

  for (const item of sortedItems) {
    if (item.sourceParentId && moduleMap.has(item.sourceParentId)) {
      if (!moduleSections.has(item.sourceParentId)) moduleSections.set(item.sourceParentId, [])
      moduleSections.get(item.sourceParentId)!.push(item)
    } else {
      standaloneItems.push(item)
    }
  }

  const renderItem = (item: RequirementContentItem, fallbackMinDepth: number) => {
    const inferredLevel = inferRequirementHeadingLevel(item.title)
    const relativeLevel = Math.min(6, Math.max(3, 3 + ((item.headingDepth || fallbackMinDepth) - fallbackMinDepth)))
    const hashes = '#'.repeat(inferredLevel ?? relativeLevel)
    const md = (item.contentMd || '').trim()
    return md ? `${hashes} ${item.title}\n\n${md}` : `${hashes} ${item.title}`
  }

  const bodyParts: string[] = []
  for (const module of sortedModules) {
    const itemsUnderModule = moduleSections.get(module.id) || []
    if (itemsUnderModule.length === 0) continue

    const moduleHeading = `${'#'.repeat(Math.min(6, Math.max(2, module.headingDepth || 2)))} ${module.title}`
    const moduleIntro = (module.contentMd || '').trim()
    const moduleMinDepth = Math.min(...itemsUnderModule.map(item => item.headingDepth || 1))
    const moduleBody = itemsUnderModule.map(item => renderItem(item, moduleMinDepth)).join('\n\n')
    bodyParts.push([moduleHeading, moduleIntro, moduleBody].filter(Boolean).join('\n\n'))
  }

  if (standaloneItems.length > 0) {
    const standaloneMinDepth = Math.min(...standaloneItems.map(item => item.headingDepth || 1))
    for (const item of standaloneItems) {
      bodyParts.push(renderItem(item, standaloneMinDepth))
    }
  }

  const body = bodyParts.join('\n\n')
  return `${header}\n## 需求内容\n\n${body}\n`
}

async function loadRequirementDetail() {
  loadingContent.value = true
  try {
    const res = await $fetch<{ code: number, data: RequirementDetailResponse }>(`/api/v1/requirements/${props.requirement.id}`)
    if (res.code === 0) {
      reqType.value = res.data.type
      form.description = buildDescriptionFromContents(res.data.contents, res.data.scopeNote, res.data.contextModules || [])
      deliverables.value = buildDefaultDeliverables(res.data.type)
    }
  } catch {
    // fallback: 使用 props 中的 type (若有)
    deliverables.value = buildDefaultDeliverables(reqType.value)
  } finally {
    loadingContent.value = false
  }
}

onMounted(loadRequirementDetail)

function addDeliverable() {
  deliverables.value.push({
    name: '',
    deliverableType: 'code',
    description: '',
    acceptanceCriteria: '',
    required: true
  })
}
function removeDeliverable(idx: number) {
  deliverables.value.splice(idx, 1)
}

const deliverableTypeOptions = [
  { label: '代码', value: 'code' },
  { label: '文档', value: 'document' },
  { label: '部署包/构件', value: 'artifact' },
  { label: '过程事务', value: 'task' }
]

const milestoneOptions = computed(() =>
  props.milestones.map(m => ({
    label: `${m.name}${m.pivrStage ? ` (${m.pivrStage}阶段)` : ''}`,
    value: m.id
  }))
)

const userOptions = computed(() =>
  props.users.map(u => ({
    label: u.realName || u.uid,
    value: u.uid
  }))
)

const priorityOptions = [
  { label: 'P0 紧急', value: 'P0' },
  { label: 'P1 高', value: 'P1' },
  { label: 'P2 中', value: 'P2' },
  { label: 'P3 低', value: 'P3' }
]

const reviewLevelOptions = [
  { label: '0 免评审', value: 0 },
  { label: '1 一般', value: 1 },
  { label: '2 重要', value: 2 },
  { label: '3 重大', value: 3 },
  { label: '4 关键', value: 4 }
]

const canSubmit = computed(() => {
  return form.title.trim().length > 0
    && form.milestoneId != null
    && form.assigneeUid.trim().length > 0
    && deliverables.value.every(d => d.name.trim().length > 0)
})

const validationIssues = computed(() => {
  const issues: string[] = []
  if (!form.title.trim()) issues.push('任务标题不能为空')
  if (!form.milestoneId) issues.push('请选择里程碑')
  if (!form.assigneeUid.trim()) issues.push('请指定负责人')
  if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
    issues.push('开始日期不能晚于截止日期')
  }
  if (form.estimatedHours != null && form.estimatedHours < 0) {
    issues.push('预估工时不能为负数')
  }
  if (deliverables.value.some(d => !d.name.trim())) {
    issues.push('交付物名称不能为空')
  }
  return issues
})

async function handleSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const res = await $fetch<{ code: number, data: { taskId: number, itemKey: string } }>(
      `/api/v1/requirements/${props.requirement.id}/create-task`,
      {
        method: 'POST',
        body: {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          milestoneId: form.milestoneId,
          assigneeUid: form.assigneeUid,
          priority: form.priority,
          estimatedHours: form.estimatedHours,
          startDate: form.startDate || undefined,
          dueDate: form.dueDate || undefined,
          reviewLevel: form.reviewLevel,
          deliverables: deliverables.value.map(d => ({
            name: d.name.trim(),
            deliverableType: d.deliverableType,
            description: d.description.trim() || undefined,
            acceptanceCriteria: d.acceptanceCriteria.trim() || undefined,
            required: d.required
          }))
        }
      }
    )
    if (res.code === 0) {
      toast.add({
        title: `已创建任务 ${res.data.itemKey}`,
        color: 'success'
      })
      emit('created', res.data.taskId, res.data.itemKey)
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '创建任务失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    :open="true"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-plus-square" class="size-5 text-primary" />
        <span class="font-semibold">生成任务</span>
        <UBadge
          color="primary"
          variant="subtle"
          size="xs"
          class="font-mono"
        >
          {{ requirement.reqCode }}
        </UBadge>
        <UBadge
          :color="reqType === 'functional' ? 'info' : 'warning'"
          variant="subtle"
          size="xs"
        >
          {{ reqType === 'functional' ? '功能需求' : '非功能需求' }}
        </UBadge>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Requirement reference -->
        <div class="p-3 rounded-lg bg-elevated text-sm">
          <div class="text-xs text-muted mb-1">
            基于需求
          </div>
          <div class="font-medium truncate">
            {{ requirement.title }}
          </div>
        </div>

        <UFormField label="任务标题" required>
          <UInput v-model="form.title" class="w-full" />
        </UFormField>

        <UFormField label="任务描述（已自动带入需求内容，可编辑）">
          <UTextarea
            v-model="form.description"
            :rows="10"
            :loading="loadingContent"
            placeholder="对任务的具体要求、输入输出、验收点等..."
            class="w-full font-mono text-xs"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="里程碑" required>
            <USelectMenu
              v-model="(form.milestoneId as any)"
              :items="milestoneOptions"
              value-key="value"
              label-key="label"
              placeholder="请选择..."
              class="w-full"
            />
          </UFormField>

          <UFormField label="负责人" required>
            <USelectMenu
              v-model="form.assigneeUid"
              :items="userOptions"
              value-key="value"
              label-key="label"
              placeholder="请选择..."
              searchable
              class="w-full"
            />
          </UFormField>

          <UFormField label="优先级">
            <USelect
              v-model="form.priority"
              :items="priorityOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="预估工时（小时）">
            <UInput
              v-model.number="form.estimatedHours"
              type="number"
              min="0"
              step="0.5"
              class="w-full"
            />
          </UFormField>

          <UFormField label="开始日期">
            <UInput
              v-model="form.startDate"
              type="date"
              class="w-full"
            />
          </UFormField>

          <UFormField label="截止日期">
            <UInput
              v-model="form.dueDate"
              type="date"
              class="w-full"
            />
          </UFormField>

          <UFormField label="评审级别" class="col-span-2">
            <USelect
              v-model="form.reviewLevel"
              :items="reviewLevelOptions"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Deliverables -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium">
              工作成果要求
              <span v-if="reqType === 'functional'" class="text-xs text-muted font-normal ml-1">
                （功能需求默认：代码 + 通过单元测试）
              </span>
            </div>
            <UButton
              icon="i-lucide-plus"
              label="添加成果"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="addDeliverable"
            />
          </div>

          <div v-if="deliverables.length === 0" class="text-xs text-muted p-3 rounded-lg bg-elevated">
            暂无成果要求。点击"添加成果"增加。
          </div>

          <div
            v-for="(d, idx) in deliverables"
            :key="idx"
            class="p-3 rounded-lg border border-default space-y-2"
          >
            <div class="flex items-center gap-2">
              <UInput
                v-model="d.name"
                placeholder="成果名称，如：代码"
                class="flex-1"
                size="sm"
              />
              <USelect
                v-model="d.deliverableType"
                :items="deliverableTypeOptions"
                size="sm"
                class="w-32"
              />
              <UCheckbox v-model="d.required" label="必须" />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                @click="removeDeliverable(idx)"
              />
            </div>
            <UInput
              v-model="d.description"
              placeholder="成果说明（可选）"
              size="sm"
              class="w-full"
            />
            <UTextarea
              v-model="d.acceptanceCriteria"
              :rows="2"
              placeholder="验收标准：例如『代码满足需求要求，并通过单元测试』"
              size="sm"
              class="w-full"
            />
          </div>
        </div>

        <div
          v-if="validationIssues.length > 0 && form.title.length > 0"
          class="text-xs text-warning space-y-1"
        >
          <div v-for="issue in validationIssues" :key="issue">
            · {{ issue }}
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          :disabled="submitting"
          @click="emit('close')"
        />
        <UButton
          icon="i-lucide-check"
          label="创建任务"
          color="primary"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="handleSubmit"
        />
      </div>
    </template>
  </UModal>
</template>
