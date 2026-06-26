import { notImplemented } from '~~/server/utils/controlPlaneV1'

export default defineEventHandler(() => {
  return notImplemented('auth refresh is handled by customer-side console in the current architecture')
})
