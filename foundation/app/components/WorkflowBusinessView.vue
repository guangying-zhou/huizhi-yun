<script setup lang="ts">
/**
 * WorkflowBusinessView — 业务详情容器
 *
 * 根据 business_view.mode 自动选择渲染方式：
 * - local: 同应用，尝试加载本地 embed 页面（iframe 指向自己）
 * - iframe: 跨应用，iframe 加载其他模块的 embed 页面
 * - external-link: 无 embed，显示跳转链接
 */
import type { WorkflowBusinessView } from '../types/workflow'

const props = defineProps<{
  businessView: WorkflowBusinessView
  bizTitle?: string
}>()

const { resolveCurrentAppUrl } = useAppUrls()

/**
 * 解析 embed URL
 * 将 {app_base_url} 替换为实际的模块地址
 */
const resolvedEmbedUrl = computed(() => {
  if (!props.businessView.embed_url) return null

  let url = props.businessView.embed_url

  // 同应用时使用当前 origin
  if (props.businessView.mode === 'local') {
    url = url.replace('{app_base_url}', resolveCurrentAppUrl('/').replace(/\/$/, ''))
  } else {
    // 跨应用时需要从配置获取目标应用的 base URL
    // TODO: 从应用注册表获取，目前先用 embed_url 中已替换的部分
    if (url.includes('{app_base_url}')) {
      // 无法解析，fallback 到 external-link
      return null
    }
  }

  return url
})

const effectiveMode = computed(() => {
  if (props.businessView.mode === 'local' || props.businessView.mode === 'iframe') {
    return resolvedEmbedUrl.value ? props.businessView.mode : 'external-link'
  }
  return props.businessView.mode
})
</script>

<template>
  <div class="h-full w-full">
    <!-- local 或 iframe 模式：统一用 iframe 加载 embed 页面 -->
    <iframe
      v-if="(effectiveMode === 'local' || effectiveMode === 'iframe') && resolvedEmbedUrl"
      :src="resolvedEmbedUrl"
      class="w-full h-full border-0"
      :title="bizTitle || '业务详情'"
    />

    <!-- external-link 模式：显示提示和跳转链接 -->
    <div
      v-else-if="effectiveMode === 'external-link'"
      class="flex h-full items-center justify-center"
    >
      <div class="text-center px-6">
        <UIcon name="i-lucide-external-link" class="size-12 text-dimmed mb-4" />
        <p class="text-sm text-muted mb-4">
          {{ bizTitle || '业务详情' }}
        </p>
        <UButton
          v-if="businessView.biz_url"
          :href="businessView.biz_url"
          target="_blank"
          color="primary"
          variant="outline"
          icon="i-lucide-external-link"
        >
          在新窗口查看
        </UButton>
        <p v-else class="text-xs text-dimmed">
          暂无可用的详情视图
        </p>
      </div>
    </div>
  </div>
</template>
