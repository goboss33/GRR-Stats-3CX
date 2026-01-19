# Production Dockerfile for Next.js Frontend
FROM node:20-slim AS base

# Install dependencies only when needed
FROM base AS deps
# On remplace apk (Alpine) par apt-get (Debian) et on ajoute OpenSSL pour Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates

WORKDIR /app

# Copie des fichiers de configuration
COPY package.json package-lock.json* ./

# 👇 AJOUTEZ CETTE LIGNE ICI 👇
COPY prisma ./prisma

# On supprime le package-lock pour forcer une résolution propre
RUN rm -rf package-lock.json

# Installation (Maintenant ça va marcher car le dossier prisma est là !)
RUN npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client before build
RUN npx prisma generate

# Build the application
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
