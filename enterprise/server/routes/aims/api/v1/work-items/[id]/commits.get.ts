import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemCommits } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemCommits)
