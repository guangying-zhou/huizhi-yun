<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { WorkItem } from '~/types/aims'
import { typeConfig, priorityConfig, severityConfig, getStatusLabel } from '~/config/work-item'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '看板',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const childRouteActive = computed(() => Boolean(route.params.workItemId))

const projectStore = useProjectStore()
const { isWorkItemEditable, workItemReadonlyReason } = storeToRefs(projectStore)
const workItemStore = useWorkItemStore()
const toast = useToast()
const { users: accountUsers } = useAccountUsers()

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    if (u.realName?.trim()) map.set(u.uid, u.realName.trim())
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '未指派'
  return userNameMap.value.get(uid) || uid
}

const swimlaneMode = ref<'none' | 'assignee' | 'priority'>('none')

// 快捷过滤
const { user: currentUserUid } = useAuth()
const quickFilter = ref<'all' | 'my_assigned' | 'my_reported' | 'unassigned'>('my_assigned')
const quickFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '我负责的', value: 'my_assigned' },
  { label: '我创建的', value: 'my_reported' },
  { label: '未分配', value: 'unassigned' }
]

// 详情弹窗
const showDetail = ref(false)
const selectedItem = ref<WorkItem | null>(null)
const availableTransitions = ref<{ toStatus: string, transitionKey: string }[]>([])
const transitioning = ref(false)

// 重新指派
const showReassign = ref(false)
const reassignUid = ref('')

const memberOptions = computed(() => {
  const members = (projectStore.currentProject?.members || []).filter(m => m.status !== 'suspended')
  return members.map((m) => {
    const name = m.realName?.trim() || userNameMap.value.get(m.uid)
    return {
      label: name ? `${name}(${m.uid})` : m.uid,
      displayLabel: name || m.uid,
      value: m.uid
    }
  })
})

// 当前用户是否为选中任务的负责人
const isAssignee = computed(() => {
  return !!(selectedItem.value && currentUserUid.value && selectedItem.value.assigneeUid === currentUserUid.value)
})

// 当前用户是否为项目经理
const isManager = computed(() => {
  const project = projectStore.currentProject
  if (!project) return false
  return project.currentUserRole === 'manager' || project.leaderUid === currentUserUid.value
})

// 区分拖拽和点击：记录 mousedown 位置，mouseup 时判断移动距离
let pointerStart = { x: 0, y: 0 }
let isDragging = false
let suppressClickUntil = 0
let dragCleanupTimer: ReturnType<typeof setTimeout> | null = null

const dragState = ref<{ item: WorkItem, fromColKey: string } | null>(null)
const dragOverColumnKey = ref<string | null>(null)
const dragAllowedTargets = ref<string[]>([])
const dragBlockedReasons = ref<Record<string, string>>({})
const dragValidationState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
let dragValidationToken = 0

function onCardPointerDown(e: PointerEvent) {
  pointerStart = { x: e.clientX, y: e.clientY }
  isDragging = false
}

function onCardClick(e: MouseEvent, item: WorkItem) {
  if (isDragging || Date.now() < suppressClickUntil) return
  const dx = Math.abs(e.clientX - pointerStart.x)
  const dy = Math.abs(e.clientY - pointerStart.y)
  // 移动超过 5px 视为拖拽，不触发点击
  if (dx > 5 || dy > 5) return
  openDetail(item)
}

// WIP 限制（默认值，可从 board_config 读取）
const wipLimits = ref<Record<string, number>>({
  planning: 0,
  todo: 0,
  in_progress: 5,
  in_review: 3,
  completed: 0
})

// 看板列定义
const columns = [
  { key: 'planning', label: '规划中', color: 'neutral' },
  { key: 'todo', label: '待办', color: 'info' },
  { key: 'in_progress', label: '执行中', color: 'primary' },
  { key: 'in_review', label: '确认中', color: 'warning' },
  { key: 'completed', label: '已完成', color: 'success' }
]

const columnData = ref<Record<string, WorkItem[]>>({})
// 每列单独的 ref
const columnValueRefs: Record<string, Ref<WorkItem[]>> = {}
for (const col of columns) {
  columnValueRefs[col.key] = ref<WorkItem[]>([])
}
const boardMounted = ref(false)

const columnColorClass: Record<string, string> = {
  neutral: 'border-neutral-300 dark:border-neutral-600',
  primary: 'border-primary',
  info: 'border-info',
  warning: 'border-warning',
  success: 'border-success'
}

// 泳道分组
const swimlanes = computed(() => {
  if (swimlaneMode.value === 'none') return null

  const allItems = Object.values(columnData.value).flat().filter(i => applyQuickFilter([i]).length > 0)
  const groups = new Map<string, string>()

  if (swimlaneMode.value === 'assignee') {
    for (const item of allItems) {
      const key = item.assigneeUid || '__unassigned__'
      if (!groups.has(key)) {
        groups.set(key, getUserName(item.assigneeUid))
      }
    }
  } else if (swimlaneMode.value === 'priority') {
    for (const p of ['P0', 'P1', 'P2', 'P3']) {
      if (allItems.some(i => i.priority === p)) {
        groups.set(p, p)
      }
    }
  }
  return Array.from(groups.entries()).map(([key, label]) => ({ key, label }))
})

function applyQuickFilter(items: WorkItem[]): WorkItem[] {
  if (quickFilter.value === 'all') return items
  const uid = currentUserUid.value
  if (quickFilter.value === 'my_assigned') return items.filter(i => i.assigneeUid === uid)
  if (quickFilter.value === 'my_reported') return items.filter(i => i.reporterUid === uid)
  if (quickFilter.value === 'unassigned') return items.filter(i => !i.assigneeUid)
  return items
}

function getColumnItems(colKey: string): WorkItem[] {
  return applyQuickFilter(columnData.value[colKey] || [])
}

function getSwimlanColumnItems(colKey: string, swimlaneKey: string): WorkItem[] {
  const items = applyQuickFilter(columnData.value[colKey] || [])
  if (swimlaneMode.value === 'assignee') {
    if (swimlaneKey === '__unassigned__') return items.filter(i => !i.assigneeUid)
    return items.filter(i => i.assigneeUid === swimlaneKey)
  }
  if (swimlaneMode.value === 'priority') {
    return items.filter(i => i.priority === swimlaneKey)
  }
  return items
}

function isWipExceeded(colKey: string): boolean {
  const limit = wipLimits.value[colKey]
  if (!limit) return false
  return (columnValueRefs[colKey]?.value?.length || 0) > limit
}

// 加载看板数据
async function loadBoard() {
  await workItemStore.fetchBoardItems(projectId.value, { tier: 'matter' })

  // 将 store 中的数据分配到各列
  const data: Record<string, WorkItem[]> = {}
  for (const col of columns) {
    const items = workItemStore.boardColumns[col.key] || []
    data[col.key] = items
    columnValueRefs[col.key]!.value = [...items]
  }
  columnData.value = data
}

function clearDragState(_reason = 'reset') {
  if (dragCleanupTimer) {
    clearTimeout(dragCleanupTimer)
    dragCleanupTimer = null
  }

  dragState.value = null
  dragOverColumnKey.value = null
  dragAllowedTargets.value = []
  dragBlockedReasons.value = {}
  dragValidationState.value = 'idle'
  dragValidationToken++
  suppressClickUntil = Date.now() + 150

  setTimeout(() => {
    isDragging = false
  }, 0)
}

function buildDragBlockedReasons(item: WorkItem, fromColKey: string, allowedTargets: string[]) {
  const nextReasons: Record<string, string> = {}

  for (const col of columns) {
    if (col.key === fromColKey) {
      nextReasons[col.key] = '当前列'
      continue
    }

    const limit = wipLimits.value[col.key]
    const count = columnValueRefs[col.key]?.value.length || 0
    if (limit && count >= limit) {
      nextReasons[col.key] = 'WIP 已满'
      continue
    }

    if (!allowedTargets.includes(col.key)) {
      nextReasons[col.key] = `不能从${getStatusLabel(item.status)}直接流转`
    }
  }

  return nextReasons
}

function isDropAllowed(colKey: string) {
  if (!dragState.value) return false
  return !dragBlockedReasons.value[colKey]
}

function getColumnDragHint(colKey: string) {
  if (!dragState.value) return ''
  if (colKey === dragState.value.fromColKey) return '当前列'
  if (dragValidationState.value === 'loading') return '校验中...'
  return dragBlockedReasons.value[colKey] || '可拖入'
}

async function prefetchDropValidation(item: WorkItem, fromColKey: string) {
  const token = ++dragValidationToken
  dragValidationState.value = 'loading'
  dragAllowedTargets.value = []
  dragBlockedReasons.value = {}

  try {
    const res = await $fetch<{ code: number, data: { toStatus: string, transitionKey: string }[] }>(
      `/api/v1/work-items/${item.id}/transitions`
    )
    if (token !== dragValidationToken || !dragState.value || dragState.value.item.id !== item.id) return

    const allowedTargets = res.code === 0 ? res.data.map(t => t.toStatus) : []
    dragAllowedTargets.value = allowedTargets
    dragBlockedReasons.value = buildDragBlockedReasons(item, fromColKey, allowedTargets)
    dragValidationState.value = 'ready'
  } catch {
    if (token !== dragValidationToken || !dragState.value || dragState.value.item.id !== item.id) return

    dragAllowedTargets.value = []
    dragBlockedReasons.value = Object.fromEntries(
      columns
        .filter(col => col.key !== fromColKey)
        .map(col => [col.key, '状态校验失败'])
    )
    dragValidationState.value = 'error'
  }
}

function onCardDragStart(colKey: string, item: WorkItem, e: DragEvent) {
  if (!isWorkItemEditable.value) {
    e.preventDefault()
    return
  }
  if (dragCleanupTimer) {
    clearTimeout(dragCleanupTimer)
    dragCleanupTimer = null
  }

  dragState.value = { item, fromColKey: colKey }
  dragOverColumnKey.value = colKey
  isDragging = true

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.setData('text/plain', String(item.id))
  }

  void prefetchDropValidation(item, colKey)
}

function onCardDragEnd() {
  dragCleanupTimer = setTimeout(() => {
    clearDragState('dragend-timeout')
  }, 120)
}

function onColumnDragOver(colKey: string, e: DragEvent) {
  if (!dragState.value) return
  e.preventDefault()
  const previousColKey = dragOverColumnKey.value
  dragOverColumnKey.value = colKey
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = isDropAllowed(colKey) ? 'move' : 'none'
  }
  if (previousColKey !== colKey) return
}

function onColumnDragEnter(colKey: string, e: DragEvent) {
  if (!dragState.value) return
  e.preventDefault()
  if (dragOverColumnKey.value !== colKey) {
    dragOverColumnKey.value = colKey
  }
}

function onColumnDragLeave(colKey: string, e: DragEvent) {
  const relatedTarget = e.relatedTarget
  if (relatedTarget instanceof Node && (e.currentTarget as HTMLElement | null)?.contains(relatedTarget)) {
    return
  }
  if (dragOverColumnKey.value === colKey) {
    dragOverColumnKey.value = null
  }
}

function findDragSourceByItemId(itemId: number) {
  for (const col of columns) {
    const item = columnValueRefs[col.key]?.value.find(candidate => candidate.id === itemId)
    if (item) {
      return { item, fromColKey: col.key }
    }
  }
  return null
}

async function onColumnDrop(colKey: string, e: DragEvent) {
  if (dragCleanupTimer) {
    clearTimeout(dragCleanupTimer)
    dragCleanupTimer = null
  }

  const draggedItemId = Number(e.dataTransfer?.getData('text/plain') || 0)
  const currentDrag = dragState.value || (draggedItemId ? findDragSourceByItemId(draggedItemId) : null)
  const validationState = dragValidationState.value
  const blockedReason = dragBlockedReasons.value[colKey]

  if (!currentDrag || currentDrag.fromColKey === colKey) {
    return
  }

  const { item, fromColKey } = currentDrag
  if (validationState === 'loading') {
    toast.add({
      title: '正在校验拖拽目标',
      description: '请稍后重试拖拽',
      color: 'warning',
      icon: 'i-lucide-loader-2'
    })
    clearDragState('validation-loading')
    return
  }

  if (blockedReason) {
    toast.add({
      title: blockedReason === 'WIP 已满' ? 'WIP 已超限' : '不能拖到该列',
      description: blockedReason === 'WIP 已满'
        ? `${columns.find(col => col.key === colKey)?.label || colKey} 已达到上限`
        : blockedReason,
      color: 'warning',
      icon: blockedReason === 'WIP 已满' ? 'i-lucide-alert-triangle' : 'i-lucide-git-pull-request-draft'
    })
    clearDragState('blocked-reason')
    return
  }

  const targetItems = columnValueRefs[colKey]?.value || []
  const sourceItems = columnValueRefs[fromColKey]?.value || []
  const nextSourceItems = sourceItems.filter(sourceItem => sourceItem.id !== item.id)
  const nextTargetItems = [...targetItems, item]

  columnValueRefs[fromColKey]!.value = nextSourceItems
  columnValueRefs[colKey]!.value = nextTargetItems
  columnData.value[fromColKey] = nextSourceItems
  columnData.value[colKey] = nextTargetItems

  try {
    await workItemStore.updateItem(item.id, { status: colKey })
    await loadBoard()
  } catch (err: unknown) {
    await loadBoard()
    const errData = (err as { data?: { message?: string }, statusMessage?: string, message?: string }) || {}
    const serverMsg = errData.data?.message || errData.statusMessage || errData.message
    toast.add({
      title: '无法变更状态',
      description: serverMsg || '状态更新未成功，已恢复原位置',
      color: 'error',
      icon: 'i-lucide-circle-x'
    })
  } finally {
    clearDragState('drop-finished')
  }
}

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  // 读取项目的 board_config 中的 WIP 限制
  if (projectStore.currentProject?.boardConfig) {
    const config = projectStore.currentProject.boardConfig as any
    if (config.wipLimits) {
      wipLimits.value = { ...wipLimits.value, ...config.wipLimits }
    }
  }

  await loadBoard()
  boardMounted.value = true
})

watch(swimlaneMode, (mode) => {
  if (mode === 'none') return
  clearDragState()
})

async function openDetail(item: WorkItem) {
  // 执行中的任务、确认中任务、已完成任务统一跳转到执行页面
  if (item.status === 'in_progress' || item.status === 'in_review' || item.status === 'completed') {
    navigateTo(`/projects/${projectId.value}/board/${item.id}/execution`)
    return
  }
  selectedItem.value = item
  showDetail.value = true
  showTimeEntry.value = false
  showLinkDoc.value = false
  timeEntries.value = []
  linkedDocs.value = []
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
  loadTimeEntries(item.id)
  loadLinkedDocs(item.id)
}

async function handleStartExecution() {
  if (!selectedItem.value) return
  transitioning.value = true
  try {
    const itemId = selectedItem.value.id
    await workItemStore.updateItem(itemId, { status: 'in_progress' })
    toast.add({ title: '已开始执行', color: 'success' })
    showDetail.value = false
    selectedItem.value = null
    await navigateTo(`/projects/${projectId.value}/board/${itemId}/execution`)
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '操作失败'
    toast.add({ title: '开始执行失败', description: msg, color: 'error' })
  } finally {
    transitioning.value = false
  }
}

function openReassign() {
  if (!selectedItem.value) return
  reassignUid.value = selectedItem.value.assigneeUid || ''
  showReassign.value = true
}

async function handleReassign() {
  if (!selectedItem.value || !reassignUid.value) return
  transitioning.value = true
  try {
    await workItemStore.updateItem(selectedItem.value.id, { assigneeUid: reassignUid.value })
    toast.add({ title: '已重新指派', color: 'success' })
    showReassign.value = false
    showDetail.value = false
    selectedItem.value = null
    await loadBoard()
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '操作失败'
    toast.add({ title: '重新指派失败', description: msg, color: 'error' })
  } finally {
    transitioning.value = false
  }
}

// 工时记录
const showTimeEntry = ref(false)
const timeEntries = ref<{ id: number, entryDate: string, uid: string, hours: number, description: string }[]>([])

async function loadTimeEntries(itemId: number) {
  try {
    const res = await $fetch<{ code: number, data: any[] }>(`/api/v1/work-items/${itemId}/time-entries`)
    if (res.code === 0) {
      timeEntries.value = res.data
    }
  } catch {
    timeEntries.value = []
  }
}

// 关联文档
const showLinkDoc = ref(false)
const linkedDocs = ref<{ id: number, documentId: string }[]>([])

async function loadLinkedDocs(itemId: number) {
  try {
    const res = await $fetch<{ code: number, data: any[] }>(`/api/v1/work-items/${itemId}/documents`)
    if (res.code === 0) {
      linkedDocs.value = res.data
    }
  } catch {
    linkedDocs.value = []
  }
}

const swimlaneOptions = [
  { label: '不分组', value: 'none' },
  { label: '按指派人', value: 'assignee' },
  { label: '按优先级', value: 'priority' }
]
</script>

<template>
  <NuxtPage v-if="childRouteActive" />

  <UDashboardPanel v-else id="project-board" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-12 space-y-4">
          <!-- 工具栏 -->
          <div class="flex items-center gap-3 flex-wrap">
            <span class="text-sm text-muted">
              分组
            </span>
            <USelect
              v-model="swimlaneMode"
              :items="swimlaneOptions"
              class="w-36"
            />
            <USeparator
              orientation="vertical"
              class="h-5"
            />
            <UButton
              v-for="opt in quickFilterOptions"
              :key="opt.value"
              :label="opt.label"
              :color="quickFilter === opt.value ? 'primary' : 'neutral'"
              :variant="quickFilter === opt.value ? 'soft' : 'ghost'"
              size="sm"
              @click="quickFilter = opt.value as typeof quickFilter"
            />
          </div>

          <!-- 加载中 -->
          <div v-if="workItemStore.loading" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-muted" />
          </div>

          <!-- 无泳道模式 -->
          <div v-else-if="!swimlanes" class="flex gap-4 overflow-x-auto pb-4">
            <div
              v-for="col in columns"
              :key="col.key"
              class="shrink-0 w-48 xl:w-11/60"
              @dragenter="onColumnDragEnter(col.key, $event)"
              @dragover="onColumnDragOver(col.key, $event)"
              @dragleave="onColumnDragLeave(col.key, $event)"
              @drop.prevent="onColumnDrop(col.key, $event)"
            >
              <!-- 列头 -->
              <div
                class="flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2"
                :class="[columnColorClass[col.color], isWipExceeded(col.key) ? 'bg-error/10' : '']"
              >
                <div class="min-w-0">
                  <span class="font-medium text-sm">{{ col.label }}</span>
                  <p
                    v-if="dragState"
                    class="mt-0.5 text-[11px]"
                    :class="isDropAllowed(col.key) ? 'text-success' : 'text-muted'"
                  >
                    {{ getColumnDragHint(col.key) }}
                  </p>
                </div>
                <div class="flex items-center gap-1.5">
                  <UBadge
                    :color="isWipExceeded(col.key) ? 'error' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ getColumnItems(col.key).length }}
                    <span v-if="wipLimits[col.key]"> / {{ wipLimits[col.key] }}</span>
                  </UBadge>
                </div>
              </div>

              <!-- 卡片列表（拖拽容器） -->
              <div
                class="space-y-2 p-2 bg-elevated/50 rounded-b-lg min-h-32 transition-colors"
                :class="[
                  dragState && isDropAllowed(col.key) ? 'bg-success/5' : '',
                  dragState && !isDropAllowed(col.key) && col.key !== dragState.fromColKey ? 'bg-error/5' : '',
                  dragOverColumnKey === col.key && isDropAllowed(col.key) ? 'ring-2 ring-primary/30 bg-primary/5' : '',
                  dragOverColumnKey === col.key && !isDropAllowed(col.key) ? 'ring-2 ring-error/30' : ''
                ]"
                @dragenter.stop="onColumnDragEnter(col.key, $event)"
                @dragover.stop="onColumnDragOver(col.key, $event)"
                @dragleave.stop="onColumnDragLeave(col.key, $event)"
                @drop.stop.prevent="onColumnDrop(col.key, $event)"
              >
                <div
                  v-for="item in getColumnItems(col.key)"
                  :key="item.id"
                  class="bg-default p-3 rounded-md shadow-sm cursor-grab hover:shadow-md transition-shadow border border-default active:cursor-grabbing"
                  :class="dragState?.item.id === item.id ? 'opacity-50' : ''"
                  :draggable="isWorkItemEditable ? 'true' : 'false'"
                  @pointerdown="onCardPointerDown"
                  @dragstart="onCardDragStart(col.key, item, $event)"
                  @dragend="onCardDragEnd"
                  @dragenter.stop="onColumnDragEnter(col.key, $event)"
                  @dragover.stop="onColumnDragOver(col.key, $event)"
                  @drop.stop.prevent="onColumnDrop(col.key, $event)"
                  @click="onCardClick($event, item)"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <UIcon
                      :name="typeConfig[item.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                      :class="['w-3.5 h-3.5', typeConfig[item.type as keyof typeof typeConfig]?.color || '']"
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
                    <span v-if="item.assigneeUid" class="text-xs text-muted">
                      {{ getUserName(item.assigneeUid) }}
                    </span>
                  </div>
                </div>

                <div v-if="columnValueRefs[col.key]!.value.length === 0" class="text-center py-8 text-xs text-muted">
                  暂无
                </div>
              </div>
            </div>
          </div>

          <!-- 泳道模式 -->
          <div v-else class="space-y-6 overflow-x-auto pb-4">
            <div
              v-for="lane in swimlanes"
              :key="lane.key"
              class="border border-default rounded-lg"
            >
              <!-- 泳道头 -->
              <div class="px-4 py-2 bg-elevated/50 border-b border-default font-medium text-sm flex items-center gap-2">
                <UIcon v-if="swimlaneMode === 'assignee'" name="i-lucide-user" class="w-4 h-4" />
                <UIcon v-else name="i-lucide-signal" class="w-4 h-4" />
                {{ lane.label }}
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ columns.reduce((sum, col) => sum + getSwimlanColumnItems(col.key, lane.key).length, 0) }}
                </UBadge>
              </div>

              <!-- 泳道内的列 -->
              <div class="flex gap-4 p-3 overflow-x-auto">
                <div
                  v-for="col in columns"
                  :key="col.key"
                  class="shrink-0 w-64"
                >
                  <div class="text-xs text-muted mb-1.5 px-1">
                    {{ col.label }} ({{ getSwimlanColumnItems(col.key, lane.key).length }})
                  </div>
                  <div class="space-y-2 min-h-16">
                    <div
                      v-for="item in getSwimlanColumnItems(col.key, lane.key)"
                      :key="item.id"
                      class="bg-default p-2.5 rounded-md shadow-sm cursor-pointer hover:shadow-md transition-shadow border border-default"
                      @click="openDetail(item)"
                    >
                      <div class="flex items-center gap-1.5 mb-1">
                        <UIcon
                          :name="typeConfig[item.type as keyof typeof typeConfig]?.icon || 'i-lucide-circle'"
                          :class="['w-3 h-3', typeConfig[item.type as keyof typeof typeConfig]?.color || '']"
                        />
                        <span class="font-mono text-xs text-muted">{{ item.itemKey }}</span>
                      </div>
                      <p class="text-xs font-medium line-clamp-2">
                        {{ item.title }}
                      </p>
                    </div>
                    <div v-if="getSwimlanColumnItems(col.key, lane.key).length === 0" class="text-center py-4 text-xs text-muted">
                      -
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 工作项详情弹窗 -->
          <UModal v-model:open="showDetail" :ui="{ content: 'sm:max-w-5xl' }">
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

                <div class="grid grid-cols-3 gap-3 text-sm">
                  <div class="space-x-4">
                    <span class="text-muted">状态</span>
                    <span>
                      <UBadge color="primary" variant="subtle">
                        {{ getStatusLabel(selectedItem.status) }}
                      </UBadge>
                    </span>
                  </div>
                  <div class="space-x-4">
                    <span class="text-muted">优先级</span>
                    <span>
                      <UBadge :color="(priorityConfig[selectedItem.priority as keyof typeof priorityConfig]?.color as any)" variant="subtle">
                        {{ selectedItem.priority }}
                      </UBadge>
                    </span>
                  </div>
                  <div v-if="selectedItem.reporterUid" class="space-x-4">
                    <span class="text-muted">指派人</span>
                    <span>
                      {{ getUserName(selectedItem.reporterUid) }}
                    </span>
                  </div>
                  <div v-if="selectedItem.assigneeUid" class="space-x-4">
                    <span class="text-muted">被指派人</span>
                    <span>
                      {{ getUserName(selectedItem.assigneeUid) }}
                    </span>
                  </div>

                  <div v-if="selectedItem.dueDate" class="space-x-4">
                    <span class="text-muted">截止日期</span>
                    <span>
                      {{ selectedItem.dueDate?.toString().slice(0, 10) }}
                    </span>
                  </div>
                  <div v-if="selectedItem.estimatedHours" class="space-x-4">
                    <span class="text-muted">预估工时</span>
                    <span>
                      {{ selectedItem.estimatedHours }}h
                    </span>
                  </div>
                  <div v-if="selectedItem.type === 'bug' && selectedItem.severity">
                    <span class="text-muted">严重程度</span>
                    <p class="mt-1">
                      {{ severityConfig[selectedItem.severity]?.label || selectedItem.severity }}
                    </p>
                  </div>
                </div>

                <div v-if="selectedItem.description">
                  <span class="text-sm text-muted">描述</span>
                  <MarkdownContent
                    :markdown="selectedItem.description"
                    class="mt-1 h-80 overflow-y-auto bg-elevated/50 rounded-md p-3"
                  />
                </div>
                <!-- 重新指派面板 -->
                <UFormField v-if="showReassign" label="选择新负责人">
                  <USelectMenu
                    v-model="reassignUid"
                    :items="memberOptions"
                    value-key="value"
                    label-key="displayLabel"
                    searchable
                    placeholder="选择成员"
                    class="w-full"
                  >
                    <template #item-label="{ item }">
                      {{ item.label }}
                    </template>
                  </USelectMenu>
                </UFormField>

                <!-- 暂停提示 -->
                <div v-if="workItemReadonlyReason" class="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  {{ workItemReadonlyReason }}
                </div>

                <!-- 待办状态：开始执行 / 重新指派 -->
                <div v-if="isWorkItemEditable && selectedItem.status === 'todo'" class="border-t border-default pt-4">
                  <div v-if="showReassign" class="flex gap-2 justify-end">
                    <UButton
                      label="确认指派"
                      color="primary"
                      size="sm"
                      :loading="transitioning"
                      :disabled="!reassignUid"
                      @click="handleReassign"
                    />
                    <UButton
                      label="取消重新指派"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="showReassign = false"
                    />
                  </div>
                  <div v-else class="flex flex-wrap justify-end gap-2">
                    <UButton
                      v-if="isAssignee"
                      label="开始执行"
                      icon="i-lucide-play"
                      color="primary"
                      size="sm"
                      :loading="transitioning"
                      @click="handleStartExecution"
                    />
                    <UButton
                      v-if="isManager"
                      label="重新指派"
                      icon="i-lucide-user-round-pen"
                      color="primary"
                      variant="soft"
                      size="sm"
                      @click="openReassign"
                    />
                  </div>
                </div>
              </div>
            </template>
          </UModal>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
/* .chapter-md-content 样式已迁移到 app/assets/css/main.css (全局) */
</style>
