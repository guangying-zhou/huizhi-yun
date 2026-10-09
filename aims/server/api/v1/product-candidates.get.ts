import { handleProductCandidates } from '../../utils/productCandidatesRuntime'

export default defineEventHandler(event => handleProductCandidates(event))
