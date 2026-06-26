<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  data: {
    id: number
    name: string
    totalLoc: number
    dailyAvg: number
  }[]
  sortBy: 'total_loc' | 'daily_avg'
}>()

const container = ref<HTMLElement | null>(null)
const width = ref(0)
const height = ref(0)

const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const renderChart = () => {
  if (!container.value || !props.data.length) return

  d3.select(container.value).selectAll('svg').remove()

  // Dynamic width calculation
  const minBarWidth = 40
  const calculatedWidth = Math.max(container.value.clientWidth, props.data.length * minBarWidth)

  // Use calculated width instead of container width for SVG
  const margin = { top: 20, right: 20, bottom: 60, left: 50 }
  const height = container.value.clientHeight

  const svg = d3.select(container.value)
    .append('svg')
    .attr('width', calculatedWidth)
    .attr('height', height)

  const x = d3.scaleBand()
    .domain(props.data.map(d => d.name))
    .range([margin.left, calculatedWidth - margin.right])
    .padding(0.2)

  const y = d3.scaleLinear()
    .domain([0, d3.max(props.data, d => props.sortBy === 'total_loc' ? d.totalLoc : d.dailyAvg) || 0])
    .nice()
    .range([height - margin.bottom, margin.top])

  const g = svg.append('g')

  // Tooltip
  const tooltip = d3.select('body').selectAll('.d3-tooltip').data([0]).join('div')
    .attr('class', 'd3-tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background', 'rgba(0, 0, 0, 0.8)')
    .style('color', '#fff')
    .style('padding', '8px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('z-index', '9999')
    .style('pointer-events', 'none')

  // Bars
  g.selectAll('rect')
    .data(props.data)
    .join('rect')
    .attr('x', d => x(d.name)!)
    .attr('y', d => y((props.sortBy === 'total_loc' ? d.totalLoc : d.dailyAvg) || (d as any).total_loc || 0))
    .attr('height', d => Math.max(0, y(0) - y((props.sortBy === 'total_loc' ? d.totalLoc : d.dailyAvg) || (d as any).total_loc || 0)))
    .attr('width', x.bandwidth())
    .attr('fill', isDark.value ? '#60a5fa' : '#3b82f6')
    .attr('rx', 4)
    .on('mouseover', (event, d) => {
      const val = (props.sortBy === 'total_loc' ? d.totalLoc : d.dailyAvg) || (d as any).total_loc || 0
      tooltip
        .style('visibility', 'visible')
        .html(`
                    <div class="font-bold">${d.name}</div>
                    <div>${props.sortBy === 'total_loc' ? '总代码量' : '日均代码量'}: ${Math.round(val).toLocaleString()}</div>
                `)
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px')
    })
    .on('mouseleave', () => {
      tooltip.style('visibility', 'hidden')
    })

  // X Axis
  g.append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickSizeOuter(0))
    .selectAll('text')
    .attr('transform', 'rotate(-45)')
    .style('text-anchor', 'end')
    .attr('dx', '-.8em')
    .attr('dy', '.15em')
    .style('font-size', '10px')
    .attr('fill', isDark.value ? '#9ca3af' : '#4b5563')

  // Y Axis
  g.append('g')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .call(g => g.select('.domain').remove())
    .call(g => g.selectAll('.tick line').clone()
      .attr('x2', calculatedWidth - margin.left - margin.right)
      .attr('stroke-opacity', 0.1))
    .selectAll('text')
    .attr('fill', isDark.value ? '#9ca3af' : '#4b5563')
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(renderChart)
    })
    resizeObserver.observe(container.value)
    renderChart()
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  d3.selectAll('.d3-tooltip').remove()
})

watch(() => [props.data, props.sortBy, colorMode.value], renderChart, { deep: true })
</script>

<template>
  <div class="w-full h-full min-h-[300px] overflow-x-auto">
    <div
      ref="container"
      class="h-full"
    />
  </div>
</template>
