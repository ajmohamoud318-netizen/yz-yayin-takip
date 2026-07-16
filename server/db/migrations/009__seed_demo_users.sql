-- 009 — seed demo users
--
-- The repository's full demo data (projects, order requests, …) lives
-- in `db/seed/*` and is intentionally NOT shipped in the production
-- runtime image (it's large and only used by `npm run seed` in dev).
--
-- For production we still need the four canonical users so the team
-- can log in. This migration inserts them with a bcrypt hash of the
-- demo password '123456'. It's idempotent (ON CONFLICT DO NOTHING)
-- so re-deploys don't clobber any password changes.
--
-- Stable UUIDs (mirror client/src/infrastructure/mock/seed/users.js):
--   u-ayse      → team_leader (Ayşenur Kanak)
--   u-elif      → designer   (Aylin Ulu)
--   u-feyza     → designer   (Feyza Küçükkurt)
--   u-nur       → designer   (Nur Ekincioğlu)
--   u-sumeyye-a → designer   (Sümeyye Arslantürk)
--   u-oktay     → printer    (Oktay Şahin)
--   u-atilla    → printer    (Atilla Kılıçkan)
--   u-esra      → satis      (Esra Kılıç)
--
-- The hash below is bcrypt('123456', cost=8) — the same hash the
-- client-side mock used and the same hash the dev seed script
-- generates. If you need to rotate it, run:
--   UPDATE users SET password = '<new-bcrypt>' WHERE id = '...';

INSERT INTO users (id, name, email, password, role, is_active, joined_at, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Ayşenur Kanak',
   'aysenur@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'team_leader', TRUE, '2024-01-15T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000a2', 'Aylin Ulu',
   'aylin@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', TRUE, '2024-03-10T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000a3', 'Feyza Küçükkurt',
   'feyza@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', TRUE, '2024-04-20T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000a4', 'Nur Ekincioğlu',
   'nur@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', TRUE, '2024-05-12T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000a5', 'Sümeyye Arslantürk',
   'sumeyye.arslanturk@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', TRUE, '2024-06-01T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000b1', 'Oktay Şahin',
   'oktay@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'printer', TRUE, '2024-02-01T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000b2', 'Atilla Kılıçkan',
   'atilla.kilickan@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'printer', TRUE, '2024-03-05T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000c1', 'Esra Kılıç',
   'esra@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'satis', TRUE, '2026-06-19T00:00:00.000Z', NOW())
ON CONFLICT (id) DO NOTHING;
