<template>
  <div
    ref="chartRef"
    class="w-full h-full min-h-[200px] relative"
  />
</template>

<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  data: { date: string, value: number }[]
}>()

const chartRef = ref<HTMLElement | null>(null)

const drawChart = () => {
  if (!chartRef.value || !props.data || !props.data.length) return

  const container = chartRef.value
  container.innerHTML = '' // Clear previous

  const margin = { top: 20, right: 10, bottom: 40, left: 50 }
  const width = container.getBoundingClientRect().width - margin.left - margin.right
  const height = container.getBoundingClientRect().height - margin.top - margin.bottom

  // Create Tooltip
  // We append it to body or container. Appending to container is safer for cleaning up,
  // but we need to ensure container is relative.
  // Let's use a simple div inside the container.
  const tooltip = d3.select(container)
    .append('div')
    .style('position', 'absolute')
    .style('display', 'none')
    .style('background', 'rgba(0, 0, 0, 0.8)')
    .style('color', '#fff')
    .style('padding', '6px 10px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('pointer-events', 'none')
    .style('z-index', '10')

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // X Axis with tick optimization
  const x = d3.scalePoint()
    .domain(props.data.map(d => d.date))
    .range([0, width])
    .padding(0.5)

  const xAxis = d3.axisBottom(x)

  // If too many points, filter ticks (prioritize recent dates)
  const tickCount = props.data.length
  if (tickCount > 12) {
    const step = Math.ceil(tickCount / 12)
    // Keep the last item, then every step-th item going backwards
    // (tickCount - 1 - i) % step === 0
    const tickValues = props.data
      .filter((_, i) => (tickCount - 1 - i) % step === 0)
      .map(d => d.date)
    xAxis.tickValues(tickValues)
  }

  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(xAxis)
    .selectAll('text')
    .style('text-anchor', 'end')
    .attr('dx', '-.8em')
    .attr('dy', '.15em')
    .attr('transform', 'rotate(-45)')

  // Y Axis
  const maxVal = d3.max(props.data, d => d.value) || 0
  const y = d3.scaleLinear()
    .domain([0, maxVal * 1.1])
    .range([height, 0])

  svg.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat((d) => {
      if (Number(d) >= 1000) return (Number(d) / 1000).toFixed(0) + 'k'
      return String(d)
    }))

  // Line
  const line = d3.line<{ date: string, value: number }>()
    .x(d => x(d.date) || 0)
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX)

  svg.append('path')
    .datum(props.data)
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 2)
    .attr('d', line)

  // Dots with enhanced hover
  svg.selectAll('.dot')
    .data(props.data)
    .enter()
    .append('circle')
    .attr('class', 'dot')
    .attr('cx', d => x(d.date) || 0)
    .attr('cy', d => y(d.value))
    .attr('r', 4)
    .attr('fill', '#3b82f6')
    .style('cursor', 'pointer')
    .on('mouseover', function (event, d) {
      d3.select(this).attr('r', 6).attr('fill', '#2563eb')
      tooltip
        .style('display', 'block')
        .html(`<strong>${d.date}</strong><br>代码行: ${d.value.toLocaleString()}`)
    })
    .on('mousemove', function (event) {
      // Get relative coordinates
      const [mx, my] = d3.pointer(event, container)

      // Get container and tooltip dimensions
      const containerWidth = container.getBoundingClientRect().width
      const tooltipNode = tooltip.node() as HTMLElement
      const tooltipWidth = tooltipNode.offsetWidth || 120

      // Check right boundary
      let left = mx + 10
      if (left + tooltipWidth > containerWidth) {
        left = mx - 10 - tooltipWidth
      }

      tooltip
        .style('left', left + 'px')
        .style('top', (my - 20) + 'px')
    })
    .on('mouseout', function () {
      d3.select(this).attr('r', 4).attr('fill', '#3b82f6')
      tooltip.style('display', 'none')
    })
}

onMounted(() => {
  drawChart()
  window.addEventListener('resize', drawChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', drawChart)
})

watch(() => props.data, drawChart, { deep: true })
</script>
