/* eslint-disable no-unused-vars */
import type {
	SyncFMSong,
	SyncFMArtist,
	SyncFMAlbum,
	SyncFMPlaylist,
} from "../types/syncfm";
import { StreamingDebug } from "./debug";

export type MusicEntityType = "song" | "album" | "artist" | "playlist";

export interface StreamingServiceUrlBuildOptions<TExtraId = undefined> {
	originalUrl?: string;
	tracking?: StreamingServiceUrlTracking;
	extraId?: TExtraId;
	[key: string]: unknown;
}

export type StreamingServiceUrlTracking = Record<string, string | string[]>;

/**
 * Canonical representation of a service-specific URL.
 *
 * All services must provide the normalized URL (`url`), the original/raw input (`originalUrl`),
 * the resolved music entity metadata (`type`, `id`, optional `extraId`), and any preserved
 * tracking parameters that were present on the incoming URL.
 */
export interface StreamingServiceUrlJSON<TIdentifier, TExtraId = undefined> {
	type: MusicEntityType;
	id: TIdentifier;
	primaryId: string;
	url: string;
	originalUrl: string;
	extraId?: TExtraId;
	tracking?: StreamingServiceUrlTracking;
}

export type StreamingServiceURLOptions<TExtraId = undefined> = StreamingServiceUrlBuildOptions<TExtraId>;

export abstract class StreamingServiceURL<TIdentifier = string, TExtraId = undefined> {
	public readonly originalUrl: string;
	public readonly tracking?: StreamingServiceUrlTracking;
	private readonly extraIdentifierValue?: TExtraId;

	constructor(
		public readonly type: MusicEntityType,
		options: StreamingServiceURLOptions<TExtraId> = {},
	) {
		this.originalUrl = options.originalUrl ?? "";
		this.tracking = options.tracking && Object.keys(options.tracking).length > 0 ? options.tracking : undefined;
		this.extraIdentifierValue = options.extraId;
	}

	abstract readonly id: TIdentifier;
	abstract get primaryId(): string;
	abstract get cleanURL(): URL;

	get extraIdentifier(): TExtraId | undefined {
		return this.extraIdentifierValue;
	}

	get extraId(): TExtraId | undefined {
		return this.extraIdentifier;
	}

	toString(): string {
		return this.cleanURL.toString();
	}

	toJSON(): StreamingServiceUrlJSON<TIdentifier, TExtraId> {
		const json: StreamingServiceUrlJSON<TIdentifier, TExtraId> = {
			type: this.type,
			id: this.id,
			primaryId: this.primaryId,
			url: this.cleanURL.toString(),
			originalUrl: this.originalUrl || this.cleanURL.toString(),
		};
		if (this.extraIdentifierValue !== undefined) {
			json.extraId = this.extraIdentifierValue;
		}
		if (this.tracking) {
			json.tracking = this.tracking;
		}
		return json;
	}
}

export interface StreamingServiceURLStatic<
	TUrl extends StreamingServiceURL<unknown, unknown> = StreamingServiceURL,
	TIdentifier = unknown,
	TBuildOptions extends StreamingServiceUrlBuildOptions<unknown> = StreamingServiceUrlBuildOptions,
> {
	fromString(url: string): TUrl;
	fromURL(url: URL): TUrl;
	fromId(id: TIdentifier, type: MusicEntityType, options?: TBuildOptions): TUrl;
}

export abstract class StreamingService<
	TUrl extends StreamingServiceURL<unknown, unknown> = StreamingServiceURL,
	TIdentifier = unknown,
	TBuildOptions extends StreamingServiceUrlBuildOptions<unknown> = StreamingServiceUrlBuildOptions,
> {
	abstract readonly Url: StreamingServiceURLStatic<TUrl, TIdentifier, TBuildOptions>;

	// Required methods
	abstract getSongById(id: string): Promise<SyncFMSong>;
	abstract getArtistById(id: string): Promise<SyncFMArtist>;
	abstract getAlbumById(id: string): Promise<SyncFMAlbum>;

	abstract getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong>;
	abstract getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist>;
	abstract getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum>;

	// Optional methods
	getPlaylistById?(id: string): Promise<SyncFMPlaylist>;
	getPlaylistBySearchQuery?(query: string): Promise<SyncFMPlaylist>;

	public parseUrl(input: string | URL): TUrl {
		const scope = StreamingDebug.scope(this.constructor.name, "parseUrl", {
			inputType: typeof input === "string" ? "string" : "url",
			preview: typeof input === "string" ? input.slice(0, 120) : input.toString().slice(0, 120),
		});
		try {
			const result = typeof input === "string" ? this.Url.fromString(input) : this.Url.fromURL(input);
			scope.success({ type: result.type });
			return result;
		} catch (error) {
			scope.error(error, {});
			throw error;
		}
	}

	public createUrlObject(id: TIdentifier, type: MusicEntityType, options?: TBuildOptions): TUrl {
		const scope = StreamingDebug.scope(this.constructor.name, "createUrlObject", {
			id,
			type,
		});
		try {
			const result = this.Url.fromId(id, type, options);
			scope.success({ hasOptions: Boolean(options) });
			return result;
		} catch (error) {
			scope.error(error, { id, type });
			throw error;
		}
	}

	public createUrlJSON(id: TIdentifier, type: MusicEntityType, options?: TBuildOptions): ReturnType<TUrl["toJSON"]> {
		const scope = StreamingDebug.scope(this.constructor.name, "createUrlJSON", {
			id,
			type,
		});
		const result = this.createUrlObject(id, type, options).toJSON() as ReturnType<TUrl["toJSON"]>;
		scope.success({ url: result.url });
		return result;
	}

	public describeUrl(input: string | URL): ReturnType<TUrl["toJSON"]> {
		const scope = StreamingDebug.scope(this.constructor.name, "describeUrl", {
			inputType: typeof input === "string" ? "string" : "url",
		});
		const description = this.parseUrl(input).toJSON() as ReturnType<TUrl["toJSON"]>;
		scope.success({ type: description.type });
		return description;
	}

	getIdFromUrl(url: string): string | null {
		const scope = StreamingDebug.scope(this.constructor.name, "getIdFromUrl", { url: url.slice(0, 160) });
		try {
			const id = this.parseUrl(url).primaryId;
			scope.success({ id });
			return id;
		} catch (error) {
			scope.error(error, { stage: "parse" });
			return null;
		}
	}

	// We should probably strip tracking info from URLs in each service implementation.

	async getTypeFromUrl(url: string): Promise<MusicEntityType | null> {
		const scope = StreamingDebug.scope(this.constructor.name, "getTypeFromUrl", { url: url.slice(0, 160) });
		try {
			const type = this.parseUrl(url).type;
			scope.success({ type });
			return type;
		} catch (error) {
			scope.error(error, { stage: "parse" });
			return null;
		}
	}

	createUrl(id: TIdentifier, type: MusicEntityType, options?: TBuildOptions): string {
		const scope = StreamingDebug.scope(this.constructor.name, "createUrl", { id, type });
		const url = this.createUrlObject(id, type, options).cleanURL.toString();
		scope.success({ url });
		return url;
	}
}
