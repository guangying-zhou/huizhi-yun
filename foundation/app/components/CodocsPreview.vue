<script setup lang="ts">
/**
 * Codocs 文档预览（只读 iframe 封装）
 *
 * 轻量级只读预览组件，适用于文档列表卡片、详情页嵌入等场景。
 *
 * @example
 * <CodocsPreview uuid="doc-uuid-123" />
 * <CodocsPreview uuid="doc-uuid-123" :show-title="false" />
 * <CodocsPreview uuid="doc-uuid-123" :show-toolbar="true" />
 */
const props = withDefaults(defineProps<{
  /** 文档 UUID */
  uuid: string
  /** 是否显示标题栏 */
  showTitle?: boolean
  /** 是否显示工具栏 */
  showToolbar?: boolean
}>(), {
  showTitle: false,
  showToolbar: false
})

const config = useRuntimeConfig()
const baseUrl = computed(() =>
  ((config.public.codocsUrl as string) || 'http://localhost:3001').replace(/\/$/, '')
)

const src = computed(() => {
  const params = new URLSearchParams({
    readonly: '1',
    toolbar: props.showToolbar ? '1' : '0'
  })
  if (!props.showTitle) params.set('title', '0')
  return `${baseUrl.value}/embed/editor/${props.uuid}?${params.toString()}`
})
</script>

<template>
  <iframe
    :src="src"
    class="w-full h-full border-0"
  />
</template>
