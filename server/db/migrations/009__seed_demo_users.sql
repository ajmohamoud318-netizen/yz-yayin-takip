-- 009 — seed the team leader
--
-- For production we only need ONE bootstrapping account: the team leader.
-- Every other seat in the company is invited manually from the Team page
-- and added to the users table by the invite flow. There is no "demo
-- roster" — placeholder designers/printers/sales rows used to ship with
-- this migration and fill the team list with people who were never
-- actually onboarded. They were removed in favour of an invite-driven
-- workflow.
--
-- Idempotent (ON CONFLICT DO NOTHING) so re-deploys don't clobber any
-- password changes made after the seed run.
--
-- The bcrypt hash is for the demo password '123456' (cost=8). If you
-- need to rotate it, run:
--   UPDATE users SET password = '<new-bcrypt>' WHERE id = '...';

INSERT INTO users (id, name, email, password, role, is_active, joined_at, created_at)
VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  'Ayşenur Kanak',
  'aysenur@yukselenzeka.com',
  '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
  'team_leader',
  TRUE,
  '2024-01-15T00:00:00.000Z',
  NOW()
)
ON CONFLICT (id) DO NOTHING;