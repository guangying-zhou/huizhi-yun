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
        placeholder="Enter Features title, use **text** to highlight"
        :rows="2"
      />
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Description
      </label>
      <UTextarea v-model="localData.description" placeholder="Enter Features description" :rows="3" size="sm" class="w-full" />
      <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Description text for the Features section</p> -->
    </div>

    <!-- 功能特性列表 -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Features</h4>
        <UButton 
          @click="addFeature"
          variant="ghost"
          icon="i-heroicons-plus"
          size="xs"
        >
          Add Feature
        </UButton>
      </div>
      
      <div class="space-y-4">
        <div 
          v-for="(feature, index) in localData.features || []"
          :key="index"
          class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">Feature {{ index + 1 }}</span>
            <UButton 
              @click="removeFeature(index)"
              variant="ghost"
              color="error"
              icon="i-heroicons-trash"
              size="xs"
            />
          </div>
          
          <div class="space-y-3">
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Title
              </label>
              <UInput 
                v-model="feature.title"
                placeholder="Feature title"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <UTextarea 
                v-model="feature.description"
                placeholder="Feature description"
                :rows="2"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Icon
              </label>
              <UiIconPicker 
                v-model="feature.icon"
                placeholder="Select an icon"
              />
              <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Choose an icon for this feature</p> -->
            </div>
            
            <!-- <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                UI Configuration
              </label>
              <UTextarea 
                v-model="feature.uiJson"
                placeholder='：{"background": "blue"}'
                :rows="2"
                size="sm"
                class="w-full"
                @blur="parseUI(index)"
              />
              <p class="text-xs text-gray-500 dark:text-gray-400">Optional, JSON format UI configuration</p>
            </div> -->
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
  title: props.data?.features?.title || '',
  description: props.data?.features?.description || '',
  features: (props.data?.features?.features || []).map((feature: any) => ({
    ...feature,
    uiJson: feature.ui ? JSON.stringify(feature.ui, null, 2) : ''
  }))
})

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
    // 处理UI配置，将JSON字符串转换为对象
    const featuresWithParsedUI = localData.value.features.map((feature: any) => {
      const featureData: any = {
        title: feature.title,
        description: feature.description,
        icon: feature.icon
      }
      
      if (feature.uiJson) {
        try {
          featureData.ui = JSON.parse(feature.uiJson)
        } catch (e) {
          // JSON解析失败，忽略UI配置
          console.warn('Invalid UI JSON:', feature.uiJson)
        }
      }
      
      return featureData
    })
    
    const updateData = {
      title: TextHighlightProcessor.processForSaving(localData.value.title),
      description: localData.value.description, // No conversion for description
      features: featuresWithParsedUI
    }

    console.log('⭐ Features update event with syntax conversion:', updateData)
    emit('update', 'features', updateData)
  }, 300)
}

const addFeature = () => {
  if (!localData.value.features) {
    localData.value.features = []
  }
  localData.value.features.push({
    title: 'New Feature',
    description: 'Feature description',
    icon: 'i-lucide-star',
    uiJson: ''
  })
  updateData()
}

const removeFeature = (index: number) => {
  localData.value.features?.splice(index, 1)
  updateData()
}

const parseUI = (index: number) => {
  // 当用户失焦时验证JSON格式
  const feature = localData.value.features[index]
  if (feature.uiJson) {
    try {
      JSON.parse(feature.uiJson)
    } catch (e) {
      useToast().add({
        title: 'JSON Format Error',
        description: 'Please check the JSON format of UI configuration',
        color: 'error'
      })
    }
  }
}

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data?.features, (newFeatures) => {
  if (newFeatures) {
    isUpdatingFromProps = true
    localData.value = {
      title: newFeatures?.title || '',
      description: newFeatures?.description || '',
      features: (newFeatures?.features || []).map((feature: any) => ({
        ...feature,
        uiJson: feature.ui ? JSON.stringify(feature.ui, null, 2) : ''
      }))
    }
    console.log('🔄 Features Props data sync from R2 with syntax conversion:', newFeatures)
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
  console.log('⭐ User modified Features data:', newData)
  updateData()
}, { deep: true })
</script>