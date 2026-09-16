<script setup lang="ts">
import type { ApiResponse, ListResponse, PerformanceCycle } from '~/types'

const { label, color, date } = usePeopleFormat()
usePageTitle('绩效周期')
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()

const page = ref(1)
const pageSize = ref(20)
const { search: keyword, debounced: debouncedKeyword } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const status = ref('all')

watch(status, () => {
  page.value = 1
})
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
  page: page.value,
  page_size: pageSize.value,
  keyword: debouncedKeyword.value || undefined,
  status: status.value === 'all' ? undefined : status.value
}))

const { data: response, error, refresh, status: fetchStatus } = await useLazyFetch<ApiResponse<ListResponse<PerformanceCycle>>>('/api/v1/performance-cycles', {
  query,
  watch: [query]
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const total = computed(() => response.value?.data.total || 0)

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  cycle_type_label: label(item.cycle_type),
  scope_type_label: label(item.scope_type),
  period: `${date(item.period_start)} ~ ${date(item.period_end)}`,
  status_label: label(item.status)
})))

const columns = [
  { accessorKey: 'cycle_code', header: '周期编码' },
  { accessorKey: 'cycle_name', header: '名称' },
  { accessorKey: 'cycle_type_label', header: '类型' },
  { accessorKey: 'scope_type_label', header: '范围' },
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
        projectCode: createForm.scopeType === 'project' ? createForm.projectCode : ''
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
              :loading="fetchStatus === 'pending'"
              :ui="selectableTableUi"
              @select="handleCycleSelect"
            >
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-target"
                  title="暂无绩效周期"
                />
              </template>
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

          <div
            v-if="total > 0"
            class="flex items-center justify-between border-t border-default px-4 py-3"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
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
