import { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../types/syncfm';
import { generateSyncId, generateSyncArtistId } from '../utils';
import { StreamingService, MusicEntityType } from './StreamingService';

// Internal Types
interface AppleMusicSong {
  name: string;
  url: string;
  datePublished: string;
  description: string; // AM Marketing description
  timeRequired: string; // ISO 8601 duration format.
  image: string; // URL to the song image
  audio?: AppleMusicAudioInfo;
  video?: AppleMusicVideoInfo[];
  lyrics?: AppleMusicLyricsShortInfo;
}

interface AppleMusicArtistShortInfo {
  name: string; // artist name
  url: string; // URL to the artist
}

interface AppleMusicLyricsShortInfo {
  text: string; // lyrics text
}

interface AppleMusicAudioInfo {
  name: string; // song name
  url: string; // URL to the song
  datePublished: string; // date published
  description: string; // AM Marketing description
  duration: string; // ISO 8601 duration format.
  image: string; // URL to the song image
  byArtist: AppleMusicArtistShortInfo[];
  album?: {
    image: string; // URL to the album image
    name: string; // album name
    url: string; // URL to the album
    byArtist: AppleMusicArtistShortInfo[]; // album artist
  };
  audio?: {
    name: string; // song name
    contentUrl: string; // URL to the song preview (m4a)
    description: string; // AM Marketing description
    duration: string; // ISO 8601 duration format.
    uploadDate: string; // date published
    thumbnailUrl: string; // URL to the song thumbnail
  },
  genre?: string[]; // genre of the song
}

interface AppleMusicVideoInfo {
  name: string; // video name, might be the same as the song name
  contentUrl: string; // URL to the video - some kind of preview 
  description: string; // AM Marketing description
  duration: string; // ISO 8601 duration format.
  embedUrl: string; // URL to the video - some kind of preview
  thumbnailUrl: string; // URL to the video thumbnail
}

export class AppleMusicService extends StreamingService {
    async getSongById(id: string): Promise<SyncFMSong> {
        const url = this.createUrl(id, "song");
        const rawSongData = await this.getSongDataFromUrl(url);

        const externalIds: SyncFMExternalIdMap = { AppleMusic: id };

        const syncFmSong: SyncFMSong = {
            syncId: generateSyncId(rawSongData.audio?.name || rawSongData.name, rawSongData.audio?.byArtist?.map(a => a.name) || [], this.parseISO8601Duration(rawSongData.audio?.duration || rawSongData.timeRequired)),
            title: rawSongData.audio?.name || rawSongData.name,
            description: rawSongData.audio?.description || rawSongData.description,
            artists: rawSongData.audio?.byArtist?.map(a => a.name) || [],
            album: rawSongData.audio?.album?.name,
            releaseDate: new Date(rawSongData.audio?.datePublished),
            duration: this.parseISO8601Duration(rawSongData.audio?.duration || rawSongData.timeRequired),
            imageUrl: rawSongData.audio?.album?.image || rawSongData.audio?.image || rawSongData.image,
            externalIds: externalIds,
            explicit: undefined,
        };
        return syncFmSong;
    }

    async getArtistById(id: string): Promise<SyncFMArtist> {
        try {
            const response = await fetch(this.createUrl(id, "artist"));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();

            const embeddedArtistInfo = html.split(`<script id=schema:music-group type="application/ld+json">`)[1]?.split(`</script>`)[0];
            const trimmedArtistInfo = embeddedArtistInfo?.trim();
            if (trimmedArtistInfo) {
                const jsonData = JSON.parse(trimmedArtistInfo);
                const tracks = jsonData.tracks?.map((track: any) => ({
                    title: track.name,
                    duration: this.parseISO8601Duration(track.duration),
                    thumbnailUrl: track.audio.thumbnailUrl,
                    uploadDate: track.audio.uploadDate,
                    contentUrl: track.audio.contentUrl,
                })) || []
                const artist: SyncFMArtist = {
                    syncId: generateSyncArtistId(jsonData.name),
                    name: jsonData.name,
                    imageUrl: jsonData.image,
                    externalIds: {
                        AppleMusic: id,
                    },
                    genre: jsonData.genre || [],
                    tracks: tracks.slice(0, 5),
                }
                return artist;
            } else {
                throw new Error('Could not find artist data in HTML');
            }
        } catch (error) {
            console.error('Error fetching or parsing artist data:', error);
            throw error;
        }
    }

    async getAlbumById(id: string): Promise<SyncFMAlbum> {
        try {
            const response = await fetch(this.createUrl(id, "album"));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();

            const embeddedAlbumInfo = html.split(`<script id=schema:music-album type="application/ld+json">`)[1]?.split(`</script>`)[0];
            const trimmedAlbumInfo = embeddedAlbumInfo?.trim();
            if (trimmedAlbumInfo) {
                const jsonData = JSON.parse(trimmedAlbumInfo);

                const albumArtists = jsonData.byArtist?.map((artist: any) => artist.name) || [];

                const songs: SyncFMSong[] = (jsonData.tracks || []).map((track: any) => {
                    const songDuration = this.parseISO8601Duration(track.duration);
                    const appleMusicSongId = track.url?.split('/').pop();

                    const externalSongIds: SyncFMExternalIdMap = {};
                    if (appleMusicSongId) {
                        externalSongIds.AppleMusic = appleMusicSongId;
                    }

                    return {
                        syncId: generateSyncId(track.name, albumArtists, songDuration),
                        title: track.name,
                        artists: albumArtists,
                        album: jsonData.name,
                        releaseDate: track.audio?.uploadDate || jsonData.datePublished,
                        duration: songDuration,
                        imageUrl: track.audio?.thumbnailUrl || jsonData.image,
                        externalIds: externalSongIds,
                        explicit: undefined,
                        description: undefined,
                    };
                });

                const albumTotalDuration = songs.reduce((sum, song) => sum + (song.duration || 0), 0);

                const syncFmAlbum: SyncFMAlbum = {
                    syncId: generateSyncId(jsonData.name, albumArtists, albumTotalDuration),
                    title: jsonData.name,
                    description: jsonData.description,
                    artists: albumArtists,
                    releaseDate: jsonData.datePublished,
                    imageUrl: jsonData.image,
                    externalIds: { AppleMusic: id },
                    songs: songs,
                    totalTracks: jsonData.tracks?.length || 0,
                    duration: albumTotalDuration > 0 ? albumTotalDuration : undefined,
                    label: undefined,
                    genres: jsonData.genre || [],
                    explicit: undefined,
                };

                return syncFmAlbum;
            } else {
                throw new Error('Could not find album data in HTML');
            }
        } catch (error) {
            console.error('Error fetching or parsing album data:', error);
            throw error;
        }
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

    private async searchForId(query: string, type: "songs" | "artists" | "albums"): Promise<string> {
        try {
            const url = "https://music.apple.com/us/search?term=" + encodeURIComponent(query);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            const embeddedSongInfo = html.split(`<script type="application/json" id="serialized-server-data">`)[1]?.split(`</script>`)[0];
            const trimmedSongInfo = embeddedSongInfo?.trim();
            if (trimmedSongInfo) {
                const jsonData = JSON.parse(trimmedSongInfo);

                const firstResult = jsonData[0]?.data?.sections[0].items?.find((item: any) => item.itemKind === type);

                if (!firstResult) {
                    throw new Error(`Could not find ${type} in search result`);
                }

                const id = firstResult?.contentDescriptor?.identifiers?.storeAdamId || firstResult?.contentDescriptor?.identifiers?.storeAdamID;
                if (!id) {
                    throw new Error(`Could not find id in search result for ${type}`);
                }
                return id.toString();
            } else {
                throw new Error('Could not find song data in HTML');
            }
        } catch (error) {
            console.error('Error fetching or parsing song data:', error);
            throw error;
        }
    }


    getIdFromUrl(url: string): string | null {
        try {
            const parsedUrl = new URL(url);
            
            // For songs, the ID is always in the 'i' query parameter
            const songId = parsedUrl.searchParams.get('i');
            if (songId) {
                return songId;
            }

            // For albums/artists, it's the last numeric part of the path
            const pathParts = parsedUrl.pathname.split('/');
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
            const pathParts = new URL(url).pathname.split('/');
            const potentialTypes: MusicEntityType[] = ['song', 'album', 'artist', 'playlist'];
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
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();

            const embeddedSongInfo = html.split(`<script id=schema:song type="application/ld+json">`)[1]?.split(`</script>`)[0];
            const trimmedSongInfo = embeddedSongInfo?.trim();
            if (trimmedSongInfo) {
                const jsonData = JSON.parse(trimmedSongInfo);
                return jsonData;
            } else {
                throw new Error('Could not find song data in HTML');
            }
        } catch (error) {
            console.error('Error fetching or parsing song data:', error);
            throw error;
        }
    }

    private parseISO8601Duration(durationString: string | undefined): number | undefined {
        if (!durationString) return undefined;
        const match = durationString.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
        if (!match) {
            console.warn(`Could not parse ISO 8601 duration: ${durationString}`);
            return undefined;
        }
        const hours = parseInt(match[1] || '0', 10);
        const minutes = parseInt(match[2] || '0', 10);
        const seconds = parseFloat(match[3] || '0');
        return hours * 3600 + minutes * 60 + seconds;
    }
}

