import { handleProductOnboard } from '../../../utils/productOnboardingRuntime'

export default defineEventHandler(event => handleProductOnboard(event))
