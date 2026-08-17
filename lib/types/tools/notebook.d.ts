/** Claude-compatible Jupyter notebook cell editing over DSH read/write tools. */
import type { Context } from '@deepseek-ai/cordis';
import { type ClaudeToolBody } from './runtime.ts';
import type { ClaudeWorkspace } from './workspace.ts';
/** Create the NotebookEdit body. */
export declare function notebookToolBodies(ctx: Context, workspace: ClaudeWorkspace): Record<string, ClaudeToolBody>;
//# sourceMappingURL=notebook.d.ts.map