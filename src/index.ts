import * as AppleMusic from './StreamingServices/AppleMusic';
import * as Spotify from './StreamingServices/Spotify';
import * as YouTubeMusic from './StreamingServices/YouTubeMusic';

import { SyncFMSong } from './types/syncfm';

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

export const createSongURL = (song: SyncFMSong, service: "applemusic" | "spotify" | "ytmusic"): string => {
    switch (service) {
        case "applemusic":
            return AppleMusic.createAppleMusicURL(song.externalIds.AppleMusic, "song");
        case "spotify":
            return Spotify.createSpotifySongURL(song.externalIds.Spotify);
        case "ytmusic":
            return YouTubeMusic.createYoutubeMusicSongUrl(song.externalIds.YouTube);
        default:
            throw new Error("Unsupported streaming service");
    }
}