import axios from "axios";
import type {
	SyncFMSong,
	SyncFMExternalIdMap,
	SyncFMArtist,
	SyncFMAlbum,
} from "../types/syncfm";
import { generateSyncId, generateSyncArtistId, parseAMAstring } from "../utils";
import { StreamingService, type MusicEntityType } from "./StreamingService";
import {
	AppleMusic,
	AuthType,
	LogLevel,
	Region,
  ArtistsEndpointTypes,
  SongsEndpointTypes,
  AlbumsEndpointTypes
} from "../../../applemusic-api";
import fs from "fs";
export class AppleMusicService extends StreamingService {
	private client: AppleMusic;

	async getInstance(): Promise<AppleMusic> {
		if (this.client) {
			console.log("AppleMusicService.getInstance returning existing client");
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

	async getSongById(id: string): Promise<SyncFMSong> {
		const client = await this.getInstance();
		const songRes = await client.Songs.get({
			id: id,
		});
		if (songRes.data.length === 0) {
			throw new Error(`No song found with id: ${id}`);
		}
		const song = songRes.data[0];
		const artists = Array.from(parseAMAstring(song.attributes.artistName)).map(
			(a) => a.trim(),
		);
		const externalIds: SyncFMExternalIdMap = { AppleMusic: id };
		const syncFmSong: SyncFMSong = {
			syncId: generateSyncId(
				song.attributes.name,
				artists,
				song.attributes.durationInMillis,
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
				? Math.round(song.attributes.durationInMillis / 1000)
				: undefined,
			imageUrl: song.attributes.artwork.url.replace("{w}x{h}", "500x500"),
			externalIds: externalIds,
			explicit: song.attributes.contentRating === "explicit",
		};
		return syncFmSong;
	}

	async getArtistById(id: string): Promise<SyncFMArtist> {
		const client = await this.getInstance();
		const artistRes = await client.Artists.get({ id: id });
    const artistTopSongsRes = await client.Artists.getView({
      id: id,
      view: ArtistsEndpointTypes.ArtistViewName.TopSongs,
      limit: 5,
    })
		if (artistRes.data.length === 0) {
			throw new Error(`No artist found with id: ${id}`);
		}
		const artistData = artistRes.data[0];

		const artist: SyncFMArtist = {
			syncId: generateSyncArtistId(artistData.attributes.name),
			name: artistData.attributes.name,
			imageUrl: artistData.attributes.artwork.url.replace("{w}x{h}", "500x500"),
			externalIds: {
				AppleMusic: id,
			},
			genre: artistData.attributes.genreNames || [],
			tracks: artistTopSongsRes.data.map((song: SongsEndpointTypes.SongResource) => {
        return {
          title: song.attributes.name,
          duration: song.attributes.durationInMillis
            ? Math.round(song.attributes.durationInMillis / 1000)
            : undefined,
          thumbnailUrl: song.attributes.artwork.url.replace("{w}x{h}", "500x500"),
          uploadDate: song.attributes.releaseDate,
          contentUrl: song.attributes.previews[0].url,
          externalIds: {
            AppleMusic: song.id
          }
        }
        }),
    }
    return artist;
	}

	async getAlbumById(id: string): Promise<SyncFMAlbum> {
    		const client = await this.getInstance();
        const albumRes = await client.Albums.get({ id: id, include: [AlbumsEndpointTypes.IncludeOption.Tracks] });
        if (albumRes.data.length === 0) {
                throw new Error(`No album found with id: ${id}`);
        }
        const albumData = albumRes.data[0];
        const albumArtists = Array.from(parseAMAstring(albumData.attributes.artistName)).map((a) => a.trim());

        const songs: SyncFMSong[] = (albumData.relationships.tracks.data || []).map((track: SongsEndpointTypes.SongResource) => {
            const songDuration = track.attributes.durationInMillis
                ? Math.round(track.attributes.durationInMillis / 1000)
                : 0;
            const externalSongIds: SyncFMExternalIdMap = { AppleMusic: track.id };

            return {
                syncId: generateSyncId(track.attributes.name, albumArtists, songDuration),
                title: track.attributes.name,
                artists: Array.from(parseAMAstring(track.attributes.artistName)).map((a) => a.trim()) || [],
                album: albumData.attributes.name,
                releaseDate: new Date(track.attributes.releaseDate),
                duration: songDuration,
                imageUrl: track.attributes.artwork.url.replace("{w}x{h}", "500x500"),
                externalIds: externalSongIds,
                explicit: track.attributes.contentRating === "explicit",
                description: `${track.attributes.name} by ${track.attributes.artistName}`,
            };
        });

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

	async getSongBySearchQuery(query: string): Promise<SyncFMSong> {
		const id = await this.searchForId(query, "songs");
		return this.getSongById(id);
	}

	async getArtistBySearchQuery(query: string): Promise<SyncFMArtist> {
		const id = await this.searchForId(query, "artists");
		return this.getArtistById(id);
	}

	async getAlbumBySearchQuery(query: string): Promise<SyncFMAlbum> {
		const id = await this.searchForId(query, "albums");
		return this.getAlbumById(id);
	}

	private async searchForId(
		query: string,
		type: "songs" | "artists" | "albums",
	): Promise<string> {
		try {
			const url =
				"https://music.apple.com/us/search?term=" + encodeURIComponent(query);
			const response = await axios.get(url);
			if (!response.status || response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const html = response.data;

			const embeddedSongInfo = html
				.split(
					`<script type="application/json" id="serialized-server-data">`,
				)[1]
				?.split(`</script>`)[0];
			const trimmedSongInfo = embeddedSongInfo?.trim();
			if (trimmedSongInfo) {
				const jsonData = JSON.parse(trimmedSongInfo);
				let firstResult = jsonData[0]?.data?.sections[0].items?.find(
					(item: any) => item.itemKind === type,
				);

				if (type === "albums") {
					// When trying to find an album, prefer non-singles at first.
					firstResult = jsonData[0]?.data?.sections[0].items?.find(
						(item: any) =>
							item.itemKind === type &&
							!item.title.toLowerCase().trim().includes(" - single"),
					);
				}
				if (!firstResult) {
					firstResult = jsonData[0]?.data?.sections[0].items?.find(
						(item: any) => item.itemKind === type,
					);
				}

				if (!firstResult) {
					throw new Error(`Could not find ${type} in search result`);
				}

				const id =
					firstResult?.contentDescriptor?.identifiers?.storeAdamId ||
					firstResult?.contentDescriptor?.identifiers?.storeAdamID;
				if (!id) {
					throw new Error(`Could not find id in search result for ${type}`);
				}
				return id.toString();
			} else {
				throw new Error("Could not find song data in HTML");
			}
		} catch (error) {
			console.error("Error fetching or parsing song data:", error);
			throw error;
		}
	}

	getIdFromUrl(url: string): string | null {
		try {
			const parsedUrl = new URL(url);

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

	getTypeFromUrl(url: string): MusicEntityType | null {
		try {
			const pathParts = new URL(url).pathname.split("/");
			const potentialTypes: MusicEntityType[] = [
				"song",
				"album",
				"artist",
				"playlist",
			];
			// Find the first path segment that is a valid music entity type
			for (const part of pathParts) {
				if (potentialTypes.includes(part as MusicEntityType)) {
					return part as MusicEntityType;
				}
			}
			return null;
		} catch (error) {
			console.error("Invalid URL for Apple Music", error);
			return null;
		}
	}

	createUrl(id: string, type: MusicEntityType, country: string = "us"): string {
		// Note: Creating a song URL from just the song ID is tricky as it requires the album ID and name in the path.
		// This implementation will require a more advanced lookup if we need to create song URLs from scratch.
		// For now, we assume this is primarily for album/artist/playlist.
		return `https://music.apple.com/${country}/${type}/${id}`;
	}

	private async getSongDataFromUrl(url: string): Promise<AppleMusicSong> {
		try {
			const response = await axios.get(url);
			if (!response.status || response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const html = response.data;

			const embeddedSongInfo = html
				.split(`<script id=schema:song type="application/ld+json">`)[1]
				?.split(`</script>`)[0];
			const trimmedSongInfo = embeddedSongInfo?.trim();
			if (trimmedSongInfo) {
				const jsonData = JSON.parse(trimmedSongInfo);
				return jsonData;
			} else {
				throw new Error("Could not find song data in HTML");
			}
		} catch (error) {
			console.error("Error fetching or parsing song data:", error);
			throw error;
		}
	}

	private parseISO8601Duration(
		durationString: string | undefined,
	): number | undefined {
		if (!durationString) return undefined;

		const match = durationString.match(
			/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/,
		);
		if (!match) {
			console.warn(`Could not parse ISO 8601 duration: ${durationString}`);
			return undefined;
		}

		const hours = parseInt(match[1] || "0", 10);
		const minutes = parseInt(match[2] || "0", 10);
		const seconds = parseFloat(match[3] || "0");

		const totalSeconds = hours * 3600 + minutes * 60 + seconds;

		// AM uses fuckass ISO8601 durations that does NOT line up with the way
		// we calc durations from other services.
		// BUT, they seem to always be off by 1 second.
		// so we add a sec, and look the other way.
		return totalSeconds + 1;
	}
}
