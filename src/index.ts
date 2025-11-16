import { Database } from './database';
import { AppleMusicService } from './StreamingServices/AppleMusic/service';
import { SpotifyService } from './StreamingServices/Spotify/service';
import { YouTubeMusicService } from './StreamingServices/YouTubeMusic/service';
import { StreamingDebug } from './StreamingServices/debug';
import type {
    StreamingService,
    StreamingServiceURL,
    MusicEntityType,
    StreamingServiceUrlJSON,
    StreamingServiceUrlBuildOptions,
} from './StreamingServices/StreamingService';

type AnyStreamingService = StreamingService<StreamingServiceURL<unknown, unknown>, unknown, StreamingServiceUrlBuildOptions>;
import type { SyncFMArtist, SyncFMSong, SyncFMExternalIdMap, SyncFMAlbum, ServiceName, SyncFMConfig } from './types/syncfm';
import { SyncFMExternalIdMapToDesiredService } from './types/syncfm';
import { normalizeAlbumData, normalizeSongData, withShortcode } from './utils';
import { mergeData, songMergeConfig, artistMergeConfig, albumMergeConfig } from './squish';
import { categorizeError, shouldRetryService, shouldRetryImmediately, sleep } from './types/errors';
import type { ConversionResult, ConversionError, ServiceConversionHistory } from './types/errors';

export * from './types/syncfm';
export * from './types/StreamingService';
export * from './types/errors';

const SUPPORTED_SERVICES: ServiceName[] = ["applemusic", "spotify", "ytmusic"];

export class SyncFM {
    private readonly config: SyncFMConfig;
    private services: Map<ServiceName, AnyStreamingService>;
    private Database: Database;
    private conversionFlights: Map<string, Promise<unknown>>;

    constructor(config: SyncFMConfig, databaseOverride?: Database) {
        this.config = config;

        if (typeof config.enableStreamingDebug === 'boolean') {
            StreamingDebug.setEnabled(config.enableStreamingDebug);
        }

        if (!this.config.SpotifyClientId || !this.config.SpotifyClientSecret) {
            throw new Error("Spotify Client ID and Secret not provided. Spotify functionality will be limited.");
        }
        if (!this.config.SupabaseUrl || !this.config.SupabaseKey) {
            throw new Error("Supabase URL and Key not provided. Database functionality will be limited.");
        }

        this.Database = databaseOverride ?? new Database(this.config.SupabaseUrl, this.config.SupabaseKey);
        this.conversionFlights = new Map();

        this.services = new Map<ServiceName, StreamingService>();
        this.services.set('spotify', new SpotifyService(this.config.SpotifyClientId, this.config.SpotifyClientSecret));
        this.services.set('applemusic', new AppleMusicService());
        this.services.set('ytmusic', new YouTubeMusicService(this.config.YouTubeApiKey));
    }

    private getService(name: ServiceName): AnyStreamingService {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Unsupported streaming service: ${name}`);
        }
        return service;
    }

    __INTERNAL_getService(name: ServiceName): AnyStreamingService {
        return this.getService(name);
    }

    getStreamingServiceFromUrl = (url: string): ServiceName | null => {
        if (url.includes('apple.com')) return 'applemusic';
        if (url.includes('spotify.com')) return 'spotify';
        if (url.includes('youtube.com') || url.includes('music.youtube.com')) return 'ytmusic';
        return null;
    }

    getInputTypeFromUrl = async (url: string): Promise<MusicEntityType> => {
        const { service, descriptor } = this.resolveUrlDescriptor(url);
        const resolvedType = await service.getTypeFromUrl(url);
        return resolvedType ?? descriptor.type;
    }

    private resolveUrlDescriptor(input: string): { serviceName: ServiceName; service: AnyStreamingService; descriptor: StreamingServiceUrlJSON<unknown, unknown>; } {
        const serviceName = this.getStreamingServiceFromUrl(input);
        if (!serviceName) {
            throw new Error("Unsupported streaming service URL");
        }
        const service = this.getService(serviceName);
        const descriptor = service.describeUrl(input) as StreamingServiceUrlJSON<unknown, unknown>;
        return { serviceName, service, descriptor };
    }

    describeInputUrl = (input: string): { service: ServiceName; descriptor: StreamingServiceUrlJSON<unknown, unknown>; } => {
        const { serviceName, descriptor } = this.resolveUrlDescriptor(input);
        return { service: serviceName, descriptor };
    }

    normalizeInputUrl = (input: string): string => {
        return this.describeInputUrl(input).descriptor.url;
    }

    createServiceUrlDescriptor = <TIdentifier = string>(
        serviceName: ServiceName,
        type: MusicEntityType,
        id: TIdentifier,
        options: StreamingServiceUrlBuildOptions = {},
    ): { service: ServiceName; descriptor: StreamingServiceUrlJSON<unknown, unknown>; } => {
        const service = this.getService(serviceName);
        const descriptor = service.createUrlJSON(id as unknown, type, options) as StreamingServiceUrlJSON<unknown, unknown>;
        return { service: serviceName, descriptor };
    }

    createServiceUrl = <TIdentifier = string>(
        serviceName: ServiceName,
        type: MusicEntityType,
        id: TIdentifier,
        options: StreamingServiceUrlBuildOptions = {},
    ): string => {
        return this.createServiceUrlDescriptor(serviceName, type, id, options).descriptor.url;
    }

    // eslint-disable-next-line no-unused-vars
    private async _getInputInfo<T>(input: string, getter: (params: { service: AnyStreamingService, id: string }) => Promise<T>): Promise<T> {
        const { service, descriptor } = this.resolveUrlDescriptor(input);
        return getter({ service, id: descriptor.primaryId });
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

    getInputInfoFromShortcode = async <T = SyncFMAlbum | SyncFMArtist | SyncFMSong>(shortcode: string): Promise<T> => {
        const resolved = await this.Database.resolveShortcode(shortcode);
        if (!resolved) {
            throw new Error("Could not resolve shortcode");
        }
        return resolved as T;
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
            let convertedData: T & { __usedFallback?: boolean };

            switch (inputType) {
                case 'song': {
                    const songData = inputData as unknown as SyncFMSong;
                    const normalizedSongData = normalizeSongData(songData);
                    const query = `${normalizedSongData.cleanTitle} ${normalizedSongData.allArtists.join(" ")}`;
                    convertedData = await service.getSongBySearchQuery(query, songData.syncId) as unknown as T & { __usedFallback?: boolean };
                    break;
                }
                case 'album': {
                    const albumData = inputData as unknown as SyncFMAlbum;
                    const normalizedAlbumData = normalizeAlbumData(albumData);
                    const query = `${normalizedAlbumData.cleanTitle} ${normalizedAlbumData.allArtists ? normalizedAlbumData.allArtists.join(" ") : ""}`;
                    convertedData = await service.getAlbumBySearchQuery(query, albumData.syncId) as unknown as T & { __usedFallback?: boolean };
                    break;
                }
                case 'artist': {
                    const artistData = inputData as unknown as SyncFMArtist;
                    convertedData = await service.getArtistBySearchQuery(artistData.name, artistData.syncId) as unknown as T & { __usedFallback?: boolean };
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

            // Check if this conversion used fallback (syncId mismatch)
            const usedFallback = convertedData.__usedFallback || false;

            // Remove the internal flag before returning (use destructuring to exclude it)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
            const { __usedFallback: _, ...cleanData } = convertedData;

            const normalizedData = {
                ...cleanData,
                syncId: inputData.syncId,
            } as T;

            return {
                service: serviceName,
                success: true,
                data: normalizedData,
                usedFallback
            };

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

        return { data: dbItem, foundInDb: false };
    }

    async unifiedConvert<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        inputInfo: T,
        desiredService: ServiceName,
        inputType: MusicEntityType
    ): Promise<T> {
        const flightKey = this.getConversionFlightKey(inputInfo.syncId, inputType);
        const runId = StreamingDebug.generateRunId();
        return this.withConversionFlight(flightKey, () =>
            StreamingDebug.withRunId(runId, () =>
                this.executeUnifiedConvertWithRetry(inputInfo, desiredService, inputType)
            )
        );
    }

    private getConversionFlightKey(syncId: string, inputType: MusicEntityType): string {
        return `${inputType}:${syncId}`;
    }

    private withConversionFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
        const existingFlight = this.conversionFlights.get(key) as Promise<T> | undefined;
        if (existingFlight) {
            return existingFlight;
        }

        const flightPromise = task();
        this.conversionFlights.set(key, flightPromise as Promise<unknown>);

        const cleanup = (): void => {
            const current = this.conversionFlights.get(key);
            if (current === flightPromise) {
                this.conversionFlights.delete(key);
            }
        };

        flightPromise.then(cleanup, cleanup);
        return flightPromise;
    }

    private async fetchEntityBySyncId<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        syncId: string,
        inputType: MusicEntityType,
    ): Promise<T | null> {
        switch (inputType) {
            case 'song':
                return (await this.Database.getSongBySyncId(syncId)) as T | null;
            case 'artist':
                return (await this.Database.getArtistBySyncId(syncId)) as T | null;
            case 'album':
                return (await this.Database.getAlbumBySyncId(syncId)) as T | null;
            default:
                throw new Error(`Unsupported input type for lookup: ${inputType}`);
        }
    }

    private async waitForEntityAvailability<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        syncId: string,
        inputType: MusicEntityType,
        attempts = 8,
        initialDelayMs = 250,
        backoffFactor = 1.4,
    ): Promise<T | null> {
        let delay = initialDelayMs;

        for (let attempt = 0; attempt < attempts; attempt++) {
            const entity = await this.fetchEntityBySyncId<T>(syncId, inputType);
            if (entity) {
                return entity;
            }

            if (attempt < attempts - 1) {
                await sleep(delay);
                delay = Math.min(Math.ceil(delay * backoffFactor), 2000);
            }
        }

        return null;
    }

    private async waitForExistingConversionResult<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        syncId: string,
        desiredService: ServiceName,
        inputType: MusicEntityType,
        attempts = 20,
        initialDelayMs = 400,
        backoffFactor = 1.4,
    ): Promise<T | null> {
        const desiredKey = SyncFMExternalIdMapToDesiredService[desiredService];
        let delay = initialDelayMs;

        for (let attempt = 0; attempt < attempts; attempt++) {
            const entity = await this.fetchEntityBySyncId<T>(syncId, inputType);
            if (entity?.externalIds?.[desiredKey]) {
                return entity;
            }

            if (attempt < attempts - 1) {
                await sleep(delay);
                delay = Math.min(Math.ceil(delay * backoffFactor), 4000);
            }
        }

        return null;
    }

    private async executeUnifiedConvertWithRetry<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
        inputInfo: T,
        desiredService: ServiceName,
        inputType: MusicEntityType,
    ): Promise<T> {
        const maxAttempts = 3;
        let delayMs = 700;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.executeUnifiedConvert(inputInfo, desiredService, inputType);
            } catch (error) {
                lastError = error;
                if (attempt < maxAttempts) {
                    StreamingDebug.log('SyncFM', 'unifiedConvert', 'retry', {
                        meta: {
                            syncId: inputInfo.syncId,
                            desiredService,
                            inputType,
                            attempt: attempt + 1,
                        },
                    });
                    await sleep(delayMs);
                    delayMs = Math.min(Math.ceil(delayMs * 1.6), 5000);
                }
            }
        }

        const fallback = await this.waitForExistingConversionResult<T>(inputInfo.syncId, desiredService, inputType);
        if (fallback) {
            StreamingDebug.log('SyncFM', 'unifiedConvert', 'fallback', {
                meta: {
                    syncId: inputInfo.syncId,
                    desiredService,
                    inputType,
                },
            });
            return fallback;
        }

        if (lastError) {
            throw lastError;
        }
        throw new Error(`Conversion failed for ${inputType} ${inputInfo.syncId}`);
    }

    private mergeEntityData<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(existing: T, incoming: T, inputType: MusicEntityType): T {
        switch (inputType) {
            case 'song':
                return mergeData(existing as SyncFMSong, incoming as SyncFMSong, songMergeConfig) as T;
            case 'artist':
                return mergeData(existing as SyncFMArtist, incoming as SyncFMArtist, artistMergeConfig) as T;
            case 'album':
                return mergeData(existing as SyncFMAlbum, incoming as SyncFMAlbum, albumMergeConfig) as T;
            default:
                throw new Error(`Unsupported input type for merge: ${inputType}`);
        }
    }

    private async upsertAggregatedEntity<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(entity: T, inputType: MusicEntityType): Promise<T> {
        switch (inputType) {
            case 'song':
                return this.Database.upsertSong(entity as SyncFMSong) as Promise<T>;
            case 'artist':
                return this.Database.upsertArtist(entity as SyncFMArtist) as Promise<T>;
            case 'album':
                return this.Database.upsertAlbum(entity as SyncFMAlbum) as Promise<T>;
            default:
                throw new Error(`Unsupported input type for upsert: ${inputType}`);
        }
    }

    private async executeUnifiedConvert<T extends SyncFMSong | SyncFMArtist | SyncFMAlbum>(
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
        const priorEntity = dbLookupRes.data ?? null;
        let aggregatedItem: T | null = priorEntity ? { ...priorEntity } as T : null;

        const aggregatedErrors: Record<string, ServiceConversionHistory> = {
            ...(priorEntity?.conversionErrors ?? {}),
        };
        const aggregatedWarnings: Record<string, { message: string; timestamp: Date }> = {
            ...(priorEntity?.conversionWarnings ?? {}),
        };

        // Track errors for services that failed in this run
        const failedServiceErrors: Record<string, ServiceConversionHistory> = {};

        for (const result of results) {
            if (result.success && result.data) {
                const incoming = withShortcode(result.data as SyncFMAlbum | SyncFMSong | SyncFMArtist) as T;
                aggregatedItem = aggregatedItem
                    ? this.mergeEntityData(aggregatedItem, incoming, inputType)
                    : incoming;

                // Successful conversions clear previous errors for that service
                delete aggregatedErrors[result.service];

                if (result.usedFallback) {
                    aggregatedWarnings[result.service] = {
                        message: 'No exact syncId match found, used closest match',
                        timestamp: new Date(),
                    };
                } else {
                    delete aggregatedWarnings[result.service];
                }
            } else if (result.error) {
                console.warn(`Conversion failed for ${result.service}:`, result.error.message);
                failedServiceErrors[result.service] = {
                    lastAttempt: result.error.timestamp,
                    attempts: 1,
                    lastError: result.error.message,
                    retryable: result.error.retryable,
                };
            }
        }

        if (aggregatedItem) {
            const mergedErrors = { ...aggregatedErrors };
            for (const [service, payload] of Object.entries(failedServiceErrors)) {
                mergedErrors[service] = payload;
            }

            aggregatedItem.conversionErrors = Object.keys(mergedErrors).length > 0 ? mergedErrors : undefined;
            aggregatedItem.conversionWarnings = Object.keys(aggregatedWarnings).length > 0 ? aggregatedWarnings : undefined;

            aggregatedItem = await this.upsertAggregatedEntity(aggregatedItem, inputType);
        }

        if (!aggregatedItem) {
            const errorSummary = Object.entries(failedServiceErrors)
                .map(([service, error]) => `${service}: ${error.lastError ?? 'Unknown error'}`)
                .join('; ');

            throw new Error([
                `Could not convert ${inputType} to desired service: ${desiredService}`,
                `Conversion failures: ${errorSummary || 'All services failed'}`,
                'Final item: null',
            ].join('\n'));
        }

        // Now we should return the "finished" item from the DB to ensure we have all external IDs
        let convertedItem = await this.waitForEntityAvailability<T>(inputInfo.syncId, inputType) ?? aggregatedItem;

        const desiredServiceKey = SyncFMExternalIdMapToDesiredService[desiredService];
        const hasDesiredServiceId = Boolean(convertedItem?.externalIds?.[desiredServiceKey]);

        if (hasDesiredServiceId) {
            return convertedItem;
        }

        const resolvedItem = convertedItem ?? aggregatedItem;
        const successfulExternalIds = resolvedItem
            ? Object.entries(resolvedItem.externalIds ?? {})
                .filter(([, id]) => Boolean(id))
                .map(([serviceName]) => serviceName)
            : [];

        if (resolvedItem && successfulExternalIds.length > 0) {
            console.warn(
                `Partial conversion success for ${inputType} ${inputInfo.syncId}: missing ${desiredService}, but succeeded for ${successfulExternalIds.join(', ')}`,
            );

            const hasLoggedDesiredError = Boolean(resolvedItem.conversionErrors?.[desiredService]);

            if (!hasLoggedDesiredError) {
                const updatedConversionErrors = {
                    ...resolvedItem.conversionErrors,
                    [desiredService]: {
                        lastAttempt: new Date(),
                        attempts: 1,
                        lastError: `Missing external ID for ${desiredService}`,
                        retryable: true,
                    },
                };

                convertedItem = {
                    ...resolvedItem,
                    conversionErrors: updatedConversionErrors,
                } as T;

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

            return convertedItem ?? resolvedItem;
        }

        // Provide detailed error message about what failed
        const summarySource = (convertedItem ?? resolvedItem)?.conversionErrors ?? failedServiceErrors;
        const errorSummary = Object.entries(summarySource)
            .map(([service, error]) => `${service}: ${error.lastError ?? 'Unknown error'}`)
            .join('; ');

        throw new Error([
            `Could not convert ${inputType} to desired service: ${desiredService}`,
            `Conversion failures: ${errorSummary || 'All services failed'}`,
            `Final item: ${JSON.stringify(convertedItem ?? resolvedItem)}`,
        ].join('\n'));
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

    createSongURL = async (song: SyncFMSong, service: ServiceName, syncId?: string): Promise<string> => {
        // If syncId is provided, fetch the full song from database to ensure we have all externalIds
        if (syncId) {
            const fullSong = await this.Database.getSongBySyncId(syncId);
            if (fullSong) {
                return this.createURL(fullSong, service, "song");
            }
        }
        return this.createURL(song, service, "song");
    }

    createArtistURL = async (artist: SyncFMArtist, service: ServiceName, syncId?: string): Promise<string> => {
        // If syncId is provided, fetch the full artist from database to ensure we have all externalIds
        if (syncId) {
            const fullArtist = await this.Database.getArtistBySyncId(syncId);
            if (fullArtist) {
                return this.createURL(fullArtist, service, "artist");
            }
        }
        return this.createURL(artist, service, "artist");
    }

    createAlbumURL = async (album: SyncFMAlbum, service: ServiceName, syncId?: string): Promise<string> => {
        // If syncId is provided, fetch the full album from database to ensure we have all externalIds
        if (syncId) {
            const fullAlbum = await this.Database.getAlbumBySyncId(syncId);
            if (fullAlbum) {
                return this.createURL(fullAlbum, service, "album");
            }
        }
        return this.createURL(album, service, "album");
    }

    getSongBySyncId = async (syncId: string): Promise<SyncFMSong | null> => {
        return this.Database.getSongBySyncId(syncId);
    }

    getArtistBySyncId = async (syncId: string): Promise<SyncFMArtist | null> => {
        return this.Database.getArtistBySyncId(syncId);
    }

    getAlbumBySyncId = async (syncId: string): Promise<SyncFMAlbum | null> => {
        return this.Database.getAlbumBySyncId(syncId);
    }
}
