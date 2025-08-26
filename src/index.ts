import { Database } from './database';
import { AppleMusicService } from './StreamingServices/AppleMusic';
import { SpotifyService } from './StreamingServices/Spotify';
import { YouTubeMusicService } from './StreamingServices/YouTubeMusic';
import { SyncFMArtist, SyncFMSong, SyncFMConfig, SyncFMExternalIdMapToDesiredService, SyncFMAlbum } from './types/syncfm';
import { normalizeAlbumData, normalizeSongData } from './utils';
export * from './types/syncfm';
export * from './types/StreamingService';

export class SyncFM {
    private readonly config: SyncFMConfig;
     Spotify: SpotifyService;
     AppleMusic = new AppleMusicService();
     YouTubeMusic = new YouTubeMusicService();
    private Database: Database;
    constructor(config: SyncFMConfig) {
        this.config = config;
        
        if (!this.config.SpotifyClientId || !this.config.SpotifyClientSecret) {
            throw new Error("Spotify Client ID and Secret not provided. Spotify functionality will be limited.");
        }
        this.Spotify = new SpotifyService(this.config.SpotifyClientId, this.config.SpotifyClientSecret);
        if (this.config.SupabaseUrl && this.config.SupabaseKey) {
            this.Database = new Database(this.config.SupabaseUrl, this.config.SupabaseKey);
        } else {
            throw new Error("Supabase URL and Key not provided. Database functionality will be limited.");
        }
    }


    // Function to tell what streaming service the input URL is from
    getStreamingServiceFromUrl = (url: string): "applemusic" | "spotify" | "ytmusic" => {
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

    getInputTypeFromUrl = (url: string, service: "applemusic" | "spotify" | "ytmusic"): "song" | "playlist" | "album" | "artist" => {
        switch (service) {
            case "applemusic":
                return this.AppleMusic.getAppleMusicInputType(url);
            case "spotify":
                return this.Spotify.getSpotifyInputType(url);
            case "ytmusic":
                return this.YouTubeMusic.getYouTubeMusicInputType(url);
            default:
                throw new Error("Unsupported streaming service");
        }
    }

    getInputSongInfo = async (input: string): Promise<SyncFMSong> => {
        const service = this.getStreamingServiceFromUrl(input);
        let songInfo: SyncFMSong;
        switch (service) {
            case "applemusic":
                {
                    const appleMusicSongId = this.AppleMusic.getAppleMusicIdFromURL(input);
                    songInfo = await this.AppleMusic.getSongFromAppleMusicId(appleMusicSongId);
                    break;
                }
            case "spotify":
                {
                    const spotifySongId = this.Spotify.getSpotifyIdFromURL(input);
                    songInfo = await this.Spotify.getSpotifySongById(spotifySongId);
                    break;
                }
            case "ytmusic":
                {
                    const ytmSongId = this.YouTubeMusic.getYouTubeMusicIdFromUrl(input);
                    songInfo = await this.YouTubeMusic.getYouTubeMusicSongById(ytmSongId);
                    break;
                }
            default:
                throw new Error("Unsupported streaming service");
        }
        return songInfo;
    }

    getInputArtistInfo = async (input: string): Promise<SyncFMArtist> => {
        const service = this.getStreamingServiceFromUrl(input);
        let artistInfo;
        switch (service) {
            case "applemusic":
                {
                    const appleMusicArtistId = this.AppleMusic.getAppleMusicIdFromURL(input);
                    artistInfo = await this.AppleMusic.getArtistFromAppleMusicId(appleMusicArtistId);
                    break;
                }
            case "spotify":
                {
                    const spotifyArtistId = this.Spotify.getSpotifyIdFromURL(input);
                    artistInfo = await this.Spotify.getSpotifyArtistById(spotifyArtistId);
                    break;
                }
            case "ytmusic":
                {
                    const ytmArtistId = this.YouTubeMusic.getYouTubeMusicIdFromUrl(input);
                    artistInfo = await this.YouTubeMusic.getYouTubeArtistById(ytmArtistId);
                    break;
                }
            default:
                throw new Error("Unsupported streaming service");
        }
        return artistInfo;
    }

    getInputAlbumInfo = async (input: string): Promise<SyncFMAlbum> => {
        const service = this.getStreamingServiceFromUrl(input);
        let albumInfo;
        switch (service) {
            case "applemusic":
                {
                    const appleMusicAlbumId = this.AppleMusic.getAppleMusicIdFromURL(input);
                    albumInfo = await this.AppleMusic.getAlbumFromAppleMusicId(appleMusicAlbumId);
                    break;
                }
            case "spotify":
                {
                    const spotifyAlbumId = this.Spotify.getSpotifyIdFromURL(input);
                    albumInfo = await this.Spotify.getSpotifyAlbumFromId(spotifyAlbumId);
                    break;
                }
            case "ytmusic":
                {
                    const ytmAlbumId = this.YouTubeMusic.getYouTubeMusicIdFromUrl(input);
                    albumInfo = await this.YouTubeMusic.getYouTubeAlbumById(ytmAlbumId);
                    break;
                }
            default:
                throw new Error("Unsupported streaming service");
        }
        return albumInfo;
    }
    convertSong = async (songInfo: SyncFMSong, desiredService: "applemusic" | "spotify" | "ytmusic") => {
        let convertedSong: SyncFMSong;
        // First lets see if we have the song in db
        let dbSong = await this.Database.getSongBySyncId(songInfo.syncId);
        if (dbSong) {
            // Check if the desired service ID exists in the externalIds
            if (dbSong.externalIds && dbSong.externalIds[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbSong;
            }
        }
        const normalizedSongData = normalizeSongData(songInfo);
        switch (desiredService) {
            case "applemusic":
                convertedSong = await this.AppleMusic.getSongBySearchQuery(`${normalizedSongData.cleanTitle} ${normalizedSongData.allArtists.join(", ")}`);
                break;
            case "spotify": {
                convertedSong = await this.Spotify.getSpotifySongFromSearchQuery(`${normalizedSongData.cleanTitle} ${normalizedSongData.allArtists.join(", ")}`);
                break;
            }
            case "ytmusic":
                convertedSong = await this.YouTubeMusic.getYouTubeMusicSongBySearchQuery(`${normalizedSongData.cleanTitle} ${normalizedSongData.allArtists.join(", ")}`);
                break;
            default:
                throw new Error("Unsupported streaming service");
        }
        dbSong = await this.Database.upsertSong(songInfo)
        return {...convertedSong, ...dbSong};
    }
    convertArtist = async (artistInfo: SyncFMArtist, desiredService: "applemusic" | "spotify" | "ytmusic") => {
        let convertedArtist;
        let dbArtist = await this.Database.getArtistBySyncId(artistInfo.syncId);
        if (dbArtist) {
            // Check if the desired service ID exists in the externalIds
            if (dbArtist.externalIds && dbArtist.externalIds[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbArtist;
            }
        }
        switch (desiredService) {
            case "applemusic":
                convertedArtist = await this.AppleMusic.getArtistBySearchQuery(artistInfo.name);
                break;
            case "spotify":
                convertedArtist = await this.Spotify.getSpotifyArtistFromSearchQuery(artistInfo.name);
                break;
            case "ytmusic":
                convertedArtist = await this.YouTubeMusic.getYouTubeArtistFromSearchQuery(artistInfo.name);
                break;
            default:
                throw new Error("Unsupported streaming service");
        }
        dbArtist = await this.Database.upsertArtist(convertedArtist)
        return {...convertedArtist, ...dbArtist};
    }
    convertAlbum = async (albumInfo: SyncFMAlbum, desiredService: "applemusic" | "spotify" | "ytmusic") => {
        let convertedAlbum;
        let dbAlbum = await this.Database.getAlbumBySyncId(albumInfo.syncId);
        if (dbAlbum) {
            // Check if the desired service ID exists in the externalIds
            if (dbAlbum.externalIds && dbAlbum.externalIds[SyncFMExternalIdMapToDesiredService[desiredService]]) {
                return dbAlbum;
            }
        }
        let normalizedAlbum = normalizeAlbumData(albumInfo);
        switch (desiredService) {
            case "applemusic":
                convertedAlbum = await this.AppleMusic.getAlbumBySearchQuery(normalizedAlbum.cleanTitle + " " + (normalizedAlbum.allArtists ? normalizedAlbum.allArtists.join(", ") : ""));
                break;
            case "spotify":
                convertedAlbum = await this.Spotify.getSpotifyAlbumFromSearchQuery(normalizedAlbum.cleanTitle + " " + (normalizedAlbum.allArtists ? normalizedAlbum.allArtists.join(", ") : ""));
                break;
            case "ytmusic":
                convertedAlbum = await this.YouTubeMusic.getYouTubeAlbumFromSearchQuery(normalizedAlbum.cleanTitle + " " + (normalizedAlbum.allArtists ? normalizedAlbum.allArtists.slice(0,2).join(" ") : ""));
                break;
            default:
                throw new Error("Unsupported streaming service");
        }
        dbAlbum = await this.Database.upsertAlbum(convertedAlbum)
        return {...convertedAlbum, ...dbAlbum};
    }

    createSongURL = (song: SyncFMSong, service: "applemusic" | "spotify" | "ytmusic"): string => {
        switch (service) {
            case "applemusic":
                return this.AppleMusic.createAppleMusicURL(song.externalIds.AppleMusic, "song");
            case "spotify":
                return this.Spotify.createSpotifyURL(song.externalIds.Spotify, "song");
            case "ytmusic":
                return this.YouTubeMusic.createYoutubeMusicURL(song.externalIds.YouTube, "song");
            default:
                throw new Error("Unsupported streaming service");
        }
    }

    createArtistURL = (artist: SyncFMArtist, service: "applemusic" | "spotify" | "ytmusic"): string => {
        switch (service) {
            case "applemusic":
                return this.AppleMusic.createAppleMusicURL(artist.externalIds.AppleMusic, "artist");
            case "spotify":
                return this.Spotify.createSpotifyURL(artist.externalIds.Spotify, "artist");
            case "ytmusic":
                return this.YouTubeMusic.createYoutubeMusicURL(artist.externalIds.YouTube, "artist");
            default:
                throw new Error("Unsupported streaming service");
        }
    }
    createAlbumURL = (album: SyncFMAlbum, service: "applemusic" | "spotify" | "ytmusic"): string => {
        switch (service) {
            case "applemusic":
                return this.AppleMusic.createAppleMusicURL(album.externalIds.AppleMusic, "album");
            case "spotify":
                return this.Spotify.createSpotifyURL(album.externalIds.Spotify, "album");
            case "ytmusic":
                return this.YouTubeMusic.createYoutubeMusicURL(album.externalIds.YouTube, "album");
            default:
                throw new Error("Unsupported streaming service");
        }
    }
}
