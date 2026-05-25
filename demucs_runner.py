"""
Patches torchaudio audio I/O to use soundfile instead of torchcodec.
Called by the Node server instead of `python -m demucs` because torchaudio
2.1+ requires torchcodec which is not yet available on Windows.
"""
import sys
import soundfile as sf
import torch
import numpy as np
import torchaudio


# ── Minimal AudioMetaData replacement ─────────────────────────────────────────
class _AudioMetaData:
    __slots__ = ('sample_rate', 'num_frames', 'num_channels', 'bits_per_sample', 'encoding')

    def __init__(self, sample_rate, num_frames, num_channels, bits_per_sample, encoding):
        self.sample_rate     = sample_rate
        self.num_frames      = num_frames
        self.num_channels    = num_channels
        self.bits_per_sample = bits_per_sample
        self.encoding        = encoding


def _sf_info(uri, format=None, buffer_size=4096, backend=None):
    i = sf.info(str(uri))
    return _AudioMetaData(i.samplerate, i.frames, i.channels, 16, 'PCM_S')


def _sf_load(uri, frame_offset=0, num_frames=-1, normalize=True,
             channels_first=True, format=None, buffer_size=4096, backend=None):
    kwargs = {'always_2d': True, 'dtype': 'float32', 'start': frame_offset}
    if num_frames >= 0:
        kwargs['frames'] = num_frames
    data, sr = sf.read(str(uri), **kwargs)
    # soundfile returns (frames, channels); torchaudio expects (channels, frames)
    t = torch.from_numpy(np.ascontiguousarray(data.T if channels_first else data))
    return t, sr


def _sf_save(uri, src, sample_rate, channels_first=True,
             compression=None, format=None, encoding=None,
             bits_per_sample=None, buffer_size=4096, backend=None):
    data = src.detach().cpu().numpy()
    if channels_first and data.ndim == 2:
        data = data.T  # (C, T) -> (T, C)
    sf.write(str(uri), data, sample_rate, subtype='PCM_16')


# Patch before demucs imports torchaudio so all calls go through soundfile
torchaudio.info = _sf_info
torchaudio.load = _sf_load
torchaudio.save = _sf_save

from demucs.separate import main
sys.exit(main())
