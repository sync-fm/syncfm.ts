import YTMusic, { type AlbumFull } from "@syncfm/ytmusic-api";
import Youtube, { type YoutubeVideo } from "youtube.ts";
import type { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../../types/syncfm';
import { generateSyncArtistId, generateSyncId, parseDurationWithFudge } from '../../utils';
import axios from "axios";
import { StreamingService } from '../StreamingService';
import { YouTubeMusicURL } from './url';
import { StreamingDebug } from '../debug';

export class YouTubeMusicService extends StreamingService<YouTubeMusicURL, string> {
    public readonly Url = YouTubeMusicURL;

    private ytmusic!: YTMusic;
    private youtube?: Youtube;
    private ytmusicApiKey: string | undefined;
    private ytmusicInitPromise?: Promise<void>;

    async getInstance() {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getInstance", {
            hasExistingClient: Boolean(this.ytmusic),
        });
        if (!this.ytmusic) {
            this.ytmusic = new YTMusic();
            scope.event("info", { stage: "initializing" });
            this.ytmusicInitPromise = this.ytmusic.initialize().catch(err => {
                this.ytmusic = undefined;
                scope.event("error", { stage: "initialization", message: err instanceof Error ? err.message : String(err) });
                throw err;
            }).then(() => {
                this.ytmusicInitPromise = undefined;
                scope.success({ initialized: true });
            });
            await this.ytmusicInitPromise;
        }
        if (this.ytmusicInitPromise) {
            scope.event("info", { stage: "awaiting-initialization" });
            await this.ytmusicInitPromise;
        }
        return this.ytmusic;
    }
    constructor(YoutubeAPIKey?: string) {
        super();
        this.ytmusicApiKey = YoutubeAPIKey;
    }

    private getYouTubeInstance(): Youtube {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getYouTubeInstance", {
            hasExistingClient: Boolean(this.youtube),
        });
        if (!this.youtube) {
            if (!this.ytmusicApiKey) {
                scope.error(new Error('Missing API key'), {});
                throw new Error('YOUTUBE_API_KEY variable is required for YouTube.ts fallback');
            }
            this.youtube = new Youtube(this.ytmusicApiKey);
            scope.event("info", { stage: "created-client" });
        }
        scope.success({ initialized: true });
        return this.youtube;
    }

    private parseISO8601Duration(duration: string): number {
        // Parse ISO 8601 duration format like "PT2M52S"
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 0;

        const hours = Number.parseInt(match[1] || '0', 10);
        const minutes = Number.parseInt(match[2] || '0', 10);
        const seconds = Number.parseInt(match[3] || '0', 10);

        return hours * 3600 + minutes * 60 + seconds;
    }

    private extractArtistFromChannelTitle(channelTitle: string): string {
        // Remove common suffixes like "- Topic", "VEVO", etc.
        return channelTitle
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/\s*VEVO$/i, '')
            .replace(/\s*Official$/i, '')
            .trim();
    }

    private convertYouTubeVideoToSyncFMSong(video: YoutubeVideo): SyncFMSong {
        const externalIds: SyncFMExternalIdMap = { YouTube: video.id };

        // Parse duration from ISO 8601 format
        const durationSeconds = this.parseISO8601Duration(video.contentDetails.duration);
        const normalizedDuration = durationSeconds ? parseDurationWithFudge(durationSeconds * 1000) : 0;

        // Extract artist name from channel title
        const artistName = this.extractArtistFromChannelTitle(video.snippet.channelTitle);
        const artists = [artistName];

        // Get thumbnail URL (prefer maxres, fall back to high, then medium)
        let imageUrl: string | undefined;
        if (video.snippet.thumbnails.maxres) {
            imageUrl = video.snippet.thumbnails.maxres.url;
        } else if (video.snippet.thumbnails.high) {
            imageUrl = video.snippet.thumbnails.high.url;
        } else if (video.snippet.thumbnails.medium) {
            imageUrl = video.snippet.thumbnails.medium.url;
        }

        const syncFmSong: SyncFMSong = {
            syncId: generateSyncId(video.snippet.title, artists, normalizedDuration),
            title: video.snippet.title,
            description: undefined,
            artists: artists,
            album: undefined,
            releaseDate: undefined,
            duration: normalizedDuration || undefined,
            imageUrl: imageUrl,
            externalIds: externalIds,
            explicit: undefined,
        };
        StreamingDebug.log("YouTubeMusicService", "convertYouTubeVideoToSyncFMSong", "success", {
            meta: {
                videoId: video.id,
                duration: normalizedDuration,
                artistGuess: artistName,
            },
        });
        return syncFmSong;
    }

    async getSongById(id: string): Promise<SyncFMSong> {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getSongById", { id });
        const ytmusic = await this.getInstance();

        try {
            const ytMusicSong = await ytmusic.getSong(id);

            const externalIds: SyncFMExternalIdMap = { YouTube: id };
            const normalizedDuration = ytMusicSong.duration
                ? parseDurationWithFudge(ytMusicSong.duration * 1000)
                : 0;

            const syncFmSong: SyncFMSong = {
                syncId: generateSyncId(
                    ytMusicSong.name,
                    ytMusicSong.artist ? [ytMusicSong.artist.name] : [],
                    normalizedDuration,
                ),
                title: ytMusicSong.name,
                description: undefined,
                artists: ytMusicSong.artist ? [ytMusicSong.artist.name] : [],
                album: undefined,
                releaseDate: undefined,
                duration: ytMusicSong.duration ? normalizedDuration : undefined,
                imageUrl: ytMusicSong.thumbnails[0]?.url,
                externalIds: externalIds,
                explicit: undefined,
            };
            scope.success({ provider: "ytmusic", duration: normalizedDuration });
            return syncFmSong;
        } catch (error) {
            if (error instanceof Error && (
                error.message.toLowerCase().includes('invalid video') ||
                error.message.toLowerCase().includes('invalid videoid')
            )) {
                scope.event("error", { stage: "ytmusic-primary", reason: error.message });

                try {
                    const youtube = this.getYouTubeInstance();
                    const video = await youtube.videos.get(id);

                    if (!video) {
                        throw new Error(`Video not found with ID: ${id}`);
                    }

                    const fallbackResult = this.convertYouTubeVideoToSyncFMSong(video);
                    scope.success({ provider: "youtube-fallback" });
                    return fallbackResult;
                } catch (fallbackError) {
                    scope.error(fallbackError, { stage: "youtube-fallback" });
                    throw new Error(`Both APIs failed to fetch video ${id}: ${error instanceof Error ? error.message : 'Unknown primary error'} | ${fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error'}`);
                }
            }

            scope.error(error, { stage: "ytmusic-primary" });
            throw error;
        }
    }

    async getArtistById(id: string): Promise<SyncFMArtist> {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getArtistById", { id });
        try {
            const ytmusic = await this.getInstance();
            const ytMusicArtist = await ytmusic.getArtist(id);

            const externalIds: SyncFMExternalIdMap = { YouTube: id };

            const syncFmArtist: SyncFMArtist = {
                syncId: generateSyncArtistId(ytMusicArtist.name),
                name: ytMusicArtist.name,
                imageUrl: ytMusicArtist.thumbnails[0]?.url,
                externalIds: externalIds,
                genre: undefined,
            };
            scope.success({ hasImage: Boolean(syncFmArtist.imageUrl) });
            return syncFmArtist;
        } catch (error) {
            scope.error(error, { id });
            throw error;
        }
    }

    async getAlbumById(id: string): Promise<SyncFMAlbum> {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getAlbumById", { id });
        try {
            const ytmusic = await this.getInstance();
            let ytMusicAlbum: AlbumFull;
            if (!id.startsWith("MPREb_")) {
                scope.event("info", { stage: "resolve-browse-id" });
                const browseId = await this.getBrowseIdFromPlaylist(id);
                ytMusicAlbum = await ytmusic.getAlbum(browseId);
            } else {
                ytMusicAlbum = await ytmusic.getAlbum(id);
            }
            const normalizedArtists: string[] = [];
            if (ytMusicAlbum.artist) {
                const splitArtists = ytMusicAlbum.artist.name.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
                normalizedArtists.push(...splitArtists);
            }

            let totalDuration = 0;
            let totalTracks = 0;
            const parsedTracks: SyncFMSong[] = [];
            ytMusicAlbum.songs.forEach(song => {
                totalTracks += 1;
                const normalizedDuration = song.duration
                    ? parseDurationWithFudge(song.duration * 1000)
                    : 0;
                if (normalizedDuration) {
                    totalDuration += normalizedDuration;
                }
                const externalIds: SyncFMExternalIdMap = { YouTube: song.videoId };
                const trackArtists = song.artist ? [song.artist.name] : [];

                const syncFmSong: SyncFMSong = {
                    syncId: generateSyncId(song.name, trackArtists, normalizedDuration),
                    title: song.name,
                    description: undefined,
                    artists: trackArtists,
                    album: song.album?.name,
                    releaseDate: undefined,
                    duration: song.duration ? normalizedDuration : undefined,
                    imageUrl: song.thumbnails && song.thumbnails.length > 0 ? song.thumbnails[0].url : undefined,
                    externalIds: externalIds,
                    explicit: undefined,
                };
                parsedTracks.push(syncFmSong);
            });

            const externalIds: SyncFMExternalIdMap = { YouTube: ytMusicAlbum.albumId };

            const syncFMAlbum: SyncFMAlbum = {
                syncId: generateSyncId(ytMusicAlbum.name, normalizedArtists, totalDuration),
                title: ytMusicAlbum.name,
                artists: normalizedArtists,
                releaseDate: undefined,
                imageUrl: ytMusicAlbum.thumbnails && ytMusicAlbum.thumbnails.length > 0 ? ytMusicAlbum.thumbnails[0].url : undefined,
                externalIds: externalIds,
                duration: totalDuration,
                songs: parsedTracks,
                totalTracks: totalTracks,
            };

            scope.success({ totalTracks, totalDuration });
            return syncFMAlbum;
        } catch (error) {
            scope.error(error, { id });
            throw error;
        }
    }

    private internal_YTMSongToSyncFMSong(ytMusicSong: YouTubeMusicSong): SyncFMSong {
        const externalIds: SyncFMExternalIdMap = { YouTube: ytMusicSong.videoId };
        const normalizedDuration = ytMusicSong.duration
            ? parseDurationWithFudge(ytMusicSong.duration * 1000)
            : 0;
        const trackArtists = ytMusicSong.artist ? [ytMusicSong.artist.name] : [];

        const syncFmSong: SyncFMSong = {
            syncId: generateSyncId(ytMusicSong.name, trackArtists, normalizedDuration),
            title: ytMusicSong.name,
            description: undefined,
            artists: trackArtists,
            album: undefined,
            releaseDate: undefined,
            duration: ytMusicSong.duration ? normalizedDuration : undefined,
            imageUrl: ytMusicSong.thumbnails[0]?.url,
            externalIds: externalIds,
            explicit: undefined,
        };
        StreamingDebug.log("YouTubeMusicService", "internal_YTMSongToSyncFMSong", "info", {
            meta: {
                videoId: ytMusicSong.videoId,
                duration: normalizedDuration,
                artistCount: trackArtists.length,
            },
        });
        return syncFmSong;
    }

    async getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong & { __usedFallback?: boolean }> {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getSongBySearchQuery", {
            query,
            expectedSyncId,
        });
        const ytmusic = await this.getInstance();
        let searchResults: YouTubeMusicSong[];
        try {
            searchResults = await ytmusic.searchSongs(query);
            scope.event("info", { stage: "search-results", count: searchResults.length });
        } catch (error) {
            scope.error(error, { stage: "search" });
            throw new Error("YouTube Music search failed");
        }
        if (searchResults.length === 0) {
            throw new Error("No results found");
        }

        if (expectedSyncId && searchResults.length > 1) {
            const topResults = searchResults.slice(0, Math.min(3, searchResults.length));

            for (const result of topResults) {
                const candidate = this.internal_YTMSongToSyncFMSong(result as unknown as YouTubeMusicSong);
                if (candidate.syncId === expectedSyncId) {
                    scope.success({ matchedIndex: topResults.indexOf(result), usedFallback: false });
                    return candidate;
                }
            }

            const songResult = searchResults[0] as unknown as YouTubeMusicSong;
            const result = this.internal_YTMSongToSyncFMSong(songResult);
            scope.success({ matchedIndex: 0, usedFallback: true });
            return { ...result, __usedFallback: true };
        }

        const songResult = searchResults[0] as unknown as YouTubeMusicSong;
        scope.success({ matchedIndex: 0, usedFallback: false });
        return this.internal_YTMSongToSyncFMSong(songResult);
    }

    async getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist & { __usedFallback?: boolean }> {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getArtistBySearchQuery", {
            query,
            expectedSyncId,
        });
        const ytmusic = await this.getInstance();
        const searchResults = await ytmusic.searchArtists(query);
        scope.event("info", { stage: "search-results", count: searchResults.length });
        if (searchResults.length === 0) {
            throw new Error("No results found");
        }

        if (expectedSyncId && searchResults.length > 1) {
            const topResults = searchResults.slice(0, Math.min(3, searchResults.length));

            for (const result of topResults) {
                const candidate = await this.getArtistById(result.artistId);
                if (candidate.syncId === expectedSyncId) {
                    scope.success({ matchedId: result.artistId, usedFallback: false });
                    return candidate;
                }
            }

            const artistResult = searchResults[0];
            const result = await this.getArtistById(artistResult.artistId);
            scope.success({ matchedId: artistResult.artistId, usedFallback: true });
            return { ...result, __usedFallback: true };
        }

        const artistResult = searchResults[0];
        scope.success({ matchedId: artistResult.artistId, usedFallback: false });
        return this.getArtistById(artistResult.artistId);
    }

    async getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum & { __usedFallback?: boolean }> {
        const scope = StreamingDebug.scope("YouTubeMusicService", "getAlbumBySearchQuery", {
            query,
            expectedSyncId,
        });
        const ytmusic = await this.getInstance();
        const searchResults = await ytmusic.searchAlbums(query);
        scope.event("info", { stage: "search-results", count: searchResults.length });
        if (searchResults.length === 0) {
            throw new Error("No album results found on YouTube Music for the given query.");
        }

        if (expectedSyncId && searchResults.length > 1) {
            const topResults = searchResults.slice(0, Math.min(3, searchResults.length));

            for (const result of topResults) {
                const candidate = await this.getAlbumById(result.albumId);
                if (candidate.syncId === expectedSyncId) {
                    scope.success({ matchedId: result.albumId, usedFallback: false });
                    return candidate;
                }
            }

            const albumResult = searchResults[0];
            const result = await this.getAlbumById(albumResult.albumId);
            scope.success({ matchedId: albumResult.albumId, usedFallback: true });
            return { ...result, __usedFallback: true };
        }

        const albumResult = searchResults[0];
        scope.success({ matchedId: albumResult.albumId, usedFallback: false });
        return this.getAlbumById(albumResult.albumId);
    }

    private async getBrowseIdFromPlaylist(id: string): Promise<string> {
        const standard_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/json",
            "X-Goog-AuthUser": "0",
            origin: "https://music.youtube.com",
            "X-Goog-Visitor-Id": "CgtWaTB2WWRDeEFUYyjhv-X8BQ%3D%3D"
        };
        const endpoint = "https://music.youtube.com/playlist";

        const scope = StreamingDebug.scope("YouTubeMusicService", "getBrowseIdFromPlaylist", { id });
        try {
            const response = await axios.get(endpoint, {
                headers: standard_headers,
                params: {
                    list: id
                }
            });

            const match = response.data.match(/"MPRE[_a-zA-Z0-9]+/);
            if (!match) {
                throw new Error("Could not find browseId from playlist");
            }

            const albumId = match[0].substr(1);
            scope.success({ albumId });
            return albumId;
        } catch (error) {
            scope.error(error, { id });
            throw error;
        }
    }
}

export { YouTubeMusicURL };

interface YouTubeMusicSong {
    type: "SONG";
    name: string;
    videoId: string;
    artist: {
        artistId: string;
        name: string;
    };
    album: {
        name: string;
        albumId: string;
    };
    duration: number;
    thumbnails: {
        url: string;
        width: number;
        height: number;
    }[];
}