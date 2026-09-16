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
        placeholder="Enter Testimonials title, use **text** to highlight"
      />
    </div>

    <!-- Description -->
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Section Description
      </label>
      <UTextarea 
        v-model="localData.description"
        placeholder="Enter Testimonials description"
        :rows="3"
        size="sm"
        class="w-full"
      />
      <!-- <p class="text-xs text-gray-500 dark:text-gray-400">Description text for the Testimonials section</p> -->
    </div>

    <!-- 客户评价列表 -->
    <div class="border-t pt-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-medium text-gray-900 dark:text-white">Customer Testimonials</h4>
        <UButton 
          @click="addTestimonial"
          variant="ghost"
          icon="i-heroicons-plus"
          size="xs"
        >
          Add Testimonial
        </UButton>
      </div>
      
      <div class="space-y-4">
        <div 
          v-for="(testimonial, index) in localData.items || []"
          :key="index"
          class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <div class="flex items-center justify-between mb-4">
            <span class="text-sm font-medium">Testimonial {{ index + 1 }}</span>
            <UButton 
              @click="removeTestimonial(index)"
              variant="ghost"
              color="error"
              icon="i-heroicons-trash"
              size="xs"
            />
          </div>
          
          <div class="space-y-4">
            <div class="space-y-1">
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Testimonial Content
              </label>
              <UTextarea 
                v-model="testimonial.quote"
                placeholder="This product is amazing and has greatly improved my productivity..."
                :rows="3"
                size="sm"
                class="w-full"
              />
            </div>
            
            <div class="border-t pt-4">
              <h5 class="text-sm font-medium mb-3">Customer Information</h5>
              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Name
                  </label>
                  <UInput 
                    v-model="testimonial.user.name"
                    placeholder="John Doe"
                    size="sm"
                    class="w-full"
                  />
                </div>
                
                <div class="space-y-1">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Position/Business
                  </label>
                  <UInput 
                    v-model="testimonial.user.description"
                    placeholder="Product Manager, ABC Business"
                    size="sm"
                    class="w-full"
                  />
                </div>
              </div>
              
              <div class="space-y-1 mt-3">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Avatar URL
                </label>
                <UInput 
                  v-model="testimonial.user.avatar"
                  placeholder="https://example.com/avatar.jpg"
                  size="sm"
                  class="w-full"
                />
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
  title: props.data?.testimonials?.title || '',
  description: props.data?.testimonials?.description || '',
  items: (props.data?.testimonials?.items || []).map((item: any) => ({
    quote: item?.quote || '',
    user: {
      name: item?.user?.name || '',
      description: item?.user?.description || '',
      avatar: item?.user?.avatar || ''
    }
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
    // Convert user syntax to technical syntax
    const testimonialsData = {
      ...localData.value,
      title: TextHighlightProcessor.processForSaving(localData.value.title)
      // Keep description and items as-is since only title supports highlighting
    }

    console.log('💬 Testimonials update event with syntax conversion:', testimonialsData)
    emit('update', 'testimonials', testimonialsData)
  }, 300)
}

const addTestimonial = () => {
  if (!localData.value.items) {
    localData.value.items = []
  }
  localData.value.items.push({
    quote: 'This product is excellent, highly recommended!',
    user: {
      name: 'New Customer',
      description: 'Position, Business',
      avatar: ''
    }
  })
  updateData()
}

const removeTestimonial = (index: number) => {
  localData.value.items?.splice(index, 1)
  updateData()
}

// Watch props changes - pass raw data to HighlightTextInput for conversion
watch(() => props.data?.testimonials, (newTestimonials) => {
  if (newTestimonials) {
    isUpdatingFromProps = true
    localData.value = {
      title: newTestimonials?.title || '',
      description: newTestimonials?.description || '',
      items: (newTestimonials?.items || []).map((item: any) => ({
        quote: item?.quote || '',
        user: {
          name: item?.user?.name || '',
          description: item?.user?.description || '',
          avatar: item?.user?.avatar || ''
        }
      }))
    }
    console.log('🔄 Testimonials Props data sync from R2 with syntax conversion:', newTestimonials)
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
  console.log('💬 User modified Testimonials local data:', newData)
  updateData()
}, { deep: true })
</script>