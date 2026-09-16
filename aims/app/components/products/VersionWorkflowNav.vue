<script setup lang="ts">
const props = defineProps<{ productCode: string, versionId: string }>()
const route = useRoute()
const base = computed(() => `/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}`)
const query = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const { data: mode, error: modeError, refresh, status } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}`, {
  key: `version-workflow-mode:${props.productCode}:${props.versionId}`,
  server: false,
  transform: (response: { code: number, data: { id: number, product_code: string, planning_mode: 'simple' | 'cycle' } }) => {
    if (response.code !== 0 || response.data?.product_code !== props.productCode || String(response.data.id) !== props.versionId || !['simple', 'cycle'].includes(response.data.planning_mode)) throw new Error('版本规划模式读取失败')
    return response.data.planning_mode
  }
})
const simpleSteps = [
  { label: '目标与投入', path: '/plan', hash: '#version-goal' },
  { label: '需求范围', path: '/plan', hash: '#version-scope' },
  { label: '确认计划', path: '/plan', hash: '#version-confirmation' },
  { label: '研发交付', path: '/features', hash: '' },
  { label: '验收发布', path: '/acceptance', hash: '' }
]
const steps = computed(() => mode.value === 'cycle'
  ? [
      { label: '高级规划事项', path: '/planning', hash: '', product: true },
      { label: '周期与评分选入', path: '/cycles', hash: '', product: true },
      { label: '版本范围', path: '/features', hash: '#delivery-scope', product: false },
      { label: '研发交付', path: '/features', hash: '#version-delivery', product: false },
      { label: '验收发布', path: '/acceptance', hash: '', product: false }
    ]
  : simpleSteps.map(step => ({ ...step, product: false })))
function stepPath(step: typeof steps.value[number]) {
  return `${step.product ? `/products/${encodeURIComponent(props.productCode)}` : base.value}${step.path}`
}
function current(step: typeof steps.value[number]) {
  if (step.path === '/plan') return route.path === `${base.value}/plan` && (route.hash || '#version-goal') === step.hash
  if (step.path === '/acceptance') return ['/acceptance', '/acceptances', '/releases'].some(path => route.path.startsWith(`${base.value}${path}`))
  return route.path === stepPath(step) && (!step.hash || (route.hash || '#version-delivery') === step.hash)
}
</script>

<template>
  <nav aria-label="版本工作流程" class="mx-auto min-w-0 max-w-7xl space-y-3 border-b border-default px-4 py-3 sm:px-6">
    <div class="flex flex-wrap gap-2">
      <UButton
        :to="{ path: `/products/${encodeURIComponent(productCode)}/versions`, query }"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
      >
        版本计划
      </UButton>
      <UButton
        :to="{ path: base, query }"
        color="neutral"
        variant="ghost"
        size="sm"
      >
        版本信息
      </UButton>
    </div>
    <p v-if="modeError" class="text-sm text-muted">
      版本流程暂时无法加载，请刷新页面重试。
    </p>
    <UButton
      v-if="modeError"
      size="sm"
      color="neutral"
      variant="ghost"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      重新读取版本流程
    </UButton>
    <ol v-if="mode && status === 'success'" class="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5">
      <li v-for="(step, index) in steps" :key="step.label" class="min-w-0">
        <UButton
          :to="{ path: stepPath(step), hash: step.hash, query: step.product ? {} : query }"
          :color="current(step) ? 'primary' : 'neutral'"
          :variant="current(step) ? 'soft' : 'ghost'"
          :aria-current="current(step) ? 'step' : undefined"
          class="w-full justify-start whitespace-normal text-left"
          size="sm"
        >
          {{ index + 1 }}. {{ step.label }}
        </UButton>
      </li>
    </ol>
  </nav>
</template>
