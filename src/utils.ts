import { createHash } from "crypto";
import { SyncFMAlbum, SyncFMSong } from "./types/syncfm";

const removeDiacritics = (s: string) =>
	s.normalize?.("NFKD").replace(/[\u0300-\u036f]/g, "") ?? s;

const collapseWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();

/** Normalize title string to canonical form used for hashing/matching */
const normalizeTitle = (title: string): string => {
	let t = String(title ?? "").toLowerCase();

	// Remove parenthetical/bracketed fragments: (..), [...]
	t = t.replace(/\s*[\(\[][^)\]]*[\)\]]/g, " ");

	// Remove 'feat' and anything following
	t = t.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, " ");

	// Remove common suffix/noise (official video, lyrics, audio, live, remaster, mix, edit, version, instrumental, cover, karaoke)
	t = t.replace(
		/\b(?:official(?:\svideo)?|video|audio|lyrics?|remaster(?:ed)?|live|mix|edit|version|instrumental|karaoke|cover)\b/gi,
		" ",
	);

	// Keep left-most portion before separators like -, —, |, :
	t = t.split(/\s*[-—–|:]\s*/)[0];

	// Remove punctuation
	t = t.replace(/[^0-9a-z\s]/gi, " ");

	// Remove diacritics and collapse whitespace
	t = collapseWhitespace(removeDiacritics(t)).toLowerCase();

	if (!t) {
		// Fallback to a compacted version of original
		t = collapseWhitespace(
			removeDiacritics(String(title ?? "").toLowerCase()),
		).replace(/[^0-9a-z\s]/gi, " ");
	}

	return t;
};

/** Normalize artists array into deduped, cleaned list in original order */
const normalizeArtists = (artists: string[] = []): string[] => {
	const normalizedArtists: string[] = [];

	artists.forEach((artistStr) => {
		if (!artistStr) return;
		// Remove parenthetical/bracket content in artist names and common trailing descriptors
		let s = artistStr.replace(/\s*[\(\[][^)\]]*[\)\]]/g, " ");
		const pieces = s.split(
			/[,;&\/\u00D7xX]|(?:\s+and\s+)|(?:\s+with\s+)|(?:\s+&\s+)/i,
		);
		pieces.forEach((p) => {
			let a = String(p).toLowerCase();
			// strip feat from artist strings too
			a = a.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, " ");
			// remove punctuation, diacritics, collapse whitespace
			a = collapseWhitespace(removeDiacritics(a).replace(/[^0-9a-z\s]/gi, " "));
			if (a) normalizedArtists.push(a);
		});
	});

	// Deduplicate while preserving first-occurrence order
	const seen = new Set<string>();
	const deduped: string[] = [];
	normalizedArtists.forEach((a) => {
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
	let cleanTitle = songInfo.title ?? "";
	cleanTitle = cleanTitle
		.replace(/\s*\([^)]*\)/g, "")
		.replace(/\s*\[[^]]*\]/g, "")
		.trim();

	// Normalize artists by ensuring all featured artists are included
	let normalizedArtists: string[] = [];
	songInfo.artists.forEach((artistStr) => {
		const splitArtists = artistStr
			.split(/[,&]\s*|\s* and \s*/i)
			.map((a) => a.trim())
			.filter((a) => a.length > 0);
		normalizedArtists.push(...splitArtists);
	});
	let allArtists = normalizedArtists;
	if (songInfo.title && songInfo.title.toLowerCase().includes("feat")) {
		const featuredArtistsRegex = /\(feat\.? (.*?)\)/i;
		const match = songInfo.title.match(featuredArtistsRegex);
		if (match && match[1]) {
			const featuredArtists = match[1]
				.split(/[,&]\s*|\s* and \s*/i)
				.map((artist) => artist.trim());
			featuredArtists.forEach((artist) => {
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
		canonicalArtists,
	};
};

export const normalizeAlbumData = (albumInfo: SyncFMAlbum) => {
	// Normalize the title by removing common parenthetical and bracketed additions
	let cleanTitle = albumInfo.title ?? "";
	cleanTitle = cleanTitle
		.replace(/\s*\([^)]*\)/g, "")
		.replace(/\s*\[[^]]*\]/g, "");
	cleanTitle = cleanTitle.replace(/-?\s*(single|ep|album)$/i, "").trim();

	// Normalize artists by ensuring all featured artists are included
	let normalizedArtists: string[] = [];
	albumInfo.artists.forEach((artistStr) => {
		const splitArtists = artistStr
			.split(/[,&]\s*|\s* and \s*/i)
			.map((a) => a.trim())
			.filter((a) => a.length > 0);
		normalizedArtists.push(...splitArtists);
	});
	let allArtists = normalizedArtists;
	if (albumInfo.title && albumInfo.title.toLowerCase().includes("feat")) {
		const featuredArtistsRegex = /\(feat\.? (.*?)\)/i;
		const match = albumInfo.title.match(featuredArtistsRegex);
		if (match && match[1]) {
			const featuredArtists = match[1]
				.split(/[,&]\s*|\s* and \s*/i)
				.map((artist) => artist.trim());
			featuredArtists.forEach((artist) => {
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
		canonicalArtists,
	};
};

function bucketDuration(seconds: number): number {
	const bucketSize = 5;
	return Math.round(seconds / bucketSize) * bucketSize;
}

const sortAlphaNum = (a: string, b: string) =>
	a.localeCompare(b, "en", { numeric: true });

export const generateSyncId = (
	title: string,
	artists: string[],
	duration: number,
): string => {
	const canonicalTitle = normalizeTitle(title);
	const canonicalArtists = normalizeArtists(artists);

	// Extract more artists from title if possible
	const titleArtists = extractAllArtistsFromTitle(title);
	titleArtists.forEach((ta) => {
		if (!canonicalArtists.includes(ta)) {
			canonicalArtists.push(ta);
		}
	});

	// Sort artists alphanumerically to avoid ordering issues
	const sorted = canonicalArtists.sort(sortAlphaNum);
	// Choose canonical artist: prefer first deduped (preserve provider primary artist), else empty string
	const firstArtist = sorted.length > 0 ? sorted[0] : "";

	// Duration bucketing: use 5s buckets to tolerate small per-provider differences (e.g. 186 vs 187).
	const roundedDuration = bucketDuration(duration);

	const stringToHash =
		`${canonicalTitle}_${firstArtist}_${roundedDuration}`.toLowerCase();

	const hash = createHash("sha256").update(stringToHash).digest("hex");
	return hash;
};

export const generateSyncArtistId = (name: string): string => {
	const processedName = normalizeTitle(name)
		.split(/\s*[-—–|:]\s*/)[0]
		.trim();
	const hash = createHash("sha256").update(processedName).digest("hex");
	return hash;
};

export function parseAMAstring(input: string): Set<string> {
	const delimiters = /\s*(?:,|&|and|feat\.?|ft\.?|featuring)\s*/i;
	if (!input || typeof input !== "string") return new Set();
	const rawParts = input
		.split(delimiters)
		.map((part) => part.trim())
		.filter((p) => p.length > 0);
	return new Set(rawParts);
}

/**
 * A utility function to split a string of artists by common separators.
 * Handles separators like '&', ',', 'vs', and 'and'.
 * @param artistString The string containing one or more artist names.
 * @returns An array of cleaned artist names.
 */
export const splitArtists = (artistString: string): string[] => {
	if (!artistString) return [];
	// Regex to split by " & ", " vs ", " vs. ", ", ", " and "
	const artistSeparators = /\s+(?:&|vs\.?|and|,)\s+/i;
	return artistString
		.split(artistSeparators)
		.map((name) => name.trim())
		.filter(Boolean); // Filter out any empty strings
};

/**
 * Aggressively parses a music video title to extract all associated artists,
 * including primary artists, features, and remixers, into a single array.
 *
 * @param {string} title The raw music video title string.
 * @returns {string[]} A de-duplicated array of all identified artist names.
 */
export const extractAllArtistsFromTitle = (title: string): string[] => {
	if (!title) return [];

	const allArtists: string[] = [];
	let workingTitle = title;

	// Extract artists from content within {} ()
	const bracketRegex = /[\[\(](.*?)[\]\)]/g;
	const bracketMatches = workingTitle.match(bracketRegex) || [];

	const featRegex = /^(?:feat|ft|featuring)\.?\s+/i;
	const remixRegex = /\s+(?:remix|bootleg|edit|mix)$/i;
	// A general regex to exclude obvious non-artist metadata
	const metaRegex = /official|video|audio|lyric|visualizer|4k|hd|explicit/i;

	for (const match of bracketMatches) {
		const innerContent = match.substring(1, match.length - 1).trim();

		if (featRegex.test(innerContent)) {
			const featured = innerContent.replace(featRegex, "").trim();
			allArtists.push(...splitArtists(featured));
		} else if (remixRegex.test(innerContent)) {
			const remixer = innerContent.replace(remixRegex, "").trim();
			allArtists.push(...splitArtists(remixer));
		} else if (!metaRegex.test(innerContent)) {
			// If it's not metadata, assume it's a collaborator/artist
			allArtists.push(...splitArtists(innerContent));
		}

		// Clean the match from the title for the next step
		workingTitle = workingTitle.replace(match, "");
	}

	// Step 2: Parse the primary artist(s) from the cleaned string
	const mainSeparatorRegex = /\s+[-–|:]\s+/;
	const parts = workingTitle.split(mainSeparatorRegex);

	if (parts.length > 1) {
		const artistPart = parts[0].trim();
		allArtists.push(...splitArtists(artistPart));
	}

	//  Return a de-duplicated list of artists
	return [...new Set(allArtists)];
};

// Attempt to convert durations in ms to seconds, with fudge
export function parseDurationWithFudge(durationMs: number): number {
	return Math.floor((durationMs + 999) / 1000);
}
