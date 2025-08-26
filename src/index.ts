import { Database } from './database';
import { AppleMusicService } from './StreamingServices/AppleMusic';
import { SpotifyService } from './StreamingServices/Spotify';
import { YouTubeMusicService } from './StreamingServices/YouTubeMusic';
import { StreamingService, MusicEntityType } from './StreamingServices/StreamingService';
import { SyncFMArtist, SyncFMSong, SyncFMConfig, SyncFMExternalIdMapToDesiredService, SyncFMAlbum } from './types/syncfm';
import { normalizeAlbumData, normalizeSongData } from './utils';

export * from './types/syncfm';
export * from './types/StreamingService';

type ServiceName = "applemusic" | "spotify" | "ytmusic";

export class SyncFM {
    private readonly config: SyncFMConfig;
    private services: Map<ServiceName, StreamingService>;
    private Database: Database;

    constructor(config: SyncFMConfig) {
        this.config = config;

        if (!this.config.SpotifyClientId || !this.config.SpotifyClientSecret) {
            throw new Error("Spotify Client ID and Secret not provided. Spotify functionality will be limited.");
        }
        if (!this.config.SupabaseUrl || !this.config.SupabaseKey) {
            throw new Error("Supabase URL and Key not provided. Database functionality will be limited.");
        }

        this.Database = new Database(this.config.SupabaseUrl, this.config.SupabaseKey);

        this.services = new Map<ServiceName, StreamingService>();
        this.services.set('spotify', new SpotifyService(this.config.SpotifyClientId, this.config.SpotifyClientSecret));
        this.services.set('applemusic', new AppleMusicService());
        this.services.set('ytmusic', new YouTubeMusicService());
    }

    private getService(name: ServiceName): StreamingService {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Unsupported streaming service: ${name}`);
        }
        return service;
    }

    getStreamingServiceFromUrl = (url: string): ServiceName | null => {
        if (url.includes('apple.com')) return 'applemusic';
        if (url.includes('spotify.com')) return 'spotify';
        if (url.includes('youtube.com') || url.includes('music.youtube.com')) return 'ytmusic';
        return null;
    }

    getInputTypeFromUrl = (url: string): MusicEntityType | null => {
        const serviceName = this.getStreamingServiceFromUrl(url);
        if (!serviceName) {
            throw new Error("Could not determine service from URL");
        }
        const service = this.getService(serviceName);
        return service.getTypeFromUrl(url);
    }

    // eslint-disable-next-line no-unused-vars
    private async getInputInfo<T>(input: string, getter: (params: { service: StreamingService, id: string }) => Promise<T>): Promise<T> {
        const serviceName = this.getStreamingServiceFromUrl(input);
        if (!serviceName) throw new Error("Unsupported streaming service URL");
        const service = this.getService(serviceName);
        const id = service.getIdFromUrl(input);
        if (!id) throw new Error("Could not extract ID from URL");
        return getter({ service, id });
    }

    getInputSongInfo = async (input: string): Promise<SyncFMSong> => {
        return this.getInputInfo(input, ({ service, id }) => service.getSongById(id));
    }

    getInputArtistInfo = async (input: string): Promise<SyncFMArtist> => {
        return this.getInputInfo(input, ({ service, id }) => service.getArtistById(id));
    }

    getInputAlbumInfo = async (input: string): Promise<SyncFMAlbum> => {
        return this.getInputInfo(input, ({ service, id }) => service.getAlbumById(id));
    }

    convertSong = async (songInfo: SyncFMSong, desiredService: ServiceName): Promise<SyncFMSong> => {
        let dbSong = await this.Database.getSongBySyncId(songInfo.syncId);
        if (dbSong) {
            if (dbSong.externalIds && dbSong.externalIds[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbSong;
            }
        }

        const service = this.getService(desiredService);
        const normalizedSongData = normalizeSongData(songInfo);
        const convertedSong = await service.getSongBySearchQuery(`${normalizedSongData.cleanTitle} ${normalizedSongData.allArtists.join(", ")}`);

        dbSong = await this.Database.upsertSong(songInfo);
        return { ...convertedSong, ...dbSong };
    }

    convertArtist = async (artistInfo: SyncFMArtist, desiredService: ServiceName): Promise<SyncFMArtist> => {
        let dbArtist = await this.Database.getArtistBySyncId(artistInfo.syncId);
        if (dbArtist) {
            if (dbArtist.externalIds && dbArtist.externalIds[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbArtist;
            }
        }

        const service = this.getService(desiredService);
        const convertedArtist = await service.getArtistBySearchQuery(artistInfo.name);

        dbArtist = await this.Database.upsertArtist(convertedArtist);
        return { ...convertedArtist, ...dbArtist };
    }

    convertAlbum = async (albumInfo: SyncFMAlbum, desiredService: ServiceName): Promise<SyncFMAlbum> => {
        let dbAlbum = await this.Database.getAlbumBySyncId(albumInfo.syncId);
        if (dbAlbum) {
            if (dbAlbum.externalIds && dbAlbum.externalIds[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbAlbum;
            }
        }

        const service = this.getService(desiredService);
        const normalizedAlbum = normalizeAlbumData(albumInfo);
        const searchQuery = `${normalizedAlbum.cleanTitle} ${normalizedAlbum.allArtists ? normalizedAlbum.allArtists.join(" ") : ""}`;
        const convertedAlbum = await service.getAlbumBySearchQuery(searchQuery);

        dbAlbum = await this.Database.upsertAlbum(convertedAlbum);
        return { ...convertedAlbum, ...dbAlbum };
    }

    private createURL(item: { externalIds: any }, serviceName: ServiceName, type: MusicEntityType): string {
        const service = this.getService(serviceName);
        const serviceKey = SyncFMExternalIdMapToDesiredService[serviceName];
        const id = item.externalIds[serviceKey];
        if (!id) {
            throw new Error(`External ID for ${serviceName} not found on the provided object.`);
        }
        return service.createUrl(id, type);
    }

    createSongURL = (song: SyncFMSong, service: ServiceName): string => {
        return this.createURL(song, service, "song");
    }

    createArtistURL = (artist: SyncFMArtist, service: ServiceName): string => {
        return this.createURL(artist, service, "artist");
    }

    createAlbumURL = (album: SyncFMAlbum, service: ServiceName): string => {
        return this.createURL(album, service, "album");
    }
}
