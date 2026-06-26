<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  data: {
    id: number
    name: string
    deptName: string
    totalLoc: number
    commits: number
    rank: number
  }[]
  sortBy: 'total_loc' | 'commits'
}>()

const containerRef = ref<HTMLElement | null>(null)
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

function drawChart() {
  if (!containerRef.value || !props.data.length) return

  const container = containerRef.value
  container.innerHTML = ''

  const margin = { top: 20, right: 80, bottom: 40, left: 180 } // Left margin for Repo Names
  const width = Math.max(0, container.getBoundingClientRect().width - margin.left - margin.right)

  if (width <= 0) return
  // Dynamic height based on number of items (top 50 could be tall)
  // Let's cap it or scroll it. The container in parent is overflow-auto.
  const height = Math.max(400, props.data.length * 30)

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  const data = props.data

  const maxVal = d3.max(data, d => props.sortBy === 'total_loc' ? d.totalLoc : d.commits) || 0
  const x = d3.scaleLinear()
    .domain([0, maxVal || 10]) // Fallback to avoid 0 domain
    .range([0, width])

  const y = d3.scaleBand()
    .domain(data.map(d => d.name))
    .range([0, height])
    .padding(0.3)

  // Axes
  const xAxis = d3.axisBottom(x).ticks(5).tickFormat(d => d3.format('.2s')(d))
  const yAxis = d3.axisLeft(y).tickSize(0)

  const axisColor = isDark.value ? '#9ca3af' : '#4b5563'

  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(xAxis)
    .attr('color', axisColor)

  svg.append('g')
    .call(yAxis)
    .attr('color', axisColor)
    .selectAll('text')
    .attr('font-size', '12px')
    .style('text-anchor', 'end')
    .attr('dx', '-10px')

  // Bars
  svg.selectAll('.bar')
    .data(data)
    .enter()
    .append('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', d => y(d.name) as number)
    .attr('width', d => x(props.sortBy === 'total_loc' ? d.totalLoc : d.commits))
    .attr('height', y.bandwidth())
    .attr('fill', (d) => {
      // Top 3 gold/silver/bronze colors? Or just gradient
      if (d.rank === 1) return '#eab308'
      if (d.rank === 2) return '#94a3b8'
      if (d.rank === 3) return '#b45309'
      return '#3b82f6'
    })
    .attr('rx', 4)

  // Values on bars
  svg.selectAll('.label')
    .data(data)
    .enter()
    .append('text')
    .attr('x', d => x(props.sortBy === 'total_loc' ? d.totalLoc : d.commits) + 5)
    .attr('y', d => (y(d.name) as number) + y.bandwidth() / 2 + 4)
    .text(d => (props.sortBy === 'total_loc' ? d.totalLoc : d.commits).toLocaleString())
    .attr('fill', axisColor)
    .attr('font-size', '10px')
}

onMounted(() => {
  drawChart()
  window.addEventListener('resize', drawChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', drawChart)
})

watch(() => [props.data, props.sortBy, isDark.value], drawChart)
</script>

<template>
  <div
    ref="containerRef"
    class="w-full"
  />
</template>
