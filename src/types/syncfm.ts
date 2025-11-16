/* eslint-disable no-unused-vars */
import type { ConversionErrorMap, ConversionWarningMap } from './errors';

export interface SyncFMConfig {
    SpotifyClientId?: string;
    SpotifyClientSecret?: string;
    SupabaseUrl?: string;
    SupabaseKey?: string;
    YouTubeApiKey?: string;
    enableStreamingDebug?: boolean;
}

export type ServiceName = "applemusic" | "spotify" | "ytmusic";
export type MusicEntityType = "song" | "album" | "artist" | "playlist";

export enum SyncFMService {
    AppleMusic = 'Apple Music',
    Spotify = 'Spotify',
    YouTube = 'YouTube',
    SoundCloud = 'SoundCloud',
    Deezer = 'Deezer',
    Tidal = 'Tidal',
    LastFM = 'LastFM',
    AmazonMusic = 'Amazon Music',
}
export enum SyncFMExternalIdMapToDesiredService {
    applemusic = 'AppleMusic',
    ytmusic = 'YouTube',
    spotify = 'Spotify',
}
export interface SyncFMExternalIdMap {
    AppleMusic?: string; // Apple Music ID
    Spotify?: string; // Spotify ID
    YouTube?: string; // YouTube ID
    SoundCloud?: string; // SoundCloud ID
    Deezer?: string; // Deezer ID
    Tidal?: string; // Tidal ID
    LastFM?: string; // LastFM ID
}

export interface SyncFMArtist {
    syncId: string; // Hash of generic artist info that is the same across all streaming services
    shortcode?: string; // Shortcode for easy sharing
    name: string; // Name of the artist
    imageUrl?: string; // URL of the artist's image
    externalIds: SyncFMExternalIdMap;
    genre?: string[];
    albums?: SyncFMAlbum[];
    tracks?: SyncFMArtistTrack[];
    conversionErrors?: ConversionErrorMap; // Tracks failed conversion attempts with details
    conversionWarnings?: ConversionWarningMap; // Tracks successful fallback conversions (syncId mismatch)
    // Later we could add so much here xd
}
export interface SyncFMArtistTrack {
    title: string;
    duration?: number;
    externalIds: SyncFMExternalIdMap;
    thumbnailUrl?: string;
    contentUrl?: string;
    uploadDate?: string;
}
export interface SyncFMPlaylist {
    syncId: string; // Hash of generic playlist info that is the same across all streaming services
    title: string; // Title of the playlist
    description?: string; // Description of the playlist
    imageUrl?: string; // URL of the playlist cover image
    originalService: SyncFMService; // Original streaming service of the playlist
    externalIds: SyncFMExternalIdMap;
    conversionErrors?: ConversionErrorMap; // Tracks failed conversion attempts with details
    conversionWarnings?: ConversionWarningMap; // Tracks successful fallback conversions (syncId mismatch)
    songs?: SyncFMSong[]; // Array of songs in the playlist
    totalTracks?: number; // Total number of tracks in the playlist
    duration?: number; // Duration of the playlist in seconds
    createdBy?: string; // User who created the playlist
    createdDate?: string; // Date when the playlist was created
    modifiedDate?: string; // Date when the playlist was last modified
}

export interface SyncFMSong {
    syncId: string; // Hash of generic song info that is the same across all streaming services
    shortcode?: string; // Shortcode for easy sharing
    title: string; // Title of the song
    description?: string; // Description of the song
    artists: string[]; // Array of artist names
    album?: string; // Album name
    releaseDate?: Date; // Release date of the song
    duration?: number; // Duration of the song in seconds
    imageUrl?: string; // URL of the album cover image
    animatedImageUrl?: string; // URL of the animated album cover image (if available)
    externalIds: SyncFMExternalIdMap;
    explicit?: boolean; // Whether the song is explicit or not
    conversionErrors?: ConversionErrorMap; // Tracks failed conversion attempts with details
    conversionWarnings?: ConversionWarningMap; // Tracks successful fallback conversions (syncId mismatch)
}

export interface SyncFMAlbum {
    syncId: string; // Hash of generic album info that is the same across all streaming services
    shortcode?: string; // Shortcode for easy sharing
    title: string; // Title of the album
    description?: string; // Description of the album
    artists: string[]; // Array of artist names
    releaseDate?: string; // Release date of the album
    imageUrl?: string; // URL of the album cover image
    externalIds: SyncFMExternalIdMap;
    conversionErrors?: ConversionErrorMap; // Tracks failed conversion attempts with details
    conversionWarnings?: ConversionWarningMap; // Tracks successful fallback conversions (syncId mismatch)
    songs: SyncFMSong[]; // Array of songs in the album
    totalTracks?: number; // Total number of tracks in the album
    duration?: number; // Duration of the album in seconds
    label?: string; // Record label of the album
    genres?: string[]; // Array of genres associated with the album
    explicit?: boolean; // Whether the album is explicit or not
}