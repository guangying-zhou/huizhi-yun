<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useDragAndDrop } from '@formkit/drag-and-drop/vue'
import type { WorkItem } from '~/types/aims'
import { typeConfig, priorityConfig, getStatusLabel, transitionLabels } from '~/config/work-item'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '看板',
  layoutHeaderProjectSwitcher: false
})

const workItemStore = useWorkItemStore()

// 项目页签
const selectedProjectId = ref<string>('all')
const projects = ref<{
  id: number
  name: string
  projectCode: string
}[]>([])
const boardData = ref<Record<string, any[]>>({})
const stats = ref({ todo: 0, inProgress: 0, done: 0 })
const loading = ref(false)

// 详情弹窗
const showDetail = ref(false)
const selectedItem = ref<any>(null)
const availableTransitions = ref<{ toStatus: string, transitionKey: string }[]>([])
const transitioning = ref(false)

// 我的看板：显示 matter 层任务状态
const boardColumns = [
  { key: 'todo', label: '待办', color: 'info', statuses: ['todo'] },
  { key: 'active', label: '执行中', color: 'primary', statuses: ['in_progress'] },
  { key: 'review', label: '确认中', color: 'warning', statuses: ['in_review'] },
  { key: 'completed', label: '已完成', color: 'success', statuses: ['completed'] }
]

const transitionColor: Record<string, string> = {
  start: 'primary',
  submit_review: 'info',
  approve_review: 'success',
  pass_test: 'success',
  confirm: 'info',
  start_fix: 'primary',
  submit_verify: 'info',
  pass_verify: 'success',
  reject_review: 'warning',
  reopen: 'warning',
  fail_verify: 'warning',
  reject: 'error'
}

const columnColorClass: Record<string, string> = {
  neutral: 'border-neutral-300 dark:border-neutral-600',
  primary: 'border-primary',
  info: 'border-info',
  warning: 'border-warning',
  success: 'border-success'
}

interface MyBoardPayload {
  projects?: any[]
  board?: Record<string, any[]>
  stats?: Partial<{ todo: number, inProgress: number, done: number }>
  items?: any[]
}

function normalizeWorkItem(row: any, projectNameMap: Map<number, string>) {
  const projectId = Number(row.projectId ?? row.project_id ?? 0)
  return {
    ...row,
    id: Number(row.id),
    projectId,
    projectName: row.projectName ?? row.project_name ?? projectNameMap.get(projectId) ?? (projectId ? `项目 ${projectId}` : ''),
    itemKey: row.itemKey ?? row.item_key,
    dueDate: row.dueDate ?? row.due_date ?? null,
    estimatedHours: row.estimatedHours ?? row.estimated_hours ?? null
  }
}

function groupItemsByStatus(items: any[]) {
  return items.reduce<Record<string, any[]>>((acc, item) => {
    const status = String(item.status || 'todo')
    if (!acc[status]) acc[status] = []
    acc[status]!.push(item)
    return acc
  }, {})
}

function buildStats(board: Record<string, any[]>) {
  return {
    todo: board.todo?.length || 0,
    inProgress: board.in_progress?.length || 0,
    done: board.completed?.length || 0
  }
}

async function fetchProjectNameMap() {
  const res = await $fetch<{ code: number, data: { items?: any[] } }>('/api/v1/projects', {
    params: { pageSize: 100 }
  })
  const list = res.code === 0 ? (res.data.items || []) : []
  projects.value = list.map(project => ({
    id: Number(project.id),
    name: project.name || project.shortName || project.short_name || `项目 ${project.id}`,
    projectCode: project.projectCode || project.project_code || ''
  }))
  return new Map(projects.value.map(project => [project.id, project.name]))
}

async function loadBoard() {
  loading.value = true
  try {
    const queryParams = new URLSearchParams()
    if (selectedProjectId.value !== 'all') queryParams.set('projectId', selectedProjectId.value)
    const qs = queryParams.toString()
    const res = await $fetch<{ code: number, data: MyBoardPayload }>(
      `/api/v1/my-board${qs ? '?' + qs : ''}`
    )
    if (res.code === 0) {
      let projectNameMap = new Map(projects.value.map(project => [project.id, project.name]))
      if (res.data.items && projects.value.length === 0) {
        projectNameMap = await fetchProjectNameMap()
      } else if (res.data.projects) {
        projects.value = res.data.projects.map(project => ({
          id: Number(project.id),
          name: project.name || project.shortName || project.short_name || `项目 ${project.id}`,
          projectCode: project.projectCode || project.project_code || ''
        }))
        projectNameMap = new Map(projects.value.map(project => [project.id, project.name]))
      }

      const rawItems = res.data.items || null
      const board = rawItems
        ? groupItemsByStatus(rawItems
            .map(item => normalizeWorkItem(item, projectNameMap))
            .filter(item => selectedProjectId.value === 'all' || String(item.projectId) === selectedProjectId.value))
        : Object.fromEntries(Object.entries(res.data.board || {}).map(([status, items]) => [
            status,
            items.map(item => normalizeWorkItem(item, projectNameMap))
          ]))
      boardData.value = board
      stats.value = {
        ...buildStats(board),
        ...res.data.stats
      }
      // 更新拖拽列数据
      syncColumnLists(board)
    }
  } catch (err) {
    console.error('[Board] loadBoard failed:', err)
    boardData.value = {}
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadBoard()
})

watch(selectedProjectId, () => {
  loadBoard()
})

// 拖拽列 refs (每列一个)
const [todoEl, todoItems] = useDragAndDrop<any>([], { group: 'board' })
const [activeEl, activeItems] = useDragAndDrop<any>([], { group: 'board' })
const [reviewEl, reviewItems] = useDragAndDrop<any>([], { group: 'board' })
const [completedEl, completedItems] = useDragAndDrop<any>([], { group: 'board' })

const columnRefs = {
  todo: { el: todoEl, items: todoItems },
  active: { el: activeEl, items: activeItems },
  review: { el: reviewEl, items: reviewItems },
  completed: { el: completedEl, items: completedItems }
}

function syncColumnLists(board: Record<string, any[]>) {
  for (const col of boardColumns) {
    const ref = columnRefs[col.key as keyof typeof columnRefs]
    if (ref) {
      ref.items.value = col.statuses.flatMap(s => board[s] || [])
    }
  }
}

function getColumnItems(columnKey: string): any[] {
  return columnRefs[columnKey as keyof typeof columnRefs]?.items.value ?? []
}

function setColumnEl(columnKey: string, el: unknown) {
  const columnRef = columnRefs[columnKey as keyof typeof columnRefs]
  if (columnRef) {
    columnRef.el.value = el instanceof HTMLElement ? el : undefined
  }
}

async function openDetail(item: WorkItem) {
  selectedItem.value = item
  showDetail.value = true
  try {
    const res = await $fetch<{ code: number, data: { toStatus: string, transitionKey: string }[] }>(
      `/api/v1/work-items/${item.id}/transitions`
    )
    if (res.code === 0) {
      availableTransitions.value = res.data
    }
  } catch {
    availableTransitions.value = []
  }
}

async function handleTransition(toStatus: string) {
  if (!selectedItem.value) return
  transitioning.value = true
  try {
    await workItemStore.updateItem(selectedItem.value.id, { status: toStatus })
    showDetail.value = false
    selectedItem.value = null
    await loadBoard()
  } finally {
    transitioning.value = false
  }
}
</script>

<template>
  <Teleport to="#aims-layout-header-actions">
    <div class="flex items-center gap-3 text-sm">
      <div class="flex items-center gap-2">
        <UBadge color="neutral" variant="subtle">
          待办 {{ stats.todo }}
        </UBadge>
        <UBadge color="primary" variant="subtle">
          进行中 {{ stats.inProgress }}
        </UBadge>
        <UBadge color="success" variant="subtle">
          完成 {{ stats.done }}
        </UBadge>
      </div>
    </div>
  </Teleport>

  <UDashboardPanel id="my-board">
    <template #body>
      <div class="p-4 space-y-4">
        <!-- 项目页签 -->
        <div class="flex items-center gap-0.5 border-b border-default overflow-x-auto">
          <button
            class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2"
            :class="[
              selectedProjectId === 'all'
                ? 'text-primary border-primary'
                : 'text-muted hover:text-default border-transparent'
            ]"
            @click="selectedProjectId = 'all'"
          >
            <UIcon name="i-lucide-grip" class="w-4 h-4 mr-1 inline-block align-text-bottom" />
            全部
          </button>
          <button
            v-for="proj in projects"
            :key="proj.id"
            class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2"
            :class="[
              selectedProjectId === String(proj.id)
                ? 'text-primary border-primary'
                : 'text-muted hover:text-default border-transparent'
            ]"
            @click="selectedProjectId = String(proj.id)"
          >
            {{ proj.name }}
          </button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-muted" />
        </div>

        <!-- 看板 (支持拖拽) -->
        <div v-else class="flex gap-4 overflow-x-auto pb-4">
          <div
            v-for="col in boardColumns"
            :key="col.key"
            class="shrink-0 w-72"
          >
            <!-- 列头 -->
            <div
              class="flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2"
              :class="columnColorClass[col.color]"
            >
              <span class="font-medium text-sm">{{ col.label }}</span>
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ getColumnItems(col.key).length }}
              </UBadge>
            </div>

            <!-- 卡片列表（拖拽容器） -->
            <div class="p-2 bg-elevated/50 rounded-b-lg min-h-32 transition-colors">
              <div
                :ref="(el: unknown) => setColumnEl(col.key, el)"
                class="space-y-2 min-h-1"
              >
                <div
                  v-for="item in getColumnItems(col.key)"
                  :key="item.id"
                  class="bg-default p-3 rounded-md shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow border border-default"
                  @click.stop="openDetail(item)"
                >
                  <!-- 项目名 + 编号 -->
                  <div class="flex items-center gap-2 mb-1.5">
                    <UIcon
                      :name="typeConfig[item.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                      class="w-3.5 h-3.5 shrink-0"
                    />
                    <span class="font-mono text-xs text-muted">{{ item.itemKey }}</span>
                  </div>
                  <p class="text-sm font-medium line-clamp-2 mb-2">
                    {{ item.title }}
                  </p>
                  <div class="flex items-center justify-between">
                    <UBadge :color="(priorityConfig[item.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle" size="xs">
                      {{ item.priority }}
                    </UBadge>
                    <span v-if="selectedProjectId === 'all'" class="text-xs text-muted truncate max-w-24">
                      {{ item.projectName }}
                    </span>
                    <span v-if="item.dueDate" class="text-xs text-muted">
                      {{ item.dueDate?.toString().slice(5, 10) }}
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="getColumnItems(col.key).length === 0" class="text-center py-8 text-xs text-muted">
                暂无
              </div>
            </div>
          </div>
        </div>

        <!-- 工作项详情弹窗 -->
        <UModal v-model:open="showDetail">
          <template #header>
            <div class="flex items-center justify-between w-full">
              <div class="flex items-center gap-2">
                <UIcon
                  v-if="selectedItem"
                  :name="typeConfig[selectedItem.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                  class="w-5 h-5"
                />
                <span class="font-mono text-sm text-muted">{{ selectedItem?.itemKey }}</span>
                <UBadge
                  v-if="selectedItem"
                  color="info"
                  variant="subtle"
                  size="xs"
                >
                  {{ typeConfig[selectedItem.type as keyof typeof typeConfig]?.label || selectedItem.type }}
                </UBadge>
              </div>
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="showDetail = false"
              />
            </div>
          </template>
          <template #body>
            <div v-if="selectedItem" class="space-y-5">
              <h3 class="text-lg font-semibold">
                {{ selectedItem.title }}
              </h3>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span class="text-muted">项目</span>
                  <p class="mt-1 font-medium">
                    {{ selectedItem.projectName }}
                  </p>
                </div>
                <div>
                  <span class="text-muted">状态</span>
                  <div class="mt-1">
                    <UBadge color="primary" variant="subtle">
                      {{ getStatusLabel(selectedItem.status) }}
                    </UBadge>
                  </div>
                </div>
                <div>
                  <span class="text-muted">优先级</span>
                  <div class="mt-1">
                    <UBadge :color="(priorityConfig[selectedItem.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle">
                      {{ selectedItem.priority }}
                    </UBadge>
                  </div>
                </div>
                <div v-if="selectedItem.dueDate">
                  <span class="text-muted">截止日期</span>
                  <p class="mt-1">
                    {{ selectedItem.dueDate?.toString().slice(0, 10) }}
                  </p>
                </div>
                <div v-if="selectedItem.estimatedHours">
                  <span class="text-muted">预估工时</span>
                  <p class="mt-1">
                    {{ selectedItem.estimatedHours }}h
                  </p>
                </div>
                <div v-if="selectedItem.severity">
                  <span class="text-muted">严重程度</span>
                  <p class="mt-1">
                    {{ selectedItem.severity }}
                  </p>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div v-if="availableTransitions.length > 0" class="border-t border-default pt-4">
                <span class="text-sm text-muted mb-2 block">可执行操作</span>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="t in availableTransitions"
                    :key="t.transitionKey"
                    :label="transitionLabels[t.transitionKey] || t.transitionKey"
                    :color="(transitionColor[t.transitionKey] || 'primary') as any"
                    variant="soft"
                    size="sm"
                    :loading="transitioning"
                    @click="handleTransition(t.toStatus)"
                  />
                </div>
              </div>

              <!-- 跳转到项目 -->
              <div class="border-t border-default pt-4">
                <UButton
                  label="在项目中查看"
                  icon="i-lucide-external-link"
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  @click="navigateTo(`/projects/${selectedItem.projectId}/tasks`); showDetail = false"
                />
              </div>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
