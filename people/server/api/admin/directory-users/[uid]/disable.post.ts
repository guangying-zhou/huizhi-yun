import { createError } from 'h3'

export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    message: 'This bypass is retired. Record left/inactive employee status or an approved leave assignment in People.'
  })
})
