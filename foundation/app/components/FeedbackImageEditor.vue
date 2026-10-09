<script setup lang="ts">
import { decodeFeedbackImage, feedbackCanvasBlob } from '../utils/feedbackImages'

const props = defineProps<{ image: Blob | null }>()
const emit = defineEmits<{ confirmed: [blob: Blob], cancel: [] }>()
const canvas = ref<HTMLCanvasElement>()
const error = ref('')
const busy = ref(false)
const mode = ref('mask')
let generation = 0
let start: { x: number, y: number } | null = null
let snapshot: ImageData | null = null
const history: ImageData[] = []
function clear() {
  generation++
  history.length = 0
  snapshot = null
  start = null
  if (canvas.value) canvas.value.width = canvas.value.height = 0
}
onBeforeUnmount(clear)
watch(() => props.image, async (image) => {
  clear()
  if (!image) return
  error.value = ''
  const current = generation
  await nextTick()
  try {
    const bitmap = await decodeFeedbackImage(image)
    if (current !== generation || !canvas.value) {
      bitmap.close()
      return
    }
    canvas.value.width = bitmap.width
    canvas.value.height = bitmap.height
    canvas.value.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
  } catch (e) { if (current === generation) error.value = (e as Error).message }
}, { immediate: true })
function point(e: PointerEvent) {
  const c = canvas.value!, r = c.getBoundingClientRect()
  return { x: Math.max(0, Math.min(c.width, (e.clientX - r.left) * c.width / r.width)), y: Math.max(0, Math.min(c.height, (e.clientY - r.top) * c.height / r.height)) }
}
function down(e: PointerEvent) {
  if (!canvas.value || busy.value) return
  start = point(e)
  snapshot = canvas.value.getContext('2d')!.getImageData(0, 0, canvas.value.width, canvas.value.height)
  canvas.value.setPointerCapture(e.pointerId)
}
function move(e: PointerEvent) {
  if (!start || !snapshot || !canvas.value) return
  const p = point(e), ctx = canvas.value.getContext('2d')!
  ctx.putImageData(snapshot, 0, 0)
  ctx.fillStyle = '#000'
  if (mode.value === 'mask') ctx.fillRect(Math.floor(Math.min(start.x, p.x)), Math.floor(Math.min(start.y, p.y)), Math.ceil(Math.abs(p.x - start.x)) + 1, Math.ceil(Math.abs(p.y - start.y)) + 1)
  else {
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 3
    ctx.strokeRect(start.x, start.y, p.x - start.x, p.y - start.y)
  }
}
function up(e: PointerEvent) {
  if (!start || !snapshot || !canvas.value) return
  const c = canvas.value, ctx = c.getContext('2d')!, p = point(e)
  move(e)
  history.push(snapshot)
  if (history.length > 5) history.shift()
  if (mode.value === 'crop') {
    ctx.putImageData(snapshot, 0, 0)
    const x = Math.floor(Math.min(start.x, p.x)), y = Math.floor(Math.min(start.y, p.y))
    const w = Math.floor(Math.abs(p.x - start.x)), h = Math.floor(Math.abs(p.y - start.y))
    if (w > 0 && h > 0) {
      const cropped = ctx.getImageData(x, y, w, h)
      c.width = w
      c.height = h
      ctx.putImageData(cropped, 0, 0)
    }
  }
  start = null
  snapshot = null
}
function undo() {
  const data = history.pop(), c = canvas.value
  if (data && c) {
    c.width = data.width
    c.height = data.height
    c.getContext('2d')!.putImageData(data, 0, 0)
  }
}
async function save() {
  if (!canvas.value || !canvas.value.width) return
  busy.value = true
  const current = generation
  try {
    const blob = await feedbackCanvasBlob(canvas.value)
    if (current !== generation) return
    clear() // Destroy original pixels and reversible editing history before emit.
    emit('confirmed', blob)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="image" data-feedback-ui class="space-y-3">
    <p class="text-sm">
      图片仅在本机处理。请遮挡敏感内容；确认附带后，点击“提交反馈”才会上传。
    </p>
    <UAlert v-if="error" color="warning" :description="error" />
    <div class="flex flex-wrap gap-2">
      <USelect v-model="mode" aria-label="编辑工具" :items="[{ label: '实色矩形遮挡', value: 'mask' }, { label: '裁剪保留区域', value: 'crop' }]" />
      <UButton color="neutral" @click="undo">
        撤销
      </UButton>
    </div>
    <p class="text-xs text-muted">
      在图片上拖动选择区域。最多可撤销 5 步；确认后不可恢复原图。
    </p>
    <canvas
      ref="canvas"
      aria-label="图片预览与遮挡画布"
      class="max-h-[50vh] max-w-full touch-none border border-muted object-contain"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="start = null; snapshot = null"
    />
    <div class="flex flex-wrap justify-end gap-2">
      <UButton color="neutral" :disabled="busy" @click="clear(); emit('cancel')">
        取消这张图片
      </UButton>
      <UButton :disabled="!!error" :loading="busy" @click="save">
        确认附带
      </UButton>
    </div>
  </div>
</template>
