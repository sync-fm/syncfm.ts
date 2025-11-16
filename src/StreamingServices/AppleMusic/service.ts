import type {
	SyncFMSong,
	SyncFMExternalIdMap,
	SyncFMArtist,
	SyncFMAlbum,
} from "../../types/syncfm";
import {
	generateSyncId,
	generateSyncArtistId,
	parseAMAstring,
	parseDurationWithFudge,
} from "../../utils";
import { StreamingService, type MusicEntityType } from "../StreamingService";
import { StreamingDebug } from "../debug";
import {
	AppleMusic,
	AuthType,
	LogLevel,
	Region,
	ArtistsEndpointTypes,
	AlbumsEndpointTypes,
	ResourceType,
} from "@syncfm/applemusic-api";
import { AppleMusicURL, type AppleMusicURLId, type AppleMusicUrlBuildOptions } from "./url";

export class AppleMusicService extends StreamingService<AppleMusicURL, string | AppleMusicURLId, AppleMusicUrlBuildOptions> {
	public readonly Url = AppleMusicURL;

	private client!: AppleMusic;

	async getInstance(): Promise<AppleMusic> {
		const scope = StreamingDebug.scope("AppleMusicService", "getInstance", {
			hasExistingClient: Boolean(this.client),
		});
		if (this.client) {
			scope.event("cache-hit", { reusedClient: true });
			scope.success();
			return this.client;
		}
		try {
			const amc = new AppleMusic({
				authType: AuthType.Scraped,
				region: Region.US,
				loggerOptions: {
					level: LogLevel.Debug,
				},
			});
			scope.event("info", { stage: "initializing-client", region: Region.US });
			await amc.init();
			this.client = amc;
			scope.success({ ready: true, region: Region.US });
			return this.client;
		} catch (error) {
			scope.error(error, { stage: "init" });
			throw error;
		}
	}

	async getSongById(id: string): Promise<SyncFMSong> {
		const scope = StreamingDebug.scope("AppleMusicService", "getSongById", { id });
		try {
			const client = await this.getInstance();
			let songRes = await client.Songs.get({
				id: id,
			});
			let actualSongId = id;
			let usedAlbumFallback = false;

			if (songRes.data.length === 0) {
				scope.event("info", { stage: "initial-song-miss", id });
				try {
					let albumData: AlbumsEndpointTypes.AlbumResource | undefined;
					const albumRes = await client.Albums.get({
						id: id,
						include: [AlbumsEndpointTypes.IncludeOption.Tracks],
					});
					if (albumRes.data.length > 0) {
						albumData = albumRes.data[0];
					}

					if (
						albumData &&
						albumData.attributes?.isSingle === true &&
						albumData.relationships?.tracks?.data &&
						albumData.relationships.tracks.data.length > 0
					) {
						const firstTrackId =
							albumData?.relationships?.tracks?.data?.[0]?.id;

						if (!firstTrackId) {
							throw new Error("No first track id on album");
						}

						actualSongId = firstTrackId;
						songRes = await client.Songs.get({ id: firstTrackId });
						usedAlbumFallback = true;
						scope.event("info", {
							stage: "resolved-single",
							albumId: id,
							trackId: firstTrackId,
						});
					}
				} catch (fallbackError) {
					scope.event("error", {
						stage: "single-fallback-failed",
						reason: fallbackError instanceof Error ? fallbackError.message : fallbackError,
					});
					throw new Error(`No song found with id: ${id}`);
				}
			}
			const song = songRes.data[0];
			if (!song || !song.attributes || !song.attributes.name || !song.attributes.artistName) {
				throw new Error(`No song found with id: ${id}`);
			}
			if (!song.attributes.artwork || !song.attributes.artwork.url) {
				throw new Error(`Song ${id} missing artwork`);
			}
			const songReleaseDate = song.attributes.releaseDate || "";
			const artists = Array.from(parseAMAstring(song.attributes.artistName)).map(
				(a) => a.trim(),
			);
			const externalIds: SyncFMExternalIdMap = { AppleMusic: actualSongId };
			const normalizedDuration = song.attributes.durationInMillis
				? parseDurationWithFudge(song.attributes.durationInMillis)
				: 0;
			const syncFmSong: SyncFMSong = {
				syncId: generateSyncId(
					song.attributes.name,
					artists,
					normalizedDuration,
				),
				title: song.attributes.name,
				description: `${song.attributes.name} by ${artists[0]} ${artists.length - 1 > 0 ? `& ${artists.length - 1} more` : ""} ${song.attributes.albumName ? `from the album ${song.attributes.albumName}` : ""}`,
				artists:
					Array.from(parseAMAstring(song.attributes.artistName)).map((a) =>
						a.trim(),
					) || [],
				album: song.attributes.albumName || undefined,
				releaseDate: songReleaseDate ? new Date(songReleaseDate) : new Date(),
				duration: song.attributes.durationInMillis
					? normalizedDuration
					: undefined,
				imageUrl: song.attributes.artwork.url.replace("{w}x{h}", "500x500"),
				externalIds: externalIds,
				explicit: song.attributes.contentRating === "explicit",
			};
			scope.success({
				actualSongId,
				usedAlbumFallback,
				artistCount: artists.length,
				duration: normalizedDuration,
			});
			return syncFmSong;
		} catch (error) {
			scope.error(error, { id });
			throw error;
		}
	}

	async getArtistById(id: string): Promise<SyncFMArtist> {
		const scope = StreamingDebug.scope("AppleMusicService", "getArtistById", { id });
		try {
			const client = await this.getInstance();
			const artistRes = await client.Artists.get({ id: id });
			scope.event("info", { stage: "fetch-artist", items: artistRes.data.length });
			const artistTopSongsRes = await client.Artists.getView({
				id: id,
				view: ArtistsEndpointTypes.ArtistViewName.TopSongs,
				limit: 5,
			});
			if (artistRes.data.length === 0) {
				throw new Error(`No artist found with id: ${id}`);
			}
			const artistData = artistRes.data[0];
			if (!artistData.attributes || !artistData.attributes.name) {
				throw new Error(`Artist ${id} missing required attributes`);
			}
			if (!artistData.attributes.artwork || !artistData.attributes.artwork.url) {
				throw new Error(`Artist ${id} missing artwork`);
			}

			const artist: SyncFMArtist = {
				syncId: generateSyncArtistId(artistData.attributes.name),
				name: artistData.attributes.name,
				imageUrl: artistData.attributes.artwork.url.replace("{w}x{h}", "500x500"),
				externalIds: {
					AppleMusic: id,
				},
				genre: artistData.attributes.genreNames || [],
				tracks: artistTopSongsRes.data
					.filter((item): item is ArtistsEndpointTypes.ArtistSongResource => item.type === "songs")
					.map(
						(song) => {
							if (!song.attributes || !song.attributes.name) {
								throw new Error("Song in artist top songs missing required attributes");
							}
							if (!song.attributes.artwork || !song.attributes.artwork.url) {
								throw new Error(`Song ${song.id} missing artwork`);
							}
							if (!song.attributes.previews || !song.attributes.previews[0] || !song.attributes.previews[0].url) {
								throw new Error(`Song ${song.id} missing preview URL`);
							}
							return {
								title: song.attributes.name,
								duration: song.attributes.durationInMillis
									? Math.round(song.attributes.durationInMillis / 1000)
									: undefined,
								thumbnailUrl: song.attributes.artwork.url.replace(
									"{w}x{h}",
									"500x500",
								),
								uploadDate: song.attributes.releaseDate,
								contentUrl: song.attributes.previews[0].url,
								externalIds: {
									AppleMusic: song.id,
								},
							};
						},
					),
			};
			scope.success({
				trackCount: artist.tracks?.length,
				genreCount: artist.genre?.length,
			});
			return artist;
		} catch (error) {
			scope.error(error, { id });
			throw error;
		}
	}

	async getAlbumById(id: string): Promise<SyncFMAlbum> {
		const scope = StreamingDebug.scope("AppleMusicService", "getAlbumById", { id });
		try {
			const client = await this.getInstance();
			const albumRes = await client.Albums.get({
				id: id,
				include: [AlbumsEndpointTypes.IncludeOption.Tracks],
			});
			scope.event("info", { stage: "fetch-album", count: albumRes.data.length });
			if (albumRes.data.length === 0) {
				throw new Error(`No album found with id: ${id}`);
			}
			const albumData = albumRes.data[0];
			if (!albumData.attributes || !albumData.attributes.name || !albumData.attributes.artistName) {
				throw new Error(`Album ${id} missing required attributes`);
			}
			if (!albumData.attributes.artwork || !albumData.attributes.artwork.url) {
				throw new Error(`Album ${id} missing artwork`);
			}
			const albumReleaseDate = albumData.attributes.releaseDate || "";
			if (!albumData.relationships || !albumData.relationships.tracks || !albumData.relationships.tracks.data) {
				throw new Error(`Album ${id} missing tracks data`);
			}
			const albumArtists = Array.from(
				parseAMAstring(albumData.attributes.artistName),
			).map((a) => a.trim());

			const songs: SyncFMSong[] = albumData.relationships.tracks.data
				.filter((item) => item.type === "songs")
				.map(
					(track) => {
						if (!track.attributes || !track.attributes.name || !track.attributes.artistName) {
							throw new Error(`Track ${track.id} missing required attributes`);
						}
						if (!track.attributes.artwork || !track.attributes.artwork.url) {
							throw new Error(`Track ${track.id} missing artwork`);
						}
						const trackReleaseDate = track.attributes.releaseDate || albumReleaseDate || "";
						const songDuration = track.attributes.durationInMillis
							? parseDurationWithFudge(track.attributes.durationInMillis)
							: 0;

						if (!trackReleaseDate && songDuration === 0) {
							StreamingDebug.log("AppleMusicService", "getAlbumById", "info", {
								meta: {
									trackId: track.id,
									reason: "missing-release-and-duration",
								},
							});
							return null;
						}

						const externalSongIds: SyncFMExternalIdMap = { AppleMusic: track.id };

						return {
							syncId: generateSyncId(
								track.attributes.name,
								albumArtists,
								songDuration,
							),
							title: track.attributes.name,
							artists:
								Array.from(parseAMAstring(track.attributes.artistName)).map((a) =>
									a.trim(),
								) || [],
							album: albumData.attributes.name,
							releaseDate: trackReleaseDate ? new Date(trackReleaseDate) : new Date(),
							duration: songDuration,
							imageUrl: track.attributes.artwork.url.replace("{w}x{h}", "500x500"),
							externalIds: externalSongIds,
							explicit: track.attributes.contentRating === "explicit",
							description: `${track.attributes.name} by ${track.attributes.artistName}`,
						};
					},
				)
				.filter((song) => song !== null) as SyncFMSong[];

			const albumTotalDuration = songs.reduce(
				(sum, song) => sum + (song.duration || 0),
				0,
			);

			const syncFmAlbum: SyncFMAlbum = {
				syncId: generateSyncId(
					albumData.attributes.name,
					albumArtists,
					albumTotalDuration,
				),
				title: albumData.attributes.name,
				description: albumData.attributes.editorialNotes?.standard || undefined,
				artists: albumArtists,
				releaseDate: albumReleaseDate || new Date().toISOString().split('T')[0],
				imageUrl: albumData.attributes.artwork.url.replace("{w}x{h}", "500x500"),
				externalIds: { AppleMusic: id },
				songs: songs,
				totalTracks: albumData.attributes.trackCount || songs.length,
				duration: albumTotalDuration > 0 ? albumTotalDuration : undefined,
				label: albumData.attributes.recordLabel || undefined,
				genres: albumData.attributes.genreNames || [],
				explicit: albumData.attributes.contentRating === "explicit",
			};

			scope.success({
				songCount: songs.length,
				totalDuration: albumTotalDuration,
				artists: albumArtists.length,
			});
			return syncFmAlbum;
		} catch (error) {
			scope.error(error, { id });
			throw error;
		}
	}

	async getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong & { __usedFallback?: boolean }> {
		const scope = StreamingDebug.scope("AppleMusicService", "getSongBySearchQuery", {
			query,
			expectedSyncId,
		});
		try {
			let usedFallback = false;
			let resolvedId: string | undefined;
			if (expectedSyncId) {
				const ids = await this.searchForIds(query, "songs", 3);
				scope.event("info", { stage: "search-with-expected", candidates: ids.length });

				for (const idCandidate of ids) {
					const candidate = await this.getSongById(idCandidate);
					if (candidate.syncId === expectedSyncId) {
						scope.success({ matchedId: idCandidate, usedFallback: false });
						return candidate;
					}
				}

				usedFallback = true;
				resolvedId = ids[0];
				const result = await this.getSongById(resolvedId);
				scope.success({ matchedId: resolvedId, usedFallback });
				return { ...result, __usedFallback: true };
			}

			resolvedId = await this.searchForId(query, "songs");
			scope.success({ matchedId: resolvedId, usedFallback });
			return this.getSongById(resolvedId);
		} catch (error) {
			scope.error(error, { query, expectedSyncId });
			throw error;
		}
	}

	async getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist & { __usedFallback?: boolean }> {
		const scope = StreamingDebug.scope("AppleMusicService", "getArtistBySearchQuery", {
			query,
			expectedSyncId,
		});
		try {
			let usedFallback = false;
			let resolvedId: string | undefined;
			if (expectedSyncId) {
				const ids = await this.searchForIds(query, "artists", 3);
				scope.event("info", { stage: "search-with-expected", candidates: ids.length });

				for (const idCandidate of ids) {
					const candidate = await this.getArtistById(idCandidate);
					if (candidate.syncId === expectedSyncId) {
						scope.success({ matchedId: idCandidate, usedFallback: false });
						return candidate;
					}
				}

				usedFallback = true;
				resolvedId = ids[0];
				const result = await this.getArtistById(resolvedId);
				scope.success({ matchedId: resolvedId, usedFallback });
				return { ...result, __usedFallback: true };
			}

			resolvedId = await this.searchForId(query, "artists");
			scope.success({ matchedId: resolvedId, usedFallback });
			return this.getArtistById(resolvedId);
		} catch (error) {
			scope.error(error, { query, expectedSyncId });
			throw error;
		}
	}

	async getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum & { __usedFallback?: boolean }> {
		const scope = StreamingDebug.scope("AppleMusicService", "getAlbumBySearchQuery", {
			query,
			expectedSyncId,
		});
		try {
			let usedFallback = false;
			let resolvedId: string | undefined;
			if (expectedSyncId) {
				const ids = await this.searchForIds(query, "albums", 3);
				scope.event("info", { stage: "search-with-expected", candidates: ids.length });

				for (const idCandidate of ids) {
					const candidate = await this.getAlbumById(idCandidate);
					if (candidate.syncId === expectedSyncId) {
						scope.success({ matchedId: idCandidate, usedFallback: false });
						return candidate;
					}
				}

				usedFallback = true;
				resolvedId = ids[0];
				const result = await this.getAlbumById(resolvedId);
				scope.success({ matchedId: resolvedId, usedFallback });
				return { ...result, __usedFallback: true };
			}

			resolvedId = await this.searchForId(query, "albums");
			scope.success({ matchedId: resolvedId, usedFallback });
			return this.getAlbumById(resolvedId);
		} catch (error) {
			scope.error(error, { query, expectedSyncId });
			throw error;
		}
	}

	private async searchForId(
		query: string,
		type: "songs" | "artists" | "albums",
	): Promise<string> {
		const ids = await this.searchForIds(query, type, 1);
		return ids[0];
	}

	private async searchForIds(
		query: string,
		type: "songs" | "artists" | "albums",
		limit: number,
	): Promise<string[]> {
		const scope = StreamingDebug.scope("AppleMusicService", "searchForIds", {
			query,
			type,
			limit,
		});
		try {
			const client = await this.getInstance();
			let types: ResourceType;
			switch (type) {
				case "songs":
					types = ResourceType.Songs;
					break;
				case "artists":
					types = ResourceType.Artists;
					break;
				case "albums":
					types = ResourceType.Albums;
					break;
				default:
					types = ResourceType.Songs;
			}
			const searchRes = await client.Search.search({
				term: query,
				types: [types],
				limit,
			});

			if (searchRes.results[type] && searchRes.results[type].data.length > 0) {
				const results = searchRes.results[type].data.slice(0, limit);
				scope.event("info", { stage: "raw-results", results: results.length });
				const ids: string[] = [];

				for (const result of results) {

					ids.push(result.id);
				}

				scope.success({ resultCount: ids.length });
				return ids;
			}
			throw new Error(`No ${type} found for query: ${query}`);
		} catch (error) {
			scope.error(error, { query, type, limit });
			throw error;
		}
	}

	async getTypeFromUrl(url: string): Promise<MusicEntityType | null> {
		const scope = StreamingDebug.scope("AppleMusicService", "getTypeFromUrl", { url });
		try {
			const parsed = this.parseUrl(url);
			scope.event("info", { parsedType: parsed.type, hasExtra: Boolean(parsed.extraIdentifier) });
			if (parsed.type === "album") {
				if (parsed.extraIdentifier) {
					scope.success({ resolvedType: "song" });
					return "song";
				}
			}
			scope.success({ resolvedType: parsed.type });
			return parsed.type;
		} catch (error) {
			scope.error(error, { url });
			return null;
		}
	}

	createUrl(
		id: string | AppleMusicURLId,
		type: MusicEntityType,
		options: AppleMusicUrlBuildOptions = {},
	): string {
		const url = this.Url.fromId(id, type, options).cleanURL.toString();
		StreamingDebug.log("AppleMusicService", "createUrl", "success", {
			meta: {
				id,
				type,
				url,
			},
		});
		return url;
	}
}
