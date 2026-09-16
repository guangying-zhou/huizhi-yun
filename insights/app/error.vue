<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps({
  error: {
    type: Object as PropType<NuxtError>,
    required: true
  }
})

useSeoMeta({
  title: '页面未找到',
  description: '抱歉，该页面不存在。'
})

const handleError = () => clearError({ redirect: '/' })

const is404 = computed(() => props.error.statusCode === 404)
const title = computed(() => is404.value ? '页面未找到' : '发生错误')
const message = computed(() => is404.value
  ? '您访问的页面不存在或已被移动。'
  : props.error.message || '出了点问题。')
</script>

<template>
  <div class="flex flex-col h-screen items-center justify-center font-sans bg-default">
    <UCard class="w-full max-w-lg mx-4 text-center">
      <template #header>
        <div class="flex flex-col items-center gap-4 py-4">
          <h1 class="text-7xl font-black text-muted">
            {{ error.statusCode }}
          </h1>
          <h2 class="text-2xl font-bold text-default">
            {{ title }}
          </h2>
        </div>
      </template>

      <p class="text-muted text-lg">
        {{ message }}
      </p>

      <template #footer>
        <div class="flex justify-center py-2">
          <UButton
            color="primary"
            size="lg"
            icon="i-lucide-home"
            label="返回首页"
            @click="handleError"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
