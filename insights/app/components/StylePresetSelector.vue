<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-lg font-semibold text-highlighted">选择页面样式</h3>
      <p class="text-sm text-muted mt-1">从多种预设样式中选择适合您网站的设计风格</p>
    </div>
    
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="preset in stylePresets"
        :key="preset.id"
        :class="[
          'relative p-4 border-2 rounded-lg cursor-pointer transition-all',
          selectedPreset === preset.id 
            ? 'border-primary bg-primary/5' 
            : 'border-default hover:border-primary/50'
        ]"
        @click="selectPreset(preset.id)"
      >
        <!-- 预设标题和描述 -->
        <div class="mb-3">
          <h4 class="font-semibold text-highlighted">{{ preset.name }}</h4>
          <p class="text-sm text-muted mt-1">{{ preset.description }}</p>
        </div>
        
        <!-- 样式预览 -->
        <div class="space-y-2">
          <div class="text-xs text-muted font-medium">样式预览：</div>
          <div :class="preset.example.feature" class="text-xs p-2 bg-default/50 rounded">
            示例特性展示
          </div>
        </div>
        
        <!-- 配置详情 -->
        <div class="mt-3 text-xs text-muted">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-primary"></span>
            主色调: {{ preset.preview.colors.primary }}
          </div>
          <div class="flex items-center gap-2 mt-1">
            <span class="w-2 h-2 rounded-full bg-default"></span>
            特性样式: {{ preset.preview.section.featureStyle }}
          </div>
        </div>
        
        <!-- 选中状态 -->
        <div
          v-if="selectedPreset === preset.id"
          class="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center"
        >
          <UIcon name="i-lucide-check" class="w-3 h-3 text-white" />
        </div>
      </div>
    </div>
    
    <!-- 应用按钮 -->
    <div class="flex justify-end">
      <UButton
        :disabled="!selectedPreset || isApplying"
        :loading="isApplying"
        @click="applyStylePreset"
        class="w-full sm:w-auto"
      >
        {{ isApplying ? '正在应用...' : '应用选中样式' }}
      </UButton>
    </div>
    
    <!-- 成功提示 -->
    <UAlert
      v-if="successMessage"
      icon="i-lucide-check-circle"
      color="success"
      variant="soft"
      :title="successMessage"
      :close-button="{ icon: 'i-lucide-x', color: 'gray', variant: 'link' }"
      @close="successMessage = ''"
    />
    
    <!-- 错误提示 -->
    <UAlert
      v-if="errorMessage"
      icon="i-lucide-alert-circle"
      color="error"
      variant="soft"
      :title="errorMessage"
      :close-button="{ icon: 'i-lucide-x', color: 'gray', variant: 'link' }"
      @close="errorMessage = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface StylePreset {
  id: string
  name: string
  description: string
  preview: {
    section: {
      featureStyle: string
      borderStyle: string
      spacing: string
    }
    colors: {
      primary: string
      neutral: string
      accent?: string
    }
  }
  example: {
    feature: string
  }
}

const props = defineProps<{
  businessName: string
}>()

const stylePresets = ref<StylePreset[]>([])
const selectedPreset = ref<string>('')
const isApplying = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

onMounted(async () => {
  await loadStylePresets()
})

interface StylePresetsApi {
  success: boolean
  message?: string
  data?: {
    presets: StylePreset[]
    default: string
  }
}

async function loadStylePresets() {
  try {
    const response = await $fetch<StylePresetsApi>('/api/style-presets')
    if (response?.success && response.data) {
      stylePresets.value = response.data.presets
      selectedPreset.value = response.data.default
    }
  } catch (error) {
    console.error('加载样式预设失败:', error)
    errorMessage.value = '加载样式预设失败，请重试'
  }
}

function selectPreset(presetId: string) {
  selectedPreset.value = presetId
  errorMessage.value = ''
  successMessage.value = ''
}

async function applyStylePreset() {
  if (!selectedPreset.value) return
  
  isApplying.value = true
  errorMessage.value = ''
  successMessage.value = ''
  
  try {
    const response = await $fetch<{ success: boolean; message?: string }>(
      '/api/apply-style-preset',
      {
      method: 'POST',
      body: {
        businessName: props.businessName,
        presetId: selectedPreset.value
      }
      }
    )
    
    if (response?.success) {
      const selectedPresetData = stylePresets.value.find(p => p.id === selectedPreset.value)
      successMessage.value = `${selectedPresetData?.name} 样式已成功应用到您的页面！`
      
      // 延迟刷新页面以显示新样式
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } else {
      errorMessage.value = response?.message || '应用样式失败'
    }
  } catch (error) {
    console.error('应用样式预设失败:', error)
    errorMessage.value = '应用样式失败，请重试'
  } finally {
    isApplying.value = false
  }
}
</script>
