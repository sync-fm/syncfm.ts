import YTMusic, { type AlbumFull } from "@syncfm/ytmusic-api";
import Youtube, { type YoutubeVideo } from "youtube.ts";
import type { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../types/syncfm';
import { generateSyncArtistId, generateSyncId, parseDurationWithFudge } from '../utils';
import axios from "axios";
import { StreamingService, type MusicEntityType } from './StreamingService';

export class YouTubeMusicService extends StreamingService {
    private ytmusic!: YTMusic;
    private youtube?: Youtube;
    private ytmusicApiKey: string | undefined;

    constructor(YoutubeAPIKey?: string) {
        super();
        this.ytmusicApiKey = YoutubeAPIKey;
    }

    async getInstance(): Promise<YTMusic> {
        if (!this.ytmusic) {
            this.ytmusic = new YTMusic();
            await this.ytmusic.initialize();
        }
        return this.ytmusic;
    }

    private getYouTubeInstance(): Youtube {
        if (!this.youtube) {
            // Get YouTube API key from environment variable
            if (!this.ytmusicApiKey) {
                throw new Error('YOUTUBE_API_KEY variable is required for YouTube.ts fallback');
            }
            this.youtube = new Youtube(this.ytmusicApiKey);
        }
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

        return syncFmSong;
    }

    async getSongById(id: string): Promise<SyncFMSong> {
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
            return syncFmSong;
        } catch (error) {
            // Check if the error is related to invalid video ID
            if (error instanceof Error && error.message.toLowerCase().includes('invalid video id')) {
                console.log(`Unofficial YTMusic API failed with invalid video ID for ${id}, falling back to YouTube.ts API`);

                try {
                    const youtube = this.getYouTubeInstance();
                    const video = await youtube.videos.get(id);

                    if (!video) {
                        throw new Error(`Video not found with ID: ${id}`);
                    }

                    return this.convertYouTubeVideoToSyncFMSong(video);
                } catch (fallbackError) {
                    console.error(`YouTube.ts API also failed for ${id}:`, fallbackError);
                    throw new Error(`Both APIs failed to fetch video ${id}: ${error.message} | ${fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error'}`);
                }
            }

            // Re-throw the original error if it's not an invalid video ID error
            throw error;
        }
    }

    async getArtistById(id: string): Promise<SyncFMArtist> {
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
        return syncFmArtist;
    }

    async getAlbumById(id: string): Promise<SyncFMAlbum> {
        const ytmusic = await this.getInstance();
        let ytMusicAlbum: AlbumFull;
        if (!id.startsWith("MPREb_")) {
            console.warn("Invalid YouTube Music album ID, attempting to get browseId");
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
        // biome-ignore lint/complexity/noForEach: <shh>
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

        return syncFMAlbum;
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
        return syncFmSong;
    }

    async getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong & { __usedFallback?: boolean }> {
        const ytmusic = await this.getInstance();
        let searchResults: YouTubeMusicSong[];
        try {
            searchResults = await ytmusic.searchSongs(query);
        } catch (error) {
            console.error("Error during YouTube Music search:", error);
            throw new Error("YouTube Music search failed");
        }
        if (searchResults.length === 0) {
            throw new Error("No results found");
        }

        // If we have an expected syncId, try to find the best match from top 3 results
        if (expectedSyncId && searchResults.length > 1) {
            const topResults = searchResults.slice(0, Math.min(3, searchResults.length));

            for (const result of topResults) {
                const candidate = this.internal_YTMSongToSyncFMSong(result as unknown as YouTubeMusicSong);
                if (candidate.syncId === expectedSyncId) {
                    return candidate;
                }
            }

            const songResult = searchResults[0] as unknown as YouTubeMusicSong;
            const result = this.internal_YTMSongToSyncFMSong(songResult);
            return { ...result, __usedFallback: true };
        }

        const songResult = searchResults[0] as unknown as YouTubeMusicSong;
        return this.internal_YTMSongToSyncFMSong(songResult);
    }

    async getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist & { __usedFallback?: boolean }> {
        const ytmusic = await this.getInstance();
        const searchResults = await ytmusic.searchArtists(query);
        if (searchResults.length === 0) {
            throw new Error("No results found");
        }

        // If we have an expected syncId, try to find the best match from top 3 results
        if (expectedSyncId && searchResults.length > 1) {
            const topResults = searchResults.slice(0, Math.min(3, searchResults.length));

            for (const result of topResults) {
                const candidate = await this.getArtistById(result.artistId);
                if (candidate.syncId === expectedSyncId) {
                    return candidate;
                }
            }

            const artistResult = searchResults[0];
            const result = await this.getArtistById(artistResult.artistId);
            return { ...result, __usedFallback: true };
        }

        const artistResult = searchResults[0];
        return this.getArtistById(artistResult.artistId);
    }

    async getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum & { __usedFallback?: boolean }> {
        const ytmusic = await this.getInstance();
        const searchResults = await ytmusic.searchAlbums(query);
        if (searchResults.length === 0) {
            throw new Error("No album results found on YouTube Music for the given query.");
        }

        // If we have an expected syncId, try to find the best match from top 3 results
        if (expectedSyncId && searchResults.length > 1) {
            const topResults = searchResults.slice(0, Math.min(3, searchResults.length));

            for (const result of topResults) {
                const candidate = await this.getAlbumById(result.albumId);
                if (candidate.syncId === expectedSyncId) {
                    return candidate;
                }
            }

            const albumResult = searchResults[0];
            const result = await this.getAlbumById(albumResult.albumId);
            return { ...result, __usedFallback: true };
        }

        const albumResult = searchResults[0];
        return this.getAlbumById(albumResult.albumId);
    }

    getIdFromUrl(url: string): string | null {
        try {
            const parsedUrl = new URL(url);
            const params = parsedUrl.searchParams;
            if (params.has('v')) return params.get('v');
            if (params.has('list')) return params.get('list');

            const pathname = parsedUrl.pathname;
            if (pathname.startsWith('/browse/')) {
                const parts = pathname.split('/');
                return parts[parts.length - 1] || null;
            }
            if (pathname.startsWith('/channel/')) {
                const parts = pathname.split('/');
                return parts[parts.length - 1] || null;
            }

            return null;
        } catch (error) {
            console.error("Invalid URL for YouTube Music", error);
            return null;
        }
    }

    async getTypeFromUrl(url: string): Promise<MusicEntityType | null> {
        try {
            const parsedUrl = new URL(url);
            const pathname = parsedUrl.pathname;

            if (pathname === '/watch') return 'song';
            if (pathname === '/playlist') return 'album';
            if (pathname.startsWith('/browse/')) return 'album';
            if (pathname.startsWith('/channel/')) return 'artist';

            return null;
        } catch (error) {
            console.error("Invalid URL for YouTube Music", error);
            return null;
        }
    }

    createUrl(id: string, type: MusicEntityType): string {
        switch (type) {
            case 'song':
                return `https://music.youtube.com/watch?v=${id}`;
            case 'album':
                return `https://music.youtube.com/browse/${id}`;
            case 'artist':
                return `https://music.youtube.com/channel/${id}`;
            case 'playlist':
                return `https://music.youtube.com/playlist?list=${id}`;
            default:
                throw new Error("Invalid type for YouTube Music URL");
        }
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
            return albumId;
        } catch (error) {
            console.error("Error fetching playlist:", error);
            throw error;
        }
    }
}

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