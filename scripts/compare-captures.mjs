import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

const [expectedPath, actualPath] = process.argv.slice(2).filter(argument => argument !== '--')
if (!expectedPath || !actualPath) {
  throw new Error('usage: pnpm capture:compare -- <claude-trace.jsonl> <dsh-trace.jsonl>')
}

async function mainRequest(path) {
  const records = (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean).map(JSON.parse)
  const record = records.find(candidate => Array.isArray(candidate.request?.body?.tools)
    && candidate.request.body.tools.length > 0)
  if (!record) throw new Error(`${path}: no request containing tools`)
  return record.request
}

function normalize(request) {
  const copy = structuredClone(request)
  delete copy.headers
  // Reverse mode records the target base path separately; forward mode keeps it
  // in the observed path. Both forms address https://api.deepseek.com/anthropic.
  copy.path = copy.path?.replace(/^\/anthropic(?=\/v1\/messages)/u, '')
  const body = copy.body
  if (typeof body?.metadata?.user_id === 'string') {
    const metadata = JSON.parse(body.metadata.user_id)
    metadata.device_id = '<device-id>'
    metadata.session_id = '<session-id>'
    body.metadata.user_id = JSON.stringify(metadata)
  }
  const replaceDate = value => typeof value === 'string'
    ? value.replace(/Today's date is \d{4}-\d{2}-\d{2}\./gu, "Today's date is <date>.")
    : value
  for (const message of body?.messages ?? []) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'text') block.text = replaceDate(block.text)
    }
  }
  return copy
}

function firstDifference(expected, actual, path = '$') {
  if (isDeepStrictEqual(expected, actual)) return undefined
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`)
      if (difference) return difference
    }
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of keys) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`)
      if (difference) return difference
    }
  }
  return { path, expected, actual }
}

const expected = normalize(await mainRequest(expectedPath))
const actual = normalize(await mainRequest(actualPath))
const difference = firstDifference(expected, actual)
if (difference) {
  console.error(JSON.stringify(difference, null, 2))
  process.exitCode = 1
} else {
  console.log('normalized main request matches Claude Code exactly')
}
