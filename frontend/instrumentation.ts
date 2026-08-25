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

    // Préchauffage de l'annuaire files/agents (requête de plusieurs secondes,
    // cf. cdr.repository) : en tir décroché, pour que le serveur réponde tout
    // de suite — le premier visiteur trouvera le cache déjà rempli.
    try {
        const { warmQueueDirectory } = await import("@/services/repositories/cdr.repository");
        void warmQueueDirectory();
    } catch (error) {
        console.error("[annuaire] préchauffage non lancé :", error);
    }

    // Même chose pour l'annuaire des POSTES (balayage de douze mois) : il sert
    // l'autocomplétion d'Extension/DDI et la résolution des noms.
    try {
        const { warmExtensionDirectory } = await import("@/services/repositories/extension-stats.repository");
        void warmExtensionDirectory();
    } catch (error) {
        console.error("[annuaire postes] préchauffage non lancé :", error);
    }

    // Relevé nocturne du journal d'équipe (surcouche XAPI) : n'agit que pour
    // les tenants dont la surcouche est active et configurée — les autres ne
    // paient rien, pas même une ligne de log.
    try {
        const { registerXapiJournalScheduler } = await import("@/lib/xapi-journal-scheduler");
        registerXapiJournalScheduler();
    } catch (error) {
        console.error("[journal-xapi] déclencheur non armé :", error);
    }
}
