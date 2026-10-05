<script setup lang="ts">
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import { useCodocsModule } from '../../layer/useCodocsModule'
import { activeMyDocumentSpaceTab, myDocumentSpaceTabs } from '../utils/myDocumentSpaceTabs'

defineProps<{ description?: string }>()
const { moduleUrl, hosted } = useCodocsModule()
const route = useRoute()
const active = computed(() => activeMyDocumentSpaceTab(route.path))
</script>

<template>
  <div class="min-w-0 space-y-3">
    <ContentPageHeader
      :hosted="hosted"
      title="我的文档"
      :description="description"
      breadcrumb="文档 / 我的空间"
    >
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </ContentPageHeader>
    <nav aria-label="我的文档页签" class="flex min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto border-b border-default pb-1">
      <NuxtLink
        v-for="tab in myDocumentSpaceTabs"
        :key="tab.path"
        :to="moduleUrl(tab.path)"
        :aria-current="active === tab.path ? 'page' : undefined"
        class="shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
        :class="active === tab.path ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated hover:text-default'"
      >
        {{ tab.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
