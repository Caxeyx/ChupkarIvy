# 🎧 ChupkarIVY — Chip-Style Discord Music Bot

A modern, high-performance **Chip-Style Discord Music Bot** built with `discord.js` v14, `@discordjs/voice`, native C++ `sodium-native` / `@discordjs/opus` modules, and FFmpeg audio streaming.

---

## ✨ Features

- 🎶 **Chip-Style Interactive Dashboard**: Live player embed with interactive control buttons:
  - ⏯️ **Pause / Resume**
  - ⏭️ **Skip Track**
  - ⏹️ **Stop Playback & Clear Queue**
  - 🔀 **Shuffle Queue**
  - 🔂 **Loop Modes** (*Off ➔ Song ➔ Queue*)
  - 🔉 **Vol-** / 🔊 **Vol+**
  - 📜 **Queue Inspection**
- 🟢 **Spotify & YouTube Integration**:
  - Automatically resolves Spotify tracks, albums, and playlists via `spotify-url-info`.
  - HD audio extraction powered by `yt-dlp` and `ffmpeg`.
- 🔗 **Spotify Link Command**: `/link` opens an OAuth authentication flow to connect user Spotify accounts.
- ⚡ **Zero-Latency Audio Engine**: Direct OggOpus stream demuxing into `@discordjs/voice`.

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Configure Environment (`.env`)
```env
DISCORD_TOKEN=your_discord_bot_token
SPOTIFY_CLIENT_ID=8e8767817181457c84c05dd9b7e8bf18
```

### 3. Run Locally
```bash
node index.js
```

---

## 🐳 Docker Deployment

```bash
docker build -t chupkarivy .
docker run -d --restart always --name chupkarivy-bot --net=host --env-file .env chupkarivy
```

---

## 📜 Commands

| Command | Description |
| :--- | :--- |
| `/play <query or URL>` | Play music from YouTube or Spotify (track, album, playlist) |
| `/pause` / `/resume` | Pause or resume track |
| `/skip` | Skip current playing track |
| `/stop` | Stop playback and clear current queue |
| `/volume <1-100>` | Adjust player volume level |
| `/queue` | View track queue |
| `/nowplaying` | Display current track dashboard |
| `/join` / `/leave` | Voice channel control |
| `/link` / `/unlink` | Link Spotify account |
| `/help` | Show command overview |
