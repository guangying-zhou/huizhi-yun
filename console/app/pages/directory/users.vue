<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('目录用户')

interface DirectoryUser {
  id: number
  uid: string
  username?: string | null
  displayName?: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4?: string | null
  avatar: string | null
  gender: number
  status?: number
  deptCode: string | null
  deptName: string | null
  positionTitle?: string | null
  userType?: string
}

interface DirectoryUsersResponse {
  items: DirectoryUser[]
  total: number
}

interface ApiResponse<T> {
  code: number
  data: T
}

const search = ref('')
const deptCode = ref('')
const status = ref('active')
const toast = useToast()
const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const saving = ref(false)

const form = reactive({
  uid: '',
  username: '',
  displayName: '',
  realName: '',
  nickname: '',
  email: '',
  mobile: '',
  positionTitle: '',
  primaryDeptCode: '',
  userType: 'employee',
  gender: 'unknown',
  status: 'active',
  remark: ''
})

const query = computed(() => ({
  search: search.value || undefined,
  deptCode: deptCode.value || undefined,
  status: status.value
}))

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryUsersResponse>>('/api/v1/console/directory/users', {
  query,
  default: () => ({ code: 0, data: { items: [], total: 0 } })
})

const { data: departmentData } = await useFetch<ApiResponse<{ flat: Array<{ deptCode: string, name: string, level: number, orgType: string }> }>>(
  '/api/v1/console/directory/departments',
  {
    default: () => ({ code: 0, data: { flat: [] } })
  }
)

const users = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)
const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '停用', value: 'inactive' },
  { label: '待激活', value: 'pending' },
  { label: '已删除', value: 'deleted' },
  { label: '全部', value: 'all' }
]
const formStatusOptions = statusOptions.filter(item => item.value !== 'all')
const userTypeOptions = [
  { label: '员工', value: 'employee' },
  { label: '外部用户', value: 'external' },
  { label: '服务账号', value: 'service' }
]
const genderOptions = [
  { label: '未知', value: 'unknown' },
  { label: '男', value: 'male' },
  { label: '女', value: 'female' }
]
const departmentOptions = computed(() => [
  { label: '未分配', value: '' },
  ...(departmentData.value?.data.flat || [])
    .filter(dept => dept.orgType === 'department')
    .map(dept => ({
      label: `${'  '.repeat(Math.max(0, dept.level - 1))}${dept.name}`,
      value: dept.deptCode
    }))
])

function statusMeta(user: DirectoryUser) {
  if (user.status === 1) return { label: '正常', color: 'success' as const }
  if (user.status === -1) return { label: '已删除', color: 'error' as const }
  return { label: '停用', color: 'neutral' as const }
}

function getDisplayName(user: DirectoryUser) {
  return user.realName || user.displayName || user.nickname || user.username || user.uid
}

function statusToForm(user: DirectoryUser) {
  if (user.status === 1) return 'active'
  if (user.status === -1) return 'deleted'
  return 'inactive'
}

function resetForm() {
  form.uid = ''
  form.username = ''
  form.displayName = ''
  form.realName = ''
  form.nickname = ''
  form.email = ''
  form.mobile = ''
  form.positionTitle = ''
  form.primaryDeptCode = ''
  form.userType = 'employee'
  form.gender = 'unknown'
  form.status = 'active'
  form.remark = ''
}

function openCreateUser() {
  resetForm()
  modalMode.value = 'create'
  modalOpen.value = true
}

function openEditUser(user: DirectoryUser) {
  resetForm()
  modalMode.value = 'edit'
  form.uid = user.uid
  form.username = user.username || ''
  form.displayName = user.displayName || ''
  form.realName = user.realName || ''
  form.nickname = user.nickname || ''
  form.email = user.email || ''
  form.mobile = user.mobile || ''
  form.positionTitle = user.positionTitle || ''
  form.primaryDeptCode = user.deptCode || ''
  form.userType = user.userType || 'employee'
  form.status = statusToForm(user)
  modalOpen.value = true
}

function userPayload() {
  return {
    uid: form.uid.trim(),
    username: form.username.trim() || null,
    displayName: form.displayName.trim() || null,
    realName: form.realName.trim() || null,
    nickname: form.nickname.trim() || null,
    email: form.email.trim() || null,
    mobile: form.mobile.trim() || null,
    positionTitle: form.positionTitle.trim() || null,
    primaryDeptCode: form.primaryDeptCode || null,
    userType: form.userType,
    gender: form.gender,
    status: form.status,
    remark: form.remark.trim() || null
  }
}

async function submitUser() {
  if (!form.uid.trim()) {
    toast.add({ title: 'UID 不能为空', color: 'warning' })
    return
  }

  saving.value = true
  try {
    const payload = userPayload()
    if (modalMode.value === 'create') {
      await $fetch('/api/v1/console/directory/users', {
        method: 'POST',
        body: payload
      })
    } else {
      await $fetch(`/api/v1/console/directory/users/${encodeURIComponent(form.uid)}`, {
        method: 'PATCH',
        body: payload
      })
    }
    toast.add({ title: modalMode.value === 'create' ? '用户已创建' : '用户已保存', color: 'success' })
    modalOpen.value = false
    await refresh()
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败'
    toast.add({ title: '保存失败', description: message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const userColumns: TableColumn<DirectoryUser>[] = [
  {
    accessorKey: 'uid',
    header: '用户',
    cell: ({ row }) => {
      const user = row.original
      return h('div', { class: 'flex items-center gap-3' }, [
        h(UAvatar, { src: user.avatar || undefined, alt: getDisplayName(user), size: 'sm' }),
        h('div', [
          h('p', { class: 'font-medium text-highlighted' }, getDisplayName(user)),
          h('p', { class: 'text-xs text-muted' }, user.uid)
        ])
      ])
    }
  },
  {
    accessorKey: 'deptCode',
    header: '主部门',
    cell: ({ row }) => {
      const user = row.original
      if (!user.deptCode) return '未分配'
      return h('div', [
        h('p', { class: 'text-highlighted' }, user.deptName || user.deptCode),
        h('p', { class: 'text-xs text-muted' }, user.deptCode)
      ])
    }
  },
  { accessorKey: 'email', header: '邮箱', cell: ({ row }) => row.original.email || '-' },
  { accessorKey: 'mobileTail4', header: '手机尾号', cell: ({ row }) => row.original.mobileTail4 || '-' },
  { accessorKey: 'userType', header: '类型', cell: ({ row }) => row.original.userType || 'employee' },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'sm',
      icon: 'i-lucide-pencil',
      onClick: () => openEditUser(row.original)
    }, () => '编辑')
  }
]
</script>

<template>
  <UDashboardPanel id="directory-users" :ui="dashboardPanelUi">
    <template #body>
      <div class="grid gap-3 md:grid-cols-3">
        <UCard>
          <p class="text-xs text-muted">
            用户总数
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ total }}
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted">
            数据源
          </p>
          <p class="mt-1 text-lg font-semibold">
            Console Directory
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

      <UCard>
        <template #header>
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 class="font-semibold">
                用户列表
              </h2>
              <p class="text-sm text-muted">
                维护本地 `directory_users` 基础资料；外部目录源可通过同步任务批量更新。
              </p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索 UID / 姓名 / 邮箱"
                class="sm:w-72"
              />
              <UInput
                v-model="deptCode"
                placeholder="部门编码"
                class="sm:w-40"
              />
              <USelect
                v-model="status"
                :items="statusOptions"
                class="sm:w-32"
              />
              <UButton
                color="primary"
                icon="i-lucide-user-plus"
                @click="openCreateUser"
              >
                新建用户
              </UButton>
            </div>
          </div>
        </template>

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
          :data="users"
          :columns="userColumns"
          :loading="pending"
          empty="暂无用户"
          class="flex-1 max-h-[calc(100svh-22rem)] rounded-lg border border-default"
        />
      </UCard>

      <UModal
        v-model:open="modalOpen"
        :title="modalMode === 'create' ? '新建目录用户' : '编辑目录用户'"
        :ui="{ content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField
              label="UID"
              required
            >
              <UInput
                v-model="form.uid"
                class="w-full"
                :disabled="modalMode === 'edit'"
                placeholder="例如：zhangsan"
              />
            </UFormField>

            <UFormField label="用户名">
              <UInput
                v-model="form.username"
                class="w-full"
                placeholder="登录名或目录用户名"
              />
            </UFormField>

            <UFormField label="真实姓名">
              <UInput
                v-model="form.realName"
                class="w-full"
                placeholder="例如：张三"
              />
            </UFormField>

            <UFormField label="显示名称">
              <UInput
                v-model="form.displayName"
                class="w-full"
                placeholder="为空时使用真实姓名或 UID"
              />
            </UFormField>

            <UFormField label="邮箱">
              <UInput
                v-model="form.email"
                class="w-full"
                placeholder="name@example.com"
              />
            </UFormField>

            <UFormField label="手机号">
              <UInput
                v-model="form.mobile"
                class="w-full"
                placeholder="用于本地目录资料"
              />
            </UFormField>

            <UFormField label="主部门">
              <USelect
                v-model="form.primaryDeptCode"
                class="w-full"
                :items="departmentOptions"
              />
            </UFormField>

            <UFormField label="职位">
              <UInput
                v-model="form.positionTitle"
                class="w-full"
                placeholder="例如：项目经理"
              />
            </UFormField>

            <UFormField label="用户类型">
              <USelect
                v-model="form.userType"
                class="w-full"
                :items="userTypeOptions"
              />
            </UFormField>

            <UFormField label="状态">
              <USelect
                v-model="form.status"
                class="w-full"
                :items="formStatusOptions"
              />
            </UFormField>

            <UFormField label="性别">
              <USelect
                v-model="form.gender"
                class="w-full"
                :items="genderOptions"
              />
            </UFormField>

            <UFormField label="备注">
              <UInput
                v-model="form.remark"
                class="w-full"
                placeholder="内部备注"
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
            @click="submitUser"
          >
            保存
          </UButton>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
