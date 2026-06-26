<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, reactive, computed, onMounted } from 'vue'

const { apiBase } = useApiBase()

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const UCheckbox = resolveComponent('UCheckbox')
const toast = useToast()

// --- Interfaces ---
interface EventLevel {
  id: number
  levelName: string
  description?: string | null
  action?: string | null
  reportLevels?: number | null
  notificationMethods?: number | null
  isReplyNeeded?: boolean | null
}

interface EventType {
  id: number
  eventName: string
  description?: string | null
  eventLevelId: number
  eventLevelName?: string | null
  monitoringTable: string
  evalFormula: string
  comparison: string
  monitoringThreshold: string
  messageTemplate?: string | null
  coderOnly?: boolean | null
  isEnabled?: boolean | null
}

// --- State ---
const loading = reactive({ levels: false, types: false, saving: false })
const eventLevels = ref<EventLevel[]>([])
const eventTypes = ref<EventType[]>([])
const isModalOpen = ref(false)
const isEditing = ref(false)
const currentEventTypeId = ref<number | null>(null)

const state = reactive({
  eventName: '',
  description: '',
  eventLevelId: undefined as unknown as number,
  monitoringTable: 'repo_commits',
  evalFormula: '',
  comparison: '>',
  monitoringThreshold: '',
  messageTemplate: '',
  coderOnly: false,
  isEnabled: true
})

const monitoringTables = [
  { label: '提交记录表', value: 'repo_commits' },
  { label: '人员日统计表', value: 'stat_person_daily' },
  { label: '人员月统计表', value: 'stat_person_monthly' },
  { label: '仓库日统计表', value: 'stat_repo_daily' },
  { label: '仓库月统计表', value: 'stat_repo_monthly' }
]

const comparisonOptions = [
  { label: '大于', value: '>' },
  { label: '小于', value: '<' },
  { label: '等于', value: '=' },
  { label: '大于等于', value: '>=' },
  { label: '小于等于', value: '<=' }
]

const thresholdNames = [
  { label: '禁止提交目录数阈值', value: 'monitoring_commit_banned_directories_threshold' },
  { label: '提交异常文件阈值', value: 'monitoring_commit_unexcepted_files_threshold' },
  { label: '提交重复文件阈值', value: 'monitoring_commit_duplicate_files_threshold' },
  { label: '提交代码规模阈值', value: 'monitoring_commit_code_lines_threshold' }
]

function getTableLabel(value: string): string {
  return monitoringTables.find(t => t.value === value)?.label || value
}

function getThresholdName(value: string): string {
  return thresholdNames.find(t => t.value === value)?.label || value
}

const comparisonMap: Record<string, string> = {
  '>': '大于', '<': '小于', '=': '等于', '>=': '大于等于', '<=': '小于等于'
}

const eventLevelColors: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'neutral' }

// --- Data Loading ---
async function loadEventLevels() {
  loading.levels = true
  try {
    const res = await $fetch<{ data: EventLevel[] }>(`${apiBase}/monitoring/event-levels`)
    eventLevels.value = res.data
  } catch (error) {
    toast.add({ title: '加载事件级别失败', color: 'error' })
  } finally {
    loading.levels = false
  }
}

async function loadEventTypes() {
  loading.types = true
  try {
    const res = await $fetch<{ data: EventType[] }>(`${apiBase}/monitoring/event-types`)
    eventTypes.value = res.data
  } catch (error) {
    toast.add({ title: '加载监控规则失败', color: 'error' })
  } finally {
    loading.types = false
  }
}

async function refreshAll() {
  await Promise.all([loadEventLevels(), loadEventTypes()])
}

function openCreateModal() {
  isEditing.value = false
  currentEventTypeId.value = null
  Object.assign(state, {
    eventName: '', description: '', eventLevelId: eventLevels.value[0]?.id,
    monitoringTable: 'repo_commits', evalFormula: '', comparison: '>',
    monitoringThreshold: '', messageTemplate: '', coderOnly: false, isEnabled: true
  })
  isModalOpen.value = true
}

function openEditModal(row: EventType) {
  isEditing.value = true
  currentEventTypeId.value = row.id
  Object.assign(state, {
    eventName: row.eventName, description: row.description || '',
    eventLevelId: row.eventLevelId, monitoringTable: row.monitoringTable,
    evalFormula: row.evalFormula, comparison: row.comparison,
    monitoringThreshold: row.monitoringThreshold, messageTemplate: row.messageTemplate || '',
    coderOnly: !!row.coderOnly, isEnabled: !!row.isEnabled
  })
  isModalOpen.value = true
}

async function onSubmit() {
  loading.saving = true
  try {
    const url = isEditing.value ? `${apiBase}/monitoring/event-types/${currentEventTypeId.value}` : `${apiBase}/monitoring/event-types`
    const method = (isEditing.value ? 'PUT' : 'POST') as any
    await ($fetch as any)(url, { method, body: state })
    toast.add({ title: isEditing.value ? '更新成功' : '创建成功', color: 'success' })
    isModalOpen.value = false
    await loadEventTypes()
  } catch (error: any) {
    toast.add({ title: isEditing.value ? '更新失败' : '创建失败', description: error.message, color: 'error' })
  } finally {
    loading.saving = false
  }
}

async function deleteEventType(id: number) {
  if (!confirm('确定要删除这条规则吗？')) return
  try {
    await ($fetch as any)(`${apiBase}/monitoring/event-types/${id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    await loadEventTypes()
  } catch (error: any) {
    toast.add({ title: '删除失败', description: error.message, color: 'error' })
  }
}

async function toggleEnabled(row: EventType) {
  try {
    await ($fetch as any)(`${apiBase}/monitoring/event-types/${row.id}`, { method: 'PUT', body: { ...row, isEnabled: !row.isEnabled } })
    row.isEnabled = !row.isEnabled
    toast.add({ title: row.isEnabled ? '已启用' : '已禁用', color: 'success' })
  } catch (error) {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

const notificationMethodOptions = [{ mask: 1, label: '站内信' }, { mask: 2, label: '短信' }, { mask: 4, label: '邮件' }]
const reportLevelOptions = [{ mask: 1, label: '本人' }, { mask: 2, label: '部门经理' }, { mask: 4, label: 'HR' }, { mask: 8, label: '分管领导' }, { mask: 16, label: '超级管理员' }]

const toggleNotificationMethod = async (level: EventLevel, mask: number) => {
  const current = level.notificationMethods ?? 0
  const newValue = (current & mask) ? (current & ~mask) : (current | mask)
  try {
    await ($fetch as any)(`${apiBase}/monitoring/event-levels/${level.id}`, { method: 'PUT', body: { notificationMethods: newValue } })
    level.notificationMethods = newValue
  } catch (error) {
    toast.add({ title: '更新失败', color: 'error' })
  }
}

const toggleReportLevel = async (level: EventLevel, mask: number) => {
  const current = level.reportLevels ?? 0
  const newValue = (current & mask) ? (current & ~mask) : (current | mask)
  try {
    await ($fetch as any)(`${apiBase}/monitoring/event-levels/${level.id}`, { method: 'PUT', body: { reportLevels: newValue } })
    level.reportLevels = newValue
  } catch (error) {
    toast.add({ title: '更新失败', color: 'error' })
  }
}

const eventLevelColumns: TableColumn<EventLevel>[] = [
  { accessorKey: 'id', header: '级别', cell: ({ row }) => h(UBadge, { color: eventLevelColors[row.original.id] }, row.original.levelName || '未知') },
  { accessorKey: 'description', header: '说明' },
  {
    id: 'notificationMethods', header: '通知方式', cell: ({ row }) => h('div', { class: 'flex flex-wrap gap-2' },
      notificationMethodOptions.map(opt => h(UCheckbox, { 'key': opt.mask, 'label': opt.label, 'modelValue': Boolean((row.original.notificationMethods ?? 0) & opt.mask), 'onUpdate:modelValue': () => toggleNotificationMethod(row.original, opt.mask) }))
    )
  },
  {
    id: 'reportLevels', header: '通知对象', cell: ({ row }) => h('div', { class: 'flex flex-wrap gap-2' },
      reportLevelOptions.map(opt => h(UCheckbox, { 'key': opt.mask, 'label': opt.label, 'modelValue': Boolean((row.original.reportLevels ?? 0) & opt.mask), 'onUpdate:modelValue': () => toggleReportLevel(row.original, opt.mask) }))
    )
  }
]

const eventTypeColumns: TableColumn<EventType>[] = [
  { accessorKey: 'eventName', header: '事件名称' },
  { accessorKey: 'eventLevelId', header: '级别', cell: ({ row }) => h(UBadge, { color: eventLevelColors[row.original.eventLevelId] }, row.original.eventLevelName || '未知') },
  { accessorKey: 'monitoringTable', header: '数据表', cell: ({ row }) => getTableLabel(row.original.monitoringTable) },
  { accessorKey: 'evalFormula', header: '计算公式', cell: ({ row }) => h('div', { class: 'w-60 truncate' }, row.original.evalFormula || '—') },
  { accessorKey: 'comparison', header: '比较', cell: ({ row }) => comparisonMap[row.original.comparison] || row.original.comparison },
  { accessorKey: 'monitoringThreshold', header: '阈值键', cell: ({ row }) => getThresholdName(row.original.monitoringThreshold) },
  { accessorKey: 'coderOnly', header: '仅程序员', cell: ({ row }) => row.original.coderOnly ? '是' : '否' },
  {
    accessorKey: 'isEnabled', header: '启用', cell: ({ row }) => h('div', { class: 'flex items-center' }, [
      h('span', { class: ['inline-block w-2 h-2 rounded-full mr-2', row.original.isEnabled ? 'bg-green-500' : 'bg-gray-300'] }),
      row.original.isEnabled ? '启用' : '禁用'
    ])
  },
  {
    accessorKey: 'actions', header: '操作', cell: ({ row }) => h('div', { class: 'flex items-center' }, [
      h(UButton, { label: '编辑', icon: 'i-lucide-pencil', size: 'xs', color: 'neutral', variant: 'ghost', onClick: () => openEditModal(row.original) })
    ])
  }
]

const sanitizedEventLevels = computed(() => eventLevels.value.map(l => ({ ...l, description: l.description || undefined })))

onMounted(() => { refreshAll() })
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="异动监控规则管理">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-plus"
          label="新建规则"
          size="sm"
          color="primary"
          @click="openCreateModal"
        />
        <UButton
          icon="i-lucide-rotate-ccw"
          label="刷新"
          size="sm"
          color="neutral"
          variant="ghost"
          :loading="loading.levels || loading.types"
          @click="refreshAll"
        />
      </template>
    </UDashboardNavbar>

    <div class="space-y-4 px-4 py-2">
      <UCard :ui="{ header: 'py-3' }">
        <template #header>
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">
            监控规则列表
          </h3>
        </template>
        <UTable
          :columns="eventTypeColumns"
          :data="eventTypes"
          :loading="loading.types"
        >
          <template #actions-data="{ row }">
            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-pencil"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="openEditModal(row.original)"
              />
              <UButton
                :icon="row.original.isEnabled ? 'i-lucide-pause-circle' : 'i-lucide-play-circle'"
                size="xs"
                :color="row.original.isEnabled ? 'primary' : 'success'"
                variant="ghost"
                @click="toggleEnabled(row.original)"
              />
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="deleteEventType(row.original.id)"
              />
            </div>
          </template>
        </UTable>
      </UCard>

      <UCard :ui="{ header: 'py-3' }">
        <template #header>
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">
            事件级别定义
          </h3>
        </template>
        <UTable
          :columns="eventLevelColumns"
          :data="eventLevels"
          :loading="loading.levels"
        />
      </UCard>
    </div>

    <UModal
      v-model:open="isModalOpen"
      :title="isEditing ? '编辑事件触发规则' : '新建事件触发规则'"
      :ui="{ content: 'sm:max-w-4xl', footer: 'justify-end' }"
    >
      <template #body>
        <UCard :ui="{ header: 'py-3' }">
          <div class="grid grid-cols-6 gap-4 p-2">
            <UFormField
              label="事件名称"
              name="eventName"
              required
              class="col-span-2"
            >
              <UInput
                v-model="state.eventName"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="描述"
              name="description"
              class="col-span-4"
            >
              <UInput
                v-model="state.description"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="事件级别"
              name="eventLevelId"
              required
              class="col-span-3"
            >
              <USelectMenu
                v-model="state.eventLevelId"
                :items="sanitizedEventLevels"
                label-key="levelName"
                value-key="id"
                placeholder="选择级别"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="监控数据表"
              name="monitoringTable"
              required
              class="col-span-3"
            >
              <USelectMenu
                v-model="state.monitoringTable"
                :items="monitoringTables"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="计算值"
              name="evalFormula"
              required
              class="col-span-3"
            >
              <UTextarea
                v-model="state.evalFormula"
                :rows="2"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="比较符"
              name="comparison"
              required
              class="col-span-1"
            >
              <USelectMenu
                v-model="state.comparison"
                :items="comparisonOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="阈值参数键"
              name="monitoringThreshold"
              required
              class="col-span-2"
            >
              <USelectMenu
                v-model="state.monitoringThreshold"
                :items="thresholdNames"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="消息模板"
              name="messageTemplate"
              class="col-span-3"
            >
              <UTextarea
                v-model="state.messageTemplate"
                :rows="2"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="启用状态"
              name="isEnabled"
              class="col-span-1"
            >
              <USwitch v-model="state.isEnabled" />
            </UFormField>
            <UFormField
              label="仅针对程序员"
              name="coderOnly"
              class="col-span-1"
            >
              <USwitch v-model="state.coderOnly" />
            </UFormField>
          </div>
        </UCard>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="isModalOpen = false"
          />
          <UButton
            type="submit"
            :label="isEditing ? '保存' : '创建'"
            :loading="loading.saving"
            color="primary"
            @click="onSubmit"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
