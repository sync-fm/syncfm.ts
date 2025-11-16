import type { StreamingServiceUrlTracking } from "./StreamingService";

export function buildTrackingMap(
    params: URLSearchParams,
    omitKeys: string[] = [],
): StreamingServiceUrlTracking | undefined {
    const omitSet = new Set(omitKeys.map((key) => key.toLowerCase()));
    const record: StreamingServiceUrlTracking = {};
    const uniqueKeys = new Set<string>();
    // biome-ignore lint/suspicious/useIterableCallbackReturn: ssbbb
    params.forEach((_, key) => uniqueKeys.add(key));
    for (const key of uniqueKeys) {
        if (omitSet.has(key.toLowerCase())) {
            continue;
        }
        const values = params.getAll(key);
        if (values.length === 0) {
            continue;
        }
        record[key] = values.length === 1 ? values[0] : values;
    }
    return Object.keys(record).length > 0 ? record : undefined;
}
