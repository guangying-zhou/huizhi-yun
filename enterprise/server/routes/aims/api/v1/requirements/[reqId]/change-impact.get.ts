import { defineEventHandler } from 'h3'
import { enterpriseAimsRequirementExtendedRead } from '../../../../../../utils/enterpriseAimsProjectRequirements'

export default defineEventHandler(event => enterpriseAimsRequirementExtendedRead(event, 'change-impact'))
