<script setup lang="ts">
import { useAimsModule } from '../../../../../layer/useAimsModule'
// 保留旧书签和模块上下文，统一进入产品结构工作区。
const route = useRoute()
const { moduleUrl } = useAimsModule()
const query = { ...route.query }
const module = query.module ?? query.componentId ?? query.moduleId
if (module) query.module = module
delete query.componentId
delete query.moduleId
await navigateTo({ path: moduleUrl(`/products/${encodeURIComponent(String(route.params.productCode || ''))}/structure`), query }, { replace: true })
</script>

<template>
  <p class="p-4 text-sm text-muted" role="status">
    正在打开产品结构…
  </p>
</template>
