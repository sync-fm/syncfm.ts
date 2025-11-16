import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database as SupabaseSchema, Json } from './types/supabase';
import type { SyncFMAlbum, SyncFMArtist, SyncFMArtistTrack, SyncFMSong, SyncFMExternalIdMap } from './types/syncfm';
import type {
    ConversionErrorMap,
    ConversionWarningMap,
    ErrorType,
    ServiceConversionHistory,
    ServiceConversionWarning,
} from './types/errors';
import { mergeData, songMergeConfig, artistMergeConfig, albumMergeConfig } from './squish';
import type { MergeConfig } from './squish';
import { normalizeSongData, prefixMapReverse } from './utils';

const DEBUG_DATABASE = process.env.DEBUG_SYNCFM_DB === 'true';

const TABLE_BY_SHORTCODE_TYPE = {
    song: 'songs',
    artist: 'artists',
    album: 'albums',
} as const;

type EntityTable = (typeof TABLE_BY_SHORTCODE_TYPE)[keyof typeof TABLE_BY_SHORTCODE_TYPE];
type ShortcodeType = keyof typeof TABLE_BY_SHORTCODE_TYPE;

type PublicTables = SupabaseSchema['public']['Tables'];
type SongRow = PublicTables['songs']['Row'];
type SongInsert = PublicTables['songs']['Insert'];
type AlbumRow = PublicTables['albums']['Row'];
type AlbumInsert = PublicTables['albums']['Insert'];
type ArtistRow = PublicTables['artists']['Row'];
type ArtistInsert = PublicTables['artists']['Insert'];

type EntityRowMap = {
    songs: SongRow;
    albums: AlbumRow;
    artists: ArtistRow;
};

type EntityInsertMap = {
    songs: SongInsert;
    albums: AlbumInsert;
    artists: ArtistInsert;
};

type EntityDomainMap = {
    songs: SyncFMSong;
    albums: SyncFMAlbum;
    artists: SyncFMArtist;
};

type SerializableConversionError = Omit<ServiceConversionHistory, 'lastAttempt'> & { lastAttempt: string };
type SerializableConversionWarning = Omit<ServiceConversionWarning, 'timestamp'> & { timestamp: string };
type SerializableConversionErrorMap = Record<string, SerializableConversionError>;
type SerializableConversionWarningMap = Record<string, SerializableConversionWarning>;

type SerializableSong = Omit<SyncFMSong, 'releaseDate' | 'conversionErrors' | 'conversionWarnings' | 'externalIds'> & {
    releaseDate?: string | null;
    conversionErrors?: SerializableConversionErrorMap | null;
    conversionWarnings?: SerializableConversionWarningMap | null;
    externalIds?: Record<string, string> | null;
};

type SerializableAlbum = Omit<SyncFMAlbum, 'songs' | 'conversionErrors' | 'conversionWarnings' | 'externalIds'> & {
    songs?: SerializableSong[] | null;
    conversionErrors?: SerializableConversionErrorMap | null;
    conversionWarnings?: SerializableConversionWarningMap | null;
    externalIds?: Record<string, string> | null;
};

type SerializableArtistTrack = Omit<SyncFMArtistTrack, 'externalIds'> & {
    externalIds?: Record<string, string> | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const toIsoString = (value?: Date | string | null): string | null => {
    if (!value) return null;
    if (value instanceof Date) {
        const time = value.getTime();
        if (Number.isNaN(time)) return null;
        return value.toISOString();
    }
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    return null;
};

const parseDateValue = (value?: unknown): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? undefined : value;
    }
    if (typeof value === 'string' && value.length > 0) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return undefined;
};

const toJson = <T>(value: T): Json => value as unknown as Json;

const externalIdsToJson = (ids?: SyncFMExternalIdMap): Record<string, string> | null => {
    if (!ids) {
        return null;
    }
    const entries: [string, string][] = [];
    for (const [key, value] of Object.entries(ids)) {
        if (typeof value === 'string' && value.length > 0) {
            entries.push([key, value]);
        }
    }
    return entries.length ? Object.fromEntries(entries) : null;
};

const castExternalIds = (value: Json | null): SyncFMExternalIdMap => {
    if (!isRecord(value)) {
        return {};
    }
    const result: SyncFMExternalIdMap = {};
    for (const [key, val] of Object.entries(value)) {
        if (typeof val === 'string' && val.length > 0) {
            (result as Record<string, string>)[key] = val;
        }
    }
    return result;
};

const serializeConversionErrors = (errors?: ConversionErrorMap): SerializableConversionErrorMap | null => {
    if (!errors || Object.keys(errors).length === 0) {
        return null;
    }

    const serialized: SerializableConversionErrorMap = {};
    for (const [service, history] of Object.entries(errors)) {
        if (!history) continue;
        serialized[service] = {
            ...history,
            lastAttempt: history.lastAttempt instanceof Date
                ? history.lastAttempt.toISOString()
                : new Date(history.lastAttempt).toISOString(),
        };
    }
    return serialized;
};

const serializeConversionWarnings = (warnings?: ConversionWarningMap): SerializableConversionWarningMap | null => {
    if (!warnings || Object.keys(warnings).length === 0) {
        return null;
    }

    const serialized: SerializableConversionWarningMap = {};
    for (const [service, warning] of Object.entries(warnings)) {
        if (!warning) continue;
        serialized[service] = {
            ...warning,
            timestamp: warning.timestamp instanceof Date
                ? warning.timestamp.toISOString()
                : new Date(warning.timestamp).toISOString(),
        };
    }
    return serialized;
};

const deserializeConversionErrors = (value?: Json | null): ConversionErrorMap | undefined => {
    if (!value || !isRecord(value)) {
        return undefined;
    }

    const result: ConversionErrorMap = {};
    for (const [service, payload] of Object.entries(value)) {
        if (!isRecord(payload)) continue;
        const attempts = typeof payload.attempts === 'number' ? payload.attempts : 0;
        const lastError = typeof payload.lastError === 'string' ? payload.lastError : undefined;
        const errorType = typeof payload.errorType === 'string' ? payload.errorType as ErrorType : undefined;
        const retryable = typeof payload.retryable === 'boolean' ? payload.retryable : false;
        const lastAttempt = parseDateValue(payload.lastAttempt) ?? new Date(0);
        result[service] = {
            attempts,
            lastAttempt,
            lastError,
            errorType,
            retryable,
        };
    }

    return Object.keys(result).length ? result : undefined;
};

const deserializeConversionWarnings = (value?: Json | null): ConversionWarningMap | undefined => {
    if (!value || !isRecord(value)) {
        return undefined;
    }

    const result: ConversionWarningMap = {};
    for (const [service, payload] of Object.entries(value)) {
        if (!isRecord(payload)) continue;
        const timestamp = parseDateValue(payload.timestamp) ?? new Date(0);
        const message = typeof payload.message === 'string' ? payload.message : 'Unknown warning';
        result[service] = { message, timestamp };
    }

    return Object.keys(result).length ? result : undefined;
};

const serializeSongForJson = (song: SyncFMSong): SerializableSong => {
    const { releaseDate, conversionErrors, conversionWarnings, externalIds, ...rest } = song;
    return {
        ...rest,
        externalIds: externalIdsToJson(externalIds),
        releaseDate: toIsoString(releaseDate),
        conversionErrors: serializeConversionErrors(conversionErrors),
        conversionWarnings: serializeConversionWarnings(conversionWarnings),
    };
};

const serializeSongArray = (songs?: SyncFMSong[]): SerializableSong[] | null => {
    if (!songs || songs.length === 0) {
        return null;
    }
    return songs.map(serializeSongForJson);
};

const deserializeSongFromJson = (value: unknown): SyncFMSong | null => {
    if (!isRecord(value)) {
        return null;
    }

    const { releaseDate, conversionErrors, conversionWarnings, externalIds, ...rest } = value;
    return {
        ...(rest as Omit<SyncFMSong, 'releaseDate' | 'conversionErrors' | 'conversionWarnings' | 'externalIds'>),
        externalIds: castExternalIds(externalIds as Json | null),
        releaseDate: parseDateValue(releaseDate) ?? undefined,
        conversionErrors: deserializeConversionErrors(conversionErrors as Json | null),
        conversionWarnings: deserializeConversionWarnings(conversionWarnings as Json | null),
    };
};

const deserializeSongArray = (value?: Json | null): SyncFMSong[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const songs: SyncFMSong[] = [];
    for (const entry of value) {
        const song = deserializeSongFromJson(entry);
        if (song) {
            songs.push(song);
        }
    }
    return songs;
};

const serializeAlbumForJson = (album: SyncFMAlbum): SerializableAlbum => {
    const { songs, conversionErrors, conversionWarnings, externalIds, ...rest } = album;
    return {
        ...rest,
        externalIds: externalIdsToJson(externalIds),
        songs: serializeSongArray(songs),
        conversionErrors: serializeConversionErrors(conversionErrors),
        conversionWarnings: serializeConversionWarnings(conversionWarnings),
    };
};

const serializeAlbumArray = (albums?: SyncFMAlbum[]): SerializableAlbum[] | null => {
    if (!albums || albums.length === 0) {
        return null;
    }
    return albums.map(serializeAlbumForJson);
};

const deserializeAlbumFromJson = (value: unknown): SyncFMAlbum | null => {
    if (!isRecord(value)) {
        return null;
    }

    const { songs, conversionErrors, conversionWarnings, externalIds, ...rest } = value;
    return {
        ...(rest as Omit<SyncFMAlbum, 'songs' | 'conversionErrors' | 'conversionWarnings' | 'externalIds'>),
        externalIds: castExternalIds(externalIds as Json | null),
        songs: deserializeSongArray(songs as Json | null),
        conversionErrors: deserializeConversionErrors(conversionErrors as Json | null),
        conversionWarnings: deserializeConversionWarnings(conversionWarnings as Json | null),
    };
};

const deserializeAlbumArray = (value?: Json | null): SyncFMAlbum[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const albums: SyncFMAlbum[] = [];
    for (const entry of value) {
        const album = deserializeAlbumFromJson(entry);
        if (album) {
            albums.push(album);
        }
    }

    return albums.length ? albums : undefined;
};

const serializeArtistTracks = (tracks?: SyncFMArtist['tracks']): SerializableArtistTrack[] | null => {
    if (!tracks || tracks.length === 0) {
        return null;
    }

    return tracks.map(track => {
        const { externalIds, ...rest } = track;
        return {
            ...rest,
            externalIds: externalIdsToJson(externalIds),
        };
    });
};

const deserializeArtistTrackFromJson = (value: unknown): SyncFMArtistTrack | null => {
    if (!isRecord(value)) {
        return null;
    }

    const { externalIds, ...rest } = value;
    return {
        ...(rest as Omit<SyncFMArtistTrack, 'externalIds'>),
        externalIds: castExternalIds(externalIds as Json | null),
    };
};

const deserializeArtistTracks = (value?: Json | null): SyncFMArtist['tracks'] => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const tracks = value
        .map(deserializeArtistTrackFromJson)
        .filter((track): track is SyncFMArtistTrack => Boolean(track));

    return tracks.length ? tracks : undefined;
};

export class Database {
    private supabase: SupabaseClient<SupabaseSchema>;
    private entityLocks: Map<string, Promise<void>>;

    constructor(supabaseUrl: string, supabaseKey: string, client?: SupabaseClient<SupabaseSchema>) {
        this.supabase = client ?? createClient<SupabaseSchema>(supabaseUrl, supabaseKey);
        this.entityLocks = new Map();
    }

    private logDebug(message: string, payload?: Record<string, unknown>): void {
        if (!DEBUG_DATABASE) {
            return;
        }
        if (payload) {
            console.debug(`[Database] ${message}`, payload);
        } else {
            console.debug(`[Database] ${message}`);
        }
    }

    private createLockKey(table: EntityTable, syncId: string): string {
        return `${table}:${syncId}`;
    }

    private async withEntityLock<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.entityLocks.get(key) ?? Promise.resolve();
        const previousSafe = previous.catch(() => undefined);
        let release: (() => void) | undefined;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const nextPromise = previousSafe.then(() => current);
        this.entityLocks.set(key, nextPromise);
        await previousSafe;
        try {
            return await task();
        } finally {
            release?.();
            if (this.entityLocks.get(key) === nextPromise) {
                this.entityLocks.delete(key);
            }
        }
    }

    private async fetchRowBySyncId<Table extends EntityTable>(table: Table, syncId: string): Promise<EntityRowMap[Table] | null> {
        const { data, error } = await this.supabase
            .from(table)
            .select('*')
            .eq('syncId', syncId as never)
            .maybeSingle();

        if (error) {
            throw new Error(`Error fetching ${table} entity by syncId: ${error.message}`);
        }

        return data ? (data as unknown as EntityRowMap[Table]) : null;
    }

    private async fetchRowByShortcode<Table extends EntityTable>(table: Table, shortcode: string): Promise<EntityRowMap[Table] | null> {
        const { data, error } = await this.supabase
            .from(table)
            .select('*')
            .eq('shortcode', shortcode as never)
            .maybeSingle();

        if (error) {
            throw new Error(`Error fetching ${table} entity by shortcode: ${error.message}`);
        }

        return data ? (data as unknown as EntityRowMap[Table]) : null;
    }

    private rowToDomain<Table extends EntityTable>(table: Table, row: EntityRowMap[Table]): EntityDomainMap[Table] {
        switch (table) {
            case 'songs':
                return this.mapSongRow(row as SongRow) as EntityDomainMap[Table];
            case 'albums':
                return this.mapAlbumRow(row as AlbumRow) as EntityDomainMap[Table];
            case 'artists':
                return this.mapArtistRow(row as ArtistRow) as EntityDomainMap[Table];
            default:
                throw new Error(`Unsupported table: ${table}`);
        }
    }

    private domainToInsert<Table extends EntityTable>(table: Table, entity: EntityDomainMap[Table]): EntityInsertMap[Table] {
        switch (table) {
            case 'songs':
                return this.mapSongToInsert(entity as SyncFMSong) as EntityInsertMap[Table];
            case 'albums':
                return this.mapAlbumToInsert(entity as SyncFMAlbum) as EntityInsertMap[Table];
            case 'artists':
                return this.mapArtistToInsert(entity as SyncFMArtist) as EntityInsertMap[Table];
            default:
                throw new Error(`Unsupported table: ${table}`);
        }
    }

    private mapSongRow(row: SongRow): SyncFMSong {
        return {
            syncId: row.syncId,
            shortcode: row.shortcode ?? undefined,
            title: row.title,
            description: row.description ?? undefined,
            artists: row.artists ?? [],
            album: row.album ?? undefined,
            releaseDate: parseDateValue(row.releaseDate ?? undefined),
            duration: row.duration ?? undefined,
            imageUrl: row.imageUrl ?? undefined,
            animatedImageUrl: row.animatedImageUrl ?? undefined,
            externalIds: castExternalIds(row.externalIds),
            explicit: row.explicit ?? undefined,
            conversionErrors: deserializeConversionErrors(row.conversionErrors),
            conversionWarnings: deserializeConversionWarnings(row.conversionWarnings),
        };
    }

    private mapAlbumRow(row: AlbumRow): SyncFMAlbum {
        return {
            syncId: row.syncId,
            shortcode: row.shortcode ?? undefined,
            title: row.title ?? '',
            description: row.description ?? undefined,
            artists: row.artists ?? [],
            releaseDate: row.releaseDate ?? undefined,
            imageUrl: row.imageUrl ?? undefined,
            externalIds: castExternalIds(row.externalIds),
            songs: deserializeSongArray(row.songs),
            totalTracks: row.totalTracks ?? undefined,
            duration: row.duration ?? undefined,
            label: row.label ?? undefined,
            genres: row.genres ?? undefined,
            explicit: row.explicit ?? undefined,
            conversionErrors: deserializeConversionErrors(row.conversionErrors),
            conversionWarnings: deserializeConversionWarnings(row.conversionWarnings),
        };
    }

    private mapArtistRow(row: ArtistRow): SyncFMArtist {
        return {
            syncId: row.syncId,
            shortcode: row.shortcode ?? undefined,
            name: row.name ?? '',
            imageUrl: row.imageUrl ?? undefined,
            externalIds: castExternalIds(row.externalIds),
            genre: row.genre ?? undefined,
            albums: deserializeAlbumArray(row.albums),
            tracks: deserializeArtistTracks(row.tracks),
            conversionErrors: deserializeConversionErrors(row.conversionErrors),
            conversionWarnings: deserializeConversionWarnings(row.conversionWarnings),
        };
    }

    private mapSongToInsert(song: SyncFMSong): SongInsert {
        if (!song.syncId) {
            throw new Error('Song syncId is required for upsert operations.');
        }
        if (!song.title) {
            throw new Error('Song title is required for upsert operations.');
        }
        if (!song.artists || song.artists.length === 0) {
            throw new Error('At least one artist is required for song upserts.');
        }

        const conversionErrors = serializeConversionErrors(song.conversionErrors);
        const conversionWarnings = serializeConversionWarnings(song.conversionWarnings);
        const serializedExternalIds = externalIdsToJson(song.externalIds);

        return {
            syncId: song.syncId,
            shortcode: song.shortcode ?? null,
            title: song.title,
            description: song.description ?? null,
            artists: song.artists,
            album: song.album ?? null,
            releaseDate: toIsoString(song.releaseDate),
            duration: song.duration ?? null,
            imageUrl: song.imageUrl ?? null,
            animatedImageUrl: song.animatedImageUrl ?? null,
            externalIds: serializedExternalIds ? toJson(serializedExternalIds) : null,
            explicit: song.explicit ?? null,
            conversionErrors: conversionErrors ? toJson(conversionErrors) : toJson([]),
            conversionWarnings: conversionWarnings ? toJson(conversionWarnings) : toJson({}),
        };
    }

    private mapAlbumToInsert(album: SyncFMAlbum): AlbumInsert {
        if (!album.syncId) {
            throw new Error('Album syncId is required for upsert operations.');
        }

        const conversionErrors = serializeConversionErrors(album.conversionErrors);
        const conversionWarnings = serializeConversionWarnings(album.conversionWarnings);
        const serializedSongs = serializeSongArray(album.songs);
        const serializedExternalIds = externalIdsToJson(album.externalIds);

        return {
            syncId: album.syncId,
            shortcode: album.shortcode ?? null,
            title: album.title,
            description: album.description ?? null,
            artists: album.artists ?? [],
            releaseDate: album.releaseDate ?? null,
            imageUrl: album.imageUrl ?? null,
            externalIds: serializedExternalIds ? toJson(serializedExternalIds) : null,
            songs: serializedSongs ? toJson(serializedSongs) : null,
            totalTracks: album.totalTracks ?? null,
            duration: album.duration ?? null,
            label: album.label ?? null,
            genres: album.genres ?? null,
            explicit: album.explicit ?? null,
            conversionErrors: conversionErrors ? toJson(conversionErrors) : toJson([]),
            conversionWarnings: conversionWarnings ? toJson(conversionWarnings) : toJson({}),
        };
    }

    private mapArtistToInsert(artist: SyncFMArtist): ArtistInsert {
        if (!artist.syncId) {
            throw new Error('Artist syncId is required for upsert operations.');
        }

        const conversionErrors = serializeConversionErrors(artist.conversionErrors);
        const conversionWarnings = serializeConversionWarnings(artist.conversionWarnings);
        const serializedAlbums = serializeAlbumArray(artist.albums);
        const serializedTracks = serializeArtistTracks(artist.tracks);
        const serializedExternalIds = externalIdsToJson(artist.externalIds);

        return {
            syncId: artist.syncId,
            shortcode: artist.shortcode ?? null,
            name: artist.name ?? null,
            imageUrl: artist.imageUrl ?? null,
            externalIds: serializedExternalIds ? toJson(serializedExternalIds) : null,
            genre: artist.genre ?? null,
            albums: serializedAlbums ? toJson(serializedAlbums) : null,
            tracks: serializedTracks ? toJson(serializedTracks) : null,
            conversionErrors: conversionErrors ? toJson(conversionErrors) : toJson([]),
            conversionWarnings: conversionWarnings ? toJson(conversionWarnings) : toJson({}),
        };
    }

    private async upsertEntity<Table extends EntityTable>(
        table: Table,
        newData: Partial<EntityDomainMap[Table]>,
        mergeConfig: MergeConfig<EntityDomainMap[Table]>,
    ): Promise<EntityDomainMap[Table]> {
        if (!newData.syncId) {
            throw new Error('syncId is required for upsert operations.');
        }

        const lockKey = this.createLockKey(table, newData.syncId);
        return this.withEntityLock(lockKey, async () => {
            const existingRow = await this.fetchRowBySyncId(table, newData.syncId);
            const existingDomain = existingRow ? this.rowToDomain(table, existingRow) : null;
            const mergedDomain = existingDomain
                ? mergeData(existingDomain, newData, mergeConfig)
                : { ...newData } as EntityDomainMap[Table];

            const payload = this.domainToInsert(table, mergedDomain);
            this.logDebug('Upserting entity', {
                table,
                syncId: payload.syncId,
                hasExisting: Boolean(existingDomain),
            });

            switch (table) {
                case 'songs': {
                    const { data, error } = await this.supabase
                        .from('songs')
                        .upsert(payload as SongInsert, { onConflict: 'syncId' })
                        .select()
                        .single();

                    if (error || !data) {
                        console.error(`Error upserting songs entity: ${error?.message}`, { syncId: payload.syncId });
                        throw new Error(`Error upserting songs entity: ${error?.message ?? 'Unknown error'}`);
                    }

                    return this.rowToDomain('songs', data) as EntityDomainMap[Table];
                }
                case 'albums': {
                    const { data, error } = await this.supabase
                        .from('albums')
                        .upsert(payload as AlbumInsert, { onConflict: 'syncId' })
                        .select()
                        .single();

                    if (error || !data) {
                        console.error(`Error upserting albums entity: ${error?.message}`, { syncId: payload.syncId });
                        throw new Error(`Error upserting albums entity: ${error?.message ?? 'Unknown error'}`);
                    }

                    return this.rowToDomain('albums', data) as EntityDomainMap[Table];
                }
                case 'artists': {
                    const { data, error } = await this.supabase
                        .from('artists')
                        .upsert(payload as ArtistInsert, { onConflict: 'syncId' })
                        .select()
                        .single();

                    if (error || !data) {
                        console.error(`Error upserting artists entity: ${error?.message}`, { syncId: payload.syncId });
                        throw new Error(`Error upserting artists entity: ${error?.message ?? 'Unknown error'}`);
                    }

                    return this.rowToDomain('artists', data) as EntityDomainMap[Table];
                }
                default:
                    throw new Error(`Unsupported table: ${table}`);
            }
        });
    }

    public async resolveShortcode(shortcode: string): Promise<SyncFMAlbum | SyncFMArtist | SyncFMSong | null> {
        const shortcodeType = prefixMapReverse[shortcode.slice(0, 2) as keyof typeof prefixMapReverse];
        if (!shortcodeType) {
            throw new Error('Invalid shortcode prefix.');
        }

        const table = TABLE_BY_SHORTCODE_TYPE[shortcodeType as ShortcodeType];
        try {
            const row = await this.fetchRowByShortcode(table, shortcode);
            return row ? this.rowToDomain(table, row) : null;
        } catch (error) {
            console.error(`Error resolving shortcode ${shortcode}: ${(error as Error).message}`);
            return null;
        }
    }

    public async getSongBySyncId(syncId: string): Promise<SyncFMSong | null> {
        const row = await this.fetchRowBySyncId('songs', syncId);
        return row ? this.rowToDomain('songs', row) : null;
    }

    public async getArtistBySyncId(syncId: string): Promise<SyncFMArtist | null> {
        const row = await this.fetchRowBySyncId('artists', syncId);
        return row ? this.rowToDomain('artists', row) : null;
    }

    public async getAlbumBySyncId(syncId: string): Promise<SyncFMAlbum | null> {
        const row = await this.fetchRowBySyncId('albums', syncId);
        return row ? this.rowToDomain('albums', row) : null;
    }

    public async upsertSong(songData: Partial<SyncFMSong>): Promise<SyncFMSong> {
        if (songData.title) {
            const normalized = normalizeSongData(songData as SyncFMSong);
            songData.title = normalized.cleanTitle;
            songData.artists = normalized.allArtists;
        }
        return this.upsertEntity('songs', songData, songMergeConfig);
    }

    public async upsertArtist(artistData: Partial<SyncFMArtist>): Promise<SyncFMArtist> {
        return this.upsertEntity('artists', artistData, artistMergeConfig);
    }

    public async upsertAlbum(albumData: Partial<SyncFMAlbum>): Promise<SyncFMAlbum> {
        return this.upsertEntity('albums', albumData, albumMergeConfig);
    }

    public async uploadSongAnimatedArtwork(imageBuffer: Buffer, syncId: string): Promise<string> {
        const filePath = `${syncId}.webp`;
        const { error } = await this.supabase.storage
            .from('songs-animated-artwork')
            .upload(filePath, imageBuffer, {
                cacheControl: '3600',
                upsert: true,
                contentType: 'image/webp',
            });

        if (error) {
            throw new Error(`Error uploading animated artwork: ${error.message}`);
        }

        const { data } = this.supabase.storage.from('songs-animated-artwork').getPublicUrl(filePath);
        if (!data?.publicUrl) {
            throw new Error('Error retrieving public URL for animated artwork');
        }

        return data.publicUrl.split('?')[0];
    }

    public async getSongAnimatedArtworkUrl(syncId: string): Promise<string | null> {
        const { data } = this.supabase.storage.from('songs-animated-artwork').getPublicUrl(`${syncId}.webp`);
        return data?.publicUrl ? data.publicUrl.split('?')[0] : null;
    }
}
