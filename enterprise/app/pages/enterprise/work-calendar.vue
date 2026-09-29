<script setup lang="ts">
definePageMeta({ name: 'console-host-work-calendar', navigationOwner: 'console' })
</script>

<template>
  <WorkCalendarReadPage
    api-path="/enterprise/api/work-calendars"
    console-path="/console/work-calendar"
  />
</template>
