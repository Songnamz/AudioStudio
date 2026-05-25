<p align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="AudioStudio logo" />
</p>

<h1 align="center">AudioStudio</h1>

<p align="center">
  <strong>Key Changer &amp; Karaoke Maker</strong><br />
  A self-hosted web app for pitch-shifting audio and removing vocals with AI.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18" />
  <img src="https://img.shields.io/badge/python-3.8%2B-blue" alt="Python 3.8+" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## ✨ Features

### 🎵 Key Changer
- **Automatic key detection** — FFT-based chromagram with Krumhansl-Schmuckler algorithm detects the musical key of any uploaded track
- **±12 semitone range** — Shift the key up or down by up to a full octave
- **Instant preview** — Listen to the pitch-shifted result in-browser before downloading
- **Smart file naming** — Downloads are named with the target key (e.g. `song-C#.mp3`)

### 🎤 Karaoke Maker
- **AI-powered vocal removal** — Uses [Demucs](https://github.com/facebookresearch/demucs) (by Meta Research) for state-of-the-art source separation
- **Real-time progress** — Server-Sent Events stream live progress updates with ETA
- **Job queue system** — Configurable concurrency with per-IP rate limiting
- **Cancel anytime** — Cancel running or queued jobs instantly

### 🎨 UI / UX
- Modern glassmorphism design with animated background orbs
- Drag-and-drop file upload with waveform visualization
- Built-in audio player with seek bar and frequency visualizer
- Toast notifications for all actions
- Fully responsive layout

---

## 📋 Prerequisites

| Requirement | Purpose |
|---|---|
| **[Node.js](https://nodejs.org/)** ≥ 18 | Runs the Express server |
| **[Python](https://www.python.org/)** ≥ 3.8 | Required for Demucs vocal separation |
| **[Demucs](https://github.com/facebookresearch/demucs)** | AI vocal removal (`pip install demucs`) |
| **[soundfile](https://pypi.org/project/soundfile/)** | Audio I/O for Demucs on Windows (`pip install soundfile`) |

> **Note:** FFmpeg is bundled automatically via the `ffmpeg-static` npm package — no manual installation needed.

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Songnamz/AudioStudio.git
cd AudioStudio
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Install Python dependencies (for Karaoke feature)

```bash
pip install demucs soundfile
```

### 4. Start the server

```bash
npm start
```

The app will be available at **http://localhost:3000**.

```
🎵  AudioStudio is running!
    Open   : http://localhost:3000
    FFmpeg : /path/to/ffmpeg
    Queue  : max 2 concurrent Demucs job(s)
    IP cap : max 1 active job(s) per IP
```

---

## ⚙️ Configuration

All settings are configured via environment variables (no config file needed):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MAX_DEMUCS_JOBS` | `2` | Max concurrent Demucs processes |
| `MAX_QUEUE_SIZE` | `20` | Max jobs waiting in queue |
| `MAX_JOBS_PER_IP` | `1` | Max active jobs per client IP |

**Examples:**

```bash
# Low-resource server (2 CPU cores)
MAX_DEMUCS_JOBS=1 node server.js

# High-performance server with GPU
MAX_DEMUCS_JOBS=4 PORT=8080 node server.js

# Windows (PowerShell)
$env:MAX_DEMUCS_JOBS=1; node server.js
```

---

## 📂 Project Structure

```
AudioStudio/
├── server.js            # Express backend — API routes, FFmpeg processing, Demucs queue
├── demucs_runner.py     # Python wrapper that patches torchaudio for Windows compatibility
├── package.json         # Node.js dependencies and scripts
├── public/              # Frontend (served statically)
│   ├── index.html       # Main HTML page
│   ├── app.js           # Frontend application logic (key detection, UI, API calls)
│   ├── style.css        # Styles (glassmorphism, animations, responsive)
│   └── favicon.svg      # App icon
├── uploads/             # Temporary upload directory (auto-cleaned on startup)
├── LICENSE              # MIT License
└── .gitignore
```

---

## 🔌 API Reference

### Pitch Shift

**`POST /api/pitch-shift`**

Shifts the pitch of an audio file by the specified number of semitones.

| Parameter | Type | Description |
|---|---|---|
| `audio` | File | Audio file (MP3, WAV, AAC) — max 100 MB |
| `semitones` | Number | Semitone shift (-12 to +12) |

**Response:** MP3 file download

---

### Karaoke (Vocal Removal)

**`POST /api/karaoke/start`**

Uploads audio and starts background vocal removal. Returns a job ID.

```json
{ "jobId": "uuid-string" }
```

**`GET /api/karaoke/events/:jobId`**

Server-Sent Events stream with real-time progress:

```json
{ "pct": 45, "phase": "Removing vocals…", "eta": "2:30" }
{ "pct": 100, "phase": "Done!", "done": true }
```

**`GET /api/karaoke/download/:jobId`**

Downloads the processed karaoke MP3 once the job is complete.

**`DELETE /api/karaoke/cancel/:jobId`**

Cancels a queued or running job.

**`GET /api/queue-status`**

Returns the current queue state:

```json
{ "active": 1, "queued": 0, "limit": 2 }
```

---

## 🔒 Security

- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy`
- **File validation** — MIME type and extension checks, 100 MB size limit
- **UUID validation** — All job IDs are validated against UUID v4 format
- **Per-IP rate limiting** — Prevents abuse from single clients
- **Auto-cleanup** — Uploaded and processed files are deleted after download or after 30 minutes

---

## 🎵 Supported Formats

| Format | Extensions |
|---|---|
| MP3 | `.mp3` |
| WAV | `.wav` |
| AAC | `.aac`, `.m4a` |

Maximum file size: **100 MB**

---

## 🐛 Troubleshooting

### "Demucs : not found"
Demucs is not installed or not accessible from your Python environment:
```bash
pip install demucs soundfile
```

### Demucs fails on Windows
The bundled `demucs_runner.py` patches `torchaudio` to use `soundfile` instead of `torchcodec` (which isn't available on Windows). Make sure `soundfile` is installed:
```bash
pip install soundfile
```

### "File too large"
The maximum upload size is 100 MB. For longer tracks, consider trimming the audio first.

### Demucs timeout
Processing times out after 20 minutes. If your track is very long, try splitting it into shorter segments.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

**Copyright © 2026 Songnam Saraphai**
