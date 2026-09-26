import { enterpriseCodocsDocumentShares } from '../../../../../utils/enterpriseCodocsDocumentShares'
export default defineEventHandler(event => enterpriseCodocsDocumentShares(event, 'list'))
