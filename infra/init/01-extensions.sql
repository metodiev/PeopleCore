-- Extensions used by PeopleCore.
-- pg_trgm powers fuzzy global search (ILIKE acceleration + similarity ranking).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
