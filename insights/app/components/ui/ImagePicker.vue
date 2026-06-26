<template>
  <div class="relative">
    <div
      class="flex items-center justify-between px-2.5 py-1.5 text-xs leading-none border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 cursor-pointer hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors h-8"
      @click="handleTriggerClick" ref="triggerRef">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <UIcon v-if="modelValue" name="i-heroicons-photo" class="w-4 h-4 text-gray-500 flex-shrink-0" />
        <span v-else class="text-gray-500 text-xs">Select Image</span>
        <span v-if="modelValue" class="text-xs text-gray-700 dark:text-gray-300 truncate">{{ selectedImageName }}</span>
      </div>
      <UIcon name="i-heroicons-chevron-down" class="w-4 h-4 text-gray-400 flex-shrink-0" />
    </div>


    <!-- Dropdown Panel -->
    <div v-if="showPicker" ref="dropdownRef" :class="[
      'absolute z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-80 overflow-hidden',
      dropdownPosition === 'top' ? 'bottom-full mb-2 origin-bottom-left' : 'top-full mt-2 origin-top-left',
      dropdownFullWidth ? 'w-full left-0 right-0' : ''
    ]" :style="{ width: dropdownFullWidth ? '100%' : '320px' }">
      <!-- Search Input -->
      <div class="p-3 border-b border-gray-200 dark:border-gray-700">
        <UInput v-model="searchQuery" placeholder="Search images..." size="sm" class="w-full"
          icon="i-heroicons-magnifying-glass" />
      </div>


      <!-- Loading State -->
      <div v-if="loading" class="flex items-center justify-center py-8">
        <UIcon name="i-heroicons-arrow-path" class="animate-spin h-5 w-5 mr-2" />
        <span class="text-sm text-gray-500">Loading images...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="p-4 text-center">
        <UIcon name="i-heroicons-exclamation-triangle" class="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        <UButton @click="loadImages" variant="ghost" size="xs" class="mt-2">
          Retry
        </UButton>
      </div>

      <!-- Images Grid -->
      <div v-else-if="filteredImages.length > 0" class="max-h-56 overflow-y-auto p-2">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="image in filteredImages" :key="image" @click="selectImage(image)"
            class="relative group cursor-pointer border-2 rounded-lg overflow-hidden hover:border-primary transition-colors"
            :class="{ 'border-primary bg-primary/5': modelValue === image }">
            <!-- Image Preview -->
            <div class="aspect-square bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <img :src="getImageUrl(image)" :alt="image" class="w-full h-full object-cover" @error="handleImageError"
                loading="lazy" />
            </div>

            <!-- Image Name -->
            <div class="p-2 bg-white dark:bg-gray-800">
              <p class="text-xs text-gray-700 dark:text-gray-300 truncate" :title="image">
                {{ image }}
              </p>
            </div>



            <!-- Selected Indicator -->
            <div v-if="modelValue === image"
              class="absolute top-1 right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
              <UIcon name="i-heroicons-check" class="w-3 h-3 text-white" />
            </div>
          </div>
        </div>
      </div>


      <!-- No Images -->
      <div v-else-if="filteredImages.length === 0 && images.length > 0" class="p-4 text-center">
        <UIcon name="i-heroicons-photo" class="h-8 w-8 text-gray-400 mx-auto mb-2" />
        <p class="text-sm text-gray-500">
          {{ searchQuery ? 'No images found' : 'No images available' }}
        </p>
        <p v-if="!searchQuery" class="text-xs text-gray-400 mt-1">
          Upload images to your R2 storage first
        </p>
      </div>

      <!-- Footer -->
      <div
        class="flex justify-between items-center p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
        <UButton variant="ghost" size="xs" @click="clearImage">
          Clear
        </UButton>
        <div class="flex gap-2">
          <UButton variant="outline" size="xs" @click="triggerFileInput" :loading="uploading" :disabled="uploading">
            <UIcon name="i-heroicons-cloud-arrow-up" class="w-4 h-4 mr-1" />
            Upload
          </UButton>
          <UButton variant="ghost" size="xs" @click="showPicker = false">
            Close
          </UButton>
        </div>

        <!-- Hidden file input -->
        <input ref="fileInputRef" type="file" multiple accept="image/*" class="hidden" @change="handleFileSelect" />
      </div>

    </div>
  </div>


</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
interface Props {
  modelValue?: string
  businessName?: string
  dropdownFullWidth?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: string | undefined): void
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  businessName: '',
  dropdownFullWidth: true
})

const emit = defineEmits<Emits>()

// Reactive data
const showPicker = ref(false)
const searchQuery = ref('')
const images = ref<string[]>([])
const loading = ref(false)
const error = ref('')
const uploading = ref(false)
// 删除相关功能已移除
const triggerRef = ref<HTMLElement>()
const dropdownRef = ref<HTMLElement>()
const dropdownPosition = ref<'bottom' | 'top'>('bottom')
const fileInputRef = ref<HTMLInputElement>()

// Computed properties
const selectedImageName = computed(() => {
  if (!props.modelValue) return ''
  return props.modelValue.split('/').pop() || props.modelValue
})

const filteredImages = computed(() => {
  if (!searchQuery.value) return images.value
  return images.value.filter(image =>
    image.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})


const updateDropdownPosition = () => {
  if (!process.client) return
  const triggerEl = triggerRef.value
  const dropdownEl = dropdownRef.value
  if (!triggerEl || !dropdownEl) return

  const triggerRect = triggerEl.getBoundingClientRect()
  const dropdownHeight = dropdownEl.offsetHeight || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const spaceBelow = viewportHeight - triggerRect.bottom
  const spaceAbove = triggerRect.top

  dropdownPosition.value = spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? 'top' : 'bottom'
}

const schedulePositionUpdate = () => {
  if (!process.client) return
  if (!showPicker.value) return
  nextTick(() => {
    requestAnimationFrame(() => updateDropdownPosition())
  })
}


// Methods
const loadImages = async () => {
  console.log('🖼️ ImagePicker: loadImages called with businessName:', props.businessName)

  if (!props.businessName) {
    console.warn('⚠️ ImagePicker: Business name is required')
    error.value = 'Business name is required'
    return
  }

  loading.value = true
  error.value = ''

  try {
    console.log(`🔍 ImagePicker: Fetching images for ${props.businessName}`)
    const response = await $fetch<{
      success: boolean
      images: string[]
      count: number
    }>(`/api/r2-images?business=${encodeURIComponent(props.businessName)}`, {
      credentials: 'include'
    })

    console.log('📥 ImagePicker: API response:', response)

    if (response.success) {
      images.value = response.images
      console.log(`📸 ImagePicker: Loaded ${response.count} images for ${props.businessName}`)
    } else {
      throw new Error('Failed to load images')
    }
  } catch (err: any) {
    console.error('❌ ImagePicker: Failed to load images:', err)
    error.value = err.message || 'Failed to load images'
  } finally {
    loading.value = false
    schedulePositionUpdate()
  }
}

const getImageUrl = (imagePath: string) => {
  if (!props.businessName) return ''
  // 直接使用R2公共URL（正确的格式，不包含bucket）
  const baseUrl = 'https://storage.repoinsight.com'
  return `${baseUrl}/images/${props.businessName}/${imagePath}`
}

// Toggle dropdown visibility
const toggleShow = (value: boolean) => {
  showPicker.value = value
}

const handleTriggerClick = () => {
  const newValue = !showPicker.value
  showPicker.value = newValue

  if (newValue && props.businessName && images.value.length === 0) {
    loadImages()
  }
  if (newValue) {
    schedulePositionUpdate()
  }
}

const selectImage = (image: string) => {
  console.log('🖼️ ImagePicker: Image selected:', image)

  // 构建完整的R2公共URL
  const fullUrl = getImageUrl(image)
  console.log('🖼️ ImagePicker: Full URL:', fullUrl)

  emit('update:modelValue', fullUrl)
  toggleShow(false)
  searchQuery.value = ''
}

const clearImage = () => {
  emit('update:modelValue', undefined)
  toggleShow(false)
}

const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
  // 可以在这里添加一个占位符
}

// Lifecycle
onMounted(() => {
  if (props.businessName) {
    loadImages()
  }
})

// Watch for business name changes
watch(() => props.businessName, (newBusiness) => {
  if (newBusiness) {
    loadImages()
  }
})

if (process.client) {
  watch(showPicker, (isOpen: boolean) => {
    if (isOpen) {
      schedulePositionUpdate()
    }
  })

  watch(filteredImages, () => {
    schedulePositionUpdate()
  })

  watch(loading, () => {
    schedulePositionUpdate()
  })
}

// 删除功能已移除：不再需要监听关闭删除弹窗

// File upload functions
const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const handleFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files

  if (!files || files.length === 0) return

  if (!props.businessName) {
    error.value = 'Business name is required'
    return
  }

  uploading.value = true
  error.value = ''

  try {
    // 记录上传的文件名，用于自动选择
    const uploadedFileNames: string[] = []

    for (const file of Array.from(files)) {
      const uploadedFileName = await uploadImage(file)
      if (uploadedFileName) {
        uploadedFileNames.push(uploadedFileName)
      }
    }

    // Clear file input
    if (fileInputRef.value) {
      fileInputRef.value.value = ''
    }

    // Reload images list
    await loadImages()

    // 如果上传了文件，自动选择第一个上传的文件
    if (uploadedFileNames.length > 0) {
      const firstUploadedFile = uploadedFileNames[0]
      console.log('🎯 Auto-selecting uploaded file:', firstUploadedFile)

      // 构建完整的URL并选择
      if (props.businessName) {
        const fullUrl = getImageUrl(firstUploadedFile)
        selectImage(firstUploadedFile)
      }
    }

    console.log('✅ Images uploaded successfully')

  } catch (err) {
    console.error('❌ Upload failed:', err)
    error.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    uploading.value = false
  }
}

const uploadImage = async (file: File): Promise<string | null> => {
  if (!props.businessName) {
    throw new Error('Business name is required')
  }

  const formData = new FormData()
  formData.append('image', file)
  formData.append('business', props.businessName)
  formData.append('type', `${props.businessName}/upload`)

  const response = await fetch('/api/images/upload', {
    method: 'POST',
    credentials: 'include', // 确保包含认证cookie
    body: formData
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Upload failed')
  }

  const publicUrl = await response.text()

  // 从返回的URL中提取文件名
  // URL格式: https://storage.repoinsight.com/images/business/filename.ext
  const urlParts = publicUrl.split('/')
  const fileName = urlParts[urlParts.length - 1]

  console.log('📁 Uploaded file:', fileName, 'URL:', publicUrl)
  return fileName
}

// Delete functions
// 删除功能已移除

// Click outside to close - simplified approach
const clickOutsideHandler = (event: Event) => {
  if (showPicker.value && triggerRef.value && dropdownRef.value) {
    const target = event.target as Node
    if (!triggerRef.value.contains(target) && !dropdownRef.value.contains(target)) {
      showPicker.value = false
    }
  }
}

onMounted(() => {
  if (typeof window === 'undefined') return
  setTimeout(() => {
    window.addEventListener('click', clickOutsideHandler, true)
  }, 0)
  window.addEventListener('resize', schedulePositionUpdate)
  window.addEventListener('scroll', schedulePositionUpdate, true)
})

onUnmounted(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('click', clickOutsideHandler, true)
  window.removeEventListener('resize', schedulePositionUpdate)
  window.removeEventListener('scroll', schedulePositionUpdate, true)
})
</script>
