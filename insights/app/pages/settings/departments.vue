<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, onMounted } from 'vue'

const { apiBase } = useApiBase()
const toast = useToast()

const UButton = resolveComponent('UButton')
const USwitch = resolveComponent('USwitch')

interface Department {
  id: number
  name: string
  description?: string
  parentId?: number
  isActive: boolean
  createdAt?: string
}

const departments = ref<Department[]>([])
const loading = ref(false)
const syncing = ref(false)

async function syncFromAccount() {
  syncing.value = true
  try {
    const result = await $fetch<{ success: boolean, message: string, created: number, updated: number }>('/api/sync/departments', { method: 'POST' })
    toast.add({ title: result.message, color: 'success' })
    await loadDepartments()
  } catch (error: any) {
    toast.add({ title: '同步失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    syncing.value = false
  }
}

async function loadDepartments() {
  loading.value = true
  try {
    const result = await $fetch<{ data: Department[] }>(`${apiBase}/departments`)
    departments.value = result.data ?? []
  } catch (error: any) {
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

const modalOpen = ref(false)
const editing = ref<Department | null>(null)
const form = ref({ name: '', description: '', isActive: true })

function openCreate() {
  editing.value = null
  form.value = { name: '', description: '', isActive: true }
  modalOpen.value = true
}

function openEdit(dept: Department) {
  editing.value = dept
  form.value = { name: dept.name, description: dept.description || '', isActive: dept.isActive }
  modalOpen.value = true
}

async function save() {
  try {
    if (editing.value) {
      await ($fetch as any)(`${apiBase}/departments/${editing.value.id}`, { method: 'PATCH', body: form.value })
    } else {
      await ($fetch as any)(`${apiBase}/departments`, { method: 'POST', body: form.value })
    }
    modalOpen.value = false
    toast.add({ title: '保存成功', color: 'success' })
    await loadDepartments()
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error.message, color: 'error' })
  }
}

async function toggleActive(dept: Department, value: boolean) {
  try {
    await ($fetch as any)(`${apiBase}/departments/${dept.id}`, { method: 'PATCH', body: { isActive: value } })
    dept.isActive = value
  } catch (error: any) {
    toast.add({ title: '更新失败', description: error.message, color: 'error' })
  }
}

const columns: TableColumn<Department>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: '部门名称' },
  { accessorKey: 'description', header: '描述', cell: ({ row }) => row.original.description || '-' },
  { accessorKey: 'isActive', header: '启用', cell: ({ row }) => h(USwitch, { 'modelValue': row.original.isActive, 'size': 'xs', 'onUpdate:modelValue': (v: boolean) => toggleActive(row.original, v) }) },
  { id: 'actions', header: '操作', cell: ({ row }) => h(UButton, { icon: 'i-lucide-pencil', size: 'xs', variant: 'ghost', onClick: () => openEdit(row.original) }) }
]

onMounted(() => loadDepartments())
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="部门管理">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-cloud-download"
          label="从Account同步"
          size="sm"
          variant="outline"
          :loading="syncing"
          @click="syncFromAccount"
        />
        <UButton
          icon="i-lucide-plus"
          label="新建部门"
          size="sm"
          @click="openCreate"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadDepartments"
        />
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UCard :ui="{ body: 'p-0' }">
        <UTable
          :columns="columns"
          :data="departments"
          :loading="loading"
        />
        <div
          v-if="!loading && departments.length === 0"
          class="py-10 text-center text-muted-500"
        >
          暂无部门
        </div>
      </UCard>
    </div>

    <UModal
      v-model:open="modalOpen"
      :title="editing ? '编辑部门' : '新建部门'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="部门名称"
            required
          >
            <UInput v-model="form.name" />
          </UFormField>
          <UFormField label="描述">
            <UInput v-model="form.description" />
          </UFormField>
          <UFormField label="启用">
            <USwitch v-model="form.isActive" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="取消"
            variant="ghost"
            @click="modalOpen = false"
          />
          <UButton
            label="保存"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
