<script setup lang="ts">
import * as d3 from 'd3'

const props = withDefaults(defineProps<{
  data: { date: string, repoCount: number, locChanged: number }[]
  label1?: string // Left Axis Label (e.g. "参与仓库数" or "贡献者数")
  label2?: string // Right Axis Label (e.g. "代码变动")
}>(), {
  label1: '参与仓库数',
  label2: '代码变动'
})

const containerRef = ref<HTMLElement | null>(null)
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')
const isMounted = ref(false)

function drawChart() {
  if (!isMounted.value || !containerRef.value || !props.data || !Array.isArray(props.data) || !props.data.length) return

  const container = containerRef.value
  container.innerHTML = ''

  const margin = { top: 40, right: 40, bottom: 30, left: 50 }
  const width = Math.max(0, container.clientWidth - margin.left - margin.right)
  const height = Math.max(0, container.clientHeight - margin.top - margin.bottom)

  if (width <= 0 || height <= 0) return

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Parse dates
  const parseDate = d3.timeParse('%Y-%m')
  const data = props.data.map(d => ({
    ...d,
    parsedDate: parseDate(d.date) || new Date()
  })).sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime())

  // Scales
  // For bars, we ideally need band scale, but time scale is continuous.
  // We can calculate bandwidth manually.
  const x = d3.scaleTime()
    .domain(d3.extent(data, d => d.parsedDate) as [Date, Date])
    .range([0, width])

  // Calculate approx bandwidth
  const innerWidth = width
  const minDiff = d3.min(d3.pairs(data.map(d => d.parsedDate.getTime())), ([a, b]) => b - a) || (30 * 24 * 3600 * 1000)
  // Convert time diff to pixels: x(d) - x(d-diff) roughly
  // Or just strictly: width / count * 0.5
  const barWidth = Math.max(10, Math.min(30, (width / (data.length || 1)) * 0.6))

  const y1 = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.repoCount) || 0])
    .nice()
    .range([height, 0])

  const y2 = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.locChanged) || 0])
    .nice()
    .range([height, 0])

  // Axes
  const xAxis = d3.axisBottom(x).ticks(width / 80).tickFormat(d => d3.timeFormat('%Y-%m')(d as Date))
  const y1Axis = d3.axisLeft(y1).ticks(5)
  // Format Y2 (LOC) with 'k', 'M' etc.
  const y2Axis = d3.axisRight(y2).ticks(5).tickFormat(d => d3.format('.2s')(d))

  // Draw Axes
  const axisColor = isDark.value ? '#9ca3af' : '#4b5563'
  const gridColor = isDark.value ? '#374151' : '#e5e7eb'

  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(xAxis)
    .attr('color', axisColor)

  svg.append('g')
    .call(y1Axis)
    .attr('color', axisColor)
  // Add label for Y1
    .call(g => g.append('text')
      .attr('x', -margin.left)
      .attr('y', -10)
      .attr('fill', '#3b82f6')
      .attr('text-anchor', 'start')
      .attr('text-anchor', 'start')
      .text(props.label1))

  svg.append('g')
    .attr('transform', `translate(${width},0)`)
    .call(y2Axis)
    .attr('color', axisColor)
  // Add label for Y2
    .call(g => g.append('text')
      .attr('x', 0)
      .attr('y', -10)
      .attr('fill', '#10b981')
      .attr('text-anchor', 'end')
      .attr('text-anchor', 'end')
      .text(props.label2))

  // Grid lines (based on Y1?)
  svg.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y1).tickSize(-width).tickFormat(() => ''))
    .attr('stroke-opacity', 0.1)
    .attr('color', gridColor)
    .call(g => g.select('.domain').remove())

  // Draw Bars (LOC) - Y2
  svg.selectAll('.bar')
    .data(data)
    .enter()
    .append('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.parsedDate) - barWidth / 2)
    .attr('y', d => y2(d.locChanged))
    .attr('width', barWidth)
    .attr('height', d => Math.max(0, height - y2(d.locChanged)))
    .attr('fill', '#10b981')
    .attr('opacity', 0.6)
    .attr('rx', 2)

  // Draw Line (Repo Count) - Y1
  const line1 = d3.line<any>()
    .x(d => x(d.parsedDate))
    .y(d => y1(d.repoCount))
    .curve(d3.curveMonotoneX)

  svg.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6') // Blue for Repo Count
    .attr('stroke-width', 2)
    .attr('d', line1)

  // Add dots for Line
  svg.selectAll('.dot')
    .data(data)
    .enter()
    .append('circle')
    .attr('cx', d => x(d.parsedDate))
    .attr('cy', d => y1(d.repoCount))
    .attr('r', 3)
    .attr('fill', '#3b82f6')
    .attr('stroke', isDark.value ? '#1f2937' : '#fff')
    .attr('stroke-width', 1)

  // Legend
  const legend = svg.append('g')
    .attr('transform', `translate(${width / 2 - 100}, -25)`)

  // Legend Item 1 (Line)
  legend.append('line')
    .attr('x1', 0).attr('y1', 0).attr('x2', 20).attr('y2', 0)
    .attr('stroke', '#3b82f6').attr('stroke-width', 2)
  legend.append('circle')
    .attr('cx', 10).attr('cy', 0).attr('r', 3).attr('fill', '#3b82f6')
  legend.append('text')
    .attr('x', 25).attr('y', 4)
    .text(props.label1)
    .attr('fill', axisColor)
    .style('font-size', '12px')

  // Legend Item 2 (Bar)
  legend.append('rect')
    .attr('x', 110).attr('y', -4)
    .attr('width', 12).attr('height', 8)
    .attr('fill', '#10b981').attr('opacity', 0.6)
  legend.append('text')
    .attr('x', 130).attr('y', 4)
    .text(props.label2)
    .attr('fill', axisColor)
    .style('font-size', '12px')

  // Tooltip
  const tooltip = d3.select(container)
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
    .style('z-index', '100')

  // Overlay for interaction
  const bisect = d3.bisector((d: any) => d.parsedDate).center

  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event)
      const date = x.invert(mx)

      // Find nearest data point
      // Since it's time scale (continuous), finding nearest index is tricky with bisect on discrete dates
      // But sorted array helps.
      // Alternative: use band scale logic if we had band scale.
      // Here we iterate or use bisect
      // Using simplified minimum distance approach for accuracy

      let nearest = data[0]
      if (!nearest) return
      let minDist = Math.abs(nearest.parsedDate.getTime() - date.getTime())

      for (let i = 1; i < data.length; i++) {
        const item = data[i]
        if (!item) continue
        const diet = Math.abs(item.parsedDate.getTime() - date.getTime())
        if (diet < minDist) {
          minDist = diet
          nearest = item
        }
      }

      // Highlight the bar
      svg.selectAll('.bar').attr('opacity', 0.6)
      svg.selectAll('.bar')
        .filter((d: any) => d === nearest)
        .attr('opacity', 1.0)

      // Show tooltip
      // Calculate position to avoid overflow
      const containerWidth = container.clientWidth
      const tooltipWidth = 180 // approx
      let left = event.pageX + 10
      if (left + tooltipWidth > window.innerWidth) { // Simple check, or relative to container
        left = event.pageX - tooltipWidth - 10
      }

      // Relative layout within container (pageX/Y are global)
      // d3.pointer gives relative to G (if used on G) or target.
      // Tooltip is appended to container (relative).
      const [localX, localY] = d3.pointer(event, container)
      let tipLeft = localX + 10
      const tipTop = localY - 90

      if (localX > width / 2) tipLeft = localX - 160

      tooltip
        .style('visibility', 'visible')
        .html(`
                    <div class="font-bold border-b border-gray-200 dark:border-gray-700 pb-1 mb-1">
                        ${d3.timeFormat('%Y-%m')(nearest.parsedDate)}
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <span class="flex items-center gap-1">
                             <span class="w-2 h-2 rounded-full bg-blue-500"></span> ${props.label1}
                        </span>
                        <span class="font-semibold">${nearest.repoCount}</span>
                    </div>
                    <div class="flex items-center justify-between gap-4 mt-1">
                        <span class="flex items-center gap-1">
                             <span class="w-2 h-2 rounded bg-emerald-500"></span> 代码变动
                        </span>
                        <span class="font-semibold">${nearest.locChanged.toLocaleString()}</span>
                    </div>
                `)
        .style('left', `${tipLeft}px`)
        .style('top', `${tipTop}px`)
    })
    .on('mouseleave', () => {
      tooltip.style('visibility', 'hidden')
      svg.selectAll('.bar').attr('opacity', 0.6)
    })
}

onMounted(() => {
  isMounted.value = true
  drawChart()
  window.addEventListener('resize', drawChart)
})

onUnmounted(() => {
  isMounted.value = false
  window.removeEventListener('resize', drawChart)
})

watch(() => [props.data, isDark.value], () => {
  if (isMounted.value) {
    drawChart()
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="w-full h-full relative"
  />
</template>
