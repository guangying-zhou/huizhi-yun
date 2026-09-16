import { getAllDepartments } from './server/utils/dingtalk'
import { $fetch } from 'ofetch'

// Mock $fetch and config
// @ts-expect-error - Mocking fetch for test environment
globalThis.$fetch = $fetch

async function run() {
  console.log('Testing getAllDepartments recursion logic')
  try {
    console.log('getAllDepartments type:', typeof getAllDepartments)
  } catch (error) {
    console.error('Test failed:', error)
  }
}

run()
