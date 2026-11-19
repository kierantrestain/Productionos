-- Audit trail is append-only: reject UPDATE and DELETE at the database layer.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
-- Issued call sheets are immutable snapshots. Only the status transition issued -> superseded is allowed.
CREATE OR REPLACE FUNCTION protect_issued_call_sheet() RETURNS trigger AS $$
BEGIN
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
--> statement-breakpoint
CREATE TRIGGER call_sheets_immutable BEFORE UPDATE OR DELETE ON call_sheets
  FOR EACH ROW EXECUTE FUNCTION protect_issued_call_sheet();
--> statement-breakpoint
-- Approval decisions are immutable history.
CREATE TRIGGER approval_decisions_append_only BEFORE UPDATE OR DELETE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
-- Guard rails on money: no negative estimates, PO values or expenses.
ALTER TABLE budget_lines ADD CONSTRAINT budget_lines_non_negative CHECK (estimate_minor >= 0 AND approved_minor >= 0);
--> statement-breakpoint
ALTER TABLE purchase_orders ADD CONSTRAINT po_non_negative CHECK (net_minor >= 0 AND vat_minor >= 0);
--> statement-breakpoint
ALTER TABLE expenses ADD CONSTRAINT expenses_non_negative CHECK (net_minor >= 0 AND vat_minor >= 0);
--> statement-breakpoint
ALTER TABLE schedule_blocks ADD CONSTRAINT blocks_time_order CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time);
--> statement-breakpoint
ALTER TABLE availability_blocks ADD CONSTRAINT availability_order CHECK (end_date >= start_date);
