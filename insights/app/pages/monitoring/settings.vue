<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, reactive, computed, onMounted } from 'vue'

const { apiBase } = useApiBase()

const UCheckbox = resolveComponent('UCheckbox')
const toast = useToast()

const state = ref({
  monitoring_start_date: '',
  monitoring_last_trigger_date: '',
  monitoring_commit_files_threshold: '',
  monitoring_commit_files_size_threshold: '',
  monitoring_commit_unexcepted_files_threshold: '',
  monitoring_commit_duplicate_files_threshold: '',
  monitoring_commit_code_lines_threshold: '',
  monitoring_commit_code_quality_threshold: '',
  monitoring_commit_submission_quality_threshold: '',
  monitoring_repo_daily_commits_threshold: '',
  monitoring_repo_daily_code_lines_threshold: '',
  monitoring_repo_daily_files_threshold: '',
  monitoring_repo_daily_file_size_threshold: ''
})

const fileSizeThresholdMB = ref('')
const dailyFileSizeThresholdMB = ref('')

function bytesToMB(bytes: string | number): string {
  const b = Number(bytes) || 0
  return b > 0 ? (b / (1024 * 1024)).toFixed(2) : ''
}

function mbToBytes(mb: string | number): string {
  const m = Number(mb) || 0
  return m > 0 ? Math.round(m * 1024 * 1024).toString() : ''
}

interface Person {
  id: number
  parentId: number | null
  username: string
  realName: string | null
  email: string | null
  departmentId: number | null
  isActive: boolean
}

interface Department { id: number, name: string, isActive: boolean }

const { data: departmentsData } = useFetch<{ data: Department[] }>(`${apiBase}/departments`)
const departments = computed(() => departmentsData.value?.data ?? [])
const getDepartmentName = (id: number | null) => departments.value.find(d => d.id === id)?.name ?? '未分配'

const persons = ref<Person[]>([])
const coders = ref<Person[]>([])
const personsRowSelection = ref({})
const codersRowSelection = ref({})
const getRowId = (row: Person) => String(row.id)
const loading = ref(false)

async function getPersons(isCoder: boolean | undefined = undefined) {
  loading.value = true
  let personsResult: Person[] = []
  try {
    const params: Record<string, string | number> = { onlyPrimary: '1', isActive: '1' }
    if (typeof isCoder === 'boolean') params.isCoder = isCoder ? '1' : '0'
    const result = await $fetch<Person[]>(`${apiBase}/contributors`, { params })
    if (Array.isArray(result)) personsResult = result
    else if (result && typeof result === 'object' && Array.isArray((result as any).data)) personsResult = (result as any).data
  } catch (error: unknown) {
    toast.add({ title: '加载失败', description: error instanceof Error ? error.message : '无法加载贡献者列表', color: 'error' })
  } finally {
    loading.value = false
  }
  return personsResult
}

async function loadPersons() {
  await getPersons(false).then((result) => { persons.value = [...result].sort((a, b) => a.username.localeCompare(b.username)) })
}

async function loadCoders() {
  await getPersons(true).then((result) => { coders.value = [...result].sort((a, b) => a.username.localeCompare(b.username)) })
}

async function loadData() {
  loading.value = true
  try {
    const data = await $fetch(`${apiBase}/settings/monitoring`) as any
    if (data.monitoring_start_date) data.monitoring_start_date = data.monitoring_start_date.substring(0, 10)
    Object.assign(state.value, data)
    fileSizeThresholdMB.value = bytesToMB(state.value.monitoring_commit_files_size_threshold)
    dailyFileSizeThresholdMB.value = bytesToMB(state.value.monitoring_repo_daily_file_size_threshold)
    await loadPersons()
    await loadCoders()
  } catch (e) {
    toast.add({ title: '加载失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

const columns: TableColumn<Person>[] = [
  { id: 'select', header: ({ table }) => h(UCheckbox, { 'modelValue': table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected(), 'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!value) }), cell: ({ row }) => h(UCheckbox, { 'modelValue': row.getIsSelected(), 'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value) }) },
  { accessorKey: 'username', header: '用户名' },
  { accessorKey: 'realName', header: '姓名' },
  { accessorKey: 'department', header: '部门', cell: ({ row }) => getDepartmentName(row.original.departmentId) }
]

async function save() {
  loading.value = true
  try {
    const dataToSave = { ...state.value, monitoring_commit_files_size_threshold: mbToBytes(fileSizeThresholdMB.value), monitoring_repo_daily_file_size_threshold: mbToBytes(dailyFileSizeThresholdMB.value) }
    await ($fetch as any)(`${apiBase}/settings/monitoring`, { method: 'PUT', body: dataToSave })
    toast.add({ title: '保存成功', color: 'success' })
  } catch (e) {
    toast.add({ title: '保存失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function moveToCoders() {
  const selectedIds = Object.keys(personsRowSelection.value).map(Number)
  if (selectedIds.length === 0) return
  try {
    loading.value = true
    await ($fetch as any)(`${apiBase}/persons`, { method: 'PATCH', body: { personIds: selectedIds, isCoder: true } })
    personsRowSelection.value = {}
    await loadPersons()
    await loadCoders()
    toast.add({ title: '更新成功', description: `已将 ${selectedIds.length} 人设置为程序员`, color: 'success' })
  } catch (error) {
    toast.add({ title: '更新失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function moveToPersons() {
  const selectedIds = Object.keys(codersRowSelection.value).map(Number)
  if (selectedIds.length === 0) return
  try {
    loading.value = true
    await ($fetch as any)(`${apiBase}/persons`, { method: 'PATCH', body: { personIds: selectedIds, isCoder: false } })
    codersRowSelection.value = {}
    await loadPersons()
    await loadCoders()
    toast.add({ title: '更新成功', description: `已将 ${selectedIds.length} 人移出程序员列表`, color: 'success' })
  } catch (error) {
    toast.add({ title: '更新失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(() => { loadData() })
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="异动监控设置">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          label="保存配置"
          size="sm"
          icon="i-lucide-save"
          :loading="loading"
          @click="save"
        />
      </template>
    </UDashboardNavbar>

    <div class="grid grid-cols-2 gap-4 px-4 py-2">
      <div>
        <UCard :ui="{ root: 'px-4', header: 'py-2' }">
          <template #header>
            <h3 class="text-base font-semibold leading-6 text-secondary py-0">
              全局配置
            </h3>
          </template>
          <div class="px-6">
            <UFormField
              label="监控起始日期"
              description="回溯扫描的起点"
              :ui="{ root: 'flex items-center justify-between' }"
            >
              <UInput
                v-model="state.monitoring_start_date"
                type="date"
              />
            </UFormField>
          </div>
        </UCard>

        <UCard
          :ui="{ root: 'px-4', header: 'py-2', body: 'py-0' }"
          class="mt-3"
        >
          <template #header>
            <h3 class="text-base font-semibold leading-6 text-secondary py-0">
              仓库日均阈值
            </h3>
          </template>
          <template #default>
            <div class="px-6">
              <UFormField
                label="单日提交频次"
                :ui="{ root: 'flex items-center justify-between' }"
              >
                <UInput
                  v-model="state.monitoring_repo_daily_commits_threshold"
                  type="number"
                />
              </UFormField>
              <UFormField
                label="单日提交代码行数"
                :ui="{ root: 'flex items-center justify-between' }"
              >
                <UInput
                  v-model="state.monitoring_repo_daily_code_lines_threshold"
                  type="number"
                />
              </UFormField>
              <UFormField
                label="单日提交文件数"
                :ui="{ root: 'flex items-center justify-between' }"
              >
                <UInput
                  v-model="state.monitoring_repo_daily_files_threshold"
                  type="number"
                />
              </UFormField>
              <UFormField
                label="单日提交文件规模 (MB)"
                :ui="{ root: 'flex items-center justify-between' }"
              >
                <UInput
                  v-model="dailyFileSizeThresholdMB"
                  type="number"
                  step="0.01"
                >
                  <template #trailing>
                    <span
                      class="text-gray-500 dark:text-gray-400 text-xs"
                    >MB</span>
                  </template>
                </UInput>
              </UFormField>
            </div>
          </template>
        </UCard>
      </div>

      <UCard :ui="{ root: 'px-4', header: 'py-2', body: 'py-0' }">
        <template #header>
          <h3 class="text-base font-semibold leading-6 text-secondary py-0">
            单次提交阈值
          </h3>
        </template>
        <template #default>
          <div class="px-6">
            <UFormField
              label="文件数阈值"
              description="单次提交文件数量上限"
              :ui="{ root: 'flex items-center justify-between' }"
            >
              <UInput
                v-model="state.monitoring_commit_files_threshold"
                type="number"
              />
            </UFormField>
            <UFormField
              label="文件规模阈值 (MB)"
              description="单次提交总大小上限"
              :ui="{ root: 'flex items-center justify-between' }"
              class="mt-2"
            >
              <UInput
                v-model="fileSizeThresholdMB"
                type="number"
                step="0.01"
              >
                <template #trailing>
                  <span
                    class="text-gray-500 dark:text-gray-400 text-xs"
                  >MB</span>
                </template>
              </UInput>
            </UFormField>
            <UFormField
              label="代码行数阈值"
              description="单次提交代码行数上限"
              :ui="{ root: 'flex items-center justify-between' }"
              class="mt-2"
            >
              <UInput
                v-model="state.monitoring_commit_code_lines_threshold"
                type="number"
              />
            </UFormField>
            <UFormField
              label="提交质量评分阈值"
              description="低于此分数视为异常 (0-100)"
              :ui="{ root: 'flex items-center justify-between' }"
              class="mt-2"
            >
              <UInput
                v-model="state.monitoring_commit_submission_quality_threshold"
                type="number"
                max="100"
              />
            </UFormField>
          </div>
        </template>
      </UCard>
    </div>

    <div class="grid grid-cols-1 gap-4 px-4 py-1 h-[calc(100vh-450px)]">
      <UCard
        :ui="{ root: 'px-4 py-0', header: 'py-2', body: 'py-0' }"
        class="h-full"
      >
        <template #header>
          <h3 class="text-base font-semibold leading-6 text-secondary py-0">
            选择程序员
          </h3>
        </template>
        <div class="flex flex-row gap-4 p-4">
          <div class="basis-5/11">
            <span>待选人员列表({{ persons.length }})</span>
            <UTable
              v-model:row-selection="personsRowSelection"
              :columns="columns"
              :data="persons"
              sticky
              class="w-full h-[calc(100vh-580px)]"
              :get-row-id="getRowId"
            />
          </div>
          <div class="basis-1/11 gap-2 flex items-center justify-center h-[calc(100vh-580px)]">
            <div>
              <div class="w-full flex items-center justify-center p-2">
                <UButton
                  icon="i-lucide-chevrons-right"
                  size="sm"
                  :disabled="!Object.keys(personsRowSelection).length"
                  @click="moveToCoders"
                />
              </div>
              <div class="w-full flex items-center justify-center p-2">
                <UButton
                  icon="i-lucide-chevrons-left"
                  size="sm"
                  :disabled="!Object.keys(codersRowSelection).length"
                  @click="moveToPersons"
                />
              </div>
            </div>
          </div>
          <div class="basis-5/11">
            <span>已选程序员列表({{ coders.length }})</span>
            <UTable
              v-model:row-selection="codersRowSelection"
              :columns="columns"
              :data="coders"
              sticky
              class="w-full h-[calc(100vh-580px)]"
              :get-row-id="getRowId"
            />
          </div>
        </div>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
