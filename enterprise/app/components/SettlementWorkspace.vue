<script setup lang="ts">
import AuthorizationModuleScope from '../../../foundation/app/components/AuthorizationModuleScope.vue'
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import FinanceLedgerList from '../../../finance/app/components/host/FinanceLedgerList.vue'
import FinanceLedgerDetail from '../../../finance/app/components/host/FinanceLedgerDetail.vue'
import FinanceLedgerForm from '../../../finance/app/components/host/FinanceLedgerForm.vue'
import FinanceReceivablesPage from '../../../finance/app/components/host/FinanceReceivablesPage.vue'
import AltocReceivablesPage from './AltocReceivablesPage.vue'
import SettlementFinanceActions from './SettlementFinanceActions.vue'
import { settlementTarget, settlementContext } from '../utils/settlementWorkspace'

const props = defineProps<{ initialView?: string }>()
const route = useRoute()
const router = useRouter()
const scope = useState<string>('enterprise-cache-scope', () => '')
const views = [{ label: '待收款', value: 'receivables' }, { label: '到账记录', value: 'receipts' }, { label: '待开票', value: 'invoices' }, { label: '待复核', value: 'review' }]
const view = ref(props.initialView || 'receivables')
const visited = reactive(new Set([view.value]))
watch(view, value => visited.add(value))
const panelPath = ref('')
const target = computed(() => settlementTarget(panelPath.value))
const context = ref<Record<string, string>>({})
const contextError = ref('')
const contextLoading = ref(false)
const result = ref('')
const editor = ref<{ hasDraft?: () => boolean } | null>(null)
const lists = ref<Array<{ refresh: () => void }>>([])
const receivablesList = ref<{ refresh: () => void } | null>(null)
const { confirm } = useConfirm()
const toast = useToast()
let contextEpoch = 0
const panelTitle = computed(() => !target.value ? '' : target.value.action === 'new' ? target.value.kind === 'receipts' ? '登记到账' : '申请开票' : `${({ 'receivable': '款项跟进', 'receipts': '到账与分配', 'invoice-requests': '开票申请', 'invoices': '发票记录', 'continuation': '历史接续', 'adjustments': '应收调整' })[target.value.kind]} · ${target.value.code}`)
const formAction = computed(() => ['edit', 'issue', 'assign-issuance', 'classify'].includes(target.value?.action || '') ? target.value?.action as 'edit' | 'issue' | 'assign-issuance' | 'classify' : undefined)
const isLedger = computed(() => target.value && ['receipts', 'invoice-requests', 'invoices'].includes(target.value.kind))
const ledgerKind = computed(() => target.value?.kind === 'receipts' ? 'receipts' : target.value?.kind === 'invoices' ? 'invoices' : 'invoice-requests')

async function leaveDraft() {
  if (!editor.value?.hasDraft?.()) return true
  return await confirm({ title: '离开当前草稿？', message: '未保存内容会丢失。如果提交结果尚未确认，请留在当前表单重试原请求。', tone: 'warning' })
}
async function open(path: string, discard = false) {
  if (contextLoading.value || (path && !settlementTarget(path)) || (!discard && !await leaveDraft())) return
  contextEpoch++
  const next = settlementTarget(path)
  const sameObject = next && target.value && next.kind === target.value.kind && next.code === target.value.code
  if (!path.endsWith('/new') && !sameObject && next?.code) context.value = {}
  if (!path) context.value = {}
  contextError.value = ''
  panelPath.value = path
  result.value = ''
  await router.replace({ query: { ...route.query, settlement: path || undefined } })
}
function captureLink(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return
  const url = new URL(link.href)
  if (url.origin !== window.location.origin || url.search || url.hash || !settlementTarget(url.pathname)) return
  event.preventDefault()
  event.stopPropagation()
  void open(url.pathname)
}
async function readContext(row: Record<string, unknown>) {
  const epoch = ++contextEpoch
  context.value = settlementContext(row)
  contextError.value = ''
  if (target.value?.kind !== 'receivable') return
  context.value.billingScheduleCode = String(row.code || '')
  if (!row.customer_id) return
  contextLoading.value = true
  try {
    const response = await $fetch<{ data: Record<string, unknown> }>(`/altoc/api/v1/customers/${encodeURIComponent(String(row.customer_id))}`, { retry: 0 })
    if (epoch !== contextEpoch) return
    if (typeof response.data?.code !== 'string') throw new Error('Invalid customer projection')
    context.value.customerCode = response.data.code
    context.value.customerName = String(response.data.name || '')
  } catch {
    if (epoch === contextEpoch) contextError.value = '客户资料读取失败。款项仍可查看；请刷新款项后再登记到账或申请开票。'
  } finally {
    if (epoch === contextEpoch) contextLoading.value = false
  }
}
function refreshLists() {
  for (const list of lists.value) void list.refresh()
  void receivablesList.value?.refresh()
}
async function saved(code: string) {
  const kind = target.value?.kind
  const action = target.value?.action
  await open(`/finance/${kind === 'receipts' ? 'receipts' : 'invoices/requests'}/${encodeURIComponent(code)}`, true)
  result.value = action === 'issue' ? '正式发票已生成。' : action === 'new' && kind === 'receipts' ? '到账草稿已保存；请确认到账，再交另一位财务分配。' : action === 'new' ? '开票申请已保存；审批与正式开票分别办理。' : '单据已保存。'
  refreshLists()
}
async function copyHandoff() {
  try {
    // Link contains only an object locator, no role, capability, draft or financial data.
    const entry = target.value?.kind === 'receivable' ? '/altoc/payments' : '/finance/receipts'
    await navigator.clipboard.writeText(`${window.location.origin}${entry}?settlement=${encodeURIComponent(panelPath.value)}`)
    toast.add({ title: '已复制交接链接，对方登录后按自身权限办理', color: 'success' })
  } catch { toast.add({ title: '复制失败，请复制浏览器地址栏链接', color: 'error' }) }
}
watch(scope, () => {
  contextEpoch++
  context.value = {}
  contextError.value = ''
  contextLoading.value = false
  result.value = ''
})
watch(() => route.query.settlement, (value) => {
  const path = typeof value === 'string' && settlementTarget(value) ? value : ''
  if (path !== panelPath.value) {
    contextEpoch++
    context.value = {}
    panelPath.value = path
  }
}, { immediate: true })
onBeforeRouteUpdate(to => to.query.settlement === panelPath.value ? true : leaveDraft())
onBeforeRouteLeave(() => leaveDraft())
onScopeDispose(() => {
  contextEpoch++
})
</script>

<template>
  <div
    class="settlement-workspace min-w-0 p-4 sm:p-6"
    @click.capture="captureLink"
  >
    <ContentPageHeader
      hosted
      title="收款与结算"
      description="从待收款到到账、分配和开票，在同一工作区办理。"
    >
      <template #actions>
        <AuthorizationModuleScope app="finance">
          <SettlementFinanceActions
            :disabled="contextLoading || !!contextError"
            @open="open"
          />
        </AuthorizationModuleScope>
      </template>
    </ContentPageHeader>
    <div :class="{ 'hidden lg:block': target }">
      <div
        class="mb-4 hidden flex-wrap gap-2 sm:flex"
        role="group"
        aria-label="结算任务视图"
      >
        <UButton
          v-for="item in views"
          :key="item.value"
          :variant="view === item.value ? 'solid' : 'outline'"
          :color="view === item.value ? 'primary' : 'neutral'"
          :aria-pressed="view === item.value"
          @click="view = item.value"
        >
          {{ item.label }}
        </UButton>
      </div>
      <USelect
        v-model="view"
        :items="views"
        aria-label="结算任务视图"
        class="mb-4 w-full sm:hidden"
      />
    </div>
    <div
      class="grid min-w-0 items-start gap-4"
      :class="target ? 'lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]' : ''"
    >
      <section
        class="min-w-0"
        :class="{ 'hidden lg:block': target }"
        aria-label="结算任务列表"
      >
        <AuthorizationModuleScope app="altoc">
          <AltocReceivablesPage
            v-show="view === 'receivables'"
            v-if="visited.has('receivables')"
            ref="receivablesList"
            embedded
          />
        </AuthorizationModuleScope>
        <AuthorizationModuleScope app="finance">
          <div
            v-for="item in ['receipts', 'invoices', 'review']"
            v-show="view === item"
            :key="item"
          >
            <p
              v-if="item === 'review'"
              class="mb-3 text-sm text-muted"
            >
              已确认到账待分配。部分核销的到账可在状态筛选中查看；这里只展示你的授权范围，确认人不能核销自己的到账。
            </p>
            <FinanceLedgerList
              v-if="visited.has(item)"
              ref="lists"
              :kind="item === 'invoices' ? 'invoice-requests' : 'receipts'"
              :initial-status="item === 'invoices' ? 'approved' : item === 'review' ? 'confirmed' : undefined"
              embedded
            />
          </div>
        </AuthorizationModuleScope>
      </section>
      <aside
        v-if="target"
        :key="scope"
        class="min-w-0 rounded-xl border border-default bg-default p-3 sm:p-4"
        aria-label="当前结算事项"
      >
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="min-w-0 break-all font-semibold">
            {{ panelTitle }}
          </h2>
          <div class="flex gap-2">
            <UButton
              v-if="target.code"
              color="neutral"
              variant="outline"
              size="sm"
              @click="copyHandoff"
            >
              复制交接链接
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              @click="open('')"
            >
              返回列表
            </UButton>
          </div>
        </div>
        <p
          v-if="context.contractCode"
          class="mb-3 break-all text-sm text-muted"
        >
          {{ context.customerName || context.customerCode }} · {{ context.contractCode }} · {{ context.currencyCode }}
        </p>
        <UAlert
          v-if="result"
          class="mb-3"
          color="success"
          :title="result"
        />
        <UAlert
          v-if="contextError"
          class="mb-3"
          color="warning"
          :title="contextError"
        />
        <AuthorizationModuleScope
          v-if="target.kind === 'receivable'"
          app="altoc"
        >
          <AltocReceivablesPage
            :key="panelPath"
            :plan-id="target.code"
            detail
            embedded
            @context="readContext"
          />
        </AuthorizationModuleScope>
        <AuthorizationModuleScope
          v-else
          app="finance"
        >
          <FinanceReceivablesPage
            v-if="target.action === 'allocate'"
            :key="panelPath"
            ref="editor"
            mode="allocate"
            :object-code="target.code"
            embedded
            @changed="refreshLists"
          />
          <FinanceReceivablesPage
            v-else-if="target.kind === 'continuation' || target.kind === 'adjustments'"
            :key="panelPath"
            :mode="target.kind === 'continuation' ? 'continuation' : target.code ? 'adjust-detail' : 'adjustments'"
            :object-code="target.code"
            embedded
          />
          <FinanceLedgerForm
            v-else-if="isLedger && target.action"
            :key="panelPath"
            ref="editor"
            :kind="ledgerKind"
            :action="formAction"
            :object-code="target.code"
            :initial-context="context"
            embedded
            @saved="saved"
          />
          <FinanceLedgerDetail
            v-else-if="isLedger && target.code"
            :key="panelPath"
            :kind="ledgerKind"
            :object-code="target.code"
            embedded
            @context="readContext"
            @changed="refreshLists"
          />
          <FinanceLedgerList
            v-else-if="isLedger"
            :key="panelPath"
            :kind="ledgerKind"
            :initial-search="context.contractCode"
            embedded
          />
        </AuthorizationModuleScope>
        <div
          v-if="context.contractCode && !target.action"
          class="mt-4 flex flex-wrap gap-2 border-t border-default pt-4"
        >
          <UButton
            color="neutral"
            variant="outline"
            @click="open('/finance/invoices')"
          >
            发票记录
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            @click="open(`/finance/historical-finance/${context.contractCode}`)"
          >
            更正与历史
          </UButton>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* Reused standalone panels should flow inside the workspace instead of taking the viewport. */
.settlement-workspace :deep([data-slot="root"][id^="finance-"]) { position: relative; width: 100%; min-width: 0; min-height: 0; }
.settlement-workspace :deep([data-slot="body"]) { padding: 0; }
</style>
