import YTMusic from "ytmusic-api"; // Import the YTMusic class from the ytmusic-api package
import { SyncFMSong, SyncFMExternalIdMap } from '../types/syncfm';
import { generateSyncId } from '../utils';
import fs from 'fs';


const ytmusic = new YTMusic()
await ytmusic.initialize(/* Optional: Custom cookies */)


// Internal Types

interface YouTubeMusicSearchResult {
    // Generics
    type: "SONG" | "ALBUM" | "PLAYLIST" | "ARTIST"; // Type of the item
    name: string; // Name of the song / album / playlist / artist
    thumbnails: {
        url: string; // URL to the song thumbnail
        width: number; // Width of the thumbnail
        height: number; // Height of the thumbnail
    }[]; // Array of thumbnails

    // Everything but artist
    artist?: {
        artistId?: string; // Youtube "channel" id
        name: string; // Name of the artist
    }

    // Song, Video only
    videoId?: string; // Youtube "video" id
    duration?: number; // Duration of the song in seconds

    // Artist only
    artistId?: string; // Youtube "channel" id

    // Album only
    year?: number; // Year of the song / album / playlist / artist
    albumId?: string; // Youtube "playlist" id
    playlistId?: string; // Youtube "playlist" id
}

interface YouTubeMusicSong { // This represents the detailed song object from ytmusic.getSong(id)
    type: string; // Type of the item (SONG)
    videoId: string; // Youtube "video" id
    name: string; // Name of the song
    artist: {
        artistId: string; // Youtube "channel" id
        name: string; // Name of the artist
    };
    duration: number; // Duration of the song in seconds
    thumbnails: {
        url: string; // URL to the song thumbnail
        width: number; // Width of the thumbnail
        height: number; // Height of the thumbnail
    }[]; // Array of thumbnails

    // We dont care about formats and adaptiveFormats
}

export const getYouTubeMusicSongById = async (id: string): Promise<SyncFMSong> => {
    const ytMusicSong = await ytmusic.getSong(id); // ytmusic.getSong returns a more detailed song object
    
    const externalIds: SyncFMExternalIdMap = { YouTube: id }; // Use the passed id (videoId)

    const syncFmSong: SyncFMSong = {
        syncId: generateSyncId(ytMusicSong.name, ytMusicSong.artist ? [ytMusicSong.artist.name] : [], ytMusicSong.duration),
        title: ytMusicSong.name,
        description: undefined, // YTMusic API doesn't typically provide a separate description for song object
        artists: ytMusicSong.artist ? [ytMusicSong.artist.name] : [],
        album: undefined, // Detailed song object from ytmusic.getSong might not have album name directly
        releaseDate: undefined, // Or parse from somewhere if available, e.g. album info if fetched separately
        duration: ytMusicSong.duration, // Already in seconds
        imageUrl: ytMusicSong.thumbnails[0]?.url, // Taking the first thumbnail
        externalIds: externalIds,
        explicit: undefined, // YTMusic API doesn't typically provide explicit flag directly
    };
    return syncFmSong;
}

export const getYouTubeMusicSongBySearchQuery = async (query: string): Promise<SyncFMSong> => {
    const searchResults = await ytmusic.searchSongs(query);
    if (searchResults.length === 0) {
        throw new Error("No results found");
    }

    // Define a more specific type for a song item from search results
    type YouTubeMusicApiSongSearchResult = YouTubeMusicSearchResult & {
        type: "SONG";
        videoId: string;
        duration: number;
        album?: {
            name: string; // Album name
            albumId: string; // Album ID
        }
        // Properties like name, artist?, year?, thumbnails are inherited from YouTubeMusicSearchResult
    };

    const songResult: YouTubeMusicApiSongSearchResult = searchResults.find(
        (result: any): result is YouTubeMusicApiSongSearchResult => // result is 'any' if searchResults type is not strongly defined
            result.type === "SONG" &&
            typeof result.videoId === 'string' &&
            typeof result.duration === 'number'
    );

    if (!songResult) {
        throw new Error("No song found in search results or song result is missing required fields");
    }
    
    // Now songResult is typed as YouTubeMusicApiSongSearchResult
    // So, songResult.videoId is string, songResult.duration is number.
    // songResult.artist, songResult.year are optional as per YouTubeMusicSearchResult.

    const externalIds: SyncFMExternalIdMap = { YouTube: songResult.videoId };

    const syncFmSong: SyncFMSong = {
        syncId: generateSyncId(songResult.name, songResult.artist ? [songResult.artist.name] : [], songResult.duration),
        title: songResult.name, // 'name' is a required property in YouTubeMusicSearchResult
        description: undefined,
        artists: songResult.artist ? [songResult.artist.name] : [], // Safely access artist name
        album: songResult.album.name, // Album name not directly available in search result for song
        releaseDate: songResult.year ? songResult.year.toString() : undefined, // Safely access year
        duration: songResult.duration, // 'duration' is a number here
        imageUrl: songResult.thumbnails && songResult.thumbnails.length > 0 ? songResult.thumbnails[0].url : undefined,
        externalIds: externalIds,
        explicit: undefined,
    };
    return syncFmSong;
}

export const getYouTubeMusicIdFromUrl = (url: string): string => {
    // https://music.youtube.com/watch?v=LoW8b8eLPkA&si=CZ7LDJW3mZkHZjad
    const urlParts = url.split("v=");
    if (urlParts.length < 2) {
        throw new Error("Invalid URL");
    }
    const id = urlParts[1].split("&")[0];
    return id;
}

export const createYoutubeMusicSongUrl = function (id: string): string {
    return `https://music.youtube.com/watch?v=${id}`;
}