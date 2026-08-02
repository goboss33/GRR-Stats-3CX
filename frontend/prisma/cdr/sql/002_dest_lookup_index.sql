-- 002_dest_lookup_index.sql — index du prédicat le plus fréquent de l'application
--
-- « destination = tel numéro, de tel type, sur telle période » est le motif de
-- TOUTES les requêtes statistiques : passages en file (queue + numéro + dates),
-- sollicitations directes d'équipe (extension + numéros d'agents + dates),
-- filtres de périmètre, tendances. Sans index composite, le planificateur
-- retombait sur des bitmap scans par date rechargeant tout le mois (mesuré :
-- 4,7 s sur un nœud) ou des seq scans parallèles (52 000 lignes balayées pour
-- 785 utiles).
--
-- L'ordre des colonnes suit la sélectivité des prédicats : égalité sur le
-- numéro, égalité sur le type, intervalle sur la date.
--
-- À exécuter sur CHAQUE base CDR (callcenter_gerofinance, callcenter_edifea).
-- Idempotent : rejoué sans effet par l'entrypoint à chaque démarrage.

CREATE INDEX IF NOT EXISTS cdroutput_dest_number_type_started_idx
    ON cdroutput (destination_dn_number, destination_dn_type, cdr_started_at);
