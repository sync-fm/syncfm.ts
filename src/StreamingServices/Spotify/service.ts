import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Track, Album } from '@spotify/web-api-ts-sdk';
import type { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../../types/syncfm';
import { generateSyncArtistId, generateSyncId, parseDurationWithFudge } from '../../utils';
import { StreamingService } from '../StreamingService';
import { SpotifyURL } from './url';
import { StreamingDebug } from '../debug';

export class SpotifyService extends StreamingService<SpotifyURL, string> {
    public readonly Url = SpotifyURL;

    private readonly clientId: string;
    private readonly clientSecret: string;
    public sdk: SpotifyApi;

    constructor(clientId: string, clientSecret: string) {
        super();
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.sdk = this.initializeSpotifyApi(this.clientId, this.clientSecret);
        StreamingDebug.log('SpotifyService', 'constructor', 'info', {
            meta: {
                hasClientId: Boolean(clientId),
                hasClientSecret: Boolean(clientSecret),
            },
        });
    }

    initializeSpotifyApi(SpotifyClientId?: string, SpotifyClientSecret?: string): SpotifyApi {
        const scope = StreamingDebug.scope('SpotifyService', 'initializeSpotifyApi', {
            hasExistingSdk: Boolean(this.sdk),
            providedClientId: Boolean(SpotifyClientId),
        });
        try {
            if (!this.sdk) {
                const clientId = SpotifyClientId;
                const clientSecret = SpotifyClientSecret;

                if (!clientId || !clientSecret) {
                    throw new Error("Spotify client ID or secret not configured in environment variables.");
                }
                this.sdk = SpotifyApi.withClientCredentials(clientId, clientSecret);
                scope.event('info', { stage: 'created-sdk' });
            } else {
                scope.event('cache-hit', { stage: 'reuse-sdk' });
            }
            scope.success({ hasSdk: Boolean(this.sdk) });
            return this.sdk;
        } catch (error) {
            scope.error(error, { hasExistingSdk: Boolean(this.sdk) });
            throw error;
        }
    }

    async getSongById(id: string): Promise<SyncFMSong> {
        const scope = StreamingDebug.scope('SpotifyService', 'getSongById', { id });
        try {
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
            scope.success({
                artistCount: syncFmSong.artists.length,
                duration: syncFmSong.duration,
                album: syncFmSong.album,
            });
            return syncFmSong;
        } catch (error) {
            scope.error(error, { id });
            throw error;
        }
    };

    async getArtistById(id: string): Promise<SyncFMArtist> {
        const scope = StreamingDebug.scope('SpotifyService', 'getArtistById', { id });
        try {
            const spotifyArtist = await this.sdk.artists.get(id);

            const externalIds: SyncFMExternalIdMap = { Spotify: spotifyArtist.id };

            const syncFmArtist: SyncFMArtist = {
                syncId: generateSyncArtistId(spotifyArtist.name),
                name: spotifyArtist.name,
                imageUrl: spotifyArtist.images[0]?.url,
                externalIds: externalIds,
                genre: spotifyArtist.genres,
            };
            scope.success({ genreCount: spotifyArtist.genres.length, hasImage: Boolean(spotifyArtist.images[0]?.url) });
            return syncFmArtist;
        } catch (error) {
            scope.error(error, { id });
            throw error;
        }
    }

    async getAlbumById(id: string): Promise<SyncFMAlbum> {
        const scope = StreamingDebug.scope('SpotifyService', 'getAlbumById', { id });
        try {
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
            scope.success({
                songCount: songs.length,
                totalDuration: albumTotalDuration,
                genres: spotifyAlbum.genres.length,
            });
            return syncFmAlbum;
        } catch (error) {
            scope.error(error, { id });
            throw error;
        }
    }

    async getSongBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMSong & { __usedFallback?: boolean }> {
        const scope = StreamingDebug.scope('SpotifyService', 'getSongBySearchQuery', { query, expectedSyncId });
        try {
            const searchResult = await this.sdk.search(query, ["track"], undefined, expectedSyncId ? 3 : 1);
            scope.event('info', { stage: 'search-results', count: searchResult.tracks.items.length });

            if (searchResult.tracks.items.length > 0) {
                let usedFallback = false;

                if (expectedSyncId && searchResult.tracks.items.length > 1) {
                    for (const track of searchResult.tracks.items) {
                        const candidate = await this.getSongById(track.id);
                        if (candidate.syncId === expectedSyncId) {
                            scope.success({ matchedId: track.id, usedFallback: false });
                            return candidate;
                        }
                    }

                    usedFallback = true;
                } else if (expectedSyncId) {
                    usedFallback = true;
                }

                const spotifySong: Track = searchResult.tracks.items[0];
                const result = await this.getSongById(spotifySong.id);

                if (usedFallback) {
                    scope.success({ matchedId: spotifySong.id, usedFallback: true });
                    return { ...result, __usedFallback: true };
                }

                scope.success({ matchedId: spotifySong.id, usedFallback: false });
                return result;
            }
            throw new Error("No song found");
        } catch (error) {
            scope.error(error, { query, expectedSyncId });
            throw error;
        }
    }

    async getArtistBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMArtist & { __usedFallback?: boolean }> {
        const scope = StreamingDebug.scope('SpotifyService', 'getArtistBySearchQuery', { query, expectedSyncId });
        try {
            const searchResult = await this.sdk.search(query, ["artist"], undefined, expectedSyncId ? 3 : 1);
            scope.event('info', { stage: 'search-results', count: searchResult.artists.items.length });

            if (searchResult.artists.items.length > 0) {
                let usedFallback = false;

                if (expectedSyncId && searchResult.artists.items.length > 1) {
                    for (const artist of searchResult.artists.items) {
                        const candidate = await this.getArtistById(artist.id);
                        if (candidate.syncId === expectedSyncId) {
                            scope.success({ matchedId: artist.id, usedFallback: false });
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
                    scope.success({ matchedId: spotifyArtist.id, usedFallback: true });
                    return { ...result, __usedFallback: true };
                }

                scope.success({ matchedId: spotifyArtist.id, usedFallback: false });
                return result;
            }
            throw new Error("No artist found");
        } catch (error) {
            scope.error(error, { query, expectedSyncId });
            throw error;
        }
    }

    async getAlbumBySearchQuery(query: string, expectedSyncId?: string): Promise<SyncFMAlbum & { __usedFallback?: boolean }> {
        const scope = StreamingDebug.scope('SpotifyService', 'getAlbumBySearchQuery', { query, expectedSyncId });
        try {
            const searchResult = await this.sdk.search(query, ["album"], undefined, expectedSyncId ? 3 : 3);
            scope.event('info', { stage: 'search-results', count: searchResult.albums.items.length });

            if (searchResult.albums.items.length > 0) {
                let usedFallback = false;

                if (expectedSyncId && searchResult.albums.items.length > 1) {
                    for (const album of searchResult.albums.items) {
                        if (album?.id) {
                            const candidate = await this.getAlbumById(album.id);
                            if (candidate.syncId === expectedSyncId) {
                                scope.success({ matchedId: album.id, usedFallback: false });
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
                        scope.success({ matchedId: spotifyAlbum.id, usedFallback: true });
                        return { ...result, __usedFallback: true };
                    }

                    scope.success({ matchedId: spotifyAlbum.id, usedFallback: false });
                    return result;
                }
            }
            throw new Error("No album found for the given query.");
        } catch (error) {
            scope.error(error, { query, expectedSyncId });
            throw error;
        }
    }

}

export { SpotifyURL };
