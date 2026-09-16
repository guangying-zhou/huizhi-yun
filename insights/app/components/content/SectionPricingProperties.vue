<template>
  <div class="space-y-6">
    <!-- Title -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Title
      </label>
      <HighlightTextInput
        v-model="localData.title"
        help="Use **keywords** to highlight important words in primary color"
        placeholder="Enter Pricing title, e.g., **Flexible** Pricing Plans"
        :rows="2"
      />
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Description
      </label>
      <UTextarea v-model="localData.description" placeholder="Enter Pricing description" :rows="3" size="sm" class="w-full" />
      <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Description text for the Pricing section</p> -->
    </div>

    <!-- 价格方案列表 -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Pricing Plans</h4>
        <UButton 
          @click="addPlan"
          variant="ghost"
          icon="i-heroicons-plus"
          size="xs"
        >
          Add Plan
        </UButton>
      </div>
      
      <div class="space-y-6">
        <div 
          v-for="(plan, index) in localData.plans || []"
          :key="index"
          class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm font-medium">Plan {{ index + 1 }}</span>
            <UButton 
              @click="removePlan(index)"
              variant="ghost"
              color="error"
              icon="i-heroicons-trash"
              size="xs"
            />
          </div>
          
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Plan Name
                </label>
                <UInput 
                  v-model="plan.title"
                  placeholder="Basic Plan"
                  size="sm"
                  class="w-full"
                />
              </div>
              
              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Price
                </label>
                <UInput 
                  v-model="plan.price"
                  placeholder="$99/month"
                  size="sm"
                  class="w-full"
                />
              </div>
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Plan Description
              </label>
              <UTextarea 
                v-model="plan.description"
                placeholder="Perfect for individuals"
                :rows="2"
                size="sm"
                class="w-full"
              />
            </div>
            
            <!-- 功能特性 -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-sm font-medium">Features</label>
                <UButton 
                  @click="addFeature(index)"
                  variant="ghost"
                  icon="i-heroicons-plus"
                  size="xs"
                >
                  Add Feature
                </UButton>
              </div>
              
              <div class="space-y-2">
                <div 
                  v-for="(feature, fIndex) in plan.features || []"
                  :key="fIndex"
                  class="flex items-center gap-2"
                >
                  <UInput 
                    v-model="plan.features[fIndex]"
                    placeholder="Feature name"
                    class="flex-1"
                  />
                  <UButton 
                    @click="removeFeature(index, fIndex)"
                    variant="ghost"
                    color="error"
                    icon="i-heroicons-trash"
                    size="xs"
                  />
                </div>
              </div>
            </div>
            
            <!-- 按钮设置 -->
            <div class="border-t pt-4">
              <h5 class="text-sm font-medium mb-3">Purchase Button</h5>
              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Button Text
                  </label>
                  <UInput 
                    v-model="plan.button.label"
                    placeholder="立即购买"
                    size="sm"
                    class="w-full"
                  />
                </div>

                <div class="space-y-1">
                  <label class="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center">
                    <span>Link URL</span>
                    <UiLinkUrlHelp />
                  </label>
                  <UInput 
                    v-model="plan.button.to"
                    placeholder="https://example.com/buy"
                    size="sm"
                    class="w-full"
                  />
                </div>
  
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Variant
                  </label>
                  <USelect 
                    v-model="plan.button.variant"
                    :items="buttonVariants"
                    size="sm"
                    class="w-full"
                  />
                </div>
                
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Color
                  </label>
                  <USelect 
                    v-model="plan.button.color"
                    :items="buttonColors"
                    size="sm"
                    class="w-full"
                  />
                </div>
                               
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Icon Position
                  </label>
                  <USelect 
                    :model-value="plan.button.trailing === 'right' ? 'right' : 'left'"
                    :items="iconPositions"
                    size="sm"
                    class="w-full"
                    @update:model-value="(val: string) => { (plan as any).button.trailing = val }"
                  />
                  <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Position of the icon relative to text</p> -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TextHighlightProcessor } from '~/utils/textHighlight'
import HighlightTextInput from '~/components/ui/HighlightTextInput.vue'

interface Props {
  data: any
}

interface Emits {
  (e: 'update', section: string, data: any): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// Local reactive data - let HighlightTextInput handle syntax conversion
const localData = ref({
  title: props.data?.pricing?.title || '',
  description: props.data?.pricing?.description || '',
  plans: (props.data?.pricing?.plans || []).map((plan: any) => ({
    title: plan?.title || '',
    description: plan?.description || '',
    price: plan?.price || '',
    features: plan?.features || [],
    button: {
      label: plan?.button?.label || '',
      variant: plan?.button?.variant || 'solid',
      color: plan?.button?.color || 'primary',
      to: plan?.button?.to || '',
      trailing: plan?.button?.trailing !== undefined ? (plan?.button?.trailing ? 'right' : 'left') : 'right'
    }
  }))
})

// Button options
const buttonVariants = [
  { label: 'Link', value: 'link' },
  { label: 'Solid', value: 'solid' },
  { label: 'Outline', value: 'outline' },
  { label: 'Soft', value: 'soft' },
  { label: 'Subtle', value: 'subtle' },
  { label: 'Ghost', value: 'ghost' }
]

const buttonColors = [
  { label: 'Primary', value: 'primary' },
  { label: 'Neutral', value: 'neutral' }
]

const iconPositions = [
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' }
]

// Use precise anti-loop mechanism
let isUpdatingFromProps = false

// Methods with debounce to prevent excessive updates
let updateTimeout: NodeJS.Timeout | null = null

const updateData = () => {
  // 清除之前的定时器
  if (updateTimeout) {
    clearTimeout(updateTimeout)
  }
  
  // 防抖：延迟300ms执行更新
  updateTimeout = setTimeout(() => {
    // Convert user syntax to technical syntax, convert trailing string to boolean
    const pricingData = {
      title: TextHighlightProcessor.processForSaving(localData.value.title),
      description: localData.value.description, // No conversion for description
      plans: localData.value.plans?.map(plan => ({
        ...plan,
        button: {
          ...plan.button,
          trailing: plan.button.trailing === 'right'
        }
      }))
    }

    console.log('💰 Pricing update event with syntax conversion:', pricingData)
    emit('update', 'pricing', pricingData)
  }, 300)
}

const addPlan = () => {
  if (!localData.value.plans) {
    localData.value.plans = []
  }
  localData.value.plans.push({
    title: '新方案',
    description: '方案描述',
    price: '¥0/月',
    features: ['基础功能'],
    button: {
      label: '立即购买',
      variant: 'solid',
      color: 'primary',
      to: '#',
      trailing: 'right'
    }
  })
  updateData()
}

const removePlan = (index: number) => {
  localData.value.plans?.splice(index, 1)
  updateData()
}

const addFeature = (planIndex: number) => {
  if (!localData.value.plans[planIndex].features) {
    localData.value.plans[planIndex].features = []
  }
  localData.value.plans[planIndex].features.push('新功能')
  updateData()
}

const removeFeature = (planIndex: number, featureIndex: number) => {
  localData.value.plans[planIndex].features?.splice(featureIndex, 1)
  updateData()
}

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data?.pricing, (newPricing) => {
  if (newPricing) {
    isUpdatingFromProps = true
    localData.value = {
      title: newPricing?.title || '',
      description: newPricing?.description || '',
      plans: (newPricing?.plans || []).map((plan: any) => ({
        title: plan?.title || '',
        description: plan?.description || '',
        price: plan?.price || '',
        features: plan?.features || [],
        button: {
          label: plan?.button?.label || '',
          variant: plan?.button?.variant || 'solid',
          color: plan?.button?.color || 'primary',
          to: plan?.button?.to || '',
          trailing: plan?.button?.trailing !== undefined ? (plan?.button?.trailing ? 'right' : 'left') : 'right'
        }
      }))
    }
    console.log('🔄 Pricing Props data sync from R2 with syntax conversion:', newPricing)
    // Use nextTick to ensure flag reset in next event loop
    nextTick(() => {
      isUpdatingFromProps = false
    })
  }
}, { deep: true, immediate: true })

// Watch localData changes and emit updates - triggered when user modifies data
watch(localData, (newData) => {
  if (isUpdatingFromProps) {
    return
  }
  console.log('💰 User modified Pricing local data:', newData)
  updateData()
}, { deep: true })
</script>