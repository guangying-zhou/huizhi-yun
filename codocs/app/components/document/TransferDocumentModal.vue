<script setup lang="ts">
import type { FetchError } from 'ofetch'
import type { Project, UserProjects, ApiResponse } from '~/types/account'

interface DeptNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DeptNode[]
}

interface UserDepartmentsResponse {
  code: number
  data?: {
    departments: DeptNode[]
    primaryDeptCode: string | null
  }
}

type TargetType = 'department' | 'project'

const props = defineProps<{
  open: boolean
  docId: string
  docTitle: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submitted'): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { user } = useAuth()
const toast = useToast()
const apiFetch = useRequestFetch()

const targetType = ref<TargetType>('department')

// ---------- 部门状态 ----------
const loadingDepartments = ref(false)
const departments = ref<DeptNode[]>([])
const primaryDeptCode = ref<string | null>(null)
const selectedDeptCode = ref('')

const departmentOptions = computed(() => {
  const items: Array<{ label: string, value: string, icon: string }> = []
  const visit = (nodes: DeptNode[]) => {
    for (const node of nodes) {
      if (node.children?.length) {
        visit(node.children)
        continue
      }
      items.push({
        label: node.name,
        value: node.deptCode,
        icon: node.orgType === 'committee' ? 'i-lucide-users' : 'i-lucide-building-2'
      })
    }
  }
  visit(departments.value)
  return items
})

const singleDepartment = computed(() => {
  return departmentOptions.value.length === 1 ? departmentOptions.value[0] : null
})

const selectedDepartment = computed(() => {
  const targetCode = singleDepartment.value?.value || selectedDeptCode.value
  return departmentOptions.value.find(item => item.value === targetCode) || null
})

// ---------- 项目组状态 ----------
const loadingProjects = ref(false)
const projectTree = ref<Project[]>([])
const selectedProjectCode = ref('')
const projectPopoverOpen = ref(false)

const flatProjectMap = computed(() => {
  const map = new Map<string, Project>()
  const visit = (nodes: Project[] | undefined) => {
    if (!nodes?.length) return
    for (const node of nodes) {
      map.set(node.projectCode, node)
      visit(node.subProjects)
    }
  }
  visit(projectTree.value)
  return map
})

const selectedProject = computed(() => {
  return selectedProjectCode.value
    ? flatProjectMap.value.get(selectedProjectCode.value) || null
    : null
})

const projectButtonLabel = computed(() => {
  return selectedProject.value?.name || '请选择项目组'
})

// ---------- 通用 ----------
const loading = computed(() => loadingDepartments.value || loadingProjects.value)
const submitting = ref(false)

const confirmDescription = computed(() => {
  if (targetType.value === 'department') {
    const label = selectedDepartment.value?.label
    if (!label) return '请选择要接收该文档的部门或委员会。'
    return `该文档将移交给你所在的${label}，部门经理接收后该文档将移至部门文档。`
  }
  const name = selectedProject.value?.name
  if (!name) return '请选择要移交到的项目组。'
  return `该文档将直接移至项目组《${name}》下，所有项目成员均可访问。`
})

const canSubmit = computed(() => {
  if (!props.docId) return false
  if (targetType.value === 'department') return Boolean(selectedDepartment.value)
  return Boolean(selectedProject.value)
})

const resetState = () => {
  departments.value = []
  primaryDeptCode.value = null
  selectedDeptCode.value = ''
  projectTree.value = []
  selectedProjectCode.value = ''
  projectPopoverOpen.value = false
  targetType.value = 'department'
}

const loadDepartments = async () => {
  const uid = String(user.value || '').trim()
  if (!uid) return

  loadingDepartments.value = true
  try {
    const res = await apiFetch<UserDepartmentsResponse>('/api/account/user-departments', {
      params: { uid }
    })
    departments.value = res.data?.departments || []
    primaryDeptCode.value = res.data?.primaryDeptCode || null

    if (singleDepartment.value) {
      selectedDeptCode.value = singleDepartment.value.value
      return
    }
    if (primaryDeptCode.value && departmentOptions.value.some(item => item.value === primaryDeptCode.value)) {
      selectedDeptCode.value = primaryDeptCode.value
      return
    }
    selectedDeptCode.value = departmentOptions.value[0]?.value || ''
  } catch (error) {
    console.error('[TransferDocumentModal] Failed to load departments:', error)
    toast.add({ title: '无法加载可移交部门', color: 'error' })
  } finally {
    loadingDepartments.value = false
  }
}

const loadProjects = async () => {
  const uid = String(user.value || '').trim()
  if (!uid) return
  if (projectTree.value.length > 0) return

  loadingProjects.value = true
  try {
    const res = await apiFetch<ApiResponse<UserProjects>>(`/api/account/users/${encodeURIComponent(uid)}/projects`)
    const managed = res?.data?.managed || []
    const joined = res?.data?.joined || []

    // 按 projectCode 去重合并
    const byCode = new Map<string, Project>()
    for (const project of [...managed, ...joined]) {
      if (!byCode.has(project.projectCode)) byCode.set(project.projectCode, project)
    }
    projectTree.value = Array.from(byCode.values())
  } catch (error) {
    console.error('[TransferDocumentModal] Failed to load projects:', error)
    toast.add({ title: '无法加载项目组列表', color: 'error' })
  } finally {
    loadingProjects.value = false
  }
}

const handleSelectProject = (projectCode: string) => {
  selectedProjectCode.value = projectCode
  projectPopoverOpen.value = false
}

const submitDepartmentTransfer = async () => {
  if (!selectedDepartment.value) return
  await $fetch(`/api/documents/${props.docId}/dept-shares`, {
    method: 'POST',
    body: {
      deptCode: selectedDepartment.value.value,
      departmentName: selectedDepartment.value.label
    }
  })
  toast.add({
    title: '已发起移交',
    description: '等待部门经理确认接收',
    color: 'success'
  })
}

const submitProjectTransfer = async () => {
  const project = selectedProject.value
  if (!project) return
  await $fetch(`/api/documents/${props.docId}/project-transfer`, {
    method: 'POST',
    body: {
      projectCode: project.projectCode,
      projectName: project.name
    }
  })
  toast.add({
    title: '已移交至项目组',
    description: `文档已移至《${project.name}》`,
    color: 'success'
  })
}

const submitTransfer = async () => {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    if (targetType.value === 'department') {
      await submitDepartmentTransfer()
    } else {
      await submitProjectTransfer()
    }
    emit('submitted')
    isOpen.value = false
  } catch (error: unknown) {
    const fetchErr = error as FetchError<{ message?: string }>
    toast.add({
      title: '移交失败',
      description: fetchErr.data?.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}

watch(targetType, (value) => {
  if (value === 'project') loadProjects()
})

watch(isOpen, (value) => {
  if (value) {
    loadDepartments()
    return
  }
  resetState()
})
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'w-120' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-folder-up" class="size-5" />
            <h3 class="text-lg font-semibold">
              移交文档：{{ props.docTitle || '未命名文档' }}
            </h3>
          </div>
        </template>

        <div class="space-y-4">
          <!-- 目标类型切换 -->
          <URadioGroup
            v-model="targetType"
            :items="[
              { label: '部门', value: 'department' },
              { label: '项目组', value: 'project' }
            ]"
            orientation="horizontal"
          />

          <UAlert
            v-if="targetType === 'department'"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="移交后原私人副本将被转移"
            description="文档接收后会迁入部门文档，原所有人不再保留私人副本。"
          />

          <UAlert
            v-else
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="移交后文档归属项目组"
            description="文档将直接移至所选项目组，项目成员均可访问并协作编辑。"
          />

          <!-- 部门模式 -->
          <template v-if="targetType === 'department'">
            <div v-if="loadingDepartments" class="py-8 text-center text-sm text-muted">
              正在加载部门信息...
            </div>

            <template v-else>
              <UFormField
                v-if="departmentOptions.length > 1"
                label="选择接收部门/委员会"
              >
                <USelectMenu
                  v-model="selectedDeptCode"
                  :items="departmentOptions"
                  value-key="value"
                  placeholder="请选择部门或委员会"
                  class="w-full"
                />
              </UFormField>

              <div
                v-else-if="singleDepartment"
                class="rounded-lg border border-default bg-elevated px-4 py-3 text-sm text-default"
              >
                {{ confirmDescription }}
              </div>

              <UAlert
                v-if="departmentOptions.length > 1 && selectedDepartment"
                color="info"
                icon="i-lucide-info"
                title="确认提示"
                :description="confirmDescription"
              />

              <div
                v-if="departmentOptions.length === 0"
                class="rounded-lg border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
              >
                当前账号未关联可移交的部门或委员会。
              </div>
            </template>
          </template>

          <!-- 项目组模式 -->
          <template v-else>
            <div v-if="loadingProjects" class="py-8 text-center text-sm text-muted">
              正在加载项目组...
            </div>

            <template v-else>
              <UFormField label="选择接收项目组">
                <UPopover v-model:open="projectPopoverOpen" :content="{ side: 'bottom', align: 'start' }">
                  <UButton
                    color="neutral"
                    variant="outline"
                    class="w-full justify-between"
                    :disabled="projectTree.length === 0"
                    trailing-icon="i-lucide-chevron-down"
                  >
                    <span class="flex items-center gap-2 truncate">
                      <UIcon name="i-lucide-folder-tree" class="w-4 h-4 text-primary" />
                      <span class="truncate">{{ projectButtonLabel }}</span>
                    </span>
                  </UButton>

                  <template #content>
                    <div class="w-80 max-h-80 overflow-auto p-1">
                      <ProjectTreeSelector
                        v-for="node in projectTree"
                        :key="node.projectCode"
                        :node="node"
                        :selected-project-code="selectedProjectCode"
                        @select="handleSelectProject"
                      />
                    </div>
                  </template>
                </UPopover>
              </UFormField>

              <UAlert
                v-if="selectedProject"
                color="info"
                icon="i-lucide-info"
                title="确认提示"
                :description="confirmDescription"
              />

              <div
                v-if="projectTree.length === 0"
                class="rounded-lg border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
              >
                当前账号未加入任何项目组。
              </div>
            </template>
          </template>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              @click="isOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              :disabled="!canSubmit || loading"
              :loading="submitting"
              @click="submitTransfer"
            >
              确认移交
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
