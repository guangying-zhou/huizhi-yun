import { defineEventHandler } from 'h3'
import { enterpriseAimsAccessibleProjectDocuments } from '~~/server/utils/enterpriseAimsAccessibleDocuments'

export default defineEventHandler(enterpriseAimsAccessibleProjectDocuments)
