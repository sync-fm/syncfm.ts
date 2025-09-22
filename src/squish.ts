import { SyncFMAlbum, SyncFMArtist, SyncFMSong } from './types/syncfm';

// Define the strategies for merging a field
export type MergeStrategy =
    | 'overwrite'                 // Always use the new value.
    | 'keep_existing'             // Keep the original value if it exists.
    | 'prefer_new'                // Use new value if it's not null/undefined, otherwise keep existing.
    | 'merge_objects'             // Combine properties of two objects, new properties overwrite existing ones.
    | 'combine_unique_primitives' // Combine arrays of primitives (string, number) and remove duplicates.
    | 'combine_unique_objects'    // Combine arrays of objects, ensuring uniqueness based on a key.
    | 'custom';                   // Use a custom function for complex logic.

// Define the configuration for a single field
export interface FieldMergeConfig {
    strategy: MergeStrategy;
    uniqueKey?: string;
    customMerge?: (existingVal: any, newVal: any) => any;
}

// Define the overall merge configuration for an entity
export type MergeConfig<T> = {
    [K in keyof T]?: FieldMergeConfig;
};

/**
 * Merges two objects based on a provided configuration.
 */
export function mergeData<T extends object>(existing: T, newData: Partial<T>, config: MergeConfig<T>): T {
    const merged = { ...existing };

    for (const key in newData) {
        const fieldConfig = config[key as keyof T];
        const existingValue = merged[key as keyof T];
        const newValue = newData[key as keyof T];

        if (!fieldConfig || newValue === undefined) continue;

        switch (fieldConfig.strategy) {
            case 'overwrite':
                merged[key as keyof T] = newValue as any;
                break;

            case 'keep_existing':
                if (existingValue === null || existingValue === undefined) {
                    merged[key as keyof T] = newValue as any;
                }
                break;

            case 'prefer_new':
                if (newValue !== null && newValue !== undefined) {
                    merged[key as keyof T] = newValue as any;
                }
                break;

            case 'merge_objects':
                if (typeof existingValue === 'object' && typeof newValue === 'object' && existingValue !== null && newValue !== null && !Array.isArray(existingValue) && !Array.isArray(newValue)) {
                    merged[key as keyof T] = { ...existingValue, ...newValue } as any;
                } else {
                    merged[key as keyof T] = newValue as any; // Overwrite if not objects
                }
                break;

            case 'combine_unique_primitives':
                if (Array.isArray(existingValue) && Array.isArray(newValue)) {
                    merged[key as keyof T] = Array.from(new Set([...existingValue, ...newValue])) as any;
                } else {
                    merged[key as keyof T] = newValue as any;
                }
                break;

            case 'combine_unique_objects':
                if (Array.isArray(existingValue) && Array.isArray(newValue) && fieldConfig.uniqueKey) {
                    const uniqueKey = fieldConfig.uniqueKey as keyof any;
                    const combinedMap = new Map();
                    [...existingValue, ...newValue].forEach(item => {
                        if (item && typeof item === 'object' && item[uniqueKey]) {
                            combinedMap.set(item[uniqueKey], item);
                        }
                    });
                    merged[key as keyof T] = Array.from(combinedMap.values()) as any;
                } else {
                    merged[key as keyof T] = newValue as any;
                }
                break;

            case 'custom':
                if (fieldConfig.customMerge) {
                    merged[key as keyof T] = fieldConfig.customMerge(existingValue, newValue);
                }
                break;

            default:
                merged[key as keyof T] = newValue as any;
                break;
        }
    }
    return merged;
}


// merge rule for imageUrl fiels as google apparently has ass ratelimits on the ones from ytm - becuase fuck you ig
const imageUrlMerge = (existingUrl?: string, newUrl?: string): string | undefined => {
    if (!existingUrl) return newUrl;
    if (!newUrl) return existingUrl;
    const isExistingGoogle = existingUrl.includes('googleusercontent.com');
    const isNewGoogle = newUrl.includes('googleusercontent.com');
    if (isExistingGoogle && !isNewGoogle) return newUrl;
    if (!isExistingGoogle && isNewGoogle) return existingUrl;
    return newUrl;
};

export const songMergeConfig: MergeConfig<SyncFMSong> = {
    title: { strategy: 'keep_existing' },
    artists: { strategy: 'combine_unique_primitives' },
    album: { strategy: 'keep_existing' },
    releaseDate: { strategy: 'keep_existing' },
    imageUrl: { strategy: 'custom', customMerge: imageUrlMerge },
    externalIds: { strategy: 'merge_objects' },
    previouslyFailedServices: { strategy: 'combine_unique_primitives' },
    explicit: { strategy: 'prefer_new' }
};

export const artistMergeConfig: MergeConfig<SyncFMArtist> = {
    name: { strategy: 'keep_existing' },
    imageUrl: { strategy: 'custom', customMerge: imageUrlMerge },
    externalIds: { strategy: 'merge_objects' },
    tracks: { strategy: 'combine_unique_objects', uniqueKey: 'syncId' },
    albums: { strategy: 'combine_unique_objects', uniqueKey: 'syncId' },
    previouslyFailedServices: { strategy: 'combine_unique_primitives' },
};

export const albumMergeConfig: MergeConfig<SyncFMAlbum> = {
    title: { strategy: 'keep_existing' },
    artists: { strategy: 'combine_unique_primitives' },
    releaseDate: { strategy: 'keep_existing' },
    imageUrl: { strategy: 'custom', customMerge: imageUrlMerge },
    externalIds: { strategy: 'merge_objects' },
    songs: { strategy: 'combine_unique_objects', uniqueKey: 'syncId' },
    previouslyFailedServices: { strategy: 'combine_unique_primitives' },
};