/**
 * Seed users — mirrors `client/src/infrastructure/mock/seed/users.js`.
 *
 * Stable, deterministic UUIDs keep test fixtures and exported demo
 * state stable across migrations (the `users.id` column is `uuid`, so
 * non-UUID slugs like `u-ayse` no longer fit — we hash the slug into a
 * UUID-shaped constant instead).
 *
 * Password is bcrypt of the demo password `123456`.
 */

import bcrypt from 'bcryptjs'
import { slugUuid } from './slug-uuid.js'

const DEMO_PASSWORD_BCRYPT = bcrypt.hashSync('123456', 8)

export const SEED_USERS = [
  { id: slugUuid('u-ayse'),      name: 'Ayşenur Kanak',         email: 'aysenur@yukselenzeka.com',                      role: 'team_leader' },
  { id: slugUuid('u-elif'),      name: 'Aylin Ulu',             email: 'aylin@yukselenzeka.com',                        role: 'designer' },
  { id: slugUuid('u-feyza'),     name: 'Feyza Küçükkurt',       email: 'feyza@yukselenzeka.com',                        role: 'designer' },
  { id: slugUuid('u-nur'),       name: 'Nur Ekincioğlu',        email: 'nur@yukselenzeka.com',                          role: 'designer' },
  { id: slugUuid('u-sumeyye-a'), name: 'Sümeyye Arslantürk',    email: 'sumeyye.arslanturk@yukselenzeka.com',           role: 'designer' },
  { id: slugUuid('u-oktay'),     name: 'Oktay Şahin',           email: 'oktay@yukselenzeka.com',                        role: 'printer' },
  { id: slugUuid('u-atilla'),    name: 'Atilla Kılıçkan',       email: 'atilla.kilickan@yukselenzeka.com',              role: 'printer' },
  { id: slugUuid('u-esra'),      name: 'Esra Kılıç',            email: 'esra@yukselenzeka.com',                         role: 'satis', joined_at: '2026-06-19T00:00:00.000Z' },
]

export const DEMO_PASSWORD_HASH = DEMO_PASSWORD_BCRYPT
