import { defineEventHandler } from 'h3'
import { enterpriseAimsRequirementTargetCreate } from '~~/server/utils/enterpriseAimsPlanActions'

export default defineEventHandler(enterpriseAimsRequirementTargetCreate)
