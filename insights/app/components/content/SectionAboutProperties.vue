<template>
  <div class="space-y-6 relative">
    <!-- Title -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Title
      </label>
      <HighlightTextInput
        v-model="localData.title"
        help="Use **keywords** to highlight important words in primary color"
        placeholder="Enter section title, use **text** to highlight"
        :rows="2"
      />
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Description
      </label>
      <UTextarea v-model="localData.description" placeholder="Enter section description" :rows="3" size="sm" class="w-full" />
    </div>

    <!-- 图片设置 -->
    <div class="border-t pt-6">
      <h4 class="font-medium text-gray-900 dark:text-white mb-4">Image Settings</h4>

      <div class="space-y-4">
        <div class="space-y-1">
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Desktop Image (large screens)
          </label>
          <UiImagePicker
            v-model="localData.images.desktop"
            :business-name="businessName"
            :dropdown-full-width="true"
          />
        </div>

        <div class="space-y-1">
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Mobile Image (small screens)
          </label>
          <UiImagePicker
            v-model="localData.images.mobile"
            :business-name="businessName"
            :dropdown-full-width="true"
          />
        </div>
      </div>
    </div>

    <!-- 特性列表 -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Features List</h4>
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
            <HighlightTextInput
              v-model="feature.title"
              label="Title"
              placeholder="Feature title, use **text** to highlight"
              :rows="1"
            />

            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
            <UTextarea v-model="feature.description" placeholder="Enter feature description" :rows="3" size="sm" class="w-full" />
            <!-- <HighlightTextInput
              v-model="feature.description"
              label="Description"
              placeholder="Feature description, use **text** to highlight"
              :rows="2"
            /> -->
            
            <!-- <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                CSS Class
              </label>
              <UInput 
                v-model="feature.class"
                placeholder="e.g., mb-4"
                size="sm"
                class="w-full"
              />
              <p class="text-xs text-gray-500 dark:text-gray-400">Optional, for custom styling</p>
            </div> -->
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiImagePicker from '~/components/ui/ImagePicker.vue'
import { TextHighlightProcessor } from '~/utils/textHighlight'
import HighlightTextInput from '~/components/ui/HighlightTextInput.vue'
interface Props {
  data: any
  businessName?: string
}

interface Emits {
  (e: 'update', section: string, data: any): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// Local reactive data - let HighlightTextInput handle syntax conversion
const localData = ref({
  title: props.data?.section?.title || '',
  description: props.data?.section?.description || '',
  images: {
    desktop: props.data?.section?.images?.desktop || '',
    mobile: props.data?.section?.images?.mobile || ''
  },
  features: (props.data?.section?.features || []).map((feature: any) => ({
    ...feature,
    title: feature.title || '',
    description: feature.description || ''
  }))
})

// 使用更精确的防循环机制
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
    // Convert user syntax to technical syntax before saving
    const technicalData = {
      ...localData.value,
      title: TextHighlightProcessor.processForSaving(localData.value.title),
      description: localData.value.description, // No conversion for description
      features: localData.value.features.map((feature: any) => ({
        ...feature,
        title: TextHighlightProcessor.processForSaving(feature.title || ''),
        description: TextHighlightProcessor.processForSaving(feature.description || '')
      }))
    }
    console.log('🏢 About Section update event:', technicalData)
    emit('update', 'section', technicalData)
  }, 300)
}

const addFeature = () => {
  if (!localData.value.features) {
    localData.value.features = []
  }
  localData.value.features.push({
    title: 'New Feature',
    description: 'Feature description',
    class: ''
  })
  updateData()
}

const removeFeature = (index: number) => {
  localData.value.features?.splice(index, 1)
  updateData()
}

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data?.section, (newSection: any) => {
  if (newSection) {
    isUpdatingFromProps = true
    localData.value = {
      title: newSection?.title || '',
      description: newSection?.description || '',
      images: {
        desktop: newSection?.images?.desktop || '',
        mobile: newSection?.images?.mobile || ''
      },
      features: (newSection?.features || []).map((feature: any) => ({
        ...feature,
        title: feature.title || '',
        description: feature.description || ''
      }))
    }
    console.log('🔄 About Section Props data sync:', newSection)
    // 使用 nextTick 确保在下一个事件循环中重置标志
    nextTick(() => {
      isUpdatingFromProps = false
    })
  }
}, { deep: true, immediate: true })

// Watch localData changes and emit updates - 用户修改时触发
watch(localData, (newData: any) => {
  if (isUpdatingFromProps) {
    return
  }
  console.log('🏢 User modified About Section data:', newData)
  updateData()
}, { deep: true })
</script>