/* eslint-disable no-unused-vars */
import type {
	SyncFMSong,
	SyncFMArtist,
	SyncFMAlbum,
	SyncFMPlaylist,
} from "../types/syncfm";

export type MusicEntityType = "song" | "album" | "artist" | "playlist";

export abstract class StreamingService {
	// Required methods
	abstract getSongById(id: string): Promise<SyncFMSong>;
	abstract getArtistById(id: string): Promise<SyncFMArtist>;
	abstract getAlbumById(id: string): Promise<SyncFMAlbum>;

	abstract getSongBySearchQuery(query: string): Promise<SyncFMSong>;
	abstract getArtistBySearchQuery(query: string): Promise<SyncFMArtist>;
	abstract getAlbumBySearchQuery(query: string): Promise<SyncFMAlbum>;

	// Optional methods
	getPlaylistById?(id: string): Promise<SyncFMPlaylist>;
	getPlaylistBySearchQuery?(query: string): Promise<SyncFMPlaylist>;

	// Utility methods that should be implemented by each service
	abstract getIdFromUrl(url: string): string | null;
	// We should probably strip tracking info from URLs in each service implementation.

	abstract getTypeFromUrl(url: string): Promise<MusicEntityType | null>;
	abstract createUrl(id: string, type: MusicEntityType): string;
}
