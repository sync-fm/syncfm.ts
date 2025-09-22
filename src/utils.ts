import { createHash } from "crypto";
import { SyncFMAlbum, SyncFMSong } from "./types/syncfm";

const removeDiacritics = (s: string) =>
    s.normalize?.('NFKD').replace(/[\u0300-\u036f]/g, '') ?? s;

const collapseWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Normalize title string to canonical form used for hashing/matching */
const normalizeTitle = (title: string): string => {
    let t = String(title ?? '').toLowerCase();

    // Remove parenthetical/bracketed fragments: (..), [...]
    t = t.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ');

    // Remove 'feat' and anything following
    t = t.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, ' ');

    // Remove common suffix/noise (official video, lyrics, audio, live, remaster, mix, edit, version, instrumental, cover, karaoke)
    t = t.replace(
        /\b(?:official(?:\svideo)?|video|audio|lyrics?|remaster(?:ed)?|live|mix|edit|version|instrumental|karaoke|cover)\b/gi,
        ' '
    );

    // Keep left-most portion before separators like -, —, |, :
    t = t.split(/\s*[-—–|:]\s*/)[0];

    // Remove punctuation
    t = t.replace(/[^0-9a-z\s]/gi, ' ');

    // Remove diacritics and collapse whitespace
    t = collapseWhitespace(removeDiacritics(t)).toLowerCase();

    if (!t) {
        // Fallback to a compacted version of original
        t = collapseWhitespace(removeDiacritics(String(title ?? '').toLowerCase())).replace(/[^0-9a-z\s]/gi, ' ');
    }

    return t;
};

/** Normalize artists array into deduped, cleaned list in original order */
const normalizeArtists = (artists: string[] = []): string[] => {
    const normalizedArtists: string[] = [];

    artists.forEach((artistStr) => {
        if (!artistStr) return;
        // Remove parenthetical/bracket content in artist names and common trailing descriptors
        let s = artistStr.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ');
        const pieces = s.split(/[,;&\/\u00D7xX]|(?:\s+and\s+)|(?:\s+with\s+)|(?:\s+&\s+)/i);
        pieces.forEach((p) => {
            let a = String(p).toLowerCase();
            // strip feat from artist strings too
            a = a.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, ' ');
            // remove punctuation, diacritics, collapse whitespace
            a = collapseWhitespace(removeDiacritics(a).replace(/[^0-9a-z\s]/gi, ' '));
            if (a) normalizedArtists.push(a);
        });
    });

    // Deduplicate while preserving first-occurrence order
    const seen = new Set<string>();
    const deduped: string[] = [];
    normalizedArtists.forEach(a => {
        const t = a.trim();
        if (!t) return;
        if (!seen.has(t)) {
            seen.add(t);
            deduped.push(t);
        }
    });

    return deduped;
};

export const normalizeSongData = (songInfo: SyncFMSong) => {
    // Normalize the title by removing common parenthetical additions
    let cleanTitle = songInfo.title ?? '';
    cleanTitle = cleanTitle.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^]]*\]/g, '').trim();

    // Normalize artists by ensuring all featured artists are included
    let normalizedArtists: string[] = [];
    songInfo.artists.forEach(artistStr => {
        const splitArtists = artistStr.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
        normalizedArtists.push(...splitArtists);
    });
    let allArtists = normalizedArtists;
    if (songInfo.title && songInfo.title.toLowerCase().includes('feat')) {
        const featuredArtistsRegex = /\(feat\.? (.*?)\)/i;
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

    // Also return canonical normalized forms for downstream use
    const canonicalTitle = normalizeTitle(cleanTitle);
    const canonicalArtists = normalizeArtists(allArtists);

    return {
        cleanTitle,
        allArtists,
        canonicalTitle,
        canonicalArtists
    };
};

export const normalizeAlbumData = (albumInfo: SyncFMAlbum) => {
    // Normalize the title by removing common parenthetical and bracketed additions
    let cleanTitle = albumInfo.title ?? '';
    cleanTitle = cleanTitle.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^]]*\]/g, '');
    cleanTitle = cleanTitle.replace(/-?\s*(single|ep|album)$/i, '').trim();

    // Normalize artists by ensuring all featured artists are included
    let normalizedArtists: string[] = [];
    albumInfo.artists.forEach(artistStr => {
        const splitArtists = artistStr.split(/[,&]\s*|\s* and \s*/i).map(a => a.trim()).filter(a => a.length > 0);
        normalizedArtists.push(...splitArtists);
    });
    let allArtists = normalizedArtists;
    if (albumInfo.title && albumInfo.title.toLowerCase().includes('feat')) {
        const featuredArtistsRegex = /\(feat\.? (.*?)\)/i;
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

    const canonicalTitle = normalizeTitle(cleanTitle);
    const canonicalArtists = normalizeArtists(allArtists);

    return {
        cleanTitle,
        allArtists,
        canonicalTitle,
        canonicalArtists
    };
};

export const generateSyncId = (title: string, artists: string[], duration: number): string => {
    const canonicalTitle = normalizeTitle(title);
    const canonicalArtists = normalizeArtists(artists);

    // Choose canonical artist: prefer first deduped (preserve provider primary artist), else empty string
    const firstArtist = canonicalArtists.length > 0 ? canonicalArtists[0] : '';

    // Duration bucketing: use 5s buckets to tolerate small per-provider differences (e.g. 186 vs 187).
    const bucketSize = 5;
    const roundedDuration = Math.round(duration / bucketSize) * bucketSize;

    const stringToHash = `${canonicalTitle}_${firstArtist}_${roundedDuration}`;

    const hash = createHash('sha256')
        .update(stringToHash)
        .digest('hex');
    return hash;
};

export const generateSyncArtistId = (name: string): string => {
    const processedName = normalizeTitle(name).split(/\s*[-—–|:]\s*/)[0].trim();
    const hash = createHash('sha256')
        .update(processedName)
        .digest('hex');
    return hash;
};