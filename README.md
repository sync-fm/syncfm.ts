# SyncFM.ts

> Very early WIP. Expect nothing to work.
> this also includes an early version of SyncFM Redirect (Which is a simple webserver to redirect music between services)

### Why?
> i was tired of having to open different music services when i sent & recieved songs & stuff from friends that used other services than me

### What can it do now?
- Get & store song, album, and artist info from multiple streaming services.
- Convert albums, songs, and artists between different streaming services.

### Known issues / bugs:
- YouTube Music is still very 50/50, We've implemented some stuff here and there to try to improve it, but with Google not giving the public access to the YTM api, the things we can do is quite limited. - We're not opposed to pay for API access and include auth methods in syncfm.ts, but that doesnt even seem to be a possibility as of now. - We're looking into other paths we can take to improve the YTM reliability.

### What will it be able to do?
- Get playlist info etc from all services
- Read playlist info, and later be able to convert playlists between services
- Export & Import user data (likes, playlists, etc) between services

### What is being worked on now?
- Improving YTM reliability
- Fetching audio previews, and animated videos from Apple Music (thank oxmc for this)
- Attempt to fetch lyrics data, and other stats about the songs / albums etc (More detailed info ie tags, better defined genres, BPM, key, etc)

### FAQ
**Where is the pretty web app??**
> https://syncfm.dev
