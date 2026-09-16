<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

usePageTitle('钉钉集成')

interface DingDept {
  dept_code: number
  name: string
  parent_id: number
  children?: DingDept[]
  is_linked?: boolean
}

interface DingUser {
  userid: string
  name: string
  mobile: string
  email: string
  title: string
  dept_names: string
  active: boolean
}

interface EmailResult {
  userid: string
  name: string
  email: string
  generated: boolean
}

interface ApiResponse<T> {
  code: number
  message?: string
  data: T
}

interface SyncDiscrepancies {
  total: number
  missingInDatabase: Array<{ userid: string, name: string, email: string }>
  missingInDingtalk: Array<{ id: number, uid: string, realName: string, email: string, status: number, dingtalkId: string | null }>
  deletedInDatabase: Array<{ userid: string, name: string, email: string, localUid?: string }>
  inactiveInDingtalk: Array<{ userid: string, name: string, email: string, localUid?: string, localStatus?: number }>
}

interface BindAllResult {
  total: number
  linked: number
  created: number
  alreadyLinked: number
  notFound: number
  deptUpdated: number
  discrepancies: SyncDiscrepancies
}

const toast = useToast()

// ============ Tab State ============
const activeTab = ref('departments')
const tabs = [
  { label: '组织架构', value: 'departments', icon: 'i-lucide-building-2' },
  { label: '人员信息', value: 'users', icon: 'i-lucide-users' }
]

// ============ 部门状态 ============
const deptLoading = ref(false)
const deptSyncing = ref(false)
const deptTree = ref<DingDept[]>([])
const deptTotal = ref(0)
const allDeptsLinked = ref(false)
const deptExpandedIds = ref<Set<number>>(new Set())

// ============ 用户状态 ============
const userLoading = ref(false)
const dingUsers = ref<DingUser[]>([])
const userTotal = ref(0)
const userSearch = ref('')
const emailGenerating = ref(false)
const emailResults = ref<EmailResult[]>([])
const showEmailPreview = ref(false)
const replaceExisting = ref(false)
const writingBack = ref(false)
const binding = ref(false)
const showDiscrepancyModal = ref(false)
const syncDiscrepancies = ref<SyncDiscrepancies | null>(null)
const maxDiscrepancyItems = 50
const processingMissingUserIds = ref<number[]>([])

// ============ 部门方法 ============
async function loadDepartments() {
  deptLoading.value = true
  try {
    const result = await $fetch<ApiResponse<{ tree: DingDept[], total: number, allLinked: boolean }>>('/api/dingtalk/departments')
    deptTree.value = result.data.tree
    deptTotal.value = result.data.total
    allDeptsLinked.value = result.data.allLinked
    // 默认展开第一层
    expandFirstLevel(deptTree.value)
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '获取钉钉部门失败',
      description: error.data?.message || error.message || '请检查钉钉配置',
      color: 'error'
    })
  } finally {
    deptLoading.value = false
  }
}

function expandFirstLevel(nodes: DingDept[]) {
  for (const node of nodes) {
    if (node.children?.length) {
      deptExpandedIds.value.add(node.dept_code)
    }
  }
}

function toggleDeptExpand(dept: DingDept) {
  if (deptExpandedIds.value.has(dept.dept_code)) {
    deptExpandedIds.value.delete(dept.dept_code)
  } else {
    deptExpandedIds.value.add(dept.dept_code)
  }
  deptExpandedIds.value = new Set(deptExpandedIds.value)
}

function flattenDeptTree(nodes: DingDept[], level = 0): Array<DingDept & { level: number }> {
  const result: Array<DingDept & { level: number }> = []
  for (const node of nodes) {
    result.push({ ...node, level })
    if (node.children?.length && deptExpandedIds.value.has(node.dept_code)) {
      result.push(...flattenDeptTree(node.children, level + 1))
    }
  }
  return result
}

async function syncDepartments() {
  deptSyncing.value = true
  try {
    const result = await $fetch<ApiResponse<{ total: number, created: number, linked: number, skipped: number }>>('/api/dingtalk/departments-sync', { method: 'POST' })

    const d = result.data
    toast.add({
      title: '部门同步完成',
      description: `共 ${d.total} 个部门：新建 ${d.created} 个，关联 ${d.linked} 个`,
      color: 'success'
    })
    await loadDepartments()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '同步失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    deptSyncing.value = false
  }
}

// ============ 用户方法 ============
async function loadUsers() {
  userLoading.value = true
  try {
    const result = await $fetch<ApiResponse<{ users: DingUser[], total: number }>>('/api/dingtalk/users')
    dingUsers.value = result.data.users
    userTotal.value = result.data.total
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '获取钉钉人员失败',
      description: error.data?.message || error.message || '请检查钉钉配置',
      color: 'error'
    })
  } finally {
    userLoading.value = false
  }
}

const filteredUsers = computed(() => {
  if (!userSearch.value) return dingUsers.value
  const q = userSearch.value.toLowerCase()
  return dingUsers.value.filter(u =>
    u.name.toLowerCase().includes(q)
    || u.mobile.includes(q)
    || u.email.toLowerCase().includes(q)
    || u.dept_names.toLowerCase().includes(q)
  )
})

async function generateEmails() {
  emailGenerating.value = true
  try {
    const usersForEmail = dingUsers.value.map(u => ({
      userid: u.userid,
      name: u.name,
      email: u.email || ''
    }))

    const result = await $fetch<ApiResponse<{ results: EmailResult[], generated: number }>>('/api/dingtalk/generate-emails', {
      method: 'POST',
      body: { users: usersForEmail, replaceExisting: replaceExisting.value }
    })

    emailResults.value = result.data.results
    showEmailPreview.value = true

    toast.add({
      title: '邮箱生成完成',
      description: `共生成 ${result.data.generated} 个邮箱`,
      color: 'success'
    })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '生成失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    emailGenerating.value = false
  }
}

function applyGeneratedEmails() {
  // 将生成的邮箱应用到用户列表
  for (const result of emailResults.value) {
    if (result.generated) {
      const user = dingUsers.value.find(u => u.userid === result.userid)
      if (user) {
        user.email = result.email
      }
    }
  }
  showEmailPreview.value = false
  toast.add({
    title: '邮箱已应用',
    description: '已将生成的邮箱填入用户列表，请点击「一键关联」同步到本地',
    color: 'info'
  })
}

async function writebackEmails() {
  const generated = emailResults.value.filter(r => r.generated)
  if (generated.length === 0) {
    toast.add({ title: '没有需要回写的邮箱', color: 'warning' })
    return
  }

  writingBack.value = true
  try {
    const result = await $fetch<ApiResponse<{ total: number, success: number, failed: number, errors: Array<{ userid: string, error: string }> }>>('/api/dingtalk/writeback-emails', {
      method: 'POST',
      body: {
        users: generated.map(u => ({ userid: u.userid, email: u.email }))
      }
    })

    const d = result.data
    if (d.failed > 0) {
      toast.add({
        title: '部分回写失败',
        description: `成功 ${d.success}，失败 ${d.failed}: ${d.errors.map(e => e.error).join('; ')}`,
        color: 'warning'
      })
    } else {
      toast.add({
        title: '回写成功',
        description: `已将 ${d.success} 个邮箱回写到钉钉`,
        color: 'success'
      })
    }

    // 同时应用到本地列表
    applyGeneratedEmails()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '回写失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    writingBack.value = false
  }
}

async function bindAllUsers() {
  binding.value = true
  try {
    const usersForBind = dingUsers.value
      .map(u => ({
        userid: u.userid,
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        dept_names: u.dept_names,
        active: u.active
      }))

    const result = await $fetch<ApiResponse<BindAllResult>>('/api/dingtalk/users-bindall', {
      method: 'POST',
      body: { users: usersForBind }
    })

    const d = result.data
    syncDiscrepancies.value = d.discrepancies

    if (d.discrepancies.total > 0) {
      toast.add({
        title: '关联完成，但发现差异',
        description: `共 ${d.total} 人：新建 ${d.created}，新关联 ${d.linked}，已关联 ${d.alreadyLinked}，未匹配 ${d.notFound}，部门更新 ${d.deptUpdated}，差异 ${d.discrepancies.total}`,
        color: 'warning'
      })
      showDiscrepancyModal.value = true
    } else {
      toast.add({
        title: '关联完成',
        description: `共 ${d.total} 人：新建 ${d.created}，新关联 ${d.linked}，已关联 ${d.alreadyLinked}，未匹配 ${d.notFound}，部门更新 ${d.deptUpdated}`,
        color: 'success'
      })
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '关联失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    binding.value = false
  }
}

function isProcessingMissingUser(userId: number) {
  return processingMissingUserIds.value.includes(userId)
}

function recalculateDiscrepancyTotal(discrepancies: SyncDiscrepancies) {
  return discrepancies.missingInDatabase.length
    + discrepancies.missingInDingtalk.length
    + discrepancies.deletedInDatabase.length
    + discrepancies.inactiveInDingtalk.length
}

function removeMissingInDingtalkItem(userId: number) {
  if (!syncDiscrepancies.value) return

  const next = {
    ...syncDiscrepancies.value,
    missingInDingtalk: syncDiscrepancies.value.missingInDingtalk.filter(item => item.id !== userId)
  }
  next.total = recalculateDiscrepancyTotal(next)
  syncDiscrepancies.value = next

  if (next.total === 0) {
    showDiscrepancyModal.value = false
  }
}

async function unbindMissingDingtalkUser(item: SyncDiscrepancies['missingInDingtalk'][number]) {
  if (isProcessingMissingUser(item.id)) return

  processingMissingUserIds.value = [...processingMissingUserIds.value, item.id]

  try {
    await $fetch(`/api/ldap-users/${item.id}`, {
      method: 'PATCH',
      body: { dingtalk_id: null }
    })

    removeMissingInDingtalkItem(item.id)
    toast.add({
      title: '已解除钉钉绑定',
      description: `${item.realName} 的钉钉绑定已移除`,
      color: 'success'
    })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '解除绑定失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    processingMissingUserIds.value = processingMissingUserIds.value.filter(id => id !== item.id)
  }
}

async function deleteMissingDingtalkUser(item: SyncDiscrepancies['missingInDingtalk'][number]) {
  if (isProcessingMissingUser(item.id)) return
  if (!window.confirm(`确定要删除本地用户“${item.realName}”吗？`)) return

  processingMissingUserIds.value = [...processingMissingUserIds.value, item.id]

  try {
    await $fetch(`/api/ldap-users/${item.id}`, {
      method: 'DELETE'
    })

    removeMissingInDingtalkItem(item.id)
    toast.add({
      title: '本地用户已删除',
      description: `${item.realName} 已标记删除并移除部门关联`,
      color: 'success'
    })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '删除失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    processingMissingUserIds.value = processingMissingUserIds.value.filter(id => id !== item.id)
  }
}

// ============ 用户表格列 ============
const userColumns = [
  { accessorKey: 'name', header: '姓名' },
  { accessorKey: 'mobile', header: '手机' },
  { accessorKey: 'email', header: '邮箱' },
  { accessorKey: 'title', header: '职位' },
  { accessorKey: 'dept_names', header: '部门' },
  { accessorKey: 'active', header: '状态' }
]

// ============ 邮箱预览表格列 ============
const emailColumns = [
  { accessorKey: 'name', header: '姓名' },
  { accessorKey: 'email', header: '邮箱' },
  { accessorKey: 'generated', header: '类型' }
]

onMounted(() => {
  loadDepartments()
})
</script>

<template>
  <div class="flex flex-col w-full min-w-0 flex-1">
    <UDashboardPanel grow>
      <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
        <div class="flex items-center p-1 bg-gray-100 dark:bg-gray-800 rounded-lg gap-1">
          <UButton
            v-for="tab in tabs"
            :key="tab.value"
            :color="activeTab === tab.value ? 'primary' : 'neutral'"
            :variant="activeTab === tab.value ? 'solid' : 'ghost'"
            :icon="tab.icon"
            size="sm"
            class="rounded-md"
            @click="activeTab = tab.value; if (tab.value === 'users' && !dingUsers.length) loadUsers()"
          >
            {{ tab.label }}
          </UButton>
        </div>
      </div>

      <!-- ==================== Tab 1: 组织架构 ==================== -->
      <div v-if="activeTab === 'departments'" class="p-4">
        <!-- 工具栏 -->
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm text-gray-500">
            共 {{ deptTotal }} 个部门
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-download"
              :loading="deptSyncing"
              @click="syncDepartments"
            >
              一键同步到本地
            </UButton>
            <UButton
              color="neutral"
              size="sm"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="deptLoading"
              @click="loadDepartments"
            >
              刷新
            </UButton>
          </div>
        </div>

        <!-- 部门树 -->
        <UCard :ui="{ body: 'p-0' }">
          <div
            class="divide-y divide-gray-100 dark:divide-gray-800 overflow-y-auto max-h-[calc(100vh-240px)]"
          >
            <div
              v-for="dept in flattenDeptTree(deptTree)"
              :key="dept.dept_code"
              class="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              :style="{ paddingLeft: `${dept.level * 24 + 16}px` }"
            >
              <!-- 展开/收起 -->
              <button
                v-if="dept.children?.length"
                class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                @click="toggleDeptExpand(dept)"
              >
                <UIcon
                  :name="deptExpandedIds.has(dept.dept_code) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="w-4 h-4 text-gray-500"
                />
              </button>
              <div v-else class="w-6" />

              <!-- 图标 -->
              <UIcon
                :name="dept.children?.length ? 'i-lucide-folder' : 'i-lucide-folder-open'"
                class="w-5 h-5 text-amber-500"
              />

              <!-- 名称 -->
              <span class="font-medium">{{ dept.name }}</span>

              <!-- 已关联标记 -->
              <UBadge
                v-if="dept.is_linked"
                color="success"
                size="xs"
                variant="subtle"
                class="ml-2"
              >
                已关联
              </UBadge>

              <!-- 子部门数量 -->
              <span v-if="dept.children?.length" class="text-xs text-gray-400">
                ({{ dept.children.length }})
              </span>
            </div>

            <div
              v-if="!deptLoading && flattenDeptTree(deptTree).length === 0"
              class="py-10 text-center text-sm text-gray-500"
            >
              暂无部门数据，请点击刷新
            </div>
          </div>
        </UCard>
      </div>

      <!-- ==================== Tab 2: 人员信息 ==================== -->
      <div v-if="activeTab === 'users'" class="p-4">
        <!-- 工具栏 -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <UInput
              v-model="userSearch"
              icon="i-lucide-search"
              placeholder="搜索姓名、手机、邮箱..."
              size="sm"
              class="w-64"
            />
            <span class="text-sm text-gray-500">共 {{ filteredUsers.length }} 人</span>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="neutral"
              size="sm"
              variant="soft"
              icon="i-lucide-mail"
              :loading="emailGenerating"
              @click="generateEmails"
            >
              一键设置邮箱
            </UButton>
            <UTooltip :text="allDeptsLinked ? '' : '请先同步并完全关联组织架构'">
              <UButton
                color="primary"
                size="sm"
                icon="i-lucide-link"
                :loading="binding"
                :disabled="!allDeptsLinked"
                @click="bindAllUsers"
              >
                一键关联本地用户
              </UButton>
            </UTooltip>
            <UButton
              color="neutral"
              size="sm"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="userLoading"
              @click="loadUsers"
            >
              刷新
            </UButton>
          </div>
        </div>

        <!-- 用户表格 -->
        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :data="filteredUsers"
            :columns="userColumns"
            :loading="userLoading"
            sticky
            class="w-full h-[calc(100vh-240px)]"
          >
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name }}</span>
            </template>

            <template #mobile-cell="{ row }">
              <span class="text-gray-600 dark:text-gray-400 font-mono text-sm">
                {{ row.original.mobile || '-' }}
              </span>
            </template>

            <template #email-cell="{ row }">
              <span
                :class="row.original.email ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'"
                class="text-sm"
              >
                {{ row.original.email || '未设置' }}
              </span>
            </template>

            <template #dept_names-cell="{ row }">
              <span class="text-sm text-gray-600 dark:text-gray-400">
                {{ row.original.dept_names || '-' }}
              </span>
            </template>

            <template #active-cell="{ row }">
              <UBadge :color="row.original.active ? 'success' : 'neutral'" variant="subtle" size="xs">
                {{ row.original.active ? '在职' : '离职' }}
              </UBadge>
            </template>
          </UTable>
        </UCard>
      </div>
    </UDashboardPanel>

    <!-- ==================== 邮箱预览弹窗 ==================== -->
    <UModal v-model:open="showEmailPreview" title="邮箱生成预览" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="text-sm text-gray-500">
              根据姓名拼音生成邮箱，确认后将填入用户列表。
            </div>
            <div class="flex items-center gap-2">
              <UCheckbox v-model="replaceExisting" label="替换已有邮箱" size="sm" />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="emailGenerating"
                @click="generateEmails"
              >
                重新生成
              </UButton>
            </div>
          </div>
          <UTable :data="emailResults" :columns="emailColumns" class="max-h-96">
            <template #email-cell="{ row }">
              <span
                :class="row.original.generated ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-500'"
              >
                {{ row.original.email }}
              </span>
            </template>
            <template #generated-cell="{ row }">
              <UBadge :color="row.original.generated ? 'info' : 'neutral'" variant="subtle" size="xs">
                {{ row.original.generated ? '新生成' : '已有' }}
              </UBadge>
            </template>
          </UTable>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showEmailPreview = false"
          />
          <UButton
            label="回写到钉钉"
            color="warning"
            variant="soft"
            icon="i-lucide-upload"
            :loading="writingBack"
            @click="writebackEmails"
          />
          <UButton label="确认应用" color="primary" @click="applyGeneratedEmails" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showDiscrepancyModal" title="钉钉同步差异" :ui="{ content: 'sm:max-w-4xl' }">
      <template #body>
        <div class="space-y-4 p-2">
          <div class="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-default">
            同步已完成，但钉钉与本地数据库仍存在 {{ syncDiscrepancies?.total || 0 }} 项差异。以下仅展示每类前 {{ maxDiscrepancyItems }} 条。
          </div>

          <div v-if="syncDiscrepancies?.missingInDatabase.length" class="space-y-2">
            <div class="font-medium text-sm text-highlighted">
              钉钉存在但本地不存在 {{ syncDiscrepancies.missingInDatabase.length }} 人
            </div>
            <div class="max-h-48 overflow-y-auto rounded-lg border border-default divide-y divide-default">
              <div
                v-for="item in syncDiscrepancies.missingInDatabase.slice(0, maxDiscrepancyItems)"
                :key="`missing-db-${item.userid}`"
                class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <div class="font-medium">
                    {{ item.name }}
                  </div>
                  <div class="text-muted">
                    {{ item.userid }}
                  </div>
                </div>
                <div class="text-right text-muted">
                  {{ item.email || '未设置邮箱' }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="syncDiscrepancies?.missingInDingtalk.length" class="space-y-2">
            <div class="font-medium text-sm text-highlighted">
              本地存在但钉钉不存在 {{ syncDiscrepancies.missingInDingtalk.length }} 人
            </div>
            <div class="max-h-48 overflow-y-auto rounded-lg border border-default divide-y divide-default">
              <div
                v-for="item in syncDiscrepancies.missingInDingtalk.slice(0, maxDiscrepancyItems)"
                :key="`missing-ding-${item.uid}`"
                class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <div class="font-medium">
                    {{ item.realName }}
                  </div>
                  <div class="text-muted">
                    {{ item.uid }}
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <div class="text-right text-muted">
                    <div>
                      {{ item.email || '未设置邮箱' }}
                    </div>
                    <div>
                      {{ item.status === 0 ? '本地禁用' : '本地正常' }}
                    </div>
                    <div v-if="item.dingtalkId">
                      绑定钉钉: {{ item.dingtalkId }}
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <UButton
                      v-if="item.dingtalkId"
                      label="解除绑定"
                      size="xs"
                      color="warning"
                      variant="soft"
                      :loading="isProcessingMissingUser(item.id)"
                      :disabled="isProcessingMissingUser(item.id)"
                      @click="unbindMissingDingtalkUser(item)"
                    />
                    <UButton
                      label="删除用户"
                      size="xs"
                      color="error"
                      variant="ghost"
                      :loading="isProcessingMissingUser(item.id)"
                      :disabled="isProcessingMissingUser(item.id)"
                      @click="deleteMissingDingtalkUser(item)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="syncDiscrepancies?.deletedInDatabase.length" class="space-y-2">
            <div class="font-medium text-sm text-highlighted">
              本地已删除但钉钉仍在职 {{ syncDiscrepancies.deletedInDatabase.length }} 人
            </div>
            <div class="max-h-48 overflow-y-auto rounded-lg border border-default divide-y divide-default">
              <div
                v-for="item in syncDiscrepancies.deletedInDatabase.slice(0, maxDiscrepancyItems)"
                :key="`deleted-db-${item.userid}`"
                class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <div class="font-medium">
                    {{ item.name }}
                  </div>
                  <div class="text-muted">
                    {{ item.userid }}
                  </div>
                </div>
                <div class="text-right text-muted">
                  <div>
                    {{ item.email || '未设置邮箱' }}
                  </div>
                  <div v-if="item.localUid">
                    本地 UID: {{ item.localUid }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="syncDiscrepancies?.inactiveInDingtalk.length" class="space-y-2">
            <div class="font-medium text-sm text-highlighted">
              钉钉已离职但本地未删除 {{ syncDiscrepancies.inactiveInDingtalk.length }} 人
            </div>
            <div class="max-h-48 overflow-y-auto rounded-lg border border-default divide-y divide-default">
              <div
                v-for="item in syncDiscrepancies.inactiveInDingtalk.slice(0, maxDiscrepancyItems)"
                :key="`inactive-ding-${item.userid}`"
                class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <div class="font-medium">
                    {{ item.name }}
                  </div>
                  <div class="text-muted">
                    {{ item.userid }}
                  </div>
                </div>
                <div class="text-right text-muted">
                  <div>
                    {{ item.email || '未设置邮箱' }}
                  </div>
                  <div v-if="item.localUid">
                    本地 UID: {{ item.localUid }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton label="关闭" color="primary" @click="showDiscrepancyModal = false" />
        </div>
      </template>
    </UModal>
  </div>
</template>
