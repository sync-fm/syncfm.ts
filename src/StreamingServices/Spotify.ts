import { SpotifyApi, Track } from '@spotify/web-api-ts-sdk';
import { SyncFMSong, SyncFMExternalIdMap } from '../types/syncfm';
import { generateSyncId } from '../utils';

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
    type: string // will just say "artist" i think
    uri: string; // Spotify URI
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

export const createSpotifySongURL = function (id: string): string {
    return `https://open.spotify.com/track/${id}`;
}