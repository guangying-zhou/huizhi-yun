import { defineEventHandler } from 'h3'
import { enterpriseAimsRequirementSpec } from '../../../../../../../utils/enterpriseAimsProjectRequirements'

export default defineEventHandler(event => enterpriseAimsRequirementSpec(event))
