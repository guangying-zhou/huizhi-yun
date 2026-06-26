<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()

const loading = ref(false)
const initialCustomerId = route.query.customer_id ? Number(route.query.customer_id) : null
const filteredCustomerId = ref<number | null>(initialCustomerId)

const form = reactive({
  customer_id: initialCustomerId as number | null,
  opportunity_id: route.query.opportunity_id ? Number(route.query.opportunity_id) : null as number | null,
  valid_until: '',
  discount_rate: null as number | null,
  tax_rate: 6,
  amount_tax_inclusive: null as number | null,
  amount_tax_exclusive: null as number | null,
  owner_user_id: authUser.value || '',
  remark: '',
  items: [
    { item_name: '', specification: '', unit: '', quantity: 1, unit_price: null as number | null, cost_price: null as number | null }
  ]
})

const customerInput = ref('')
const customerFocused = ref(false)
const { data: customerResult } = useFetch('/api/v1/customers', {
  query: computed(() => ({ keyword: customerInput.value, pageSize: 20 })),
  transform: (res: any) => res.data?.items || []
})
const customerMatches = computed(() => customerResult.value || [])

async function applyCustomerSelection(customer: { id: number, name: string }, options: { preserveOpportunity?: boolean } = {}) {
  customerInput.value = customer.name
  form.customer_id = customer.id
  filteredCustomerId.value = customer.id

  if (!options.preserveOpportunity) {
    form.opportunity_id = null
  }
}

function clearCustomerSelection(options: { clearOpportunity?: boolean } = {}) {
  form.customer_id = null
  filteredCustomerId.value = null

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
    console.error('[Quote] Failed to load customer:', err)
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

    if (opp.customer_id) {
      await applyCustomerSelection({ id: opp.customer_id, name: opp.customer_name || '' }, { preserveOpportunity: true })
    }
  } catch (err) {
    console.error('[Quote] Failed to load opportunity:', err)
  }
}

watch(() => form.opportunity_id, syncOpportunityCustomer, { immediate: true })

if (form.customer_id && !form.opportunity_id) {
  loadCustomer(form.customer_id)
}

function addItem() {
  form.items.push({ item_name: '', specification: '', unit: '', quantity: 1, unit_price: null, cost_price: null })
}

function removeItem(idx: number) {
  if (form.items.length > 1) form.items.splice(idx, 1)
}

const totalAmount = computed(() => {
  return form.items.reduce((sum, item) => {
    const subtotal = (item.quantity || 0) * (item.unit_price || 0)
    return sum + subtotal
  }, 0)
})

async function handleSubmit() {
  if (!form.customer_id) {
    toast.add({ title: '请选择客户', color: 'error' })
    return
  }

  loading.value = true
  try {
    const submitItems = form.items.filter(i => i.item_name.trim()).map(item => ({
      ...item,
      amount_tax_inclusive: (item.quantity || 0) * (item.unit_price || 0)
    }))
    const res = await $fetch<any>('/api/v1/quotes', {
      method: 'POST',
      body: {
        ...form,
        amount_tax_inclusive: totalAmount.value || form.amount_tax_inclusive,
        items: submitItems
      }
    })
    toast.add({ title: '报价创建成功', color: 'success' })
    router.push(`/quotes/${res.data.id}`)
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="quote-new">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          新建报价
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
            <span class="font-semibold">报价信息</span>
          </template>
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
              <USelect
                v-model="form.opportunity_id"
                :items="oppOptions"
                searchable
                placeholder="搜索商机(选填)"
                class="w-full"
                @update:search-term="(v: string) => oppKeyword = v"
              />
            </UFormField>
            <UFormField label="有效期">
              <UInput v-model="form.valid_until" type="date" class="w-full" />
            </UFormField>
            <UFormField label="整单折扣(%)">
              <UInput
                v-model.number="form.discount_rate"
                type="number"
                placeholder="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="税率(%)">
              <UInput v-model.number="form.tax_rate" type="number" class="w-full" />
            </UFormField>
            <UFormField label="负责人">
              <UserPicker v-model="form.owner_user_id" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">报价明细</span>
              <UButton
                label="添加行"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="addItem"
              />
            </div>
          </template>
          <div class="space-y-3">
            <div v-for="(item, idx) in form.items" :key="idx" class="grid grid-cols-12 gap-2 items-end">
              <div class="col-span-3">
                <label v-if="idx === 0" class="text-xs text-muted">名称</label>
                <UInput v-model="item.item_name" placeholder="产品/服务名称" size="sm" />
              </div>
              <div class="col-span-2">
                <label v-if="idx === 0" class="text-xs text-muted">规格</label>
                <UInput v-model="item.specification" placeholder="规格" size="sm" />
              </div>
              <div class="col-span-1">
                <label v-if="idx === 0" class="text-xs text-muted">单位</label>
                <UInput v-model="item.unit" placeholder="套" size="sm" />
              </div>
              <div class="col-span-1">
                <label v-if="idx === 0" class="text-xs text-muted">数量</label>
                <UInput v-model.number="item.quantity" type="number" size="sm" />
              </div>
              <div class="col-span-2">
                <label v-if="idx === 0" class="text-xs text-muted">单价</label>
                <UInput
                  v-model.number="item.unit_price"
                  type="number"
                  placeholder="0"
                  size="sm"
                />
              </div>
              <div class="col-span-2">
                <label v-if="idx === 0" class="text-xs text-muted">小计</label>
                <div class="font-mono text-sm py-1.5 px-2">
                  {{ ((item.quantity || 0) * (item.unit_price || 0)).toLocaleString() }}
                </div>
              </div>
              <div class="col-span-1">
                <UButton
                  v-if="form.items.length > 1"
                  icon="i-lucide-trash-2"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="removeItem(idx)"
                />
              </div>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-default text-right">
            <span class="text-sm text-muted mr-2">合计：</span>
            <span class="text-lg font-bold font-mono">{{ totalAmount.toLocaleString() }}</span>
            <span class="text-xs text-muted ml-1">元</span>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">备注</span>
          </template>
          <UTextarea
            v-model="form.remark"
            placeholder="备注信息"
            :rows="2"
            class="w-full"
          />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
