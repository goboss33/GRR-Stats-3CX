-- 004_autovacuum_cdroutput.sql — statistiques du planificateur toujours fraîches
--
-- Par défaut, autovacuum ne relance ANALYZE qu'après ~10 % de lignes nouvelles :
-- sur 2,4 millions de lignes, cela signifiait des statistiques rafraîchies
-- toutes les 2-3 semaines (constaté : stats du 17 juillet début août). Des
-- estimations fausses = mauvais plans, et c'est aussi ce qui sur-déclenchait
-- le JIT avant sa désactivation (003).
--
-- Ici : seuil FIXE de 10 000 lignes (~une journée d'appels), indépendant de la
-- taille de la table. L'ANALYZE déclenché prend ~1 s en tâche de fond, sans
-- bloquer ni lectures ni écritures. Le vacuum proprement dit garde ses défauts :
-- la table est en append-only (0 ligne morte constatée).
--
-- Idempotent, rejoué au démarrage ; réversible par ALTER TABLE ... RESET.

ALTER TABLE cdroutput SET (
    autovacuum_analyze_scale_factor = 0,
    autovacuum_analyze_threshold = 10000
);
