<template>
  <div class="space-y-6">
    <!-- Title -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Page Title
      </label>
      <ClientOnly>
        <HighlightTextInput
          v-model="localData.title"
          help="Use **keywords** to highlight important words in primary color"
          placeholder="Enter page title, use **text** to highlight"
          :rows="2"
        />
        <template #fallback>
          <UTextarea
            v-model="localData.title"
            placeholder="Enter page title, use **text** to highlight"
            :rows="2"
            class="font-mono"
          />
        </template>
      </ClientOnly>
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Page Description
      </label>
      <UTextarea v-model="localData.description" placeholder="Enter page description" :rows="3" size="sm" class="w-full" />
    </div>


    <!-- Call-to-Action Buttons -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Action Buttons</h4>
        <UButton @click="addButton" variant="ghost" icon="i-heroicons-plus" size="xs">
          Add Button
        </UButton>
      </div>

      <div class="space-y-4">
        <div v-for="(button, index) in localData.hero?.links || []" :key="index"
          class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">Button {{ index + 1 }}</span>
            <UButton @click="removeButton(index)" variant="ghost" color="error" icon="i-heroicons-trash" size="xs" />
          </div>

          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Text
                </label>
                <UInput v-model="button.label" placeholder="Button text" size="sm" class="w-full" />
              </div>

              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Icon
                </label>
                <UiIconPicker v-model="button.icon" placeholder="Select an icon" :dropdownDoubleWidth="false"
                  :dropdownFullWidth="true" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Color
                </label>
                <USelect v-model="button.color" :items="buttonStyles" size="sm" class="w-full"
                  @update:model-value="updateData" />
              </div>

              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Variant
                </label>
                <USelect v-model="button.variant" :items="buttonVariants" size="sm" class="w-full"
                  @update:model-value="updateData" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Size
                </label>
                <USelect
                  v-model="button.size"
                  :items="buttonSizes"
                  size="sm"
                  class="w-full"
                  @update:model-value="updateData"
                />
              </div> -->

              <div class="space-y-1">
                <label class="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center">
                  <span>Link URL</span>
                  <UiLinkUrlHelp />
                </label>
                <UInput v-model="button.to" placeholder="https://example.com" size="sm" class="w-full" />
              </div>

              <div class="space-y-1">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Icon Position
                </label>
                <USelect :model-value="button.trailing ? 'right' : 'left'" :items="iconPositions" size="sm"
                  class="w-full" @update:model-value="(val: string) => { button.trailing = val === 'right' }" />
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
  title: props.data?.title || '',
  description: props.data?.description || '',
  hero: {
    links: (props.data?.hero?.links || []).map((link: any) => ({
      ...link,
      trailing: link.trailing !== undefined ? !!link.trailing : true
    }))
  }
})

// Button style options
const buttonStyles = [
  { label: 'Primary', value: 'primary' },
  { label: 'Neutral', value: 'neutral' }
]

const buttonVariants = [
  { label: 'Link', value: 'link' },
  { label: 'Solid', value: 'solid' },
  { label: 'Outline', value: 'outline' },
  { label: 'Soft', value: 'soft' },
  { label: 'Subtle', value: 'subtle' },
  { label: 'Ghost', value: 'ghost' }
]

const buttonSizes = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' }
]

// USelect items 支持字符串数组或对象数组
const iconPositions = [
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' }
]

// Methods with debounce to prevent excessive updates
let updateTimeout: NodeJS.Timeout | null = null

const updateData = () => {
  // 清除之前的定时器
  if (updateTimeout) {
    clearTimeout(updateTimeout)
  }

  // 防抖：延迟300ms执行更新
  updateTimeout = setTimeout(() => {
    // Convert user syntax to technical syntax before saving, maintain trailing as boolean
    const pageData = {
      ...localData.value,
      title: TextHighlightProcessor.processForSaving(localData.value.title),
      description: localData.value.description, // No conversion for description
      hero: {
        links: localData.value.hero?.links?.map((link: any) => ({
          ...link,
          trailing: !!link.trailing
        }))
      }
    }

    // Hero Properties updates entire page data, not just hero section
    emit('update', 'page', pageData)
  }, 300)
}

const addButton = () => {
  if (!localData.value.hero) {
    localData.value.hero = { links: [] }
  }
  localData.value.hero.links.push({
    label: 'New Button',
    to: '#',
    color: 'primary',
    variant: 'solid',
    icon: 'i-heroicons-arrow-right',
    size: 'lg',
    trailing: true
  })
  updateData()
}

const removeButton = (index: number) => {
  localData.value.hero?.links?.splice(index, 1)
  updateData()
}

// Use precise anti-loop mechanism
let isUpdatingFromProps = false

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data, (newData: any) => {
  if (newData) {
    isUpdatingFromProps = true
    localData.value = {
      title: newData?.title || '',
      description: newData?.description || '',
      hero: {
        links: (newData?.hero?.links || []).map((link: any) => ({
          ...link,
          trailing: link.trailing !== undefined ? !!link.trailing : true
        }))
      }
    }
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
  updateData()
}, { deep: true })
</script>