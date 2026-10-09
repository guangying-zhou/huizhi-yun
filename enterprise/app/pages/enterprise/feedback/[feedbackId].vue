<script setup lang="ts">
definePageMeta({ navigationOwner: 'console', name: 'console-host-feedback-detail' })
const route = useRoute()
</script>

<template>
  <FeedbackRecords :id="String(route.params.feedbackId || '')" />
</template>
