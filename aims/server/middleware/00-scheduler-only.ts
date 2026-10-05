import { createError, getMethod, getRequestURL } from 'h3'
import { isAimsSchedulerOnlyWake } from '../utils/schedulerOnlyIngress'

export default defineEventHandler((event) => {
  if (useRuntimeConfig(event).hzy.schedulerOnly
    && !isAimsSchedulerOnlyWake(getMethod(event), getRequestURL(event).pathname)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
