FROM node:20-slim AS base

# System deps — cached independently of code changes
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ffmpeg \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-lang-european \
    texlive-lang-portuguese \
    texlive-lang-french \
    texlive-lang-german \
    texlive-lang-spanish \
    texlive-lang-italian \
    texlive-lang-polish \
    texlive-lang-czechslovak \
    texlive-lang-greek \
    texlive-lang-cyrillic \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm deps — cached unless package.json changes
COPY package.json package-lock.json* ./
RUN npm ci

# Prisma client generation
COPY prisma ./prisma
RUN npx prisma generate

# ── Dev stage (used by docker-compose.override.yml) ──
FROM base AS dev
COPY . .
ENV NODE_ENV=development
EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run dev"]

# ── Builder stage ──
FROM base AS builder
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

# ── Production stage ──
# Inherit from base so pdflatex, ffmpeg, and all system deps are present.
# Only swap in the compiled dist/ from the builder stage.
FROM base AS production
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prompts ./prompts

EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
