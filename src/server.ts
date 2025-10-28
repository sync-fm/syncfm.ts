import express, { Express, Request, Response } from "express";
import { SyncFM, SyncFMSong } from "./";

const app: Express = express();
const port = process.env.PORT || 3000;

const syncfm = new SyncFM({
    SpotifyClientId: process.env.SPOTIFY_CLIENT_ID,
    SpotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    SupabaseUrl: process.env.SUPABASE_URL,
    SupabaseKey: process.env.SUPABASE_KEY,
});


// Middleware to parse JSON bodies
app.use(express.json());

app.get(/^\/(.*)/, async (req: Request, res: Response): Promise<void> => {
    if (!req.path.startsWith('/http')) {
        res.status(400).json({ error: "Invalid URL format. Please provide a valid URL." });
        return;
    }
    try {
        const hostnameParts = req.hostname.split('.');
        const subdomain = hostnameParts[0];
        let desiredService: "applemusic" | "spotify" | "ytmusic" | "syncfm" | undefined;

        switch (subdomain) {
            case 'applemusic':
            case "am":
            case 'a':
                desiredService = 'applemusic';
                break;
            case "s":
            case 'spotify':
                desiredService = 'spotify';
                break;
            case 'youtube':
            case "y":
            case "yt":
            case "ytm":
            case 'ytmusic':
                desiredService = 'ytmusic';
                break;
            case "syncfm":
                desiredService = 'syncfm';
                break;
            default:
                res.status(400).json({ error: "Invalid subdomain for desired streaming service. - the allowed ones are " + "applemusic (a, am), spotify (s), ytmusic (y, yt, ytm, youtube), syncfm" });
                return;
        }

        const inputUrl = req.originalUrl.slice(1); // Remove the leading '/' 

        if (!inputUrl) {
            res.status(400).json({ error: "Missing song URL in path." });
            return;
        }

        console.log(`[SyncFM-Redirect]: Received request to convert from ${inputUrl} to ${desiredService}`);

        switch (await syncfm.getInputTypeFromUrl(inputUrl)) {
            case "song":
                {
                    const songInfo: SyncFMSong = await syncfm.getInputSongInfo(inputUrl);
                    if (!songInfo) {
                        res.status(404).json({ error: "Could not retrieve information for the input song." });
                        return;
                    }

                    if (desiredService === "syncfm") {
                        res.status(200).json(songInfo);
                        return;
                    }

                    const convertedSong = await syncfm.convertSong(songInfo, desiredService);
                    if (!convertedSong) {
                        res.status(404).json({ error: `Could not convert song to ${desiredService}.` });
                        return;
                    }



                    // Get the URL for the converted song
                    const convertedSongUrl = syncfm.createSongURL(convertedSong, desiredService);
                    if (!convertedSongUrl) {
                        res.status(404).json({ error: `Could not create URL for the converted song on ${desiredService}.` });
                        return;
                    }
                    console.log(`[SyncFM-Redirect]: Converted song to ${desiredService}:`, convertedSongUrl);

                    res.json({ convertedSong, convertedSongUrl });
                    /*
                res.redirect(convertedSongUrl);
                */
                    break;
                }
            case "playlist":
                res.status(400).json({ error: "Playlist conversion is not supported." });
                return;
            case "album":
                {
                    const albumInfo = await syncfm.getInputAlbumInfo(inputUrl);
                    if (!albumInfo) {
                        res.status(404).json({ error: "Could not retrieve information for the input album." });
                        return;
                    }
                    if (desiredService === "syncfm") {
                        res.status(200).json(albumInfo);
                        return;
                    }
                    const convertedAlbum = await syncfm.convertAlbum(albumInfo, desiredService);
                    if (!convertedAlbum) {
                        res.status(404).json({ error: `Could not convert album to ${desiredService}.` });
                        return;
                    }
                    // Get the URL for the converted album
                    const convertedAlbumUrl = syncfm.createAlbumURL(convertedAlbum, desiredService);
                    if (!convertedAlbumUrl) {
                        res.status(404).json({ error: `Could not create URL for the converted album on ${desiredService}.` });
                        return;
                    }
                    console.log(`[SyncFM-Redirect]: Converted album to ${desiredService}:`, convertedAlbumUrl);
                    res.json({ convertedAlbum, convertedAlbumUrl });
                    /*
                    res.redirect(convertedAlbumUrl);
                    */
                }
                return;
            case "artist":
                {
                    const artistInfo = await syncfm.getInputArtistInfo(inputUrl);
                    if (!artistInfo) {
                        res.status(404).json({ error: "Could not retrieve information for the input artist." });
                        return;
                    }

                    if (desiredService === "syncfm") {
                        res.status(200).json(artistInfo);
                        return;
                    }

                    const convertedArtist = await syncfm.convertArtist(artistInfo, desiredService);
                    if (!convertedArtist) {
                        res.status(404).json({ error: `Could not convert artist to ${desiredService}.` });
                        return;
                    }
                    // Get the URL for the converted artist
                    const convertedArtistUrl = syncfm.createArtistURL(convertedArtist, desiredService);
                    if (!convertedArtistUrl) {
                        res.status(404).json({ error: `Could not create URL for the converted artist on ${desiredService}.` });
                    }
                    console.log(`[SyncFM-Redirect]: Converted artist to ${desiredService}:`, convertedArtistUrl);

                    res.json({ convertedArtist, convertedArtistUrl });
                    /*
                         res.redirect(convertedArtistUrl);
                         */
                    return;
                }
            default:
                res.status(400).json({ error: "Invalid input type. Supported types are song, playlist, album, and artist." });
                return;
        }
    } catch (error) {
        console.error("Error processing request:", error);
        if (!res.headersSent) { // Check if headers are already sent before trying to send a response
            if (error instanceof Error) {
                res.status(500).json({ error: "Internal server error", message: error.message });
            } else {
                res.status(500).json({ error: "Internal server error" });
            }
        }
    }
});

app.listen(port, () => {
    console.log(`[SyncFM-Redirect]: Server is running at port ${port}`);
});

