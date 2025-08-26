import { createHash } from "crypto";
import { SyncFMAlbum, SyncFMSong } from "./types/syncfm";

export const normalizeSongData = (songInfo: SyncFMSong) => {
    // 1. Normalize the title by removing common parenthetical additions
    let cleanTitle = songInfo.title;
    // Remove content in parentheses and brackets globally
    cleanTitle = cleanTitle.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^]]*\]/g, '').trim();

    // 2. Normalize artists by ensuring all featured artists are included
    let normalizedArtists: string[] = [];
    songInfo.artists.forEach(artistStr => {
      const splitArtists = artistStr.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
      normalizedArtists.push(...splitArtists);
    });
    let allArtists = normalizedArtists;
    if (songInfo.title.includes('feat.')) {
        const featuredArtistsRegex = /\(feat\. (.*?)\)/i;
        const match = songInfo.title.match(featuredArtistsRegex);
        if (match && match[1]) {
            const featuredArtists = match[1].split(/[,&]\s*|\s* and \s*/i).map(artist => artist.trim());
            featuredArtists.forEach(artist => {
                if (!allArtists.includes(artist)) {
                    allArtists.push(artist);
                }
            });
        }
    }
    allArtists = Array.from(new Set(allArtists));

    return {
        cleanTitle: cleanTitle,
        allArtists: allArtists
    };
};
export const normalizeAlbumData = (albumInfo: SyncFMAlbum) => {
    // 1. Normalize the title by removing common parenthetical and bracketed additions
    let cleanTitle = albumInfo.title;
    cleanTitle = cleanTitle.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^]]*\]/g, '');
    cleanTitle = cleanTitle.replace(/-?\s*(single|ep|album)$/i, '').trim();

    // 2. Normalize artists by ensuring all featured artists are included
    let normalizedArtists: string[] = [];
    albumInfo.artists.forEach(artistStr => {
      const splitArtists = artistStr.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
      normalizedArtists.push(...splitArtists);
    });
    let allArtists = normalizedArtists;
    if (albumInfo.title.includes('feat.')) {
        const featuredArtistsRegex = /\(feat\. (.*?)\)/i;
        const match = albumInfo.title.match(featuredArtistsRegex);
        if (match && match[1]) {
            const featuredArtists = match[1].split(/[,&]\s*|\s* and \s*/i).map(artist => artist.trim());
            featuredArtists.forEach(artist => {
                if (!allArtists.includes(artist)) {
                    allArtists.push(artist);
                }
            });
        }
    }
    allArtists = Array.from(new Set(allArtists));

    return {
        cleanTitle: cleanTitle,
        allArtists: allArtists
    };
};

export const generateSyncId = (title: string, artists: string[], duration: number): string => {

  // Process title: lowercase, remove content in parentheses/brackets, take first part if split by separators
  let processedTitle = title.toLowerCase();
  processedTitle = processedTitle.replace(/\s*\([^)]*\)/g, ''); // Remove content in parentheses
  processedTitle = processedTitle.replace(/\s*\[[^]]*\]/g, ''); // Remove content in brackets
  processedTitle = processedTitle.split(/\s*-\s*|\s*—\s*|\s*\|\s*/)[0].trim();

   let normalizedArtists: string[] = [];
    artists.forEach(artistStr => {
      const splitArtists = artistStr.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
      normalizedArtists.push(...splitArtists);
    });
  // Process artists: take first artist, lowercase
  const firstArtist = normalizedArtists.length > 0 ? normalizedArtists[0].toLowerCase().trim() : '';

  // Process duration: round to nearest 2 seconds to allow for minor discrepancies
  const roundedDuration = Math.round(duration / 2) * 2;

  const stringToHash = `${processedTitle}_${firstArtist}_${roundedDuration}`;
    const hash = createHash('sha256')
        .update(stringToHash)
        .digest('hex')
  return hash;
}

export const generateSyncArtistId = (name: string): string => {
    // Process name: lowercase, remove content in parentheses/brackets, take first part if split by separators
    let processedName = name.toLowerCase();
    processedName = processedName.replace(/\s*\([^)]*\)/g, ''); // Remove content in parentheses
    processedName = processedName.replace(/\s*\[[^]]*\]/g, ''); // Remove content in brackets
    processedName = processedName.split(/\s*-\s*|\s*—\s*|\s*\|\s*/)[0].trim();
    
    const hash = createHash('sha256')
        .update(processedName)
        .digest('hex')
    return hash;
    }