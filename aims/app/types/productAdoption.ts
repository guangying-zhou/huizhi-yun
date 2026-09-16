export interface ProductAdoptionInstance {
  deliveryAssetCode: string
  environmentCode: string
  customerCode: string
  roles: string[]
  deploymentStatuses: string[]
  versions: string[]
  versionUnknown: boolean
  versionConflict: boolean
  adopted: boolean
  production: boolean
}
export interface ProductAdoptionSummary {
  instances: number
  environments: number
  customers: number
  productionInstances: number
  unknownVersionInstances: number
  conflictingVersionInstances: number
}
export interface ProductAdoptionPage {
  productCode: string
  queriedAt: string
  summary: ProductAdoptionSummary
  items: ProductAdoptionInstance[]
  total: number
  page: number
  pageSize: number
}
