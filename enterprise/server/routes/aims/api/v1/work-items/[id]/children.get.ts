import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemChildren } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemChildren)
