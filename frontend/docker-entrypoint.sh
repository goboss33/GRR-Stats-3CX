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

PRISMA_CLI="node_modules/prisma/build/index.js"
AUTH_SCHEMA="prisma/auth/schema.prisma"

# ⚠️ On appelle l'entrée réelle du paquet, PAS node_modules/.bin/prisma :
# ce dernier est un lien symbolique que Docker COPY déréférence, ce qui place le
# script hors de son dossier d'origine. Il ne retrouve alors plus ses ressources
# voisines (prisma_schema_build_bg.wasm) et échoue avec ENOENT.
run_prisma() {
    node "$PRISMA_CLI" "$@"
}

if [ ! -f "$PRISMA_CLI" ]; then
    echo "✖ CLI Prisma introuvable ($PRISMA_CLI) — migrations impossibles."
    echo "  Vérifier la copie de node_modules/prisma dans le Dockerfile."
    exit 1
fi

echo "→ [1/3] Migrations de données (idempotentes)…"
# Non bloquant : ces scripts sont rejoués à chaque démarrage et ne font rien
# lorsqu'ils ont déjà été appliqués.
for sql in prisma/sql/*.sql; do
    [ -f "$sql" ] || continue
    echo "    $sql"
    run_prisma db execute --schema="$AUTH_SCHEMA" --file="$sql" \
        || echo "    ⚠️  échec ignoré sur $sql"
done

echo "→ [2/3] Synchronisation du schéma (prisma db push)…"
# Bloquant volontairement : sans les tables attendues, l'application serait dans
# un état indéfini. Pas de --accept-data-loss : toute opération destructive doit
# être décidée explicitement par un humain.
if ! run_prisma db push --schema="$AUTH_SCHEMA" --skip-generate; then
    echo ""
    echo "✖ Synchronisation du schéma impossible — le serveur ne démarrera pas."
    echo "  Si le message ci-dessus évoque une « data loss » sur une contrainte ou"
    echo "  un index, la base a dérivé du schéma : ajouter un script idempotent"
    echo "  dans prisma/sql/ pour rattraper l'écart (voir 002_apikey_keyhash_unique.sql),"
    echo "  plutôt que d'activer --accept-data-loss qui autoriserait aussi de"
    echo "  vraies suppressions de données."
    exit 1
fi

echo "→ [3/3] Démarrage du serveur"
exec node server.js
