FROM node:20-bookworm-slim

# Python for Demucs (bookworm ships Python 3.11)
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Demucs in a venv; CPU-only PyTorch avoids pulling multi-GB CUDA wheels
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
# Pinning the +cpu local versions keeps PyPI from supplying the CUDA build,
# while the extra index lets pure-Python deps resolve from PyPI
RUN python3 -m venv $VIRTUAL_ENV \
 && pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch==2.5.1+cpu torchaudio==2.5.1+cpu \
      --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple \
 && pip install --no-cache-dir demucs==4.0.1 soundfile

# Bake the default Demucs model into the image so the first job doesn't download it
ENV TORCH_HOME=/opt/torch
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')" \
 && chmod -R a+rX /opt/torch

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p uploads && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
