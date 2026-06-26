import { createError } from 'h3'

function tenantRuntimeOnly(): never {
  throw createError({
    statusCode: 503,
    message: 'Assets data APIs are served by tenant-runtime/data-runtime. Local database repositories are disabled.'
  })
}

async function unavailable<T = never>(): Promise<T> {
  return tenantRuntimeOnly()
}

async function unavailableFromDb<T = never>(..._args: unknown[]): Promise<T> {
  return unavailable()
}

export const getDashboardOverviewFromDb = unavailableFromDb
export const listAssetsFromDb = unavailableFromDb
export const getAssetDetailFromDb = unavailableFromDb
export const createAssetFromDb = unavailableFromDb
export const updateAssetFromDb = unavailableFromDb
export const changeAssetStatusFromDb = unavailableFromDb
export const listAssetEventsFromDb = unavailableFromDb
export const linkAssetDocumentFromDb = unavailableFromDb
export const listEnvironmentsFromDb = unavailableFromDb
export const getEnvironmentFromDb = unavailableFromDb
export const createEnvironmentFromDb = unavailableFromDb
export const updateEnvironmentFromDb = unavailableFromDb
export const bindEnvironmentAssetFromDb = unavailableFromDb
export const listProductAssetsFromDb = unavailableFromDb
export const getProductAssetFromDb = unavailableFromDb
export const createProductAssetFromDb = unavailableFromDb
export const updateProductAssetFromDb = unavailableFromDb
export const linkProductBaseFromDb = unavailableFromDb
export const linkProductAssetResourceFromDb = unavailableFromDb
export const linkProductDocumentFromDb = unavailableFromDb
export const listTechnologyBasesFromDb = unavailableFromDb
export const getTechnologyBaseFromDb = unavailableFromDb
export const createTechnologyBaseFromDb = unavailableFromDb
export const updateTechnologyBaseFromDb = unavailableFromDb
export const listIpAssetsFromDb = unavailableFromDb
export const getIpAssetFromDb = unavailableFromDb
export const createIpAssetFromDb = unavailableFromDb
export const updateIpAssetFromDb = unavailableFromDb
export const linkIpAssetProductFromDb = unavailableFromDb
export const linkIpDocumentFromDb = unavailableFromDb
export const listDigitalAssetsFromDb = unavailableFromDb
export const getDigitalAssetFromDb = unavailableFromDb
export const createDigitalAssetFromDb = unavailableFromDb
export const updateDigitalAssetFromDb = unavailableFromDb
export const linkDigitalAssetProductFromDb = unavailableFromDb
export const linkDigitalDocumentFromDb = unavailableFromDb
export const listDeliveriesFromDb = unavailableFromDb
export const getDeliveryFromDb = unavailableFromDb
export const createDeliveryFromDb = unavailableFromDb
export const updateDeliveryFromDb = unavailableFromDb
export const linkDeliveryProductFromDb = unavailableFromDb
export const linkDeliveryEnvironmentFromDb = unavailableFromDb
export const listSuppliersFromDb = unavailableFromDb
export const createSupplierFromDb = unavailableFromDb
export const updateSupplierFromDb = unavailableFromDb
export const listPurchaseOrdersFromDb = unavailableFromDb
export const getPurchaseOrderDetailFromDb = unavailableFromDb
export const createPurchaseOrderFromDb = unavailableFromDb
export const updatePurchaseOrderFromDb = unavailableFromDb
export const createPurchaseOrderItemFromDb = unavailableFromDb
export const updatePurchaseOrderItemFromDb = unavailableFromDb
export const submitPurchaseOrderFromDb = unavailableFromDb
export const createReceiptFromDb = unavailableFromDb
export const listReceiptsFromDb = unavailableFromDb
export const listAssignmentsFromDb = unavailableFromDb
export const createAssignmentFromDb = unavailableFromDb
export const listAlertsFromDb = unavailableFromDb
export const handleAlertFromDb = unavailableFromDb
export const getReportsFromDb: (...args: unknown[]) => Promise<Record<string, unknown>> = unavailableFromDb
