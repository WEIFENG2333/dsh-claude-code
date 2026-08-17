/** Five-field local-time cron parsing shared by the Claude scheduling tools. */
interface CronFields {
    readonly minute: number[];
    readonly hour: number[];
    readonly dayOfMonth: number[];
    readonly month: number[];
    readonly dayOfWeek: number[];
}
/** Parse Claude Code's supported standard five-field cron subset. */
export declare function parseCron(expression: string): CronFields | undefined;
/** Find the next matching local wall-clock minute, strictly after the supplied instant. */
export declare function nextCronRun(expression: string, from: Date): Date | undefined;
/** Render the same common cron patterns Claude Code makes human-readable. */
export declare function humanCron(expression: string): string;
export {};
//# sourceMappingURL=cron.d.ts.map