#!/usr/bin/env node
import process from 'node:process'

const requiredArguments = ['--batch', '--raw', '--column-names', '--database=offline_fixture']
const missingArguments = requiredArguments.filter(argument => !process.argv.slice(2).includes(argument))
if (missingArguments.length > 0) {
  console.error(`fake mysql missing required argument(s): ${missingArguments.join(', ')}`)
  process.exit(64)
}

await new Promise(resolve => {
  process.stdin.resume()
  process.stdin.on('end', resolve)
})

const header = 'phase\tcheck_code\tstatus\texpected\tactual\tevidence'
const row = (checkCode, status) => `offline\t${checkCode}\t${status}\texpected\tactual\tfixture`
const scenario = process.env.HZY_DEMO_FAKE_MYSQL_SCENARIO || 'pass'
const outputs = {
  pass: [header, row('fixture.alpha', 'PASS'), row('fixture.beta', 'PASS')],
  fail: [header, row('fixture.alpha', 'PASS'), row('fixture.beta', 'FAIL')],
  missing: [header, row('fixture.alpha', 'PASS')],
  duplicate: [header, row('fixture.alpha', 'PASS'), row('fixture.alpha', 'PASS'), row('fixture.beta', 'PASS')],
  empty: [header],
  vanished: [],
  'missing-columns': ['phase\tresult', 'offline\tPASS'],
  unexpected: [header, row('fixture.alpha', 'PASS'), row('fixture.beta', 'PASS'), row('fixture.gamma', 'PASS')]
}

if (!Object.hasOwn(outputs, scenario)) {
  console.error(`unknown fake mysql scenario: ${scenario}`)
  process.exit(65)
}

const lines = outputs[scenario]
if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`)
