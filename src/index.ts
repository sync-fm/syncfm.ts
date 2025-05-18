import * as AppleMusic from './StreamingServices/AppleMusic';
import * as Spotify from './StreamingServices/Spotify';
import * as YouTubeMusic from './StreamingServices/YouTubeMusic';

import { SyncFMArtist, SyncFMSong } from './types/syncfm';

// Function to tell what streaming service the input URL is from
export const getStreamingServiceFromUrl = (url: string): "applemusic" | "spotify" | "ytmusic" => {
    if (url.includes('apple.com')) {
        return 'applemusic';
    }
    if (url.includes('spotify.com')) {
        return 'spotify';
    }
    if (url.includes('youtube.com') || url.includes('music.youtube.com')) {
        return 'ytmusic';
    }
}

export const getInputTypeFromUrl = (url: string, service: "applemusic" | "spotify" | "ytmusic" ): "song" | "playlist" | "album" | "artist" => {
    switch (service) {
        case "applemusic":
            return AppleMusic.getAppleMusicInputType(url);
        case "spotify":
            return Spotify.getSpotifyInputType(url);
        case "ytmusic":
            return YouTubeMusic.getYouTubeMusicInputType(url);
        default:
            throw new Error("Unsupported streaming service");
    }
}

export const getInputSongInfo = async (input: string) => {
    const service = getStreamingServiceFromUrl(input);
    let songInfo: SyncFMSong;
    switch (service) {
        case "applemusic":
            const appleMusicSongId = AppleMusic.getAppleMusicIdFromURL(input);
            songInfo = await AppleMusic.getSongFromAppleMusicId(appleMusicSongId);
            break;
        case "spotify":
            const spotifySongId = Spotify.getSpotifyIdFromURL(input);
            songInfo = await Spotify.getSpotifySongById(spotifySongId);
            break;
        case "ytmusic":
            const ytmSongId = YouTubeMusic.getYouTubeMusicIdFromUrl(input);
            songInfo = await YouTubeMusic.getYouTubeMusicSongById(ytmSongId);
            break;
        default:
            throw new Error("Unsupported streaming service");
    }
    return songInfo;
}

export const getInputArtistInfo = async (input: string): Promise<SyncFMArtist> => {
    const service = getStreamingServiceFromUrl(input);
    let artistInfo;
    switch (service) {
        case "applemusic":
            const appleMusicArtistId = AppleMusic.getAppleMusicIdFromURL(input);
            artistInfo = await AppleMusic.getArtistFromAppleMusicId(appleMusicArtistId);
            break;
        case "spotify":
            const spotifyArtistId = Spotify.getSpotifyIdFromURL(input);
            artistInfo = await Spotify.getSpotifyArtistById(spotifyArtistId);
            break;
        case "ytmusic":
            const ytmArtistId = YouTubeMusic.getYouTubeMusicIdFromUrl(input);
            artistInfo = await YouTubeMusic.getYouTubeArtistById(ytmArtistId);
            break;
        default:
            throw new Error("Unsupported streaming service");
    }
    return artistInfo;
}
export const convertSong = async (songInfo: SyncFMSong, desiredService: "applemusic" | "spotify" | "ytmusic") => {
    let convertedSong;
    switch (desiredService) {
        case "applemusic":
            convertedSong = await AppleMusic.getSongBySearchQuery(`${songInfo.title} ${songInfo.artists.join(", ")}`);
            break;
        case "spotify":
            convertedSong = await Spotify.getSpotifySongFromSearchQuery(`${songInfo.title} ${songInfo.artists.join(", ")}`);
            break;
        case "ytmusic":
            convertedSong = await YouTubeMusic.getYouTubeMusicSongBySearchQuery(`${songInfo.title} ${songInfo.artists.join(", ")}`);
            break;
        default:
            throw new Error("Unsupported streaming service");
    }
    return convertedSong;
}

export const convertArtist = async (artistInfo: SyncFMArtist, desiredService: "applemusic" | "spotify" | "ytmusic") => {
    let convertedArtist;
    switch (desiredService) {
        case "applemusic":
            convertedArtist = await AppleMusic.getArtistBySearchQuery(artistInfo.name);
            break;
        case "spotify":
            convertedArtist = await Spotify.getSpotifyArtistFromSearchQuery(artistInfo.name);
            break;
        case "ytmusic":
            convertedArtist = await YouTubeMusic.getYouTubeArtistFromSearchQuery(artistInfo.name);
            break;
        default:
            throw new Error("Unsupported streaming service");
    }
    return convertedArtist;
}

export const createSongURL = (song: SyncFMSong, service: "applemusic" | "spotify" | "ytmusic"): string => {
    switch (service) {
        case "applemusic":
            return AppleMusic.createAppleMusicURL(song.externalIds.AppleMusic, "song");
        case "spotify":
            return Spotify.createSpotifyURL(song.externalIds.Spotify, "song");
        case "ytmusic":
            return YouTubeMusic.createYoutubeMusicURL(song.externalIds.YouTube, "song");
        default:
            throw new Error("Unsupported streaming service");
    }
}

export const createArtistURL = (artist: SyncFMArtist, service: "applemusic" | "spotify" | "ytmusic"): string => {
    switch (service) {
        case "applemusic":
            return AppleMusic.createAppleMusicURL(artist.externalIds.AppleMusic, "artist");
        case "spotify":
            return Spotify.createSpotifyURL(artist.externalIds.Spotify, "artist");
        case "ytmusic":
            return YouTubeMusic.createYoutubeMusicURL(artist.externalIds.YouTube, "artist");
        default:
            throw new Error("Unsupported streaming service");
    }
}