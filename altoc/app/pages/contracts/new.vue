<script setup lang="ts">
import type { Contact, Customer, Opportunity } from '~/types/altoc'
import { unwrapApiData, unwrapApiList } from '~/utils/apiResponse'

type CustomerOption = Pick<Customer, 'id' | 'name'> & {
  opportunity_count?: number | string | null
  contact_count?: number | string | null
}
type ContactOption = Pick<Contact, 'id' | 'name' | 'mobile' | 'phone' | 'email'> & {
  job_title?: string | null
}
type OpportunityOption = Pick<Opportunity, 'id' | 'name' | 'customer_id'> & {
  customer_name?: string | null
}
type ContractOption = {
  id: number | string
  code?: string | null
  name?: string | null
  agreement_form?: string | null
  customer_name?: string | null
}

interface DocumentCreateResponse {
  document_uuid?: string | null
}

interface ContractCreateResponse {
  id: number
  contract?: { id?: number }
}

interface QuoteItem {
  id?: number
  item_name?: string
  specification?: string | null
  unit?: string | null
  quantity?: number | string | null
  unit_price?: number | string | null
  amount_tax_inclusive?: number | string | null
  amount_tax_exclusive?: number | string | null
  tax_rate?: number | string | null
  product_id?: number | string | null
  product_code?: string | null
  product_version?: string | null
}

interface QuoteDetail {
  id?: number
  code?: string
  customer_id?: number
  customer_name?: string | null
  opportunity_id?: number | string | null
  opportunity_name?: string | null
  amount_tax_inclusive?: number | string | null
  amount_tax_exclusive?: number | string | null
  tax_rate?: number | string | null
  currency_code?: string | null
  items?: QuoteItem[]
}

interface ContractBusinessTemplate {
  code: string
  name: string
  direction: string
  primary_type: string
}

interface ContractLineDraft {
  line_type: string
  name: string
  description: string
  product_code: string | null
  product_version: string | null
  product_origin: string | null
  quantity: number
  unit: string
  unit_price: number | null
  amount_tax_inclusive: number | null
  amount_tax_exclusive: number | null
  tax_rate: number
  acceptance_required: boolean
  acceptance_criteria: string
  source_quotation_item_id?: number | string | null
}

interface AssetProductItem {
  id?: number | string
  productCode?: string | null
  product_code?: string | null
  productName?: string | null
  product_name?: string | null
  productLine?: string | null
  product_line?: string | null
  currentVersion?: string | null
  current_version?: string | null
  status?: string | null
}

interface AssetProductListPayload {
  items?: AssetProductItem[]
}

interface PendingDocumentLink {
  title: string
  document_uuid: string
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()
const config = useRuntimeConfig()

const loading = ref(false)
const publicConfig = config.public as { codocsBaseUrl?: string }
const codocsUrl = publicConfig.codocsBaseUrl || 'http://localhost:3001'
const initialCustomerId = route.query.customer_id ? Number(route.query.customer_id) : null
const initialParentContractId = route.query.parent_contract_id ? Number(route.query.parent_contract_id) : null
const filteredCustomerId = ref<number | null>(initialCustomerId)

const form = reactive({
  name: '',
  customer_id: initialCustomerId as number | null,
  parent_contract_id: initialParentContractId as number | null,
  is_master_contract: !initialParentContractId,
  opportunity_id: route.query.opportunity_id ? Number(route.query.opportunity_id) : null as number | null,
  tender_id: route.query.tender_id ? Number(route.query.tender_id) : null as number | null,
  quotation_id: route.query.quotation_id ? Number(route.query.quotation_id) : null as number | null,
  direction: 'sales',
  primary_type: 'legacy_contract',
  agreement_form: 'standard_contract',
  template_code: '',
  source_type: route.query.quotation_id ? 'quotation' : 'manual',
  source_code: '',
  contact_id: null as number | null,
  contact_phone: '',
  contact_email: '',
  invoice_type: 'special_vat',
  sign_date: '',
  effective_date: '',
  end_date: '',
  amount_tax_inclusive: null as number | null,
  amount_tax_exclusive: null as number | null,
  tax_rate: 6,
  retention_rate: null as number | null,
  payment_term_summary: '',
  owner_user_id: authUser.value || '',
  remark: '',
  lines: [] as ContractLineDraft[]
})

const contractInfoAccordionItems = [
  { label: '基本信息', value: 'basic', icon: 'i-lucide-info', slot: 'basic' as const },
  { label: '合同标的', value: 'lines', icon: 'i-lucide-package', slot: 'lines' as const },
  { label: '付款条款', value: 'terms', icon: 'i-lucide-list', slot: 'terms' as const },
  { label: '合同文本与扫描件', value: 'documents', icon: 'i-lucide-file-text', slot: 'documents' as const }
]
const contractInfoAccordionDefault = ['basic']

const customerInput = ref('')
const customerFocused = ref(false)
const { data: customerResult } = useFetch('/api/v1/customers', {
  query: computed(() => ({ keyword: customerInput.value, pageSize: 20 })),
  transform: (res: unknown) => unwrapApiList<CustomerOption>(res),
  default: () => [] as CustomerOption[]
})
const customerMatches = computed(() => customerResult.value || [])

const contacts = ref<ContactOption[]>([])
const contactFocused = ref(false)
const contactNameInput = ref('')

function errorMessage(error: unknown, fallback: string) {
  const source = error && typeof error === 'object'
    ? error as { data?: { message?: string, statusMessage?: string }, message?: string }
    : {}
  return source.data?.message || source.data?.statusMessage || source.message || fallback
}

function resetContactFields() {
  contacts.value = []
  form.contact_id = null
  contactNameInput.value = ''
  form.contact_phone = ''
  form.contact_email = ''
}

async function loadContacts(customerId: number) {
  try {
    const res = await $fetch<unknown>(`/api/v1/customers/${customerId}/contacts`)
    contacts.value = unwrapApiList<ContactOption>(res)
  } catch {
    contacts.value = []
  }
}

async function applyCustomerSelection(customer: CustomerOption, options: { preserveOpportunity?: boolean, preserveTender?: boolean } = {}) {
  customerInput.value = customer.name
  form.customer_id = customer.id
  filteredCustomerId.value = customer.id

  resetContactFields()
  await loadContacts(customer.id)

  if (!options.preserveOpportunity) {
    form.opportunity_id = null
  }
  if (!options.preserveTender) {
    form.tender_id = null
  }
}

function clearCustomerSelection(options: { clearOpportunity?: boolean, clearTender?: boolean } = {}) {
  form.customer_id = null
  filteredCustomerId.value = null
  resetContactFields()

  if (options.clearOpportunity) {
    form.opportunity_id = null
  }
  if (options.clearTender) {
    form.tender_id = null
  }
}

function onCustomerInput() {
  clearCustomerSelection({ clearOpportunity: true, clearTender: true })
}

function onCustomerFocus() {
  customerFocused.value = true
}

function onCustomerBlur() {
  window.setTimeout(() => {
    customerFocused.value = false
  }, 200)
}

function selectCustomer(customer: CustomerOption) {
  applyCustomerSelection({ id: customer.id, name: customer.name })
  customerFocused.value = false
}

function clearCustomerInput() {
  customerInput.value = ''
  clearCustomerSelection({ clearOpportunity: true, clearTender: true })
  customerFocused.value = false
}

async function loadCustomer(customerId: number, options: { preserveOpportunity?: boolean, preserveTender?: boolean } = {}) {
  try {
    const res = await $fetch<unknown>(`/api/v1/customers/${customerId}`)
    const customer = unwrapApiData<CustomerOption>(res) as CustomerOption | undefined
    if (!customer) return
    await applyCustomerSelection({ id: customer.id, name: customer.name }, options)
  } catch (err) {
    console.error('[Contract] Failed to load customer:', err)
  }
}

const oppKeyword = ref('')
const { data: oppResult } = useFetch('/api/v1/opportunities', {
  query: computed(() => ({
    keyword: oppKeyword.value,
    status: 'active',
    pageSize: 20,
    customer_id: filteredCustomerId.value || undefined
  })),
  transform: (res: unknown) => unwrapApiList<OpportunityOption>(res),
  default: () => [] as OpportunityOption[]
})
const oppOptions = computed(() => (oppResult.value || []).map(o => ({ label: `${o.name} (${o.customer_name})`, value: o.id })))

const lastAutoContractName = ref('')

async function syncOpportunityCustomer(oppId: number | null) {
  if (!oppId) {
    form.tender_id = null
    return
  }

  const selectedOpp = (oppResult.value || []).find(item => Number(item.id) === Number(oppId))
  if (selectedOpp?.customer_name) {
    customerInput.value = selectedOpp.customer_name
  }

  try {
    const res = await $fetch<unknown>(`/api/v1/opportunities/${oppId}`)
    const opp = unwrapApiData<OpportunityOption>(res) as OpportunityOption | undefined
    if (!opp) return

    if (!form.name || form.name === lastAutoContractName.value) {
      form.name = opp.name || ''
      lastAutoContractName.value = opp.name || ''
    }

    if (opp.customer_id) {
      await applyCustomerSelection(
        { id: opp.customer_id, name: opp.customer_name || '' },
        { preserveOpportunity: true, preserveTender: true }
      )
    }
  } catch (err) {
    console.error('[Contract] Failed to load opportunity:', err)
  }
}

watch(() => form.opportunity_id, syncOpportunityCustomer, { immediate: true })

const contactMatches = computed(() => {
  if (!contacts.value.length) return []
  if (!contactNameInput.value) return contacts.value
  return contacts.value.filter(c => c.name.includes(contactNameInput.value))
})

function selectContact(ct: ContactOption) {
  form.contact_id = ct.id
  contactNameInput.value = ct.name
  form.contact_phone = ct.mobile || ct.phone || ''
  form.contact_email = ct.email || ''
  contactFocused.value = false
}

function onContactInput() {
  form.contact_id = null
}

function onContactBlur() {
  window.setTimeout(() => {
    contactFocused.value = false
  }, 200)
}

const invoiceTypeOptions = [
  { label: '专用发票', value: 'special_vat' },
  { label: '普通发票', value: 'general_vat' },
  { label: '电子发票', value: 'electronic' }
]

const { data: contractTemplates } = useFetch('/api/v1/config/contract-business-templates', {
  transform: (res: unknown) => unwrapApiList<ContractBusinessTemplate>(res),
  default: () => [] as ContractBusinessTemplate[]
})
const contractTemplateOptions = computed(() => (contractTemplates.value || [])
  .filter(tpl => tpl.direction === form.direction)
  .map(tpl => ({ label: tpl.name, value: tpl.code })))

watch(() => form.template_code, (code) => {
  const tpl = (contractTemplates.value || []).find(item => item.code === code)
  if (!tpl) return
  form.direction = tpl.direction || 'sales'
  form.primary_type = tpl.primary_type || 'legacy_contract'
})

const contractDirectionOptions = [
  { label: '销售合同', value: 'sales' },
  { label: '采购合同', value: 'purchase' }
]

const agreementFormLabels: Record<string, string> = {
  single: '标准合同',
  standard_contract: '标准合同',
  framework: '框架协议',
  master: '框架协议',
  quantity_framework: '框架协议',
  value_framework: '框架协议',
  supplement: '补充协议',
  change_order: '补充协议',
  renewal: '续签协议',
  tripartite: '三方协议'
}

const agreementFormOptions = [
  { label: '标准合同', value: 'standard_contract' },
  { label: '框架协议', value: 'framework' },
  { label: '补充协议', value: 'supplement' },
  { label: '三方协议', value: 'tripartite' },
  { label: '续签协议', value: 'renewal' }
]

const parentRequiredAgreementForms = new Set(['supplement', 'renewal'])
const parentContractKeyword = ref('')
const { data: parentContractResult } = useFetch('/api/v1/contracts', {
  query: computed(() => ({
    keyword: parentContractKeyword.value,
    pageSize: 20,
    master_only: 1,
    customer_id: form.customer_id || undefined,
    direction: form.direction || undefined
  })),
  transform: (res: unknown) => unwrapApiList<ContractOption>(res),
  default: () => [] as ContractOption[]
})
const parentContractOptions = computed(() => (parentContractResult.value || []).map(item => ({
  label: `${item.code || item.id} · ${item.name || '未命名合同'}`,
  value: Number(item.id),
  description: [item.customer_name, agreementFormLabels[String(item.agreement_form || '')]].filter(Boolean).join(' · ')
})))

const lineTypeOptions = [
  { label: '软件产品', value: 'own_software_license' },
  { label: 'SaaS订阅', value: 'own_saas_subscription' },
  { label: '第三方软件', value: 'third_party_software' },
  { label: '硬件', value: 'hardware' },
  { label: '定制开发', value: 'custom_development' },
  { label: '实施服务', value: 'implementation' },
  { label: '系统集成', value: 'system_integration' },
  { label: '运维支持', value: 'maintenance_support' },
  { label: '托管服务', value: 'managed_service' },
  { label: '咨询培训', value: 'consulting_training' },
  { label: '其他费用', value: 'other_fee' }
]

const productAssetKeyword = ref('')
const productAssetItems = ref<AssetProductItem[]>([])
const productAssetLoading = ref(false)
let productAssetRequestSeq = 0

const productAssetOptions = computed(() => productAssetItems.value
  .map((item) => {
    const code = productCodeOf(item)
    const name = productNameOf(item)
    if (!code) return null
    return {
      label: `${code} · ${name || '未命名产品'}`,
      value: code,
      description: [productCurrentVersionOf(item), productLineOf(item), item.status].filter(Boolean).join(' · ')
    }
  })
  .filter(Boolean) as Array<{ label: string, value: string, description?: string }>)

const lineAmountTotal = computed(() => form.lines.reduce((sum, line) => sum + Number(line.amount_tax_inclusive || 0), 0))
const lineAmountTaxExclusiveTotal = computed(() => form.lines.reduce((sum, line) => sum + Number(line.amount_tax_exclusive || 0), 0))
const obligationPreview = computed(() => form.lines.flatMap((line, index) => {
  const name = line.name.trim() || `产品与服务 ${index + 1}`
  const items = [{
    key: `${index}-delivery`,
    line: name,
    name: `${name}交付`,
    type: line.line_type,
    status: 'not_started',
    acceptance: false
  }]
  if (line.acceptance_required) {
    items.push({
      key: `${index}-acceptance`,
      line: name,
      name: `${name}验收`,
      type: 'acceptance',
      status: 'not_started',
      acceptance: true
    })
  }
  return items
}))
const billingPreview = computed(() => form.lines
  .filter(line => Number(line.amount_tax_inclusive || 0) > 0)
  .map((line, index) => {
    const name = line.name.trim() || `产品与服务 ${index + 1}`
    return {
      key: `${index}-billing`,
      name: `${name}结算`,
      amount: line.amount_tax_inclusive,
      trigger: line.acceptance_required ? 'obligation_accepted' : 'obligation_completed'
    }
  }))

watch(lineAmountTotal, (amount) => {
  form.amount_tax_inclusive = Number(amount.toFixed(2))
})

watch(() => form.parent_contract_id, (parentContractId) => {
  form.is_master_contract = !parentContractId
})

watch(() => form.customer_id, (customerId, previousCustomerId) => {
  if (previousCustomerId && customerId !== previousCustomerId) {
    form.parent_contract_id = null
  }
})

function createEmptyLine(): ContractLineDraft {
  return {
    line_type: 'own_software_license',
    name: '',
    description: '',
    product_code: null,
    product_version: null,
    product_origin: 'own',
    quantity: 1,
    unit: '项',
    unit_price: null,
    amount_tax_inclusive: null,
    amount_tax_exclusive: null,
    tax_rate: form.tax_rate || 6,
    acceptance_required: false,
    acceptance_criteria: ''
  }
}

function addLine() {
  form.lines.push(createEmptyLine())
  void loadProductAssets()
}

function removeLine(index: number) {
  form.lines.splice(index, 1)
}

function productCodeOf(item: AssetProductItem) {
  return String(item.productCode || item.product_code || '').trim()
}

function productNameOf(item: AssetProductItem) {
  return String(item.productName || item.product_name || '').trim()
}

function productLineOf(item: AssetProductItem) {
  return String(item.productLine || item.product_line || '').trim()
}

function productCurrentVersionOf(item: AssetProductItem) {
  return String(item.currentVersion || item.current_version || '').trim()
}

async function loadProductAssets(keyword = productAssetKeyword.value) {
  const requestSeq = ++productAssetRequestSeq
  productAssetLoading.value = true
  try {
    const res = await $fetch<unknown>('/api/v1/assets/products', {
      query: {
        keyword,
        pageSize: 20
      }
    })
    if (requestSeq !== productAssetRequestSeq) return
    const payload = unwrapApiData<AssetProductListPayload>(res) as AssetProductListPayload | undefined
    productAssetItems.value = payload?.items || []
  } catch (error) {
    if (requestSeq === productAssetRequestSeq) {
      productAssetItems.value = []
    }
    console.warn('[contracts/new] Failed to load product assets:', error)
  } finally {
    if (requestSeq === productAssetRequestSeq) {
      productAssetLoading.value = false
    }
  }
}

function handleLineTypeChange(line: ContractLineDraft, value: string | undefined) {
  line.line_type = String(value || '')
  if (line.line_type === 'own_software_license') {
    line.product_origin = 'own'
    void loadProductAssets()
    return
  }

  line.product_code = null
  line.product_version = null
}

async function handleProductSearch(value: string) {
  productAssetKeyword.value = value
  await loadProductAssets(value)
}

function selectLineProduct(line: ContractLineDraft, value: string | undefined) {
  const code = String(value || '').trim()
  line.product_code = code || null
  if (!code) {
    line.name = ''
    line.product_version = null
    return
  }

  const product = productAssetItems.value.find(item => productCodeOf(item) === code)
  line.name = product ? productNameOf(product) || code : code
  line.product_version = product ? productCurrentVersionOf(product) || null : null
  line.product_origin = 'own'
}

function refreshLineAmount(line: ContractLineDraft) {
  const quantity = Number(line.quantity || 0)
  const unitPrice = Number(line.unit_price || 0)
  if (quantity > 0 && unitPrice > 0) {
    line.amount_tax_inclusive = Number((quantity * unitPrice).toFixed(2))
  }
  const amount = Number(line.amount_tax_inclusive || 0)
  const taxRate = Number(line.tax_rate || 0)
  line.amount_tax_exclusive = amount > 0 ? Number((amount / (1 + taxRate / 100)).toFixed(2)) : null
}

function lineFromQuoteItem(item: QuoteItem): ContractLineDraft {
  return {
    line_type: 'own_software_license',
    name: item.item_name || '',
    description: item.specification || '',
    product_code: item.product_code || null,
    product_version: item.product_version || null,
    product_origin: 'own',
    quantity: Number(item.quantity || 1),
    unit: item.unit || '项',
    unit_price: item.unit_price == null ? null : Number(item.unit_price),
    amount_tax_inclusive: item.amount_tax_inclusive == null ? null : Number(item.amount_tax_inclusive),
    amount_tax_exclusive: item.amount_tax_exclusive == null ? null : Number(item.amount_tax_exclusive),
    tax_rate: Number(item.tax_rate || form.tax_rate || 6),
    acceptance_required: false,
    acceptance_criteria: '',
    source_quotation_item_id: item.id || null
  }
}

function formatMoney(val: number | string | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(Number(val) || 0)
}

function billingTriggerLabel(value: string) {
  return value === 'obligation_accepted' ? '义务验收后' : '义务完成后'
}

async function loadQuotationForContract(quotationId: number) {
  try {
    const res = await $fetch<unknown>(`/api/v1/quotes/${quotationId}`)
    const quote = unwrapApiData<QuoteDetail>(res) as QuoteDetail | undefined
    if (!quote) return
    form.source_code = quote.code || ''
    form.customer_id = Number(quote.customer_id || form.customer_id || 0) || form.customer_id
    form.opportunity_id = quote.opportunity_id ? Number(quote.opportunity_id) : form.opportunity_id
    form.amount_tax_inclusive = quote.amount_tax_inclusive == null ? form.amount_tax_inclusive : Number(quote.amount_tax_inclusive)
    form.amount_tax_exclusive = quote.amount_tax_exclusive == null ? form.amount_tax_exclusive : Number(quote.amount_tax_exclusive)
    form.tax_rate = Number(quote.tax_rate || form.tax_rate || 6)
    form.source_type = 'quotation'
    if (!form.name && quote.code) {
      form.name = `${quote.code} 合同`
    }
    if (quote.customer_id && quote.customer_name) {
      await applyCustomerSelection(
        { id: Number(quote.customer_id), name: quote.customer_name },
        { preserveOpportunity: true, preserveTender: true }
      )
    }
    if (Array.isArray(quote.items) && quote.items.length) {
      form.lines = quote.items.map(lineFromQuoteItem)
    }
  } catch (err) {
    toast.add({ title: errorMessage(err, '报价信息加载失败'), color: 'warning' })
  }
}

const contractTextModalOpen = ref(false)
const contractTextPickerOpen = ref(false)
const pendingContractText = ref<null | {
  mode: 'new' | 'existing'
  title: string
  content?: string
  document_uuid?: string
}>(null)

const createContractTextForm = reactive({
  title: '',
  content: ''
})

const pickContractTextForm = reactive({
  title: '',
  document_uuid: ''
})

const contractScanForm = reactive({
  title: '',
  document_uuid: ''
})
const pendingContractScans = ref<PendingDocumentLink[]>([])

watch(() => form.name, (name) => {
  const nextTitle = (name || '').trim()
  if (!nextTitle) return

  if (!createContractTextForm.title.trim()) {
    createContractTextForm.title = nextTitle
  }
  if (!pickContractTextForm.title.trim()) {
    pickContractTextForm.title = nextTitle
  }
  if (!contractScanForm.title.trim()) {
    contractScanForm.title = `${nextTitle}扫描件`
  }
}, { immediate: true })

function saveNewContractTextDraft() {
  if (!createContractTextForm.title.trim()) {
    toast.add({ title: '请输入合同文本标题', color: 'error' })
    return
  }

  pendingContractText.value = {
    mode: 'new',
    title: createContractTextForm.title.trim(),
    content: createContractTextForm.content || `# ${createContractTextForm.title.trim()}\n\n`
  }
  contractTextModalOpen.value = false
}

function savePickedContractText() {
  if (!pickContractTextForm.title.trim() || !pickContractTextForm.document_uuid.trim()) {
    toast.add({ title: '请输入合同文本标题和文档UUID', color: 'error' })
    return
  }

  pendingContractText.value = {
    mode: 'existing',
    title: pickContractTextForm.title.trim(),
    document_uuid: pickContractTextForm.document_uuid.trim()
  }
  contractTextPickerOpen.value = false
}

function clearPendingContractText() {
  pendingContractText.value = null
}

function viewContractText() {
  if (pendingContractText.value?.document_uuid) {
    window.open(`${codocsUrl}/documents/${pendingContractText.value.document_uuid}`, '_blank')
  }
}

function addContractScanLink() {
  const title = contractScanForm.title.trim()
  const documentUuid = contractScanForm.document_uuid.trim()
  if (!title || !documentUuid) {
    toast.add({ title: '请输入扫描件标题和文档UUID', color: 'error' })
    return
  }
  if (pendingContractScans.value.some(item => item.document_uuid === documentUuid)) {
    toast.add({ title: '该扫描件文档已添加', color: 'warning' })
    return
  }

  pendingContractScans.value.push({ title, document_uuid: documentUuid })
  contractScanForm.document_uuid = ''
}

function removeContractScanLink(index: number) {
  pendingContractScans.value.splice(index, 1)
}

function viewContractScan(scan: PendingDocumentLink) {
  window.open(`${codocsUrl}/documents/${scan.document_uuid}`, '_blank')
}

async function linkContractText(contractId: number) {
  if (!pendingContractText.value) return

  if (pendingContractText.value.mode === 'new') {
    const res = await $fetch<unknown>('/api/v1/documents', {
      method: 'POST',
      body: {
        entity_type: 'contract',
        entity_id: contractId,
        title: pendingContractText.value.title,
        link_type: 'contract_text',
        content: pendingContractText.value.content || `# ${pendingContractText.value.title}\n\n`
      }
    })
    const document = unwrapApiData<DocumentCreateResponse>(res) as DocumentCreateResponse | undefined

    pendingContractText.value = {
      ...pendingContractText.value,
      document_uuid: document?.document_uuid || undefined
    }
    return
  }

  await $fetch('/api/v1/documents', {
    method: 'POST',
    body: {
      entity_type: 'contract',
      entity_id: contractId,
      title: pendingContractText.value.title,
      link_type: 'contract_text',
      document_uuid: pendingContractText.value.document_uuid
    }
  })
}

async function linkContractScanDocuments(contractId: number) {
  for (const scan of pendingContractScans.value) {
    await $fetch('/api/v1/documents', {
      method: 'POST',
      body: {
        entity_type: 'contract',
        entity_id: contractId,
        title: scan.title,
        link_type: 'legacy_contract_scan',
        document_uuid: scan.document_uuid
      }
    })
  }
}

if (form.customer_id && !form.opportunity_id) {
  loadCustomer(form.customer_id)
}
if (form.quotation_id) {
  loadQuotationForContract(form.quotation_id)
}

async function handleSubmit() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入合同名称', color: 'error' })
    return
  }
  if (!form.customer_id) {
    toast.add({ title: '请选择客户', color: 'error' })
    return
  }
  if (!form.contact_id) {
    toast.add({ title: '请选择客户联系人', color: 'error' })
    return
  }
  if (parentRequiredAgreementForms.has(form.agreement_form) && !form.parent_contract_id) {
    toast.add({ title: '请选择主合同', color: 'error' })
    return
  }
  if (!form.lines.length) {
    toast.add({ title: '请至少添加一条产品或服务', color: 'error' })
    return
  }
  if (form.lines.some(line => !line.name.trim() || Number(line.amount_tax_inclusive || 0) <= 0)) {
    toast.add({ title: '请完善产品与服务行名称和金额', color: 'error' })
    return
  }
  const amountTotal = Number(lineAmountTotal.value.toFixed(2))
  if (amountTotal <= 0) {
    toast.add({ title: '产品与服务合计金额需大于0', color: 'error' })
    return
  }
  form.amount_tax_inclusive = amountTotal
  form.amount_tax_exclusive = Number(lineAmountTaxExclusiveTotal.value.toFixed(2)) || null

  loading.value = true
  try {
    const res = await $fetch<unknown>('/api/v1/contracts/drafts', {
      method: 'POST',
      body: {
        ...form,
        is_master_contract: !form.parent_contract_id
      }
    })
    const created = unwrapApiData<ContractCreateResponse>(res) as ContractCreateResponse
    const contractId = created.id || created.contract?.id

    try {
      if (contractId) {
        await linkContractText(contractId)
        await linkContractScanDocuments(contractId)
      }
    } catch (uploadErr: unknown) {
      toast.add({ title: errorMessage(uploadErr, '合同已创建，但合同文本或附件处理失败'), color: 'warning' })
    }

    toast.add({ title: '合同创建成功', color: 'success' })
    router.push(`/contracts/${contractId || created.id}`)
  } catch (err: unknown) {
    toast.add({ title: errorMessage(err, '创建失败'), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="contract-new"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-y-auto !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          新建合同
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="保存"
          icon="i-lucide-check"
          color="primary"
          :loading="loading"
          @click="handleSubmit"
        />
      </Teleport>

      <div class="p-6 space-y-6">
        <div class="space-y-4">
          <div>
            <div class="font-semibold text-sm">
              合同信息
            </div>
            <div class="text-xs text-muted mt-0.5">
              新建合同
            </div>
          </div>
          <UAccordion
            type="multiple"
            :items="contractInfoAccordionItems"
            :default-value="contractInfoAccordionDefault"
            :unmount-on-hide="false"
            :ui="{
              item: 'rounded-md border border-default !border-b px-4 mb-3 last:mb-0',
              trigger: 'py-3.5',
              body: 'pb-4 overflow-visible'
            }"
          >
            <template #basic>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UFormField label="客户" required>
                  <div class="relative">
                    <UInput
                      v-model="customerInput"
                      placeholder="输入客户名称筛选选择"
                      class="w-full"
                      @focus="onCustomerFocus"
                      @blur="onCustomerBlur"
                      @input="onCustomerInput"
                    >
                      <template v-if="customerInput" #trailing>
                        <UButton
                          icon="i-lucide-circle-x"
                          color="neutral"
                          variant="ghost"
                          square
                          size="xs"
                          @mousedown.prevent
                          @click="clearCustomerInput"
                        />
                      </template>
                    </UInput>
                    <div
                      v-if="customerFocused && customerMatches.length && !form.customer_id"
                      class="absolute z-50 w-full mt-1 bg-default border border-default rounded-md shadow-lg max-h-40 overflow-y-auto"
                    >
                      <div
                        v-for="customer in customerMatches"
                        :key="customer.id"
                        class="px-3 py-2 text-sm cursor-pointer hover:bg-elevated"
                        @mousedown.prevent="selectCustomer(customer)"
                      >
                        <div>{{ customer.name }}</div>
                        <div class="text-xs text-muted">
                          商机 {{ customer.opportunity_count || 0 }} · 联系人 {{ customer.contact_count || 0 }}
                        </div>
                      </div>
                    </div>
                  </div>
                </UFormField>
                <UFormField label="关联商机">
                  <div class="space-y-2">
                    <USelect
                      :model-value="form.opportunity_id ?? undefined"
                      :items="oppOptions"
                      searchable
                      placeholder="搜索选择商机（可选）"
                      class="w-full"
                      @update:model-value="(value: number | string | undefined) => { form.opportunity_id = value == null ? null : Number(value) }"
                      @update:search-term="(v: string) => oppKeyword = v"
                    />
                    <UButton
                      v-if="form.opportunity_id"
                      label="清除商机"
                      icon="i-lucide-unlink"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      @click="form.opportunity_id = null"
                    />
                  </div>
                </UFormField>
                <UFormField label="合同名称" required>
                  <UInput v-model="form.name" placeholder="合同名称" class="w-full" />
                </UFormField>
                <UFormField label="合同方向">
                  <USelect v-model="form.direction" :items="contractDirectionOptions" class="w-full" />
                </UFormField>
                <UFormField label="协议形式">
                  <USelect v-model="form.agreement_form" :items="agreementFormOptions" class="w-full" />
                </UFormField>
                <UFormField label="主合同" :required="parentRequiredAgreementForms.has(form.agreement_form)">
                  <USelect
                    :model-value="form.parent_contract_id ?? undefined"
                    :items="parentContractOptions"
                    searchable
                    placeholder="选择主合同"
                    class="w-full"
                    @update:model-value="(value: number | string | undefined) => { form.parent_contract_id = value == null ? null : Number(value) }"
                    @update:search-term="(v: string) => parentContractKeyword = v"
                  />
                </UFormField>
                <UFormField label="合同类型">
                  <USelect
                    v-model="form.template_code"
                    :items="contractTemplateOptions"
                    placeholder="选择合同类型"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="合同金额(含税/元)">
                  <UInput
                    :model-value="Number(lineAmountTotal.toFixed(2))"
                    type="number"
                    placeholder="0"
                    readonly
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="发票类型">
                  <USelect v-model="form.invoice_type" :items="invoiceTypeOptions" class="w-full" />
                </UFormField>
                <UFormField label="签约日期">
                  <UInput v-model="form.sign_date" type="date" class="w-full" />
                </UFormField>
                <UFormField label="生效日期">
                  <UInput v-model="form.effective_date" type="date" class="w-full" />
                </UFormField>
                <UFormField label="到期日期">
                  <UInput v-model="form.end_date" type="date" class="w-full" />
                </UFormField>
                <UFormField label="负责人">
                  <UserPicker v-model="form.owner_user_id" />
                </UFormField>
                <UFormField label="联系人（输入姓名查询）" required>
                  <div class="relative">
                    <UInput
                      v-model="contactNameInput"
                      placeholder="输入联系人姓名"
                      class="w-full"
                      @focus="contactFocused = true"
                      @blur="onContactBlur"
                      @input="onContactInput"
                    />
                    <div v-if="contactFocused && contactMatches.length && !form.contact_id" class="absolute z-50 w-full mt-1 bg-default border border-default rounded-md shadow-lg max-h-40 overflow-y-auto">
                      <div
                        v-for="ct in contactMatches"
                        :key="ct.id"
                        class="px-3 py-2 text-sm cursor-pointer hover:bg-elevated"
                        @mousedown.prevent="selectContact(ct)"
                      >
                        <div>{{ ct.name }}<span v-if="ct.job_title" class="text-muted ml-1">· {{ ct.job_title }}</span></div>
                        <div class="text-xs text-muted">
                          {{ ct.mobile || '' }} {{ ct.email || '' }}
                        </div>
                      </div>
                    </div>
                  </div>
                </UFormField>
                <UFormField label="联系电话">
                  <UInput v-model="form.contact_phone" placeholder="手机号" class="w-full" />
                </UFormField>
                <UFormField label="邮箱">
                  <UInput v-model="form.contact_email" placeholder="邮箱" class="w-full" />
                </UFormField>
                <UFormField label="备注" class="md:col-span-2">
                  <UTextarea
                    v-model="form.remark"
                    placeholder="备注"
                    :rows="2"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </template>

            <template #lines>
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-semibold text-sm">
                      合同标的
                    </div>
                    <div class="text-xs text-muted mt-1">
                      合计 {{ formatMoney(lineAmountTotal) }}
                    </div>
                  </div>
                  <UButton
                    label="添加"
                    icon="i-lucide-plus"
                    size="sm"
                    variant="soft"
                    @click="addLine"
                  />
                </div>
                <div v-if="form.lines.length" class="space-y-4">
                  <div
                    v-for="(line, idx) in form.lines"
                    :key="idx"
                    class="rounded-lg border border-default bg-default/40 p-4"
                  >
                    <div class="mb-4 flex items-start justify-between gap-3 border-b border-muted pb-3">
                      <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                          <UBadge color="primary" variant="subtle">
                            {{ idx + 1 }}
                          </UBadge>
                          <div class="truncate text-sm font-medium text-highlighted">
                            {{ line.name || '未命名产品/服务' }}
                          </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          <span>含税 {{ formatMoney(line.amount_tax_inclusive) }}</span>
                          <span>不含税 {{ formatMoney(line.amount_tax_exclusive) }}</span>
                          <span>税率 {{ Number(line.tax_rate || 0) }}%</span>
                        </div>
                      </div>
                      <UButton
                        icon="i-lucide-trash-2"
                        variant="ghost"
                        color="error"
                        size="xs"
                        aria-label="删除产品或服务"
                        class="shrink-0"
                        @click="removeLine(idx)"
                      />
                    </div>

                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
                      <UFormField label="品类" class="lg:col-span-3">
                        <USelect
                          :model-value="line.line_type"
                          :items="lineTypeOptions"
                          size="sm"
                          class="w-full"
                          @update:model-value="(value: string | undefined) => handleLineTypeChange(line, value)"
                        />
                      </UFormField>
                      <UFormField label="名称" class="sm:col-span-2 lg:col-span-4">
                        <USelect
                          v-if="line.line_type === 'own_software_license'"
                          :model-value="line.product_code ?? undefined"
                          :items="productAssetOptions"
                          :loading="productAssetLoading"
                          searchable
                          placeholder="选择产品资产"
                          size="sm"
                          class="w-full"
                          @update:model-value="(value: string | undefined) => selectLineProduct(line, value)"
                          @update:search-term="handleProductSearch"
                          @click="loadProductAssets()"
                        />
                        <UInput
                          v-else
                          v-model="line.name"
                          placeholder="产品或服务名称"
                          size="sm"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField label="说明" class="sm:col-span-2 lg:col-span-5">
                        <UInput
                          v-model="line.description"
                          placeholder="规格、版本、范围或备注"
                          size="sm"
                          class="w-full"
                        />
                      </UFormField>

                      <UFormField label="数量" class="sm:col-span-1 lg:col-span-2">
                        <UInput
                          v-model.number="line.quantity"
                          type="number"
                          min="0"
                          size="sm"
                          class="w-full"
                          @update:model-value="refreshLineAmount(line)"
                        />
                      </UFormField>
                      <UFormField label="单位" class="sm:col-span-1 lg:col-span-2">
                        <UInput v-model="line.unit" size="sm" class="w-full" />
                      </UFormField>
                      <UFormField label="单价" class="lg:col-span-3">
                        <UInput
                          v-model.number="line.unit_price"
                          type="number"
                          min="0"
                          size="sm"
                          class="w-full"
                          @update:model-value="refreshLineAmount(line)"
                        />
                      </UFormField>
                      <UFormField label="含税金额" class="lg:col-span-3">
                        <UInput
                          v-model.number="line.amount_tax_inclusive"
                          type="number"
                          min="0"
                          size="sm"
                          class="w-full"
                          @update:model-value="refreshLineAmount(line)"
                        />
                      </UFormField>
                      <UFormField label="税率(%)" class="lg:col-span-2">
                        <UInput
                          v-model.number="line.tax_rate"
                          type="number"
                          min="0"
                          size="sm"
                          class="w-full"
                          @update:model-value="refreshLineAmount(line)"
                        />
                      </UFormField>

                      <UFormField label="验收" class="lg:col-span-3">
                        <div class="flex h-8 items-center rounded-md border border-default bg-default px-3">
                          <UCheckbox v-model="line.acceptance_required" label="需要验收" />
                        </div>
                      </UFormField>
                      <UFormField label="验收标准" class="sm:col-span-2 lg:col-span-9">
                        <UInput
                          v-model="line.acceptance_criteria"
                          :disabled="!line.acceptance_required"
                          placeholder="验收口径或通过条件"
                          size="sm"
                          class="w-full"
                        />
                      </UFormField>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
                  暂无产品与服务
                </div>
              </div>
            </template>

            <template #terms>
              <div class="space-y-4">
                <UFormField label="付款条款摘要">
                  <UTextarea
                    v-model="form.payment_term_summary"
                    :rows="3"
                    placeholder="如：预付款30%，验收后60%，尾款10%"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </template>

            <template #documents>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <UFormField label="合同文本">
                  <div class="rounded-xl border border-default bg-elevated/40 p-4 space-y-3">
                    <div class="flex flex-wrap gap-3">
                      <template v-if="pendingContractText?.document_uuid">
                        <UButton
                          label="查看合同文本"
                          icon="i-lucide-file-text"
                          color="primary"
                          variant="solid"
                          @click="viewContractText"
                        />
                      </template>
                      <template v-else>
                        <UButton
                          label="新建合同文本"
                          icon="i-lucide-file-plus"
                          color="primary"
                          variant="solid"
                          @click="contractTextModalOpen = true"
                        />
                        <UButton
                          label="选择合同文本"
                          icon="i-lucide-link-2"
                          color="neutral"
                          variant="soft"
                          @click="contractTextPickerOpen = true"
                        />
                      </template>
                      <UButton
                        v-if="pendingContractText"
                        label="移除"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        @click="clearPendingContractText"
                      />
                    </div>
                    <div v-if="pendingContractText" class="rounded-lg bg-default px-3 py-2 text-sm">
                      <div class="font-medium">
                        {{ pendingContractText.title }}
                      </div>
                      <div class="text-xs text-muted mt-1">
                        {{ pendingContractText.mode === 'new' ? '保存合同后将自动创建并关联到 Codocs' : '保存合同后将自动关联已有 Codocs 文档' }}
                      </div>
                    </div>
                  </div>
                </UFormField>
                <UFormField label="扫描件文档">
                  <div class="rounded-xl border border-default bg-elevated/40 p-4 space-y-3">
                    <div class="grid grid-cols-1 gap-2">
                      <UInput
                        v-model="contractScanForm.title"
                        placeholder="扫描件标题"
                        class="w-full"
                      />
                      <UInput
                        v-model="contractScanForm.document_uuid"
                        placeholder="Codocs 文档 UUID"
                        class="w-full"
                      />
                      <UButton
                        label="添加扫描件"
                        icon="i-lucide-link-2"
                        color="neutral"
                        variant="soft"
                        @click="addContractScanLink"
                      />
                    </div>
                    <div v-if="pendingContractScans.length" class="space-y-2">
                      <div
                        v-for="(scan, index) in pendingContractScans"
                        :key="scan.document_uuid"
                        class="flex items-center justify-between gap-2 rounded-lg bg-default px-3 py-2"
                      >
                        <button
                          type="button"
                          class="min-w-0 flex-1 text-left"
                          @click="viewContractScan(scan)"
                        >
                          <div class="truncate text-sm font-medium">
                            {{ scan.title }}
                          </div>
                          <div class="truncate text-xs text-muted">
                            {{ scan.document_uuid }}
                          </div>
                        </button>
                        <UButton
                          icon="i-lucide-trash-2"
                          color="error"
                          variant="ghost"
                          size="xs"
                          @click="removeContractScanLink(index)"
                        />
                      </div>
                    </div>
                  </div>
                </UFormField>
              </div>
            </template>
          </UAccordion>
        </div>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">履约与结算预览</span>
              <UBadge color="primary" variant="subtle">
                P0B
              </UBadge>
            </div>
          </template>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="space-y-3">
              <div class="flex items-center gap-2 text-sm font-medium">
                <UIcon name="i-lucide-list-checks" class="size-4 text-primary" />
                <span>履约义务</span>
              </div>
              <div v-if="obligationPreview.length" class="space-y-2">
                <div
                  v-for="item in obligationPreview"
                  :key="item.key"
                  class="rounded-md border border-default p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium">
                        {{ item.name }}
                      </div>
                      <div class="text-xs text-muted mt-1 truncate">
                        {{ item.line }}
                      </div>
                    </div>
                    <UBadge :color="item.acceptance ? 'warning' : 'neutral'" variant="subtle" size="sm">
                      {{ item.acceptance ? '验收' : '交付' }}
                    </UBadge>
                  </div>
                </div>
              </div>
              <div v-else class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted">
                添加产品或服务后生成预览
              </div>
            </div>

            <div class="space-y-3">
              <div class="flex items-center gap-2 text-sm font-medium">
                <UIcon name="i-lucide-receipt-text" class="size-4 text-primary" />
                <span>结算条件</span>
              </div>
              <div v-if="billingPreview.length" class="space-y-2">
                <div
                  v-for="item in billingPreview"
                  :key="item.key"
                  class="rounded-md border border-default p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium">
                        {{ item.name }}
                      </div>
                      <div class="text-xs text-muted mt-1">
                        {{ billingTriggerLabel(item.trigger) }}
                      </div>
                    </div>
                    <span class="font-mono text-sm">{{ formatMoney(item.amount) }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted">
                填写行金额后生成预览
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="contractTextModalOpen" title="新建合同文本">
    <template #body>
      <div class="space-y-4">
        <UFormField label="文档标题" required>
          <UInput v-model="createContractTextForm.title" placeholder="如：XX项目合同文本" class="w-full" />
        </UFormField>
        <UFormField label="初始内容">
          <UTextarea
            v-model="createContractTextForm.content"
            :rows="6"
            placeholder="可选，留空将自动生成标题模板"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="contractTextModalOpen = false"
        />
        <UButton
          label="确定"
          color="primary"
          icon="i-lucide-check"
          @click="saveNewContractTextDraft"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="contractTextPickerOpen" title="选择合同文本">
    <template #body>
      <div class="space-y-4">
        <UFormField label="文档标题" required>
          <UInput v-model="pickContractTextForm.title" placeholder="输入显示标题" class="w-full" />
        </UFormField>
        <UFormField label="Codocs 文档 UUID" required>
          <UInput v-model="pickContractTextForm.document_uuid" placeholder="粘贴已有文档 UUID" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="contractTextPickerOpen = false"
        />
        <UButton
          label="确定"
          color="primary"
          icon="i-lucide-link-2"
          @click="savePickedContractText"
        />
      </div>
    </template>
  </UModal>
</template>
