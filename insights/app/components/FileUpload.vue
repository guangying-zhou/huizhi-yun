<template>
  <div class="file-upload">
    <!-- 拖拽上传区域 -->
    <div
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      :class="[
        'upload-area',
        { 'is-dragover': isDragOver, 'is-uploading': isUploading }
      ]"
    >
      <div class="upload-content">
        <div v-if="!isUploading" class="text-center">
          <UIcon name="i-heroicons-cloud-arrow-up" class="h-16 w-16 mx-auto text-gray-400" />
          <h3 class="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            Drag files here to upload
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            or
            <button 
              @click="openFileDialog"
              class="text-blue-600 dark:text-blue-400 hover:underline"
            >
              click to select files
            </button>
          </p>
          <p class="mt-1 text-xs text-gray-400">
            Supports {{ allowedTypes.join(', ') }} formats, max {{ formatSize(maxSize) }} per file
          </p>
        </div>

        <!-- 上传进度 -->
        <div v-else class="text-center">
          <UIcon name="i-heroicons-arrow-path" class="h-16 w-16 mx-auto text-blue-500 animate-spin" />
          <h3 class="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            Uploading...
          </h3>
          <div class="mt-4 w-full max-w-xs mx-auto">
            <div class="bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                :style="{ width: `${uploadProgress}%` }"
              />
            </div>
            <p class="mt-2 text-sm text-gray-500">{{ uploadProgress }}%</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 文件列表 -->
    <div v-if="selectedFiles.length > 0 && !isUploading" class="mt-6">
      <h4 class="text-sm font-medium text-gray-900 dark:text-white mb-3">
        Selected Files ({{ selectedFiles.length }})
      </h4>
      
      <div class="space-y-3">
        <div 
          v-for="(file, index) in selectedFiles"
          :key="index"
          class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
        >
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
              <UIcon :name="getFileIcon(file)" class="h-5 w-5 text-gray-500" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ file.name }}
              </p>
              <p class="text-xs text-gray-500">
                {{ formatSize(file.size) }} • {{ getFileExtension(file.name) }}
              </p>
            </div>
          </div>
          
          <UButton
            @click="removeFile(index)"
            icon="i-heroicons-x-mark"
            variant="ghost"
            color="neutral"
            size="sm"
          />
        </div>
      </div>

      <!-- 上传按钮 -->
      <div class="mt-6 flex justify-end gap-3">
        <UButton @click="clearFiles" variant="ghost" color="neutral">
          Clear All
        </UButton>
        <UButton @click="uploadFiles" :disabled="selectedFiles.length === 0">
          Upload Files
        </UButton>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      :accept="acceptedMimeTypes"
      :multiple="multiple"
      @change="handleFileSelect"
      class="hidden"
    />
  </div>
</template>

<script setup lang="ts">
import type { MediaFile } from '~/types/cms'

// Props
interface Props {
  multiple?: boolean
  maxSize?: number // bytes
  allowedTypes?: string[]
  folder?: string
}

const props = withDefaults(defineProps<Props>(), {
  multiple: true,
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: () => ['JPG', 'PNG', 'GIF', 'WEBP', 'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX'],
  folder: 'uploads'
})

// Emits
const emit = defineEmits<{
  uploaded: [file: MediaFile]
  error: [error: string]
}>()

// 状态
const isDragOver = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)
const selectedFiles = ref<File[]>([])

// Refs
const fileInput = ref<HTMLInputElement | null>(null)

// 计算属性
const acceptedMimeTypes = computed(() => {
  const mimeMap: Record<string, string> = {
    'JPG': 'image/jpeg',
    'JPEG': 'image/jpeg',
    'PNG': 'image/png',
    'GIF': 'image/gif',
    'WEBP': 'image/webp',
    'PDF': 'application/pdf',
    'DOC': 'application/msword',
    'DOCX': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'XLS': 'application/vnd.ms-excel',
    'XLSX': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  
  return props.allowedTypes.map(type => mimeMap[type.toUpperCase()]).filter(Boolean).join(',')
})

// 方法
const openFileDialog = () => {
  fileInput.value?.click()
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  addFiles(files)
}

const handleDragEnter = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = true
}

const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  // 只在离开整个拖拽区域时取消状态
  if (!(e.currentTarget as Element)?.contains(e.relatedTarget as Node)) {
    isDragOver.value = false
  }
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = false
  
  const files = Array.from(e.dataTransfer?.files || [])
  addFiles(files)
}

const addFiles = (files: File[]) => {
  const validFiles = files.filter(file => validateFile(file))
  
  if (props.multiple) {
    selectedFiles.value.push(...validFiles)
  } else {
    selectedFiles.value = validFiles.slice(0, 1)
  }
}

const validateFile = (file: File): boolean => {
  // Check file size
  if (file.size > props.maxSize) {
    emit('error', `File "${file.name}" is too large, maximum allowed ${formatSize(props.maxSize)}`)
    return false
  }

  // Check file type
  const extension = getFileExtension(file.name).toUpperCase()
  if (!props.allowedTypes.includes(extension)) {
    emit('error', `Unsupported file type: ${extension}`)
    return false
  }

  return true
}

const removeFile = (index: number) => {
  selectedFiles.value.splice(index, 1)
}

const clearFiles = () => {
  selectedFiles.value = []
}

const uploadFiles = async () => {
  if (selectedFiles.value.length === 0) return

  try {
    isUploading.value = true
    uploadProgress.value = 0

    for (let i = 0; i < selectedFiles.value.length; i++) {
      const file = selectedFiles.value[i]
      if (file) await uploadSingleFile(file)
      uploadProgress.value = Math.round(((i + 1) / selectedFiles.value.length) * 100)
    }

    // Clear file list
    selectedFiles.value = []
  } catch (error: any) {
    console.error('Upload failed:', error)
    emit('error', error.message || 'Upload failed')
  } finally {
    isUploading.value = false
    uploadProgress.value = 0
  }
}

const uploadSingleFile = async (file: File): Promise<MediaFile> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', props.folder)

  const uploadedFile = await $fetch<MediaFile>('/api/media/upload', {
    method: 'POST',
    body: formData
  })

  emit('uploaded', uploadedFile)
  return uploadedFile
}

const getFileIcon = (file: File) => {
  const extension = getFileExtension(file.name).toLowerCase()
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
    return 'i-heroicons-photo'
  }
  if (['pdf'].includes(extension)) {
    return 'i-heroicons-document-text'
  }
  if (['doc', 'docx'].includes(extension)) {
    return 'i-heroicons-document'
  }
  if (['xls', 'xlsx'].includes(extension)) {
    return 'i-heroicons-table-cells'
  }
  
  return 'i-heroicons-document'
}

const getFileExtension = (filename: string) => {
  return filename.split('.').pop() || ''
}

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>

<style scoped>
.upload-area {
  min-height: 16rem;
  border: 2px dashed rgb(209 213 219);
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  cursor: pointer;
}

.upload-area:hover {
  border-color: rgb(156 163 175);
}

.upload-area.is-dragover {
  border-color: rgb(59 130 246);
  background-color: rgb(239 246 255);
}

.upload-area.is-uploading {
  border-color: rgb(59 130 246);
  background-color: rgb(239 246 255);
  cursor: not-allowed;
}

.upload-content {
  width: 100%;
  max-width: 28rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

/* Dark mode styles */
@media (prefers-color-scheme: dark) {
  .upload-area {
    border-color: rgb(75 85 99);
  }
  
  .upload-area:hover {
    border-color: rgb(107 114 128);
  }
  
  .upload-area.is-dragover,
  .upload-area.is-uploading {
    background-color: rgba(30 58 138 / 0.2);
  }
}
</style>