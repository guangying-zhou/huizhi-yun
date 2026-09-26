import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectMilestones } from '~~/server/utils/enterpriseAimsMilestones'

export default defineEventHandler(enterpriseAimsProjectMilestones)
