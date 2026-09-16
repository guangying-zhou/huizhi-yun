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

interface DirectoryProvisioningState {
  ldapConfigured: boolean
  ldapManaged: boolean
  connectorReady: boolean
  directoryType: string
  defaultTarget: 'ldap' | 'console'
}

interface DirectoryOperation {
  operationId: string
  status: string
  // Console 生成初始密码时才返回，且只在创建响应里出现一次。
  initialPassword?: string
  initialPasswordGenerated?: boolean
}

const { search, debounced: debouncedSearch, flush: flushSearch, reset: resetSearch } = useDebouncedSearch()
const deptCode = ref('')
const status = ref('active')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, deptCode, status },
  defaults: { search: '', deptCode: '', status: 'active' }
})
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
  primaryDeptCode: '__unassigned__',
  userType: 'employee',
  gender: 'unknown',
  status: 'active',
  remark: '',
  provisioningTarget: 'console' as 'console' | 'ldap',
  initialPassword: '',
  confirmPassword: ''
})

const query = computed(() => ({
  page: page.value,
  pageSize,
  search: debouncedSearch.value || undefined,
  deptCode: deptCode.value || undefined,
  status: status.value
}))

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryUsersResponse>>('/api/v1/console/directory/users', {
  query,
  default: () => ({ code: 0, data: { items: [], total: 0 } })
})
const errorAlert = useApiErrorAlert(error, {
  appName: 'Console',
  fallbackTitle: '目录用户加载失败'
})

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => {
  setRefresh(refresh)
})
onBeforeUnmount(clearRefresh)

const { data: departmentData } = await useFetch<ApiResponse<{ flat: Array<{ deptCode: string, name: string, level: number, orgType: string }> }>>(
  '/api/v1/console/directory/departments',
  {
    default: () => ({ code: 0, data: { flat: [] } })
  }
)

const { data: provisioningData } = await useFetch<ApiResponse<DirectoryProvisioningState>>(
  '/api/v1/console/directory/provisioning',
  {
    default: () => ({
      code: 0,
      data: {
        ldapConfigured: false,
        ldapManaged: false,
        connectorReady: false,
        directoryType: 'openldap',
        defaultTarget: 'console' as const
      }
    })
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
const unassignedDepartmentValue = '__unassigned__'
const genderOptions = [
  { label: '未知', value: 'unknown' },
  { label: '男', value: 'male' },
  { label: '女', value: 'female' }
]
const departmentOptions = computed(() => [
  { label: '未分配', value: unassignedDepartmentValue },
  ...(departmentData.value?.data.flat || [])
    .filter(dept => dept.orgType === 'department')
    .map(dept => ({
      label: `${'  '.repeat(Math.max(0, dept.level - 1))}${dept.name}`,
      value: dept.deptCode
    }))
])
const provisioning = computed(() => provisioningData.value?.data)
const provisioningTargetOptions = computed(() => [
  ...(provisioning.value?.ldapManaged
    ? [{
        label: `LDAP（${provisioning.value.directoryType === 'active-directory' ? 'Active Directory' : 'OpenLDAP'}）`,
        value: 'ldap'
      }]
    : []),
  { label: '仅 Console 本地目录', value: 'console' }
])

function resetFilters() {
  resetSearch()
  resetListFilters()
}

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
  form.primaryDeptCode = unassignedDepartmentValue
  form.userType = 'employee'
  form.gender = 'unknown'
  form.status = 'active'
  form.remark = ''
  form.provisioningTarget = provisioning.value?.defaultTarget || 'console'
  form.initialPassword = ''
  form.confirmPassword = ''
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
  form.primaryDeptCode = user.deptCode || unassignedDepartmentValue
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
    primaryDeptCode: form.primaryDeptCode === unassignedDepartmentValue ? null : form.primaryDeptCode || null,
    userType: form.userType,
    gender: form.gender,
    status: form.status,
    remark: form.remark.trim() || null,
    provisioningTarget: modalMode.value === 'create' ? form.provisioningTarget : undefined,
    // 留空表示交给 Console 生成随机初始密码，明文不经过 People 或本页表单。
    initialPassword: modalMode.value === 'create' && form.provisioningTarget === 'ldap' && form.initialPassword
      ? form.initialPassword
      : undefined
  }
}

// Console 生成的初始密码只在创建响应里出现一次，服务端既不保存明文也无法再取回。
const generatedPassword = ref<{ uid: string, password: string } | null>(null)

async function copyGeneratedPassword() {
  const password = generatedPassword.value?.password
  if (!password) return
  try {
    await navigator.clipboard.writeText(password)
    toast.add({ title: '初始密码已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请手动选中复制', color: 'warning' })
  }
}

async function waitForOperation(operationId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await $fetch<ApiResponse<DirectoryOperation>>(
      `/api/v1/console/directory/operations/${encodeURIComponent(operationId)}`
    )
    if (response.data.status === 'succeeded') return 'succeeded'
    if (['dead_letter', 'failed'].includes(response.data.status)) return 'failed'
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return 'pending'
}

async function submitUser() {
  if (!form.uid.trim()) {
    toast.add({ title: 'UID 不能为空', color: 'warning' })
    return
  }
  if (modalMode.value === 'create' && form.provisioningTarget === 'ldap') {
    if (!provisioning.value?.connectorReady) {
      toast.add({ title: 'LDAP Connector 尚未就绪', color: 'warning' })
      return
    }
    if (form.initialPassword) {
      if (form.initialPassword.length < 10) {
        toast.add({ title: '初始密码至少需要 10 个字符', color: 'warning' })
        return
      }
      if (form.initialPassword !== form.confirmPassword) {
        toast.add({ title: '两次输入的密码不一致', color: 'warning' })
        return
      }
    }
  }

  saving.value = true
  try {
    const payload = userPayload()
    if (modalMode.value === 'create') {
      const response = await $fetch<ApiResponse<DirectoryOperation | DirectoryUser>>('/api/v1/console/directory/users', {
        method: 'POST',
        headers: {
          'idempotency-key': `directory:user:create:${globalThis.crypto?.randomUUID?.() || Date.now()}`
        },
        body: payload
      })
      if (form.provisioningTarget === 'ldap' && 'operationId' in response.data) {
        const generated = 'initialPassword' in response.data ? String(response.data.initialPassword || '') : ''
        const operationStatus = await waitForOperation(response.data.operationId)
        if (operationStatus === 'failed') throw new Error('LDAP 创建任务执行失败，请查看目录同步日志')
        if (generated) {
          // 明文只在这一次响应里出现，服务端不保存也无法再取回。
          generatedPassword.value = { uid: form.uid.trim(), password: generated }
        }
        toast.add({
          title: operationStatus === 'succeeded' ? 'LDAP 用户已创建' : 'LDAP 创建任务已提交',
          description: operationStatus === 'pending' ? 'Connector 将继续在后台执行。' : undefined,
          color: operationStatus === 'succeeded' ? 'success' : 'info'
        })
      } else {
        toast.add({ title: '用户已创建', color: 'success' })
      }
    } else {
      await $fetch(`/api/v1/console/directory/users/${encodeURIComponent(form.uid)}`, {
        method: 'PATCH',
        headers: {
          'idempotency-key': `directory:user:update:${form.uid}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
        },
        body: payload
      })
      toast.add({ title: '用户已保存', color: 'success' })
    }
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
                LDAP 托管模式下，新用户会先写入企业 LDAP，再自动同步到 Console 和 Platform。
              </p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索 UID / 姓名 / 邮箱"
                class="sm:w-72"
                @keyup.enter="flushSearch"
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
                color="neutral"
                variant="soft"
                icon="i-lucide-rotate-ccw"
                @click="resetFilters"
              >
                重置
              </UButton>
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
          v-if="errorAlert"
          :color="errorAlert.color"
          variant="soft"
          :icon="errorAlert.icon"
          :title="errorAlert.title"
          :description="errorAlert.description"
          class="mb-3"
        />

        <UTable
          sticky
          :data="users"
          :columns="userColumns"
          :loading="pending"
          empty="暂无用户"
          class="flex-1 max-h-[calc(100svh-22rem)] rounded-lg border border-default"
        >
          <template #empty>
            <CommonEmptyState
              icon="i-lucide-users"
              title="暂无目录用户"
              description="调整筛选条件，或新建一个目录用户。"
            />
          </template>
        </UTable>

        <div
          v-if="total > 0"
          class="mt-4 flex items-center justify-between border-t border-default pt-4"
        >
          <span class="text-sm text-muted">共 {{ total }} 人</span>
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="total"
          />
        </div>
      </UCard>

      <UModal
        v-model:open="modalOpen"
        :title="modalMode === 'create' ? '新建目录用户' : '编辑目录用户'"
        :ui="{ content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <UAlert
            v-if="modalMode === 'create' && form.provisioningTarget === 'ldap'"
            color="info"
            variant="soft"
            icon="i-lucide-network"
            title="创建 LDAP 用户"
            description="保存后由客户侧 Directory Connector 写入 LDAP；成功后自动出现在 Console 与 Platform。"
            class="mb-4"
          />
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField
              v-if="modalMode === 'create'"
              label="创建位置"
              required
            >
              <USelect
                v-model="form.provisioningTarget"
                class="w-full"
                :items="provisioningTargetOptions"
              />
            </UFormField>

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

            <UFormField
              v-if="modalMode === 'create' && form.provisioningTarget === 'ldap'"
              label="初始密码"
              hint="留空则由系统生成"
              description="留空时系统生成随机密码，创建后仅显示一次。"
            >
              <UInput
                v-model="form.initialPassword"
                type="password"
                autocomplete="new-password"
                class="w-full"
                placeholder="留空由系统生成，或至少 10 个字符"
              />
            </UFormField>

            <UFormField
              v-if="modalMode === 'create' && form.provisioningTarget === 'ldap' && form.initialPassword"
              label="确认初始密码"
              required
            >
              <UInput
                v-model="form.confirmPassword"
                type="password"
                autocomplete="new-password"
                class="w-full"
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

      <UModal
        :open="Boolean(generatedPassword)"
        title="初始密码仅显示一次"
        :dismissible="false"
        @update:open="value => { if (!value) generatedPassword = null }"
      >
        <template #body>
          <div class="space-y-4">
            <UAlert
              color="warning"
              variant="soft"
              icon="i-lucide-key-round"
              title="关闭后无法再次查看"
              description="系统不保存明文初始密码，也无法找回。请立即复制并通过安全渠道交给该用户。"
            />
            <div class="space-y-1">
              <p class="text-sm text-muted">
                用户
              </p>
              <p class="font-mono text-sm">
                {{ generatedPassword?.uid }}
              </p>
            </div>
            <div class="space-y-1">
              <p class="text-sm text-muted">
                初始密码
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 select-all break-all rounded bg-elevated px-3 py-2 font-mono text-sm">{{ generatedPassword?.password }}</code>
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-copy"
                  :aria-label="'复制初始密码'"
                  @click="copyGeneratedPassword"
                />
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <UButton
            color="primary"
            @click="generatedPassword = null"
          >
            我已保存
          </UButton>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
