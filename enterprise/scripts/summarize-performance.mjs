import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dimensions = ['variant', 'scenario', 'cache', 'metric', 'unit', 'environment', 'role', 'datasetRevision', 'artifact']
const minimumSamples = 20

// Input contains measurements, never browser storage, request headers or bodies.
// Each artifact/role/data/cache combination is summarized separately.
export function summarizePerformance(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('PERFORMANCE_SAMPLES_REQUIRED')
  const groups = new Map()
  for (const sample of samples) {
    if (!sample || typeof sample !== 'object' || Object.keys(sample).some(key => ![...dimensions, 'value'].includes(key))) throw new Error('PERFORMANCE_SAMPLE_SHAPE_INVALID')
    if (dimensions.some(key => typeof sample[key] !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(sample[key]))) throw new Error('PERFORMANCE_DIMENSION_INVALID')
    if (!['legacy', 'enterprise'].includes(sample.variant) || !['cold', 'warm'].includes(sample.cache)
      || !['ms', 'bytes', 'count'].includes(sample.unit) || !Number.isFinite(sample.value) || sample.value < 0) throw new Error('PERFORMANCE_VALUE_INVALID')
    const identity = Object.fromEntries(dimensions.map(key => [key, sample[key]]))
    const key = JSON.stringify(identity)
    if (!groups.has(key)) groups.set(key, { ...identity, values: [] })
    groups.get(key).values.push(sample.value)
  }
  return {
    schemaVersion: 'enterprise-performance-summary.v1',
    quantileMethod: 'nearest-rank', minimumSamples,
    // Statistical summaries alone do not prove correctness or rollout readiness.
    deploymentReady: false,
    groups: [...groups.values()].map(({ values, ...identity }) => {
      values.sort((a, b) => a - b)
      const sufficient = values.length >= minimumSamples
      return { ...identity, count: values.length, sufficient, min: values[0], max: values.at(-1),
        p50: sufficient ? values[Math.ceil(values.length * 0.5) - 1] : null,
        p95: sufficient ? values[Math.ceil(values.length * 0.95) - 1] : null }
    })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('PERFORMANCE_INPUT_REQUIRED')
    console.log(JSON.stringify(summarizePerformance(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2))
  } catch { console.error('PERFORMANCE_INPUT_INVALID'); process.exitCode = 1 }
}
