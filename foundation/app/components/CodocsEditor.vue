<script setup lang="ts">
import { isTrustedCodocsEditorMessage, resolveCodocsEditorTarget } from '../utils/codocsEditorBoundary'
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
  /** 独立 Codocs 的可信 http(s) 来源；统一宿主应显式配置。 */
  baseUrl?: string
}>(), {
  readonly: false,
  showTitle: true
})

const config = useRuntimeConfig()
const baseUrl = computed(() => String(props.baseUrl || config.public.codocsUrl || '').replace(/\/$/, ''))
const target = computed(() => resolveCodocsEditorTarget(baseUrl.value, props.uuid, props))
const editorOrigin = computed(() => target.value?.origin || '')
const src = computed(() => target.value?.src || '')

const iframeRef = ref<HTMLIFrameElement | null>(null)

/** 触发文档保存 */
const save = () => {
  if (editorOrigin.value) iframeRef.value?.contentWindow?.postMessage({ type: 'codocs:save' }, editorOrigin.value)
}

/** 获取当前文档内容 */
const getContent = (): Promise<string> => {
  return new Promise((resolve) => {
    const handler = (e: MessageEvent) => {
      if (isTrustedCodocsEditorMessage(e, editorOrigin.value, iframeRef.value?.contentWindow)) {
        window.removeEventListener('message', handler)
        resolve(e.data.content)
      }
    }
    if (!editorOrigin.value) return resolve('')
    window.addEventListener('message', handler)
    iframeRef.value?.contentWindow?.postMessage({ type: 'codocs:getContent' }, editorOrigin.value)
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
    v-if="src"
    ref="iframeRef"
    :src="src"
    class="w-full h-full border-0"
    allow="clipboard-read; clipboard-write"
    referrerpolicy="strict-origin-when-cross-origin"
  />
  <UAlert v-else color="warning" title="协作文档编辑器尚未配置" description="请配置当前环境的 Codocs 地址后重试。" />
</template>
