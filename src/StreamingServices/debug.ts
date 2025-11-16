import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";

export type StreamingDebugPhase =
    | "start"
    | "success"
    | "error"
    | "cache-hit"
    | "cache-miss"
    | "fallback"
    | "info";

export type StreamingDebugContext = Record<string, unknown>;

interface StreamingDebugRecord {
    runId: string;
    timestamp: string;
    service: string;
    operation: string;
    phase: string;
    durationMs?: number;
    message?: string;
    meta?: StreamingDebugContext;
}

const LOG_ROOT = path.join(process.cwd(), "debug-logs", "streaming-services");
const SERVICE_DIR = path.join(LOG_ROOT, "services");
const OPERATION_DIR = path.join(LOG_ROOT, "operations");
const TIMELINE_FILE = path.join(LOG_ROOT, "timeline.log");
const DIRECTORY_PROMISE = ensureLogDirectories();
const runIdStore = new AsyncLocalStorage<string>();
const PROCESS_RUN_ID = createRunId();

export class StreamingDebugScope {
    private readonly startedAt = performance.now();
    private readonly context: StreamingDebugContext | undefined;
    private readonly service: string;
    private readonly operation: string;

    constructor(service: string, operation: string, context?: StreamingDebugContext) {
        this.service = service;
        this.operation = operation;
        this.context = context;
        StreamingDebug.log(this.service, this.operation, "start", {
            meta: this.context,
        });
    }

    event(phase: StreamingDebugPhase | string, meta?: StreamingDebugContext): void {
        StreamingDebug.log(this.service, this.operation, phase, {
            meta,
            durationMs: this.elapsedMs,
        });
    }

    success(meta?: StreamingDebugContext): void {
        StreamingDebug.log(this.service, this.operation, "success", {
            meta,
            durationMs: this.elapsedMs,
        });
    }

    error(error: unknown, meta?: StreamingDebugContext): void {
        StreamingDebug.log(this.service, this.operation, "error", {
            meta: {
                ...meta,
                error,
            },
            durationMs: this.elapsedMs,
        });
    }

    private get elapsedMs(): number {
        return performance.now() - this.startedAt;
    }
}


const streamingDebugState = {
    enabled: true,
};

export const StreamingDebug = {
    get isEnabled(): boolean {
        return streamingDebugState.enabled;
    },

    setEnabled(value: boolean): void {
        streamingDebugState.enabled = value;
    },

    scope(service: string, operation: string, context?: StreamingDebugContext): StreamingDebugScope {
        return new StreamingDebugScope(service, operation, context);
    },

    withRunId<T>(runId: string, task: () => Promise<T>): Promise<T> {
        return runIdStore.run(runId, task);
    },

    generateRunId(): string {
        return createRunId();
    },

    log(
        service: string,
        operation: string,
        phase: StreamingDebugPhase | string,
        options: {
            meta?: StreamingDebugContext;
            durationMs?: number;
            message?: string;
            runId?: string;
        } = {},
    ): void {
        if (!streamingDebugState.enabled) {
            return;
        }
        const record: StreamingDebugRecord = {
            runId: resolveRunId(options.runId),
            timestamp: new Date().toISOString(),
            service,
            operation,
            phase,
            durationMs: options.durationMs,
            message: options.message,
            meta: normalizeMeta(options.meta),
        };
        const consolePayload = {
            ...record,
            meta: truncateForConsole(record.meta),
        };
        const prefix = `[StreamingDebug][${service}][${operation}][${phase}]`;
        if (phase === "error") {
            console.error(prefix, consolePayload);
        } else {
            console.debug(prefix, consolePayload);
        }
        void writeRecord(record);
    },
} as const;

async function writeRecord(record: StreamingDebugRecord): Promise<void> {
    try {
        await DIRECTORY_PROMISE;
        const payload = `${JSON.stringify(record)}\n`;
        const perServiceFile = path.join(SERVICE_DIR, `${sanitize(record.service)}.log`);
        const perOperationFile = path.join(
            OPERATION_DIR,
            `${sanitize(record.service)}__${sanitize(record.operation)}.log`,
        );
        await Promise.allSettled([
            appendFile(TIMELINE_FILE, payload),
            appendFile(perServiceFile, payload),
            appendFile(perOperationFile, payload),
        ]);
    } catch (error) {
        console.warn("[StreamingDebug] Failed to write log record", error);
    }
}

function createRunId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRunId(override?: string): string {
    return override ?? runIdStore.getStore() ?? PROCESS_RUN_ID;
}

async function ensureLogDirectories(): Promise<void> {
    await Promise.all([
        mkdir(LOG_ROOT, { recursive: true }),
        mkdir(SERVICE_DIR, { recursive: true }),
        mkdir(OPERATION_DIR, { recursive: true }),
    ]);
}

function sanitize(segment: string): string {
    return segment
        .replace(/[^a-z0-9-_]/gi, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase() || "general";
}

function normalizeMeta(meta?: StreamingDebugContext): StreamingDebugContext | undefined {
    if (!meta) {
        return undefined;
    }
    return deepClone(meta);
}

function deepClone<T>(value: T, depth = 0): T {
    if (depth > 4) {
        return "[Truncated]" as T;
    }
    if (value === null || typeof value === "undefined") {
        return value;
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        } as T;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 25).map((item) => deepClone(item, depth + 1)) as T;
    }
    if (typeof value === "bigint") {
        return value.toString() as T;
    }
    if (typeof value === "function") {
        return `[Function ${value.name || "anonymous"}]` as T;
    }
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            result[key] = deepClone(val, depth + 1);
        }
        return result as T;
    }
    return value;
}

function truncateForConsole(meta?: StreamingDebugContext): StreamingDebugContext | undefined {
    if (!meta) {
        return undefined;
    }
    const entries = Object.entries(meta);
    if (entries.length <= 10) {
        return meta;
    }
    const truncated = Object.fromEntries(entries.slice(0, 10));
    return {
        ...truncated,
        __truncatedKeys: entries.length - 10,
    };
}
