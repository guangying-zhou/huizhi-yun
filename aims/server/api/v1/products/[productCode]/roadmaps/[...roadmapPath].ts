import { handleProductDocumentRequests } from '../../../../../utils/productDocumentRequestsRuntime'
import { handleProductAdoption } from '../../../../../utils/productAdoptionRuntime'
import { handleProductCost } from '../../../../../utils/productCostRuntime'
import { handleProductDocumentRequestStatus, handleProductDocumentRequestResume } from '../../../../../utils/productDocumentRequestStatusRuntime'
import { handleProductDocumentLinkCreated } from '../../../../../utils/productDocumentLinkCreatedRuntime'
import { handleProductDocumentTemplateCreate } from '../../../../../utils/productDocumentTemplateRuntime'
import { handleProductDocumentContent } from '../../../../../utils/productDocumentContentRuntime'
import { handleProductDocumentSearch } from '../../../../../utils/productDocumentSearchRuntime'
import { handleProductDocumentRemove, handleProductDocumentPurpose, handleProductDocumentRestore, handleProductDocumentCreate } from '../../../../../utils/productDocumentRemoveRuntime'
import { handleProductDocumentList } from '../../../../../utils/productDocumentRuntime'
import { getRouterParam } from 'h3'
import { handleProductExecutionCoordination } from '../../../../../utils/productExecutionCoordinationRuntime'
import { handleProductFeatureVersionMatrix } from '../../../../../utils/productFeatureVersionMatrixRuntime'
import { handleProductRoadmap } from '../../../../../utils/productRoadmapRuntime'
import { handleProductReleaseDiff } from '../../../../../utils/productReleaseDiffRuntime'
import { handleProductSavedView } from '../../../../../utils/productSavedViewRuntime'

export default defineEventHandler((event) => {
  const path = getRouterParam(event, 'roadmapPath') || ''
  if (path === 'adoption') return handleProductAdoption(event)
  if (path === 'cost') return handleProductCost(event)
  if (path === 'documents/requests') return handleProductDocumentRequests(event)
  if (path === 'documents/request-resume') return handleProductDocumentRequestResume(event)
  if (path === 'documents/request-status') return handleProductDocumentRequestStatus(event)
  if (path === 'documents/link-created') return handleProductDocumentLinkCreated(event)
  if (path === 'documents/template-create') return handleProductDocumentTemplateCreate(event)
  if (path === 'documents/content') return handleProductDocumentContent(event)
  if (path === 'documents/search') return handleProductDocumentSearch(event)
  if (path === 'documents/create') return handleProductDocumentCreate(event)
  if (path === 'documents/restore') return handleProductDocumentRestore(event)
  if (path === 'documents/purpose') return handleProductDocumentPurpose(event)
  if (path === 'documents/remove') return handleProductDocumentRemove(event)
  if (path === 'documents') return handleProductDocumentList(event)
  if (path === 'execution-coordination') return handleProductExecutionCoordination(event)
  if (path === 'feature-version-matrix') return handleProductFeatureVersionMatrix(event)
  if (path === 'release-diff') return handleProductReleaseDiff(event)
  return path.startsWith('views/') ? handleProductSavedView(event, path.slice(6)) : handleProductRoadmap(event)
})
