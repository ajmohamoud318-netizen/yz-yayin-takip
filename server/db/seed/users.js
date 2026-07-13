/**
 * Seed users — mirrors `client/src/infrastructure/mock/seed/users.js`.
 *
 * Stable, non-UUID ids ('u-ayse', etc.) keep test fixtures and exported
 * demo state stable across migrations. Passwords are bcrypt hashes of
 * the demo password `123456`.
 */

import bcrypt from 'bcryptjs'

const DEMO_PASSWORD_BCRYPT = bcrypt.hashSync('123456', 8)

export const SEED_USERS = [
  { id: 'u-ayse',       name: 'Ayşenur Kanak',         email: 'aysenur@yukselenzeka.com',                      role: 'team_leader' },
  { id: 'u-elif',       name: 'Aylin Ulu',             email: 'aylin@yukselenzeka.com',                        role: 'designer' },
  { id: 'u-feyza',      name: 'Feyza Küçükkurt',       email: 'feyza@yukselenzeka.com',                        role: 'designer' },
  { id: 'u-nur',        name: 'Nur Ekincioğlu',        email: 'nur@yukselenzeka.com',                          role: 'designer' },
  { id: 'u-sumeyye-a',  name: 'Sümeyye Arslantürk',    email: 'sumeyye.arslanturk@yukselenzeka.com',           role: 'designer' },
  { id: 'u-oktay',      name: 'Oktay Şahin',           email: 'oktay@yukselenzeka.com',                        role: 'printer' },
  { id: 'u-atilla',     name: 'Atilla Kılıçkan',       email: 'atilla.kilickan@yukselenzeka.com',              role: 'printer' },
  { id: 'u-esra',       name: 'Esra Kılıç',            email: 'esra@yukselenzeka.com',                         role: 'satis', joined_at: '2026-06-19T00:00:00.000Z' },
]

export const DEMO_PASSWORD_HASH = DEMO_PASSWORD_BCRYPT
