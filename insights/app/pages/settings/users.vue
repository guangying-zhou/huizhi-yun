<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, onMounted, computed } from 'vue'

const { apiBase } = useApiBase()
const toast = useToast()

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

interface SystemUser {
  id: number
  username: string
  email?: string
  realName?: string
  role: number
  status: number // 0=Disabled, 1=Active, 2=Verifying
  lastLoginAt?: string
  createdAt?: string
}

const users = ref<SystemUser[]>([])
const loading = ref(false)

// Role bitmask definitions
const ROLE_BITS = {
  dept_manager: 2, // 部门经理
  hr: 4, // HR
  supervisor: 8, // 分管领导
  ceo: 16, // 总经理
  admin: 32 // 管理员
} as const

const roleLabels: Record<string, string> = {
  dept_manager: '部门经理',
  hr: 'HR',
  supervisor: '分管领导',
  ceo: '总经理',
  admin: '管理员'
}

const roleColors: Record<string, string> = {
  dept_manager: 'success',
  hr: 'info',
  supervisor: 'warning',
  ceo: 'primary',
  admin: 'danger'
}

// Status definitions
const STATUS_LABELS = {
  0: '禁用',
  1: '已激活',
  2: '待验证'
}

const STATUS_COLORS = {
  0: 'neutral',
  1: 'success',
  2: 'warning'
}

// Convert bitmask to array of role keys
function bitmaskToRoles(bitmask: number): string[] {
  const roles: string[] = []
  for (const [key, value] of Object.entries(ROLE_BITS)) {
    if (bitmask & value) {
      roles.push(key)
    }
  }
  return roles
}

// Convert array of role keys to bitmask
function rolesToBitmask(roles: string[]): number {
  let bitmask = 0
  for (const role of roles) {
    if (role in ROLE_BITS) {
      bitmask |= ROLE_BITS[role as keyof typeof ROLE_BITS]
    }
  }
  return bitmask
}

async function loadUsers() {
  loading.value = true
  try {
    const result = await $fetch<{ data: SystemUser[] }>(`${apiBase}/settings/users`)
    users.value = result.data ?? []
  } catch (error: any) {
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

const modalOpen = ref(false)
const editing = ref<SystemUser | null>(null)
const form = ref({ username: '', email: '', realName: '', roles: ['dept_manager'] as string[], status: 1 })

const roleOptions = [
  { label: '部门经理', value: 'dept_manager' },
  { label: 'HR', value: 'hr' },
  { label: '分管领导', value: 'supervisor' }
]

const statusOptions = [
  { label: '激活', value: 1 },
  { label: '禁用', value: 0 },
  { label: '待验证', value: 2 }
]

function openCreate() {
  editing.value = null
  form.value = { username: '', email: '', realName: '', roles: ['dept_manager'], status: 1 }
  modalOpen.value = true
}

function openEdit(user: SystemUser) {
  editing.value = user
  form.value = {
    username: user.username,
    email: user.email || '',
    realName: user.realName || '',
    roles: bitmaskToRoles(user.role),
    status: user.status
  }
  modalOpen.value = true
}

async function save() {
  try {
    const payload = {
      username: form.value.username,
      email: form.value.email,
      realName: form.value.realName,
      role: rolesToBitmask(form.value.roles),
      status: form.value.status
    }
    if (editing.value) {
      await ($fetch as any)(`${apiBase}/settings/users/${editing.value.id}`, { method: 'PUT', body: payload })
    } else {
      await ($fetch as any)(`${apiBase}/settings/users`, { method: 'POST', body: payload })
    }
    modalOpen.value = false
    toast.add({ title: '保存成功', color: 'success' })
    await loadUsers()
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error.message, color: 'error' })
  }
}

const formatDate = (dateStr?: string | null) => dateStr ? dateStr.replace('T', ' ').substring(0, 16) : '-'

// Render multiple role badges
function renderRoleBadges(roleBitmask: number) {
  const roles = bitmaskToRoles(roleBitmask)
  if (roles.length === 0) return '-'
  return h('div', { class: 'flex flex-wrap gap-1' },
    roles.map(role => h(UBadge, {
      color: roleColors[role] || 'neutral',
      variant: 'soft'
    }, () => roleLabels[role] || role))
  )
}

const columns: TableColumn<SystemUser>[] = [
  // { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'email', header: '登录账号', cell: ({ row }) => row.original.email || '-' },
  { accessorKey: 'username', header: '姓名' },
  { accessorKey: 'role', header: '角色', cell: ({ row }) => renderRoleBadges(row.original.role) },
  { accessorKey: 'status', header: '状态', cell: ({ row }) => h(UBadge, { color: STATUS_COLORS[row.original.status as keyof typeof STATUS_COLORS] || 'neutral', variant: 'soft' }, () => STATUS_LABELS[row.original.status as keyof typeof STATUS_LABELS] || '未知') },
  { accessorKey: 'lastLoginAt', header: '最后登录', cell: ({ row }) => formatDate(row.original.lastLoginAt) },
  { id: 'actions', header: '操作', cell: ({ row }) => h(UButton, { icon: 'i-lucide-pencil', variant: 'ghost', onClick: () => openEdit(row.original) }) }
]

onMounted(() => loadUsers())
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="用户管理">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-plus"
          label="新建用户"
          size="sm"
          @click="openCreate"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadUsers"
        />
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UCard :ui="{ body: 'p-0' }">
        <UTable
          :columns="columns"
          :data="users"
          :loading="loading"
        />
        <!-- <div v-if="!loading && users.length === 0" class="py-10 text-center text-muted-500">暂无用户</div> -->
      </UCard>
    </div>

    <UModal
      v-model:open="modalOpen"
      :title="editing ? '编辑用户' : '新建用户'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="登录账号"
            required
          >
            <UInput
              v-model="form.email"
              type="email"
              :disabled="!!editing"
            />
          </UFormField>
          <UFormField label="姓名">
            <UInput v-model="form.username" />
          </UFormField>
          <UFormField
            label="角色"
            description="可多选，选择用户的角色权限"
          >
            <USelectMenu
              v-model="form.roles"
              :items="roleOptions"
              multiple
              value-key="value"
              label-key="label"
              :placeholder="form.roles.length === 0 ? '选择角色' : form.roles.map(r => roleLabels[r] || r).join(', ')"
            />
          </UFormField>
          <UFormField label="状态">
            <USelectMenu
              v-model="form.status"
              :items="statusOptions"
              value-key="value"
              label-key="label"
            />
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
