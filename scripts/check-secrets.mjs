import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const ignored = new Set(['.git', 'node_modules', '.local'])
const forbidden = [
  /\bsk-[A-Za-z0-9]{20,}\b/gu,
  /["']Authorization["']\s*:\s*["']Bearer\s+[^"']+/giu,
  /\/(?:home|Users)\/[A-Za-z0-9._-]+\//gu,
  /["']X-Stainless-(?:Arch|OS|Runtime-Version)["']/giu,
]

async function* files(directory) {
  for (const entry of await readdir(directory)) {
    if (ignored.has(entry)) continue
    const path = resolve(directory, entry)
    const info = await stat(path)
    if (info.isDirectory()) yield* files(path)
    else if (info.isFile()) yield path
  }
}

for await (const path of files(root)) {
  const content = await readFile(path, 'utf8').catch(() => '')
  for (const pattern of forbidden) {
    pattern.lastIndex = 0
    if (pattern.test(content)) throw new Error(`possible secret in ${path}`)
  }
}
console.log('no committed-source secret patterns found')
