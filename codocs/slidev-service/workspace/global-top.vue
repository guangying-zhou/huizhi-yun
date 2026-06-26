<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

// 切换编辑器面板
function toggleEditor(show?: boolean) {
  const showBtn = document.querySelector('button[title="Show editor"]') as HTMLButtonElement | null
  const hideBtn = document.querySelector('button[title="Hide editor"]') as HTMLButtonElement | null

  if (show === true && showBtn) {
    showBtn.click()
    return
  }
  if (show === false && hideBtn) {
    hideBtn.click()
    return
  }
  // toggle
  if (showBtn) {
    showBtn.click()
  } else if (hideBtn) {
    hideBtn.click()
  }
}

// 监听父页面的 postMessage 指令
function onMessage(e: MessageEvent) {
  if (e.data?.type === 'slidev:editor') {
    toggleEditor(e.data.show)
  }
}

// 首次加载：自动打开编辑器
onMounted(() => {
  const tryOpen = (attempts = 0) => {
    if (attempts > 30) return
    const btn = document.querySelector('button[title="Show editor"]') as HTMLButtonElement | null
    if (btn) {
      btn.click()
      return
    }
    if (document.querySelector('button[title="Hide editor"]')) return
    setTimeout(() => tryOpen(attempts + 1), 200)
  }
  setTimeout(() => tryOpen(), 800)

  window.addEventListener('message', onMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<template>
  <div />
</template>
