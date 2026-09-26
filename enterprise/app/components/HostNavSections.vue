<script setup lang="ts">
import HostNavTree from './HostNavTree.vue'
import { selectActiveLeaf } from '../utils/navigation-active.mjs'

interface NavItem { id: string, label: string, icon?: string, to?: string, module?: string, permission?: { resource: string, action: string }, permissionRefs?: { resource: string, action: string }[], mode?: 'all' | 'any', children?: NavItem[] }
interface NavArea { id: string, code: string, label: string, icon: string, children: NavItem[] }

// 业务领域（产品 / 交付与服务 / 经营…）是分节标题，不是可点、可展开的行：
// 它本身没有页面，把它做成按钮会让读者以为点得进去。标题只分节，真正的
// 入口从工作域（第二级）开始，因此图标也下移到工作域那一层。
const props = defineProps<{ primary: NavArea[], auxiliary: NavArea[] }>()
const route = useRoute()
const preferredId = ref('')
const visibleTree = computed(() => [...props.primary, ...props.auxiliary])
const activeId = computed(() => selectActiveLeaf(visibleTree.value, route.path, preferredId.value))
const context = inject('enterprise-navigation-context', null) || {
  visibleTree,
  activeId,
  setPreferred(id: string) { preferredId.value = id }
}
provide('enterprise-navigation-context', context)
</script>

<template>
  <div>
    <template
      v-for="area in primary"
      :key="area.id"
    >
      <p class="px-3 pb-1 pt-4 text-xs font-semibold text-[var(--host-nav-muted)] first:pt-1">
        {{ area.label }}
      </p>
      <HostNavTree :items="area.children" />
    </template>
    <template v-if="auxiliary.length">
      <div class="my-3 border-t border-[var(--host-nav-border)]" />
      <template
        v-for="area in auxiliary"
        :key="area.id"
      >
        <p class="px-3 pb-1 pt-4 text-xs font-semibold text-[var(--host-nav-muted)]">
          {{ area.label }}
        </p>
        <HostNavTree :items="area.children" />
      </template>
    </template>
  </div>
</template>
