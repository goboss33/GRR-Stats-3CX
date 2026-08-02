-- 003_jit_off.sql — désactiver la compilation JIT sur les bases CDR
--
-- Les requêtes générées par le socle de classement (grandes chaînes de CTE)
-- portent des estimations de coût énormes qui déclenchaient systématiquement
-- le JIT de PostgreSQL : ~7,5 s de compilation de 263 fonctions... pour des
-- exécutions réelles inférieures à la seconde. Mesuré le 2 août 2026 sur la
-- requête des KPIs de file (juin, file 901) : 5,8-14 s avec JIT, 0,77 s sans —
-- et 0,24 s avec l'index 002 en plus.
--
-- Posé au niveau BASE (hérité par toute nouvelle connexion, donc par le pool
-- Prisma au démarrage du conteneur). Réversible : ALTER DATABASE ... RESET jit.
-- Idempotent : rejoué sans effet à chaque démarrage.

DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
END $$;
