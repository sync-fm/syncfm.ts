import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SyncFMAlbum, SyncFMArtist, SyncFMSong } from './types/syncfm';
import { normalizeSongData } from './utils';
import { mergeData, songMergeConfig, artistMergeConfig, albumMergeConfig, MergeConfig } from './squish';

export class Database {
    private supabase: SupabaseClient;

    constructor(supabaseUrl: string, supabaseKey: string) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    /**
     * A generic method to handle the fetch, merge, and upsert pattern.
     * @param table The table name in Supabase.
     * @param newData The incoming data to be upserted.
     * @param mergeConfig The configuration for merging data.
     * @returns The upserted data.
     */
    private async _upsert<T extends { syncId: string }>(
        table: string,
        newData: Partial<T>,
        mergeConfig: MergeConfig<T>
    ): Promise<T> {
        if (!newData.syncId) {
            throw new Error('syncId is required for upsert operations.');
        }

        // Fetch existing entity
        const { data: existingData, error: fetchError } = await this.supabase
            .from(table)
            .select('*')
            .eq('syncId', newData.syncId)
            .maybeSingle();

        if (fetchError) {
            throw new Error(`Error fetching existing ${table} entity: ${fetchError.message}`);
        }

        // Merge data if entity exists
        const dataToUpsert = existingData
            ? mergeData(existingData as T, newData, mergeConfig)
            : newData;

        // Upsert the final data
        const { data, error: upsertError } = await this.supabase
            .from(table)
            .upsert(dataToUpsert)
            .select()
            .single();

        if (upsertError) {
            throw new Error(`Error upserting ${table} entity: ${upsertError.message}`);
        }

        return data as T;
    }

    public async getSongBySyncId(syncId: string): Promise<SyncFMSong | null> {
        const { data, error } = await this.supabase.from('songs').select('*').eq('syncId', syncId).maybeSingle();
        if (error) console.error(`Error fetching song: ${error.message}`);
        return data;
    }

    public async getArtistBySyncId(syncId: string): Promise<SyncFMArtist | null> {
        const { data, error } = await this.supabase.from('artists').select('*').eq('syncId', syncId).maybeSingle();
        if (error) console.error(`Error fetching artist: ${error.message}`);
        return data;
    }

    public async getAlbumBySyncId(syncId: string): Promise<SyncFMAlbum | null> {
        const { data, error } = await this.supabase.from('albums').select('*').eq('syncId', syncId).maybeSingle();
        if (error) console.error(`Error fetching album: ${error.message}`);
        return data;
    }

    public async upsertSong(songData: Partial<SyncFMSong>): Promise<SyncFMSong> {
        if (songData.title) {
            const normalized = normalizeSongData(songData as SyncFMSong);
            songData.title = normalized.cleanTitle;
            songData.artists = normalized.allArtists;
        }
        return this._upsert<SyncFMSong>('songs', songData, songMergeConfig);
    }

    public async upsertArtist(artistData: Partial<SyncFMArtist>): Promise<SyncFMArtist> {
        return this._upsert<SyncFMArtist>('artists', artistData, artistMergeConfig);
    }

    public async upsertAlbum(albumData: Partial<SyncFMAlbum>): Promise<SyncFMAlbum> {
        return this._upsert<SyncFMAlbum>('albums', albumData, albumMergeConfig);
    }

    public async uploadSongAnimatedArtwork(imageBuffer: Buffer, syncId: string): Promise<string> {
        const filePath = `${syncId}.webp`;
        const { error } = await this.supabase.storage
            .from('songs-animated-artwork')
            .upload(filePath, imageBuffer, {
                cacheControl: '3600',
                upsert: true,
                contentType: 'image/webp'
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
