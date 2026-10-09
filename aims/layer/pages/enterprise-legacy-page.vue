<script setup lang="ts">
import ContentPageHeader from '@hzy/foundation/app/components/ContentPageHeader.vue'
import { legacyAimsPages } from '../legacyPages.mjs'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '旧功能入口', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const registration = computed(() => legacyAimsPages.find(page => `aims-${page.name}` === route.name))
const projectId = computed(() => String(route.params.id || ''))
const backTo = computed(() => /^[1-9]\d*$/.test(projectId.value) ? `/aims/projects/${projectId.value}` : '/aims/projects')
onMounted(() => {
  const target = registration.value?.target
  if (registration.value?.kind === 'redirect' && target) void navigateTo(target, { replace: true })
})
</script>

<template>
  <div class="min-w-0 space-y-4">
    <ContentPageHeader :hosted="true" title="旧功能入口" description="此入口已迁移或下线，请使用当前文档与项目功能。" />
    <UAlert
      icon="i-lucide-info"
      color="neutral"
      title="该功能已迁移或下线"
      description="此旧入口已归档，不再连接旧 Aims 服务。请从项目或首页使用现有功能；旧入口不会执行写入。"
    />
    <div class="flex flex-wrap gap-3">
      <UButton :to="backTo" color="neutral" variant="outline">
        返回项目
      </UButton>
      <UButton to="/enterprise" color="neutral" variant="outline">
        返回首页
      </UButton>
    </div>
  </div>
</template>
