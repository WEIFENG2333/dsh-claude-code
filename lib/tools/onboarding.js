/** Local, shareable-by-filesystem fallback for Claude's hosted onboarding guides. */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { optionalStringArg, stringArg } from "./runtime.js";
async function existingFile(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
function validCode(code) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(code))
        throw new Error('Invalid onboarding guide short_code');
    return code;
}
/** Persist onboarding content without pretending to own Claude's organization service. */
export class LocalOnboardingGuides {
    root;
    workspace;
    constructor(root, workspace) {
        this.root = root;
        this.workspace = workspace;
    }
    guidePath(code) {
        return resolve(this.root, `${validCode(code)}.md`);
    }
    async latestCode() {
        const candidates = [];
        for (const entry of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
            if (!entry.isFile() || !entry.name.endsWith('.md'))
                continue;
            const code = entry.name.slice(0, -3);
            if (!/^[A-Za-z0-9_-]{1,64}$/u.test(code))
                continue;
            candidates.push({ code, modified: (await stat(resolve(this.root, entry.name))).mtimeMs });
        }
        candidates.sort((left, right) => right.modified - left.modified);
        return candidates[0]?.code;
    }
    /** Execute one ShareOnboardingGuide method against the local fallback store. */
    async run(args, exec) {
        const mode = stringArg(args, 'mode');
        const requestedCode = optionalStringArg(args, 'short_code');
        await mkdir(this.root, { recursive: true });
        if (mode === 'delete') {
            if (requestedCode === undefined)
                throw new Error('delete requires short_code');
            const code = validCode(requestedCode);
            if (await existingFile(this.guidePath(code)) === undefined)
                throw new Error(`No onboarding guide with short_code '${code}'`);
            await rm(this.guidePath(code));
            return `Deleted local onboarding guide ${code}.`;
        }
        const sourcePath = this.workspace.path(exec, 'ONBOARDING.md');
        const source = await existingFile(sourcePath);
        if (mode === 'create') {
            if (source === undefined)
                throw new Error(`No ONBOARDING.md found at ${sourcePath}`);
            const code = randomBytes(4).toString('hex');
            const destination = this.guidePath(code);
            await writeFile(destination, source, 'utf8');
            return `Created local onboarding guide ${code}: ${destination}`;
        }
        if (mode === 'update') {
            if (requestedCode === undefined)
                throw new Error('update requires short_code');
            if (source === undefined)
                throw new Error(`No ONBOARDING.md found at ${sourcePath}`);
            const code = validCode(requestedCode);
            if (await existingFile(this.guidePath(code)) === undefined)
                throw new Error(`No onboarding guide with short_code '${code}'`);
            await writeFile(this.guidePath(code), source, 'utf8');
            return `Updated local onboarding guide ${code}: ${this.guidePath(code)}`;
        }
        if (mode !== 'check')
            throw new Error(`Unsupported onboarding guide mode: ${mode}`);
        const code = requestedCode === undefined ? await this.latestCode() : validCode(requestedCode);
        if (source !== undefined) {
            const target = code ?? randomBytes(4).toString('hex');
            await writeFile(this.guidePath(target), source, 'utf8');
            return `Updated local onboarding guide ${target}: ${this.guidePath(target)}`;
        }
        if (code === undefined || await existingFile(this.guidePath(code)) === undefined) {
            throw new Error(`No ONBOARDING.md found at ${sourcePath} and no local guide exists`);
        }
        return `Existing local onboarding guide ${code}: ${this.guidePath(code)}`;
    }
}
//# sourceMappingURL=onboarding.js.map