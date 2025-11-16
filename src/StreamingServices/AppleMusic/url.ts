/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: mrrow,, */
import { z } from "zod";
import { Region } from "@syncfm/applemusic-api";
import {
    StreamingServiceURL,
    type MusicEntityType,
    type StreamingServiceUrlBuildOptions,
    type StreamingServiceUrlTracking,
    type StreamingServiceUrlJSON,
} from "../StreamingService";
import { StreamingDebug } from "../debug";

type RegionOrCode = `${Region}` | Region;
export interface AppleMusicURLConstructorParams {
    type: MusicEntityType;
    id: string;
    storefront: RegionOrCode
    snake: string;
    songInAlbum?: string;
    originalUrl?: string;
    tracking?: StreamingServiceUrlTracking;
    albumContextId?: string;
}

export interface AppleMusicURLId {
    main: string;
    songInAlbum?: string;
}

export interface AppleMusicUrlBuildOptions extends StreamingServiceUrlBuildOptions<string | undefined> {
    storefront?: RegionOrCode;
    snake?: string;
    songInAlbum?: string;
    albumContextId?: string;
    originalUrl?: string;
    tracking?: StreamingServiceUrlTracking;
}

const AppleMusicConstructorParamsSchema = z.object({
    type: z.enum(["song", "album", "artist", "playlist"]),
    id: z.string(),
    storefront: z.union([
        z.nativeEnum(Region),
        z.string(),
    ]),
    snake: z.string(),
    songInAlbum: z.string().optional(),
    albumContextId: z.string().optional(),
});

export class AppleMusicURL extends StreamingServiceURL<string, string | undefined> {
    public readonly id: string;
    public storefront: RegionOrCode;
    public snake: string;
    private readonly albumContextId?: string;

    public get cleanURL(): URL {
        const slugSegment = this.snake ? `${this.snake}/` : "";
        const pathType = this.albumContextId ? "album" : this.type;
        const pathId = this.albumContextId ?? this.id;
        const builtUrl = new URL(`https://music.apple.com/${this.storefront}/${pathType}/${slugSegment}${pathId}`);
        if (this.albumContextId) {
            builtUrl.searchParams.set("i", this.id);
        } else if (this.extraIdentifier) {
            builtUrl.searchParams.set("i", this.extraIdentifier);
        }
        StreamingDebug.log("AppleMusicURL", "cleanURL", "success", {
            meta: {
                id: this.id,
                type: this.type,
                storefront: this.storefront,
                hasSongInAlbum: Boolean(this.albumContextId),
            },
        });
        return builtUrl;
    }

    constructor(props: AppleMusicURLConstructorParams) {
        const isSongInAlbumLink = props.type === "album" && Boolean(props.songInAlbum);
        const normalizedType: MusicEntityType = isSongInAlbumLink ? "song" : props.type;
        const normalizedId = isSongInAlbumLink && props.songInAlbum ? props.songInAlbum : props.id;

        super(normalizedType, {
            originalUrl: props.originalUrl,
            extraId: props.songInAlbum,
            tracking: props.tracking,
        });
        if (!AppleMusicConstructorParamsSchema.safeParse(props).success) {
            throw new Error("Invalid parameters for AppleMusicURL");
        }
        this.id = normalizedId;
        this.storefront = props.storefront;
        this.snake = props.snake;
        this.albumContextId = props.albumContextId ?? (isSongInAlbumLink ? props.id : undefined);
    }

    get primaryId(): string {
        return this.id;
    }

    get songInAlbumId(): string | undefined {
        return this.albumContextId ? this.id : undefined;
    }

    override toJSON(): StreamingServiceUrlJSON<string, string | undefined> {
        const json = super.toJSON();
        if (this.albumContextId) {
            return {
                ...json,
                type: 'album',
                id: this.albumContextId,
            };
        }
        return json;
    }

    private static validate(url: URL): boolean {
        if (url.hostname !== "music.apple.com") {
            return false;
        }
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (pathParts.length < 3) {
            return false;
        }
        const typePart = pathParts[1];
        const validTypes = ["song", "album", "artist", "playlist"];
        if (!validTypes.includes(typePart)) {
            return false;
        }
        return true;
    }

    static fromString(urlString: string): AppleMusicURL {
        const scope = StreamingDebug.scope("AppleMusicURL", "fromString", { urlString });
        try {
            const url = new URL(urlString);
            const result = AppleMusicURL.fromURL(url);
            scope.success({ resultType: result.type });
            return result;
        } catch (error) {
            scope.error(error, { urlString });
            throw error;
        }
    }

    static fromURL(url: URL): AppleMusicURL {
        const scope = StreamingDebug.scope("AppleMusicURL", "fromURL", { url: url.toString() });
        try {
            if (!AppleMusicURL.validate(url)) {
                throw new Error("Invalid Apple Music URL");
            }
            const pathParts = url.pathname.split("/").filter(Boolean);
            const storefront = pathParts[0] as RegionOrCode;
            const rawType = pathParts[1] as MusicEntityType;
            const hasSlug = pathParts.length > 3;
            const snake = hasSlug ? pathParts[2] : "";
            const idPart = hasSlug ? pathParts[3] : pathParts[2];
            const mainId = idPart;
            let songInAlbum: string | undefined = undefined;
            const tracking = buildTrackingMap(url.searchParams, ["i"]);
            let albumContextId: string | undefined;

            let type: MusicEntityType = rawType;

            if (rawType === "album") {
                const songIdParam = url.searchParams.get("i");
                if (songIdParam) {
                    songInAlbum = songIdParam;
                    albumContextId = mainId;
                    type = "song";
                }
            }
            const result = new AppleMusicURL({
                type,
                id: songInAlbum ?? mainId,
                storefront,
                snake,
                songInAlbum,
                albumContextId,
                tracking,
                originalUrl: url.toString(),
            });
            scope.success({ type: result.type, hasSongInAlbum: Boolean(songInAlbum) });
            return result;
        } catch (error) {
            scope.error(error, { url: url.toString() });
            throw error;
        }
    }

    static fromId(
        id: string | AppleMusicURLId,
        type: MusicEntityType,
        options: AppleMusicUrlBuildOptions = {},
    ): AppleMusicURL {
        const scope = StreamingDebug.scope("AppleMusicURL", "fromId", { id, type });
        try {
            const normalizedId: AppleMusicURLId = typeof id === "string"
                ? { main: id, songInAlbum: options.songInAlbum }
                : id;
            const storefront = options.storefront ?? Region.US;
            const snake = options.snake ?? "";
            const songInAlbum = normalizedId.songInAlbum ?? options.songInAlbum ?? options.extraId;
            const albumContextId = options.albumContextId ?? (type === "album" && songInAlbum ? normalizedId.main : undefined);
            const result = new AppleMusicURL({
                type,
                id: normalizedId.main,
                storefront,
                snake,
                songInAlbum,
                albumContextId,
                tracking: options.tracking,
                originalUrl: options.originalUrl,
            });
            scope.success({ storefront, hasSlug: Boolean(snake), hasSongInAlbum: Boolean(songInAlbum) });
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
        StreamingDebug.log("AppleMusicURL", "tracking", "info", {
            meta: {
                keys: Object.keys(tracking),
                omitted: omitKeys,
            },
        });
    }
    return tracking;
}
