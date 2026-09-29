import { defineEventHandler } from 'h3'
import { enterpriseAimsMilestoneRollover } from '~~/server/utils/enterpriseAimsPlanActions'

export default defineEventHandler(enterpriseAimsMilestoneRollover)
