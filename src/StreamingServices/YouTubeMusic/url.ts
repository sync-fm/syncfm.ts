import {
    StreamingServiceURL,
    type MusicEntityType,
    type StreamingServiceUrlBuildOptions,
    type StreamingServiceUrlTracking,
} from "../StreamingService";
import { StreamingDebug } from "../debug";

const HOST_ALLOWLIST = ["music.youtube.com", "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"];

interface YouTubeMusicUrlParams extends StreamingServiceUrlBuildOptions {
    type: MusicEntityType;
    id: string;
}

export interface YouTubeMusicUrlBuildOptions extends StreamingServiceUrlBuildOptions { }

const AUTO_ALBUM_PREFIXES = ["OLAK5", "RDCLAK", "RDAMPLAK5"];

export class YouTubeMusicURL extends StreamingServiceURL<string> {
    public readonly id: string;

    constructor(params: YouTubeMusicUrlParams) {
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
        switch (this.type) {
            case "song":
                return logAndReturn(this.id, this.type, new URL(`https://music.youtube.com/watch?v=${this.id}`));
            case "artist":
                return logAndReturn(this.id, this.type, new URL(`https://music.youtube.com/channel/${this.id}`));
            case "album":
                if (AUTO_ALBUM_PREFIXES.some((prefix) => this.id.startsWith(prefix))) {
                    return logAndReturn(this.id, this.type, new URL(`https://music.youtube.com/playlist?list=${this.id}`));
                }
                return logAndReturn(this.id, this.type, new URL(`https://music.youtube.com/browse/${this.id}`));
            case "playlist":
                return logAndReturn(this.id, this.type, new URL(`https://music.youtube.com/playlist?list=${this.id}`));
            default:
                throw new Error(`Unsupported YouTube Music type: ${this.type}`);
        }
    }

    private static assertHost(url: URL): void {
        if (!HOST_ALLOWLIST.includes(url.hostname)) {
            throw new Error("Unsupported YouTube Music URL");
        }
    }

    private static parseListType(listId: string | null): MusicEntityType {
        if (!listId) {
            return "playlist";
        }
        if (AUTO_ALBUM_PREFIXES.some((prefix) => listId.startsWith(prefix))) {
            return "album";
        }
        return "playlist";
    }

    private static extractBrowseType(id: string): MusicEntityType {
        if (id.startsWith("MPREb_")) {
            return "album";
        }
        if (id.startsWith("UC")) {
            return "artist";
        }
        if (id.startsWith("VL")) {
            return "playlist";
        }
        return "album";
    }

    static fromString(raw: string): YouTubeMusicURL {
        const scope = StreamingDebug.scope("YouTubeMusicURL", "fromString", { raw });
        try {
            const result = YouTubeMusicURL.fromURL(new URL(raw));
            scope.success({ type: result.type });
            return result;
        } catch (error) {
            scope.error(error, { raw });
            throw error;
        }
    }

    static fromURL(url: URL): YouTubeMusicURL {
        const scope = StreamingDebug.scope("YouTubeMusicURL", "fromURL", { url: url.toString() });
        try {
            YouTubeMusicURL.assertHost(url);
            const originalUrl = url.toString();

            if (url.hostname === "youtu.be") {
                const id = url.pathname.replace(/^\//, "").trim();
                if (!id) {
                    throw new Error("Invalid YouTube short URL");
                }
                const result = new YouTubeMusicURL({
                    type: "song",
                    id,
                    tracking: buildTrackingMap(url.searchParams),
                    originalUrl,
                });
                scope.success({ type: result.type, short: true });
                return result;
            }

            const pathname = url.pathname;
            const params = url.searchParams;

            if (pathname === "/watch" || params.has("v")) {
                const id = params.get("v");
                if (!id) {
                    throw new Error("Missing video id");
                }
                const result = new YouTubeMusicURL({
                    type: "song",
                    id,
                    tracking: buildTrackingMap(params, ["v"]),
                    originalUrl,
                });
                scope.success({ type: "song" });
                return result;
            }

            if (pathname === "/playlist" || params.has("list")) {
                const listId = params.get("list");
                if (!listId) {
                    throw new Error("Missing playlist id");
                }
                const type = YouTubeMusicURL.parseListType(listId);
                const result = new YouTubeMusicURL({
                    type,
                    id: listId,
                    tracking: buildTrackingMap(params, ["list"]),
                    originalUrl,
                });
                scope.success({ type, listId });
                return result;
            }

            if (pathname.startsWith("/browse/")) {
                const id = pathname.split("/").filter(Boolean).pop();
                if (!id) {
                    throw new Error("Missing browse id");
                }
                const type = YouTubeMusicURL.extractBrowseType(id);
                const result = new YouTubeMusicURL({ type, id, originalUrl });
                scope.success({ type, id });
                return result;
            }

            if (pathname.startsWith("/channel/")) {
                const id = pathname.split("/").filter(Boolean).pop();
                if (!id) {
                    throw new Error("Missing channel id");
                }
                const result = new YouTubeMusicURL({ type: "artist", id, originalUrl });
                scope.success({ type: "artist", id });
                return result;
            }

            throw new Error("Unsupported YouTube Music URL format");
        } catch (error) {
            scope.error(error, { url: url.toString() });
            throw error;
        }
    }

    static fromId(id: string, type: MusicEntityType, options: YouTubeMusicUrlBuildOptions = {}): YouTubeMusicURL {
        const scope = StreamingDebug.scope("YouTubeMusicURL", "fromId", { id, type });
        try {
            const result = new YouTubeMusicURL({
                id,
                type,
                tracking: options.tracking,
                originalUrl: options.originalUrl,
            });
            scope.success({ hasTracking: Boolean(options.tracking && Object.keys(options.tracking).length) });
            return result;
        } catch (error) {
            scope.error(error, { id, type });
            throw error;
        }
    }
}

function buildTrackingMap(
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
    const tracking = Object.keys(record).length > 0 ? record : undefined;
    if (tracking) {
        StreamingDebug.log("YouTubeMusicURL", "tracking", "info", {
            meta: {
                keys: Object.keys(tracking),
                omitted: omitKeys,
            },
        });
    }
    return tracking;
}

function logAndReturn(id: string, type: MusicEntityType, url: URL): URL {
    StreamingDebug.log("YouTubeMusicURL", "cleanURL", "success", {
        meta: { id, type, url: url.toString() },
    });
    return url;
}
