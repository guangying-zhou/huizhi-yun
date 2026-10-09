<template>
  <div>
    <img
      :src="src"
      :alt="'Decorative SVG'"
      :style="{ filter: colorFilter }"
      :class="wrapperClass"
    >
  </div>
</template>

<script setup lang="ts">
interface Props {
  src: string
  primaryColor?: string
  wrapperClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  primaryColor: '#f97316', // 默认橙色
  wrapperClass: ''
})

// 简化的颜色滤镜计算
const colorFilter = computed(() => {
  if (!props.primaryColor || props.primaryColor === '#FF6900' || props.primaryColor === '#ff6900') {
    return 'none'
  }

  // 从橙色到目标颜色的简单滤镜
  // 橙色 #FF6900 的HSL大约是 hue: 25deg
  const targetHue = hexToHue(props.primaryColor)
  const hueRotation = targetHue - 25 // 橙色的色相大约是25度

  // 调整饱和度和亮度
  const saturation = 1.2
  const brightness = 0.9

  return `hue-rotate(${hueRotation}deg) saturate(${saturation}) brightness(${brightness})`
})

// 将hex颜色转换为色相值
function hexToHue(hex: string): number {
  const r = parseInt(hex.substr(1, 2), 16) / 255
  const g = parseInt(hex.substr(3, 2), 16) / 255
  const b = parseInt(hex.substr(5, 2), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  if (delta === 0) return 0

  let hue = 0
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4

  return Math.round(hue * 60)
}
</script>

<style scoped>
img {
  transition: filter 0.3s ease;
  max-width: 100%;
  height: auto;
}
</style>
