<script setup lang="ts">
import { usePortfolioStore } from '~/stores/portfolio'
import { useProjectStore } from '~/stores/project'

interface SidebarTreeNode {
  type: 'portfolio' | 'project'
  id: number
  name: string
  shortName?: string
  portfolioId?: number
  children?: SidebarTreeNode[]
}

defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  'enter-project': [id: number]
}>()

const route = useRoute()
const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()

// 侧边栏展开状态
const sidebarPortfolioExpanded = ref<number | null>(null)

const visibleProjects = computed(() => {
  return projectStore.projects.filter((project) => {
    return project.canAccess !== false && project.lifecycleStatus !== 'archived'
  })
})

function toggleSidebarPortfolio(id: number) {
  sidebarPortfolioExpanded.value = sidebarPortfolioExpanded.value === id ? null : id
}

// 默认展开有项目的项目集
watch([() => portfolioStore.portfolios, () => visibleProjects.value], () => {
  const expandedPortfolioStillVisible = Boolean(
    sidebarPortfolioExpanded.value
    && visibleProjects.value.some(p => p.portfolioId === sidebarPortfolioExpanded.value)
  )
  if (expandedPortfolioStillVisible) return

  const firstPortfolio = portfolioStore.portfolios.find((pf) => {
    return visibleProjects.value.some(p => p.portfolioId === pf.id)
  })
  sidebarPortfolioExpanded.value = firstPortfolio ? firstPortfolio.id : null
}, { immediate: true })

// 项目集-项目树
const projectTree = computed<SidebarTreeNode[]>(() => {
  const allProjects = visibleProjects.value
  const portfolioMap = new Map<number, typeof allProjects>()
  const ungrouped: typeof allProjects = []

  for (const p of allProjects) {
    if (p.portfolioId) {
      const list = portfolioMap.get(p.portfolioId) || []
      list.push(p)
      portfolioMap.set(p.portfolioId, list)
    } else {
      ungrouped.push(p)
    }
  }

  const tree: SidebarTreeNode[] = []

  for (const pf of portfolioStore.portfolios) {
    const projects = portfolioMap.get(pf.id)
    if (projects && projects.length > 0) {
      tree.push({
        type: 'portfolio',
        id: pf.id,
        name: pf.name,
        children: projects.map(p => ({ type: 'project', id: p.id, name: p.shortName || p.name, portfolioId: pf.id }))
      })
    }
  }

  for (const p of ungrouped) {
    tree.push({ type: 'project', id: p.id, name: p.shortName || p.name })
  }

  return tree
})

watch(() => route.path, () => {
  const projectNode = projectTree.value.find((node) => {
    return node.type === 'project' && route.path.startsWith(`/projects/${node.id}`)
  })
  const portfolioId = projectNode?.portfolioId
  if (portfolioId) {
    sidebarPortfolioExpanded.value = portfolioId
  }
}, { immediate: true })
</script>

<template>
  <div v-show="!collapsed" class="px-4 space-y-0.5">
    <template v-for="node in projectTree" :key="`${node.type}-${node.id}`">
      <!-- 项目集节点 -->
      <div v-if="node.type === 'portfolio'">
        <div
          class="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-sm font-semibold text-secondary-400 hover:text-primary transition-colors select-none"
          @click="toggleSidebarPortfolio(node.id)"
        >
          <UIcon
            :name="sidebarPortfolioExpanded === node.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="w-4 h-4 shrink-0"
          />
          <UIcon name="i-lucide-folder-kanban" class="w-4 h-4 shrink-0" />
          <span class="truncate">{{ node.name }}</span>
        </div>
        <div v-if="sidebarPortfolioExpanded === node.id && node.children" class="pl-3 space-y-0.5">
          <div
            v-for="child in node.children"
            :key="child.id"
            class="flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-sm hover:bg-elevated hover:text-primary-400 transition-colors"
            :class="route.path.startsWith(`/projects/${child.id}`) ? 'bg-elevated text-primary font-medium' : 'text-muted'"
            @click="emit('enter-project', child.id)"
          >
            <UIcon name="i-lucide-calendar-check" class="w-4 h-4 shrink-0" />
            <span class="truncate">{{ child.name }}</span>
          </div>
        </div>
      </div>

      <!-- 独立项目节点 -->
      <div
        v-else
        class="flex items-center gap-2 px-4 py-1.5 rounded-md cursor-pointer text-sm hover:bg-elevated hover:text-primary-400 transition-colors"
        :class="route.path.startsWith(`/projects/${node.id}`) ? 'bg-elevated text-primary font-medium' : 'text-muted'"
        @click="emit('enter-project', node.id)"
      >
        <UIcon name="i-lucide-calendar-check" class="w-4 h-4 shrink-0" />
        <span class="truncate">{{ node.name }}</span>
      </div>
    </template>
    <div v-if="projectTree.length === 0" class="px-4 py-4 text-xs text-muted text-center">
      暂无项目
    </div>
  </div>
</template>
