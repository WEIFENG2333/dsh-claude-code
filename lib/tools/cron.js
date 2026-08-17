/** Five-field local-time cron parsing shared by the Claude scheduling tools. */
const FIELD_RANGES = [
    { min: 0, max: 59 },
    { min: 0, max: 23 },
    { min: 1, max: 31 },
    { min: 1, max: 12 },
    { min: 0, max: 6 },
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function expandField(field, range) {
    const output = new Set();
    for (const part of field.split(',')) {
        const wildcard = /^\*(?:\/(\d+))?$/u.exec(part);
        if (wildcard !== null) {
            const step = wildcard[1] === undefined ? 1 : Number.parseInt(wildcard[1], 10);
            if (step < 1)
                return undefined;
            for (let value = range.min; value <= range.max; value += step)
                output.add(value);
            continue;
        }
        const span = /^(\d+)-(\d+)(?:\/(\d+))?$/u.exec(part);
        if (span !== null) {
            const lower = Number.parseInt(span[1] ?? '', 10);
            const upper = Number.parseInt(span[2] ?? '', 10);
            const step = span[3] === undefined ? 1 : Number.parseInt(span[3], 10);
            const dayOfWeek = range.min === 0 && range.max === 6;
            const maximum = dayOfWeek ? 7 : range.max;
            if (lower > upper || step < 1 || lower < range.min || upper > maximum)
                return undefined;
            for (let value = lower; value <= upper; value += step)
                output.add(dayOfWeek && value === 7 ? 0 : value);
            continue;
        }
        if (/^\d+$/u.test(part)) {
            let value = Number.parseInt(part, 10);
            if (range.min === 0 && range.max === 6 && value === 7)
                value = 0;
            if (value < range.min || value > range.max)
                return undefined;
            output.add(value);
            continue;
        }
        return undefined;
    }
    return output.size === 0 ? undefined : [...output].sort((left, right) => left - right);
}
/** Parse Claude Code's supported standard five-field cron subset. */
export function parseCron(expression) {
    const parts = expression.trim().split(/\s+/u);
    if (parts.length !== 5)
        return undefined;
    const expanded = parts.map((field, index) => {
        const range = FIELD_RANGES[index];
        return range === undefined ? undefined : expandField(field, range);
    });
    if (expanded.some(field => field === undefined))
        return undefined;
    return {
        minute: expanded[0] ?? [],
        hour: expanded[1] ?? [],
        dayOfMonth: expanded[2] ?? [],
        month: expanded[3] ?? [],
        dayOfWeek: expanded[4] ?? [],
    };
}
/** Find the next matching local wall-clock minute, strictly after the supplied instant. */
export function nextCronRun(expression, from) {
    const fields = parseCron(expression);
    if (fields === undefined)
        return undefined;
    const minute = new Set(fields.minute);
    const hour = new Set(fields.hour);
    const dayOfMonth = new Set(fields.dayOfMonth);
    const month = new Set(fields.month);
    const dayOfWeek = new Set(fields.dayOfWeek);
    const dayOfMonthWildcard = fields.dayOfMonth.length === 31;
    const dayOfWeekWildcard = fields.dayOfWeek.length === 7;
    const candidate = new Date(from.getTime());
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);
    for (let iteration = 0; iteration < 366 * 24 * 60; iteration += 1) {
        if (!month.has(candidate.getMonth() + 1)) {
            candidate.setMonth(candidate.getMonth() + 1, 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }
        const monthDayMatches = dayOfMonth.has(candidate.getDate());
        const weekDayMatches = dayOfWeek.has(candidate.getDay());
        const dayMatches = dayOfMonthWildcard && dayOfWeekWildcard
            ? true
            : dayOfMonthWildcard
                ? weekDayMatches
                : dayOfWeekWildcard
                    ? monthDayMatches
                    : monthDayMatches || weekDayMatches;
        if (!dayMatches) {
            candidate.setDate(candidate.getDate() + 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }
        if (!hour.has(candidate.getHours())) {
            candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
            continue;
        }
        if (!minute.has(candidate.getMinutes())) {
            candidate.setMinutes(candidate.getMinutes() + 1);
            continue;
        }
        return candidate;
    }
    return undefined;
}
function localTime(minute, hour) {
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
}
/** Render the same common cron patterns Claude Code makes human-readable. */
export function humanCron(expression) {
    const parts = expression.trim().split(/\s+/u);
    if (parts.length !== 5)
        return expression;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const everyMinute = /^\*\/(\d+)$/u.exec(minute ?? '');
    if (everyMinute !== null && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const interval = Number.parseInt(everyMinute[1] ?? '', 10);
        return interval === 1 ? 'Every minute' : `Every ${interval} minutes`;
    }
    if (/^\d+$/u.test(minute ?? '') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const value = Number.parseInt(minute ?? '', 10);
        return value === 0 ? 'Every hour' : `Every hour at :${String(value).padStart(2, '0')}`;
    }
    const everyHour = /^\*\/(\d+)$/u.exec(hour ?? '');
    if (/^\d+$/u.test(minute ?? '') && everyHour !== null && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const interval = Number.parseInt(everyHour[1] ?? '', 10);
        const value = Number.parseInt(minute ?? '', 10);
        const suffix = value === 0 ? '' : ` at :${String(value).padStart(2, '0')}`;
        return interval === 1 ? `Every hour${suffix}` : `Every ${interval} hours${suffix}`;
    }
    if (!/^\d+$/u.test(minute ?? '') || !/^\d+$/u.test(hour ?? ''))
        return expression;
    const value = Number.parseInt(minute ?? '', 10);
    const hourValue = Number.parseInt(hour ?? '', 10);
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return `Every day at ${localTime(value, hourValue)}`;
    }
    if (dayOfMonth === '*' && month === '*' && /^\d$/u.test(dayOfWeek ?? '')) {
        const day = DAY_NAMES[Number.parseInt(dayOfWeek ?? '', 10) % 7];
        if (day !== undefined)
            return `Every ${day} at ${localTime(value, hourValue)}`;
    }
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
        return `Weekdays at ${localTime(value, hourValue)}`;
    }
    return expression;
}
//# sourceMappingURL=cron.js.map