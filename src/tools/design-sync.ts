/** Local design-system backend implementing the captured DesignSync method protocol. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { optionalStringArg, stringArg, type ClaudeToolBody } from './runtime.ts'
import type { ClaudeWorkspace } from './workspace.ts'

interface DesignPlan {
  readonly projectId: string
  readonly writes: string[]
  readonly deletes: string[]
  readonly localDir: string
}

interface ProjectMetadata {
  readonly projectId: string
  readonly name: string
  readonly type: 'PROJECT_TYPE_DESIGN_SYSTEM'
  readonly owner: string
  readonly canEdit: true
  readonly updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathInside(root: string, candidate: string): string {
  const absoluteRoot = resolve(root)
  const absolute = resolve(absoluteRoot, candidate)
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Path escapes approved root: ${candidate}`)
  }
  return absolute
}

function globPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*')
  return new RegExp(`^${escaped}$`, 'u')
}

function allowed(path: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => globPattern(pattern).test(path))
}

async function walk(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.dsh-')) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(root, path))
    else if (entry.isFile()) result.push(relative(root, path).split(sep).join('/'))
  }
  return result.sort()
}

/** Offline-compatible DesignSync implementation with explicit plan gating. */
export class DesignSyncStore {
  private readonly plans = new Map<string, DesignPlan>()

  constructor(private readonly root: string, private readonly workspace: ClaudeWorkspace) {}

  private projectDir(projectId: string): string {
    if (!/^[A-Za-z0-9-]+$/u.test(projectId)) throw new Error('Invalid projectId')
    return resolve(this.root, projectId)
  }

  private metadataPath(projectId: string): string {
    return resolve(this.projectDir(projectId), '.dsh-project.json')
  }

  private assetsPath(projectId: string): string {
    return resolve(this.projectDir(projectId), '.dsh-assets.json')
  }

  private validationPath(projectId: string): string {
    return resolve(this.projectDir(projectId), '.dsh-validation.json')
  }

  private async metadata(projectId: string): Promise<ProjectMetadata> {
    const parsed: unknown = JSON.parse(await readFile(this.metadataPath(projectId), 'utf8'))
    if (!isRecord(parsed) || typeof parsed.name !== 'string') throw new Error(`Design project ${projectId} is invalid`)
    return parsed as unknown as ProjectMetadata
  }

  /** Build the DesignSync tool body. */
  body(): ClaudeToolBody {
    return async (args, exec) => {
      const method = stringArg(args, 'method')
      await mkdir(this.root, { recursive: true })
      switch (method) {
        case 'list_projects': {
          const projects: ProjectMetadata[] = []
          for (const entry of await readdir(this.root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            try {
              projects.push(await this.metadata(entry.name))
            } catch {
              // Ignore directories not created by this backend.
            }
          }
          return projects as unknown as JsonValue
        }
        case 'create_project': {
          const projectId = randomUUID()
          const directory = this.projectDir(projectId)
          await mkdir(directory, { recursive: true })
          const metadata: ProjectMetadata = {
            projectId,
            name: stringArg(args, 'name'),
            type: 'PROJECT_TYPE_DESIGN_SYSTEM',
            owner: 'local-dsh-user',
            canEdit: true,
            updatedAt: new Date().toISOString(),
          }
          await writeFile(this.metadataPath(projectId), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
          return metadata as unknown as JsonValue
        }
        case 'get_project':
          return await this.metadata(stringArg(args, 'projectId')) as unknown as JsonValue
        case 'list_files': {
          const projectId = stringArg(args, 'projectId')
          await this.metadata(projectId)
          return await walk(this.projectDir(projectId)) as unknown as JsonValue
        }
        case 'get_file': {
          const directory = this.projectDir(stringArg(args, 'projectId'))
          const path = pathInside(directory, stringArg(args, 'path'))
          const info = await stat(path)
          if (info.size > 256 * 1024) throw new Error('Remote design file exceeds the 256 KiB limit')
          return { path: relative(directory, path).split(sep).join('/'), data: await readFile(path, 'utf8') }
        }
        case 'finalize_plan': {
          const projectId = stringArg(args, 'projectId')
          await this.metadata(projectId)
          const planId = randomUUID()
          const plan: DesignPlan = {
            projectId,
            writes: Array.isArray(args.writes) ? args.writes.filter((value): value is string => typeof value === 'string') : [],
            deletes: Array.isArray(args.deletes) ? args.deletes.filter((value): value is string => typeof value === 'string') : [],
            localDir: this.workspace.path(exec, optionalStringArg(args, 'localDir') ?? '.'),
          }
          this.plans.set(planId, plan)
          return { planId, projectId, writes: plan.writes, deletes: plan.deletes, localDir: plan.localDir }
        }
        case 'write_files': {
          const planId = stringArg(args, 'planId')
          const plan = this.plans.get(planId)
          if (plan === undefined) throw new Error('write_files requires a valid finalized planId')
          const projectId = stringArg(args, 'projectId')
          if (projectId !== plan.projectId) throw new Error('planId belongs to another project')
          const files = Array.isArray(args.files) ? args.files.filter(isRecord) : []
          for (const file of files) {
            const projectPath = stringArg(file, 'path')
            if (!allowed(projectPath, plan.writes)) throw new Error(`Path is outside the finalized write plan: ${projectPath}`)
            const destination = pathInside(this.projectDir(projectId), projectPath)
            let data: string | Uint8Array
            if (typeof file.localPath === 'string') {
              data = await readFile(pathInside(plan.localDir, file.localPath))
            } else if (typeof file.data === 'string') {
              data = file.encoding === 'base64' ? Buffer.from(file.data, 'base64') : file.data
            } else {
              throw new Error(`File ${projectPath} requires localPath or data`)
            }
            await mkdir(dirname(destination), { recursive: true })
            await writeFile(destination, data)
          }
          return { written: files.length }
        }
        case 'delete_files': {
          const plan = this.plans.get(stringArg(args, 'planId'))
          if (plan === undefined) throw new Error('delete_files requires a valid finalized planId')
          const projectId = stringArg(args, 'projectId')
          if (projectId !== plan.projectId) throw new Error('planId belongs to another project')
          const paths = Array.isArray(args.paths) ? args.paths.filter((value): value is string => typeof value === 'string') : []
          for (const path of paths) {
            if (!allowed(path, plan.deletes)) throw new Error(`Path is outside the finalized delete plan: ${path}`)
            await rm(pathInside(this.projectDir(projectId), path), { force: true })
          }
          return { deleted: paths.length }
        }
        case 'register_assets': {
          const plan = this.plans.get(stringArg(args, 'planId'))
          if (plan === undefined) throw new Error('register_assets requires a valid finalized planId')
          const projectId = stringArg(args, 'projectId')
          if (projectId !== plan.projectId) throw new Error('planId belongs to another project')
          const assets = Array.isArray(args.assets) ? args.assets.filter(isRecord) : []
          let existing: unknown = []
          try {
            existing = JSON.parse(await readFile(this.assetsPath(projectId), 'utf8'))
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          const registered = new Map<string, Record<string, unknown>>(
            (Array.isArray(existing) ? existing : [])
              .filter(isRecord)
              .filter(asset => typeof asset.path === 'string')
              .map(asset => [String(asset.path), asset]),
          )
          for (const asset of assets) {
            const path = stringArg(asset, 'path')
            if (!allowed(path, plan.writes)) throw new Error(`Asset is outside the finalized write plan: ${path}`)
            await stat(pathInside(this.projectDir(projectId), path))
            registered.set(path, structuredClone(asset))
          }
          await writeFile(this.assetsPath(projectId), `${JSON.stringify([...registered.values()], null, 2)}\n`, 'utf8')
          return { registered: assets.length }
        }
        case 'unregister_assets': {
          const plan = this.plans.get(stringArg(args, 'planId'))
          if (plan === undefined) throw new Error('unregister_assets requires a valid finalized planId')
          const projectId = stringArg(args, 'projectId')
          if (projectId !== plan.projectId) throw new Error('planId belongs to another project')
          const paths = Array.isArray(args.paths) ? args.paths.filter((value): value is string => typeof value === 'string') : []
          let existing: unknown = []
          try {
            existing = JSON.parse(await readFile(this.assetsPath(projectId), 'utf8'))
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          const pathSet = new Set(paths)
          const remaining = (Array.isArray(existing) ? existing : [])
            .filter(isRecord)
            .filter(asset => typeof asset.path !== 'string' || !pathSet.has(asset.path))
          await writeFile(this.assetsPath(projectId), `${JSON.stringify(remaining, null, 2)}\n`, 'utf8')
          return { unregistered: paths.length }
        }
        case 'report_validate': {
          const projectId = stringArg(args, 'projectId')
          await this.metadata(projectId)
          const counts = isRecord(args.counts) ? structuredClone(args.counts) as JsonValue : null
          await writeFile(this.validationPath(projectId), `${JSON.stringify({ counts, reportedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
          return { accepted: true, counts }
        }
        default:
          throw new Error(`Unsupported DesignSync method: ${method}`)
      }
    }
  }
}
