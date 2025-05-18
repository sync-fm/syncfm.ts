import { SpotifyApi, Track, Album } from '@spotify/web-api-ts-sdk';
import { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../types/syncfm';
import { generateSyncArtistId, generateSyncId } from '../utils';
import fs from 'fs';
let sdk: SpotifyApi;

function initializeSpotifyApi() {
    if (!sdk) { // Check if sdk is already initialized
        const clientId = process.env.SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            throw new Error("Spotify client ID or secret not configured in environment variables.");
        }
        sdk = SpotifyApi.withClientCredentials(clientId, clientSecret);
    }
    return sdk;
}

// Internal types

interface SpotifyAlbum {
    album_type: string; // Type of the album (album, single, compilation)
    artists: SpotifyArtist[]; // Array of artists
    external_urls: {
        spotify: string; // Web URL to the album on spotify - The one we want
    }
    href: string; // api URL to the album
    id: string; // Spotify ID
    images: {
        height: number; // Height of the image
        url: string; // URL to the image
        width: number; // Width of the image
    }[]; // Array of images
    name: string; // Name of the album
    release_date: string; // Release date of the album (YYYY-MM-DD)
    release_date_precision: string; // Precision of the release date (day, month, year)
    total_tracks: number; // Total number of tracks in the album
    type: string | "album" | "single" | "compilation"; // Type of the item
    uri: string; // Spotify URI
}

interface SpotifyArtist {
    href: string; // api URL to the artist
    id: string; // Spotify ID
    name: string; // Name of the artist
    popularity?: number; // Popularity of the artist (spotify)
    type: string // will just say "artist" i think
    uri: string; // Spotify URI
    genres: string[]; // Array of genres
    followers?: {
        href: string; // api URL to the followers
        total: number; // Total number of followers
    }
    images?: {
        url: string; // URL to the image
        height: number; // Height of the image
        width: number; // Width of the image
    }[];
    external_urls: {
        spotify: string; // Web URL to the artist on spotify - The one we want
    }
}

interface SpotifySong {
    href: string; // API URL to the song on spotify
    external_urls: {
        spotify: string; // Web URL to the song on spotify - The one we want
    }
    explicit: boolean; // Whether the song is explicit or not
    name: string; // Name of the song
    id: string; // Spotify ID
    disc_number?: number; // Disc number ???
    track_number?: number; // Track number (if in album)
    popularity: number; // Popularity of the song (spotify)
    type: string | "track" | "album" | "artist" | "playlist"; // Type of the item
    uri: string; // Spotify URI
    external_ids?: {
        isrc?: string; // ISRC code
    }
    duration_ms: number; // Duration of the song in milliseconds
    artists: SpotifyArtist[]; // Array of artists
    album: SpotifyAlbum; // Album info
}


// Exported functions
export const getSpotifySongById = async (id: string): Promise<SyncFMSong> => {
    const initializedSdk = initializeSpotifyApi();
    const spotifySong: Track = await initializedSdk.tracks.get(id);
    
    const externalIds: SyncFMExternalIdMap = { Spotify: spotifySong.id };

    const syncFmSong: SyncFMSong = {
        syncId: generateSyncId(spotifySong.name, spotifySong.artists.map(a => a.name), spotifySong.duration_ms / 1000),
        title: spotifySong.name,
        description: undefined, // Spotify API for track doesn't usually have a dedicated description field
        artists: spotifySong.artists.map(a => a.name),
        album: spotifySong.album.name,
        releaseDate: spotifySong.album.release_date,
        duration: spotifySong.duration_ms / 1000,
        imageUrl: spotifySong.album.images[0]?.url, // Taking the first image, usually the largest
        externalIds: externalIds,
        explicit: spotifySong.explicit,
    };
    return syncFmSong;
};

export const getSpotifyArtistById = async (id: string): Promise<SyncFMArtist> => {
    const initializedSdk = initializeSpotifyApi();
    const spotifyArtist: SpotifyArtist = await initializedSdk.artists.get(id);
    
    const externalIds: SyncFMExternalIdMap = { Spotify: spotifyArtist.id };

    const syncFmArtist: SyncFMArtist = {
        syncId: generateSyncArtistId(spotifyArtist.name),
        name: spotifyArtist.name,
        imageUrl: spotifyArtist.images[0]?.url, // Taking the first image, usually the largest
        externalIds: externalIds,
        genre: spotifyArtist.genres, // Genre is not available in the artist object
    };
    return syncFmArtist;
}

export const getSpotifyArtistFromSearchQuery = async (query: string): Promise<SyncFMArtist> => {
    const initializedSdk = initializeSpotifyApi();
    const searchResult = await initializedSdk.search(query, ["artist"], null, 1);
    if (searchResult.artists.items.length > 0) {
        const spotifyArtist: SpotifyArtist = searchResult.artists.items[0];
        const externalIds: SyncFMExternalIdMap = { Spotify: spotifyArtist.id };
        const syncFmArtist: SyncFMArtist = {
            syncId: generateSyncArtistId(spotifyArtist.name),
            name: spotifyArtist.name,
            imageUrl: spotifyArtist.images[0]?.url, // Taking the first image, usually the largest
            externalIds: externalIds,
            genre: spotifyArtist.genres, // Genre is not available in the artist object
        };
        return syncFmArtist;
    } else {
        throw new Error("No artist found");
    }
}
export const getSpotifySongFromSearchQuery = async (query: string): Promise<SyncFMSong> => {
    const initializedSdk = initializeSpotifyApi();
    const searchResult = await initializedSdk.search(query, ["track"], null, 1);
    if (searchResult.tracks.items.length > 0) {
        const spotifySong: Track = searchResult.tracks.items[0];
        
        const externalIds: SyncFMExternalIdMap = { Spotify: spotifySong.id };

        const syncFmSong: SyncFMSong = {
            syncId: generateSyncId(spotifySong.name, spotifySong.artists.map(a => a.name), spotifySong.duration_ms / 1000),
            title: spotifySong.name,
            description: undefined,
            artists: spotifySong.artists.map(a => a.name),
            album: spotifySong.album.name,
            releaseDate: spotifySong.album.release_date,
            duration: spotifySong.duration_ms / 1000,
            imageUrl: spotifySong.album.images[0]?.url,
            externalIds: externalIds,
            explicit: spotifySong.explicit,
        };
        return syncFmSong;
    } else {
        throw new Error("No song found");
    }
}

export const getSpotifyIdFromURL = function (url: string): string {
    const urlParts = url.split("/");
    const id = urlParts[urlParts.length - 1];
    if (id.includes("?")) {
        return id.split("?")[0];
    }
    return id;
}

export const getSpotifyInputType = function (url: string): "song" | "playlist" | "album" | "artist" | null {
    const urlParts = url.split("/");
    if (urlParts.length < 2) {
        return null;
    }
    const type = urlParts[3];
    if (type === "track") {
        return "song";
    } else if (type === "playlist") {
        return "playlist";
    } else if (type === "album") {
        return "album";
    } else if (type === "artist") {
        return "artist";
    } else {
        return null;
    }
}

export const getSpotifyAlbumFromId = async (id: string): Promise<SyncFMAlbum> => {
    const initializedSdk = initializeSpotifyApi();
    const spotifyAlbum: Album = await initializedSdk.albums.get(id);

    const externalIds: SyncFMExternalIdMap = { Spotify: spotifyAlbum.id };
    const albumArtists = spotifyAlbum.artists.map(a => a.name);

    let songs: SyncFMSong[] = [];
    if (spotifyAlbum.tracks.items.length > 0) {
        songs = spotifyAlbum.tracks.items.map(track => {
            const trackArtists = track.artists.map(a => a.name);
            const songDuration = track.duration_ms / 1000;
            const externalTrackIds: SyncFMExternalIdMap = { Spotify: track.id };

            return {
                syncId: generateSyncId(track.name, trackArtists, songDuration),
                title: track.name,
                artists: trackArtists,
                album: spotifyAlbum.name,
                releaseDate: spotifyAlbum.release_date,
                duration: songDuration,
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

export const getSpotifyAlbumFromSearchQuery = async (query: string): Promise<SyncFMAlbum> => {
    const initializedSdk = initializeSpotifyApi();
    const searchResult = await initializedSdk.search(query, ["album"], null, 1);
    if (searchResult.albums.items.length > 0) {
        const spotifyAlbum = searchResult.albums.items[0];
        if (spotifyAlbum && spotifyAlbum.id) {
            return await getSpotifyAlbumFromId(spotifyAlbum.id);
        }
    }
    throw new Error("No album found for the given query.");
}

export const createSpotifyURL = function (id: string, type: string = "song"): string {
    if (type === "playlist") {
        return `https://open.spotify.com/playlist/${id}`;
    } else if (type === "album") {
        return `https://open.spotify.com/album/${id}`;
    } else if (type === "artist") {
        return `https://open.spotify.com/artist/${id}`;
    }
    return `https://open.spotify.com/track/${id}`;
}