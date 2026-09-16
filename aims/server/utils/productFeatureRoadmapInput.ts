import { productFeatureRequestPageInput } from './productFeatureRequestInput'

export function productFeatureRoadmapInput(raw: Record<string, unknown>, featureId: string) {
  const { cycleId, ...page } = raw
  if (typeof cycleId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cycleId)) return null
  const input = productFeatureRequestPageInput(page, featureId)
  return input ? { ...input, cycle_biz_id: cycleId } : null
}
