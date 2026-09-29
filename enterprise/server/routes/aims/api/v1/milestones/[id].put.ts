import { defineEventHandler } from 'h3'
import { enterpriseAimsMilestoneUpdate } from '~~/server/utils/enterpriseAimsMilestones'

export default defineEventHandler(enterpriseAimsMilestoneUpdate)
