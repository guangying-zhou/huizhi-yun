<template>
  <div class="space-y-4">
    <!-- Section Header -->
    <div class="border-b pb-3 mb-4">
      <h4 class="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <UIcon name="i-heroicons-link" class="w-5 h-5 text-blue-500" />
        Social Media Links
      </h4>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
        Configure social media links displayed in the footer
      </p>
    </div>

    <!-- Social Media Configuration -->
    <div class="space-y-4">
      <!-- X/Twitter -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-x" class="w-4 h-4" />
          X/Twitter
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">https://x.com/</span>
            <UInput
              v-model="localData.platforms.twitter.username"
              placeholder="yourusername"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>

      <!-- Facebook -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-facebook" class="w-4 h-4 text-blue-600" />
          Facebook
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">https://facebook.com/</span>
            <UInput
              v-model="localData.platforms.facebook.username"
              placeholder="yourpage"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>

      <!-- Instagram -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-instagram" class="w-4 h-4 text-pink-500" />
          Instagram
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">https://instagram.com/</span>
            <UInput
              v-model="localData.platforms.instagram.username"
              placeholder="yourusername"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>

      <!-- LinkedIn -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-linkedin" class="w-4 h-4 text-blue-700" />
          LinkedIn
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">https://linkedin.com/in/</span>
            <UInput
              v-model="localData.platforms.linkedin.username"
              placeholder="yourusername"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>

      <!-- YouTube -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-youtube" class="w-4 h-4 text-red-600" />
          YouTube
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">https://youtube.com/@</span>
            <UInput
              v-model="localData.platforms.youtube.username"
              placeholder="yourchannel"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>

      <!-- GitHub -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-github" class="w-4 h-4" />
          GitHub
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">https://github.com/</span>
            <UInput
              v-model="localData.platforms.github.username"
              placeholder="yourusername"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Preview -->
  <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <h5 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Preview</h5>
      <div class="flex items-center gap-2">
        <template v-for="(platform, key) in localData.platforms" :key="key">
          <div
            v-if="platform.username"
            class="p-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
            :title="`${key}: ${getPlatformUrl(key, platform.username)}`"
          >
            <UIcon
              :name="getPlatformIcon(key)"
              class="w-4 h-4"
              :class="getPlatformColor(key)"
            />
          </div>
        </template>
        <div v-if="!hasAnyPlatforms" class="text-sm text-gray-500 dark:text-gray-400">
          No social media links set
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SocialMediaPlatform {
  username: string
}

interface SocialMediaData {
  platforms: {
    twitter: SocialMediaPlatform
    facebook: SocialMediaPlatform
    instagram: SocialMediaPlatform
    linkedin: SocialMediaPlatform
    youtube: SocialMediaPlatform
    github: SocialMediaPlatform
  }
}

interface Props {
  data: Record<string, any>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  update: [sectionKey: string, data: Record<string, any>]
}>()

// 默认数据结构
const defaultData: SocialMediaData = {
  platforms: {
    twitter: { username: '' },
    facebook: { username: '' },
    instagram: { username: '' },
    linkedin: { username: '' },
    youtube: { username: '' },
    github: { username: '' }
  }
}

// 本地数据
const localData = ref<SocialMediaData>({
  ...defaultData,
  ...props.data.socialMedia
})

// 计算属性
const hasAnyPlatforms = computed(() => {
  return Object.values(localData.value.platforms).some(platform => !!platform.username)
})

// 获取平台的完整URL
const getPlatformUrl = (platform: string, username: string): string => {
  const urlTemplates: Record<string, string> = {
    twitter: 'https://x.com/',
    facebook: 'https://facebook.com/',
    instagram: 'https://instagram.com/',
    linkedin: 'https://linkedin.com/in/',
    youtube: 'https://youtube.com/@',
    github: 'https://github.com/'
  }
  return urlTemplates[platform] + username
}

// 获取平台URL模板用于显示
const getPlatformTemplate = (platform: string): string => {
  const templates: Record<string, string> = {
    twitter: 'https://x.com/yourusername',
    facebook: 'https://facebook.com/yourpage',
    instagram: 'https://instagram.com/yourusername',
    linkedin: 'https://linkedin.com/in/yourusername',
    youtube: 'https://youtube.com/@yourchannel',
    github: 'https://github.com/yourusername'
  }
  return templates[platform] || ''
}

// 更新数据
const updateData = () => {
  emit('update', 'socialMedia', localData.value)
}

// 获取平台图标
const getPlatformIcon = (platform: string): string => {
  const iconMap: Record<string, string> = {
    twitter: 'i-simple-icons-x',
    facebook: 'i-simple-icons-facebook',
    instagram: 'i-simple-icons-instagram',
    linkedin: 'i-simple-icons-linkedin',
    youtube: 'i-simple-icons-youtube',
    github: 'i-simple-icons-github'
  }
  return iconMap[platform] || 'i-heroicons-link'
}

// 获取平台颜色
const getPlatformColor = (platform: string): string => {
  const colorMap: Record<string, string> = {
    twitter: 'text-blue-500',
    facebook: 'text-blue-600',
    instagram: 'text-pink-500',
    linkedin: 'text-blue-700',
    youtube: 'text-red-600',
    github: 'text-gray-900 dark:text-gray-100'
  }
  return colorMap[platform] || 'text-gray-500'
}

// 监听props变化
watch(() => props.data.socialMedia, (newData) => {
  if (newData) {
    localData.value = {
      ...defaultData,
      ...newData
    }
  }
}, { deep: true, immediate: true })
</script>