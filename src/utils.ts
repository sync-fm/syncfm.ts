// biome-ignore lint/style/useNodejsImportProtocol: shh
import { createHash } from "crypto";
import type { SyncFMAlbum, SyncFMSong, SyncFMArtist } from "./types/syncfm";

function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0); // unsigned 32-bit
}

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toBase62(num: number): string {
	let s = "";
	let n = num;
	do {
		s = BASE62[n % 62] + s;
		n = Math.floor(n / 62);
	} while (n > 0);
	return s;
}
export const prefixMap: Record<"song" | "artist" | "album", string> = {
	song: "so",
	artist: "ar",
	album: "al",
} as const;
export const prefixMapReverse: Record<string, "song" | "artist" | "album"> = {
	so: "song",
	ar: "artist",
	al: "album",
};
export function createShortcode(id: string | number, type: "song" | "artist" | "album"): string {

	const prefix = prefixMap[type];
	const hash = fnv1a(`${type}:${id}`);
	const short = toBase62(hash).padStart(6, "0"); // ensures fixed length
	return `${prefix}${short}`;
}

export const withShortcode = <T extends SyncFMAlbum | SyncFMSong | SyncFMArtist>(ctx: T): T => {
	const type: "song" | "artist" | "album" = "totalTracks" in ctx
		? "album"
		: "albums" in ctx
			? "artist"
			: "song";
	const shortcode = createShortcode(ctx.syncId, type);
	return {
		...ctx,
		shortcode,
	};
}

const collapseWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();

const normalizeForSearch = (title: string): string => {
	let t = String(title ?? "").trim();
	// Remove feat/ft and everything after
	t = t.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, "");
	// Remove common metadata words in parentheses or standalone
	t = t.replace(/\s*\(?\s*(?:explicit|official(?:\s+(?:video|audio|music\s+video))?|video|audio|lyrics?|hd|4k|visualizer)\s*\)?/gi, " ");
	// Only remove album FORMAT descriptors (EP, LP, Single) - NOT musical variations like Remastered, Deluxe, Live, etc.
	// This handles: "Album - EP", "Album - LP", "Album - Single" but keeps "Album - Deluxe", "Album - Remastered"
	t = t.replace(/\s*[-—–|:]\s*(?:ep|lp|single)(?:\s|$)/gi, " ");
	// Normalize brackets
	t = t.replace(/\[/g, "(").replace(/\]/g, ")");
	t = collapseWhitespace(t);
	return t;
};

const normalizeTitle = (title: string): string => {
	let t = String(title ?? "").toLowerCase();
	// Remove bracketed/parenthetical content
	t = t.replace(/\s*(?:\(|\[).*?(?:\)|\])/g, " ");
	// Remove feat/ft and everything after
	t = t.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, " ");
	// Remove common metadata words
	t = t.replace(
		/\b(?:official(?:\svideo)?|video|audio|lyrics?|remaster(?:ed)?|live|remix|mix|edit|version|instrumental|karaoke|cover)\b/gi,
		" ",
	);
	// Split on dash/pipe/colon and take first part - this handles "Déjà Vu - EP" -> "Déjà Vu"
	t = t.split(/\s*[-—–|:]\s*/)[0];
	// Remove special characters but preserve Unicode letters (including those with diacritics)
	// This regex keeps: digits (0-9), letters (including accented), and spaces
	t = t.replace(/[^\p{L}\p{N}\s]/gu, " ");
	// Collapse multiple spaces
	t = collapseWhitespace(t);

	if (!t) {
		// Fallback: just clean up whitespace and basic special chars
		t = collapseWhitespace(String(title ?? "").toLowerCase())
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.trim();
	}

	return t;
};

const normalizeArtists = (artists: string[] = []): string[] => {
	const normalizedArtists: string[] = [];

	for (const artistStr of artists) {
		if (!artistStr) return;
		const s = artistStr.replace(/\s*(?:\(|\[).*?(?:\)|\])/g, " ");
		// Fixed: removed lowercase 'x' and uppercase 'X' from character class to prevent splitting names like "Lexy"
		// Only split on actual separators: comma, ampersand, slash, and multiplication symbol (\u00D7)
		const pieces = s.split(
			/[,&/\u00D7]|(?:\s+and\s+)|(?:\s+with\s+)|(?:\s+&\s+)/i,
		);

		for (const p of pieces) {
			let a = String(p).toLowerCase();
			a = a.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, " ");
			// Remove special characters but preserve Unicode letters (including diacritics)
			a = a.replace(/[^\p{L}\p{N}\s]/gu, " ");
			a = collapseWhitespace(a);
			if (a) normalizedArtists.push(a);
		}
	}

	const seen = new Set<string>();
	const deduped: string[] = [];

	for (const artist of normalizedArtists) {
		const t = artist.trim();
		if (!t) return;
		if (!seen.has(t)) {
			seen.add(t);
			deduped.push(t);
		}
	}

	return deduped;
};

export const normalizeSongData = (songInfo: SyncFMSong) => {
	const cleanTitle = normalizeForSearch(songInfo.title ?? "");

	const normalizedArtists: string[] = [];

	for (const artistStr of songInfo.artists) {
		const splitArtists = artistStr
			.split(/[,&]\s*|\s* and \s*/i)
			.map((a) => a.trim())
			.filter((a) => a.length > 0);
		normalizedArtists.push(...splitArtists);
	}

	let allArtists = normalizedArtists;
	if (songInfo.title?.toLowerCase().includes("feat")) {
		const featuredArtistsRegex = /\(feat\.? (.*?)\)/i;
		const match = songInfo.title.match(featuredArtistsRegex);
		if (match?.[1]) {
			const featuredArtists = match[1]
				.split(/[,&]\s*|\s* and \s*/i)
				.map((artist) => artist.trim());

			for (const artist of featuredArtists) {
				if (!allArtists.includes(artist)) {
					allArtists.push(artist);
				}
			}

		}
	}
	allArtists = Array.from(new Set(allArtists));

	const canonicalTitle = normalizeTitle(songInfo.title ?? "");
	const canonicalArtists = normalizeArtists(allArtists);

	return {
		cleanTitle,
		allArtists,
		canonicalTitle,
		canonicalArtists,
	};
};

export const normalizeAlbumData = (albumInfo: SyncFMAlbum) => {
	const cleanTitle = normalizeForSearch(albumInfo.title ?? "");

	const normalizedArtists: string[] = [];

	for (const artistStr of albumInfo.artists) {
		const splitArtists = artistStr
			.split(/[,&]\s*|\s* and \s*/i)
			.map((a) => a.trim())
			.filter((a) => a.length > 0);
		normalizedArtists.push(...splitArtists);
	}

	let allArtists = normalizedArtists;
	if (albumInfo.title?.toLowerCase().includes("feat")) {
		const featuredArtistsRegex = /\(feat\.? (.*?)\)/i;
		const match = albumInfo.title.match(featuredArtistsRegex);
		if (match?.[1]) {
			const featuredArtists = match[1]
				.split(/[,&]\s*|\s* and \s*/i)
				.map((artist) => artist.trim());

			for (const artist of featuredArtists) {
				if (!allArtists.includes(artist)) {
					allArtists.push(artist);
				}
			}
		}
	}
	allArtists = Array.from(new Set(allArtists));

	const canonicalTitle = normalizeTitle(albumInfo.title ?? "");
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

	const titleArtists = extractAllArtistsFromTitle(title);

	for (const artist of titleArtists) {
		if (!canonicalArtists.includes(artist)) {
			canonicalArtists.push(artist);
		}
	}

	const sorted = canonicalArtists.sort(sortAlphaNum);
	const firstArtist = sorted.length > 0 ? sorted[0] : "";
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

export const splitArtists = (artistString: string): string[] => {
	if (!artistString) return [];
	const artistSeparators = /\s+(?:&|vs\.?|and|,)\s+/i;
	return artistString
		.split(artistSeparators)
		.map((name) => name.trim())
		.filter(Boolean);
};

export const extractAllArtistsFromTitle = (title: string): string[] => {
	if (!title) return [];

	const allArtists: string[] = [];
	let workingTitle = title;

	const bracketRegex = /(?:\(|\[)(.*?)(?:\)|\])/g;
	const bracketMatches = workingTitle.match(bracketRegex) || [];

	const featRegex = /^(?:feat|ft|featuring)\.?\s+/i;
	const remixRegex = /\s+(?:remix|bootleg|edit|mix)$/i;
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
			allArtists.push(...splitArtists(innerContent));
		}

		workingTitle = workingTitle.replace(match, "");
	}

	const mainSeparatorRegex = /\s+[-–|:]\s+/;
	const parts = workingTitle.split(mainSeparatorRegex);

	if (parts.length > 1) {
		// Check if the part after the separator is metadata (EP, LP, Deluxe, etc.)
		// If so, don't extract it as an artist name
		const afterSeparator = parts[1].trim().toLowerCase();
		const isMetadata = /^(?:ep|lp|single|deluxe|remaster(?:ed)?|live|acoustic|instrumental|anniversary|edition|version|expanded|bonus|explicit)(?:\s|$)/i.test(afterSeparator);

		if (!isMetadata) {
			const artistPart = parts[0].trim();
			allArtists.push(...splitArtists(artistPart));
		}
	}

	return [...new Set(allArtists)];
};

export function parseDurationWithFudge(durationMs: number): number {
	return Math.floor((durationMs + 999) / 1000);
}
