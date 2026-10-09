<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { financeSettings, settingsFieldLabels, settingsEnums, settingsPayload, type FinanceSettingsKind } from '../../utils/hostFinanceSettings'
import { createFinanceIntent } from '../../utils/hostFinanceForms'
import { ledgerWriteMessage } from '../../utils/hostFinanceLedger'

const props = defineProps<{ kind: FinanceSettingsKind, formMode?: boolean }>()
const { hosted, moduleUrl, apiUrl, sessionScope } = useFinanceModule()
const route = useRoute()
const router = useRouter()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission('settings', 'admin'))
const config = computed(() => financeSettings[props.kind])
const readOnly = computed(() => config.value.fields.length === 0)
const code = computed(() => String(route.params.code || ''))
const { search, debounced: debouncedSearch } = useDebouncedSearch()
const page = ref(1)
const pending = ref(false)
const saving = ref(false)
const loadError = ref('')
const saveError = ref('')
const rows = ref<Array<Record<string, unknown>>>([])
const total = ref(0)
const original = ref<Record<string, unknown> | null>(null)
const comparison = ref<Record<string, unknown> | null>(null)
const form = reactive<Record<string, unknown>>({ status: 'active', sortNo: '0', reimbursable: true, isContractIncome: true })
const intent = createFinanceIntent()
const toast = useToast()
const { confirm } = useConfirm()
let frozen: Record<string, unknown> | null = null
let generation = 0
const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
const identity = (row: Record<string, unknown>) => String(row.code || row.id || '')
const columns = computed(() => props.kind === 'audit-logs'
  ? [{ accessorKey: 'entity_code', header: '对象' }, { accessorKey: 'action', header: '动作' }, { accessorKey: 'operator_uid', header: '操作者' }, { accessorKey: 'created_at', header: '时间' }]
  : props.kind === 'approval-instances'
    ? [{ accessorKey: 'code', header: '单据' }, { accessorKey: 'entity_type', header: '类型' }, { accessorKey: 'workflow_instance_id', header: '审批实例' }, { accessorKey: 'status', header: '状态' }]
    : [{ accessorKey: props.kind === 'subject-mappings' ? 'id' : 'code', header: '编码' }, { accessorKey: props.kind === 'subject-mappings' ? 'default_subject_code' : 'name', header: '名称 / 科目' }, { accessorKey: 'status', header: '状态' }, { id: 'actions', header: '操作' }])
async function load(compare = false) {
  const epoch = ++generation
  if (!allowed.value || (props.formMode && !code.value)) return
  pending.value = true
  loadError.value = ''
  try {
    const response = await $fetch<{ data: Array<Record<string, unknown>>, total: number }>(apiUrl(config.value.path), { query: props.formMode ? { code: code.value, page: 1, pageSize: 1 } : { search: debouncedSearch.value, page: page.value, pageSize: 20 }, retry: 0 })
    if (epoch !== generation) return
    if (props.formMode) {
      const row = response.data.find(row => identity(row) === code.value)
      if (!row) throw new Error('not found')
      if (compare) comparison.value = row
      else {
        original.value = row
        for (const field of config.value.fields) {
          const value = row[snake(field)]
          form[field] = ['reimbursable', 'isContractIncome'].includes(field) ? Number(value) === 1 : field === 'requiredDimensions' ? (Array.isArray(value) ? value : JSON.parse(String(value || '[]'))).join(',') : String(value ?? '')
        }
      }
    } else {
      rows.value = response.data
      total.value = response.total
    }
  } catch {
    if (epoch === generation) loadError.value = '加载失败，请重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch(debouncedSearch, () => {
  page.value = 1
})
watch(() => [allowed.value, sessionScope?.value, code.value, props.kind], () => {
  generation++
  frozen = null
  intent.reset()
  original.value = null
  comparison.value = null
  rows.value = []
  total.value = 0
  Object.keys(form).forEach(key => Reflect.deleteProperty(form, key))
  Object.assign(form, { status: 'active', sortNo: '0', reimbursable: true, isContractIncome: true })
  saveError.value = ''
  saving.value = false
  void load()
}, { immediate: true })
watch(() => [page.value, debouncedSearch.value], () => {
  void load()
})
onMounted(() => {
  void loadPermissions()
})
onScopeDispose(() => {
  generation++
})
function useComparedVersion() {
  if (!comparison.value || frozen) return
  original.value = comparison.value
  comparison.value = null
  intent.reset()
}
async function save() {
  if (!allowed.value || saving.value || (code.value && !original.value)) return
  if (!frozen && form.status === 'inactive' && !await confirm({ title: `停用${String(form.name || code.value || config.value.title)}`, message: '停用后不能在新的财务单据中选用，已有记录保留。', color: 'warning', confirmLabel: '停用并保存' })) return
  const epoch = generation
  saving.value = true
  saveError.value = ''
  try {
    frozen ||= settingsPayload(props.kind, form, !!code.value, Number(original.value?.row_version))
    await $fetch(apiUrl(`${config.value.path}${code.value ? `/${encodeURIComponent(code.value)}` : ''}`), { method: code.value ? 'PATCH' : 'POST', body: frozen, headers: { 'Idempotency-Key': intent.key(frozen) }, retry: 0 })
    if (epoch !== generation) return
    toast.add({ title: `${config.value.title}已保存`, color: 'success' })
    await router.push(moduleUrl(config.value.path))
  } catch (error) {
    if (epoch !== generation) return
    saveError.value = ledgerWriteMessage(error)
    const status = (error as { statusCode?: number, response?: { status?: number } }).statusCode || (error as { response?: { status?: number } }).response?.status
    if (status && status >= 400 && status < 500) {
      frozen = null
      intent.reset()
      if (status === 409) await load(true)
    }
    toast.add({ title: saveError.value, color: 'error' })
  } finally {
    if (epoch === generation) saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel :id="`finance-${kind}`">
    <template #body>
      <div class="space-y-4 p-4 sm:p-6">
        <ContentPageHeader
          :hosted="hosted"
          :title="`${config.title}${formMode ? code ? '编辑' : '新建' : ''}`"
        >
          <template #actions>
            <UButton
              v-if="formMode"
              color="neutral"
              variant="outline"
              :to="moduleUrl(config.path)"
            >
              返回列表
            </UButton>
            <UButton
              v-else-if="allowed && !readOnly"
              :to="moduleUrl(`${config.path}/new`)"
            >
              新建
            </UButton>
          </template>
        </ContentPageHeader>
        <CommonEmptyState
          v-if="!loaded"
          title="正在加载权限"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
          description="请重试"
        >
          <template #actions>
            <UButton @click="loadPermissions()">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
          description="此页面需要财务设置管理权限"
        />
        <CommonEmptyState
          v-else-if="loadError && (!formMode || !original)"
          title="加载失败"
          :description="loadError"
        >
          <template #actions>
            <UButton @click="load()">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <template v-else-if="!formMode">
          <UInput
            v-model="search"
            placeholder="搜索编码"
            aria-label="搜索编码"
            class="w-full sm:w-80"
          />
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
            class="hidden sm:block"
          >
            <template #empty>
              <CommonEmptyState title="暂无记录" />
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ row.original.status === 'active' ? '有效' : row.original.status === 'inactive' ? '停用' : row.original.status }}
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :to="moduleUrl(`${config.path}/${identity(row.original)}/edit`)"
              >
                编辑
              </UButton>
            </template>
          </UTable>
          <div class="space-y-2 sm:hidden">
            <CommonEmptyState
              v-if="pending"
              title="正在加载"
            />
            <CommonEmptyState
              v-if="!pending && !rows.length"
              title="暂无记录"
            />
            <div
              v-for="row in rows"
              :key="String(row.id || row.code)"
              class="space-y-2 rounded-lg border border-default p-3"
            >
              <div
                v-for="column in columns.filter(c => c.accessorKey)"
                :key="column.accessorKey"
                class="break-words text-sm"
              >
                {{ column.header }}：{{ row[column.accessorKey!] }}
              </div>
              <UButton
                v-if="!readOnly"
                size="xs"
                :to="moduleUrl(`${config.path}/${identity(row)}/edit`)"
              >
                编辑
              </UButton>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
              v-model:page="page"
              :total="total"
              :items-per-page="20"
            />
          </div>
        </template>
        <form
          v-else
          class="max-w-[720px] space-y-4"
          @submit.prevent="save"
        >
          <CommonEmptyState
            v-if="pending"
            title="正在加载"
          />
          <template v-else>
            <UAlert
              v-if="loadError"
              color="warning"
              :title="loadError"
              description="本地草稿保留，请重新刷新比较。"
            />
            <UFormField
              v-for="field in config.fields"
              :key="field"
              :label="settingsFieldLabels[field]"
            >
              <USwitch
                v-if="['reimbursable', 'isContractIncome'].includes(field)"
                :model-value="!!form[field]"
                :disabled="saving || !!frozen"
                @update:model-value="form[field] = $event"
              />
              <USelect
                v-else-if="settingsEnums[field]"
                v-model="form[field] as string"
                :items="settingsEnums[field]"
                :disabled="saving || !!frozen"
                class="w-full"
              />
              <UInput
                v-else
                v-model="form[field] as string"
                :disabled="saving || !!frozen || !!code && field === 'code'"
                class="w-full"
              />
            </UFormField>
            <UAlert
              v-if="saveError"
              color="warning"
              :title="saveError"
            />
            <UCard v-if="comparison">
              <p class="mb-2 font-medium">
                当前服务端内容（草稿保留）
              </p>
              <div
                v-for="field in config.fields"
                :key="field"
                class="break-words text-sm"
              >
                {{ settingsFieldLabels[field] }}：{{ comparison[snake(field)] }}
              </div>
              <UButton
                class="mt-3"
                color="neutral"
                variant="outline"
                @click="useComparedVersion"
              >
                沿用此版本继续编辑草稿
              </UButton>
            </UCard>
            <div class="flex flex-wrap gap-2">
              <UButton
                type="submit"
                :loading="saving"
                :disabled="!!code && !original"
              >
                {{ frozen ? '沿用原请求重试' : '保存' }}
              </UButton><UButton
                v-if="code"
                color="neutral"
                variant="outline"
                @click="load(true)"
              >
                刷新比较
              </UButton>
            </div>
          </template>
        </form>
      </div>
    </template>
  </UDashboardPanel>
</template>
