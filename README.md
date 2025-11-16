# SyncFM.ts

A TypeScript library for working with music across multiple streaming services. Query songs, albums, and artists from Apple Music, Spotify, and YouTube Music using a unified interface, and convert between services automatically.

Purpose built for [SyncFM](https://syncfm.dev) so things might be "a little opinionated" - and it is still in its __very__ early stages. Bugs, errors, breaking changes & schrodinger's cat-like consistency are to be expected.

## Why?

i was tired of having to open different music services when i sent & recieved songs & stuff from friends that used other services than me

## What it does

- Parse music links from Apple Music, Spotify, and YouTube Music
- Fetch detailed song, album, and artist information from any supported service
- Convert music between services while preserving metadata
- Store conversion results and track conversion attempts
- Normalize music data across services (consistent schema for songs, albums, artists)
- Query music by ID or by search (title + artist matching) - the way we generate stable ids will most likely change in the future
- Fallback search when direct IDs aren't available
- Preserve external IDs across all services for later reference

## Installation

```bash
bun add syncfm.ts
```

or with npm/yarn:

```bash
npm install syncfm.ts
yarn add syncfm.ts
```

## Configuration

Initialize SyncFM with your API credentials:

```typescript
import { SyncFM } from 'syncfm.ts';

const syncfm = new SyncFM({
    SpotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    SpotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    SupabaseUrl: process.env.SUPABASE_URL,
    SupabaseKey: process.env.SUPABASE_KEY,
    YouTubeApiKey: process.env.YOUTUBE_API_KEY, // optional
    enableStreamingDebug: false, // optional, logs detailed streaming service interactions
});
```

### Required credentials

- **Spotify**: Client ID and Secret from the Spotify Developer Dashboard
- **Supabase**: URL and Key for database storage (used for caching conversions and generating shortcodes)

### Optional credentials

- **YouTube**: API Key for YouTube Music lookups (YTM should work just fine if not provided, this is used as a fallback if YTM api fails and we need to fallback to the official youtube data v3 api)

## Usage

### Identify what you're working with

```typescript
// Detect which service a URL belongs to
const service = syncfm.getStreamingServiceFromUrl('https://open.spotify.com/track/...');
// Returns: 'spotify' | 'applemusic' | 'ytmusic' | null

// Determine if a URL is a song, album, artist, or playlist
const type = await syncfm.getInputTypeFromUrl('https://music.apple.com/us/album/...');
// Returns: 'song' | 'album' | 'artist' | 'playlist'

// Get detailed info about a URL
const descriptor = syncfm.describeInputUrl('https://open.spotify.com/track/...');
// Returns: { service: 'spotify', descriptor: { type: 'song', id: '...', url: '...' } }
```

### Fetch music information

```typescript
// Get song details from a URL
const song = await syncfm.getInputSongInfo('https://open.spotify.com/track/3f186IpZHsxta8PyTPkz9I');
// Returns SyncFMSong with title, artists, album, duration, imageUrl, externalIds, etc.

// Get album information
const album = await syncfm.getInputAlbumInfo('https://music.apple.com/us/album/...');
// Returns SyncFMAlbum with tracks, artists, release date, and metadata

// Get artist information
const artist = await syncfm.getInputArtistInfo('https://open.spotify.com/artist/...');
// Returns SyncFMArtist with name, genre, image, and discography
```

### Convert between services

```typescript
// Convert a song to another service
const spotifySong = await syncfm.getInputSongInfo('https://open.spotify.com/track/...');
const appleMusicSong = await syncfm.convertSong(spotifySong, 'applemusic');

// Convert an album
const album = await syncfm.getInputAlbumInfo('https://music.apple.com/us/album/...');
const spotifyAlbum = await syncfm.convertAlbum(album, 'spotify');

// Convert an artist
const artist = await syncfm.getInputArtistInfo('https://open.spotify.com/artist/...');
const ytmusicArtist = await syncfm.convertArtist(artist, 'ytmusic');
```

Conversions work by matching on external IDs when available (stored in the database), or by falling back to search queries using normalized metadata (title, artist names).

### Create URLs from converted data

```typescript
const song = await syncfm.getInputSongInfo('https://open.spotify.com/track/...');
const appleSong = await syncfm.convertSong(song, 'applemusic');

// Generate a direct link to the converted song
const appleUrl = await syncfm.createSongURL(appleSong, 'applemusic');
// Returns: 'https://music.apple.com/us/song/...'

const ytmusicUrl = await syncfm.createSongURL(song, 'ytmusic');
```

### Work with the database

Conversion results are cached in Supabase, so repeated conversions are fast. You can also generate shortcodes for sharing:

```typescript
// Generate a shortcode for a song (for easy sharing)
const song = await syncfm.getInputSongInfo('https://open.spotify.com/track/...');
const shortcode = song.shortcode;
// Returns something like: 'abc123'

// Later, resolve the shortcode back to full data
const resolved = await syncfm.getInputInfoFromShortcode('abc123');
// Returns the full SyncFMSong with all metadata
```

## Data structure

### SyncFMSong

```typescript
{
    syncId: string;              // Unique hash of normalized song data (consistent across services)
    shortcode?: string;          // URL-safe shortcode for sharing
    title: string;               // Song title
    description?: string;        // Service-provided description (if available)
    artists: string[];           // Array of artist names
    album?: string;              // Album name
    releaseDate?: Date;          // When the song was released
    duration?: number;           // Duration in seconds
    imageUrl?: string;           // Album cover image URL
    animatedImageUrl?: string;   // Animated cover (Apple Music only)
    externalIds: {               // IDs on each service
        AppleMusic?: string;
        Spotify?: string;
        YouTube?: string;
    };
    explicit?: boolean;          // Whether the song is marked explicit
    conversionErrors?: Map;      // Track failed conversion attempts
    conversionWarnings?: Map;    // Track successful conversions with caveats (syncId mismatch)
}
```

### SyncFMAlbum

```typescript
{
    syncId: string;
    shortcode?: string;
    title: string;
    description?: string;
    artists: string[];
    releaseDate?: string;
    imageUrl?: string;
    externalIds: { /* ... */ };
    conversionErrors?: Map;
    conversionWarnings?: Map;
    songs: SyncFMSong[];         // Array of tracks in the album
    totalTracks?: number;
    duration?: number;           // Total duration in seconds
    label?: string;              // Record label
    genres?: string[];
    explicit?: boolean;
}
```

### SyncFMArtist

```typescript
{
    syncId: string;
    shortcode?: string;
    name: string;
    imageUrl?: string;
    externalIds: { /* ... */ };
    genre?: string[];
    albums?: SyncFMAlbum[];
    tracks?: SyncFMArtistTrack[];
    conversionErrors?: Map;
    conversionWarnings?: Map;
}
```

## Server mode

SyncFM includes an Express server for URL-based conversions:

```bash
npm run dev
```

The server accepts requests with music service URLs and converts them based on subdomain:

```
https://applemusic.example.com/https://open.spotify.com/track/...
https://spotify.example.com/https://music.apple.com/us/song/...
https://ytmusic.example.com/https://open.spotify.com/track/...
```

Subdomains include shortcuts:
- Apple Music: `applemusic`, `am`, `a`
- Spotify: `spotify`, `s`
- YouTube Music: `ytmusic`, `yt`, `y`, `ytm`, `youtube`
- SyncFM (returns normalized data): `syncfm`

## Known issues

### YouTube Music

YouTube Music support is limited because Google doesn't provide public API access. I'm well aware the way we use YTM's api is against TOS and very 50/50 with random errors / deauths, but i havent found a "perfect" soloution yet :/

### Playlists

Playlist conversion is not yet supported. Songs, albums, and artists only.

## Coming soon

- Playlist fetching and conversion
- More detailed metadata (tags, BPM, key, lyrics)
- User data import/export (likes, playlists)
- Additional streaming services

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun run test
```

Run the server in watch mode:

```bash
bun run dev
```

Build for production:

```bash
bun run build
```

## License

MIT
