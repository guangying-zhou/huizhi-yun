<script setup lang="ts">
import type {
  ProjectCategory,
  ProjectTemplateVersionDetail,
  ProjectTemplateVersionSummary,
  ProjectTemplateMilestoneDefinition,
  ProjectTemplateWorkItemDefinition,
  ProjectTemplateDeliverableDefinition,
  ProjectTemplateDeliverableType,
  Priority
} from '~/types/aims'
import {
  normalizeListPayload,
  normalizeProjectTemplateVersion,
  type RawProjectTemplateVersion
} from '~/utils/projectTemplateVersions'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目模板',
  layoutHeaderProjectSwitcher: false
})

const toast = useToast()

const categoryOptions = [
  { label: '产品研发', value: 'product_dev' },
  { label: '定制开发', value: 'custom_dev' },
  { label: '交付实施', value: 'delivery' },
  { label: '运维保障', value: 'maintenance' },
  { label: '销售', value: 'sales' },
  { label: '售前', value: 'presales' },
  { label: '改进', value: 'improvement' },
  { label: '合规', value: 'compliance' }
]

const pivrStageOptions = [
  { label: 'P - 规划', value: 'P' },
  { label: 'I - 实施', value: 'I' },
  { label: 'V - 验收', value: 'V' },
  { label: 'R - 交付', value: 'R' }
]

const milestoneModeOptions = [
  { label: '强约束', value: 'strong_constraint' },
  { label: '滚动计划', value: 'rolling_plan' },
  { label: '周期性', value: 'periodic' }
]

const workItemTypeOptions = [
  { label: '任务', value: 'task' },
  { label: '需求', value: 'requirement' },
  { label: '缺陷', value: 'bug' }
]

const workItemTierOptions = [
  { label: '目标层', value: 'target' },
  { label: '事务层', value: 'matter' }
]

const deliverableTypeOptions: { label: string, value: ProjectTemplateDeliverableType }[] = [
  { label: '文档', value: 'document' },
  { label: '代码', value: 'code' },
  { label: '制品', value: 'artifact' },
  { label: '事务', value: 'task' }
]

const priorityOptions: { label: string, value: Priority }[] = [
  { label: 'P0 - 紧急', value: 'P0' },
  { label: 'P1 - 高', value: 'P1' },
  { label: 'P2 - 中', value: 'P2' },
  { label: 'P3 - 低', value: 'P3' }
]

const reviewLevelOptions = [
  { label: '免评审', value: 0 },
  { label: '一般', value: 1 },
  { label: '重要', value: 2 },
  { label: '重大', value: 3 },
  { label: '关键', value: 4 }
]

// ========================
// 数据状态
// ========================
const selectedCategory = ref<ProjectCategory>('product_dev')
const versions = ref<ProjectTemplateVersionSummary[]>([])
const selectedVersionId = ref<number | null>(null)
const selectedDetail = ref<ProjectTemplateVersionDetail | null>(null)
const loading = ref(false)
const saving = ref(false)
const transitioning = ref(false)

// 编辑中的里程碑数据（深拷贝，避免直接修改原数据）
const editMilestones = ref<ProjectTemplateMilestoneDefinition[]>([])

// 展开/折叠状态
const expandedMilestones = ref<Set<string>>(new Set())
const expandedWorkItems = ref<Set<string>>(new Set())

const isDraft = computed(() => selectedDetail.value?.status === 'draft')

// ========================
// API 调用
// ========================
async function loadVersions() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: ProjectTemplateVersionSummary[] | { items?: RawProjectTemplateVersion[] } }>('/api/v1/project-template-versions', {
      params: { category: selectedCategory.value }
    })
    if (res.code === 0) {
      versions.value = normalizeListPayload<RawProjectTemplateVersion>(res.data)
        .map(normalizeProjectTemplateVersion)
      if (!versions.value.find(item => item.id === selectedVersionId.value)) {
        selectedVersionId.value = versions.value[0]?.id || null
      }
    }
  } finally {
    loading.value = false
  }
}

async function loadDetail(id: number | null) {
  selectedDetail.value = null
  editMilestones.value = []
  expandedMilestones.value = new Set()
  expandedWorkItems.value = new Set()
  if (!id) return

  const res = await $fetch<{ code: number, data: RawProjectTemplateVersion }>(`/api/v1/project-template-versions/${id}`)
  if (res.code === 0) {
    const detail = normalizeProjectTemplateVersion(res.data)
    selectedDetail.value = detail
    editMilestones.value = JSON.parse(JSON.stringify(detail.definition.milestones))
    // 默认展开第一个里程碑
    if (editMilestones.value.length > 0) {
      expandedMilestones.value.add(editMilestones.value[0]!.key)
    }
  }
}

async function createDraft(clone = false) {
  const res = await $fetch<{ code: number, data: ProjectTemplateVersionDetail }>('/api/v1/project-template-versions', {
    method: 'POST',
    body: {
      category: selectedCategory.value,
      cloneFromVersionId: clone ? selectedVersionId.value : null
    }
  })
  if (res.code === 0) {
    await loadVersions()
    selectedVersionId.value = res.data.id
    await loadDetail(res.data.id)
    toast.add({ title: clone ? '已克隆为新草稿' : '已创建新草稿', color: 'success' })
  }
}

async function saveDraft() {
  if (!selectedDetail.value) return

  saving.value = true
  try {
    const res = await $fetch<{ code: number, data: ProjectTemplateVersionDetail }>(`/api/v1/project-template-versions/${selectedDetail.value.id}`, {
      method: 'PUT',
      body: {
        versionLabel: selectedDetail.value.versionLabel,
        notes: selectedDetail.value.notes,
        definition: { milestones: editMilestones.value }
      }
    })
    if (res.code === 0) {
      selectedDetail.value = res.data
      editMilestones.value = JSON.parse(JSON.stringify(res.data.definition.milestones))
      await loadVersions()
      toast.add({ title: '草稿已保存', color: 'success' })
    }
  } finally {
    saving.value = false
  }
}

async function transitionVersion(action: 'publish' | 'archive' | 'revert_to_draft') {
  if (!selectedDetail.value) return

  transitioning.value = true
  try {
    const res = await $fetch<{ code: number, data: ProjectTemplateVersionDetail }>(`/api/v1/project-template-versions/${selectedDetail.value.id}/transition`, {
      method: 'POST',
      body: { action }
    })
    if (res.code === 0) {
      selectedDetail.value = res.data
      editMilestones.value = JSON.parse(JSON.stringify(res.data.definition.milestones))
      await loadVersions()
      const labels: Record<string, string> = { publish: '版本已发布', archive: '版本已归档', revert_to_draft: '版本已回退为草稿' }
      toast.add({ title: labels[action], color: 'success' })
    }
  } finally {
    transitioning.value = false
  }
}

// ========================
// 展开/折叠
// ========================
function toggleMilestone(key: string) {
  const next = new Set(expandedMilestones.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedMilestones.value = next
}

function toggleWorkItem(key: string) {
  const next = new Set(expandedWorkItems.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedWorkItems.value = next
}

// ========================
// 里程碑操作
// ========================
function generateKey(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`
}

function addMilestone() {
  const key = generateKey('milestone')
  const newMilestone: ProjectTemplateMilestoneDefinition = {
    key,
    name: '新里程碑',
    description: null,
    mode: 'rolling_plan',
    pivrStage: 'P',
    sortOrder: editMilestones.value.length,
    workItems: []
  }
  editMilestones.value.push(newMilestone)
  expandedMilestones.value.add(key)
}

function removeMilestone(index: number) {
  editMilestones.value.splice(index, 1)
  reindexSortOrder(editMilestones.value)
}

function moveMilestone(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= editMilestones.value.length) return
  const items = editMilestones.value
  const tmp = items[index]!
  items[index] = items[target]!
  items[target] = tmp
  reindexSortOrder(items)
}

// ========================
// 工作项操作
// ========================
function addWorkItem(milestone: ProjectTemplateMilestoneDefinition) {
  const key = generateKey('wi')
  const newItem: ProjectTemplateWorkItemDefinition = {
    key,
    title: '新工作项',
    type: 'task',
    tier: 'target',
    description: null,
    required: false,
    reviewLevel: 1,
    priority: 'P2',
    sortOrder: milestone.workItems.length,
    deliverables: []
  }
  milestone.workItems.push(newItem)
  expandedWorkItems.value.add(key)
}

function removeWorkItem(milestone: ProjectTemplateMilestoneDefinition, index: number) {
  milestone.workItems.splice(index, 1)
  reindexSortOrder(milestone.workItems)
}

function moveWorkItem(milestone: ProjectTemplateMilestoneDefinition, index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= milestone.workItems.length) return
  const items = milestone.workItems
  const tmp = items[index]!
  items[index] = items[target]!
  items[target] = tmp
  reindexSortOrder(items)
}

// ========================
// 交付物操作
// ========================
function addDeliverable(workItem: ProjectTemplateWorkItemDefinition) {
  const key = generateKey('del')
  const newDel: ProjectTemplateDeliverableDefinition = {
    key,
    name: '新交付物',
    description: null,
    acceptanceCriteria: '',
    deliverableType: 'document',
    required: true,
    sortOrder: workItem.deliverables.length
  }
  workItem.deliverables.push(newDel)
}

function removeDeliverable(workItem: ProjectTemplateWorkItemDefinition, index: number) {
  workItem.deliverables.splice(index, 1)
  reindexSortOrder(workItem.deliverables)
}

function moveDeliverable(workItem: ProjectTemplateWorkItemDefinition, index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= workItem.deliverables.length) return
  const items = workItem.deliverables
  const tmp = items[index]!
  items[index] = items[target]!
  items[target] = tmp
  reindexSortOrder(items)
}

// ========================
// 工具
// ========================
function reindexSortOrder(items: { sortOrder: number }[]) {
  items.forEach((item, i) => {
    item.sortOrder = i
  })
}

const milestoneModeLabel: Record<string, string> = { strong_constraint: '强约束', rolling_plan: '滚动计划', periodic: '周期性' }
const statusLabel: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }
const statusColor: Record<string, string> = { draft: 'warning', published: 'success', archived: 'neutral' }

// ========================
// 监听器
// ========================
watch(selectedCategory, async () => {
  selectedVersionId.value = null
  await loadVersions()
  await loadDetail(selectedVersionId.value)
}, { immediate: true })

watch(selectedVersionId, async (id) => {
  await loadDetail(id)
})
</script>

<template>
  <UDashboardPanel id="admin-project-templates" :ui="{ body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col gap-4 px-4 py-4">
        <!-- 顶部工具栏 -->
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <USelect
              v-model="selectedCategory"
              :items="categoryOptions"
              value-key="value"
              class="w-40"
            />
            <UButton
              icon="i-lucide-plus"
              label="新建草稿"
              color="primary"
              size="sm"
              @click="createDraft(false)"
            />
            <UButton
              icon="i-lucide-copy"
              label="克隆当前版本"
              color="neutral"
              variant="soft"
              size="sm"
              :disabled="!selectedVersionId"
              @click="createDraft(true)"
            />
          </div>
        </div>

        <!-- 主体：左版本列表 + 右编辑器 -->
        <div class="grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-4 overflow-hidden">
          <!-- 左：版本列表 -->
          <div class="flex min-h-0 flex-col rounded-lg border border-default">
            <div class="flex items-center justify-between border-b border-default px-3 py-2">
              <span class="text-sm font-semibold">版本列表</span>
              <span class="text-xs text-muted">{{ versions.length }} 个</span>
            </div>
            <div class="flex-1 overflow-y-auto p-2">
              <div v-if="loading" class="flex justify-center py-8">
                <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
              </div>
              <div v-else-if="versions.length === 0" class="py-8 text-center text-sm text-muted">
                暂无模板版本
              </div>
              <div v-else class="space-y-1">
                <button
                  v-for="version in versions"
                  :key="version.id"
                  type="button"
                  class="w-full rounded-lg px-3 py-2 text-left transition-colors"
                  :class="selectedVersionId === version.id ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-elevated'"
                  @click="selectedVersionId = version.id"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium truncate">{{ version.templateSetName }}</span>
                    <UBadge
                      :color="(statusColor[version.status] as any)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ statusLabel[version.status] }}
                    </UBadge>
                  </div>
                  <div class="mt-0.5 text-xs text-muted">
                    {{ version.versionLabel }} · 已使用 {{ version.usageCount }} 次
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- 右：编辑区 -->
          <div class="flex min-h-0 flex-col rounded-lg border border-default overflow-hidden">
            <!-- 编辑区头部 -->
            <div class="flex items-center justify-between border-b border-default px-4 py-2">
              <div v-if="selectedDetail">
                <div class="font-semibold text-sm">
                  {{ selectedDetail.templateSetName }} / {{ selectedDetail.versionLabel }}
                </div>
                <div class="text-xs text-muted">
                  {{ statusLabel[selectedDetail.status] }} · 使用 {{ selectedDetail.usageCount }} 次
                </div>
              </div>
              <div v-else class="text-sm font-semibold text-muted">
                请选择左侧模板版本
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  v-if="isDraft"
                  icon="i-lucide-save"
                  label="保存"
                  color="primary"
                  size="sm"
                  :loading="saving"
                  @click="saveDraft"
                />
                <UButton
                  v-if="isDraft"
                  icon="i-lucide-send"
                  label="发布"
                  color="success"
                  variant="soft"
                  size="sm"
                  :loading="transitioning"
                  @click="transitionVersion('publish')"
                />
                <UButton
                  v-if="selectedDetail?.status === 'published'"
                  icon="i-lucide-archive"
                  label="归档"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :loading="transitioning"
                  @click="transitionVersion('archive')"
                />
                <UButton
                  v-if="selectedDetail && ['published', 'archived'].includes(selectedDetail.status)"
                  icon="i-lucide-undo-2"
                  label="回退草稿"
                  color="warning"
                  variant="soft"
                  size="sm"
                  :loading="transitioning"
                  @click="transitionVersion('revert_to_draft')"
                />
              </div>
            </div>

            <!-- 编辑区内容 -->
            <div v-if="!selectedDetail" class="flex-1 flex items-center justify-center text-sm text-muted">
              请选择左侧模板版本
            </div>

            <div v-else class="flex-1 overflow-y-auto p-4 space-y-4">
              <!-- 基本信息 -->
              <div class="grid grid-cols-4 gap-3 ">
                <div />
                <UFormField
                  label="版本标签"
                  size="sm"
                  orientation="horizontal"
                  class="w-56"
                >
                  <UInput
                    v-model="selectedDetail.versionLabel"
                    :disabled="!isDraft"
                    size="sm"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="版本说明"
                  size="sm"
                  orientation="horizontal"
                  class="w-56"
                >
                  <UInput
                    v-model="(selectedDetail.notes as string)"
                    :disabled="!isDraft"
                    size="sm"
                    placeholder="可选"
                    class="w-full"
                  />
                </UFormField>
                <div />
              </div>

              <USeparator />

              <!-- 里程碑列表 -->
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold">
                  里程碑（{{ editMilestones.length }}）
                </h3>
                <UButton
                  v-if="isDraft"
                  icon="i-lucide-plus"
                  label="添加里程碑"
                  color="primary"
                  variant="soft"
                  size="xs"
                  @click="addMilestone"
                />
              </div>

              <div v-if="editMilestones.length === 0" class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
                暂未配置里程碑，点击上方按钮添加
              </div>

              <div v-else class="space-y-3">
                <div
                  v-for="(milestone, mIdx) in editMilestones"
                  :key="milestone.key"
                  class="rounded-lg border border-default"
                >
                  <!-- 里程碑头部 -->
                  <div
                    class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-elevated/50 rounded-t-lg"
                    @click="toggleMilestone(milestone.key)"
                  >
                    <UIcon
                      :name="expandedMilestones.has(milestone.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                      class="size-4 text-muted shrink-0"
                    />
                    <UBadge :color="({ P: 'info', I: 'primary', V: 'warning', R: 'success' }[milestone.pivrStage] as any)" variant="subtle" size="xs">
                      {{ milestone.pivrStage }}
                    </UBadge>
                    <span class="text-sm font-medium flex-1 truncate">{{ milestone.name }}</span>
                    <span class="text-xs text-muted">{{ milestoneModeLabel[milestone.mode] || milestone.mode }}</span>
                    <span class="text-xs text-muted">{{ milestone.workItems.length }} 个工作项</span>

                    <template v-if="isDraft">
                      <UButton
                        icon="i-lucide-arrow-up"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :disabled="mIdx === 0"
                        @click.stop="moveMilestone(mIdx, -1)"
                      />
                      <UButton
                        icon="i-lucide-arrow-down"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :disabled="mIdx === editMilestones.length - 1"
                        @click.stop="moveMilestone(mIdx, 1)"
                      />
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        @click.stop="removeMilestone(mIdx)"
                      />
                    </template>
                  </div>

                  <!-- 里程碑展开内容 -->
                  <div v-if="expandedMilestones.has(milestone.key)" class="border-t border-default px-3 py-3 space-y-4">
                    <!-- 里程碑属性 -->
                    <div class="grid grid-cols-4 gap-3">
                      <UFormField label="名称" size="sm">
                        <UInput
                          v-model="milestone.name"
                          :disabled="!isDraft"
                          size="sm"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField label="PIVR 阶段" size="sm">
                        <USelect
                          v-model="(milestone.pivrStage as string)"
                          :items="pivrStageOptions"
                          value-key="value"
                          :disabled="!isDraft"
                          size="sm"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField label="模式" size="sm">
                        <USelect
                          v-model="milestone.mode"
                          :items="milestoneModeOptions"
                          value-key="value"
                          :disabled="!isDraft"
                          size="sm"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField label="说明" size="sm">
                        <UInput
                          v-model="(milestone.description as string)"
                          :disabled="!isDraft"
                          size="sm"
                          class="w-full"
                          placeholder="可选"
                        />
                      </UFormField>
                    </div>

                    <!-- 工作项列表 -->
                    <div class="space-y-2">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-muted">工作项（{{ milestone.workItems.length }}）</span>
                        <UButton
                          v-if="isDraft"
                          icon="i-lucide-plus"
                          label="添加工作项"
                          color="primary"
                          variant="ghost"
                          size="xs"
                          @click="addWorkItem(milestone)"
                        />
                      </div>

                      <div v-if="milestone.workItems.length === 0" class="rounded border border-dashed border-default py-4 text-center text-xs text-muted">
                        暂无工作项
                      </div>

                      <div v-else class="space-y-2">
                        <div
                          v-for="(wi, wiIdx) in milestone.workItems"
                          :key="wi.key"
                          class="rounded-lg border border-default/70 bg-elevated/20"
                        >
                          <!-- 工作项头部 -->
                          <div
                            class="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-elevated/50"
                            @click="toggleWorkItem(wi.key)"
                          >
                            <UIcon
                              :name="expandedWorkItems.has(wi.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                              class="size-3.5 text-muted shrink-0"
                            />
                            <span class="text-sm flex-1 truncate">{{ wi.title }}</span>
                            <UBadge color="neutral" variant="subtle" size="xs">
                              {{ wi.type }}
                            </UBadge>
                            <UBadge :color="wi.required ? 'error' : 'neutral'" variant="subtle" size="xs">
                              {{ wi.required ? '必选' : '可选' }}
                            </UBadge>
                            <span class="text-xs text-muted">{{ wi.deliverables.length }} 个交付物</span>

                            <template v-if="isDraft">
                              <UButton
                                icon="i-lucide-arrow-up"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :disabled="wiIdx === 0"
                                @click.stop="moveWorkItem(milestone, wiIdx, -1)"
                              />
                              <UButton
                                icon="i-lucide-arrow-down"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :disabled="wiIdx === milestone.workItems.length - 1"
                                @click.stop="moveWorkItem(milestone, wiIdx, 1)"
                              />
                              <UButton
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                size="xs"
                                @click.stop="removeWorkItem(milestone, wiIdx)"
                              />
                            </template>
                          </div>

                          <!-- 工作项展开内容 -->
                          <div v-if="expandedWorkItems.has(wi.key)" class="border-t border-default/70 px-3 py-3 space-y-3">
                            <div class="rounded-md border border-default/60 bg-default/40 p-3">
                              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                                <UFormField label="标题" size="sm" class="md:col-span-2 xl:col-span-3">
                                  <UInput
                                    v-model="wi.title"
                                    :disabled="!isDraft"
                                    size="sm"
                                    class="w-full"
                                  />
                                </UFormField>
                                <UFormField label="类型" size="sm">
                                  <USelect
                                    v-model="wi.type"
                                    :items="workItemTypeOptions"
                                    value-key="value"
                                    :disabled="!isDraft"
                                    size="sm"
                                    class="w-full"
                                  />
                                </UFormField>
                                <UFormField label="层级" size="sm">
                                  <USelect
                                    v-model="wi.tier"
                                    :items="workItemTierOptions"
                                    value-key="value"
                                    :disabled="!isDraft"
                                    size="sm"
                                    class="w-full"
                                  />
                                </UFormField>
                                <UFormField label="优先级" size="sm">
                                  <USelect
                                    v-model="wi.priority"
                                    :items="priorityOptions"
                                    value-key="value"
                                    :disabled="!isDraft"
                                    size="sm"
                                    class="w-full"
                                  />
                                </UFormField>
                                <UFormField label="说明" size="sm" class="md:col-span-2 xl:col-span-4">
                                  <UInput
                                    v-model="(wi.description as string)"
                                    :disabled="!isDraft"
                                    size="sm"
                                    class="w-full"
                                    placeholder="可选"
                                  />
                                </UFormField>
                                <UFormField label="评审级别" size="sm">
                                  <USelect
                                    v-model="wi.reviewLevel"
                                    :items="reviewLevelOptions"
                                    value-key="value"
                                    :disabled="!isDraft"
                                    size="sm"
                                    class="w-full"
                                  />
                                </UFormField>
                                <UFormField label="必选" size="sm">
                                  <div class="flex min-h-8 items-center rounded-md border border-default bg-default px-3">
                                    <input
                                      v-model="wi.required"
                                      type="checkbox"
                                      class="rounded border-default text-primary focus:ring-primary"
                                      :disabled="!isDraft"
                                    >
                                    <span class="ml-2 text-xs text-muted whitespace-nowrap">
                                      {{ wi.required ? '创建项目时必须包含' : '创建项目时可取消' }}
                                    </span>
                                  </div>
                                </UFormField>
                              </div>
                            </div>

                            <!-- 交付物列表 -->
                            <div class="space-y-2 mt-2">
                              <div class="flex items-center justify-between">
                                <span class="text-xs font-semibold text-muted">交付物（{{ wi.deliverables.length }}）</span>
                                <UButton
                                  v-if="isDraft"
                                  icon="i-lucide-plus"
                                  label="添加交付物"
                                  color="primary"
                                  variant="ghost"
                                  size="xs"
                                  @click="addDeliverable(wi)"
                                />
                              </div>

                              <div v-if="wi.deliverables.length === 0" class="rounded border border-dashed border-default py-3 text-center text-xs text-muted">
                                暂无交付物
                              </div>

                              <div
                                v-for="(del, delIdx) in wi.deliverables"
                                :key="del.key"
                                class="rounded-md border border-default/50 bg-default/30 px-3 py-3 space-y-3"
                              >
                                <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                  <div class="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_160px_140px]">
                                    <UFormField label="名称" size="sm">
                                      <UInput
                                        v-model="del.name"
                                        :disabled="!isDraft"
                                        size="sm"
                                        class="w-full"
                                      />
                                    </UFormField>
                                    <UFormField label="类型" size="sm">
                                      <USelect
                                        v-model="del.deliverableType"
                                        :items="deliverableTypeOptions"
                                        value-key="value"
                                        :disabled="!isDraft"
                                        size="sm"
                                        class="w-full"
                                      />
                                    </UFormField>
                                    <UFormField label="必交" size="sm">
                                      <div class="flex min-h-8 items-center rounded-md border border-default bg-default px-3">
                                        <input
                                          v-model="del.required"
                                          type="checkbox"
                                          class="rounded border-default text-primary focus:ring-primary"
                                          :disabled="!isDraft"
                                        >
                                        <span class="ml-2 text-xs text-muted whitespace-nowrap">
                                          {{ del.required ? '必须提交' : '可选' }}
                                        </span>
                                      </div>
                                    </UFormField>
                                  </div>
                                  <div v-if="isDraft" class="flex items-center justify-end gap-1 xl:pt-6">
                                    <UButton
                                      icon="i-lucide-arrow-up"
                                      color="neutral"
                                      variant="ghost"
                                      size="xs"
                                      :disabled="delIdx === 0"
                                      @click="moveDeliverable(wi, delIdx, -1)"
                                    />
                                    <UButton
                                      icon="i-lucide-arrow-down"
                                      color="neutral"
                                      variant="ghost"
                                      size="xs"
                                      :disabled="delIdx === wi.deliverables.length - 1"
                                      @click="moveDeliverable(wi, delIdx, 1)"
                                    />
                                    <UButton
                                      icon="i-lucide-trash-2"
                                      color="error"
                                      variant="ghost"
                                      size="xs"
                                      @click="removeDeliverable(wi, delIdx)"
                                    />
                                  </div>
                                </div>
                                <div class="grid gap-3 md:grid-cols-2">
                                  <UFormField label="说明" size="sm">
                                    <UInput
                                      v-model="(del.description as string)"
                                      :disabled="!isDraft"
                                      size="sm"
                                      class="w-full"
                                      placeholder="可选"
                                    />
                                  </UFormField>
                                  <UFormField label="验收标准" size="sm">
                                    <UInput
                                      v-model="del.acceptanceCriteria"
                                      :disabled="!isDraft"
                                      size="sm"
                                      class="w-full"
                                      placeholder="验收标准"
                                    />
                                  </UFormField>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
