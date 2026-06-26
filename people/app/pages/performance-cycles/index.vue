<script setup lang="ts">
import type { ApiResponse, ListResponse, PerformanceCycle } from '~/types'

const { label, color, date } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()

const keyword = ref('')
const status = ref('all')
const createOpen = ref(false)
const creating = ref(false)

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '采集中', value: 'collecting' },
  { label: '计算中', value: 'calculating' },
  { label: '已确认', value: 'confirmed' },
  { label: '已关闭', value: 'closed' }
]

const cycleTypeOptions = [
  { label: '月度', value: 'month' },
  { label: '季度', value: 'quarter' },
  { label: '项目', value: 'project' },
  { label: '年度', value: 'annual' }
]

const scopeTypeOptions = [
  { label: '项目', value: 'project' },
  { label: '团队', value: 'team' },
  { label: '组织', value: 'org' }
]

const createForm = reactive({
  cycleCode: '',
  cycleName: '',
  cycleType: 'quarter',
  scopeType: 'project',
  projectCode: '',
  periodStart: currentQuarterStart(),
  periodEnd: currentQuarterEnd()
})

const query = computed(() => ({
  page: 1,
  page_size: 80,
  keyword: keyword.value || undefined,
  status: status.value === 'all' ? undefined : status.value
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<PerformanceCycle>>>('/api/v1/performance-cycles', {
  query,
  watch: [query]
})

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  period: `${date(item.period_start)} ~ ${date(item.period_end)}`,
  status_label: label(item.status)
})))

const columns = [
  { accessorKey: 'cycle_code', header: '周期编码' },
  { accessorKey: 'cycle_name', header: '名称' },
  { accessorKey: 'cycle_type', header: '类型' },
  { accessorKey: 'scope_type', header: '范围' },
  { accessorKey: 'project_code', header: '项目' },
  { accessorKey: 'period', header: '周期期间' },
  { accessorKey: 'status_label', header: '状态' }
]

function handleCycleSelect(_event: Event, row: { original: PerformanceCycle }) {
  navigateTo(`/performance-cycles/${row.original.cycle_code}`)
}

function currentQuarterStart() {
  const now = new Date()
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  return new Date(now.getFullYear(), quarterStartMonth, 1).toISOString().slice(0, 10)
}

function currentQuarterEnd() {
  const now = new Date()
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  return new Date(now.getFullYear(), quarterStartMonth + 3, 0).toISOString().slice(0, 10)
}

function resetCreateForm() {
  createForm.cycleCode = ''
  createForm.cycleName = ''
  createForm.cycleType = 'quarter'
  createForm.scopeType = 'project'
  createForm.projectCode = ''
  createForm.periodStart = currentQuarterStart()
  createForm.periodEnd = currentQuarterEnd()
}

function openCreateCycle() {
  resetCreateForm()
  createOpen.value = true
}

function errorMessage(error: unknown) {
  const payload = error as { data?: { message?: string }, message?: string }
  return payload.data?.message || payload.message || '请稍后重试'
}

async function handleCreateCycle() {
  if (creating.value) return

  const authorization = await ensurePeoplePermission('performance_cycles', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要绩效周期编辑权限后才能新建周期。',
      color: 'warning'
    })
    return
  }

  creating.value = true
  try {
    const result = await $fetch<ApiResponse<PerformanceCycle>>(peopleApiPath('/api/admin/performance-cycles'), {
      method: 'POST',
      body: {
        ...createForm,
        projectCode: createForm.scopeType === 'project' ? createForm.projectCode : '',
        activeRoleCode: authorization.switchedRoleCode || authorization.snapshot?.activeRoleCode || ''
      }
    })
    toast.add({
      title: '绩效周期已创建',
      description: result.data?.cycle_code || createForm.cycleName,
      color: 'success'
    })
    createOpen.value = false
    await refresh()
    if (result.data?.cycle_code) {
      await navigateTo(`/performance-cycles/${result.data.cycle_code}`)
    }
  } catch (error) {
    toast.add({
      title: '新建周期失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-performance-cycles"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          绩效周期
        </h1>
      </Teleport>
      <Teleport to="#people-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="() => refresh()"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="绩效周期暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-1 flex-col gap-2 sm:flex-row">
              <UInput
                v-model="keyword"
                icon="i-lucide-search"
                placeholder="搜索周期 / 项目"
                class="w-full sm:max-w-md"
              />
              <USelect
                v-model="status"
                :items="statusOptions"
                class="w-full sm:w-36"
              />
            </div>
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              @click="openCreateCycle"
            >
              新建周期
            </UButton>
          </div>
        </UCard>

        <UCard>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              @select="handleCycleSelect"
            >
              <template #status_label-cell="{ row }">
                <UBadge
                  :color="color(row.original.status)"
                  variant="soft"
                >
                  {{ row.original.status_label }}
                </UBadge>
              </template>
            </UTable>
          </div>
        </UCard>

        <UModal
          v-model:open="createOpen"
          title="新建绩效周期"
          :ui="{ content: 'sm:max-w-2xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="handleCreateCycle"
            >
              <div class="grid gap-3 md:grid-cols-2">
                <UFormField
                  label="周期名称"
                  required
                >
                  <UInput
                    v-model="createForm.cycleName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="周期编码">
                  <UInput
                    v-model="createForm.cycleCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="周期类型">
                  <USelect
                    v-model="createForm.cycleType"
                    :items="cycleTypeOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="范围">
                  <USelect
                    v-model="createForm.scopeType"
                    :items="scopeTypeOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  v-if="createForm.scopeType === 'project'"
                  label="项目编码"
                  required
                >
                  <UInput
                    v-model="createForm.projectCode"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="开始日期"
                  required
                >
                  <UInput
                    v-model="createForm.periodStart"
                    type="date"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="结束日期"
                  required
                >
                  <UInput
                    v-model="createForm.periodEnd"
                    type="date"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="createOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  type="submit"
                  color="primary"
                  icon="i-lucide-save"
                  :loading="creating"
                >
                  保存
                </UButton>
              </div>
            </form>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
