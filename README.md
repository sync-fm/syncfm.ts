# SyncFM.ts

> Very early WIP. Expect nothing to work.
> this also includes an early version of SyncFM Redirect (Which is a simple webserver to redirect music between services)

### Why?
> i was tired of having to open different music services when i sent & recieved songs & stuff from friends that used other services than me


### What can it do now?
- Get song data (by ids) from YouTube Music (Only music is supported atm.), Apple Music & Spotify
- Convert a song from one service to another
- Get album info, artist info, etc from all services
- Convert albums & artists between all services (YTM is a little 50/50)
### What will it be able to do?
- Get playlist info etc from all services
- Read playlist info, and later be able to convert playlists between services
- Export & Import user data (likes, playlists, etc) between services
- StreamingService Provier Registry to allow for community made converters between streaming services 
    (The pipeline would work something like your provider getting info in the SyncFMSong type, and is expected to output in the same type.)

### FAQ
**Where is the pretty web app??**
> In development, this is just our open-source library.
