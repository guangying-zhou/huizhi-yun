<template>
  <div class="review-flow-chart">
    <div ref="chartContainer" class="mermaid-container" />
  </div>
</template>

<script setup lang="ts">
import mermaid from 'mermaid'

interface ReviewFlowNode {
  name: string
}

interface ReviewActionRecord {
  node_index: number
  actor_uid: string
  action: string
  comment?: string | null
  created_at: string
}

const props = defineProps<{
  flowSnapshot: ReviewFlowNode[]
  currentNode: number
  status: string
  actions: ReviewActionRecord[]
}>()

const chartContainer = ref<HTMLElement>()

// 初始化 Mermaid
onMounted(() => {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis'
    }
  })
  renderChart()
})

// 监听数据变化重新渲染
watch(
  () => [props.flowSnapshot, props.currentNode, props.status, props.actions],
  () => {
    renderChart()
  },
  { deep: true }
)

// 渲染流程图
const renderChart = async () => {
  if (!chartContainer.value) return

  const mermaidCode = generateMermaidCode()

  try {
    const { svg } = await mermaid.render('review-flow-chart', mermaidCode)
    chartContainer.value.innerHTML = svg
  } catch (error) {
    console.error('Failed to render mermaid chart:', error)
  }
}

// 生成 Mermaid 代码
const generateMermaidCode = () => {
  const nodes = props.flowSnapshot || []
  let code = 'graph LR\n'

  nodes.forEach((node, index) => {
    const nodeId = `N${index}`
    const nodeName = node.name
    const nodeClass = getNodeClass(index)

    // 节点定义
    code += `  ${nodeId}["${nodeName}"]\n`

    // 节点样式
    code += `  class ${nodeId} ${nodeClass}\n`

    // 连接线
    if (index < nodes.length - 1) {
      code += `  ${nodeId} --> N${index + 1}\n`
    }
  })

  // 样式定义
  code += `
  classDef pending fill:#e5e7eb,stroke:#9ca3af,color:#374151
  classDef current fill:#3b82f6,stroke:#2563eb,color:#fff
  classDef approved fill:#10b981,stroke:#059669,color:#fff
  classDef rejected fill:#ef4444,stroke:#dc2626,color:#fff
  `

  return code
}

// 获取节点样式类
const getNodeClass = (index: number) => {
  if (props.status === 'rejected') {
    // 被驳回：当前节点红色，之前的绿色，之后的灰色
    if (index === props.currentNode) return 'rejected'
    if (index < props.currentNode) return 'approved'
    return 'pending'
  } else if (props.status === 'approved' || props.status === 'archived') {
    // 已通过：全部绿色
    return 'approved'
  } else {
    // 进行中：当前节点蓝色，之前的绿色，之后的灰色
    if (index === props.currentNode) return 'current'
    if (index < props.currentNode) return 'approved'
    return 'pending'
  }
}
</script>

<style scoped>
.review-flow-chart {
  @apply w-full overflow-x-auto;
}

.mermaid-container {
  @apply min-h-[6rem] flex items-center justify-center;
}

.mermaid-container :deep(svg) {
  @apply max-w-full h-auto;
}
</style>
