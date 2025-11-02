import { Database } from './database';
import { AppleMusicService } from './StreamingServices/AppleMusic';
import { SpotifyService } from './StreamingServices/Spotify';
import { YouTubeMusicService } from './StreamingServices/YouTubeMusic';
import type { StreamingService, MusicEntityType } from './StreamingServices/StreamingService';
import type { SyncFMArtist, SyncFMSong, SyncFMExternalIdMap, SyncFMAlbum, ServiceName, SyncFMConfig } from './types/syncfm';
import { SyncFMExternalIdMapToDesiredService } from './types/syncfm';
import { normalizeAlbumData, normalizeSongData } from './utils';
import { categorizeError, shouldRetryService, shouldRetryImmediately, sleep } from './types/errors';
import type { ConversionResult, ConversionError } from './types/errors';

export * from './types/syncfm';
export * from './types/StreamingService';
export * from './types/errors';

const SUPPORTED_SERVICES: ServiceName[] = ["applemusic", "spotify", "ytmusic"];

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

    __INTERNAL_getService(name: ServiceName): StreamingService {
        return this.getService(name);
    }

    getStreamingServiceFromUrl = (url: string): ServiceName | null => {
        if (url.includes('apple.com')) return 'applemusic';
        if (url.includes('spotify.com')) return 'spotify';
        if (url.includes('youtube.com') || url.includes('music.youtube.com')) return 'ytmusic';
        return null;
    }

    getInputTypeFromUrl = async (url: string): Promise<MusicEntityType> => {
        const serviceName = this.getStreamingServiceFromUrl(url);
        if (!serviceName) {
            throw new Error("Could not determine service from URL");
        }
        const service = this.getService(serviceName);
        const type = await service.getTypeFromUrl(url);
        if (!type) {
            throw new Error("Could not determine input type from URL");
        }
        return type;
    }

    // eslint-disable-next-line no-unused-vars
    private async _getInputInfo<T>(input: string, getter: (params: { service: StreamingService, id: string }) => Promise<T>): Promise<T> {
        const serviceName = this.getStreamingServiceFromUrl(input);
        if (!serviceName) throw new Error("Unsupported streaming service URL");
        const service = this.getService(serviceName);
        const id = service.getIdFromUrl(input);
        if (!id) throw new Error("Could not extract ID from URL");
        return getter({ service, id });
    }

    getInputSongInfo = async (input: string): Promise<SyncFMSong> => {
        return this._getInputInfo(input, ({ service, id }) => service.getSongById(id));
    }

    getInputArtistInfo = async (input: string): Promise<SyncFMArtist> => {
        return this._getInputInfo(input, ({ service, id }) => service.getArtistById(id));
    }

    getInputAlbumInfo = async (input: string): Promise<SyncFMAlbum> => {
        return this._getInputInfo(input, ({ service, id }) => service.getAlbumById(id));
    }

    getInputInfo = async <T = SyncFMAlbum | SyncFMArtist | SyncFMSong>(input: string, type: MusicEntityType): Promise<T> => {
        switch (type) {
            case 'song':
                return this.getInputSongInfo(input) as T
            case 'artist':
                return this.getInputArtistInfo(input) as T
            case 'album':
                return this.getInputAlbumInfo(input) as T
            default:
                throw new Error(`Unsupported input type: ${type}`);
        }
    }

    convertSong = async (songInfo: SyncFMSong, desiredService: ServiceName): Promise<SyncFMSong> => {
        try {
            return this.unifiedConvert(songInfo, desiredService, 'song');
        } catch (error) {
            console.error(error);
            throw new Error(`Could not convert song to desired service: ${desiredService}`);
        }
    }

    convertArtist = async (artistInfo: SyncFMArtist, desiredService: ServiceName): Promise<SyncFMArtist> => {
        try {
            return this.unifiedConvert(artistInfo, desiredService, 'artist');
        } catch (error) {
            console.error(error);
            throw new Error(`Could not convert artist to desired service: ${desiredService}`);
        }
    }

    convertAlbum = async (albumInfo: SyncFMAlbum, desiredService: ServiceName): Promise<SyncFMAlbum> => {
        try {
            return this.unifiedConvert(albumInfo, desiredService, 'album');
        } catch (error) {
            console.error(error);
            throw new Error(`Could not convert album to desired service: ${desiredService}`);
        }
    }

    private async invokeServiceMethod<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        serviceName: ServiceName,
        inputData: T,
        inputType: MusicEntityType,
        attemptNumber = 1
    ): Promise<ConversionResult<T>> {
        const service = this.getService(serviceName);

        try {
            let convertedData: T;

            switch (inputType) {
                case 'song': {
                    const songData = inputData as unknown as SyncFMSong;
                    const normalizedSongData = normalizeSongData(songData);
                    const query = `${normalizedSongData.cleanTitle} ${normalizedSongData.allArtists.join(", ")}`;
                    convertedData = await service.getSongBySearchQuery(query) as unknown as T;
                    break;
                }
                case 'album': {
                    const albumData = inputData as unknown as SyncFMAlbum;
                    const normalizedAlbumData = normalizeAlbumData(albumData);
                    const query = `${normalizedAlbumData.cleanTitle} ${normalizedAlbumData.allArtists ? normalizedAlbumData.allArtists.join(" ") : ""}`;
                    convertedData = await service.getAlbumBySearchQuery(query) as unknown as T;
                    break;
                }
                case 'artist': {
                    const artistData = inputData as unknown as SyncFMArtist;
                    convertedData = await service.getArtistBySearchQuery(artistData.name) as unknown as T;
                    break;
                }
                default: {
                    throw new Error(`Unsupported input type: ${inputType}`);
                }
            }

            if (!convertedData) {
                const { errorType, retryable } = categorizeError(new Error('No result returned'));
                const error: ConversionError = {
                    service: serviceName,
                    timestamp: new Date(),
                    errorType,
                    message: `No result from ${serviceName}`,
                    retryable,
                };
                return { service: serviceName, success: false, error };
            }

            return { service: serviceName, success: true, data: convertedData };

        } catch (err) {
            const { errorType, retryable } = categorizeError(err);

            // Check if we should retry immediately
            if (shouldRetryImmediately(errorType, attemptNumber)) {
                console.log(`Retrying ${serviceName} (attempt ${attemptNumber + 1}) due to ${errorType} error`);

                // Small delay before retry (exponential backoff: 500ms, 1000ms)
                const delayMs = 500 * attemptNumber;
                await sleep(delayMs);

                // Recursive retry
                return this.invokeServiceMethod(serviceName, inputData, inputType, attemptNumber + 1);
            }

            const error: ConversionError = {
                service: serviceName,
                timestamp: new Date(),
                errorType,
                message: String((err as Error)?.message || err || 'Unknown error'),
                retryable,
                originalError: err,
            };
            return { service: serviceName, success: false, error };
        }
    }

    private async checkDatabaseForExistingConversion<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        input: T,
        desiredService: ServiceName,
        inputType: MusicEntityType
    ): Promise<{ data: T | null, foundInDb: boolean }> {
        let dbItem: T | null = null;

        switch (inputType) {
            case 'song':
                dbItem = await this.Database.getSongBySyncId(input.syncId) as T | null;
                break;
            case 'artist':
                dbItem = await this.Database.getArtistBySyncId(input.syncId) as T | null;
                break;
            case 'album':
                dbItem = await this.Database.getAlbumBySyncId(input.syncId) as T | null;
                break;
            default:
                throw new Error(`Unsupported input type: ${inputType}`);
        }

        if (!dbItem) {
            return { data: null, foundInDb: false };
        }

        // Retry any previously failed services that are retryable
        if (dbItem.conversionErrors && Object.keys(dbItem.conversionErrors).length > 0) {
            const servicesToRetry: ServiceName[] = [];

            // Check which services should be retried
            for (const [serviceName, history] of Object.entries(dbItem.conversionErrors)) {
                if (shouldRetryService(history)) {
                    servicesToRetry.push(serviceName as ServiceName);
                }
            }

            // Retry failed services
            if (servicesToRetry.length > 0) {
                const conversionPromises = servicesToRetry.map(
                    serviceName => this.invokeServiceMethod(serviceName, dbItem as T, inputType)
                );
                const results = await Promise.all(conversionPromises);

                for (const result of results) {
                    if (result.success && result.data) {
                        // Success! Upsert the converted data
                        switch (inputType) {
                            case 'song':
                                dbItem = await this.Database.upsertSong(result.data as SyncFMSong) as T;
                                break;
                            case 'artist':
                                dbItem = await this.Database.upsertArtist(result.data as SyncFMArtist) as T;
                                break;
                            case 'album':
                                dbItem = await this.Database.upsertAlbum(result.data as SyncFMAlbum) as T;
                                break;
                        }

                        // Remove from error tracking since it succeeded
                        if (dbItem.conversionErrors) {
                            delete dbItem.conversionErrors[result.service];
                        }
                    } else if (result.error) {
                        // Still failing - update error history
                        console.warn(`Retry failed for ${result.service}:`, result.error.message);

                        if (!dbItem.conversionErrors) {
                            dbItem.conversionErrors = {};
                        }

                        const existing = dbItem.conversionErrors[result.service];
                        dbItem.conversionErrors[result.service] = {
                            lastAttempt: result.error.timestamp,
                            attempts: (existing?.attempts || 0) + 1,
                            lastError: result.error.message,
                            retryable: result.error.retryable,
                        };
                    }
                }

                // Update the database with new error state
                switch (inputType) {
                    case 'song':
                        dbItem = await this.Database.upsertSong(dbItem as SyncFMSong) as T;
                        break;
                    case 'artist':
                        dbItem = await this.Database.upsertArtist(dbItem as SyncFMArtist) as T;
                        break;
                    case 'album':
                        dbItem = await this.Database.upsertAlbum(dbItem as SyncFMAlbum) as T;
                        break;
                }
            }
        }

        // Check if the desired service ID already exists
        if (dbItem.externalIds?.[SyncFMExternalIdMapToDesiredService[desiredService]]) {
            return { data: dbItem, foundInDb: true };
        }

        return { data: null, foundInDb: false };
    }

    async unifiedConvert<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        inputInfo: T,
        desiredService: ServiceName,
        inputType: MusicEntityType
    ): Promise<T> {
        const dbLookupRes = await this.checkDatabaseForExistingConversion(inputInfo, desiredService, inputType);

        if (dbLookupRes.foundInDb && dbLookupRes.data) {
            if (dbLookupRes.data.externalIds?.[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbLookupRes.data;
            }
        }

        // We get the info from all supported services in parallel, upsert to db, and return the desired one
        if (!SUPPORTED_SERVICES.includes(desiredService)) {
            throw new Error(`Unsupported desired service: ${desiredService}`);
        }

        const conversionPromises = SUPPORTED_SERVICES.map(serviceName =>
            this.invokeServiceMethod(serviceName, inputInfo, inputType)
        );
        const results = await Promise.all(conversionPromises);
        let convertedItem: T | null = null;

        // Track errors for services that failed
        const conversionErrors: Record<string, { lastAttempt: Date; attempts: number; lastError: string; retryable: boolean }> = {};

        for (const result of results) {
            if (result.success && result.data) {
                // Success! Upsert the data
                switch (inputType) {
                    case 'song':
                        convertedItem = await this.Database.upsertSong(result.data as SyncFMSong) as T;
                        break;
                    case 'artist':
                        convertedItem = await this.Database.upsertArtist(result.data as SyncFMArtist) as T;
                        break;
                    case 'album':
                        convertedItem = await this.Database.upsertAlbum(result.data as SyncFMAlbum) as T;
                        break;
                }
            } else if (result.error) {
                // Track the error
                console.warn(`Conversion failed for ${result.service}:`, result.error.message);
                conversionErrors[result.service] = {
                    lastAttempt: result.error.timestamp,
                    attempts: 1,
                    lastError: result.error.message,
                    retryable: result.error.retryable,
                };
            }
        }

        // Save error information to the database
        if (Object.keys(conversionErrors).length > 0 && convertedItem) {
            convertedItem.conversionErrors = {
                ...convertedItem.conversionErrors,
                ...conversionErrors,
            };

            switch (inputType) {
                case 'song':
                    convertedItem = await this.Database.upsertSong(convertedItem as SyncFMSong) as T;
                    break;
                case 'artist':
                    convertedItem = await this.Database.upsertArtist(convertedItem as SyncFMArtist) as T;
                    break;
                case 'album':
                    convertedItem = await this.Database.upsertAlbum(convertedItem as SyncFMAlbum) as T;
                    break;
            }
        }

        // Now we should return the "finished" item from the DB to ensure we have all external IDs
        switch (inputType) {
            case 'song':
                convertedItem = await this.Database.getSongBySyncId(inputInfo.syncId) as T;
                break;
            case 'artist':
                convertedItem = await this.Database.getArtistBySyncId(inputInfo.syncId) as T;
                break;
            case 'album':
                convertedItem = await this.Database.getAlbumBySyncId(inputInfo.syncId) as T;
                break;
            default:
                throw new Error(`Unsupported input type: ${inputType}`);
        }

        if (convertedItem?.externalIds?.[SyncFMExternalIdMapToDesiredService[desiredService]]) {
            return convertedItem;
        }

        // Provide detailed error message about what failed
        const errorSummary = Object.entries(conversionErrors)
            .map(([service, error]) => `${service}: ${error.lastError}`)
            .join('; ');

        throw new Error(
            `Could not convert ${inputType} to desired service: ${desiredService}\n` +
            `Conversion failures: ${errorSummary || 'All services failed'}\n` +
            `Final item: ${JSON.stringify(convertedItem)}`
        );
    }

    private createURL(item: { externalIds: SyncFMExternalIdMap }, serviceName: ServiceName, type: MusicEntityType): string {
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
