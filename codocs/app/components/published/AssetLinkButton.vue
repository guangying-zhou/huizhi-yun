<script setup lang="ts">
import { parsePublishedAssetPath, publishedAssetShortPagePath } from '~~/shared/utils/publishedAssetLink'

const props = defineProps<{ path: string }>()
const { resolveCurrentAppUrl, resolveCurrentAppPath } = useAppUrls()
const toast = useToast()
const showLink = ref(false)
const link = ref('')
const loading = ref(false)
watch(() => props.path, () => {
  link.value = ''
  showLink.value = false
})

async function copyLink() {
  if (loading.value || !parsePublishedAssetPath(props.path)) return
  loading.value = true
  const sourcePath = props.path
  try {
    if (!link.value) {
      const response = await $fetch<{ data: { token: string } }>(resolveCurrentAppPath('/api/published-asset-links'), {
        method: 'POST', body: { path: sourcePath }
      })
      if (sourcePath !== props.path) return
      const pagePath = publishedAssetShortPagePath(response.data.token)
      if (!pagePath) throw new Error('invalid short link')
      link.value = resolveCurrentAppUrl(pagePath)
    }
    try {
      await navigator.clipboard.writeText(link.value)
      if (sourcePath === props.path) toast.add({ title: '短链接已复制，可粘贴到通知中', color: 'success' })
    } catch {
      if (sourcePath === props.path) showLink.value = true
    }
  } catch {
    toast.add({ title: '短链接生成失败，请稍后重试', color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UButton
    size="sm"
    icon="i-lucide-link"
    variant="outline"
    :disabled="!parsePublishedAssetPath(path)"
    :loading="loading"
    @click="copyLink"
  >
    复制链接
  </UButton>
  <UModal v-model:open="showLink" title="文档访问链接" description="请手动复制链接，接收人登录后可按现有权限阅读。">
    <template #body>
      <UInput
        :model-value="link"
        readonly
        aria-label="文档访问链接"
        class="w-full"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </template>
  </UModal>
</template>
