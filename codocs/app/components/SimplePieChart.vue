<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  data: { name: string, value: number }[]
}>()

const containerRef = ref<HTMLElement | null>(null)
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const color = d3.scaleOrdinal(d3.schemeCategory10)
const getColor = (i: number) => color(i.toString())

function drawChart() {
  if (!containerRef.value || !props.data.length) return

  const container = containerRef.value as unknown as HTMLElement & Element

  const width = container.clientWidth
  const height = container.clientHeight

  if (width <= 0 || height <= 0) return

  d3.select(container).selectAll('*').remove()

  // Layout - Full width/height for chart now
  const radius = Math.min(width, height) / 2 * 0.8
  const centerX = width / 2
  const centerY = (height - 8) / 2

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)

  const g = svg.append('g')
    .attr('transform', `translate(${centerX},${centerY})`)

  const pie = d3.pie<{ name: string, value: number }>()
    .value(d => d.value)
    .sort(null)

  const arc = d3.arc<d3.PieArcDatum<{ name: string, value: number }>>()
    .innerRadius(radius * 0.5)
    .outerRadius(radius)

  const arcs = g.selectAll('arc')
    .data(pie(props.data))
    .enter()
    .append('g')
    .attr('class', 'arc')

  // Central Label
  const centerLabel = g.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.2em')
    .style('font-size', '14px')
    .style('font-weight', 'bold')
    .style('fill', isDark.value ? '#fff' : '#000')
    .style('pointer-events', 'none')

  const centerSubLabel = g.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '1.2em')
    .style('font-size', '12px')
    .style('fill', isDark.value ? '#9ca3af' : '#6b7280')
    .style('pointer-events', 'none')

  // Initial Total
  const total = props.data.reduce((acc, curr) => acc + curr.value, 0)
  centerLabel.text('总计')
  centerSubLabel.text(total.toLocaleString())

  arcs.append('path')
    .attr('d', arc)
    .attr('fill', (d, i) => getColor(i))
    .attr('stroke', isDark.value ? '#1f2937' : '#fff')
    .style('stroke-width', '2px')
    .style('opacity', 0.8)
    .attr('data-name', d => d.data.name) // Add data attribute for selection

  arcs.select('path')
    .on('mouseover', function (_event, d) {
      d3.select(this).style('opacity', 1)
      d3.select(this).attr('stroke-width', '4px')

      const percent = ((d.endAngle - d.startAngle) / (2 * Math.PI) * 100).toFixed(1)
      centerLabel.text(d.data.name)
      centerSubLabel.text(`${d.data.value.toLocaleString()} (${percent}%)`)
    })
    .on('mouseout', function () {
      d3.select(this).style('opacity', 0.8)
      d3.select(this).attr('stroke-width', '2px')

      centerLabel.text('总计')
      centerSubLabel.text(total.toLocaleString())
    })
}

function highlightArc(name: string) {
  if (!containerRef.value) return
  const svg = d3.select(containerRef.value as unknown as Element)
  const path = svg.select(`path[data-name="${name}"]`)
  if (!path.empty()) {
    path.dispatch('mouseover')
  }
}

function resetArc(name: string) {
  if (!containerRef.value) return
  const svg = d3.select(containerRef.value as unknown as Element)
  const path = svg.select(`path[data-name="${name}"]`)
  if (!path.empty()) {
    path.dispatch('mouseout')
  }
}

onMounted(() => {
  drawChart()
  window.addEventListener('resize', drawChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', drawChart)
})

watch(() => [props.data, isDark.value], drawChart)
</script>

<template>
  <div class="flex flex-col w-full h-full">
    <div ref="containerRef" class="flex-1 min-h-0 relative" />
    <div class="flex flex-wrap justify-center gap-x-3 gap-y-1 p-2">
      <div
        v-for="(item, index) in data"
        :key="item.name"
        class="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
        @mouseenter="highlightArc(item.name)"
        @mouseleave="resetArc(item.name)"
      >
        <span class="w-2 h-2 rounded-sm" :style="{ backgroundColor: getColor(index) }" />
        <span class="text-[8px] text-gray-600 dark:text-gray-400">{{ item.name }}</span>
      </div>
    </div>
  </div>
</template>
