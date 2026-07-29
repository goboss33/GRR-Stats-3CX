#!/bin/sh
# Point d'entrée du conteneur applicatif.
# Applique les migrations puis démarre le serveur Next.js.
#
# ORDRE IMPORTANT :
#   1. migrations de DONNÉES (renommages d'enum) — doivent précéder db push,
#      sinon push voit un enum divergent et tente de le recréer (perte de données)
#   2. synchronisation du SCHÉMA (nouvelles tables)
#   3. démarrage du serveur

set -e

PRISMA="node_modules/.bin/prisma"
AUTH_SCHEMA="prisma/auth/schema.prisma"

echo "→ [1/3] Migrations de données (idempotentes)…"
# Non bloquant : ces scripts sont rejoués à chaque démarrage et ne font rien
# lorsqu'ils ont déjà été appliqués.
for sql in prisma/sql/*.sql; do
    [ -f "$sql" ] || continue
    echo "    $sql"
    "$PRISMA" db execute --schema="$AUTH_SCHEMA" --file="$sql" \
        || echo "    ⚠️  échec ignoré sur $sql"
done

echo "→ [2/3] Synchronisation du schéma (prisma db push)…"
# Bloquant volontairement : sans les tables attendues, l'application serait dans
# un état indéfini. Pas de --accept-data-loss : toute opération destructive doit
# être décidée explicitement par un humain.
"$PRISMA" db push --schema="$AUTH_SCHEMA" --skip-generate

echo "→ [3/3] Démarrage du serveur"
exec node server.js
