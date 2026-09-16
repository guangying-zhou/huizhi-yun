<script setup lang="ts">
/**
 * Codocs 文档编辑器（iframe 封装）
 *
 * 通过 iframe 嵌入 Codocs 模块的编辑器页面，各模块可直接使用。
 *
 * @example
 * <CodocsEditor uuid="doc-uuid-123" />
 * <CodocsEditor uuid="doc-uuid-123" readonly />
 * <CodocsEditor uuid="doc-uuid-123" :show-title="false" />
 */
const props = withDefaults(defineProps<{
  /** 文档 UUID */
  uuid: string
  /** 只读模式 */
  readonly?: boolean
  /** 是否显示标题栏 */
  showTitle?: boolean
}>(), {
  readonly: false,
  showTitle: true
})

const config = useRuntimeConfig()
const baseUrl = computed(() =>
  ((config.public.codocsUrl as string) || 'http://localhost:3001').replace(/\/$/, '')
)

const src = computed(() => {
  const params = new URLSearchParams()
  if (props.readonly) params.set('readonly', '1')
  if (!props.showTitle) params.set('title', '0')
  const qs = params.toString()
  return `${baseUrl.value}/embed/editor/${props.uuid}${qs ? '?' + qs : ''}`
})

const iframeRef = ref<HTMLIFrameElement | null>(null)

/** 触发文档保存 */
const save = () => {
  iframeRef.value?.contentWindow?.postMessage({ type: 'codocs:save' }, '*')
}

/** 获取当前文档内容 */
const getContent = (): Promise<string> => {
  return new Promise((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'codocs:content') {
        window.removeEventListener('message', handler)
        resolve(e.data.content)
      }
    }
    window.addEventListener('message', handler)
    iframeRef.value?.contentWindow?.postMessage({ type: 'codocs:getContent' }, '*')
    setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve('')
    }, 3000)
  })
}

// 拦截 Ctrl+S / Cmd+S 触发保存
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    save()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

defineExpose({ save, getContent })
</script>

<template>
  <iframe
    ref="iframeRef"
    :src="src"
    class="w-full h-full border-0"
    allow="clipboard-read; clipboard-write"
  />
</template>
