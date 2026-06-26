<script setup lang="ts">
import type { ApiResponse } from '~/types'
import {
  arrayToMultiline,
  buildStageOptions as buildStageFallbackOptions,
  businessDomainFallbackOptions,
  customerDomainFallbackOptions,
  defaultProductLifecycleStatus,
  multilineToArray,
  normalizeBusinessDomain,
  normalizeProductAssetValueType,
  normalizeProductInvestmentStrategy,
  normalizeProductLine,
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
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [id: number]
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
  product_line: 'FC',
  customer_domain: ['G'] as string[],
  business_domain: 'pending',
  product_level: 'pending_eval',
  asset_level: 'pending_eval',
  status: 'mvp',
  build_stage: 'planned',
  current_version: '',
  target_version: '',
  productization_value_level: '',
  supported_terminals: [] as string[],
  covered_legacy_systems: '',
  summary: '',
  notes: ''
})

function hydrate() {
  state.product_code = ''
  state.product_name = ''
  state.product_line = normalizeProductLine(productLineOptions.value[0]?.value)
  state.customer_domain = ['G']
  state.business_domain = normalizeBusinessDomain(businessDomainOptions.value[0]?.value)
  state.product_level = normalizeProductInvestmentStrategy(productLevelOptions.value.at(-1)?.value)
  state.asset_level = normalizeProductAssetValueType(assetLevelOptions.value.at(-1)?.value)
  state.status = defaultProductLifecycleStatus(statusOptions.value)
  state.build_stage = 'planned'
  state.current_version = ''
  state.target_version = ''
  state.productization_value_level = ''
  state.supported_terminals = []
  state.covered_legacy_systems = arrayToMultiline(null)
  state.summary = ''
  state.notes = ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

async function handleSubmit() {
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
    const response = await $fetch<ApiResponse<{ id: number }>>('/api/v1/products', {
      method: 'POST',
      body: {
        product_code: state.product_code.trim() || null,
        product_name: state.product_name.trim(),
        product_line: state.product_line,
        customer_domain: nullableArray(state.customer_domain),
        business_domain: state.business_domain,
        product_level: state.product_level || null,
        asset_level: state.asset_level || null,
        status: state.status,
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
      title: '产品主档已创建',
      description: '可以继续进入详情页补充关联关系。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created', response.data.id)
    isOpen.value = false
  } catch (error) {
    console.error('[ProductAssetCreate] Failed:', error)
    toast.add({
      title: '创建失败',
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
    title="新增产品主档"
    description="登记产品基本画像、分级分域、终端和版本信息。"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="产品编码">
            <UInput
              v-model="state.product_code"
              placeholder="留空自动生成"
              class="w-full"
            />
          </UFormField>

          <UFormField label="产品名称" required>
            <UInput
              v-model="state.product_name"
              placeholder="例如：Align 企业智能助手"
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
            placeholder="描述产品核心价值、目标用户和场景定位"
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
            placeholder="补充交付边界、商业化节奏或特殊说明"
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
          创建
        </UButton>
      </div>
    </template>
  </UModal>
</template>
