import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectTemplateVersions } from '~~/server/utils/enterpriseAimsPlanActions'

export default defineEventHandler(enterpriseAimsProjectTemplateVersions)
