/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: mrrow,, */

import {
    StreamingServiceURL,
    type MusicEntityType,
    type StreamingServiceUrlBuildOptions,
    type StreamingServiceUrlTracking,
} from "../StreamingService";
import { StreamingDebug } from "../debug";

const PATH_TYPE_MAP: Record<string, MusicEntityType> = {
    track: "song",
    album: "album",
    artist: "artist",
    playlist: "playlist",
};

interface SpotifyUrlConstructorParams extends StreamingServiceUrlBuildOptions {
    type: MusicEntityType;
    id: string;
}

export interface SpotifyUrlBuildOptions extends StreamingServiceUrlBuildOptions { }

export class SpotifyURL extends StreamingServiceURL<string> {
    public readonly id: string;

    constructor(params: SpotifyUrlConstructorParams) {
        super(params.type, {
            originalUrl: params.originalUrl,
            tracking: params.tracking,
        });
        this.id = params.id;
    }

    get primaryId(): string {
        return this.id;
    }

    get cleanURL(): URL {
        const typeSegment = SpotifyURL.toPathSegment(this.type);
        const built = new URL(`https://open.spotify.com/${typeSegment}/${this.id}`);
        StreamingDebug.log("SpotifyURL", "cleanURL", "success", {
            meta: {
                id: this.id,
                type: this.type,
                hasTracking: Boolean(this.tracking),
            },
        });
        return built;
    }

    private static toPathSegment(type: MusicEntityType): keyof typeof PATH_TYPE_MAP {
        if (type === "song") {
            return "track";
        }
        if (type === "album" || type === "artist" || type === "playlist") {
            return type;
        }
        throw new Error(`Unsupported Spotify type: ${type}`);
    }

    private static normalizeUrl(input: string | URL): URL {
        const url = input instanceof URL ? input : new URL(input);
        if (!url.hostname.includes("spotify.com")) {
            throw new Error("Unsupported Spotify URL");
        }
        return url;
    }

    static fromString(url: string): SpotifyURL {
        const scope = StreamingDebug.scope("SpotifyURL", "fromString", { url });
        try {
            const result = SpotifyURL.fromURL(SpotifyURL.normalizeUrl(url));
            scope.success({ type: result.type });
            return result;
        } catch (error) {
            scope.error(error, { url });
            throw error;
        }
    }

    static fromURL(url: URL): SpotifyURL {
        const scope = StreamingDebug.scope("SpotifyURL", "fromURL", { url: url.toString() });
        try {
            const normalized = SpotifyURL.normalizeUrl(url);
            const segments = normalized.pathname
                .split("/")
                .filter(Boolean)
                .filter((segment) => !segment.startsWith("intl-"));
            if (segments.length < 2) {
                throw new Error("Incomplete Spotify URL");
            }
            const [rawType, rawId] = segments.slice(-2);
            const type = PATH_TYPE_MAP[rawType];
            if (!type) {
                throw new Error(`Unsupported Spotify entity type: ${rawType}`);
            }
            const result = new SpotifyURL({
                type,
                id: rawId,
                tracking: buildTrackingMap(normalized.searchParams),
                originalUrl: url.toString(),
            });
            scope.success({ type, id: rawId });
            return result;
        } catch (error) {
            scope.error(error, { url: url.toString() });
            throw error;
        }
    }

    static fromId(id: string, type: MusicEntityType, options: SpotifyUrlBuildOptions = {}): SpotifyURL {
        const scope = StreamingDebug.scope("SpotifyURL", "fromId", { id, type });
        try {
            SpotifyURL.toPathSegment(type);
            const result = new SpotifyURL({
                id,
                type,
                originalUrl: options.originalUrl,
                tracking: options.tracking,
            });
            scope.success({ hasTracking: Boolean(options.tracking && Object.keys(options.tracking).length) });
            return result;
        } catch (error) {
            scope.error(error, { id, type });
            throw error;
        }
    }
}

function buildTrackingMap(params: URLSearchParams): StreamingServiceUrlTracking | undefined {
    const record: StreamingServiceUrlTracking = {};
    const uniqueKeys = new Set<string>();
    params.forEach((_, key) => uniqueKeys.add(key));
    for (const key of uniqueKeys) {
        const values = params.getAll(key);
        if (values.length === 0) {
            continue;
        }
        record[key] = values.length === 1 ? values[0] : values;
    }
    const tracking = Object.keys(record).length > 0 ? record : undefined;
    if (tracking) {
        StreamingDebug.log("SpotifyURL", "tracking", "info", {
            meta: {
                keys: Object.keys(tracking),
            },
        });
    }
    return tracking;
}
