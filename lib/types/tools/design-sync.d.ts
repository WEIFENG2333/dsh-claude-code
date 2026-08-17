/** Local design-system backend implementing the captured DesignSync method protocol. */
import { type ClaudeToolBody } from './runtime.ts';
import type { ClaudeWorkspace } from './workspace.ts';
/** Offline-compatible DesignSync implementation with explicit plan gating. */
export declare class DesignSyncStore {
    private readonly root;
    private readonly workspace;
    private readonly plans;
    constructor(root: string, workspace: ClaudeWorkspace);
    private projectDir;
    private metadataPath;
    private assetsPath;
    private validationPath;
    private metadata;
    /** Build the DesignSync tool body. */
    body(): ClaudeToolBody;
}
//# sourceMappingURL=design-sync.d.ts.map