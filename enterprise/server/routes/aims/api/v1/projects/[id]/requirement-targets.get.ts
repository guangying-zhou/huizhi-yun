import { defineEventHandler } from 'h3'
import { enterpriseAimsRequirementTargets } from '../../../../../../utils/enterpriseAimsProjectRequirements'

export default defineEventHandler(event => enterpriseAimsRequirementTargets(event))
