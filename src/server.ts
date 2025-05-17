import dotenv from 'dotenv';

// Configure dotenv to load .env file from project root
// IMPORTANT: This must be at the very top, before any other imports that might use environment variables
const __dirname = new URL('.', import.meta.url).pathname;
dotenv.config({ path: `${__dirname}/../.env` });

import express, { Express, Request, Response } from "express";
import { getInputSongInfo, convertSong, createSongURL} from "./";
import { SyncFMSong } from "./types/syncfm";

const app: Express = express();
const port = process.env.PORT || 3000;

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

        // The input song URL is everything after the first '/'
        // req.url will be like '/https://music.apple.com/...'
        const inputSongUrl = req.originalUrl.slice(1); // Remove the leading '/' 

        if (!inputSongUrl) {
            res.status(400).json({ error: "Missing song URL in path." });
            return;
        }

        console.log(`[SyncFM-Redirect]: Received request to convert song from ${inputSongUrl} to ${desiredService}`);

        const songInfo: SyncFMSong = await getInputSongInfo(inputSongUrl);
        if (!songInfo) {
            res.status(404).json({ error: "Could not retrieve information for the input song." });
            return;
        }

        if (desiredService === "syncfm") {
            res.status(200).json(songInfo);
            return;
        }

        const convertedSong = await convertSong(songInfo, desiredService);
        if (!convertedSong) {
            res.status(404).json({ error: `Could not convert song to ${desiredService}.` });
            return;
        }

      

        // Get the URL for the converted song
        const convertedSongUrl = createSongURL(convertedSong, desiredService);
        if (!convertedSongUrl) {
            res.status(404).json({ error: `Could not create URL for the converted song on ${desiredService}.` });
            return;
        }
        console.log(`[SyncFM-Redirect]: Converted song to ${desiredService}:`, convertedSongUrl);
        
        res.redirect(convertedSongUrl);
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

