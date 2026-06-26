<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('部门')

interface DirectoryDepartment {
  id?: number
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType: string
  deptCategory: string | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  sortOrder?: number
  description?: string | null
  children: DirectoryDepartment[]
}

interface DirectoryDepartmentsResponse {
  tree: DirectoryDepartment[]
  flat: DirectoryDepartment[]
}

interface ApiResponse<T> {
  code: number
  data: T
}

const search = ref('')
const expandedCodes = ref<Set<string>>(new Set())
const toast = useToast()
const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const saving = ref(false)

const form = reactive({
  deptCode: '',
  name: '',
  parentDeptCode: '',
  managerId: '',
  leaderId: '',
  orgType: 'department',
  deptCategory: '',
  description: '',
  sortOrder: 100
})

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryDepartmentsResponse>>('/api/v1/console/directory/departments', {
  default: () => ({ code: 0, data: { tree: [], flat: [] } })
})

const flatDepartments = computed(() => data.value?.data.flat || [])
const treeDepartments = computed(() => data.value?.data.tree || [])

watch(treeDepartments, (nodes) => {
  if (expandedCodes.value.size > 0) return
  const next = new Set<string>()
  const visit = (items: DirectoryDepartment[]) => {
    for (const item of items) {
      if (item.children?.length) next.add(item.deptCode)
      visit(item.children || [])
    }
  }
  visit(nodes)
  expandedCodes.value = next
}, { immediate: true })

function toggle(dept: DirectoryDepartment) {
  const next = new Set(expandedCodes.value)
  if (next.has(dept.deptCode)) next.delete(dept.deptCode)
  else next.add(dept.deptCode)
  expandedCodes.value = next
}

function flattenVisible(nodes: DirectoryDepartment[], level = 0): Array<DirectoryDepartment & { displayLevel: number }> {
  const result: Array<DirectoryDepartment & { displayLevel: number }> = []
  for (const node of nodes) {
    const matched = !search.value || [node.deptCode, node.name, node.manager, node.leader]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(search.value.toLowerCase()))

    const children = flattenVisible(node.children || [], level + 1)
    if (matched || children.length) {
      result.push({ ...node, displayLevel: level })
      if (expandedCodes.value.has(node.deptCode) || search.value) {
        result.push(...children)
      }
    }
  }
  return result
}

const visibleDepartments = computed(() => flattenVisible(treeDepartments.value))
const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

const orgTypeOptions = [
  { label: '部门', value: 'department' },
  { label: '委员会', value: 'committee' },
  { label: '虚拟组织', value: 'virtual' }
]
const deptCategoryOptions = [
  { label: '未分类', value: '' },
  { label: '行政', value: '1' },
  { label: '业务支撑', value: '2' },
  { label: '业务', value: '3' },
  { label: '核心管理', value: '4' }
]
const parentOptions = computed(() => [
  { label: '无父级', value: '' },
  ...flatDepartments.value
    .filter(dept => modalMode.value === 'create' || dept.deptCode !== form.deptCode)
    .map(dept => ({
      label: `${'  '.repeat(Math.max(0, dept.level - 1))}${dept.name}`,
      value: dept.deptCode
    }))
])

const departmentColumns: TableColumn<DirectoryDepartment & { displayLevel: number }>[] = [
  {
    accessorKey: 'name',
    header: '部门',
    cell: ({ row }) => {
      const dept = row.original
      return h('div', { class: 'flex items-center gap-2', style: { paddingLeft: `${dept.displayLevel * 18}px` } }, [
        dept.children?.length
          ? h(UButton, {
              icon: expandedCodes.value.has(dept.deptCode) || search.value ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right',
              color: 'neutral',
              variant: 'ghost',
              size: 'xs',
              onClick: () => toggle(dept)
            })
          : h('span', { class: 'inline-block w-7' }),
        h('div', [
          h('p', { class: 'font-medium text-highlighted' }, dept.name),
          h('p', { class: 'text-xs text-muted' }, dept.deptCode)
        ])
      ])
    }
  },
  {
    accessorKey: 'orgType',
    header: '类型',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'soft' }, () => row.original.orgType)
  },
  {
    accessorKey: 'manager',
    header: '负责人',
    cell: ({ row }) => row.original.manager || row.original.managerId || '-'
  },
  {
    accessorKey: 'leader',
    header: 'Leader',
    cell: ({ row }) => row.original.leader || row.original.leaderId || '-'
  },
  {
    accessorKey: 'parentId',
    header: '父级',
    cell: ({ row }) => row.original.parentId || '-'
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        size: 'sm',
        icon: 'i-lucide-pencil',
        onClick: () => openEditDepartment(row.original)
      }, () => '编辑'),
      h(UButton, {
        color: 'error',
        variant: 'ghost',
        size: 'sm',
        icon: 'i-lucide-trash-2',
        onClick: () => deleteDepartment(row.original)
      }, () => '删除')
    ])
  }
]

function expandAll() {
  expandedCodes.value = new Set(flatDepartments.value.map(dept => dept.deptCode))
}

function collapseAll() {
  expandedCodes.value = new Set()
}

function resetForm() {
  form.deptCode = ''
  form.name = ''
  form.parentDeptCode = ''
  form.managerId = ''
  form.leaderId = ''
  form.orgType = 'department'
  form.deptCategory = ''
  form.description = ''
  form.sortOrder = 100
}

function openCreateDepartment() {
  resetForm()
  modalMode.value = 'create'
  modalOpen.value = true
}

function openEditDepartment(dept: DirectoryDepartment) {
  resetForm()
  modalMode.value = 'edit'
  form.deptCode = dept.deptCode
  form.name = dept.name
  form.parentDeptCode = dept.parentId || ''
  form.managerId = dept.managerId || ''
  form.leaderId = dept.leaderId || ''
  form.orgType = dept.orgType || 'department'
  form.deptCategory = dept.deptCategory || ''
  form.description = dept.description || ''
  form.sortOrder = dept.sortOrder ?? 100
  modalOpen.value = true
}

function departmentPayload() {
  return {
    deptCode: form.deptCode.trim(),
    name: form.name.trim(),
    parentDeptCode: form.parentDeptCode || null,
    managerId: form.managerId.trim() || null,
    leaderId: form.leaderId.trim() || null,
    orgType: form.orgType,
    deptCategory: form.orgType === 'department' ? form.deptCategory || null : null,
    description: form.description.trim() || null,
    sortOrder: form.sortOrder
  }
}

async function submitDepartment() {
  if (!form.deptCode.trim() || !form.name.trim()) {
    toast.add({ title: '部门编码和名称不能为空', color: 'warning' })
    return
  }

  saving.value = true
  try {
    const payload = departmentPayload()
    if (modalMode.value === 'create') {
      await $fetch('/api/v1/console/directory/departments', {
        method: 'POST',
        body: payload
      })
    } else {
      await $fetch(`/api/v1/console/directory/departments/${encodeURIComponent(form.deptCode)}`, {
        method: 'PATCH',
        body: payload
      })
    }
    toast.add({ title: modalMode.value === 'create' ? '部门已创建' : '部门已保存', color: 'success' })
    modalOpen.value = false
    await refresh()
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败'
    toast.add({ title: '保存失败', description: message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function deleteDepartment(dept: DirectoryDepartment) {
  if (!window.confirm(`确认删除部门「${dept.name}」？`)) return

  try {
    await $fetch(`/api/v1/console/directory/departments/${encodeURIComponent(dept.deptCode)}`, {
      method: 'DELETE'
    })
    toast.add({ title: '部门已删除', color: 'success' })
    await refresh()
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败'
    toast.add({ title: '删除失败', description: message, color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="directory-departments" :ui="dashboardPanelUi">
    <!-- <template #header>
      <UDashboardNavbar title="目录部门">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>

        </template>
      </UDashboardNavbar>
    </template> -->

    <template #body>
      <div class="grid gap-3 md:grid-cols-3">
        <UCard>
          <p class="text-xs text-muted">
            部门节点
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ flatDepartments.length }}
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted">
            根节点
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ treeDepartments.length }}
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted">
            当前模式
          </p>
          <p class="mt-1 text-lg font-semibold">
            可维护
          </p>
        </UCard>
      </div>

      <div>
        <div class="flex items-center gap-2 mb-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索部门 / 负责人"
                class="sm:w-72"
              />
              <UButton color="neutral" variant="soft" @click="expandAll">
                全部展开
              </UButton>
              <UButton color="neutral" variant="soft" @click="collapseAll">
                全部收起
              </UButton>
              <UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                :loading="pending"
                @click="refresh()"
              >
                刷新
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-plus"
                @click="openCreateDepartment"
              >
                新建部门
              </UButton>
            </div>
          </div>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          title="加载失败"
          :description="error.message"
          class="mb-3"
        />

        <UTable
          sticky
          :data="visibleDepartments"
          :columns="departmentColumns"
          :loading="pending"
          empty="暂无部门"
          class="flex-1 max-h-[calc(100svh-16rem)]"
        />
      </div>

      <UModal
        v-model:open="modalOpen"
        :title="modalMode === 'create' ? '新建目录部门' : '编辑目录部门'"
        :ui="{ content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="部门编码" required>
              <UInput
                v-model="form.deptCode"
                class="w-full"
                :disabled="modalMode === 'edit'"
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
          </div>
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
            @click="submitDepartment"
          >
            保存
          </UButton>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
