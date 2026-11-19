-- Immutable history may only be removed when an organisation is deliberately deleted, inside a
-- transaction that sets `SET LOCAL app.allow_history_purge = 'on'`. Normal UPDATE/DELETE stays blocked.
CREATE OR REPLACE FUNCTION reject_history_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_history_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_decisions_append_only ON approval_decisions;
--> statement-breakpoint
CREATE TRIGGER approval_decisions_append_only BEFORE UPDATE OR DELETE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_issued_call_sheet() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_history_purge', true) = 'on' THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'issued call sheets cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
       OR NEW.version_number IS DISTINCT FROM OLD.version_number OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'issued' AND NEW.status = 'superseded')) THEN
      RAISE EXCEPTION 'issued call sheet % is immutable', OLD.id;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
