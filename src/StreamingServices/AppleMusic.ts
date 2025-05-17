import fs from 'fs';
import { SyncFMSong, SyncFMExternalIdMap } from '../types/syncfm';
import { generateSyncId } from '../utils';
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

// Exported functions
export async function getSongBySearchQuery(query: string): Promise<SyncFMSong> {
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
      fs.writeFileSync("AppleMusicSearchResultRawSearch.json", JSON.stringify(jsonData, null, 2));

    const firstSong = jsonData[0]?.data?.sections[0].items?.find((item: any) => item.itemKind === "songs");

    if (!firstSong) {
      throw new Error('Could not find song ID in search result');
    }

    const songId = firstSong?.contentDescriptor?.identifiers?.storeAdamId || firstSong?.contentDescriptor?.identifiers?.storeAdamID;
    if (!songId) {
      throw new Error('Could not find song ID in search result');
    }
    return await getSongFromAppleMusicId(songId.toString());
    } else {
      throw new Error('Could not find song data in HTML');
    }
  } catch (error) {
    console.error('Error fetching or parsing song data:', error);
    throw error;
  }
}

export async function getSongDataFromUrl(url: string): Promise<AppleMusicSong> {
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
      fs.writeFileSync("AppleMusicSongResult.json", JSON.stringify(jsonData, null, 2));
      return jsonData;
    } else {
      throw new Error('Could not find song data in HTML');
    }
  } catch (error) {
    console.error('Error fetching or parsing song data:', error);
    throw error;
  }
}

export async function getPlaylistFromUrl(url: string): Promise<any> {
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

export const getSongFromAppleMusicId = async (id: string): Promise<SyncFMSong> => {
  const url = createAppleMusicURL(id, "song");
  const rawSongData: AppleMusicSong = await getSongDataFromUrl(url);

  const externalIds: SyncFMExternalIdMap = { AppleMusic: id };

  const syncFmSong: SyncFMSong = {
    syncId: generateSyncId(rawSongData.audio?.name || rawSongData.name, rawSongData.audio?.byArtist?.map(a => a.name) || [], parseISO8601Duration(rawSongData.audio?.duration || rawSongData.timeRequired)),
    title: rawSongData.audio?.name || rawSongData.name,
    description: rawSongData.audio?.description || rawSongData.description,
    artists: rawSongData.audio?.byArtist?.map(a => a.name) || [],
    album: rawSongData.audio?.album?.name,
    releaseDate: rawSongData.audio?.datePublished, // Assuming YYYY-MM-DD or similar string format
    duration: parseISO8601Duration(rawSongData.audio?.duration || rawSongData.timeRequired),
    imageUrl: rawSongData.audio?.album?.image || rawSongData.audio?.image || rawSongData.image,
    externalIds: externalIds,
    explicit: undefined, // Apple Music API (scraped) doesn't seem to provide explicit info directly
  };
  return syncFmSong;
};

export const getPlaylisFromAppleMusicId = async (id: string): Promise<any> => {
    const url = createAppleMusicURL(id, "playlist");
    return await getPlaylistFromUrl(url);
};

export const createAppleMusicURL = (id: string, type: "song" | "playlist" | "album" | "artist", country: string = "US"): string => {
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

export function getAppleMusicIdFromURL(url: string): string {
    // https://music.apple.com/us/album/lo-fi-hip-hop-music-for-studying/1440831234
    const urlParts = url.split("/");
    if (urlParts.length < 5) {
        throw new Error("Invalid URL");
    }
    const id = urlParts[6];
    return id;
}