# Production Dockerfile for Next.js Frontend
FROM node:20-slim AS base

# ✅ CORRECTIF : On installe OpenSSL ici pour qu'il soit dispo PARTOUT (y compris en prod)
RUN apt-get update -y && apt-get install -y openssl ca-certificates

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Copie du dossier prisma AVANT l'installation (Crucial !)
COPY prisma ./prisma

# ✅ CORRECTIF : On garde le package-lock.json pour garantir des dépendances identiques
# RUN rm -rf package-lock.json

# Installation des dépendances
RUN npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Build arguments for environment variables needed during build
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ARG NEXTAUTH_URL="http://localhost:3000"
ARG NEXTAUTH_SECRET
ARG INTERNAL_API_URL="http://localhost:3000"
ARG INTERNAL_API_KEY

# Propagate build args to runtime environment variables
ENV INTERNAL_API_URL=${INTERNAL_API_URL}
ENV INTERNAL_API_KEY=${INTERNAL_API_KEY}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client before build
RUN npx prisma generate

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma CLI for runtime migrations
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copy and setup entrypoint script
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use entrypoint to run migrations before starting the app
CMD ["./entrypoint.sh"]