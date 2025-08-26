import YTMusic from "ytmusic-api";
import { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../types/syncfm';
import { generateSyncArtistId, generateSyncId } from '../utils';
import request from "superagent";

export class YouTubeMusicService {
    private ytmusic: YTMusic;

    async getInstance(): Promise<YTMusic> {
        if (!this.ytmusic) {
            this.ytmusic = new YTMusic();
            await this.ytmusic.initialize();
        }
        return this.ytmusic;
    }


    getYouTubeMusicSongById = async (id: string): Promise<SyncFMSong> => {
        const ytmusic = await this.getInstance();
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

    getYouTubeMusicSongBySearchQuery = async (query: string): Promise<SyncFMSong> => {
        const ytmusic = await this.getInstance();

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
            releaseDate: undefined,
            duration: songResult.duration, // 'duration' is a number here
            imageUrl: songResult.thumbnails && songResult.thumbnails.length > 0 ? songResult.thumbnails[0].url : undefined,
            externalIds: externalIds,
            explicit: undefined,
        };
        return syncFmSong;
    }

    getYouTubeArtistById = async (id: string): Promise<SyncFMArtist> => {
        const ytmusic = await this.getInstance();

        const ytMusicArtist = await ytmusic.getArtist(id); // ytmusic.getArtist returns a more detailed artist object

        const externalIds: SyncFMExternalIdMap = { YouTube: id }; // Use the passed id (channelId)

        const syncFmArtist: SyncFMArtist = {
            syncId: generateSyncArtistId(ytMusicArtist.name),
            name: ytMusicArtist.name,
            imageUrl: ytMusicArtist.thumbnails[0]?.url, // Taking the first thumbnail
            externalIds: externalIds,
            genre: undefined,
        };
        return syncFmArtist;
    }

    getYouTubeArtistFromSearchQuery = async (query: string): Promise<SyncFMArtist> => {
        const ytmusic = await this.getInstance();

        const searchResults = await ytmusic.searchArtists(query);
        if (searchResults.length === 0) {
            throw new Error("No results found");
        }
        // Define a more specific type for an artist item from search results
        type YouTubeMusicApiArtistSearchResult = YouTubeMusicSearchResult & {
            type: "ARTIST";
            artistId: string; // Youtube "channel" id
            name: string; // Name of the artist
            thumbnails: {
                url: string; // URL to the artist thumbnail
                width: number; // Width of the thumbnail
                height: number; // Height of the thumbnail
            }[]; // Array of thumbnails
            // Properties like name, artist?, year?, thumbnails are inherited from YouTubeMusicSearchResult
        };
        const artistResult: YouTubeMusicApiArtistSearchResult = searchResults.find(
            (result: any): result is YouTubeMusicApiArtistSearchResult => // result is 'any' if searchResults type is not strongly defined
                result.type === "ARTIST" &&
                typeof result.artistId === 'string'
        );
        if (!artistResult) {
            throw new Error("No artist found in search results or artist result is missing required fields");
        }
        // Now artistResult is typed as YouTubeMusicApiArtistSearchResult
        // So, artistResult.artistId is string, artistResult.name is string.
        // artistResult.thumbnails is an array of objects with url, width, height properties.
        const externalIds: SyncFMExternalIdMap = { YouTube: artistResult.artistId };
        const syncFmArtist: SyncFMArtist = {
            syncId: generateSyncArtistId(artistResult.name),
            name: artistResult.name,
            imageUrl: artistResult.thumbnails[0]?.url, // Taking the first thumbnail
            externalIds: externalIds,
            genre: undefined,
        };
        return syncFmArtist;
    }
    async getBrowseIdFromPlaylist(id) {
        const standard_headers = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:72.0) Gecko/20100101 Firefox/72.0",
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/json",
            "X-Goog-AuthUser": "0",
            origin: "https://music.youtube.com",
            "X-Goog-Visitor-Id": "CgtWaTB2WWRDeEFUYyjhv-X8BQ%3D%3D"
        };
        const endpoint = "https://music.youtube.com/playlist";
        const response = await request
            .get(endpoint)
            .set(standard_headers)
            .query({ list: id });
        let match = response.text.match(/"MPRE[_a-zA-Z0-9]+/);
        let albumId;
        if (match) {
            albumId = match[0].substr(1);
        } else {
            throw new Error();
        }
        return albumId;
    }

    getYouTubeAlbumById = async (id: string) => {
        const ytmusic = await this.getInstance();
        let ytMusicAlbum: YouTubeMusicAlbum;
        if (!id.startsWith("MPREb_")) {
            console.warn("Invalid YouTube Music album ID");
            const browseId = await this.getBrowseIdFromPlaylist(id);
            ytMusicAlbum = await ytmusic.getAlbum(browseId);
        } else {
            ytMusicAlbum = await ytmusic.getAlbum(id); // ytmusic.getAlbum returns a more detailed album object
        }
        let normalizedArtists: string[] = [];
        [ytMusicAlbum.artist].forEach(artistStr => {
            const splitArtists = artistStr.name.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
            normalizedArtists.push(...splitArtists);
        });

        // Calculate total duration by summing up durations of all songs in the album
        let totalDuration = 0;
        let totalTracks = 0;
        let parsedTracks: SyncFMSong[] = [];
        ytMusicAlbum.songs.forEach(song => {
            totalTracks += 1;
            if (song.duration) {
                totalDuration += song.duration;
            }
            const externalIds: SyncFMExternalIdMap = { YouTube: song.videoId };

            const syncFmSong: SyncFMSong = {
                syncId: generateSyncId(song.name, song.artist ? [song.artist.name] : [], song.duration),
                title: song.name, // 'name' is a required property in YouTubeMusicSearchResult
                description: undefined,
                artists: song.artist ? [song.artist.name] : [], // Safely access artist name
                album: song.album.name, // Album name not directly available in search result for song
                releaseDate: undefined,
                duration: song.duration, // 'duration' is a number here
                imageUrl: song.thumbnails && song.thumbnails.length > 0 ? song.thumbnails[0].url : undefined,
                externalIds: externalIds,
                explicit: undefined,
            };
            parsedTracks.push(syncFmSong);
        });
        // Extract the artist names from the array of artist objects

        // Create the external IDs map
        const externalIds: SyncFMExternalIdMap = { YouTube: ytMusicAlbum.albumId };

        // Map the YouTube Music result to your SyncFMAlbum data model
        const syncFMAlbum: SyncFMAlbum = {
            syncId: generateSyncId(ytMusicAlbum.name, normalizedArtists, totalDuration),
            title: ytMusicAlbum.name,
            artists: normalizedArtists,
            releaseDate: undefined, // The year is optional, so it might be undefined
            imageUrl: ytMusicAlbum.thumbnails && ytMusicAlbum.thumbnails.length > 0 ? ytMusicAlbum.thumbnails[0].url : undefined,
            externalIds: externalIds,
            duration: totalDuration,
            songs: parsedTracks,
            totalTracks: totalTracks,
        };

        return syncFMAlbum;
    }

    getYouTubeAlbumFromSearchQuery = async (query: string): Promise<SyncFMAlbum> => {
        const ytmusic = await this.getInstance();
        const searchResults = await ytmusic.searchAlbums(query);

        let bestMatch: any = null;
        let highestScore = 0;

        // Helper function to score an album result against the query
        function scoreAlbumResult(album: any, query: string): number {
            const normalizedQuery = query.toLowerCase();
            const albumName = album.name?.toLowerCase() || "";
            const artistName = album.artist?.name?.toLowerCase() || "";

            let score = 0;
            // Direct match on album name
            if (normalizedQuery.includes(albumName)) score += 2;
            // Direct match on artist name
            if (normalizedQuery.includes(artistName)) score += 2;
            // Partial match on album name
            if (albumName && normalizedQuery.split(" ").some(word => albumName.includes(word))) score += 1;
            // Partial match on artist name
            if (artistName && normalizedQuery.split(" ").some(word => artistName.includes(word))) score += 1;
            // Bonus if both artist and album are present in query
            if (normalizedQuery.includes(albumName) && normalizedQuery.includes(artistName)) score += 2;
            return score;
        }

        // Find the best matching album from search results
        for (const album of searchResults) {
            const score = scoreAlbumResult(album, query);
            if (score > highestScore) {
                highestScore = score;
                bestMatch = album;
            }
        }

        // Fallback to first album if no good match found
        const selectedAlbum = bestMatch || searchResults[0];

        const albumResult: YouTubeMusicAlbum = await ytmusic.getAlbum(selectedAlbum.albumId);

        if (searchResults.length === 0) {
            throw new Error("No album results found on YouTube Music for the given query.");
        }

        if (!albumResult || !albumResult.albumId) {
            throw new Error("No valid album found in search results.");
        }
        let normalizedArtists: string[] = [];
        [albumResult.artist].forEach(artistStr => {
            const splitArtists = artistStr.name.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
            normalizedArtists.push(...splitArtists);
        });

        // Calculate total duration by summing up durations of all songs in the album
        let totalDuration = 0;
        let totalTracks = 0;
        let parsedTracks: SyncFMSong[] = [];
        albumResult.songs.forEach(song => {
            totalTracks += 1;
            if (song.duration) {
                totalDuration += song.duration;
            }
            const externalIds: SyncFMExternalIdMap = { YouTube: song.videoId };

            const syncFmSong: SyncFMSong = {
                syncId: generateSyncId(song.name, song.artist ? [song.artist.name] : [], song.duration),
                title: song.name, // 'name' is a required property in YouTubeMusicSearchResult
                description: undefined,
                artists: song.artist ? [song.artist.name] : [], // Safely access artist name
                album: song.album.name, // Album name not directly available in search result for song
                releaseDate: undefined,
                duration: song.duration, // 'duration' is a number here
                imageUrl: song.thumbnails && song.thumbnails.length > 0 ? song.thumbnails[0].url : undefined,
                externalIds: externalIds,
                explicit: undefined,
            };
            parsedTracks.push(syncFmSong);
        });
        // Extract the artist names from the array of artist objects

        // Create the external IDs map
        const externalIds: SyncFMExternalIdMap = { YouTube: albumResult.albumId };

        // Map the YouTube Music result to your SyncFMAlbum data model
        const syncFMAlbum: SyncFMAlbum = {
            syncId: generateSyncId(albumResult.name, normalizedArtists, totalDuration),
            title: albumResult.name,
            artists: normalizedArtists,
            releaseDate: undefined, // The year is optional, so it might be undefined
            imageUrl: albumResult.thumbnails && albumResult.thumbnails.length > 0 ? albumResult.thumbnails[0].url : undefined,
            externalIds: externalIds,
            duration: totalDuration,
            songs: parsedTracks,
            totalTracks: totalTracks,
        };

        return syncFMAlbum;
    };

    getYouTubeMusicIdFromUrl = (url: string): string | null => {
        try {
            const parsedUrl = new URL(url);

            // Match patterns based on pathname
            const pathname = parsedUrl.pathname;

            // 1. Video / Music
            if (pathname === '/watch') {
                return parsedUrl.searchParams.get('v'); // e.g., v=LoW8b8eLPkA
            }

            // 2. Playlist
            if (pathname === '/playlist') {
                return parsedUrl.searchParams.get('list'); // e.g., list=PLabcd...
            }

            // 3. Album (usually starts with /browse/MPREb_...)
            if (pathname.startsWith('/browse/MPREb_')) {
                return pathname.split('/').pop(); // e.g., MPREb_XXXXXXXXX
            }

            // 4. Artist / Channel (usually starts with /channel/UC...)
            if (pathname.startsWith('/channel/')) {
                return pathname.split('/').pop(); // e.g., UCqJnSdHjKtfsrHi9aI-9d3g
            }

            // 5. Possibly other browse URLs (like artist: /browse/...)
            if (pathname.startsWith('/browse/')) {
                return pathname.split('/').pop(); // general fallback for browse
            }

            return null;
        } catch {
            return null;
        }
    };

    createYoutubeMusicURL = function (id: string, type: string = "song"): string {
        if (type === "song") {
            return `https://music.youtube.com/watch?v=${id}`;
        } else if (type === "playlist") {
            return `https://music.youtube.com/playlist?list=${id}`;
        } else if (type === "album") {
            return `https://music.youtube.com/browse/${id}`;
        } else if (type === "artist") {
            return `https://music.youtube.com/channel/${id}`;
        } else {
            throw new Error("Invalid type");
        }
    }

    getYouTubeMusicInputType = function (url: string): "song" | "playlist" | "album" | "artist" | null {
        const urlParts = url.split("/");
        if (urlParts.length < 2) {
            return null;
        }
        const type = urlParts[3].split("?")[0]; // Get the part after the domain and before any query parameters
        if (type === "watch") {
            return "song";
        } else if (type === "playlist") {
            return "album";
        } else if (type === "album") {
            return "album";
        } else if (type === "artist") {
            return "artist";
        } else if (type === "channel") {
            return "artist";
        } else {
            return null;
        }
    }
}

// Internal Types
export interface YouTubeMusicSearchResult {
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


export interface YouTubeMusicSong { // This represents the detailed song object from ytmusic.getSong(id)
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

export interface YouTubeMusicAlbum {
    type: "ALBUM";
    name: string;
    albumId: string;
    artist: {
        artistId: string | null;
        name: string;
    };
    thumbnails: {
        url: string;
        width: number;
        height: number;
    }[];
    playlistId: string;
    year: number | null;
    songs: {
        type: "SONG";
        name: string;
        videoId: string;
        artist: {
            artistId: string | null;
            name: string;
        };
        album: {
            name: string;
            albumId: string;
        } | null;
        duration: number | null;
        thumbnails: {
            url: string;
            width: number;
            height: number;
        }[];
    }[];
}