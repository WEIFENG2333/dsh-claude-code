/** Claude.ai remote-trigger access without exposing the OAuth token to the model or shell. */
import { type ClaudeToolBody } from './runtime.ts';
/** Build the account-scoped RemoteTrigger tool over Claude Code's local OAuth file. */
export declare function remoteTriggerBody(configDir: string): ClaudeToolBody;
//# sourceMappingURL=remote-trigger.d.ts.map