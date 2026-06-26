<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()

const loading = ref(false)
const initialCustomerId = route.query.customer_id ? Number(route.query.customer_id) : null
const filteredCustomerId = ref<number | null>(initialCustomerId)

const form = reactive({
  name: '',
  opportunity_id: route.query.opportunity_id ? Number(route.query.opportunity_id) : null as number | null,
  customer_id: initialCustomerId as number | null,
  project_code: '',
  budget_amount: null as number | null,
  tender_type: 'open' as string | undefined,
  bidding_method: 'agency',
  publish_date: '',
  registration_deadline: '',
  bid_submission_deadline: '',
  bid_opening_date: '',
  bid_amount: null as number | null,
  bid_bond_amount: null as number | null,
  owner_user_id: authUser.value || '',
  presales_user_id: '',
  tenderer_name: '',
  agency_id: null as number | null,
  agency_name: '',
  agency_type: undefined as string | undefined,
  agency_address: '',
  agency_contact_name: '',
  agency_contact_phone: '',
  agency_contact_email: '',
  contact_id: null as number | null,
  contact_phone: '',
  contact_email: '',
  key_requirements: '',
  competitors: '',
  remark: ''
})

// 客户选择（输入过滤 + 下拉选择）
const customerInput = ref('')
const customerFocused = ref(false)
const { data: customerResult } = useFetch('/api/v1/customers', {
  query: computed(() => ({ keyword: customerInput.value, pageSize: 20 })),
  transform: (res: any) => res.data?.items || []
})
const customerMatches = computed(() => customerResult.value || [])

function resetContactFields() {
  contacts.value = []
  form.contact_id = null
  contactNameInput.value = ''
  form.contact_phone = ''
  form.contact_email = ''
}

async function applyCustomerSelection(customer: { id: number, name: string }, options: { preserveOpportunity?: boolean } = {}) {
  const prevCustomerName = customerInput.value

  customerInput.value = customer.name
  form.customer_id = customer.id
  filteredCustomerId.value = customer.id

  if (!form.tenderer_name || form.tenderer_name === prevCustomerName) {
    form.tenderer_name = customer.name
  }

  resetContactFields()
  await loadContacts(customer.id)

  if (!options.preserveOpportunity) {
    form.opportunity_id = null
  }
}

function clearCustomerSelection(options: { clearOpportunity?: boolean } = {}) {
  form.customer_id = null
  filteredCustomerId.value = null
  resetContactFields()
  if (options.clearOpportunity) {
    form.opportunity_id = null
  }
}

function onCustomerInput() {
  clearCustomerSelection({ clearOpportunity: true })
}

function onCustomerFocus() {
  customerFocused.value = true
}

function onCustomerBlur() {
  window.setTimeout(() => {
    customerFocused.value = false
  }, 200)
}

function selectCustomer(customer: any) {
  applyCustomerSelection({ id: customer.id, name: customer.name })
  customerFocused.value = false
}

function clearCustomerInput() {
  customerInput.value = ''
  clearCustomerSelection({ clearOpportunity: true })
  customerFocused.value = false
}

async function loadCustomer(customerId: number, options: { preserveOpportunity?: boolean } = {}) {
  try {
    const res: any = await $fetch(`/api/v1/customers/${customerId}`)
    const customer = res?.data
    if (!customer) return
    await applyCustomerSelection({ id: customer.id, name: customer.name }, options)
  } catch (err) {
    console.error('[Tender] Failed to load customer:', err)
  }
}

// 搜索商机（必选）
const oppKeyword = ref('')
const { data: oppResult } = useFetch('/api/v1/opportunities', {
  query: computed(() => ({
    keyword: oppKeyword.value,
    status: 'active',
    pageSize: 20,
    customer_id: filteredCustomerId.value || undefined
  })),
  transform: (res: any) => res.data?.items || []
})
const oppOptions = computed(() => (oppResult.value || []).map((o: any) => ({ label: `${o.name} (${o.customer_name})`, value: o.id })))

watch(oppResult, (items) => {
  if (!filteredCustomerId.value || form.opportunity_id || !items?.length) {
    return
  }

  if (items.length === 1) {
    form.opportunity_id = items[0].id
  }
}, { immediate: true })

// 客户联系人
const contacts = ref<any[]>([])

async function loadContacts(customerId: number) {
  try {
    const res = await $fetch<any>(`/api/v1/customers/${customerId}/contacts`)
    contacts.value = res.data || []
  } catch {
    contacts.value = []
  }
}
const contactFocused = ref(false)
const contactNameInput = ref('')

const contactMatches = computed(() => {
  if (!contacts.value.length) return []
  if (!contactNameInput.value) return contacts.value
  return contacts.value.filter((c: any) => c.name.includes(contactNameInput.value))
})

function selectContact(ct: any) {
  form.contact_id = ct.id
  contactNameInput.value = ct.name
  form.contact_phone = ct.mobile || ct.phone || ''
  form.contact_email = ct.email || ''
  contactFocused.value = false
}

function onContactInput() {
  form.contact_id = null // 手动输入时清空已选
}

function onContactBlur() {
  window.setTimeout(() => {
    contactFocused.value = false
  }, 200)
}

// 招标代理机构搜索（实时查询）
const agencyFocused = ref(false)
const agencyMatches = ref<any[]>([])
let agencyTimer: ReturnType<typeof setTimeout> | null = null

async function searchAgencies(keyword: string) {
  try {
    const res = await $fetch<any>('/api/v1/tenders/agencies', { query: { keyword } })
    agencyMatches.value = res.data || []
  } catch {
    agencyMatches.value = []
  }
}

function onAgencyInput() {
  form.agency_id = null
  if (agencyTimer) clearTimeout(agencyTimer)
  agencyTimer = setTimeout(async () => {
    await nextTick()
    searchAgencies(form.agency_name || '')
  }, 200)
}

function onAgencyFocus() {
  agencyFocused.value = true
  searchAgencies(form.agency_name || '')
}

function onAgencyBlur() {
  window.setTimeout(() => {
    agencyFocused.value = false
  }, 200)
}

function selectAgency(agency: any) {
  form.agency_id = agency.id
  form.agency_name = agency.name
  form.agency_type = agency.agency_type || undefined
  form.agency_address = agency.address || ''
  form.agency_contact_name = agency.contact_name || ''
  form.agency_contact_phone = agency.contact_phone || ''
  form.agency_contact_email = agency.contact_email || ''
  agencyFocused.value = false
}

const tenderTypeOptions = [
  { label: '公开招标', value: 'open' },
  { label: '邀请招标', value: 'invited' },
  { label: '竞争性谈判', value: 'negotiation' },
  { label: '单一来源', value: 'single_source' },
  { label: '询价', value: 'inquiry' },
  { label: '框架协议(入围)', value: 'framework' }
]

const biddingMethodOptions = [
  { label: '代理招标', value: 'agency' },
  { label: '自行招标', value: 'self' }
]

const agencyTypeOptions = [
  { label: '政府采购', value: 'government' },
  { label: '集团采购', value: 'group' },
  { label: '第三方代理', value: 'third_party' }
]
const lastAutoProjectName = ref('')

async function syncOpportunityCustomer(oppId: number | null) {
  if (!oppId) {
    return
  }

  const selectedOpp = (oppResult.value || []).find((item: any) => Number(item.id) === Number(oppId))
  if (selectedOpp?.customer_name) {
    customerInput.value = selectedOpp.customer_name
  }

  try {
    const res: any = await $fetch(`/api/v1/opportunities/${oppId}`)
    const opp = res?.data
    if (!opp) {
      return
    }

    if (!form.name || form.name === lastAutoProjectName.value) {
      form.name = opp.name || ''
      lastAutoProjectName.value = opp.name || ''
    }

    if (opp.customer_id) {
      await applyCustomerSelection({ id: opp.customer_id, name: opp.customer_name || '' }, { preserveOpportunity: true })
    }
  } catch (err) {
    console.error('[Tender] Failed to load opportunity:', err)
  }
}

watch(() => form.opportunity_id, syncOpportunityCustomer, { immediate: true })

watch(() => form.bidding_method, (method) => {
  if (method === 'self') {
    form.agency_id = null
    form.agency_name = ''
    form.agency_type = undefined
    form.agency_address = ''
    form.agency_contact_name = ''
    form.agency_contact_phone = ''
    form.agency_contact_email = ''
    agencyMatches.value = []
    agencyFocused.value = false
  }
})

if (form.customer_id && !form.opportunity_id) {
  loadCustomer(form.customer_id)
}

async function handleSubmit() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入项目名称', color: 'error' })
    return
  }
  if (!form.opportunity_id) {
    toast.add({ title: '请选择关联商机', color: 'error' })
    return
  }
  if (form.tender_type !== 'framework' && (!form.budget_amount || form.budget_amount <= 0)) {
    toast.add({ title: '除框架协议(入围)外，请输入大于0的项目预算', color: 'error' })
    return
  }
  loading.value = true
  try {
    const res = await $fetch<any>('/api/v1/tenders', { method: 'POST', body: form })
    toast.add({ title: '投标项目创建成功', color: 'success' })
    router.push(`/tenders/${res.data.id}`)
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="tender-new">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          新建投标
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
        <UCard :ui="{ root: 'overflow-visible', body: 'overflow-visible' }">
          <template #header>
            <span class="font-semibold">基本信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="客户">
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
            <UFormField label="关联商机" required>
              <USelect
                v-model="form.opportunity_id"
                :items="oppOptions"
                searchable
                placeholder="搜索选择商机（必选）"
                class="w-full"
                @update:search-term="(v: string) => oppKeyword = v"
              />
            </UFormField>
            <UFormField label="项目名称" required>
              <UInput v-model="form.name" placeholder="如：XX市政务云平台建设项目" class="w-full" />
            </UFormField>
            <UFormField label="招标人（默认客户）">
              <UInput v-model="form.tenderer_name" placeholder="招标人名称" class="w-full" />
            </UFormField>
            <UFormField label="项目编号(甲方)">
              <UInput v-model="form.project_code" placeholder="招标文件编号" class="w-full" />
            </UFormField>
            <UFormField label="招标方式">
              <URadioGroup v-model="form.bidding_method" :items="biddingMethodOptions" orientation="horizontal" />
            </UFormField>
            <UFormField label="招标类型">
              <USelect
                v-model="form.tender_type"
                :items="tenderTypeOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="项目预算(元)">
              <UInput
                v-model.number="form.budget_amount"
                type="number"
                placeholder="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="负责人" required>
              <UserPicker v-model="form.owner_user_id" />
            </UFormField>
            <UFormField label="售前负责人">
              <UserPicker v-model="form.presales_user_id" placeholder="选择售前" />
            </UFormField>
          </div>
        </UCard>

        <UCard :ui="{ root: 'overflow-visible', body: 'overflow-visible' }">
          <template #header>
            <span class="font-semibold">客户联系人</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UFormField label="联系人（输入姓名查询）">
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
          </div>
        </UCard>

        <UCard v-if="form.bidding_method === 'agency'" :ui="{ root: 'overflow-visible', body: 'overflow-visible' }">
          <template #header>
            <span class="font-semibold">招标代理机构</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="机构名称（输入自动查询已有机构）">
              <div class="relative">
                <UInput
                  v-model="form.agency_name"
                  placeholder="输入代理机构名称"
                  class="w-full"
                  @focus="onAgencyFocus"
                  @blur="onAgencyBlur"
                  @input="onAgencyInput"
                />
                <div v-if="agencyFocused && agencyMatches.length && !form.agency_id" class="absolute z-50 w-full mt-1 bg-default border border-default rounded-md shadow-lg max-h-40 overflow-y-auto">
                  <div
                    v-for="a in agencyMatches"
                    :key="a.id"
                    class="px-3 py-2 text-sm cursor-pointer hover:bg-elevated"
                    @mousedown.prevent="selectAgency(a)"
                  >
                    <div>{{ a.name }}</div>
                    <div class="text-xs text-muted">
                      {{ a.contact_name || '' }} {{ a.contact_phone || '' }}
                    </div>
                  </div>
                </div>
              </div>
            </UFormField>
            <UFormField label="代理类型">
              <USelect
                v-model="form.agency_type"
                :items="agencyTypeOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="地址">
              <UInput v-model="form.agency_address" class="w-full" />
            </UFormField>
            <UFormField label="联系人">
              <UInput v-model="form.agency_contact_name" class="w-full" />
            </UFormField>
            <UFormField label="联系电话">
              <UInput v-model="form.agency_contact_phone" class="w-full" />
            </UFormField>
            <UFormField label="邮箱">
              <UInput v-model="form.agency_contact_email" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关键日期</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="招标公告日期">
              <UInput v-model="form.publish_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="报名截止日期">
              <UInput v-model="form.registration_deadline" type="date" class="w-full" />
            </UFormField>
            <UFormField label="投标截止日期">
              <UInput v-model="form.bid_submission_deadline" type="date" class="w-full" />
            </UFormField>
            <UFormField label="开标日期">
              <UInput v-model="form.bid_opening_date" type="date" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">投标信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="投标金额(元)">
              <UInput
                v-model.number="form.bid_amount"
                type="number"
                placeholder="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="投标保证金(元)">
              <UInput
                v-model.number="form.bid_bond_amount"
                type="number"
                placeholder="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="关键要求/资质条件" class="md:col-span-2">
              <UTextarea
                v-model="form.key_requirements"
                placeholder="招标文件中的关键资质要求"
                :rows="3"
                class="w-full"
              />
            </UFormField>
            <UFormField label="竞争对手" class="md:col-span-2">
              <UTextarea
                v-model="form.competitors"
                placeholder="已知的竞争对手及情况"
                :rows="2"
                class="w-full"
              />
            </UFormField>
            <UFormField label="备注" class="md:col-span-2">
              <UTextarea v-model="form.remark" :rows="2" class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
