<template>
  <div class="space-y-6">
    <!-- Title -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Title
      </label>
      <HighlightTextInput
        v-model="localData.title"
        help="Title for the CTA section. Use **keywords** to highlight important words in primary color"
        placeholder="Enter CTA title, use **text** to highlight"
      />
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Description
      </label>
      <UTextarea 
        v-model="localData.description"
        placeholder="Enter CTA description"
        :rows="3"
        size="sm"
        class="w-full"
      />
      <p class="text-xs text-gray-500 dark:text-gray-400">Description for the CTA section</p>
    </div>

    <!-- 行动按钮 -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Action Buttons</h4>
        <UButton 
          @click="addButton"
          variant="ghost"
          icon="i-heroicons-plus"
          size="xs"
        >
          Add Button
        </UButton>
      </div>
      
      <div class="space-y-4">
        <div 
          v-for="(button, index) in localData.links || []"
          :key="index"
          class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">Button {{ index + 1 }}</span>
            <UButton 
              @click="removeButton(index)"
              variant="ghost"
              color="error"
              icon="i-heroicons-trash"
              size="xs"
            />
          </div>
          
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Text
              </label>
              <UInput 
                v-model="button.label"
                placeholder="Button text"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Color
              </label>
              <USelect 
                v-model="button.color"
                :items="buttonStyles"
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
                v-model="button.to"
                placeholder="https://example.com"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Icon
              </label>
              <UiIconPicker 
                v-model="button.icon"
                placeholder="Select an icon"
              />
              <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Choose an icon for the button (optional)</p> -->
            </div>
            
            <!-- <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Size
              </label>
              <USelectMenu 
                v-model="button.size"
                :options="buttonSizes"
                size="sm"
                class="w-full"
              />
            </div> -->
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Variant
              </label>
              <USelect 
                v-model="button.variant"
                :items="buttonVariants"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Icon Position
              </label>
              <USelect 
                :model-value="button.trailing === 'right' ? 'right' : 'left'"
                :items="iconPositions"
                size="sm"
                class="w-full"
                @update:model-value="(val: string) => { (button as any).trailing = val }"
              />
              <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Position of the icon relative to text</p> -->
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
  title: props.data?.cta?.title || '',
  description: props.data?.cta?.description || '',
  links: (props.data?.cta?.links || []).map((link: any) => ({
    ...link,
    trailing: link.trailing !== undefined ? (link.trailing ? 'right' : 'left') : 'right'
  }))
})

// Button style options
const buttonStyles = [
  { label: 'Primary', value: 'primary' },
  { label: 'Neutral', value: 'neutral' }
]

const buttonSizes = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' }
]

const buttonVariants = [
  { label: 'Link', value: 'link' },
  { label: 'Solid', value: 'solid' },
  { label: 'Outline', value: 'outline' },
  { label: 'Soft', value: 'soft' },
  { label: 'Subtle', value: 'subtle' },
  { label: 'Ghost', value: 'ghost' }
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
    // Convert user syntax to technical syntax and format data
    const ctaData = {
      title: TextHighlightProcessor.processForSaving(localData.value.title),
      description: localData.value.description, // No conversion for description
      links: localData.value.links?.map(link => ({
        ...link,
        trailing: link.trailing === 'right'
      }))
    }

    console.log('📢 CTA update event with syntax conversion:', ctaData)
    emit('update', 'cta', ctaData)
  }, 300)
}

const addButton = () => {
  if (!localData.value.links) {
    localData.value.links = []
  }
  localData.value.links.push({
    label: 'New Button',
    to: '#',
    color: 'primary',
    icon: 'i-heroicons-arrow-right',
    size: 'lg',
    variant: 'solid',
    trailing: 'right'
  })
  updateData()
}

const removeButton = (index: number) => {
  localData.value.links?.splice(index, 1)
  updateData()
}

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data?.cta, (newCta) => {
  if (newCta) {
    isUpdatingFromProps = true
    localData.value = {
      title: newCta?.title || '',
      description: newCta?.description || '',
      links: (newCta?.links || []).map((link: any) => ({
        ...link,
        trailing: link.trailing !== undefined ? (link.trailing ? 'right' : 'left') : 'right'
      }))
    }
    console.log('🔄 CTA Props data sync from R2 with syntax conversion:', newCta)
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
  console.log('📢 User modified CTA local data:', newData)
  updateData()
}, { deep: true })
</script>