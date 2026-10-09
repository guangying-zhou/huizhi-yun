export const feedbackImageLimits = { count: 5, bytes: 5 * 1024 * 1024, total: 15 * 1024 * 1024, pixels: 16_000_000 }
export function assertFeedbackImage(file: Blob) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > feedbackImageLimits.bytes) throw Error('请选择 5 MiB 以内的 PNG、JPEG 或静态 WebP 图片。')
}
export async function decodeFeedbackImage(file: Blob) {
  assertFeedbackImage(file)
  const raw = new Uint8Array(await file.arrayBuffer())
  // Reject known animation chunks before browser decoding, never silently flatten.
  const magic = new TextDecoder('latin1').decode(raw)
  if ((file.type === 'image/png' && magic.includes('acTL')) || (file.type === 'image/webp' && (magic.includes('ANIM') || magic.includes('ANMF')))) throw Error('不支持动画图片。')
  const bitmap = await createImageBitmap(file)
  if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > feedbackImageLimits.pixels) {
    bitmap.close()
    throw Error('图片尺寸过大，请裁小后上传。')
  }
  return bitmap
}
export async function feedbackCanvasBlob(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('图片处理失败，请手工截图上传。')), 'image/png'))
  assertFeedbackImage(blob)
  return blob
}
export function feedbackCaptureForbidden() {
  return /(?:vault|credential|secret|token|password)/i.test(location.pathname) || [...document.querySelectorAll('input[type=password], [data-feedback-capture="deny"]')].some(e => e.getClientRects().length > 0)
}
export async function captureFeedbackViewport() {
  if (feedbackCaptureForbidden()) throw Error('此页面包含凭据或密码，请使用已遮挡的手工截图。')
  const width = window.innerWidth, height = window.innerHeight
  const { default: html2canvas } = await import('html2canvas')
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const previousClones = new Set(document.querySelectorAll('iframe.html2canvas-container'))
  const pending = html2canvas(document.body, {
    width, height, x: window.scrollX, y: window.scrollY,
    windowWidth: width, windowHeight: height, scale: Math.min(1, Math.sqrt(4_000_000 / (width * height))),
    logging: false, allowTaint: false, useCORS: false, imageTimeout: 5000,
    ignoreElements: e => e.hasAttribute('data-feedback-ui') || e.hasAttribute('data-html2canvas-ignore') || e.getAttribute('role') === 'dialog' || e.getAttribute('data-slot') === 'overlay',
    onclone: (doc) => {
      // html2canvas 1.4 does not parse modern CSS colors used by Nuxt UI.
      // Resolve them with the browser's own canvas, entirely on this device.
      const swatch = document.createElement('canvas')
      swatch.width = swatch.height = 1
      const paint = swatch.getContext('2d', { willReadFrequently: true })!
      doc.querySelectorAll<HTMLElement>('*').forEach((el) => {
        const style = doc.defaultView!.getComputedStyle(el)
        for (const property of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color']) {
          const value = style.getPropertyValue(property)
          if (!/(?:oklch|oklab|color\(|lab\(|lch\()/.test(value)) continue
          paint.clearRect(0, 0, 1, 1)
          paint.fillStyle = value
          paint.fillRect(0, 0, 1, 1)
          const pixel = paint.getImageData(0, 0, 1, 1).data
          el.style.setProperty(property, `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]! / 255})`, 'important')
        }
        for (const property of ['box-shadow', 'text-shadow', 'background-image']) {
          if (/(?:oklch|oklab|color\(|lab\(|lch\()/.test(style.getPropertyValue(property))) el.style.setProperty(property, 'none', 'important')
        }
      })
      swatch.width = swatch.height = 0
      doc.querySelectorAll('[data-feedback-private], [role=menu], [data-feedback-notifications], iframe, canvas, video').forEach((e) => {
        const el = e as HTMLElement
        const rect = el.getBoundingClientRect()
        const cover = doc.createElement('div')
        const computed = doc.defaultView!.getComputedStyle(el)
        for (const property of ['position', 'top', 'right', 'bottom', 'left', 'z-index', 'margin', 'display', 'flex', 'align-self']) cover.style.setProperty(property, computed.getPropertyValue(property))
        cover.style.width = `${rect.width}px`
        cover.style.height = `${rect.height}px`
        cover.style.background = '#000'
        cover.style.flexShrink = '0'
        el.replaceWith(cover)
      })
      doc.querySelectorAll('input[type=password], input[autocomplete*=password]').forEach(e => e.remove())
    }
  })
  const cloneFrame = [...document.querySelectorAll('iframe.html2canvas-container')].find(frame => !previousClones.has(frame))
  pending.then((c) => {
    if (expired) c.width = c.height = 0
  }, () => {})
  let canvas: HTMLCanvasElement | undefined
  try {
    canvas = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true
        reject(Error('截图超时，请粘贴或上传图片。'))
      }, 15000)
    })])
    return await feedbackCanvasBlob(canvas)
  } finally {
    clearTimeout(timer)
    cloneFrame?.remove()
    if (canvas) canvas.width = canvas.height = 0
  }
}
// Explicit browser picker only. All tracks stop even on decode/canvas failure.
export async function captureFeedbackDisplay() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw Error('当前浏览器不支持标签页截图，请粘贴或上传。')
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  const video = document.createElement('video')
  const canvas = document.createElement('canvas')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    video.srcObject = stream
    await Promise.race([video.play(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('截图超时，请重试。')), 10000)
    })])
    if (!video.videoWidth || !video.videoHeight) throw Error('无法读取选中的画面。')
    const scale = Math.min(1, Math.sqrt(4_000_000 / (video.videoWidth * video.videoHeight)))
    canvas.width = Math.floor(video.videoWidth * scale)
    canvas.height = Math.floor(video.videoHeight * scale)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    return await feedbackCanvasBlob(canvas)
  } finally {
    clearTimeout(timer)
    stream.getTracks().forEach(track => track.stop())
    video.pause()
    video.srcObject = null
    canvas.width = canvas.height = 0
  }
}
