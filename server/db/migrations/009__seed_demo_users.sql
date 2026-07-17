-- 009 — seed demo users
--
-- The repository's full demo data (projects, order requests, …) lives
-- in `db/seed/*` and is intentionally NOT shipped in the production
-- runtime image (it's large and only used by `npm run seed` in dev).
--
-- For production we still need Ayşenur (the team leader) so someone
-- can log in. The other demo accounts (designers / printers / sales)
-- are seeded here as INACTIVE — the team leader activates them on the
-- Team page after inviting the real counterparts, or deletes them
-- entirely. This keeps a fresh Postgres volume from filling the team
-- list with placeholder people who never joined.
--
-- The bcrypt hash is for the demo password '123456' (cost=8). It's
-- only meaningful for the team_leader account; the others stay
-- inactive until you flip them or replace them with real invites.
-- Idempotent (ON CONFLICT DO NOTHING) so re-deploys don't clobber
-- any password changes.
--
-- Stable UUIDs (mirror client/src/infrastructure/mock/seed/users.js):
--   u-ayse      → team_leader (Ayşenur Kanak)   ACTIVE
--   u-elif      → designer   (Aylin Ulu)         inactive
--   u-feyza     → designer   (Feyza Küçükkurt)   inactive
--   u-nur       → designer   (Nur Ekincioğlu)    inactive
--   u-sumeyye-a → designer   (Sümeyye Arslantürk) inactive
--   u-oktay     → printer    (Oktay Şahin)       inactive
--   u-atilla    → printer    (Atilla Kılıçkan)   inactive
--   u-esra      → satis      (Esra Kılıç)        inactive

INSERT INTO users (id, name, email, password, role, is_active, joined_at, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Ayşenur Kanak',
   'aysenur@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'team_leader', TRUE, '2024-01-15T00:00:00.000Z', NOW()),
  ('00000000-0000-0000-0000-0000000000a2', 'Aylin Ulu',
   'aylin@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', FALSE, NULL, NOW()),
  ('00000000-0000-0000-0000-0000000000a3', 'Feyza Küçükkurt',
   'feyza@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', FALSE, NULL, NOW()),
  ('00000000-0000-0000-0000-0000000000a4', 'Nur Ekincioğlu',
   'nur@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', FALSE, NULL, NOW()),
  ('00000000-0000-0000-0000-0000000000a5', 'Sümeyye Arslantürk',
   'sumeyye.arslanturk@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'designer', FALSE, NULL, NOW()),
  ('00000000-0000-0000-0000-0000000000b1', 'Oktay Şahin',
   'oktay@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'printer', FALSE, NULL, NOW()),
  ('00000000-0000-0000-0000-0000000000b2', 'Atilla Kılıçkan',
   'atilla.kilickan@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'printer', FALSE, NULL, NOW()),
  ('00000000-0000-0000-0000-0000000000c1', 'Esra Kılıç',
   'esra@yukselenzeka.com',
   '$2a$08$d/cj/lr0ho1OlfO9zKLbneQRr1GKGWrPOfe.0KqPt5.7oaS0v1/96',
   'satis', FALSE, NULL, NOW())
ON CONFLICT (id) DO NOTHING;
ON CONFLICT (id) DO NOTHING;
