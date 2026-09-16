<script setup lang="ts">
import PdfViewer from "/Users/gavin/orca/workspaces/huizhi-yun/stream-c-people/codocs/app/components/published/PdfViewer.client.vue"
const src = ref("/codocs/test.pdf")
</script>
<template><UApp><main class="mx-auto max-w-5xl p-3"><div class="mb-3 flex gap-2"><UButton @click="src='/codocs/test.pdf'">正常PDF</UButton><UButton @click="src='/codocs/missing.pdf'">缺失PDF</UButton></div><PdfViewer :src="src" title="已发布 PDF 测试" /></main></UApp></template>