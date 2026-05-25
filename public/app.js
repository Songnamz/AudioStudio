/* ═══════════════════════════════════════════════════════════════
   AudioStudio — Frontend Application Logic
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const INTERVAL_NAMES = {
  0:   'Original Key',
  1:   'Minor 2nd ↑', '-1':  'Minor 2nd ↓',
  2:   'Major 2nd ↑', '-2':  'Major 2nd ↓',
  3:   'Minor 3rd ↑', '-3':  'Minor 3rd ↓',
  4:   'Major 3rd ↑', '-4':  'Major 3rd ↓',
  5:   'Perfect 4th ↑','-5': 'Perfect 4th ↓',
  6:   'Tritone ↑',   '-6':  'Tritone ↓',
  7:   'Perfect 5th ↑','-7': 'Perfect 5th ↓',
  8:   'Minor 6th ↑', '-8':  'Minor 6th ↓',
  9:   'Major 6th ↑', '-9':  'Major 6th ↓',
  10:  'Minor 7th ↑', '-10': 'Minor 7th ↓',
  11:  'Major 7th ↑', '-11': 'Major 7th ↓',
  12:  'Octave ↑',    '-12': 'Octave ↓',
};

// Chromatic note names — 0=C, 1=C♯, 2=D ... 11=B
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Krumhansl-Schmuckler key profiles (indexed from C=0)
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// ─── State ────────────────────────────────────────────────────────────────────
let uploadedFile      = null;   // Raw File object
let isStereo          = true;   // Detected from decoded buffer
let originalKey       = null;   // Pitch class 0-11 (C-B), null until detected
let detectedMode      = 'major';// 'major' or 'minor'
let pitchBlobURL      = null;   // Blob URL for pitch-shifted audio
let karaokeBlobURL    = null;   // Blob URL for karaoke audio
let selectedFeature      = null;   // 'key' or 'karaoke'
let targetSemitones      = 0;      // semitone shift currently selected in key changer
let activeKaraokeJobId   = null;   // jobId of the currently running karaoke job

// Audio player state
let audioCtx          = null;
let analyser          = null;
let mediaSource       = null;
let vizAnimId         = null;

// ─── DOM References ────────────────────────────────────────────────────────────
const featurePicker       = document.getElementById('featurePicker');
const pickKeyBtn          = document.getElementById('pickKey');
const pickKaraokeBtn      = document.getElementById('pickKaraoke');
const featureSelectedBar  = document.getElementById('featureSelectedBar');
const featureSelectedName = document.getElementById('featureSelectedName');
const changeFeatureBtn    = document.getElementById('changeFeatureBtn');

const dropZone          = document.getElementById('dropZone');
const fileInput         = document.getElementById('fileInput');
const filePanel         = document.getElementById('filePanel');
const uploadCard        = document.getElementById('uploadCard');
const fileName          = document.getElementById('fileName');
const fileDetails       = document.getElementById('fileDetails');
const removeBtn         = document.getElementById('removeBtn');
const waveformCanvas    = document.getElementById('waveformCanvas');
const monoWarning       = document.getElementById('monoWarning');
const toolsCard         = document.getElementById('toolsCard');

const tabKey            = document.getElementById('tabKey');
const tabKaraoke        = document.getElementById('tabKaraoke');
const tabInk            = document.getElementById('tabInk');
const panelKey          = document.getElementById('panelKey');
const panelKaraoke      = document.getElementById('panelKaraoke');

const keyNote           = document.getElementById('keyNote');
const keyFrom           = document.getElementById('keyFrom');
const keyOffset         = document.getElementById('keyOffset');
const intervalBadge     = document.getElementById('intervalBadge');
const keySelector       = document.getElementById('keySelector');
const previewPitchBtn   = document.getElementById('previewPitchBtn');
const downloadPitchBtn  = document.getElementById('downloadPitchBtn');

const processKaraokeBtn = document.getElementById('processKaraokeBtn');
const downloadKaraokeBtn= document.getElementById('downloadKaraokeBtn');
const karaokeProgress   = document.getElementById('karaokeProgress');
const kpPhase           = document.getElementById('kpPhase');
const kpPct             = document.getElementById('kpPct');
const kpFill            = document.getElementById('kpFill');
const kpEta             = document.getElementById('kpEta');
const cancelKaraokeBtn  = document.getElementById('cancelKaraokeBtn');
const queueStatus       = document.getElementById('queueStatus');
const qsDot             = document.getElementById('qsDot');
const qsLabel           = document.getElementById('qsLabel');

const audioPlayer       = document.getElementById('audioPlayer');
const playerBadge       = document.getElementById('playerBadge');
const playerState       = document.getElementById('playerState');
const playPauseBtn      = document.getElementById('playPauseBtn');
const iconPlay          = playPauseBtn.querySelector('.icon-play');
const iconPause         = playPauseBtn.querySelector('.icon-pause');
const seekBar           = document.getElementById('seekBar');
const seekFill          = document.getElementById('seekFill');
const seekThumb         = document.getElementById('seekThumb');
const timeDisplay       = document.getElementById('timeDisplay');
const visualizerCanvas  = document.getElementById('visualizerCanvas');
const audioElement      = document.getElementById('audioElement');
const toastContainer    = document.getElementById('toastContainer');

// ─── Utility: Format Time ─────────────────────────────────────────────────────
function formatTime(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─── Utility: Format File Size ────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
const TOAST_ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

function showToast(message, type = 'info', duration = 4000) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.textContent = TOAST_ICONS[type];
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  t.append(iconSpan, msgSpan);
  toastContainer.prepend(t);
  setTimeout(() => {
    t.classList.add('toast-fade');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, duration);
}

// ─── Key Detection: FFT + Krumhansl-Schmuckler ───────────────────────────────

/** Pearson correlation coefficient between two arrays */
function pearsonR(a, b) {
  const n = a.length;
  let sA = 0, sB = 0;
  for (let i = 0; i < n; i++) { sA += a[i]; sB += b[i]; }
  const mA = sA / n, mB = sB / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - mA, db = b[i] - mB;
    num += da * db; dA += da * da; dB += db * db;
  }
  return num / (Math.sqrt(dA * dB) || 1e-9);
}

/** Rotate array left by k positions */
function rotArr(arr, k) {
  const n = arr.length;
  k = ((k % n) + n) % n;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

/**
 * Simple Cooley-Tukey FFT → returns magnitude spectrum (length n/2).
 * n must be a power of 2.
 */
function fftMag(data, n) {
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n && i < data.length; i++) re[i] = data[i];

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang  = -Math.PI / half;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const th = ang * j;
        const wr = Math.cos(th), wi = Math.sin(th);
        const vr = re[i+j+half] * wr - im[i+j+half] * wi;
        const vi = re[i+j+half] * wi + im[i+j+half] * wr;
        re[i+j+half] = re[i+j] - vr;  im[i+j+half] = im[i+j] - vi;
        re[i+j] += vr;                 im[i+j] += vi;
      }
    }
  }

  const mag = new Float32Array(n >> 1);
  for (let i = 0; i < n >> 1; i++) mag[i] = Math.sqrt(re[i]*re[i] + im[i]*im[i]);
  return mag;
}

/**
 * Estimates the musical key of an AudioBuffer using:
 * 1. FFT-based chromagram (pitch-class energy profile)
 * 2. Krumhansl-Schmuckler key profiles
 * Returns { key: 0-11, mode: 'major'|'minor' }
 */
function detectKey(audioBuffer) {
  const sr   = audioBuffer.sampleRate;
  const raw  = audioBuffer.getChannelData(0);

  // Analyse up to 90s starting 5% in (avoids silent intros)
  const startS = Math.floor(raw.length * 0.05);
  const lenS   = Math.min(Math.floor(90 * sr), raw.length - startS);

  const N   = 4096; // FFT size (power of 2)
  const hop = 8192; // Hop size — larger = faster, still plenty of frames

  // Hanning window
  const hwin = new Float32Array(N);
  for (let i = 0; i < N; i++) hwin[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));

  const chroma = new Float32Array(12);
  let frames = 0;

  for (let pos = startS; pos + N <= startS + lenS; pos += hop) {
    // Apply window
    const frame = new Float32Array(N);
    for (let i = 0; i < N; i++) frame[i] = raw[pos + i] * hwin[i];

    const mag = fftMag(frame, N);

    // Accumulate spectral energy per pitch class
    for (let bin = 1; bin < N / 2; bin++) {
      const freq = bin * sr / N;
      // Focus on C2 (65 Hz) → C7 (2093 Hz) — the melodic/harmonic range
      if (freq < 65 || freq > 2100) continue;

      const midi = 12 * Math.log2(freq / 440) + 69;
      const pc   = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag[bin] * mag[bin]; // Energy (squared magnitude)
    }
    frames++;
  }

  if (frames === 0) return { key: 9, mode: 'major' }; // Fallback: A major

  const ch = Array.from(chroma);
  let bestKey = 0, bestMode = 'major', bestR = -2;

  for (let k = 0; k < 12; k++) {
    const rMaj = pearsonR(ch, rotArr(KS_MAJOR, k));
    const rMin = pearsonR(ch, rotArr(KS_MINOR, k));
    if (rMaj > bestR) { bestR = rMaj; bestKey = k; bestMode = 'major'; }
    if (rMin > bestR) { bestR = rMin; bestKey = k; bestMode = 'minor'; }
  }

  return { key: bestKey, mode: bestMode };
}

// ─── Feature Picker ───────────────────────────────────────────────────────────
function selectFeature(feature) {
  selectedFeature = feature;
  featurePicker.hidden = true;
  uploadCard.hidden = false;
  featureSelectedName.textContent = feature === 'key' ? 'Key Changer' : 'Karaoke Maker';
}

function showFeaturePicker() {
  resetUpload();
  targetSemitones = 0;
  updateKeyUI(0);
  selectedFeature = null;
  uploadCard.hidden = true;
  toolsCard.hidden = true;
  featurePicker.hidden = false;
}

pickKeyBtn.addEventListener('click',     () => selectFeature('key'));
pickKaraokeBtn.addEventListener('click', () => selectFeature('karaoke'));
changeFeatureBtn.addEventListener('click', showFeaturePicker);

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function initTabs() {
  buildKeySelector();
  positionTabInk(tabKey);

  [tabKey, tabKaraoke].forEach(btn => {
    btn.addEventListener('click', () => {
      [tabKey, tabKaraoke].forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      [panelKey, panelKaraoke].forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById(btn.dataset.panel).classList.add('active');
      positionTabInk(btn);
    });
  });
}

function positionTabInk(activeBtn) {
  const rect   = activeBtn.getBoundingClientRect();
  const parent = activeBtn.closest('.tab-bar').getBoundingClientRect();
  tabInk.style.left  = (rect.left - parent.left) + 'px';
  tabInk.style.width = rect.width + 'px';
}

// ─── Key Selector (12 clickable note buttons) ─────────────────────────────────
function calcSemitones(fromPC, toPC) {
  const ref = fromPC !== null ? fromPC : 0;
  const up  = ((toPC - ref) % 12 + 12) % 12; // 0–11 going up
  return up <= 6 ? up : up - 12;              // shortest path: –5 to +6
}

function buildKeySelector() {
  keySelector.innerHTML = '';
  NOTE_NAMES.forEach((name, pc) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-btn';
    btn.textContent = name;
    btn.dataset.pc = pc;
    btn.addEventListener('click', () => {
      targetSemitones = calcSemitones(originalKey, pc);
      updateKeyUI(targetSemitones);
      if (!audioPlayer.hidden) stopAudio();
    });
    keySelector.appendChild(btn);
  });
  updateKeySelector();
}

function updateKeySelector() {
  const targetPC = ((( originalKey ?? 0) + targetSemitones) % 12 + 12) % 12;
  keySelector.querySelectorAll('.key-btn').forEach((btn, i) => {
    btn.classList.remove('active', 'origin', 'both');
    const isOrigin = originalKey !== null && i === originalKey;
    const isTarget = i === targetPC;
    if (isOrigin && isTarget) btn.classList.add('both');
    else if (isTarget)         btn.classList.add('active');
    else if (isOrigin)         btn.classList.add('origin');
  });
}

// ─── Key Display Update ───────────────────────────────────────────────────────
function updateKeyUI(semitones) {
  if (originalKey !== null) {
    // Compute target note letter
    const targetPC   = ((originalKey + semitones) % 12 + 12) % 12;
    const targetName = NOTE_NAMES[targetPC];
    const origName   = NOTE_NAMES[originalKey];
    const modeLabel  = detectedMode === 'major' ? 'Major' : 'Minor';

    keyNote.textContent = targetName;
    keyFrom.textContent = semitones === 0
      ? `Detected: ${origName} ${modeLabel}`
      : `from ${origName} ${modeLabel}`;

    if (semitones === 0) {
      keyOffset.hidden = true;
    } else {
      keyOffset.hidden = false;
      keyOffset.textContent = `${semitones > 0 ? '+' : ''}${semitones} st`;
    }
  } else {
    keyNote.textContent = '—';
    keyFrom.textContent = 'Upload audio to detect key';
    keyOffset.hidden = true;
  }

  // Interval name badge
  const iName = INTERVAL_NAMES[semitones.toString()] ?? `${semitones > 0 ? '+' : ''}${semitones} semitones`;
  intervalBadge.textContent = iName;
  intervalBadge.classList.toggle('active', semitones !== 0);

  // Bump animation on note letter
  keyNote.classList.remove('bump');
  requestAnimationFrame(() => keyNote.classList.add('bump'));

  updateKeySelector();
}

// ─── File Upload & Handling ───────────────────────────────────────────────────
function initDropZone() {
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  removeBtn.addEventListener('click', resetUpload);
}

const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/aac', 'audio/x-aac', 'audio/mp4', 'audio/x-m4a'];
const ALLOWED_EXTS  = ['.mp3', '.wav', '.aac', '.m4a'];

function validateFile(file) {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTS.includes(ext))
    return 'Unsupported format. Please upload an MP3, WAV, or AAC file.';
  if (file.size > 100 * 1024 * 1024)
    return 'File too large. Maximum size is 100 MB.';
  return null;
}

async function handleFile(file) {
  const err = validateFile(file);
  if (err) { showToast(err, 'error'); return; }

  uploadedFile = file;
  originalKey  = null;
  detectedMode = 'major';
  resetProcessedAudio();

  // Show file panel immediately
  dropZone.hidden  = true;
  filePanel.hidden = false;
  toolsCard.hidden = false;
  // Activate the tab matching the feature the user picked
  requestAnimationFrame(() => {
    (selectedFeature === 'karaoke' ? tabKaraoke : tabKey).click();
  });

  fileName.textContent    = file.name;
  fileDetails.textContent = formatSize(file.size);

  // Show detecting state in key panel
  keyNote.textContent = '…';
  keyFrom.textContent = 'Detecting key…';
  keyOffset.hidden    = true;
  intervalBadge.textContent = '—';
  intervalBadge.classList.remove('active');

  try {
    const arrayBuf = await file.arrayBuffer();
    const tempCtx  = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    const decoded  = await tempCtx.decodeAudioData(arrayBuf);
    tempCtx.close();

    isStereo = decoded.numberOfChannels >= 2;
    const duration = decoded.duration;

    // Draw waveform while key detection runs
    drawWaveform(decoded);
    monoWarning.hidden = isStereo;

    // Show partial info immediately
    fileDetails.textContent = `${formatSize(file.size)} · ${formatTime(duration)} · ${isStereo ? 'Stereo' : 'Mono'} · detecting key…`;

    // Yield to browser so UI repaints before heavy FFT computation
    await new Promise(r => setTimeout(r, 60));

    // Run key detection
    const det = detectKey(decoded);
    originalKey  = det.key;
    detectedMode = det.mode;

    const noteLabel = NOTE_NAMES[originalKey];
    const modeLabel = detectedMode === 'major' ? 'Major' : 'Minor';

    fileDetails.textContent = `${formatSize(file.size)} · ${formatTime(duration)} · ${isStereo ? 'Stereo' : 'Mono'} · Key: ${noteLabel} ${modeLabel}`;
    updateKeyUI(targetSemitones);

    showToast(`"${file.name}" loaded · Key: ${noteLabel} ${modeLabel}`, 'success', 4000);

  } catch (e) {
    showToast('Could not decode audio. The file may be corrupt.', 'error');
    resetUpload();
  }
}

function resetUpload() {
  uploadedFile = null;
  originalKey  = null;
  detectedMode = 'major';
  fileInput.value = '';
  dropZone.hidden    = false;
  filePanel.hidden   = true;
  toolsCard.hidden   = true;
  monoWarning.hidden = true;
  stopAudio();
  resetProcessedAudio();
  downloadKaraokeBtn.disabled = true;
  targetSemitones = 0;
  updateKeyUI(0);
}

function resetProcessedAudio() {
  if (pitchBlobURL)   { URL.revokeObjectURL(pitchBlobURL);   pitchBlobURL   = null; }
  if (karaokeBlobURL) { URL.revokeObjectURL(karaokeBlobURL); karaokeBlobURL = null; }
  setKaraokeProgress(false);
  stopAudio();
}

// ─── Waveform Renderer ────────────────────────────────────────────────────────
function drawWaveform(audioBuffer) {
  const canvas = waveformCanvas;
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.parentElement.clientWidth || 760;
  const H      = 90;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx  = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / W));
  const mid  = H / 2;
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   'rgba(0, 71, 225, 0.8)');
  grad.addColorStop(0.5, 'rgba(0, 199, 168, 0.9)');
  grad.addColorStop(1,   'rgba(0, 71, 225, 0.8)');

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = grad;

  for (let x = 0; x < W; x++) {
    let min = 0, max = 0;
    for (let j = 0; j < step; j++) {
      const s = data[x * step + j] || 0;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    ctx.fillRect(x, mid - max * mid * 0.95, 1, Math.max(1, (max - min) * mid * 0.95));
  }

  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, mid - 0.5, W, 1);
}

// ─── API: Send to Server ──────────────────────────────────────────────────────
async function sendToServer(endpoint, extraFields = {}) {
  if (!uploadedFile) { showToast('No audio file loaded.', 'warning'); return null; }

  const form = new FormData();
  form.append('audio', uploadedFile);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

  const res = await fetch(endpoint, { method: 'POST', body: form });

  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return await res.blob();
}

// ─── Pitch Shift ──────────────────────────────────────────────────────────────
async function runPitchShift(andDownload = false) {
  const semitones = targetSemitones;

  // Build a descriptive label (e.g. "A → C♯  (+3 st)")
  let label = 'Original';
  if (originalKey !== null && semitones !== 0) {
    const targetPC = ((originalKey + semitones) % 12 + 12) % 12;
    label = `${NOTE_NAMES[originalKey]} → ${NOTE_NAMES[targetPC]}`;
  } else if (semitones !== 0) {
    label = `${semitones > 0 ? '+' : ''}${semitones} semitones`;
  }

  setLoading(previewPitchBtn,  true);
  setLoading(downloadPitchBtn, true);

  try {
    const blob = await sendToServer('/api/pitch-shift', { semitones });
    if (!blob) return;

    if (pitchBlobURL) URL.revokeObjectURL(pitchBlobURL);
    pitchBlobURL = URL.createObjectURL(blob);

    if (andDownload) {
      const baseName = uploadedFile ? uploadedFile.name.replace(/\.[^.]+$/, '') : 'pitch';
      const targetPC = ((( originalKey ?? 0) + semitones) % 12 + 12) % 12;
      const keyLabel = originalKey !== null
        ? NOTE_NAMES[targetPC].replace('♯', '#')
        : `${semitones >= 0 ? '+' : ''}${semitones}st`;
      triggerDownload(pitchBlobURL, `${baseName}-${keyLabel}.mp3`);
      showToast('Pitch-shifted audio downloaded!', 'success');
    } else {
      loadAudioPlayer(pitchBlobURL, label);
      showToast(`Playing: ${label}`, 'info', 3000);
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setLoading(previewPitchBtn,  false);
    setLoading(downloadPitchBtn, false);
  }
}

previewPitchBtn.addEventListener('click',  () => runPitchShift(false));
downloadPitchBtn.addEventListener('click', () => runPitchShift(true));

// ─── Karaoke Progress Helpers ─────────────────────────────────────────────────
function setKaraokeProgress(visible) {
  karaokeProgress.hidden = !visible;
  cancelKaraokeBtn.disabled = !visible;
  if (!visible) activeKaraokeJobId = null;
}

function updateKaraokeProgress(pct, phase, eta) {
  kpPhase.textContent = phase || 'Processing…';
  kpPct.textContent   = `${pct}%`;
  kpFill.style.width  = `${pct}%`;
  kpFill.closest('[role="progressbar"]').setAttribute('aria-valuenow', pct);

  if (eta) {
    const parts = eta.split(':').map(Number);
    let label = '';
    if (parts.length === 3)      label = `~${parts[0]}h ${parts[1]}m remaining`;
    else if (parts[0] > 0)       label = `~${parts[0]}m ${parts[1]}s remaining`;
    else if (parts[1] > 0)       label = `~${parts[1]}s remaining`;
    kpEta.textContent = label;
  } else {
    kpEta.textContent = pct > 0 && pct < 100 ? 'Estimating time…' : '';
  }
}

// ─── Queue Status Widget ──────────────────────────────────────────────────────
let queuePollId = null;

function updateQueueStatusWidget(active, queued, limit) {
  const dot   = qsDot;
  const label = qsLabel;
  const wrap  = queueStatus;

  dot.className   = 'qs-dot';
  wrap.className  = 'queue-status';

  if (active === 0 && queued === 0) {
    dot.classList.add('qs-idle');
    label.textContent = 'Server ready';
  } else if (queued === 0) {
    dot.classList.add('qs-busy');
    wrap.classList.add('qs-state-busy');
    label.textContent = `Queue: ${active} of ${limit} active`;
  } else {
    dot.classList.add('qs-full');
    wrap.classList.add('qs-state-full');
    label.textContent = `Queue: ${active} active · ${queued} waiting`;
  }
}

async function fetchQueueStatus() {
  try {
    const res = await fetch('/api/queue-status', {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) return;
    const { active, queued, limit } = await res.json();
    updateQueueStatusWidget(active, queued, limit);
  } catch (_) {}
}

function startQueuePolling() {
  fetchQueueStatus();
  if (!queuePollId) queuePollId = setInterval(fetchQueueStatus, 15000);
}

function stopQueuePolling() {
  if (queuePollId) { clearInterval(queuePollId); queuePollId = null; }
}

// ─── Karaoke ─────────────────────────────────────────────────────────────────
async function runKaraoke(andDownload = false) {
  if (!uploadedFile) return;
  if (!isStereo) showToast('Mono audio detected — results may be less accurate.', 'warning', 5000);

  setLoading(processKaraokeBtn, true);
  downloadKaraokeBtn.disabled = true;

  try {
    // 1 ── Upload file and start the background job
    const form = new FormData();
    form.append('audio', uploadedFile);
    const startRes = await fetch('/api/karaoke/start', { method: 'POST', body: form });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || 'Failed to start job.');
    const { jobId } = startData;

    setLoading(processKaraokeBtn, false);
    processKaraokeBtn.disabled = true;   // keep disabled while job runs
    activeKaraokeJobId = jobId;

    // 2 ── Show progress bar
    setKaraokeProgress(true);
    updateKaraokeProgress(0, 'Starting…', null);
    startQueuePolling();

    // 3 ── Stream progress via Server-Sent Events
    await new Promise((resolve, reject) => {
      const es = new EventSource(`/api/karaoke/events/${jobId}`);

      es.onmessage = async (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }

        if (data.error) {
          es.close();
          stopQueuePolling();
          fetchQueueStatus();
          setKaraokeProgress(false);
          if (data.cancelled) {
            showToast('Conversion cancelled.', 'info');
            resolve();
          } else {
            reject(new Error(data.error));
          }
          return;
        }

        updateKaraokeProgress(data.pct ?? 0, data.phase, data.eta);

        // Refresh queue widget immediately on queue-position events
        if (data.queuePos != null) fetchQueueStatus();

        if (data.done) {
          es.close();
          stopQueuePolling();
          fetchQueueStatus(); // refresh to show queue drained
          try {
            const dlRes = await fetch(`/api/karaoke/download/${jobId}`);
            if (!dlRes.ok) throw new Error('Download failed after processing.');
            const blob = await dlRes.blob();

            if (karaokeBlobURL) URL.revokeObjectURL(karaokeBlobURL);
            karaokeBlobURL = URL.createObjectURL(blob);
            downloadKaraokeBtn.disabled = false;
            setKaraokeProgress(false);

            const karaokeFilename = uploadedFile
              ? uploadedFile.name.replace(/\.[^.]+$/, '') + '-karaoke.mp3'
              : 'karaoke.mp3';

            if (andDownload) {
              triggerDownload(karaokeBlobURL, karaokeFilename);
              showToast('Karaoke audio downloaded!', 'success');
            } else {
              loadAudioPlayer(karaokeBlobURL, 'Karaoke Preview');
              showToast('Karaoke version ready — vocals removed!', 'success');
            }
            resolve();
          } catch (err) {
            setKaraokeProgress(false);
            reject(err);
          }
        }
      };

      es.onerror = () => {
        es.close();
        stopQueuePolling();
        fetchQueueStatus();
        setKaraokeProgress(false);
        reject(new Error('Connection lost during processing. Please try again.'));
      };
    });

  } catch (e) {
    stopQueuePolling();
    fetchQueueStatus();
    showToast(e.message, 'error');
  } finally {
    processKaraokeBtn.disabled = false;
    setLoading(processKaraokeBtn, false);
  }
}

processKaraokeBtn.addEventListener('click', () => runKaraoke(false));

cancelKaraokeBtn.addEventListener('click', async () => {
  if (!activeKaraokeJobId) return;
  cancelKaraokeBtn.disabled = true;
  try {
    await fetch(`/api/karaoke/cancel/${activeKaraokeJobId}`, { method: 'DELETE' });
  } catch (_) {}
  // UI reset is driven by the SSE error/cancelled event from the server
});

downloadKaraokeBtn.addEventListener('click', () => {
  if (karaokeBlobURL) {
    const karaokeFilename = uploadedFile
      ? uploadedFile.name.replace(/\.[^.]+$/, '') + '-karaoke.mp3'
      : 'karaoke.mp3';
    triggerDownload(karaokeBlobURL, karaokeFilename);
    showToast('Karaoke audio downloaded!', 'success');
  } else {
    runKaraoke(true);
  }
});

// ─── Audio Player ─────────────────────────────────────────────────────────────
function loadAudioPlayer(blobURL, label) {
  stopAudio();
  playerBadge.textContent = label;
  audioElement.src = blobURL;
  audioPlayer.hidden = false;
  audioElement.play().catch(() => {});
  initVisualizer();
}

function stopAudio() {
  if (!audioElement.paused) audioElement.pause();
  audioElement.removeAttribute('src');
  audioElement.load();
  audioPlayer.hidden = true;
  stopVisualizer();
  setPlayerState(false);
}

// ─── Player Controls ──────────────────────────────────────────────────────────
audioElement.addEventListener('play',  () => setPlayerState(true));
audioElement.addEventListener('pause', () => setPlayerState(false));
audioElement.addEventListener('ended', () => {
  setPlayerState(false);
  seekFill.style.width = '0%';
  seekThumb.style.left = '0%';
});

audioElement.addEventListener('timeupdate', () => {
  const pct = audioElement.duration ? (audioElement.currentTime / audioElement.duration) * 100 : 0;
  seekFill.style.width = pct + '%';
  seekThumb.style.left = pct + '%';
  seekBar.setAttribute('aria-valuenow', Math.round(pct));
  timeDisplay.textContent = `${formatTime(audioElement.currentTime)} / ${formatTime(audioElement.duration)}`;
});

function setPlayerState(playing) {
  iconPlay.style.display  = playing ? 'none' : '';
  iconPause.style.display = playing ? ''     : 'none';
  playerState.textContent = playing ? '● PLAYING' : '■ PAUSED';
  playerState.classList.toggle('paused', !playing);
}

playPauseBtn.addEventListener('click', () => {
  if (audioElement.paused) audioElement.play();
  else audioElement.pause();
});

seekBar.addEventListener('click', e => {
  const rect = seekBar.getBoundingClientRect();
  if (audioElement.duration) {
    audioElement.currentTime = ((e.clientX - rect.left) / rect.width) * audioElement.duration;
  }
});

// ─── Frequency Visualizer ─────────────────────────────────────────────────────
function initVisualizer() {
  stopVisualizer();
  try {
    // Create AudioContext once
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
      mediaSource = null; // Context was recreated — source must be recreated too
      analyser    = null;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // IMPORTANT: MediaElementSource can only be created ONCE per <audio> element.
    // Never disconnect/recreate it — just reuse the existing graph.
    if (!mediaSource) {
      analyser    = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;

      mediaSource = audioCtx.createMediaElementSource(audioElement);
      mediaSource.connect(analyser);
      analyser.connect(audioCtx.destination);
    }

    drawVisualizer();
  } catch (e) {
    console.warn('Visualizer init failed:', e);
  }
}

function drawVisualizer() {
  const canvas    = visualizerCanvas;
  const dpr       = window.devicePixelRatio || 1;
  const W         = Math.round(canvas.getBoundingClientRect().width) || canvas.parentElement.clientWidth || 760;
  const BAR_H     = 72;
  const LABEL_H   = 18;
  const H         = BAR_H + LABEL_H;
  canvas.width    = W * dpr;
  canvas.height   = H * dpr;

  const ctx       = canvas.getContext('2d');
  const SR        = audioCtx.sampleRate;
  const binCount  = analyser.frequencyBinCount;
  const data      = new Uint8Array(binCount);

  // 64 bars mapped logarithmically from 20 Hz to 20 kHz
  const BAR_COUNT = 64;
  const GAP       = 1.5;
  const barW      = W / BAR_COUNT - GAP;
  const MIN_FREQ  = 20;
  const MAX_FREQ  = 20000;
  const LOG_RANGE = Math.log10(MAX_FREQ / MIN_FREQ);

  const LABELS = [
    [20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'],
    [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k'],
  ];

  function freqToX(f) {
    return W * Math.log10(f / MIN_FREQ) / LOG_RANGE;
  }

  function frame() {
    vizAnimId = requestAnimationFrame(frame);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, W * dpr, H * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    for (let i = 0; i < BAR_COUNT; i++) {
      // Center frequency of this bar on the log scale
      const freq  = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (i + 0.5) / BAR_COUNT);
      const bin   = Math.min(Math.round(freq * analyser.fftSize / SR), binCount - 1);
      const barH  = (data[bin] / 255) * BAR_H * 0.92;
      if (barH < 1) continue;

      const x     = i * (W / BAR_COUNT);
      const t     = i / BAR_COUNT;
      const r     = Math.round(0   + (0   - 0)   * t);
      const g     = Math.round(71  + (199 - 71)  * t);
      const b     = Math.round(225 + (168 - 225) * t);

      const grad  = ctx.createLinearGradient(x, BAR_H, x, BAR_H - barH);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.3)`);
      ctx.fillStyle = grad;

      const rx = Math.min(3, barW * 0.4);
      ctx.beginPath();
      ctx.moveTo(x + rx, BAR_H - barH);
      ctx.lineTo(x + barW - rx, BAR_H - barH);
      ctx.quadraticCurveTo(x + barW, BAR_H - barH, x + barW, BAR_H - barH + rx);
      ctx.lineTo(x + barW, BAR_H);
      ctx.lineTo(x, BAR_H);
      ctx.lineTo(x, BAR_H - barH + rx);
      ctx.quadraticCurveTo(x, BAR_H - barH, x + rx, BAR_H - barH);
      ctx.fill();
    }

    // Frequency labels (drawn once per frame so they sit on top of bars)
    ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    LABELS.forEach(([freq, label]) => {
      const x = freqToX(freq);
      ctx.fillStyle = 'rgba(148,163,184,0.3)';
      ctx.fillRect(x - 0.5, BAR_H + 2, 1, 4);
      ctx.fillStyle = 'rgba(148,163,184,0.6)';
      ctx.fillText(label, x, H - 1);
    });

    ctx.restore();
  }

  frame();
}

function stopVisualizer() {
  if (vizAnimId) { cancelAnimationFrame(vizAnimId); vizAnimId = null; }
}

// ─── Download Helper ──────────────────────────────────────────────────────────
function triggerDownload(blobURL, filename) {
  const a = document.createElement('a');
  a.href = blobURL; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Loading State Helpers ────────────────────────────────────────────────────
function setLoading(btn, on) {
  if (on) {
    btn.classList.add('loading');
    btn.disabled = true;
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-text"></span>';
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    if (btn.dataset.origText) btn.innerHTML = btn.dataset.origText;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  initDropZone();
  initTabs();
  updateKeyUI(0);
  startQueuePolling();

  requestAnimationFrame(() => positionTabInk(tabKey));
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tab-btn.active');
    if (active) positionTabInk(active);
  });
}

init();
