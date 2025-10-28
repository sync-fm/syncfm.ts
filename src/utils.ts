import { createHash } from "crypto";
import { SyncFMAlbum, SyncFMSong } from "./types/syncfm";

const removeDiacritics = (s: string) =>
	s.normalize?.("NFKD").replace(/[\u0300-\u036f]/g, "") ?? s;

const collapseWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();

const normalizeForSearch = (title: string): string => {
	let t = String(title ?? "").trim();
	t = t.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, "");
	t = t.replace(/\s*\(?\s*(?:explicit|official(?:\s+(?:video|audio|music\s+video))?|video|audio|lyrics?|hd|4k|visualizer)\s*\)?/gi, " ");
	t = t.replace(/\[/g, "(").replace(/\]/g, ")");
	t = collapseWhitespace(t);
	return t;
};

const normalizeTitle = (title: string): string => {
	let t = String(title ?? "").toLowerCase();
	t = t.replace(/\s*(?:\(|\[).*?(?:\)|\])/g, " ");
	t = t.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, " ");
	t = t.replace(
		/\b(?:official(?:\svideo)?|video|audio|lyrics?|remaster(?:ed)?|live|remix|mix|edit|version|instrumental|karaoke|cover)\b/gi,
		" ",
	);
	t = t.split(/\s*[-—–|:]\s*/)[0];
	t = t.replace(/[^0-9a-z\s]/gi, " ");
	t = collapseWhitespace(removeDiacritics(t)).toLowerCase();

	if (!t) {
		t = collapseWhitespace(
			removeDiacritics(String(title ?? "").toLowerCase()),
		).replace(/[^0-9a-z\s]/gi, " ");
	}

	return t;
};

const normalizeArtists = (artists: string[] = []): string[] => {
	const normalizedArtists: string[] = [];

	artists.forEach((artistStr) => {
		if (!artistStr) return;
		let s = artistStr.replace(/\s*(?:\(|\[).*?(?:\)|\])/g, " ");
		const pieces = s.split(
			/[,&/\u00D7xX]|(?:\s+and\s+)|(?:\s+with\s+)|(?:\s+&\s+)/i,
		);
		pieces.forEach((p) => {
			let a = String(p).toLowerCase();
			a = a.replace(/\b(?:feat(?:uring)?|ft)\b[:.\s-]*.*$/i, " ");
			a = collapseWhitespace(removeDiacritics(a).replace(/[^0-9a-z\s]/gi, " "));
			if (a) normalizedArtists.push(a);
		});
	});

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
	let cleanTitle = normalizeForSearch(songInfo.title ?? "");

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
	let cleanTitle = normalizeForSearch(albumInfo.title ?? "");

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
	titleArtists.forEach((ta) => {
		if (!canonicalArtists.includes(ta)) {
			canonicalArtists.push(ta);
		}
	});

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
		const artistPart = parts[0].trim();
		allArtists.push(...splitArtists(artistPart));
	}

	return [...new Set(allArtists)];
};

export function parseDurationWithFudge(durationMs: number): number {
	return Math.floor((durationMs + 999) / 1000);
}
