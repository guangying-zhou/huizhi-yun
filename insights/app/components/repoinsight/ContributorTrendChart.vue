<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  data: {
    date: string
    value: number
  }[]
}>()

const container = ref<HTMLElement | null>(null)
const width = ref(0)
const height = ref(0)

const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const renderChart = () => {
  if (!container.value || !props.data.length) return

  d3.select(container.value).selectAll('svg').remove()

  const margin = { top: 20, right: 20, bottom: 30, left: 40 }
  const { clientWidth, clientHeight } = container.value

  if (clientWidth <= 0 || clientHeight <= 0) return

  width.value = clientWidth
  height.value = clientHeight

  const svg = d3.select(container.value)
    .append('svg')
    .attr('width', width.value)
    .attr('height', height.value)
    .attr('viewBox', [0, 0, width.value, height.value])

  const x = d3.scalePoint()
    .domain(props.data.map(d => d.date))
    .range([margin.left, width.value - margin.right])
    .padding(0.5)

  const y = d3.scaleLinear()
    .domain([0, d3.max(props.data, d => d.value) || 0])
    .nice()
    .range([height.value - margin.bottom, margin.top])

  const line = d3.line<any>()
    .x(d => x(d.date)!)
    .y(d => y(d.value))
    .curve(d3.curveMonotoneX)

  const g = svg.append('g')

  // Line
  g.append('path')
    .datum(props.data)
    .attr('fill', 'none')
    .attr('stroke', isDark.value ? '#60a5fa' : '#3b82f6')
    .attr('stroke-width', 2)
    .attr('d', line)

  // Dots
  g.selectAll('circle')
    .data(props.data)
    .join('circle')
    .attr('cx', d => x(d.date)!)
    .attr('cy', d => y(d.value))
    .attr('r', 4)
    .attr('fill', isDark.value ? '#1e293b' : '#fff')
    .attr('stroke', isDark.value ? '#60a5fa' : '#3b82f6')
    .attr('stroke-width', 2)

  // X Axis
  g.append('g')
    .attr('transform', `translate(0,${height.value - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => i % Math.ceil(props.data.length / 10) === 0))) // Sparse ticks
    .call(g => g.select('.domain').remove())
    .selectAll('text')
    .attr('fill', isDark.value ? '#9ca3af' : '#4b5563')

  // Y Axis
  g.append('g')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .call(g => g.select('.domain').remove())
    .call(g => g.selectAll('.tick line').clone()
      .attr('x2', width.value - margin.left - margin.right)
      .attr('stroke-opacity', 0.1))
    .selectAll('text')
    .attr('fill', isDark.value ? '#9ca3af' : '#4b5563')
    // Tooltip
  const tooltip = d3.select(container.value)
    .append('div')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background', isDark.value ? 'rgba(31, 41, 55, 0.95)' : 'rgba(255, 255, 255, 0.95)')
    .style('color', isDark.value ? '#fff' : '#000')
    .style('border', '1px solid')
    .style('border-color', isDark.value ? '#374151' : '#e5e7eb')
    .style('padding', '8px 12px')
    .style('border-radius', '6px')
    .style('font-size', '12px')
    .style('pointer-events', 'none')
    .style('box-shadow', '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)')
    .style('z-index', '10')

  // Overlay for interaction
  // Use band scale logic for finding nearest point: x.domain() are exact points.
  // ScalePoint is discrete. We can find nearest by calculating distance or finding index.
  // x.step() gives step width.
  const step = x.step()

  svg.append('rect')
    .attr('width', width.value)
    .attr('height', height.value)
    .attr('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event)
      // Calculate index based on mx relative to margin.left
      // mx = margin.left + index * step
      // index = (mx - margin.left) / step
      // Need to round to nearest integer index
      let index = Math.round((mx - margin.left) / step)
      index = Math.max(0, Math.min(index, props.data.length - 1))

      const d = props.data[index]
      if (!d) return

      // Highlight dot
      g.selectAll('circle')
        .attr('r', 4)
        .attr('stroke-width', 2)

      g.selectAll('circle')
        .filter((data: any) => data === d)
        .attr('r', 6)
        .attr('stroke-width', 3)

      // Tooltip position
      // Calculate approx width/height to keep in bounds
      const containerWidth = container.value?.clientWidth || 0
      const tooltipWidth = 150
      const left = event.pageX + 10
      // Adjust if overflow
      // Since we are using absolute positioning within container (relative parent?),
      // no, container is just a div. Tooltip is appended to it.
      // If container is relative, d3.pointer gives coordinates relative to container.
      // But for tooltip style left/top, it depends on offsetParent.
      // Let's assume container is relative (style="position: relative" needed).

      const [localX, localY] = d3.pointer(event, container.value)
      let tipLeft = localX + 10
      const tipTop = localY + 10

      if (localX > width.value / 2) tipLeft = localX - 160

      tooltip
        .style('visibility', 'visible')
        .html(`
                    <div class="font-bold border-b border-gray-200 dark:border-gray-700 pb-1 mb-1">
                        ${d.date}
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <span class="flex items-center gap-1">
                             <span class="w-2 h-2 rounded-full bg-blue-500"></span> 活跃人数
                        </span>
                        <span class="font-semibold">${d.value}</span>
                    </div>
                `)
        .style('left', `${tipLeft}px`)
        .style('top', `${tipTop}px`)
    })
    .on('mouseleave', () => {
      tooltip.style('visibility', 'hidden')
      g.selectAll('circle')
        .attr('r', 4)
        .attr('stroke-width', 2)
    })
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
})

watch(() => [props.data, colorMode.value], renderChart, { deep: true })
</script>

<template>
  <div class="w-full h-full min-h-[250px] relative">
    <div
      ref="container"
      class="w-full h-full"
    />
  </div>
</template>
