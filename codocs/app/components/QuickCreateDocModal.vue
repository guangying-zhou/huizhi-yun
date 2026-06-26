<script setup lang="ts">
/**
 * 快捷文档创建模态窗口
 * Ctrl+K / ⌘+K 全局唤起，快速选择类型并创建文档
 */

import type { ComponentPublicInstance } from 'vue'

const {
  isOpen,
  departments,
  departmentsLoading,
  git_projects,
  projectsLoading,
  privateFolders,
  privateFoldersLoading,
  isCreating,
  loadDepartments,
  loadProjects,
  loadPrivateFolders,
  createDocument
} = useQuickCreateDoc()

type DocType = 'private' | 'project' | 'department' | 'worklog' | 'weekly'

// Step 状态
const step = ref<'type' | 'form'>('type')
const selectedType = ref<DocType | null>(null)
const docTitle = ref('')
const selectedProjectCode = ref('')
const selectedDeptCode = ref('')
const selectedFolderId = ref<number | null>(null)
const folderPickerOpen = ref(false)
const expandedFolderIds = ref<Set<number>>(new Set())

const isMac = ref(true)

// 表单元素引用
const titleInputRef = ref<ComponentPublicInstance | null>(null)
const projectSelectRef = ref<ComponentPublicInstance | null>(null)
const deptSelectRef = ref<ComponentPublicInstance | null>(null)

// 类型选项卡片
const typeOptions = [
  {
    type: 'private' as DocType,
    label: '个人文档',
    icon: 'i-lucide-file-text',
    description: '仅自己可见的私人文档',
    color: 'text-blue-500'
  },
  {
    type: 'project' as DocType,
    label: '项目文档',
    icon: 'i-lucide-folder-git-2',
    description: '归属于项目组的共享文档',
    color: 'text-emerald-500'
  },
  {
    type: 'department' as DocType,
    label: '部门协同',
    icon: 'i-lucide-building',
    description: '部门内协同编辑的文档',
    color: 'text-amber-500'
  },
  {
    type: 'worklog' as DocType,
    label: '工作日志',
    icon: 'i-lucide-calendar-days',
    description: '自动创建今日的工作日志',
    color: 'text-indigo-500'
  },
  {
    type: 'weekly' as DocType,
    label: '工作周报',
    icon: 'i-lucide-calendar-check-2',
    description: '自动创建本周的工作周报',
    color: 'text-purple-500'
  }
]

// 选择类型
const selectType = async (type: DocType) => {
  selectedType.value = type
  selectedProjectCode.value = ''
  selectedDeptCode.value = ''
  selectedFolderId.value = null
  folderPickerOpen.value = false

  // 工作日志和周报直接创建（无需填标题，不需要第二步）
  if (type === 'worklog' || type === 'weekly') {
    await createDocument({ docType: type })
    return
  }

  if (type === 'project') {
    await loadProjects()
  } else if (type === 'private') {
    await loadPrivateFolders()
    expandedFolderIds.value = new Set(privateFolders.value.map(folder => folder.id))
  } else if (type === 'department') {
    await loadDepartments()
    // 如果只有一个部门，自动选中
    if (departments.value.length === 1 && departments.value[0]) {
      selectedDeptCode.value = departments.value[0].deptCode
    }
  }

  step.value = 'form'
  await nextTick()

  // 确保 DOM 和过渡动画完成
  setTimeout(() => {
    if (type === 'project') {
      const el = projectSelectRef.value?.$el || projectSelectRef.value
      // USelectMenu usually uses a trigger button or input
      const target = typeof el?.focus === 'function' ? el : el?.querySelector?.('button, input')
      target?.focus()
    } else if (type === 'department' && departments.value.length > 1) {
      const el = deptSelectRef.value?.$el || deptSelectRef.value
      const target = typeof el?.focus === 'function' ? el : el?.querySelector?.('button, input')
      target?.focus()
    } else {
      const el = titleInputRef.value?.$el || titleInputRef.value
      const target = typeof el?.focus === 'function' ? el : el?.querySelector?.('input')
      target?.focus()
    }
  }, 50)
}

// 提交创建
const handleCreate = async () => {
  if (!selectedType.value || !docTitle.value.trim()) return

  if (selectedType.value === 'project' && !selectedProjectCode.value) {
    const toast = useToast()
    toast.add({ title: '请选择项目组', color: 'warning' })
    return
  }
  if (selectedType.value === 'department' && !selectedDeptCode.value) {
    const toast = useToast()
    toast.add({ title: '请选择部门', color: 'warning' })
    return
  }

  await createDocument({
    title: docTitle.value,
    docType: selectedType.value,
    projectCode: selectedProjectCode.value || undefined,
    deptCode: selectedDeptCode.value || undefined,
    folderId: selectedType.value === 'private' ? selectedFolderId.value : undefined
  })
}

// 返回类型选择
const goBack = () => {
  step.value = 'type'
  docTitle.value = ''
}

// 重置状态
const resetState = () => {
  step.value = 'type'
  selectedType.value = null
  docTitle.value = ''
  selectedProjectCode.value = ''
  selectedDeptCode.value = ''
  selectedFolderId.value = null
  folderPickerOpen.value = false
  expandedFolderIds.value = new Set()
}

// 监听打开状态，打开时重置
onMounted(() => {
  isMac.value = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
})

watch(isOpen, (open) => {
  if (open) {
    resetState()
  }
})

// 计算项目下拉选项
const projectItems = computed(() =>
  git_projects.value.map(p => ({
    label: p.name,
    value: p.projectCode
  }))
)

// 计算部门下拉选项
const departmentItems = computed(() =>
  departments.value.map(d => ({
    label: d.name,
    value: d.deptCode
  }))
)

// 选中的部门名称
const selectedDeptLabel = computed(() => {
  const d = departments.value.find(d => d.deptCode === selectedDeptCode.value)
  return d?.name || ''
})

interface TreeFolder {
  id: number
  name: string
  parent_id: number | null
  children: TreeFolder[]
}

const buildFolderTree = (parentId: number | null): TreeFolder[] => {
  return privateFolders.value
    .filter(folder => folder.parent_id === parentId)
    .map(folder => ({
      ...folder,
      children: buildFolderTree(folder.id)
    }))
}

const folderTree = computed(() => buildFolderTree(null))

const folderPathMap = computed(() => {
  const folderMap = new Map(privateFolders.value.map(folder => [folder.id, folder]))
  const pathMap = new Map<number, string>()

  const getPath = (folderId: number): string => {
    const cached = pathMap.get(folderId)
    if (cached) return cached

    const folder = folderMap.get(folderId)
    if (!folder) return '我的文档'

    const parentPath = folder.parent_id ? getPath(folder.parent_id) : '我的文档'
    const path = `${parentPath} / ${folder.name}`
    pathMap.set(folderId, path)
    return path
  }

  privateFolders.value.forEach((folder) => {
    getPath(folder.id)
  })

  return pathMap
})

const selectedFolderLabel = computed(() => {
  if (selectedFolderId.value === null) return '我的文档'
  return folderPathMap.value.get(selectedFolderId.value) || '我的文档'
})

const toggleFolderExpand = (folderId: number) => {
  const next = new Set(expandedFolderIds.value)
  if (next.has(folderId)) {
    next.delete(folderId)
  } else {
    next.add(folderId)
  }
  expandedFolderIds.value = next
}

const chooseFolder = (folderId: number | null) => {
  selectedFolderId.value = folderId
  folderPickerOpen.value = false
}

// 当前类型名称
const currentTypeLabel = computed(() => {
  return typeOptions.find(t => t.type === selectedType.value)?.label || ''
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{
      content: 'sm:max-w-md'
    }"
  >
    <!-- 不需要触发器 -->
    <template #content>
      <div class="p-5">
        <!-- Header -->
        <div class="flex items-center gap-2 mb-4">
          <UButton
            v-if="step === 'form'"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            @click="goBack"
          />
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-zap" class="size-5 text-primary" />
            <h3 class="text-base font-semibold text-default">
              {{ step === 'type' ? '快捷创建文档' : `新建${currentTypeLabel}` }}
            </h3>
          </div>
          <div class="ml-auto flex items-center gap-3">
            <div class="flex items-center gap-0.5 opacity-80">
              <UKbd :value="isMac ? 'meta' : 'ctrl'" size="sm" />
              <span class="text-xs font-medium opacity-50">+</span>
              <UKbd value="K" size="sm" />
            </div>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              @click="isOpen = false"
            />
          </div>
        </div>

        <!-- Step 1: 选择文档类型 -->
        <div v-if="step === 'type'" class="space-y-2">
          <button
            v-for="opt in typeOptions"
            :key="opt.type"
            class="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-default hover:border-primary hover:bg-elevated/50 transition-all duration-150 group text-left cursor-pointer"
            @click="selectType(opt.type)"
          >
            <div
              class="flex items-center justify-center w-10 h-10 rounded-lg bg-elevated"
            >
              <UIcon :name="opt.icon" :class="['size-5', opt.color]" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-default group-hover:text-primary transition-colors">
                {{ opt.label }}
              </div>
              <div class="text-xs text-muted mt-0.5">
                {{ opt.description }}
              </div>
            </div>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 text-dimmed group-hover:text-primary transition-colors"
            />
          </button>
        </div>

        <!-- Step 2: 填写表单 -->
        <div v-else-if="step === 'form'" class="space-y-4">
          <!-- 个人目录选择 -->
          <div v-if="selectedType === 'private'">
            <label class="text-xs font-medium text-muted mb-1.5 block">存放目录</label>
            <UPopover
              v-model:open="folderPickerOpen"
              :content="{ align: 'start', sideOffset: 8 }"
              :ui="{ content: 'w-[24rem] p-0' }"
            >
              <UButton
                color="neutral"
                variant="outline"
                class="w-full justify-between"
                :label="selectedFolderLabel"
                trailing-icon="i-lucide-chevron-down"
              />

              <template #content>
                <div class="p-2">
                  <div class="px-3 py-2 border-b border-default">
                    <div class="text-sm font-medium text-default">
                      选择目录
                    </div>
                    <div class="text-xs text-muted mt-0.5">
                      默认放到我的文档根目录
                    </div>
                  </div>

                  <div v-if="privateFoldersLoading" class="px-3 py-6 flex items-center justify-center">
                    <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-muted" />
                  </div>

                  <div v-else class="max-h-72 overflow-y-auto py-2">
                    <button
                      class="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors text-left mx-2"
                      :class="selectedFolderId === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-elevated text-default'"
                      @click="chooseFolder(null)"
                    >
                      <UIcon name="i-lucide-house" class="size-4 shrink-0" />
                      <span class="text-sm truncate">我的文档</span>
                    </button>

                    <MoveFolderTreeNode
                      v-for="folder in folderTree"
                      :key="folder.id"
                      :folder="folder"
                      :level="1"
                      :selected-id="selectedFolderId"
                      :expanded-ids="expandedFolderIds"
                      :disabled-id="-1"
                      @select="chooseFolder"
                      @toggle="toggleFolderExpand"
                    />
                  </div>
                </div>
              </template>
            </UPopover>
          </div>

          <!-- 项目选择 -->
          <div v-if="selectedType === 'project'">
            <label class="text-xs font-medium text-muted mb-1.5 block">选择项目组</label>
            <USelectMenu
              ref="projectSelectRef"
              v-model="selectedProjectCode"
              :items="projectItems"
              value-key="value"
              :loading="projectsLoading"
              placeholder="选择项目组…"
              class="w-full"
              autofocus
            />
          </div>

          <!-- 部门选择(多个部门时显示) -->
          <div v-if="selectedType === 'department' && departments.length > 1">
            <label class="text-xs font-medium text-muted mb-1.5 block">选择部门</label>
            <USelectMenu
              ref="deptSelectRef"
              v-model="selectedDeptCode"
              :items="departmentItems"
              value-key="value"
              :loading="departmentsLoading"
              placeholder="选择部门…"
              class="w-full"
              autofocus
            />
          </div>

          <!-- 单部门提示 -->
          <div
            v-if="selectedType === 'department' && departments.length === 1"
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated text-sm"
          >
            <UIcon name="i-lucide-building" class="size-4 text-amber-500" />
            <span class="text-muted">部门：</span>
            <span class="text-default font-medium">{{ selectedDeptLabel }}</span>
          </div>

          <!-- 文档标题 -->
          <div>
            <label class="text-xs font-medium text-muted mb-1.5 block">文档标题</label>
            <UInput
              ref="titleInputRef"
              v-model="docTitle"
              placeholder="输入文档标题…"
              size="lg"
              :autofocus="selectedType !== 'project' && !(selectedType === 'department' && departments.length > 1)"
              :ui="{ root: 'w-full' }"
              @keyup.enter="handleCreate"
            />
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-end gap-2 pt-1">
            <UButton
              color="neutral"
              variant="outline"
              @click="isOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              :loading="isCreating"
              :disabled="!docTitle.trim() || (selectedType === 'project' && !selectedProjectCode) || (selectedType === 'department' && !selectedDeptCode)"
              @click="handleCreate"
            >
              创建文档
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
