import { SpotifyApi, Track, Album } from '@spotify/web-api-ts-sdk';
import { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../../types/syncfm';
import { generateSyncArtistId, generateSyncId, parseDurationWithFudge } from '../../utils';
import { StreamingService, MusicEntityType } from '../StreamingService';

export class SpotifyService extends StreamingService {
    private readonly clientId: string;
    private readonly clientSecret: string;
    public sdk: SpotifyApi;

    constructor(clientId: string, clientSecret: string) {
        super();
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.sdk = this.initializeSpotifyApi(this.clientId, this.clientSecret);
    }

    initializeSpotifyApi(SpotifyClientId?: string, SpotifyClientSecret?: string): SpotifyApi {
        if (!this.sdk) {
            const clientId = SpotifyClientId;
            const clientSecret = SpotifyClientSecret;

            if (!clientId || !clientSecret) {
                throw new Error("Spotify client ID or secret not configured in environment variables.");
            }
            this.sdk = SpotifyApi.withClientCredentials(clientId, clientSecret);
        }
        return this.sdk;
    }

    async getSongById(id: string): Promise<SyncFMSong> {
        const spotifySong: Track = await this.sdk.tracks.get(id);
        const externalIds: SyncFMExternalIdMap = { Spotify: spotifySong.id };

        const syncFmSong: SyncFMSong = {
            syncId: generateSyncId(spotifySong.name, spotifySong.artists.map(a => a.name), parseDurationWithFudge(spotifySong.duration_ms)),
            title: spotifySong.name,
            description: undefined,
            artists: spotifySong.artists.map(a => a.name),
            album: spotifySong.album.name,
            releaseDate: new Date(spotifySong.album.release_date),
            duration: parseDurationWithFudge(spotifySong.duration_ms),
            imageUrl: spotifySong.album.images[0]?.url,
            externalIds: externalIds,
            explicit: spotifySong.explicit,
        };
        return syncFmSong;
    };

    async getArtistById(id: string): Promise<SyncFMArtist> {
        const spotifyArtist = await this.sdk.artists.get(id);

        const externalIds: SyncFMExternalIdMap = { Spotify: spotifyArtist.id };

        const syncFmArtist: SyncFMArtist = {
            syncId: generateSyncArtistId(spotifyArtist.name),
            name: spotifyArtist.name,
            imageUrl: spotifyArtist.images[0]?.url,
            externalIds: externalIds,
            genre: spotifyArtist.genres,
        };
        return syncFmArtist;
    }

    async getAlbumById(id: string): Promise<SyncFMAlbum> {
        const spotifyAlbum: Album = await this.sdk.albums.get(id);
        const externalIds: SyncFMExternalIdMap = { Spotify: spotifyAlbum.id };
        const albumArtists = spotifyAlbum.artists.map(a => a.name);

        let songs: SyncFMSong[] = [];
        if (spotifyAlbum.tracks.items.length > 0) {
            songs = spotifyAlbum.tracks.items.map(track => {
                const trackArtists = track.artists.map(a => a.name);

                const songDuration = parseDurationWithFudge(track.duration_ms);

                const externalTrackIds: SyncFMExternalIdMap = { Spotify: track.id };

                return {
                    syncId: generateSyncId(track.name, trackArtists, songDuration),
                    title: track.name,
                    artists: trackArtists,
                    album: spotifyAlbum.name,
                    releaseDate: new Date(spotifyAlbum.release_date),
                    duration: parseDurationWithFudge(track.duration_ms),
                    imageUrl: spotifyAlbum.images[0]?.url,
                    externalIds: externalTrackIds,
                    explicit: track.explicit,
                    description: undefined,
                };
            });
        }

        const albumTotalDuration = songs.reduce((sum, song) => sum + (song.duration || 0), 0);

        const syncFmAlbum: SyncFMAlbum = {
            syncId: generateSyncId(spotifyAlbum.name, albumArtists, albumTotalDuration),
            title: spotifyAlbum.name,
            description: undefined,
            artists: albumArtists,
            releaseDate: spotifyAlbum.release_date,
            imageUrl: spotifyAlbum.images[0]?.url,
            externalIds: externalIds,
            songs: songs,
            totalTracks: spotifyAlbum.total_tracks,
            duration: albumTotalDuration > 0 ? albumTotalDuration : undefined,
            label: spotifyAlbum.label,
            genres: spotifyAlbum.genres,
            explicit: songs.some(song => song.explicit),
        };
        return syncFmAlbum;
    }

    async getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong & { __usedFallback?: boolean }> {
        const searchResult = await this.sdk.search(query, ["track"], undefined, expectedSyncId ? 3 : 1);

        if (searchResult.tracks.items.length > 0) {
            let usedFallback = false;

            // If we have an expected syncId, try to find the best match
            if (expectedSyncId && searchResult.tracks.items.length > 1) {
                for (const track of searchResult.tracks.items) {
                    const candidate = await this.getSongById(track.id);
                    if (candidate.syncId === expectedSyncId) {
                        return candidate;
                    }
                }

                usedFallback = true;
            } else if (expectedSyncId) {
                usedFallback = true;
            }

            const spotifySong: Track = searchResult.tracks.items[0];
            const result = await this.getSongById(spotifySong.id);

            // Add a marker to track that this used fallback
            if (usedFallback) {
                return { ...result, __usedFallback: true };
            }

            return result;
        }
        throw new Error("No song found");
    }

    async getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist & { __usedFallback?: boolean }> {
        const searchResult = await this.sdk.search(query, ["artist"], undefined, expectedSyncId ? 3 : 1);

        if (searchResult.artists.items.length > 0) {
            let usedFallback = false;

            // If we have an expected syncId, try to find the best match
            if (expectedSyncId && searchResult.artists.items.length > 1) {
                for (const artist of searchResult.artists.items) {
                    const candidate = await this.getArtistById(artist.id);
                    if (candidate.syncId === expectedSyncId) {
                        return candidate;
                    }
                }

                usedFallback = true;
            } else if (expectedSyncId) {
                usedFallback = true;
            }

            const spotifyArtist = searchResult.artists.items[0];
            const result = await this.getArtistById(spotifyArtist.id);

            if (usedFallback) {
                return { ...result, __usedFallback: true };
            }

            return result;
        }
        throw new Error("No artist found");
    }

    async getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum & { __usedFallback?: boolean }> {
        const searchResult = await this.sdk.search(query, ["album"], undefined, expectedSyncId ? 3 : 3);

        if (searchResult.albums.items.length > 0) {
            let usedFallback = false;

            // If we have an expected syncId, try to find the best match
            if (expectedSyncId && searchResult.albums.items.length > 1) {
                for (const album of searchResult.albums.items) {
                    if (album?.id) {
                        const candidate = await this.getAlbumById(album.id);
                        if (candidate.syncId === expectedSyncId) {
                            return candidate;
                        }
                    }
                }

                usedFallback = true;
            } else if (expectedSyncId) {
                usedFallback = true;
            }

            const spotifyAlbum = searchResult.albums.items[0];
            if (spotifyAlbum?.id) {
                const result = await this.getAlbumById(spotifyAlbum.id);

                if (usedFallback) {
                    return { ...result, __usedFallback: true };
                }

                return result;
            }
        }
        throw new Error("No album found for the given query.");
    }

    getIdFromUrl(url: string): string | null {
        try {
            const path = new URL(url).pathname;
            const parts = path.split('/');
            // The ID is usually the last part of the path
            const id = parts.pop();
            return id || null;
        } catch (error) {
            console.error("Invalid URL for Spotify", error);
            return null;
        }
    }

    async getTypeFromUrl(url: string): Promise<MusicEntityType | null> {
        try {
            const path = new URL(url).pathname;
            const parts = path.split('/');
            if (parts.length > 1) {
                const type = parts[parts.length - 2];
                switch (type) {
                    case 'track':
                        return 'song';
                    case 'artist':
                        return 'artist';
                    case 'album':
                        return 'album';
                    case 'playlist':
                        return 'playlist';
                }
            }
            return null;
        } catch (error) {
            console.error("Invalid URL for Spotify", error);
            return null;
        }
    }

    createUrl(id: string, type: MusicEntityType): string {
        const typePath = type === 'song' ? 'track' : type;
        return `https://open.spotify.com/${typePath}/${id}`;
    }
}
