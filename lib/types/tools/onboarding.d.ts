/** Local, shareable-by-filesystem fallback for Claude's hosted onboarding guides. */
import { type ClaudeToolBody } from './runtime.ts';
import type { ClaudeWorkspace } from './workspace.ts';
/** Persist onboarding content without pretending to own Claude's organization service. */
export declare class LocalOnboardingGuides {
    private readonly root;
    private readonly workspace;
    constructor(root: string, workspace: ClaudeWorkspace);
    private guidePath;
    private latestCode;
    /** Execute one ShareOnboardingGuide method against the local fallback store. */
    run(args: Readonly<Record<string, unknown>>, exec: Parameters<ClaudeToolBody>[1]): Promise<string>;
}
//# sourceMappingURL=onboarding.d.ts.map