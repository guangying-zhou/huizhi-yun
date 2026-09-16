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
        placeholder="Enter Steps title, use **text** to highlight"
      />
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Description
      </label>
      <UTextarea 
        v-model="localData.description"
        placeholder="Enter Steps description"
        :rows="3"
        size="sm"
        class="w-full"
      />
      <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Description text for the Steps section</p> -->
    </div>

    <!-- 步骤列表 -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Process Steps</h4>
        <UButton 
          @click="addStep"
          variant="ghost"
          icon="i-heroicons-plus"
          size="xs"
        >
          Add Step
        </UButton>
      </div>
      
      <div class="space-y-4">
        <div 
          v-for="(step, index) in localData.items || []"
          :key="index"
          class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">Step {{ index + 1 }}</span>
            <UButton 
              @click="removeStep(index)"
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
              <HighlightTextInput
                v-model="step.title"
                placeholder="Step title, use **text** to highlight"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <UTextarea 
                v-model="step.description"
                placeholder="Detailed description of this step"
                :rows="2"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Step Image
              </label>
              <UiImagePicker
                v-model="step.imageLight"
                :business-name="businessName"
                :dropdown-full-width="true"
              />
              <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Image URL, recommended 24x24 icon</p> -->
            </div>
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
  title: props.data?.steps?.title || '',
  description: props.data?.steps?.description || '',
  items: (props.data?.steps?.items || []).map((item: any) => ({
    title: item?.title || '',
    description: item?.description || '',
    imageLight: item?.image?.light || ''
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
    // Convert user syntax to technical syntax and format data
    const stepsWithCorrectImageFormat = localData.value.items.map((item: any) => ({
      title: TextHighlightProcessor.processForSaving(item.title || ''),
      description: item.description, // No conversion for description
      image: {
        light: item.imageLight
      }
    }))

    const updateData = {
      title: TextHighlightProcessor.processForSaving(localData.value.title),
      description: localData.value.description, // No conversion for description
      items: stepsWithCorrectImageFormat
    }

    console.log('🚀 Steps update event with syntax conversion:', updateData)
    emit('update', 'steps', updateData)
  }, 300)
}

const addStep = () => {
  if (!localData.value.items) {
    localData.value.items = []
  }
  localData.value.items.push({
    title: 'New Step',
    description: 'Step description',
    imageLight: ''
  })
  updateData()
}

const removeStep = (index: number) => {
  localData.value.items?.splice(index, 1)
  updateData()
}

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data?.steps, (newSteps: any) => {
  if (newSteps) {
    isUpdatingFromProps = true
    localData.value = {
      title: newSteps?.title || '',
      description: newSteps?.description || '',
      items: (newSteps?.items || []).map((item: any) => ({
        title: item?.title || '',
        description: item?.description || '',
        imageLight: item?.image?.light || ''
      }))
    }
    console.log('🔄 Steps Props data sync from R2 with syntax conversion:', newSteps)
    // Use nextTick to ensure flag reset in next event loop
    nextTick(() => {
      isUpdatingFromProps = false
    })
  }
}, { deep: true, immediate: true })

// Watch localData changes and emit updates - triggered when user modifies data
watch(localData, (newData: any) => {
  if (isUpdatingFromProps) {
    return
  }
  console.log('🚀 User modified Steps local data:', newData)
  updateData()
}, { deep: true })
</script>