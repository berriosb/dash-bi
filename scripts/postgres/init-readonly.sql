-- Create read-only role for AI generated queries (defense-in-depth)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'dashbi_readonly') THEN
    CREATE ROLE dashbi_readonly WITH LOGIN PASSWORD 'dashbi_readonly_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE dashbi TO dashbi_readonly;
GRANT USAGE ON SCHEMA public TO dashbi_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashbi_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashbi_readonly;
