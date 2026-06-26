<script setup lang="ts">
import * as d3 from 'd3'
import { sankey as d3Sankey, sankeyLinkHorizontal, type SankeyGraph, type SankeyNode, type SankeyLink } from 'd3-sankey'

interface CustomNode extends SankeyNode<{}, {}> {
  id: string
  name: string
  category: string
  // D3 adds these
  sourceLinks?: CustomLink[]
  targetLinks?: CustomLink[]
  value?: number
}

interface CustomLink extends SankeyLink<CustomNode, {}> {
  source: CustomNode | string | any
  target: CustomNode | string | any
  value: number
  width?: number
}

const props = defineProps<{
  data: {
    nodes: { id: string, name: string, category: string }[]
    links: { source: string, target: string, value: number }[]
  }
}>()

const container = ref<HTMLElement | null>(null)
const tooltip = ref<HTMLElement | null>(null)
const tooltipContent = ref('')
const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)
const width = ref(0)
const height = ref(0)

// Config
const nodeWidth = 15
const nodePadding = 15
const marginLeft = 10
const marginRight = 10
const marginTop = 10
const marginBottom = 10

// Colors
const categoryColorsLight: Record<string, string> = {
  department: '#3b82f6', // brand blue
  repo: '#10b981', // brand green
  person: '#f59e0b' // brand orange
}

const categoryColorsDark: Record<string, string> = {
  department: '#60a5fa', // blue-400
  repo: '#34d399', // emerald-400
  person: '#fbbf24' // amber-400
}

const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const categoryColors = computed(() => isDark.value ? categoryColorsDark : categoryColorsLight)
const textColor = computed(() => isDark.value ? '#e5e7eb' : '#374151') // gray-200 : gray-700
const linkColor = computed(() => isDark.value ? '#9ca3af' : '#999') // gray-400 : #999
// Tooltip helper functions
// position: 'left' = show tooltip on left of cursor, 'right' = show on right
let tooltipPosition: 'left' | 'right' = 'right'

const showTooltip = (event: MouseEvent, content: string, position: 'left' | 'right' = 'right') => {
  tooltipContent.value = content
  tooltipVisible.value = true
  tooltipPosition = position
  moveTooltip(event)
}

const moveTooltip = (event: MouseEvent) => {
  const tooltipWidth = 120 // approximate max width
  const offsetY = 5 // 5px below cursor

  if (tooltipPosition === 'left') {
    // Position tooltip to the left of cursor (for right-side elements like person)
    tooltipX.value = event.clientX - tooltipWidth - 5
    // Fallback: if would go off left edge, show on right
    if (tooltipX.value < 5) {
      tooltipX.value = event.clientX + 5
    }
  } else {
    // Position tooltip to the right of cursor (for left-side elements like department)
    tooltipX.value = event.clientX + 5
  }

  tooltipY.value = event.clientY + offsetY
}

const hideTooltip = () => {
  tooltipVisible.value = false
}

const renderChart = () => {
  if (!container.value || !props.data || !props.data.nodes.length) return

  // Clear previous
  d3.select(container.value).selectAll('*').remove()

  const { clientWidth, clientHeight } = container.value
  width.value = clientWidth - marginLeft - marginRight

  // Calculate required height based on node density
  const counts: Record<string, number> = {}
  props.data.nodes.forEach((n) => {
    counts[n.category] = (counts[n.category] || 0) + 1
  })
  const maxNodes = Math.max(0, ...Object.values(counts))
  const minHeightNeeded = maxNodes * (nodePadding + 10) // 10px min node height + padding

  // Use the larger of container height or needed height
  const contentHeight = Math.max(clientHeight - marginTop - marginBottom, minHeightNeeded)
  height.value = contentHeight

  if (width.value <= 0 || height.value <= 0) return

  const svg = d3.select(container.value)
    .append('svg')
    .attr('width', clientWidth)
    .attr('height', height.value + marginTop + marginBottom)
    .attr('viewBox', [0, 0, clientWidth, height.value + marginTop + marginBottom])
    .attr('style', 'max-width: 100%; height: auto; font: 10px sans-serif;')

  const g = svg.append('g')
    .attr('transform', `translate(${marginLeft},${marginTop})`)

  // Prepare data (deep copy to avoid mutation issues in d3-sankey)
  // Cast to unknown first to match D3 requirements
  const sankeyData = {
    nodes: props.data.nodes.map(d => ({ ...d })) as unknown as CustomNode[],
    links: props.data.links.map(d => ({ ...d })) as unknown as CustomLink[]
  }

  // Sankey Generator
  const sankeyGenerator = d3Sankey<CustomNode, CustomLink>()
    .nodeId(d => d.id)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .extent([[1, 5], [width.value - 1, height.value - 5]])
  // Sort nodes by their total value (code lines) descending - larger values at top
    .nodeSort((a, b) => (b.value || 0) - (a.value || 0))

  // Compute layout
  // Note: d3-sankey modifies the data objects in place
  const { nodes, links } = sankeyGenerator(sankeyData)

  // -- Links --
  const link = g.append('g')
    .attr('fill', 'none')
    .attr('stroke-opacity', 0.2)
    .selectAll('g')
    .data(links)
    .join('g')
    .style('mix-blend-mode', isDark.value ? 'screen' : 'multiply')

  // Gradient definitions (optional, simplified to static color for now)
  // Or use source node color

  const linkPaths = link.append('path')
    .attr('d', sankeyLinkHorizontal())
    .attr('stroke', (d: CustomLink) => {
      // Use gradient or source color
      // Simple: use source node category color
      const srcCat = (d.source as CustomNode).category
      return categoryColors.value[srcCat] || linkColor.value
    })
    .attr('stroke-width', (d: CustomLink) => Math.max(1, d.width || 0))
    .sort((a: CustomLink, b: CustomLink) => (b.width || 0) - (a.width || 0)) // Draw thickest links last

  // Bind events to path elements directly (not the parent g)
  linkPaths.on('mouseover', function (event: MouseEvent, d: CustomLink) {
    d3.select(this).attr('stroke-opacity', 0.5)
    showTooltip(event, `${(d.source as CustomNode).name} ← ${(d.target as CustomNode).name}\n${d.value.toLocaleString()} lines`)
  }).on('mousemove', function (event: MouseEvent) {
    moveTooltip(event)
  }).on('mouseout', function () {
    d3.select(this).attr('stroke-opacity', 0.2)
    hideTooltip()
  })

  // -- Nodes --
  const node = g.append('g')
    .attr('stroke', isDark.value ? '#000' : '#fff') // Contrast border
    .selectAll('rect')
    .data(nodes)
    .join('rect')
    .attr('x', d => d.x0!)
    .attr('y', d => d.y0!)
    .attr('height', d => Math.max(1, (d.y1 || 0) - (d.y0 || 0))) // Ensure at least 1px
    .attr('width', d => (d.x1 || 0) - (d.x0 || 0))
    .attr('fill', d => categoryColors.value[d.category] || '#ccc')
    .attr('stroke-width', 0) // No border for cleaner look
    .attr('rx', 2) // Rounded corners

  // Custom tooltip for nodes - position based on category
  // Persons (right side) show tooltip on left, others on right
  node.on('mouseover', function (event: MouseEvent, d: CustomNode) {
    const position = d.category === 'person' ? 'left' : 'right'
    showTooltip(event, `${d.name}\n${(d.value || 0).toLocaleString()} lines`, position)
  }).on('mousemove', function (event: MouseEvent) {
    moveTooltip(event)
  }).on('mouseout', function () {
    hideTooltip()
  })

  // -- Labels --
  g.append('g')
    .attr('font-family', 'sans-serif')
    .attr('font-size', 10)
    .selectAll('text')
    .data(nodes)
    .join('text')
    .attr('x', d => (d.x0 || 0) < width.value / 2 ? (d.x1 || 0) + 6 : (d.x0 || 0) - 6)
    .attr('y', d => ((d.y1 || 0) + (d.y0 || 0)) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => (d.x0 || 0) < width.value / 2 ? 'start' : 'end')
    .text((d) => {
      // Only show label if node is tall enough (reduced threshold to show more labels)
      if (((d.y1 || 0) - (d.y0 || 0)) < 2) return ''
      return d.name
    })
    .attr('font-weight', 'bold')
    .attr('fill', textColor.value)

  // Expandable Logic (Basic impl: Click to highlight connected)
  // Real "Expandable" usually means hiding child nodes until clicked.
  // With simple D3 Sankey, we can hide/show nodes by filtering data and re-rendering.
  // Implementing full expand/collapse is complex.
  // For "Expandable Sankey" request, typically means "Interactive Highlighting".
  // Let's implement: Click node -> Dim all unconnected nodes/links.

  let activeNode: CustomNode | null = null

  node.on('click', (event, d: CustomNode) => {
    if (activeNode === d) {
      // Reset
      activeNode = null
      resetHighlight()
    } else {
      activeNode = d
      highlightNode(d)
    }
    event.stopPropagation()
  })

  // Click background to reset
  svg.on('click', () => {
    activeNode = null
    resetHighlight()
  })

  function highlightNode(d: CustomNode) {
    // Find connected links
    // Traverse forward and backward
    const linkedNodeIds = new Set<string>()
    linkedNodeIds.add(d.id)

    const connectedLinks = new Set<CustomLink>()

    // Simple traversal (1 level? or full path?)
    // Full path is better.
    // D3 Sankey structure links source/target as objects reference.

    // Since type defs might be missing, let's just inspect d.sourceLinks

    const stack = [d]
    while (stack.length) {
      const curr = stack.pop()
      if (!curr) continue
      // Outgoing
      if (curr.sourceLinks) {
        curr.sourceLinks.forEach((l) => {
          if (!connectedLinks.has(l)) {
            connectedLinks.add(l)
            const target = l.target as CustomNode
            linkedNodeIds.add(target.id)
            stack.push(target)
          }
        })
      }
      // Incoming
      if (curr.targetLinks) {
        curr.targetLinks.forEach((l) => {
          if (!connectedLinks.has(l)) {
            connectedLinks.add(l)
            const source = l.source as CustomNode
            linkedNodeIds.add(source.id)
            stack.push(source)
          }
        })
      }
    }

    // Update opacity
    link.transition().duration(200).attr('stroke-opacity', (l: CustomLink) => connectedLinks.has(l) ? 0.6 : 0.05)
    node.transition().duration(200).attr('opacity', (n: CustomNode) => linkedNodeIds.has(n.id) ? 1 : 0.1)
  }

  function resetHighlight() {
    link.transition().duration(200).attr('stroke-opacity', 0.2)
    node.transition().duration(200).attr('opacity', 1)
  }
}

// Watch data and resize
// Use ResizeObserver for container
const resizeObserver = new ResizeObserver(() => {
  // Debounce?
  requestAnimationFrame(renderChart)
})

onMounted(() => {
  if (container.value) {
    resizeObserver.observe(container.value)
    renderChart()
  }
})

onUnmounted(() => {
  resizeObserver.disconnect()
})

watch(() => props.data, renderChart, { deep: true })
watch(colorMode, renderChart)
</script>

<template>
  <div class="relative w-full h-[calc(100vh-150px)] overflow-y-auto">
    <div
      ref="container"
      class="w-full h-full"
    />
    <div
      v-show="tooltipVisible"
      ref="tooltip"
      class="fixed z-50 px-3 py-2 text-sm bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg shadow-lg pointer-events-none whitespace-pre-wrap max-w-xs"
      :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
    >
      {{ tooltipContent }}
    </div>
  </div>
</template>
