<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  data: {
    name: string
    children: any[]
    value?: number
  }
}>()

const container = ref<HTMLElement | null>(null)
const tooltip = ref<HTMLElement | null>(null)
const width = ref(0)
const height = ref(0)

// Colors
const colorScale = d3.scaleOrdinal(d3.schemeTableau10)
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const renderChart = () => {
  if (!container.value || !props.data) return

  // Clear previous
  d3.select(container.value).selectAll('svg').remove()

  const { clientWidth, clientHeight } = container.value
  width.value = clientWidth
  height.value = clientHeight

  if (width.value <= 0 || height.value <= 0) return

  const svg = d3.select(container.value)
    .append('svg')
    .attr('width', width.value)
    .attr('height', height.value)
    .attr('viewBox', [0, 0, width.value, height.value])
    .attr('style', 'max-width: 100%; height: auto; font: 10px sans-serif;')

  // Hierarchy
  const root = d3.hierarchy(props.data as unknown)
    .sum((d: any) => d.value)
    .sort((a, b) => (b.value || 0) - (a.value || 0))

  // Treemap Layout
  d3.treemap()
    .size([width.value, height.value])
    .paddingTop(28)
    .paddingRight(7)
    .paddingInner(3)
    (root)

  const rootRect = root as d3.HierarchyRectangularNode<any>

  // Render Nodes
  const leaf = svg.selectAll('g')
    .data(rootRect.leaves())
    .join('g')
    .attr('transform', d => `translate(${d.x0},${d.y0})`)

  // Rectangles
  leaf.append('rect')
    .attr('fill', (d) => {
      // Color by parent (Department)
      let node = d
      while (node.depth > 1 && node.parent) node = node.parent
      return colorScale(node.data.name)
    })
    .attr('fill-opacity', 0.8)
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('rx', 3)
    .on('mouseover', function (event, d) {
      d3.select(this).attr('fill-opacity', 1)
      showTooltip(event, d)
    })
    .on('mouseout', function () {
      d3.select(this).attr('fill-opacity', 0.8)
      hideTooltip()
    })

  // Clip paths for text
  leaf.append('clipPath')
    .attr('id', (d, i) => `clip-${i}`) // Unique ID
    .append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)

  // Labels
  leaf.append('text')
    .attr('clip-path', (d, i) => `url(#clip-${i})`)
    .selectAll('tspan')
    .data((d) => {
      // Split name if needed or just show name
      return [d.data.name]
    })
    .join('tspan')
    .attr('x', 3)
    .attr('y', (d, i, nodes) => 13 + i * 10)
    .text(d => d)
    .attr('fill', isDark.value ? '#fff' : '#000')
    .attr('font-weight', 'bold')
    .style('display', function (d) {
      // Hide if too small
      // @ts-ignore
      const parentData = d3.select(this.parentNode).datum() as d3.HierarchyRectangularNode<any>
      return (parentData.x1 - parentData.x0) > 30 && (parentData.y1 - parentData.y0) > 20 ? 'block' : 'none'
    })

  // Values
  leaf.append('text')
    .attr('clip-path', (d, i) => `url(#clip-${i})`)
    .attr('x', 3)
    .attr('y', 25)
    .text(d => d.value?.toLocaleString() || '')
    .attr('fill', isDark.value ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)')
    .style('font-size', '9px')
    .style('display', function (d) {
      // @ts-ignore
      const parentData = d3.select(this.parentNode).datum() as d3.HierarchyRectangularNode<any>
      return (parentData.x1 - parentData.x0) > 30 && (parentData.y1 - parentData.y0) > 35 ? 'block' : 'none'
    })

  // Titles (Department Labels)
  svg.selectAll('titles')
    .data(rootRect.descendants().filter(d => d.depth === 1))
    .enter()
    .append('text')
    .attr('x', d => d.x0 + 5)
    .attr('y', d => d.y0 + 18)
    .text(d => d.data.name)
    .attr('font-size', '12px')
    .attr('font-weight', 'bold')
    .attr('fill', isDark.value ? '#e5e7eb' : '#374151')
    .each(function (d) {
      // Hide if width is too small
      if ((d.x1 - d.x0) < 50) d3.select(this).style('display', 'none')
    })
}

const showTooltip = (event: MouseEvent, d: any) => {
  if (!tooltip.value) return
  tooltip.value.style.display = 'block'
  tooltip.value.style.left = event.pageX + 10 + 'px'
  tooltip.value.style.top = event.pageY + 10 + 'px'

  // Find department
  let dept = d
  while (dept.depth > 1) dept = dept.parent

  tooltip.value.innerHTML = `
        <div class="font-bold">${d.data.name}</div>
        <div class="text-xs text-gray-500">${dept.data.name}</div>
        <div class="mt-1">Code Scale: ${d.value?.toLocaleString()} LOC</div>
    `
}

const hideTooltip = () => {
  if (!tooltip.value) return
  tooltip.value.style.display = 'none'
}

// Resize
const resizeObserver = new ResizeObserver(() => {
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
  <div class="relative w-full h-full min-h-[500px]">
    <div
      ref="container"
      class="w-full h-full"
    />
    <div
      ref="tooltip"
      class="fixed hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-2 text-sm z-50 pointer-events-none"
    />
  </div>
</template>
