<script setup lang="ts">
/**
 * 幻灯片预览组件
 * 通过 Slidev dev server 渲染，iframe 嵌入
 */

const props = defineProps<{
  content: string
}>()

const emit = defineEmits<{
  built: [url: string]
}>()

interface ApiResponse {
  success: boolean
  building?: boolean
  message?: string
  data?: {
    url: string
    cached?: boolean
    port?: number
  }
}

const slideUrl = ref('')
const loading = ref(false)
const error = ref('')

const loadSlidev = async () => {
  if (!props.content) return

  loading.value = true
  error.value = ''

  try {
    const res = await $fetch<ApiResponse>('/api/slides/preview', {
      method: 'POST',
      body: { content: props.content },
      timeout: 40_000
    })

    if (res.success && res.data?.url) {
      slideUrl.value = res.data.url
      emit('built', res.data.url)
    } else if (res.building) {
      error.value = '正在构建中，请稍后刷新...'
    } else {
      error.value = res.message || '预览失败'
    }
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }, message?: string }
    error.value = e.data?.message || e.message || '预览服务不可用'
  } finally {
    loading.value = false
  }
}

// 内容变化处理
let lastContent = ''

const onContentChange = async () => {
  if (!props.content) return

  const isSwitch = lastContent && lastContent !== props.content
  lastContent = props.content

  // server 已就绪：更新内容
  if (slideUrl.value) {
    try {
      await $fetch('/api/slides/preview', {
        method: 'POST',
        body: { content: props.content },
        timeout: 5_000
      })
      // 切换文稿时刷新 iframe（HMR 可能来不及处理完全不同的内容）
      if (isSwitch) {
        await new Promise(r => setTimeout(r, 500))
        iframeKey.value++
      }
    } catch {
      // 静默
    }
    return
  }

  loadSlidev()
}

watch(() => props.content, () => {
  onContentChange()
}, { immediate: true })

const iframeKey = ref(0)
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex-1 overflow-hidden bg-gray-100 dark:bg-gray-950">
      <!-- Slidev iframe -->
      <iframe
        v-if="slideUrl"
        :key="iframeKey"
        :src="slideUrl"
        class="w-full h-full border-0"
        allow="fullscreen; screen-wake-lock"
      />

      <!-- 加载中 -->
      <div v-else-if="loading" class="h-full flex items-center justify-center">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 text-primary animate-spin" />
      </div>

      <!-- 错误 -->
      <div v-else-if="error" class="h-full flex items-center justify-center p-4">
        <div class="text-center">
          <p class="text-sm text-muted mb-3">
            {{ error }}
          </p>
          <UButton
            icon="i-lucide-refresh-cw"
            color="primary"
            size="sm"
            @click="loadSlidev"
          >
            重试
          </UButton>
        </div>
      </div>

      <!-- 无内容 -->
      <div v-else class="h-full flex items-center justify-center">
        <p class="text-sm text-muted">
          暂无内容
        </p>
      </div>
    </div>
  </div>
</template>
