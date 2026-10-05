import { defineEventHandler } from 'h3'
import { enterpriseAimsRequirementReviewSync } from '../../../../../../utils/enterpriseAimsRequirementReviewWorkflow'

export default defineEventHandler(enterpriseAimsRequirementReviewSync)
