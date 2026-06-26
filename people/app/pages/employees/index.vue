<script setup lang="ts">
import type { ApiResponse, Employee, ListResponse } from '~/types'

const { label, color, money, date } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()

const keyword = ref('')
const status = ref('all')
const syncingDirectory = ref(false)

const employeeListPageSize = 500

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '在职', value: 'active' },
  { label: '离职中', value: 'leaving' },
  { label: '已离职', value: 'left' }
]

const query = computed(() => ({
  page: 1,
  page_size: employeeListPageSize,
  keyword: keyword.value || undefined,
  employment_status: status.value === 'all' ? undefined : status.value
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<Employee>>>('/api/v1/employees', {
  query,
  watch: [query]
})

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  avatar_text: avatarText(item),
  status_label: label(item.employment_status),
  onboard_display: date(item.onboard_date),
  cost_display: money(item.monthly_standard_cost)
})))

const total = computed(() => response.value?.data.total || 0)
const totalLabel = computed(() => rows.value.length < total.value ? `显示 ${rows.value.length} / ${total.value} 人` : `${total.value} 人`)

const columns = [
  { accessorKey: 'display_name', header: '姓名' },
  { accessorKey: 'employee_no', header: '工号' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'dept_name', header: '部门' },
  { accessorKey: 'position_name', header: '岗位' },
  { accessorKey: 'rank_code', header: '职级' },
  { accessorKey: 'manager_uid', header: '直属负责人' },
  { accessorKey: 'onboard_display', header: '入职日期' },
  { accessorKey: 'cost_display', header: '月标准成本' }
]

function handleEmployeeSelect(_event: Event, row: { original: Employee }) {
  navigateTo(`/employees/${row.original.employee_uid}`)
}

function handleRefresh() {
  refresh()
}

function avatarText(item: Employee) {
  return firstAvatarGlyph(item.display_name, item.initials, item.employee_uid)
}

function firstAvatarGlyph(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim()
    const glyph = Array.from(text).find(char => char.trim())
    if (!glyph) continue
    return /[a-z]/i.test(glyph) ? glyph.toUpperCase() : glyph
  }
  return '人'
}

function syncErrorMessage(error: unknown) {
  const payload = error as {
    data?: { message?: string }
    message?: string
  }
  return payload.data?.message || payload.message || '请稍后重试'
}

async function handleDirectorySync() {
  if (syncingDirectory.value) return

  const authorization = await ensurePeoplePermission('employees', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要员工管理权限后才能同步 Console 目录。',
      color: 'warning'
    })
    return
  }

  syncingDirectory.value = true
  try {
    const result = await $fetch<ApiResponse<{ synced?: number, assignments_synced?: number }>>(peopleApiPath('/api/admin/directory-sync/import'), {
      method: 'POST',
      body: {
        activeRoleCode: authorization.switchedRoleCode || authorization.snapshot?.activeRoleCode || '',
        createAssignments: true,
        status: 'active'
      }
    })
    const synced = result.data?.synced || 0
    const assignmentsSynced = result.data?.assignments_synced || 0
    toast.add({
      title: '已同步 Console 目录',
      description: `员工 ${synced} 人，任职 ${assignmentsSynced} 条。`,
      color: 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({
      title: '目录同步失败',
      description: syncErrorMessage(error),
      color: 'error'
    })
  } finally {
    syncingDirectory.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-employees"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          员工
        </h1>
      </Teleport>
      <Teleport to="#people-layout-header-actions">
        <UButton
          icon="i-lucide-users-round"
          color="primary"
          variant="soft"
          :loading="syncingDirectory"
          @click="handleDirectorySync"
        >
          同步目录
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="flex h-[calc(100dvh-4rem)] min-h-0 flex-col gap-4 overflow-hidden p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="员工数据暂不可用"
          description="请确认 People schema 已执行，data-runtime 已启用 people adapter。"
        />

        <UCard class="shrink-0">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-1 flex-col gap-2 sm:flex-row">
              <UInput
                v-model="keyword"
                icon="i-lucide-search"
                placeholder="搜索姓名 / 工号 / UID / 登录名"
                class="w-full sm:max-w-md"
              />
              <USelect
                v-model="status"
                :items="statusOptions"
                class="w-full sm:w-36"
              />
            </div>
            <UBadge
              color="neutral"
              variant="soft"
            >
              {{ totalLabel }}
            </UBadge>
          </div>
        </UCard>

        <div class="min-h-0 flex-1 overflow-hidden rounded-lg border border-default bg-default">
          <div class="h-full overflow-auto">
            <UTable
              :data="rows"
              :columns="columns"
              class="min-w-[1120px]"
              @select="handleEmployeeSelect"
            >
              <template #display_name-cell="{ row }">
                <div class="flex min-w-0 items-center gap-3">
                  <UAvatar
                    :text="row.original.avatar_text"
                    size="sm"
                    class="shrink-0"
                  />
                  <div class="min-w-0">
                    <p class="truncate font-medium">
                      {{ row.original.display_name }}
                    </p>
                    <p class="truncate text-xs text-muted">
                      {{ row.original.employee_uid }}
                    </p>
                  </div>
                </div>
              </template>
              <template #status_label-cell="{ row }">
                <UBadge
                  :color="color(row.original.employment_status)"
                  variant="soft"
                >
                  {{ row.original.status_label }}
                </UBadge>
              </template>
            </UTable>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
