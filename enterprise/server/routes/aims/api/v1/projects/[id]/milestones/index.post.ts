import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectMilestoneCreate } from '~~/server/utils/enterpriseAimsMilestones'

export default defineEventHandler(enterpriseAimsProjectMilestoneCreate)
