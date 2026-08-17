/** Claude-compatible subagent, scheduling, monitoring, and notification tools. */
import type { Context } from '@deepseek-ai/cordis';
import type { ClaudeBackgroundTasks } from './background.ts';
import type { LocalOnboardingGuides } from './onboarding.ts';
import type { ClaudeWorkspace } from './workspace.ts';
import { type ClaudeToolBody } from './runtime.ts';
/** Stateful coordination bodies, isolated by DSH session id. */
export declare class CoordinationTools {
    private readonly background;
    private readonly workspace;
    private readonly onboarding;
    private readonly crons;
    private readonly wakeups;
    private context;
    /** Build coordination tools over one shared Claude task projection. */
    constructor(background: ClaudeBackgroundTasks, workspace: ClaudeWorkspace, onboarding: LocalOnboardingGuides);
    private cronList;
    private deleteCron;
    private fireCron;
    private armCron;
    private scheduleCron;
    private disposeSchedules;
    /** Create tool bodies over the DSH subagent, job, and schedule capabilities. */
    bodies(ctx: Context): Record<string, ClaudeToolBody>;
}
//# sourceMappingURL=coordination.d.ts.map