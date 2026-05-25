const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { spawn, execSync } = require('child_process');

// ─── FFmpeg Setup ─────────────────────────────────────────────────────────────
ffmpeg.setFfmpegPath(ffmpegStatic);

// ─── Demucs Setup ─────────────────────────────────────────────────────────────
function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      execSync(`${cmd} -c "import demucs"`, { stdio: 'pipe', timeout: 8000 });
      return cmd;
    } catch (_) {}
  }
  return null;
}

const PYTHON_CMD = (() => {
  const cmd = findPython();
  console.log(cmd
    ? `    Demucs : ready (${cmd})`
    : '    Demucs : not found — run: pip install demucs'
  );
  return cmd;
})();

// Searches Demucs output tree for no_vocals.wav (model name varies)
function findNoVocals(outDir, trackName) {
  try {
    for (const model of fs.readdirSync(outDir)) {
      const p = path.join(outDir, model, trackName, 'no_vocals.wav');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) {}
  return null;
}

// Parse a tqdm progress line: " 45%|████▌  | 9/20 [01:23<01:41, 12.3s/it]"
function parseTqdm(line) {
  const pctMatch = line.match(/(\d+)%\s*\|/);
  if (!pctMatch) return null;
  const pct = parseInt(pctMatch[1], 10);
  const etaMatch = line.match(/\[\d+:\d+<([\d:]+)/);
  const eta = etaMatch ? etaMatch[1] : null;
  const chunkMatch = line.match(/\|\s*(\d+)\/(\d+)\s*\[/);
  const chunk = chunkMatch
    ? { n: parseInt(chunkMatch[1], 10), total: parseInt(chunkMatch[2], 10) }
    : null;
  return { pct, eta, chunk };
}

// Kills a spawned proc and its entire child tree.
// On Windows, proc.kill() only kills the top-level process and orphans children,
// leaving file locks that make rmSync throw. taskkill /F /T kills the whole tree.
function killProc(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      proc.kill();
    }
  } catch (_) {
    try { proc.kill(); } catch (_2) {}
  }
}

function runDemucs(inputPath, onProgress, onProcSpawned) {
  return new Promise((resolve, reject) => {
    if (!PYTHON_CMD) {
      return reject(new Error('Demucs is not installed. Run: pip install demucs'));
    }

    const outDir  = path.join(os.tmpdir(), `demucs_${uuidv4()}`);
    const wavPath = path.join(outDir, 'input.wav');
    fs.mkdirSync(outDir, { recursive: true });

    // Pre-convert to 44100 Hz stereo WAV so torchaudio can load it via
    // soundfile (avoids the torchcodec dependency on Windows)
    ffmpeg(inputPath)
      .audioFrequency(44100)
      .audioChannels(2)
      .audioCodec('pcm_s16le')
      .output(wavPath)
      .on('end', () => spawnDemucs())
      .on('error', err => {
        console.error('[FFmpeg] pre-processing error:', err.message);
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
        reject(new Error('Audio pre-processing failed. Please check your file and try again.'));
      })
      .run();

    function spawnDemucs() {
      const trackName  = 'input';
      const runnerPath = path.join(__dirname, 'demucs_runner.py');
      const args = [runnerPath, '--two-stems', 'vocals', '--out', outDir, wavPath];

      const proc = spawn(PYTHON_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (onProcSpawned) onProcSpawned(proc);

      let output = '';
      const handleData = (d) => {
        const str = d.toString();
        output += str;
        if (onProgress) {
          // tqdm uses \r to overwrite lines in a TTY; split both to catch each update
          for (const line of str.split(/[\r\n]+/)) {
            const parsed = parseTqdm(line);
            if (parsed) onProgress(parsed);
          }
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);

      const timer = setTimeout(() => {
        killProc(proc);
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
        reject(new Error('Demucs timed out (20 min). Try a shorter file.'));
      }, 20 * 60 * 1000);

      proc.on('close', code => {
        clearTimeout(timer);
        console.log(`[Demucs] exit ${code}`);
        if (output) console.log(`[Demucs] full output:\n${output}`);
        if (code !== 0) {
          console.error(`[Demucs] failed (exit ${code}):\n${output}`);
          // rmSync may fail if the Python child is still holding file locks (Windows);
          // wrap so reject() is always called and the SSE event reaches the client.
          try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
          return reject(new Error(`Vocal separation failed (exit code ${code}). Please try again.`));
        }
        const noVocals = findNoVocals(outDir, trackName);
        if (!noVocals) {
          try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
          return reject(new Error('Demucs finished but output file was not found.'));
        }
        resolve({ noVocals, outDir });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        console.error('[Demucs] spawn error:', err.message);
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
        reject(new Error('Could not start vocal separation process. Please verify Demucs is installed.'));
      });
    }
  });
}

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists and clean up any leftover temp files
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} else {
  try {
    fs.readdirSync(UPLOADS_DIR).forEach(f => {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch (_) {}
    });
  } catch (_) {}
}

// ─── Multer Configuration ─────────────────────────────────────────────────────
const ALLOWED_MIMES = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/wav',  'audio/wave', 'audio/x-wav',
  'audio/aac',  'audio/x-aac', 'audio/mp4', 'audio/x-m4a', 'audio/m4a',
]);
const ALLOWED_EXTS = new Set(['.mp3', '.wav', '.aac', '.m4a']);

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `up_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.has(file.mimetype) || ALLOWED_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only MP3, WAV, and AAC files are supported.'));
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanup(...paths) {
  paths.forEach(p => {
    if (p && fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  });
}

function sendError(res, status, message) {
  if (!res.headersSent) res.status(status).json({ error: message });
}

// ─── UUID Validation ──────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validJobId(id) { return UUID_RE.test(id); }

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "media-src blob:",
      "connect-src 'self' https://cloudflareinsights.com",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── POST /api/pitch-shift ────────────────────────────────────────────────────
// Body (multipart): `audio` file + `semitones` (string, -12 to +12)
// Returns: processed MP3 as a downloadable attachment
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/pitch-shift', upload.single('audio'), (req, res) => {
  if (!req.file) return sendError(res, 400, 'No audio file provided.');

  const inputPath  = req.file.path;
  const outputPath = path.join(UPLOADS_DIR, `pitch_${uuidv4()}.mp3`);
  const semitones  = parseFloat(req.body.semitones) || 0;

  if (semitones < -12 || semitones > 12) {
    cleanup(inputPath);
    return sendError(res, 400, 'Semitones must be between -12 and +12.');
  }

  let command = ffmpeg(inputPath).audioCodec('libmp3lame').audioBitrate('192k');

  if (semitones !== 0) {
    const rateMultiplier = Math.pow(2, semitones / 12);
    const newRate        = Math.round(44100 * rateMultiplier);
    const tempo          = parseFloat((1 / rateMultiplier).toFixed(8));
    command = command.audioFilters(`asetrate=${newRate},atempo=${tempo}`);
  }

  const sign     = semitones > 0 ? '+' : '';
  const filename = semitones === 0 ? 'original.mp3' : `pitch_${sign}${semitones}st.mp3`;

  command
    .output(outputPath)
    .on('end', () => {
      res.download(outputPath, filename, () => cleanup(inputPath, outputPath));
    })
    .on('error', err => {
      console.error('[FFmpeg] pitch-shift error:', err.message);
      cleanup(inputPath, outputPath);
      sendError(res, 500, 'Pitch shift failed. Please check your file and try again.');
    })
    .run();
});

// ─── Karaoke Job Store ────────────────────────────────────────────────────────
// Each job: { inputPath, outputPath, demucsOutDir, events[], listeners Set, ip }
const karaokeJobs = new Map();

function cleanupJob(jobId) {
  const job = karaokeJobs.get(jobId);
  if (!job) return;
  if (job.inputPath)    try { fs.unlinkSync(job.inputPath);    } catch (_) {}
  if (job.outputPath)   try { fs.unlinkSync(job.outputPath);   } catch (_) {}
  if (job.demucsOutDir) try { fs.rmSync(job.demucsOutDir, { recursive: true, force: true }); } catch (_) {}
  job.listeners.forEach(res => { try { res.end(); } catch (_) {} });
  karaokeJobs.delete(jobId);
  // Release per-IP slot
  if (job.ip) {
    const n = (ipJobCounts.get(job.ip) || 1) - 1;
    if (n <= 0) ipJobCounts.delete(job.ip);
    else ipJobCounts.set(job.ip, n);
  }
}

function emitJobEvent(jobId, data) {
  const job = karaokeJobs.get(jobId);
  if (!job) return;
  job.events.push(data);
  job.listeners.forEach(res => {
    if (!res.writableEnded) {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    }
  });
  if (data.done || data.error) {
    setTimeout(() => {
      job.listeners.forEach(r => { try { r.end(); } catch (_) {} });
      job.listeners.clear();
    }, 500);
  }
}

// ─── Demucs Concurrency Queue ─────────────────────────────────────────────────
// Caps simultaneous Demucs processes so the server never runs out of CPU/RAM.
// Tune MAX_DEMUCS_JOBS via environment variable (default 2).
//   Small VPS (2 cores)  → MAX_DEMUCS_JOBS=1
//   Medium VPS (4 cores) → MAX_DEMUCS_JOBS=2  (default)
//   Large VPS / GPU      → MAX_DEMUCS_JOBS=4
const MAX_CONCURRENT_DEMUCS = Math.max(1, parseInt(process.env.MAX_DEMUCS_JOBS || '2', 10));
const MAX_QUEUE_SIZE        = Math.max(1, parseInt(process.env.MAX_QUEUE_SIZE   || '20', 10));
const MAX_JOBS_PER_IP       = Math.max(1, parseInt(process.env.MAX_JOBS_PER_IP  || '1',  10));

// ─── Per-IP Rate Limiting ─────────────────────────────────────────────────────
const ipJobCounts = new Map(); // ip -> number of active+queued jobs

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? xff.split(',')[0].trim() : null)
    || req.socket?.remoteAddress
    || 'unknown';
}

let activeDemucsJobs = 0;
const demucsQueue = []; // [{ run: fn, jobId }]

function drainDemucsQueue() {
  if (demucsQueue.length === 0) return;
  const next = demucsQueue.shift();
  // Update queue-position labels for everyone still waiting
  demucsQueue.forEach(({ jobId }, i) => {
    emitJobEvent(jobId, {
      pct:      1,
      phase:    `In queue — position ${i + 1} of ${demucsQueue.length}…`,
      queuePos:   i + 1,
      queueTotal: demucsQueue.length,
    });
  });
  next.run();
}

function enqueueDemucs(jobId, inputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeDemucsJobs++;
      console.log(`[Queue] Job ${jobId.slice(0, 8)} started — active: ${activeDemucsJobs}/${MAX_CONCURRENT_DEMUCS}`);
      emitJobEvent(jobId, { pct: 2, phase: 'Preparing audio…' });
      runDemucs(inputPath, onProgress, (proc) => {
        const job = karaokeJobs.get(jobId);
        if (job) job.proc = proc;
      })
        .then(resolve, reject)
        .finally(() => {
          activeDemucsJobs--;
          console.log(`[Queue] Job ${jobId.slice(0, 8)} finished — active: ${activeDemucsJobs}/${MAX_CONCURRENT_DEMUCS}, queued: ${demucsQueue.length}`);
          drainDemucsQueue();
        });
    };

    if (activeDemucsJobs < MAX_CONCURRENT_DEMUCS) {
      run();
    } else {
      demucsQueue.push({ run, jobId });
      const pos = demucsQueue.length;
      console.log(`[Queue] Job ${jobId.slice(0, 8)} queued at position ${pos} — active: ${activeDemucsJobs}/${MAX_CONCURRENT_DEMUCS}`);
      emitJobEvent(jobId, {
        pct:        1,
        phase:      `In queue — position ${pos}…`,
        queuePos:   pos,
        queueTotal: demucsQueue.length,
      });
    }
  });
}

async function processKaraokeJob(jobId) {
  const job = karaokeJobs.get(jobId);
  if (!job) return;

  try {
    const { noVocals, outDir } = await enqueueDemucs(jobId, job.inputPath, ({ pct, eta, chunk }) => {
      const mapped     = 5 + Math.round(pct * 0.85);
      const chunkLabel = chunk && chunk.total > 1 ? ` (${chunk.n}/${chunk.total})` : '';
      emitJobEvent(jobId, {
        pct:   mapped,
        phase: `Removing vocals…${chunkLabel}`,
        eta:   eta || null,
      });
    });

    job.demucsOutDir = outDir;
    emitJobEvent(jobId, { pct: 92, phase: 'Encoding MP3…' });

    const outputPath = path.join(UPLOADS_DIR, `karaoke_${uuidv4()}.mp3`);
    await new Promise((resolve, reject) => {
      ffmpeg(noVocals)
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(outputPath)
        .on('end', resolve)
        .on('error', err => {
          console.error('[FFmpeg] karaoke encoding error:', err.message);
          reject(new Error('MP3 encoding failed. Please try again.'));
        })
        .run();
    });

    job.outputPath = outputPath;
    emitJobEvent(jobId, { pct: 100, phase: 'Done!', done: true });

  } catch (err) {
    const currentJob = karaokeJobs.get(jobId);
    const wasCancelled = !!currentJob?.cancelled;
    const msg = wasCancelled
      ? 'Conversion cancelled.'
      : (err.message || 'Karaoke conversion failed.');
    emitJobEvent(jobId, { error: msg, cancelled: wasCancelled });
    // Give SSE 1 s to deliver the event before cleaning up the job
    setTimeout(() => cleanupJob(jobId), 1000);
  }
}

// ─── POST /api/karaoke/start ──────────────────────────────────────────────────
// Accepts audio upload, starts processing immediately, returns { jobId }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/karaoke/start', upload.single('audio'), (req, res) => {
  if (!req.file) return sendError(res, 400, 'No audio file provided.');

  if (demucsQueue.length >= MAX_QUEUE_SIZE) {
    cleanup(req.file.path);
    return sendError(res, 503, 'Server queue is full. Please try again later.');
  }

  const clientIp = getClientIp(req);
  if ((ipJobCounts.get(clientIp) || 0) >= MAX_JOBS_PER_IP) {
    cleanup(req.file.path);
    return sendError(res, 429, `Too many active jobs from your IP. Please wait for your current job(s) to finish (limit: ${MAX_JOBS_PER_IP}).`);
  }
  ipJobCounts.set(clientIp, (ipJobCounts.get(clientIp) || 0) + 1);

  const jobId = uuidv4();
  karaokeJobs.set(jobId, {
    inputPath:    req.file.path,
    outputPath:   null,
    demucsOutDir: null,
    events:       [],
    listeners:    new Set(),
    proc:         null,
    cancelled:    false,
    ip:           clientIp,
  });

  // Auto-expire job after 30 minutes in case client never downloads
  setTimeout(() => cleanupJob(jobId), 30 * 60 * 1000);

  res.json({ jobId });

  // Process in background — don't await so response is sent immediately
  processKaraokeJob(jobId).catch(() => {});
});

// ─── GET /api/karaoke/events/:jobId ──────────────────────────────────────────
// Server-Sent Events stream: emits progress events until done/error
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/karaoke/events/:jobId', (req, res) => {
  if (!validJobId(req.params.jobId)) return res.status(400).json({ error: 'Invalid job ID.' });
  const job = karaokeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Replay events already emitted (handles race between /start and /events)
  job.events.forEach(evt => {
    try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch (_) {}
  });

  const last = job.events[job.events.length - 1];
  if (last && (last.done || last.error)) { res.end(); return; }

  job.listeners.add(res);

  // Keep connection alive through proxies
  const heartbeat = setInterval(() => {
    if (res.writableEnded) { clearInterval(heartbeat); return; }
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    job.listeners.delete(res);
  });
});

// ─── GET /api/karaoke/download/:jobId ────────────────────────────────────────
// Returns the processed MP3 once the job is complete
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/karaoke/download/:jobId', (req, res) => {
  if (!validJobId(req.params.jobId)) return res.status(400).json({ error: 'Invalid job ID.' });
  const job = karaokeJobs.get(req.params.jobId);
  if (!job || !job.outputPath) {
    return res.status(404).json({ error: 'Result not ready or job not found.' });
  }

  res.download(job.outputPath, 'karaoke.mp3', () => {
    cleanupJob(req.params.jobId);
  });
});

// ─── DELETE /api/karaoke/cancel/:jobId ───────────────────────────────────────
// Cancels a queued or running karaoke job
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/api/karaoke/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!validJobId(jobId)) return res.status(400).json({ error: 'Invalid job ID.' });
  const job = karaokeJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  job.cancelled = true;

  // If still waiting in queue, remove it and notify remaining jobs of new positions
  const qIdx = demucsQueue.findIndex(q => q.jobId === jobId);
  if (qIdx !== -1) {
    demucsQueue.splice(qIdx, 1);
    demucsQueue.forEach(({ jobId: qjId }, i) => {
      emitJobEvent(qjId, {
        pct:        1,
        phase:      `In queue — position ${i + 1} of ${demucsQueue.length}…`,
        queuePos:   i + 1,
        queueTotal: demucsQueue.length,
      });
    });
    // No proc to kill — emit cancelled event directly
    emitJobEvent(jobId, { error: 'Conversion cancelled.', cancelled: true });
    setTimeout(() => cleanupJob(jobId), 1000);
  } else if (job.proc) {
    // Job is running — kill entire process tree so Python releases file locks
    killProc(job.proc);
  }

  console.log(`[Queue] Job ${jobId.slice(0, 8)} cancelled`);
  res.json({ ok: true });
});

// ─── GET /api/queue-status ───────────────────────────────────────────────────
// Returns a snapshot of the Demucs job queue for the UI status widget
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/queue-status', (req, res) => {
  res.json({
    active: activeDemucsJobs,
    queued: demucsQueue.length,
    limit:  MAX_CONCURRENT_DEMUCS,
  });
});

// ─── Error Handler (multer + others) ─────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'File too large. Maximum size is 100 MB.' });
  if (err?.message)
    return res.status(400).json({ error: err.message });
  next(err);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎵  AudioStudio is running!`);
  console.log(`    Open   : http://localhost:${PORT}`);
  console.log(`    FFmpeg : ${ffmpegStatic}`);
  console.log(`    Queue  : max ${MAX_CONCURRENT_DEMUCS} concurrent Demucs job(s)  (override: MAX_DEMUCS_JOBS=N)`);
  console.log(`    IP cap : max ${MAX_JOBS_PER_IP} active job(s) per IP         (override: MAX_JOBS_PER_IP=N)\n`);
});
