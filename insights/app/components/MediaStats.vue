<template>
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <div class="w-2 h-2 rounded-full bg-blue-400"></div>
      <span class="text-xs text-gray-600 dark:text-gray-300">
        {{ loading ? 'Loading...' : `${stats.totalFiles || 0} files` }}
      </span>
    </div>
    <div class="flex items-center gap-2">
      <div class="w-2 h-2 rounded-full bg-green-400"></div>
      <span class="text-xs text-gray-600 dark:text-gray-300">
        {{ loading ? 'Loading...' : formatFileSize(stats.totalSize || 0) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  businessName: string
}

const props = defineProps<Props>()

interface MediaStatsResponse {
  success: boolean
  stats?: {
    totalFiles?: number
    totalSize?: number
    imageCount?: number
    recentUploads?: number
  }
}

// State
const stats = ref({
  totalFiles: 0,
  totalSize: 0,
  imageCount: 0,
  recentUploads: 0
})
const loading = ref(true)

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 MB'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Load stats
const loadStats = async () => {
  try {
    loading.value = true
  const response = await $fetch<MediaStatsResponse>(`/api/media/stats/${props.businessName}`, {
      credentials: 'include'
    })
    
  if (response?.success && response?.stats) {
      stats.value = {
    totalFiles: response.stats.totalFiles ?? 0,
    totalSize: response.stats.totalSize ?? 0,
    imageCount: response.stats.imageCount ?? 0,
    recentUploads: response.stats.recentUploads ?? 0
      }
    }
  } catch (error) {
    console.error(`Failed to load media stats for ${props.businessName}:`, error)
    // Keep default empty stats on error
  } finally {
    loading.value = false
  }
}

// Load stats on mount
onMounted(() => {
  loadStats()
})
</script>
