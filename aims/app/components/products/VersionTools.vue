<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import { getProductPerspectives, productNavTo } from '../../../layer/productNavigation'

const { moduleUrl } = useAimsModule()

const props = defineProps<{ productCode: string, index?: boolean }>()
const route = useRoute()
const base = computed(() => moduleUrl(`/products/${encodeURIComponent(props.productCode)}`))
const perspective = computed(() => route.query.view === 'gtm' ? 'gtm' as const : 'rd' as const)
function link(path: string) {
  return productNavTo(getProductPerspectives(props.productCode), perspective.value, `${base.value}/${path}`)
}
const comparisons = computed(() => [
  { label: '功能版本矩阵', icon: 'i-lucide-table-2', to: link('feature-version-matrix') },
  { label: '发布范围对比', icon: 'i-lucide-git-compare', to: link('release-comparison') }
])
const advanced = computed(() => [
  { label: '规划周期与评分选入', icon: 'i-lucide-calendar-range', to: `${base.value}/cycles` },
  { label: '整理高级规划事项', icon: 'i-lucide-list-checks', to: `${base.value}/planning` },
  { label: '周期路线图保存视图', icon: 'i-lucide-bookmark', to: `${base.value}/views` }
])
</script>

<template>
  <nav aria-label="版本计划辅助工具" class="flex min-w-0 flex-wrap items-center gap-2">
    <UButton
      v-if="!index"
      :to="link('versions')"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
    >
      {{ perspective === 'gtm' ? '返回版本发布' : '返回版本计划' }}
    </UButton>
    <UDropdownMenu :items="comparisons">
      <UButton color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down">
        版本比较
      </UButton>
    </UDropdownMenu>
    <template v-if="perspective === 'rd'">
      <UButton :to="`${base}/execution-coordination`" color="neutral" variant="ghost">
        跨版本项目汇总
      </UButton>
      <UDropdownMenu :items="advanced">
        <UButton color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down">
          高级规划
        </UButton>
      </UDropdownMenu>
    </template>
  </nav>
</template>
