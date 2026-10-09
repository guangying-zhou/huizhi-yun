<script setup lang="ts">
import W3BalanceEvidence from './W3BalanceEvidence.vue'
import FinanceBalanceAsOf from './FinanceBalanceAsOf.vue'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useHostDirectoryLabels } from '../../../../foundation/app/composables/useHostDirectoryLabels'
import UserTreeSelector from '../../../../foundation/app/components/UserTreeSelector.vue'
import W3QueueObjectSelect from './W3QueueObjectSelect.vue'
import { createReviewMutationIntent } from '@hzy/foundation/shared/utils/reviewMutationIntent'
import { queueOptionalColumns, queueColumnPreference, queueNextStep, queueKinds, queueStatuses, queueMethodLabels, queueConflictCodes, queueError, queueMethods, queueQuery, queuePage, queueApplyResult, queueDetail, queueResolvePayload, identityMethods, type QueueRow, type QueueApp } from '../../utils/w3MigrationQueue'
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{
  app: QueueApp
}>()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const scope = useState<string>('enterprise-cache-scope', () => '')
const canView = computed(() => loaded.value && !permissionError.value && hasPermission('migration_exceptions', 'view'))
const canResolve = computed(() => canView.value && hasPermission('migration_exceptions', 'resolve'))
const customerEdit = computed(() => props.app === 'altoc' && hasPermission('customer', 'edit'))
const contractEdit = computed(() => props.app === 'altoc' && hasPermission('contract', 'edit'))
const view = ref(props.app === 'altoc' ? 'identities' : 'exceptions')
const kind = ref(props.app === 'altoc' ? 'owner_unmatched' : 'contract_balance_mismatch')
const status = ref(props.app === 'altoc' ? 'unmatched' : 'open')
const pageSize = ref(20)
const visibleColumns = ref(['created_at'])
const balancesOpen = ref(false)
const createdFrom = ref(''), createdTo = ref(''), queueSort = ref('id_asc')
const { search: objectSearch, debounced: objectDebounced, flush: flushObjectSearch } = useDebouncedSearch({ initial: '', onChange: () => {
  page.value = 1
} })
const evidence = ref<QueueRow | null>(null)
const evidenceOpen = ref(false)
const evidenceTab = ref('problem')
const eventPage = ref(1), eventTotal = ref(0), events = ref<QueueRow[]>([]), eventsPending = ref(false), eventsError = ref('')
let eventEpoch = 0
async function loadEvents() {
  const epoch = ++eventEpoch
  eventsError.value = ''
  if (!evidenceOpen.value || !evidence.value || evidenceTab.value !== 'source' || !canView.value || !scope.value) {
    events.value = []
    eventTotal.value = 0
    eventsPending.value = false
    return
  }
  const eventsFor = evidence.value.source_user_id ? `identity:${String(evidence.value.source_user_id)}` : `exception:${String(evidence.value.id)}`
  eventsPending.value = true
  try {
    const result = queuePage(await $fetch(`/${props.app}/api/v1/migration/exceptions`, { query: { eventsFor, page: eventPage.value, pageSize: 20 }, retry: 0 }))
    if (epoch === eventEpoch) {
      events.value = result.rows
      eventTotal.value = result.total
    }
  } catch (failure) {
    if (epoch === eventEpoch) {
      eventsError.value = queueError(failure)
      events.value = []
      eventTotal.value = 0
    }
  } finally {
    if (epoch === eventEpoch)
      eventsPending.value = false
  }
}
watch([evidenceOpen, evidenceTab, eventPage, canView, scope], () => void loadEvents())
const eventLabels: Record<string, string> = { accept: '接受现状', reopen: '重新打开', mark_done: '核对完成', assign_customer: '归属客户', link_existing: '关联联系人', record_balance: '登记余额', confirm: '确认匹配', reject: '无对应人员', apply: '应用到名下对象' }
const evidenceTabs = [{ label: '问题与下一步', value: 'problem' }, { label: '来源与处理', value: 'source' }]
const optionalColumns = queueOptionalColumns
function preferenceKey(value: string) {
  return `apf-migration-columns:v1:${props.app}:${value}`
}
function saveListView() {
  if (!scope.value || !canView.value)
    return
  try {
    window.localStorage.setItem(preferenceKey(scope.value), JSON.stringify({ columns: visibleColumns.value }))
    toast.add({ title: '已保存本机显示列', color: 'success' })
  } catch {
    toast.add({ title: '无法保存本机视图', color: 'error' })
  }
}
function showEvidence(row: QueueRow) {
  evidence.value = row
  evidenceTab.value = 'problem'
  eventPage.value = 1
  events.value = []
  evidenceOpen.value = true
}
function nextStep(row: QueueRow) {
  return queueNextStep(row, view.value, canResolve.value, customerEdit.value, contractEdit.value)
}
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const rows = ref<QueueRow[]>([])
const total = ref(0)
const directoryUids = computed(() => props.app === 'altoc' && canView.value ? [...rows.value.map(row => String(row.directory_uid || '')), ...events.value.map(row => String(row.operator_uid || ''))] : [])
const { userName, userDepartment, directoryError, refresh: refreshDirectory } = useHostDirectoryLabels(directoryUids, computed(() => props.app === 'altoc' && canView.value))
const applicationPrompt = ref<QueueRow | null>(null)
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const error = ref('')
const searchable = computed(() => view.value === 'identities' || kind.value === 'contact_without_customer')
const activeTab = computed(() => view.value === 'identities' || kind.value === 'owner_unmatched' ? 'people' : kind.value === 'contact_without_customer' ? 'contacts' : 'others')
const countError = ref('')
const filters = computed(() => Object.entries(queueKinds[props.app]).filter(([value]) => props.app === 'finance' || !['owner_unmatched', 'contact_without_customer'].includes(value)).map(([value, label]) => ({ value, label: `${label} · ${counts.value[value] ?? '—'}` })))
const statusOptions = computed(() => ['exceptions' === view.value ? ['open', 'resolved', 'accepted', 'superseded'] : ['candidate', 'confirmed', 'rejected', 'unmatched', 'source_missing']].flat().map(value => ({ value, label: queueStatuses[value] || value })))
const baseColumns = computed<TableColumn<QueueRow>[]>(() => view.value === 'identities' ? [{ accessorKey: 'display_name', header: '源人员' }, { accessorKey: 'source_user_id', header: '源标识' }, { accessorKey: 'open_owner_items', header: '在办对象', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }, { id: 'match', header: '候选目录用户 / 源状态' }, { id: 'status', header: '状态' }, { id: 'actions', header: '操作' }] : [{ id: 'object', header: '事项 / 对象' }, { id: 'details', header: '待核对内容' }, { id: 'status', header: '状态' }, { id: 'actions', header: '操作' }])
const columns = computed<TableColumn<QueueRow>[]>(() => [...baseColumns.value.slice(0, -1), { id: 'next', header: '建议下一步' }, ...optionalColumns.filter(column => visibleColumns.value.includes(column.key)).map(column => ({ accessorKey: column.key, header: column.label })), baseColumns.value[baseColumns.value.length - 1]!])
watch(scope, (value, old) => {
  if (typeof window === 'undefined')
    return
  try {
    if (old && old !== value)
      window.localStorage.removeItem(preferenceKey(old))
    visibleColumns.value = queueColumnPreference(value ? JSON.parse(window.localStorage.getItem(preferenceKey(value)) || 'null') : null)
  } catch {
    visibleColumns.value = ['created_at']
  }
}, { immediate: true })
let generation = 0
async function load() {
  const token = ++generation
  loading.value = false
  error.value = ''
  if (!canView.value || !scope.value) {
    rows.value = []
    total.value = 0
    return
  }
  if (createdFrom.value && createdTo.value && createdFrom.value > createdTo.value) {
    error.value = '起始迁入日期不能晚于截止日期'
    return
  }
  loading.value = true
  try {
    const response = await $fetch(`/${props.app}/api/v1/migration/${view.value}`, { query: { ...queueQuery(view.value, kind.value, status.value === 'all' ? '' : status.value, page.value, debounced.value, pageSize.value), ...(view.value === 'exceptions' ? { ...(objectDebounced.value ? { objectSearch: objectDebounced.value } : {}), ...(createdFrom.value ? { createdFrom: createdFrom.value } : {}), ...(createdTo.value ? { createdTo: createdTo.value } : {}), ...(queueSort.value !== 'id_asc' ? { sort: queueSort.value } : {}) } : {}) }, retry: 0 })
    if (token !== generation)
      return
    const result = queuePage(response)
    rows.value = result.rows
    total.value = result.total
    if (view.value === 'exceptions')
      counts.value = result.openCounts
    else {
      countError.value = ''
      try {
        const countResponse = await $fetch('/altoc/api/v1/migration/exceptions', { query: { page: 1, pageSize: 1 }, retry: 0 })
        if (token === generation)
          counts.value = queuePage(countResponse).openCounts
      } catch {
        if (token === generation)
          countError.value = '异常事项数量未能加载，请刷新重试'
      }
    }
  } catch (failure) {
    if (token === generation) {
      error.value = queueError(failure)
      if (Number((failure as {
        statusCode?: number
      }).statusCode) === 403) {
        rows.value = []
        total.value = 0
      }
    }
  } finally {
    if (token === generation)
      loading.value = false
  }
}
watch([view, kind], () => {
  page.value = 1
  status.value = view.value === 'identities' ? 'unmatched' : 'open'
  search.value = ''
})
watch([status, pageSize, createdFrom, createdTo, queueSort], () => {
  page.value = 1
})
watch([canView, scope, view, kind, status, pageSize, page, objectDebounced, createdFrom, createdTo, queueSort, () => searchable.value ? debounced.value : ''], () => void load(), { immediate: true })
onMounted(async () => {
  const route = useRoute()
  const router = useRouter()
  const q = route.query
  if (q.view === 'exceptions' || (props.app === 'altoc' && q.view === 'identities')) view.value = q.view
  if (typeof q.kind === 'string' && Object.hasOwn(queueKinds[props.app], q.kind)) kind.value = q.kind
  await nextTick()
  if (typeof q.status === 'string' && (q.status === 'all' || q.status.split(',').every(value => Object.hasOwn(queueStatuses, value)))) status.value = q.status
  if (['20', '50', '100'].includes(String(q.pageSize))) pageSize.value = Number(q.pageSize)
  if (/^[1-9]\d{0,5}$/.test(String(q.page))) page.value = Number(q.page)
  if (typeof q.search === 'string') search.value = q.search.slice(0, 100)
  if (typeof q.objectSearch === 'string') objectSearch.value = q.objectSearch.slice(0, 100)
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.createdFrom))) createdFrom.value = String(q.createdFrom)
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.createdTo))) createdTo.value = String(q.createdTo)
  if (q.sort === 'created_asc' || q.sort === 'created_desc') queueSort.value = q.sort
  watch([view, kind, status, pageSize, page, debounced, objectDebounced, createdFrom, createdTo, queueSort], () => {
    void router.replace({ query: { ...route.query, view: view.value, kind: kind.value, status: status.value, page: String(page.value), pageSize: String(pageSize.value), search: debounced.value || undefined, objectSearch: objectDebounced.value || undefined, createdFrom: createdFrom.value || undefined, createdTo: createdTo.value || undefined, sort: queueSort.value === 'id_asc' ? undefined : queueSort.value } })
  })
  flush()
  flushObjectSearch()
  await nextTick()
  if (/^[1-9]\d{0,5}$/.test(String(q.page))) page.value = Number(q.page)
  void loadPermissions()
})
onScopeDispose(() => {
  generation++
  eventEpoch++
})
const selected = ref<QueueRow | null>(null)
const selectedView = ref('exceptions')
const method = ref('')
const open = ref(false)
const saving = ref(false)
const writeError = ref('')
const duplicateContact = ref(false)
const comparison = ref<QueueRow | null>(null)
const draft = reactive<Record<string, string>>({ reason: '', customerId: '', contactCode: '', accountCode: '', amount: '', directoryUid: '' })
const userUids = computed({ get: () => draft.directoryUid ? [draft.directoryUid] : [], set: (uids: string[]) => {
  draft.directoryUid = uids[0] || ''
} })
let intent = createReviewMutationIntent('migration-review', queueConflictCodes)
const { confirm } = useConfirm()
const toast = useToast()
const applyResult = ref<{
  resolved?: number
  remaining?: number
  items?: QueueRow[]
} | null>(null)
const amounts = computed(() => ((selected.value?.detail as {
  latestAmounts?: unknown[]
})?.latestAmounts || []).filter(value => typeof value === 'string').map(value => ({ value: String(value), label: String(value) })))
function selectTab(tab: string) {
  if (tab === 'people')
    view.value = 'identities'
  else {
    view.value = 'exceptions'
    kind.value = tab === 'contacts' ? 'contact_without_customer' : props.app === 'altoc' ? 'contact_orphan' : tab
  }
}
function available(row: QueueRow, reviewView = view.value) {
  return reviewView === 'identities' ? identityMethods(row, canResolve.value, customerEdit.value, contractEdit.value) : queueMethods(row, canResolve.value, customerEdit.value)
}
function begin(row: QueueRow, next: string, reviewView = view.value) {
  if (saving.value)
    return
  if (intent.uncertain) {
    open.value = true
    return
  }
  selectedView.value = reviewView
  selected.value = { ...row }
  method.value = next
  Object.assign(draft, { reason: '', customerId: '', contactCode: '', accountCode: '', amount: '', directoryUid: row.directory_uid && row.directory_uid !== 'system:unassigned' ? String(row.directory_uid) : '' })
  comparison.value = null
  writeError.value = ''
  applyResult.value = null
  intent.reset()
  open.value = true
}
async function refreshComparison() {
  await load()
  if (!selected.value)
    return
  comparison.value = rows.value.find(row => selectedView.value === 'identities' ? row.source_user_id === selected.value?.source_user_id : row.id === selected.value?.id) || null
  if (!comparison.value)
    writeError.value += '；该事项已不在当前筛选页，请调整筛选查看最新记录'
}
function adoptVersion() {
  if (!comparison.value || intent.uncertain)
    return
  selected.value = { ...comparison.value }
  comparison.value = null
  intent.reset()
  writeError.value = '已采用最新版本，填写内容已保留，请重新确认'
}
async function save() {
  if (!selected.value || saving.value || !available(selected.value, selectedView.value).includes(method.value))
    return
  const token = generation
  const writeScope = scope.value
  const row = selected.value
  let body: Record<string, unknown>
  let path: string
  try {
    if (selectedView.value === 'identities') {
      path = `/altoc/api/v1/migration/identities/${encodeURIComponent(String(row.source_user_id))}/${method.value}`
      body = method.value === 'apply' ? { limit: 100 } : { expectedStatus: row.match_status, ...(method.value === 'confirm' ? { directoryUid: draft.directoryUid } : {}) }
      if (method.value === 'confirm' && (!draft.directoryUid || draft.directoryUid === 'system:unassigned'))
        throw Error('请选择在职目录用户')
    } else {
      path = `/${props.app}/api/v1/migration/exceptions/${encodeURIComponent(String(row.id))}/resolve`
      body = queueResolvePayload(row, method.value, draft)
    }
  } catch (failure) {
    writeError.value = queueError(failure)
    return
  }
  if (['accept', 'reopen', 'mark_done', 'reject', 'apply', 'record_balance'].includes(method.value) && !intent.uncertain) {
    open.value = false
    await nextTick()
    const accepted = await confirm({ title: queueMethodLabels[method.value], message: `事项「${String(row.source_user_id || row.id)}」：${method.value === 'apply' ? '本次最多改派 100 个在办对象，每项按当前对象权限核验；不会自动继续下一批。' : method.value === 'record_balance' ? '将新增一条人工余额登记，不能在此撤销。' : '将记录当前处理结果与原因，保留原迁移记录。'}`, tone: 'warning', confirmLabel: queueMethodLabels[method.value] })
    if (token !== generation)
      return
    open.value = true
    if (!accepted)
      return
  }
  saving.value = true
  writeError.value = ''
  try {
    let response: {
      data?: {
        resolved?: number
        remaining?: number
        items?: QueueRow[]
      }
    } = {}
    const done = await intent.submit({ method: 'POST', path, body }, async (request, key) => {
      response = await $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key }, retry: 0 })
      if (!response || typeof response !== 'object' || !response.data || typeof response.data !== 'object')
        throw Error('写入响应未确认')
      if (method.value === 'apply')
        response.data = queueApplyResult(response.data)
    })
    if (token !== generation || !done)
      return
    toast.add({ title: queueMethodLabels[method.value] + '完成', color: 'success' })
    if (method.value === 'apply') {
      applyResult.value = response.data!
      await load()
      if (selected.value)
        selected.value.open_owner_items = response.data?.remaining || 0
    } else {
      const confirmed = selectedView.value === 'identities' && method.value === 'confirm'
      open.value = false
      await load()
      if (confirmed && canResolve.value && scope.value === writeScope) {
        applicationPrompt.value = rows.value.find(item => item.source_user_id === row.source_user_id && item.match_status === 'confirmed') || { ...row, match_status: 'confirmed', directory_uid: draft.directoryUid }
      }
    }
  } catch (failure) {
    if (token !== generation)
      return
    writeError.value = queueError(failure)
    if (Number((failure as {
      statusCode?: number
      status?: number
    }).statusCode || (failure as {
      status?: number
    }).status) === 409)
      await refreshComparison()
  } finally {
    saving.value = false
  }
}
function linkDuplicate() {
  if (intent.uncertain || !selected.value || !available(selected.value, selectedView.value).includes('link_existing'))
    return
  intent.reset()
  method.value = 'link_existing'
  duplicateContact.value = false
  writeError.value = '请选择该客户已有联系人，保留原归属客户与填写内容'
}
async function openObject(row: QueueRow) {
  const type = row.target_table === 'altoc_customer' ? 'customers' : row.target_table === 'altoc_contract' ? 'contracts' : ''
  if (!type || !row.target_key)
    return
  try {
    const response = await $fetch<{
      data: {
        items: QueueRow[]
      }
    }>(`/altoc/api/v1/${type}`, { query: { page: 1, pageSize: 20, search: String(row.target_key) }, retry: 0 })
    const object = response.data?.items?.find(item => item.code === row.target_key)
    if (!object)
      throw Error('对象不可访问或已不在您的范围内')
    await navigateTo(`/altoc/${type}/${encodeURIComponent(String(object.id))}`)
  } catch (failure) {
    toast.add({ title: queueError(failure), color: 'error' })
  }
}
watch(scope, () => {
  open.value = false
  selected.value = null
  counts.value = {}
  evidenceOpen.value = false
  evidence.value = null
  applicationPrompt.value = null
  countError.value = ''
  applyResult.value = null
  comparison.value = null
  intent = createReviewMutationIntent('migration-review', queueConflictCodes)
})
watch(canView, (allowed) => {
  if (!allowed) {
    evidenceOpen.value = false
    evidence.value = null
    counts.value = {}
  }
})
watch(canResolve, (allowed) => {
  if (!allowed) {
    open.value = false
    applicationPrompt.value = null
  }
})
</script>

<template>
  <UDashboardPanel
    :id="app + '-migration'"
    :ui="{ body: 'p-0' }"
  >
    <template #body>
      <div class="p-4 sm:p-6 space-y-4 min-w-0">
        <ContentPageHeader
          :hosted="true"
          title="迁移事项"
          :breadcrumbs="app === 'altoc' ? [{ label: '销售' }, { label: '迁移事项' }] : [{ label: '财务' }, { label: '迁移事项' }]"
        >
          <template #actions>
            <UButton
              v-if="app === 'finance' && hasPermission('bank_accounts', 'view')"
              color="neutral"
              variant="outline"
              label="截至日期余额"
              @click="balancesOpen = true"
            />
            <UButton
              color="neutral"
              variant="outline"
              :loading="loading"
              @click="load"
            >
              刷新
            </UButton>
          </template>
        </ContentPageHeader>
        <UAlert
          v-if="directoryError && app === 'altoc'"
          color="warning"
          title="目录姓名或部门暂不可用"
          description="请稍后重试加载目录信息。"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              @click="refreshDirectory()"
            >
              重试
            </UButton>
          </template>
        </UAlert>
        <UAlert
          v-if="applicationPrompt"
          color="info"
          title="匹配已确认，可继续应用到名下对象"
          :description="`源人员 ${applicationPrompt.display_name || '未知'} 有 ${applicationPrompt.open_owner_items ?? '待核对'} 个在办对象；可稍后处理，每批最多100个。`"
        >
          <template #actions>
            <UButton
              v-if="available(applicationPrompt, 'identities').includes('apply')"
              @click="begin(applicationPrompt, 'apply', 'identities'); applicationPrompt = null"
            >
              应用到名下对象
            </UButton><UButton
              color="neutral"
              variant="outline"
              @click="applicationPrompt = null"
            >
              暂不应用
            </UButton>
          </template>
        </UAlert>
        <CommonEmptyState
          v-if="permissionError"
          title="权限加载失败"
          description="请重新加载权限后重试。"
        >
          <UButton @click="loadPermissions()">
            重试
          </UButton>
        </CommonEmptyState>
        <CommonEmptyState
          v-else-if="!loaded"
          title="正在加载权限"
        />
        <CommonEmptyState
          v-else-if="!canView"
          title="无权限"
          description="您没有查看迁移事项的权限。"
        />
        <template v-else>
          <UAlert
            v-if="intent.uncertain"
            color="warning"
            description="有一项处理结果未确认，请沿用原请求重试。"
          >
            <template #actions>
              <UButton @click="open = true">
                继续未确认处理
              </UButton>
            </template>
          </UAlert>
          <div
            class="flex flex-wrap gap-2"
            aria-label="迁移事项页签"
          >
            <template v-if="app === 'altoc'">
              <UButton
                :aria-pressed="activeTab === 'people'"
                :variant="activeTab === 'people' ? 'solid' : 'outline'"
                @click="selectTab('people')"
              >
                人员匹配 · {{ counts.owner_unmatched ?? '—' }} 个待改派对象
              </UButton>
              <UButton
                :aria-pressed="activeTab === 'contacts'"
                :variant="activeTab === 'contacts' ? 'solid' : 'outline'"
                @click="selectTab('contacts')"
              >
                待归属联系人 · {{ counts.contact_without_customer ?? '—' }}
              </UButton>
              <UButton
                :aria-pressed="activeTab === 'others'"
                :variant="activeTab === 'others' ? 'solid' : 'outline'"
                @click="selectTab('others')"
              >
                其它事项
              </UButton>
            </template>
            <template v-else>
              <UButton
                v-for="item in filters"
                :key="item.value"
                :aria-pressed="kind === item.value"
                :variant="kind === item.value ? 'solid' : 'outline'"
                @click="selectTab(item.value)"
              >
                {{ item.label }}
              </UButton>
            </template>
          </div>
          <UAlert
            v-if="countError"
            color="warning"
            :description="countError"
          />
          <div
            v-if="app === 'altoc' && activeTab === 'people'"
            class="flex flex-wrap gap-2"
            aria-label="人员匹配视图"
          >
            <UButton
              color="neutral"
              :aria-pressed="view === 'identities'"
              :variant="view === 'identities' ? 'solid' : 'outline'"
              @click="view = 'identities'"
            >
              按源人员
            </UButton>
            <UButton
              color="neutral"
              :aria-pressed="view === 'exceptions'"
              :variant="view === 'exceptions' ? 'solid' : 'outline'"
              @click="view = 'exceptions'; kind = 'owner_unmatched'"
            >
              按对象
            </UButton>
          </div>
          <div class="flex flex-wrap gap-2">
            <UPopover>
              <UButton
                color="neutral"
                variant="outline"
                label="显示列"
                class="min-h-11"
              /><template #content>
                <div class="space-y-3 p-4">
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-sm font-medium">显示列</span><UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="保存本机视图"
                      @click="saveListView"
                    />
                  </div><UCheckbox
                    v-for="column in optionalColumns"
                    :key="column.key"
                    :model-value="visibleColumns.includes(column.key)"
                    :label="column.label"
                    @update:model-value="value => visibleColumns = value ? [...visibleColumns, column.key] : visibleColumns.filter(key => key !== column.key)"
                  />
                </div>
              </template>
            </UPopover>
            <USelect
              v-if="app === 'altoc' && activeTab === 'others'"
              v-model="kind"
              :items="filters"
              class="w-full sm:w-64"
              aria-label="事项类型"
            />
            <USelect
              v-model="status"
              :items="[{ label: '全部状态', value: 'all' }, ...(view === 'identities' ? [{ label: '待确认或待匹配', value: 'candidate,unmatched' }] : [{ label: '已解决或已接受', value: 'accepted,resolved' }]), ...statusOptions]"
              class="w-full sm:w-44"
              aria-label="处理状态"
            />
            <UInput
              v-if="searchable"
              v-model="search"
              placeholder="搜索源人员或待归属联系人"
              class="w-full sm:w-64"
              aria-label="搜索事项"
              @keydown.enter="flush"
            />
          </div>
          <div
            v-if="view === 'exceptions'"
            class="grid gap-3 sm:grid-cols-4"
          >
            <UFormField label="对象编码或源引用">
              <UInput
                v-model="objectSearch"
                class="w-full"
                @keydown.enter="flushObjectSearch"
              />
            </UFormField><UFormField label="起始迁入日期">
              <UInput
                v-model="createdFrom"
                type="date"
                class="w-full"
              />
            </UFormField><UFormField label="截止迁入日期">
              <UInput
                v-model="createdTo"
                type="date"
                class="w-full"
              />
            </UFormField><UFormField label="排序">
              <USelect
                v-model="queueSort"
                :items="[{ label: '事项 ID 正序', value: 'id_asc' }, { label: '迁入时间倒序', value: 'created_desc' }, { label: '迁入时间正序', value: 'created_asc' }]"
                class="w-full"
              />
            </UFormField>
          </div>
          <UAlert
            v-if="error"
            color="error"
            :description="error"
          />
          <UAlert
            v-if="kind === 'contract_balance_mismatch' && view === 'exceptions'"
            color="info"
            description="合同余额差异仅供核对；确认与处置将在后续财务阶段开放。"
          />
          <div class="hidden sm:block min-w-0 overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="loading"
              :ui="{ td: 'align-top', th: 'whitespace-nowrap' }"
            >
              <template #next-cell="{ row }">
                <p class="max-w-64 text-sm break-words">
                  {{ nextStep(row.original) }}
                </p>
              </template>
              <template #source-cell="{ row }">
                <p class="max-w-40 break-words text-xs text-muted">
                  {{ row.original.source_table || '源人员' }} · {{ row.original.source_pk || row.original.source_user_id }}
                </p>
              </template>
              <template #object-cell="{ row }">
                <p class="max-w-64 truncate">
                  {{ queueKinds[app][String(row.original.kind)] || '未登记类型' }}
                </p><p class="max-w-64 truncate text-sm text-muted">
                  {{ row.original.target_key || row.original.source_pk }} <span v-if="row.original.source_user_name">· {{ row.original.source_user_name }}</span>
                </p>
              </template>
              <template #details-cell="{ row }">
                <div class="max-w-96 break-words">
                  <W3BalanceEvidence
                    v-if="app === 'finance'"
                    :row="row.original"
                  />
                  <template v-if="row.original.contact">
                    <p>{{ (row.original.contact as QueueRow).cm_name }} · {{ (row.original.contact as QueueRow).mobile || (row.original.contact as QueueRow).phone || '未登记电话' }}</p><p class="text-muted">
                      {{ (row.original.contact as QueueRow).department }} / {{ (row.original.contact as QueueRow).post }}
                    </p>
                  </template><p
                    v-for="item in queueDetail(row.original)"
                    :key="item.label"
                  >
                    {{ item.label }}：{{ item.value }}
                  </p>
                </div>
              </template>
              <template #display_name-cell="{ row }">
                <p
                  class="max-w-40 truncate"
                  :title="String(row.original.display_name || '')"
                >
                  {{ row.original.display_name || '未知（源 ID 已保全）' }}
                </p>
              </template>
              <template #source_user_id-cell="{ row }">
                <p
                  class="max-w-36 truncate"
                  :title="String(row.original.source_user_id)"
                >
                  {{ row.original.source_user_id }}
                </p>
              </template>
              <template #match-cell="{ row }">
                <p class="max-w-40 truncate">
                  {{ row.original.directory_uid ? userName(row.original.directory_uid) : '暂无候选' }}<span
                    v-if="row.original.directory_uid && userDepartment(row.original.directory_uid)"
                    class="block text-xs text-muted"
                  >{{ userDepartment(row.original.directory_uid) }}</span>
                </p><p class="text-sm text-muted">
                  {{ row.original.source_status === 'active' ? '源人员在职' : row.original.source_status ? String(row.original.source_status) + '（原系统状态）' : '源状态未记录' }}
                </p>
              </template>
              <template #status-cell="{ row }">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ queueStatuses[String(row.original.match_status || row.original.status)] || '未知状态' }}
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <div class="flex flex-wrap gap-1 max-w-64">
                  <UButton
                    color="neutral"
                    variant="link"
                    label="查看证据"
                    @click="showEvidence(row.original)"
                  />
                  <UButton
                    v-if="['altoc_customer', 'altoc_contract'].includes(String(row.original.target_table))"
                    variant="link"
                    @click="openObject(row.original)"
                  >
                    查看对象 / 改派
                  </UButton><UButton
                    v-for="item in available(row.original)"
                    :key="item"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    @click="begin(row.original, item)"
                  >
                    {{ queueMethodLabels[item] }}
                  </UButton>
                </div>
              </template>
              <template #empty>
                <CommonEmptyState
                  :title="loading ? '正在加载' : error ? '加载失败' : '暂无事项'"
                  description="调整筛选条件，或查看已处理记录。"
                />
              </template>
            </UTable>
          </div>
          <div class="sm:hidden space-y-3">
            <UCard
              v-for="row in rows"
              :key="String(row.id || row.source_user_id)"
            >
              <div class="min-w-0 space-y-2 text-sm">
                <p class="break-words font-medium">
                  {{ row.display_name || queueKinds[app][String(row.kind)] || '迁移事项' }}
                </p><p class="break-all text-muted">
                  {{ row.source_user_id || row.target_key || row.source_pk }}
                </p><UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ queueStatuses[String(row.match_status || row.status)] || '未知状态' }}
                </UBadge><p v-if="view === 'identities'">
                  在办对象 {{ row.open_owner_items }}
                </p><p
                  v-if="view === 'identities' && row.directory_uid"
                  class="break-words"
                >
                  候选目录用户：{{ userName(row.directory_uid) }} {{ userDepartment(row.directory_uid) }}
                </p><p
                  v-if="row.contact"
                  class="break-words"
                >
                  {{ (row.contact as QueueRow).cm_name }} · {{ (row.contact as QueueRow).mobile || (row.contact as QueueRow).phone }}
                </p><p
                  v-for="item in queueDetail(row)"
                  :key="item.label"
                >
                  {{ item.label }}：{{ item.value }}
                </p><W3BalanceEvidence
                  v-if="app === 'finance' && view === 'exceptions'"
                  :row="row"
                /><p class="text-muted">
                  {{ nextStep(row) }}
                </p><div class="flex flex-wrap gap-2">
                  <UButton
                    color="neutral"
                    variant="link"
                    label="查看证据"
                    @click="showEvidence(row)"
                  />
                  <UButton
                    v-if="['altoc_customer', 'altoc_contract'].includes(String(row.target_table))"
                    variant="link"
                    @click="openObject(row)"
                  >
                    查看对象 / 改派
                  </UButton><UButton
                    v-for="item in available(row)"
                    :key="item"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    @click="begin(row, item)"
                  >
                    {{ queueMethodLabels[item] }}
                  </UButton>
                </div>
              </div>
            </UCard><CommonEmptyState
              v-if="!rows.length"
              :title="loading ? '正在加载' : error ? '加载失败' : '暂无事项'"
            />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-muted">
              共 {{ total }} 条
            </p><USelect
              v-model="pageSize"
              :items="[{ label: '20 条/页', value: 20 }, { label: '50 条/页', value: 50 }, { label: '100 条/页', value: 100 }]"
              aria-label="每页条数"
              :disabled="loading"
              class="w-32"
            /><UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
              :sibling-count="1"
              :disabled="loading"
              show-edges
            />
          </div>
        </template>
        <FinanceBalanceAsOf
          v-if="app === 'finance'"
          v-model:open="balancesOpen"
        />
        <USlideover
          v-model:open="evidenceOpen"
          title="迁移事项证据"
          description="问题、来源与已记录的处理结果"
          :ui="{ content: 'w-full sm:max-w-3xl' }"
        >
          <template #body>
            <div
              v-if="evidence"
              class="space-y-4 min-w-0"
            >
              <div class="grid gap-3 sm:grid-cols-3">
                <div>
                  <p class="text-xs text-muted">
                    事项
                  </p><p class="break-words">
                    {{ evidence.display_name || queueKinds[app][String(evidence.kind)] || '人员匹配' }}
                  </p>
                </div><div>
                  <p class="text-xs text-muted">
                    状态
                  </p><UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    {{ queueStatuses[String(evidence.match_status || evidence.status)] }}
                  </UBadge>
                </div><div>
                  <p class="text-xs text-muted">
                    下一步
                  </p><p class="text-sm">
                    {{ nextStep(evidence) }}
                  </p>
                </div>
              </div><UTabs
                v-model="evidenceTab"
                :items="evidenceTabs"
                :content="false"
              /><div
                v-if="evidenceTab === 'problem'"
                class="grid gap-3 sm:grid-cols-3"
              >
                <div
                  v-for="item in queueDetail(evidence)"
                  :key="item.label"
                  class="rounded border border-muted p-3"
                >
                  <p class="text-xs text-muted">
                    {{ item.label }}
                  </p><p class="font-medium tabular-nums">
                    {{ item.value }}
                  </p>
                </div><W3BalanceEvidence
                  v-if="app === 'finance'"
                  :row="evidence"
                />
              </div><dl
                v-else
                class="grid gap-3 sm:grid-cols-2 text-sm"
              >
                <div
                  v-for="field in [{ key: 'source_table', label: '源表' }, { key: 'source_pk', label: '源引用' }, { key: 'source_user_id', label: '源人员引用' }, { key: 'target_key', label: '目标编码' }, { key: 'created_at', label: '迁入时间' }, { key: 'resolved_at', label: '处理时间' }, { key: 'row_version', label: '版本' }]"
                  :key="field.key"
                >
                  <template v-if="evidence[field.key] !== undefined && evidence[field.key] !== null">
                    <dt class="text-xs text-muted">
                      {{ field.label }}
                    </dt><dd class="break-words">
                      {{ evidence[field.key] }}
                    </dd>
                  </template>
                </div>
              </dl><section
                v-if="evidenceTab === 'source'"
                class="space-y-3"
              >
                <p class="text-sm font-medium">
                  已记录的处理事件
                </p><UAlert
                  v-if="eventsError"
                  color="error"
                  :description="eventsError"
                >
                  <template #actions>
                    <UButton
                      color="neutral"
                      label="重试"
                      @click="loadEvents"
                    />
                  </template>
                </UAlert><p
                  v-if="eventsPending"
                  role="status"
                  class="text-sm text-muted"
                >
                  正在加载事件
                </p><ol
                  v-else
                  class="space-y-2"
                >
                  <li
                    v-for="event in events"
                    :key="String(event.id)"
                    class="rounded border border-muted p-3 text-sm"
                  >
                    <p>{{ eventLabels[String(event.action)] || '已记录的业务动作' }} · {{ event.created_at }}</p><p class="text-xs text-muted">
                      {{ app === 'altoc' ? userName(event.operator_uid) : event.operator_uid }} · {{ event.channel === 'user' ? '用户操作' : '系统操作' }}
                    </p>
                  </li>
                </ol><CommonEmptyState
                  v-if="!eventsPending && !eventsError && !events.length"
                  title="没有已记录的处理事件"
                /><div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-xs text-muted">共 {{ eventTotal }} 条</span><UPagination
                    v-model:page="eventPage"
                    :items-per-page="20"
                    :total="eventTotal"
                    :disabled="eventsPending"
                    :sibling-count="1"
                    show-edges
                  />
                </div>
              </section><div class="flex flex-wrap gap-2">
                <UButton
                  v-for="item in available(evidence)"
                  :key="item"
                  color="neutral"
                  variant="outline"
                  :label="queueMethodLabels[item]"
                  @click="evidenceOpen = false; begin(evidence!, item)"
                />
              </div>
            </div>
          </template>
        </USlideover>
        <USlideover
          v-model:open="open"
          :title="queueMethodLabels[method]"
          description="按当前权限核对迁移事项，失败保留填写内容；确认操作会记录处理结果。"
          :dismissible="!saving"
          :ui="{ content: 'w-full sm:max-w-xl' }"
        >
          <template #body>
            <div
              v-if="selected"
              class="space-y-4 min-w-0"
            >
              <p class="break-words text-sm">
                {{ selected.display_name || selected.source_user_id || selected.id }} · {{ queueStatuses[String(selected.match_status || selected.status)] }}
              </p>
              <template v-if="['assign_customer', 'link_existing'].includes(method)">
                <UFormField
                  label="目标客户"
                  required
                >
                  <W3QueueObjectSelect
                    v-model="draft.customerId!"
                    kind="customers"
                    :enabled="open && !intent.uncertain"
                  />
                </UFormField><UFormField
                  v-if="method === 'link_existing'"
                  label="已有联系人"
                  required
                >
                  <W3QueueObjectSelect
                    v-model="draft.contactCode!"
                    kind="contacts"
                    :customer-id="draft.customerId"
                    :enabled="open && !intent.uncertain"
                  />
                </UFormField><p class="text-sm text-muted">
                  归属使用迁移联系人资料创建，查重冲突后可改为关联已有联系人。
                </p>
              </template>
              <template v-if="method === 'record_balance'">
                <UFormField
                  v-if="selected.kind === 'balance_without_account'"
                  label="认领账户"
                  required
                >
                  <W3QueueObjectSelect
                    v-model="draft.accountCode!"
                    kind="bank-accounts"
                    :enabled="open && !intent.uncertain"
                  />
                </UFormField><p
                  v-else
                  class="break-all"
                >
                  账户：{{ selected.target_key }}
                </p><UFormField
                  label="候选金额"
                  required
                >
                  <USelect
                    v-model="draft.amount"
                    :items="amounts"
                    :disabled="intent.uncertain"
                    class="w-full"
                  />
                </UFormField><p class="text-sm text-muted">
                  只允许选择原事项的候选金额，生成一条人工余额登记。
                </p>
              </template>
              <template v-if="method === 'confirm'">
                <UFormField
                  label="目录用户"
                  required
                >
                  <UserTreeSelector
                    v-model="userUids"
                    selection-mode="single"
                    hide-committees
                    :exclude-uids="['system:unassigned']"
                    :disabled="intent.uncertain"
                    width-class="w-full"
                  />
                </UFormField><p class="text-sm text-muted">
                  候选者仍需人工确认；仅接受在职用户，不能匹配到当前操作者。
                </p>
              </template>
              <p
                v-if="method === 'apply'"
                class="text-sm"
              >
                待应用 {{ selected.open_owner_items }} 个对象。每批最多 100 项；每个对象重新核验编辑权限，失败项保留。
              </p>
              <UFormField
                v-if="selectedView === 'exceptions'"
                label="原因"
                :required="method === 'accept' && selected.kind === 'effective_amount_exceeds_total'"
              >
                <UTextarea
                  v-model="draft.reason"
                  class="w-full"
                  :maxlength="500"
                  :disabled="intent.uncertain"
                />
              </UFormField>
              <UAlert
                v-if="writeError"
                color="warning"
                :description="writeError"
              />
              <UButton
                v-if="duplicateContact"
                color="neutral"
                variant="outline"
                @click="linkDuplicate"
              >
                改为关联已有联系人
              </UButton>
              <UButton
                v-if="writeError"
                color="neutral"
                variant="outline"
                :disabled="saving"
                @click="refreshComparison"
              >
                刷新比较
              </UButton>
              <div
                v-if="comparison"
                class="space-y-2 rounded border border-muted p-3 text-sm"
              >
                <p>最新状态：{{ queueStatuses[String(comparison.match_status || comparison.status)] }}；版本 {{ comparison.row_version || '匹配状态版本' }}</p><UButton
                  :disabled="intent.uncertain"
                  @click="adoptVersion"
                >
                  采用最新版本，保留填写内容
                </UButton>
              </div>
              <div
                v-if="applyResult"
                class="space-y-2"
              >
                <p>本批成功 {{ applyResult.resolved }} 项，剩余 {{ applyResult.remaining }} 项</p><p
                  v-for="item in (applyResult.items || []).filter(item => item.status === 'failed')"
                  :key="String(item.id)"
                  class="break-words text-sm text-error"
                >
                  事项 {{ item.id }}：{{ queueError({ data: { code: item.code }, statusCode: 409 }) }}
                </p><p
                  v-if="Number(applyResult.remaining) > 0"
                  class="text-sm"
                >
                  可确认继续应用下一批；不会自动提交。
                </p>
              </div>
            </div>
          </template>
          <template #footer>
            <UButton
              :loading="saving"
              :disabled="!selected || !available(selected, selectedView).includes(method)"
              @click="save"
            >
              {{ intent.uncertain ? '原请求重试' : method === 'apply' && applyResult ? '继续应用下一批' : '确认处理' }}
            </UButton>
          </template>
        </USlideover>
      </div>
    </template>
  </UDashboardPanel>
</template>
