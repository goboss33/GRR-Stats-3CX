-- 001_effective_call_id.sql — grain « appel client » (fusion des jambes de transfert)
--
-- 3CX crée un call_history_id distinct pour chaque jambe de transfert (appel de
-- consultation, renvoi) et relie la jambe à l'appel d'origine par
-- main_call_history_id. Les rapports 3CX — et l'Excel historique des managers —
-- comptent au grain « appel principal » ; l'application comptait au grain
-- « jambe », d'où des doubles comptages (mesuré : 111 appels sur la file 901 en
-- juin 2026, ~2 % à l'échelle de l'entreprise).
--
-- Ce script prépare le grain fusionné SANS toucher à la table :
--   1) index d'expression sur COALESCE(main_call_history_id, call_history_id)
--      — PAS de colonne ajoutée : l'import 3CX (externe à ce dépôt) reste
--      rigoureusement intouché ;
--   2) vue cdroutput_merged : présente cdroutput au grain « appel client ».
--      call_history_id y EST la clé fusionnée ; l'identifiant de la jambe est
--      conservé dans leg_call_history_id (pour l'affichage du déroulement).
--      Les requêtes statistiques basculent de table sans changer de logique.
--
-- À exécuter sur CHAQUE base CDR (callcenter_gerofinance, callcenter_edifea).
-- Idempotent : rejouable sans effet quand il est déjà appliqué. La vue est
-- régénérée à chaque exécution pour suivre les évolutions de colonnes de la
-- table (synchronisée depuis 3CX).

CREATE INDEX IF NOT EXISTS cdroutput_effective_call_id_idx
    ON cdroutput ((COALESCE(main_call_history_id, call_history_id)));

-- Miroir de cdroutput_call_history_id_cdr_started_at_idx, pour les CTE qui
-- filtrent par période puis regroupent par appel.
CREATE INDEX IF NOT EXISTS cdroutput_effective_call_id_started_idx
    ON cdroutput ((COALESCE(main_call_history_id, call_history_id)), cdr_started_at);

DO $$
DECLARE
    cols text;
BEGIN
    -- Liste des colonnes reconstruite depuis le catalogue : si la table gagne
    -- une colonne lors d'une évolution 3CX, rejouer ce script suffit.
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cdroutput'
      AND column_name <> 'call_history_id';

    -- DROP puis CREATE : CREATE OR REPLACE refuse tout changement de liste de
    -- colonnes, ce qui rendrait le script non rejouable après une évolution.
    EXECUTE 'DROP VIEW IF EXISTS cdroutput_merged';
    EXECUTE format(
        'CREATE VIEW cdroutput_merged AS
         SELECT COALESCE(main_call_history_id, call_history_id) AS call_history_id,
                call_history_id AS leg_call_history_id,
                %s
         FROM cdroutput',
        cols
    );
END $$;
