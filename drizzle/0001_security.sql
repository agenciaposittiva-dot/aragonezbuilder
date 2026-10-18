-- =====================================================================
-- Segurança multi-tenant no banco (defesa em profundidade).
--
-- Toda tabela com a coluna organization_id recebe RLS forçado: o papel de
-- execução só enxerga linhas da organização definida na transação via
--   select set_config('app.org_id', '<uuid>', true)
-- Operações de sistema (login, seed, worker) usam app.rls_bypass = 'on'
-- explicitamente e de forma pontual (ver src/server/db/index.ts).
-- =====================================================================

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_apply_tenant_rls() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = r.table_name AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL '
        'USING (app_rls_bypass() OR organization_id = app_current_org()) '
        'WITH CHECK (app_rls_bypass() OR organization_id = app_current_org())',
        r.table_name
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations FOR ALL
  USING (app_rls_bypass() OR id = app_current_org())
  WITH CHECK (app_rls_bypass() OR id = app_current_org());
--> statement-breakpoint
SELECT app_apply_tenant_rls();
--> statement-breakpoint

-- Eventos de domínio: avisa o worker imediatamente (LISTEN domain_events).
CREATE OR REPLACE FUNCTION notify_domain_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('domain_events', NEW.id::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER domain_events_notify
  AFTER INSERT ON domain_events
  FOR EACH ROW EXECUTE FUNCTION notify_domain_event();
