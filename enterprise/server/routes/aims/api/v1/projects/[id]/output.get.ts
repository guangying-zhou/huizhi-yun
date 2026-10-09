import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectOutput } from '~~/server/utils/enterpriseAimsProjectOutput'

export default defineEventHandler(enterpriseAimsProjectOutput)
