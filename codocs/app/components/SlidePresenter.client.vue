<script setup lang="ts">
/**
 * 全屏演示模式
 * 将 Slidev 构建的 SPA 以全屏 iframe 展示
 * ESC 退出
 */

const props = defineProps<{
  url: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const close = () => {
  emit('update:open', false)
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

watch(() => props.open, (val) => {
  if (val) {
    window.addEventListener('keydown', onKeydown, true)
  } else {
    window.removeEventListener('keydown', onKeydown, true)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && url"
      class="fixed inset-0 z-[100] bg-black"
    >
      <!-- 关闭按钮 -->
      <button
        class="absolute top-4 right-4 z-[110] text-white/60 hover:text-white transition-colors"
        title="退出演示 (ESC)"
        @click="close"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>

      <iframe
        :src="url"
        class="w-full h-full border-0"
        allow="fullscreen; screen-wake-lock"
      />
    </div>
  </Teleport>
</template>
