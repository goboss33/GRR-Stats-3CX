/**
 * Point d'entrée exécuté une seule fois au démarrage du serveur Next.js.
 * Sert à appliquer automatiquement les migrations de données au déploiement
 * (pull & redeploy Portainer) — voir lib/startup-migrations.ts.
 */
export async function register() {
    // Ne s'exécute que côté serveur Node (pas sur l'edge runtime).
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    try {
        const { runStartupMigrations } = await import("@/lib/startup-migrations");
        await runStartupMigrations();
    } catch (error) {
        // On ne bloque pas le démarrage : le serveur doit pouvoir répondre pour
        // être diagnostiqué. L'erreur est journalisée de façon visible.
        console.error("[migrations] ÉCHEC des migrations de démarrage :", error);
    }
}
