import { SyncFMSong, SyncFMExternalIdMap, SyncFMArtist, SyncFMAlbum } from '../types/syncfm'; // Added SyncFMAlbum
import { generateSyncId, generateSyncArtistId } from '../utils';
// Internal Types
interface AppleMusicSong {
  name: string;
  url: string;
  datePublished: string;
  description: string; // AM Marketing description
  timeRequired: string; // ISO 8601 duration format.
  image: string; // URL to the song image
  audio?: AppleMusicAudioInfo;
  video?: AppleMusicVideoInfo[];
  lyrics?: AppleMusicLyricsShortInfo;
}

interface AppleMusicArtistShortInfo {
  name: string; // artist name
  url: string; // URL to the artist
}

interface AppleMusicLyricsShortInfo {
  text: string; // lyrics text
}

interface AppleMusicAudioInfo {
  name: string; // song name
  url: string; // URL to the song
  datePublished: string; // date published
  description: string; // AM Marketing description
  duration: string; // ISO 8601 duration format.
  image: string; // URL to the song image
  byArtist: AppleMusicArtistShortInfo[];
  album?: {
    image: string; // URL to the album image
    name: string; // album name
    url: string; // URL to the album
    byArtist: AppleMusicArtistShortInfo[]; // album artist
  };
  audio?: {
    name: string; // song name
    contentUrl: string; // URL to the song preview (m4a)
    description: string; // AM Marketing description
    duration: string; // ISO 8601 duration format.
    uploadDate: string; // date published
    thumbnailUrl: string; // URL to the song thumbnail
  },
  genre?: string[]; // genre of the song
}

interface AppleMusicVideoInfo {
  name: string; // video name, might be the same as the song name
  contentUrl: string; // URL to the video - some kind of preview 
  description: string; // AM Marketing description
  duration: string; // ISO 8601 duration format.
  embedUrl: string; // URL to the video - some kind of preview
  thumbnailUrl: string; // URL to the video thumbnail
}

export class AppleMusicService {
  // Exported functions
  async getSongBySearchQuery(query: string): Promise<SyncFMSong> {
    try {
      const url = "https://music.apple.com/us/search?term=" + encodeURIComponent(query);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const embeddedSongInfo = html.split(`<script type="application/json" id="serialized-server-data">`)[1]?.split(`</script>`)[0];
      const trimmedSongInfo = embeddedSongInfo?.trim();
      if (trimmedSongInfo) {
        const jsonData = JSON.parse(trimmedSongInfo);

        const firstSong = jsonData[0]?.data?.sections[0].items?.find((item: any) => item.itemKind === "songs");

        if (!firstSong) {
          throw new Error('Could not find song ID in search result');
        }

        const songId = firstSong?.contentDescriptor?.identifiers?.storeAdamId || firstSong?.contentDescriptor?.identifiers?.storeAdamID;
        if (!songId) {
          throw new Error('Could not find song ID in search result');
        }
        return await this.getSongFromAppleMusicId(songId.toString());
      } else {
        throw new Error('Could not find song data in HTML');
      }
    } catch (error) {
      console.error('Error fetching or parsing song data:', error);
      throw error;
    }
  }

  async getSongDataFromUrl(url: string): Promise<AppleMusicSong> {
    console.log("Fetching Apple Music song data from URL:", url);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      //console.log(html);

      const embeddedSongInfo = html.split(`<script id=schema:song type="application/ld+json">`)[1]?.split(`</script>`)[0];
      const trimmedSongInfo = embeddedSongInfo?.trim();
      if (trimmedSongInfo) {
        const jsonData = JSON.parse(trimmedSongInfo);
        return jsonData;
      } else {
        throw new Error('Could not find song data in HTML');
      }
    } catch (error) {
      console.error('Error fetching or parsing song data:', error);
      throw error;
    }
  }

  async getPlaylistFromUrl(url: string): Promise<any> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      //console.log(html);

      const embeddedSongInfo = html.split(`<script type="application/json" id="serialized-server-data">`)[1]?.split(`</script>`)[0];
      const trimmedSongInfo = embeddedSongInfo?.trim();
      if (trimmedSongInfo) {
        const jsonData = JSON.parse(trimmedSongInfo);
        return jsonData;
      } else {
        throw new Error('Could not find playlist data in HTML');
      }
    } catch (error) {
      console.error('Error fetching or parsing playlist data:', error);
      throw error;
    }
  }

  getSongFromAppleMusicId = async (id: string): Promise<SyncFMSong> => {
    const url = this.createAppleMusicURL(id, "song");
    const rawSongData: AppleMusicSong = await this.getSongDataFromUrl(url);

    const externalIds: SyncFMExternalIdMap = { AppleMusic: id };

    const syncFmSong: SyncFMSong = {
      syncId: generateSyncId(rawSongData.audio?.name || rawSongData.name, rawSongData.audio?.byArtist?.map(a => a.name) || [], parseISO8601Duration(rawSongData.audio?.duration || rawSongData.timeRequired)),
      title: rawSongData.audio?.name || rawSongData.name,
      description: rawSongData.audio?.description || rawSongData.description,
      artists: rawSongData.audio?.byArtist?.map(a => a.name) || [],
      album: rawSongData.audio?.album?.name,
      releaseDate: new Date(rawSongData.audio?.datePublished),
      duration: parseISO8601Duration(rawSongData.audio?.duration || rawSongData.timeRequired),
      imageUrl: rawSongData.audio?.album?.image || rawSongData.audio?.image || rawSongData.image,
      externalIds: externalIds,
      explicit: undefined, // Apple Music API (scraped) doesn't seem to provide explicit info directly
    };
    return syncFmSong;
  };

  getPlaylisFromAppleMusicId = async (id: string): Promise<any> => {
    const url = this.createAppleMusicURL(id, "playlist");
    return await this.getPlaylistFromUrl(url);
  };

  createAppleMusicURL = (id: string, type: "song" | "playlist" | "album" | "artist", country: string = "US"): string => {
    switch (type) {
      case "song":
        return `https://music.apple.com/${country}/song/${id}`;
      case "playlist":
        return `https://music.apple.com/${country}/playlist/${id}`;
      case "album":
        return `https://music.apple.com/${country}/album/${id}`;
      case "artist":
        return `https://music.apple.com/${country}/artist/${id}`;
      default:
        throw new Error("Invalid type");
    }
  }

  getAppleMusicIdFromURL(url: string): string {
    console.log("Extracting Apple Music ID from URL:", url);
    // https://music.apple.com/us/album/lo-fi-hip-hop-music-for-studying/1440831234
    const parsedUrl = new URL(url);

    if (!parsedUrl.hostname.includes('music.apple.com')) {
      return null;
    }

    // Match the last numeric segment in the pathname
    const match = parsedUrl.pathname.match(/\/(\d+)(?:\/?$|\?)/);
    if (match && match[1]) {
      return match[1];
    } else {

      const urlParts = url.split("/");
      if (urlParts.length < 5) {
        throw new Error("Invalid URL");
      }
      const id = urlParts[6];
      return id;
    }
  }
  getArtistFromAppleMusicId = async (id: string): Promise<SyncFMArtist> => {
    try {
      const response = await fetch(this.createAppleMusicURL(id, "artist"));
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      //console.log(html);

      const embeddedArtistInfo = html.split(`<script id=schema:music-group type="application/ld+json">`)[1]?.split(`</script>`)[0];
      const trimmedArtistInfo = embeddedArtistInfo?.trim();
      if (trimmedArtistInfo) {
        const jsonData = JSON.parse(trimmedArtistInfo);
        const tracks = jsonData.tracks?.map((track: any) => ({
            title: track.name,
            duration: parseISO8601Duration(track.duration),
            thumbnailUrl: track.audio.thumbnailUrl,
            uploadDate: track.audio.uploadDate,
            contentUrl: track.audio.contentUrl,
          })) || []
        const artist: SyncFMArtist = {
          syncId: generateSyncArtistId(jsonData.name),
          name: jsonData.name,
          imageUrl: jsonData.image,
          externalIds: {
            AppleMusic: id,
          },
          genre: jsonData.genre || [],
          tracks: tracks.slice(0, 5), // Limit to first 10 tracks for brevity
        }
        return artist;
      } else {
        throw new Error('Could not find artist data in HTML');
      }
    } catch (error) {
      console.error('Error fetching or parsing artist data:', error);
      throw error;
    }
  }

  async getArtistBySearchQuery(query: string): Promise<SyncFMArtist> {
    try {
      const url = "https://music.apple.com/us/search?term=" + encodeURIComponent(query);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const embeddedArtistInfo = html.split(`<script type="application/json" id="serialized-server-data">`)[1]?.split(`</script>`)[0];
      const trimmedArtistInfo = embeddedArtistInfo?.trim();
      if (trimmedArtistInfo) {
        const jsonData = JSON.parse(trimmedArtistInfo);

        const firstArtist = jsonData[0]?.data?.sections[0].items?.find((item: any) => item.itemKind === "artists");

        if (!firstArtist) {
          throw new Error('Could not find artist ID in search result');
        }

        const artistId = firstArtist?.contentDescriptor?.identifiers?.storeAdamId || firstArtist?.contentDescriptor?.identifiers?.storeAdamID;
        if (!artistId) {
          throw new Error('Could not find artist ID in search result');
        }
        return await this.getArtistFromAppleMusicId(artistId.toString());
      } else {
        throw new Error('Could not find artist data in HTML');
      }
    } catch (error) {
      console.error('Error fetching or parsing artist data:', error);
      throw error;
    }
  }

  getAlbumFromAppleMusicId = async (id: string): Promise<SyncFMAlbum> => {
    try {
      const response = await fetch(this.createAppleMusicURL(id, "album"));
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();

      const embeddedAlbumInfo = html.split(`<script id=schema:music-album type="application/ld+json">`)[1]?.split(`</script>`)[0];
      const trimmedAlbumInfo = embeddedAlbumInfo?.trim();
      if (trimmedAlbumInfo) {
        const jsonData = JSON.parse(trimmedAlbumInfo);

        const albumArtists = jsonData.byArtist?.map((artist: any) => artist.name) || [];

        const songs: SyncFMSong[] = (jsonData.tracks || []).map((track: any) => {
          const songDuration = parseISO8601Duration(track.duration);
          const appleMusicSongId = track.url?.split('/').pop(); // Assumes ID is the last part of the URL path

          const externalSongIds: SyncFMExternalIdMap = {};
          if (appleMusicSongId) {
            externalSongIds.AppleMusic = appleMusicSongId;
          }

          return {
            syncId: generateSyncId(track.name, albumArtists, songDuration),
            title: track.name,
            artists: albumArtists,
            album: jsonData.name,
            releaseDate: track.audio?.uploadDate || jsonData.datePublished,
            duration: songDuration,
            imageUrl: track.audio?.thumbnailUrl || jsonData.image,
            externalIds: externalSongIds,
            explicit: undefined,
            description: undefined,
          };
        });

        const albumTotalDuration = songs.reduce((sum, song) => sum + (song.duration || 0), 0);

        const syncFmAlbum: SyncFMAlbum = {
          syncId: generateSyncId(jsonData.name, albumArtists, albumTotalDuration),
          title: jsonData.name,
          description: jsonData.description,
          artists: albumArtists,
          releaseDate: jsonData.datePublished,
          imageUrl: jsonData.image,
          externalIds: { AppleMusic: id },
          songs: songs,
          totalTracks: jsonData.tracks?.length || 0,
          duration: albumTotalDuration > 0 ? albumTotalDuration : undefined,
          label: undefined,
          genres: jsonData.genre || [],
          explicit: undefined,
        };

        return syncFmAlbum;
      } else {
        throw new Error('Could not find album data in HTML');
      }
    } catch (error) {
      console.error('Error fetching or parsing album data:', error);
      throw error;
    }
  };

  async getAlbumBySearchQuery(query: string): Promise<SyncFMAlbum> {
    try {
      const url = "https://music.apple.com/us/search?term=" + encodeURIComponent(query);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const embeddedSearchData = html.split(`<script type="application/json" id="serialized-server-data">`)[1]?.split(`</script>`)[0];
      const trimmedSearchData = embeddedSearchData?.trim();
      if (trimmedSearchData) {
        const jsonData = JSON.parse(trimmedSearchData);

        let foundAlbumData: any;
        if (jsonData[0]?.data?.sections) {
          for (const section of jsonData[0].data.sections) {
            if (section.items) {
              foundAlbumData = section.items.find((item: any) => item.itemKind === "albums");
              if (foundAlbumData) break;
            }
          }
        }

        if (!foundAlbumData) {
          throw new Error('Could not find album in search result items');
        }

        const albumId = foundAlbumData?.contentDescriptor?.identifiers?.storeAdamId || foundAlbumData?.contentDescriptor?.identifiers?.storeAdamID;
        if (!albumId) {
          throw new Error('Could not find album ID in search result');
        }
        return await this.getAlbumFromAppleMusicId(albumId.toString());
      } else {
        throw new Error('Could not find album search data in HTML response');
      }
    } catch (error) {
      console.error('Error fetching or parsing album search data:', error);
      throw error;
    }
  }

  getAppleMusicInputType = function (url: string): "song" | "playlist" | "album" | "artist" | null {
    const urlParts = url.split("/");
    if (urlParts.length < 5) {
      return null;
    }
    const type = urlParts[4];
    if (type === "song") {
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
}

// Helper function to parse ISO 8601 duration format to seconds
function parseISO8601Duration(durationString: string | undefined): number | undefined {
  if (!durationString) return undefined;
  const match = durationString.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) {
    console.warn(`Could not parse ISO 8601 duration: ${durationString}`);
    return undefined;
  }
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseFloat(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

