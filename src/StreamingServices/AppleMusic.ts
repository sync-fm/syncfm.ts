import type {
	SyncFMSong,
	SyncFMExternalIdMap,
	SyncFMArtist,
	SyncFMAlbum,
} from "../types/syncfm";
import {
	generateSyncId,
	generateSyncArtistId,
	parseAMAstring,
	parseDurationWithFudge,
} from "../utils";
import { StreamingService, type MusicEntityType } from "./StreamingService";
import {
	AppleMusic,
	AuthType,
	LogLevel,
	Region,
	ArtistsEndpointTypes,
	AlbumsEndpointTypes,
	ResourceType,
} from "@syncfm/applemusic-api";

interface AlbumCacheEntry {
	data: AlbumsEndpointTypes.AlbumResource;
	expiresAt: number;
}

export class AppleMusicService extends StreamingService {
	private client!: AppleMusic;
	private albumCache: Map<string, AlbumCacheEntry> = new Map();
	private readonly CACHE_TTL_MS = 10000; // 10 seconds

	async getInstance(): Promise<AppleMusic> {
		if (this.client) {
			return this.client;
		}
		const amc = new AppleMusic({
			authType: AuthType.Scraped,
			region: Region.US,
			loggerOptions: {
				level: LogLevel.Debug,
			},
		});
		await amc.init();
		this.client = amc;
		return this.client;
	}

	private getCachedAlbum(id: string): AlbumsEndpointTypes.AlbumResource | null {
		const cached = this.albumCache.get(id);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.data;
		}
		// Clean up expired entry
		if (cached) {
			this.albumCache.delete(id);
		}
		return null;
	}

	private setCachedAlbum(id: string, album: AlbumsEndpointTypes.AlbumResource): void {
		this.albumCache.set(id, {
			data: album,
			expiresAt: Date.now() + this.CACHE_TTL_MS,
		});
	}

	async getSongById(id: string): Promise<SyncFMSong> {
		const client = await this.getInstance();
		let songRes = await client.Songs.get({
			id: id,
		});
		let actualSongId = id;

		if (songRes.data.length === 0) {
			// The ID might be an album single, try to extract the actual song
			try {
				// Check cache first
				let albumData = this.getCachedAlbum(id);
				if (!albumData) {
					const albumRes = await client.Albums.get({
						id: id,
						include: [AlbumsEndpointTypes.IncludeOption.Tracks],
					});
					if (albumRes.data.length > 0) {
						albumData = albumRes.data[0];
						this.setCachedAlbum(id, albumData);
					}
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
						// handle: no tracks or missing id
						throw new Error("No first track id on album");
					}

					// Use the actual song ID, not the album ID
					actualSongId = firstTrackId;
					songRes = await client.Songs.get({ id: firstTrackId });
				}
			} catch {
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
		if (!song.attributes.releaseDate) {
			throw new Error(`Song ${id} missing release date`);
		}
		const artists = Array.from(parseAMAstring(song.attributes.artistName)).map(
			(a) => a.trim(),
		);
		// Store the actual song ID, not the album ID if it was a single
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
			releaseDate: new Date(song.attributes.releaseDate),
			duration: song.attributes.durationInMillis
				? normalizedDuration
				: undefined,
			imageUrl: song.attributes.artwork.url.replace("{w}x{h}", "500x500"),
			externalIds: externalIds,
			explicit: song.attributes.contentRating === "explicit",
		};
		return syncFmSong;
	}

	async isAlbumSingle(id: string): Promise<boolean> {
		let albumData = this.getCachedAlbum(id);
		if (!albumData) {
			const client = await this.getInstance();
			const albumRes = await client.Albums.get({
				id: id,
			});
			if (albumRes.data.length === 0) {
				throw new Error(`No album found with id: ${id}`);
			}
			albumData = albumRes.data[0];
			this.setCachedAlbum(id, albumData);
		}
		if (!albumData.attributes) {
			throw new Error(`Album ${id} missing attributes`);
		}
		return albumData.attributes.isSingle === true;
	}

	async getArtistById(id: string): Promise<SyncFMArtist> {
		const client = await this.getInstance();
		const artistRes = await client.Artists.get({ id: id });
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
		return artist;
	}

	async getAlbumById(id: string): Promise<SyncFMAlbum> {
		const client = await this.getInstance();
		const albumRes = await client.Albums.get({
			id: id,
			include: [AlbumsEndpointTypes.IncludeOption.Tracks],
		});
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
		if (!albumData.attributes.releaseDate) {
			throw new Error(`Album ${id} missing release date`);
		}
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
					if (!track.attributes.releaseDate) {
						throw new Error(`Track ${track.id} missing release date`);
					}
					const songDuration = track.attributes.durationInMillis
						? parseDurationWithFudge(track.attributes.durationInMillis)
						: 0;
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
						releaseDate: new Date(track.attributes.releaseDate),
						duration: songDuration,
						imageUrl: track.attributes.artwork.url.replace("{w}x{h}", "500x500"),
						externalIds: externalSongIds,
						explicit: track.attributes.contentRating === "explicit",
						description: `${track.attributes.name} by ${track.attributes.artistName}`,
					};
				},
			);

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
			releaseDate: albumData.attributes.releaseDate,
			imageUrl: albumData.attributes.artwork.url.replace("{w}x{h}", "500x500"),
			externalIds: { AppleMusic: id },
			songs: songs,
			totalTracks: albumData.attributes.trackCount || songs.length,
			duration: albumTotalDuration > 0 ? albumTotalDuration : undefined,
			label: albumData.attributes.recordLabel || undefined,
			genres: albumData.attributes.genreNames || [],
			explicit: albumData.attributes.contentRating === "explicit",
		};

		return syncFmAlbum;
	}

	async getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong & { __usedFallback?: boolean }> {
		if (expectedSyncId) {
			const ids = await this.searchForIds(query, "songs", 3);

			for (const id of ids) {
				const candidate = await this.getSongById(id);
				if (candidate.syncId === expectedSyncId) {
					return candidate;
				}
			}

			const result = await this.getSongById(ids[0]);
			return { ...result, __usedFallback: true };
		}

		const id = await this.searchForId(query, "songs");
		return this.getSongById(id);
	}

	async getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist & { __usedFallback?: boolean }> {
		if (expectedSyncId) {
			const ids = await this.searchForIds(query, "artists", 3);

			for (const id of ids) {
				const candidate = await this.getArtistById(id);
				if (candidate.syncId === expectedSyncId) {
					return candidate;
				}
			}

			const result = await this.getArtistById(ids[0]);
			return { ...result, __usedFallback: true };
		}

		const id = await this.searchForId(query, "artists");
		return this.getArtistById(id);
	}

	async getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum & { __usedFallback?: boolean }> {
		if (expectedSyncId) {
			const ids = await this.searchForIds(query, "albums", 3);

			for (const id of ids) {
				const candidate = await this.getAlbumById(id);
				if (candidate.syncId === expectedSyncId) {
					return candidate;
				}
			}

			const result = await this.getAlbumById(ids[0]);
			return { ...result, __usedFallback: true };
		}

		const id = await this.searchForId(query, "albums");
		return this.getAlbumById(id);
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
				const ids: string[] = [];

				for (const result of results) {
					let resultId = result.id;

					// Special handling for songs: check if the result is actually an album single
					// Apple Music search can return album singles in song search results
					if (type === "songs") {
						// Check if this ID is actually an album by trying to fetch it as an album
						try {
							const isSingle = await this.isAlbumSingle(resultId);
							if (isSingle) {
								// It's a single album, extract the actual song ID
								let albumData = this.getCachedAlbum(resultId);
								if (!albumData) {
									const albumRes = await client.Albums.get({
										id: resultId,
										include: [AlbumsEndpointTypes.IncludeOption.Tracks],
									});
									if (albumRes.data.length > 0) {
										albumData = albumRes.data[0];
										this.setCachedAlbum(resultId, albumData);
									}
								}

								if (
									albumData?.relationships?.tracks?.data &&
									albumData.relationships.tracks.data.length > 0
								) {
									const actualSongId = albumData.relationships.tracks.data[0].id;
									console.log(`Search returned album single ${resultId}, using actual song ID ${actualSongId}`);
									resultId = actualSongId;
								}
							}
						} catch {
							// If checking for single fails, it's probably a real song ID
							// Just continue and return the original ID
						}
					}

					ids.push(resultId);
				}

				return ids;
			}
			throw new Error(`No ${type} found for query: ${query}`);
		} catch (error) {
			console.error("Error fetching or parsing song data:", error);
			throw error;
		}
	}

	getIdFromUrl(url: string): string | null {
		try {
			const parsedUrl = new URL(url);

			// Check if this is an album URL with a song ID in the query parameter
			// e.g., /album/123456?i=1700526200 where 1700526200 is the song ID
			const songIdParam = parsedUrl.searchParams.get("i");
			if (songIdParam && parsedUrl.pathname.includes("/album/")) {
				return songIdParam;
			}

			const pathParts = parsedUrl.pathname.split("/");
			for (let i = pathParts.length - 1; i >= 0; i--) {
				const part = pathParts[i];
				if (part && /^\d+$/.test(part)) {
					return part;
				}
			}

			return null;
		} catch (error) {
			console.error("Invalid URL for Apple Music", error);
			return null;
		}
	}

	async getTypeFromUrl(url: string): Promise<MusicEntityType | null> {
		try {
			const parsedUrl = new URL(url);

			// Check if this is an album URL with a song ID in the query parameter
			// e.g., /album/123456?i=1700526200 - this should be treated as a song
			const songIdParam = parsedUrl.searchParams.get("i");
			if (songIdParam && parsedUrl.pathname.includes("/album/")) {
				return "song";
			}

			const pathParts = parsedUrl.pathname.split("/");
			const potentialTypes: MusicEntityType[] = [
				"song",
				"album",
				"artist",
				"playlist",
			];
			// Find the first path segment that is a valid music entity type
			for (const part of pathParts) {
				if (potentialTypes.includes(part as MusicEntityType)) {
					if (part === "album") {
						// Check if it is actually an album - or if its a single (a song)
						const id = this.getIdFromUrl(url);
						if (id) {
							try {
								const isSingle = await this.isAlbumSingle(id);
								return isSingle ? "song" : "album" as MusicEntityType;
							}
							catch {
								return "album" as MusicEntityType;
							}
						}
					}
					return part as MusicEntityType;
				}
			}
			return null;
		} catch (error) {
			console.error("Invalid URL for Apple Music", error);
			return null;
		}
	}

	createUrl(id: string, type: MusicEntityType, country = "us"): string {
		return `https://music.apple.com/${country}/${type}/${id}`;
	}
}
