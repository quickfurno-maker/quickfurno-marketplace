BEGIN;
CREATE TABLE public.bad_lead_reports(
 id uuid PRIMARY KEY,lead_assignment_id uuid,status text NOT NULL,
 reviewed_by uuid,reviewed_at timestamptz,updated_at timestamptz,
 admin_notes text);
CREATE TABLE public.lead_assignments(id uuid PRIMARY KEY,is_bad_lead_reported boolean NOT NULL DEFAULT false);
INSERT INTO public.bad_lead_reports(id,lead_assignment_id,status)
VALUES
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Under Review'),
 ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','Under Review'),
 ('55555555-5555-4555-8555-555555555555',null,'Under Review');
INSERT INTO public.lead_assignments(id) VALUES('22222222-2222-4222-8222-222222222222');
COMMIT;
