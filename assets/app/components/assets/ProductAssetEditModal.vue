<script setup lang="ts">
import type { ApiResponse, ProductAssetItem } from '~/types'
import {
  arrayToMultiline,
  buildStageOptions as buildStageFallbackOptions,
  businessDomainFallbackOptions,
  customerDomainFallbackOptions,
  multilineToArray,
  normalizeBusinessDomain,
  normalizeCustomerDomains,
  normalizeProductAssetValueType,
  normalizeProductInvestmentStrategy,
  normalizeProductLifecycleStatusForOptions,
  normalizeProductLine,
  normalizeSupportedTerminals,
  nullableArray,
  preferDictionaryOptions,
  preferModernOptions,
  productAssetValueTypeOptions,
  productInvestmentStrategyOptions,
  productLifecycleStatusOptions,
  productLineFallbackOptions,
  productizationValueLevelOptions as productizationValueLevelFallbackOptions,
  supportedTerminalOptions as supportedTerminalFallbackOptions
} from '~/utils/productAssets'

const props = defineProps<{
  open: boolean
  product: ProductAssetItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const productLineOptions = computed(() => preferModernOptions(getOptions('product_line'), productLineFallbackOptions))
const customerDomainOptions = computed(() => preferModernOptions(getOptions('customer_domain'), customerDomainFallbackOptions))
const businessDomainOptions = computed(() => preferModernOptions(getOptions('business_domain'), businessDomainFallbackOptions))
const productLevelOptions = computed(() => preferModernOptions(getOptions('product_level'), productInvestmentStrategyOptions))
const assetLevelOptions = computed(() => preferModernOptions(getOptions('product_asset_value_type'), productAssetValueTypeOptions))
const statusOptions = computed(() => preferDictionaryOptions(getOptions('product_status'), productLifecycleStatusOptions))
const buildStageOptions = computed(() => preferModernOptions(getOptions('build_stage'), buildStageFallbackOptions))
const productizationValueLevelOptions = computed(() => preferModernOptions(getOptions('productization_value_level'), productizationValueLevelFallbackOptions))
const supportedTerminalOptions = computed(() => preferModernOptions(getOptions('supported_terminal'), supportedTerminalFallbackOptions))

const state = reactive({
  product_code: '',
  product_name: '',
  product_line: '',
  customer_domain: [] as string[],
  business_domain: '',
  product_level: '',
  asset_level: '',
  status: '',
  build_stage: '',
  current_version: '',
  target_version: '',
  productization_value_level: '',
  supported_terminals: [] as string[],
  covered_legacy_systems: '',
  summary: '',
  notes: ''
})

function hydrate() {
  state.product_code = props.product?.product_code || ''
  state.product_name = props.product?.product_name || ''
  state.product_line = normalizeProductLine(props.product?.product_line)
  state.customer_domain = normalizeCustomerDomains(props.product?.customer_domain)
  state.business_domain = normalizeBusinessDomain(props.product?.business_domain)
  state.product_level = normalizeProductInvestmentStrategy(props.product?.product_level)
  state.asset_level = normalizeProductAssetValueType(props.product?.asset_level)
  state.status = normalizeProductLifecycleStatusForOptions(props.product?.status, statusOptions.value)
  state.build_stage = props.product?.build_stage || ''
  state.current_version = props.product?.current_version || ''
  state.target_version = props.product?.target_version || ''
  state.productization_value_level = props.product?.productization_value_level || ''
  state.supported_terminals = normalizeSupportedTerminals(props.product?.supported_terminals)
  state.covered_legacy_systems = arrayToMultiline(props.product?.covered_legacy_systems)
  state.summary = props.product?.summary || ''
  state.notes = props.product?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.product, () => {
  if (props.open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!props.product?.id) {
    return
  }

  if (!state.product_name.trim()) {
    toast.add({ title: '缺少产品名称', description: '请先填写产品名称。', color: 'warning' })
    return
  }

  if (state.customer_domain.length === 0) {
    toast.add({ title: '缺少业务域', description: '请至少选择一个业务域。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/products/${props.product.id}`, {
      method: 'PATCH',
      body: {
        product_code: state.product_code.trim() || null,
        product_name: state.product_name.trim(),
        product_line: state.product_line || null,
        customer_domain: nullableArray(state.customer_domain),
        business_domain: state.business_domain || null,
        product_level: state.product_level || null,
        asset_level: state.asset_level || null,
        status: state.status || null,
        build_stage: state.build_stage || null,
        current_version: state.current_version.trim() || null,
        target_version: state.target_version.trim() || null,
        productization_value_level: state.productization_value_level || null,
        supported_terminals: nullableArray(state.supported_terminals),
        covered_legacy_systems: multilineToArray(state.covered_legacy_systems),
        summary: state.summary.trim() || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '产品主档已更新',
      description: '产品主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[ProductAssetEdit] Failed:', error)
    toast.add({
      title: '更新失败',
      description: '请检查录入内容后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="编辑产品主档"
    description="维护产品分域、分级、终端和版本信息。"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="谨慎修改产品编码"
          description="如果修改编码，可能会导致其他模块挂接的数据失效，请谨慎修改。"
        />

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="产品编码">
            <UInput
              v-model="state.product_code"
              placeholder="留空保持原编码"
              class="w-full"
            />
          </UFormField>

          <UFormField label="产品名称" required>
            <UInput
              v-model="state.product_name"
              class="w-full"
            />
          </UFormField>

          <UFormField label="产品线">
            <USelect
              v-model="state.product_line"
              :items="productLineOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="业务域" class="md:col-span-2">
            <UCheckboxGroup
              v-model="state.customer_domain"
              :items="customerDomainOptions"
              orientation="horizontal"
            />
          </UFormField>

          <UFormField label="业务域分类">
            <USelect
              v-model="state.business_domain"
              :items="businessDomainOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="产品投资策略">
            <USelect
              v-model="state.product_level"
              :items="productLevelOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="资产价值类型">
            <USelect
              v-model="state.asset_level"
              :items="assetLevelOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="生命周期状态">
            <USelect
              v-model="state.status"
              :items="statusOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="建设阶段">
            <USelect
              v-model="state.build_stage"
              :items="buildStageOptions"
              placeholder="未设置"
              class="w-full"
            />
          </UFormField>

          <UFormField label="当前版本">
            <UInput
              v-model="state.current_version"
              placeholder="例如：V1.0"
              class="w-full"
            />
          </UFormField>

          <UFormField label="目标版本">
            <UInput
              v-model="state.target_version"
              placeholder="例如：V2.0"
              class="w-full"
            />
          </UFormField>

          <UFormField label="产品化价值等级">
            <USelect
              v-model="state.productization_value_level"
              :items="productizationValueLevelOptions"
              placeholder="待评估"
              class="w-full"
            />
          </UFormField>

          <UFormField label="支持终端" class="md:col-span-2">
            <UCheckboxGroup
              v-model="state.supported_terminals"
              :items="supportedTerminalOptions"
              orientation="horizontal"
            />
          </UFormField>
        </div>

        <UFormField label="产品简述">
          <UTextarea
            v-model="state.summary"
            :rows="3"
            class="w-full"
          />
        </UFormField>

        <UFormField label="涵盖已有系统">
          <UTextarea
            v-model="state.covered_legacy_systems"
            :rows="3"
            placeholder="一行一个已有系统名称"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="4"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-save" @click="handleSubmit">
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
