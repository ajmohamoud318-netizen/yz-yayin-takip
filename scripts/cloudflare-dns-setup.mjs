#!/usr/bin/env node
/**
 * One-shot Cloudflare DNS setup for the YZ Yayın Takip backend.
 *
 * What it does:
 *   1. Lists existing A records in the mucitkarinca.com zone.
 *   2. Deletes any stray `api.mucitkarinca.com` A record (from the wrong
 *      earlier attempt).
 *   3. Creates `api.yt.mucitkarinca.com` → 46.62.170.64 (Proxied).
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-dns-setup.mjs
 *
 * The token needs Zone → DNS → Edit on the mucitkarinca.com zone.
 * Create one at https://dash.cloudflare.com/profile/api-tokens with the
 * "Edit zone DNS" template, scoped to mucitkarinca.com.
 */

const ZONE_NAME = 'mucitkarinca.com'
const RECORD_NAME = 'api.yt.mucitkarinca.com'
const TARGET_IP = '46.62.170.64'

const TOKEN = process.env.CLOUDFLARE_API_TOKEN
if (!TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN env var.')
  console.error('Create a token at https://dash.cloudflare.com/profile/api-tokens')
  console.error('with Zone → DNS → Edit on mucitkarinca.com, then re-run.')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

async function cf(path, opts = {}) {
  const url = `https://api.cloudflare.com/client/v4${path}`
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    throw new Error(`Cloudflare ${path} → ${res.status}: ${JSON.stringify(body.errors || body)}`)
  }
  return body.result
}

async function findZone() {
  const zones = await cf(`/zones?name=${ZONE_NAME}`)
  if (!zones.length) throw new Error(`Zone ${ZONE_NAME} not found in this account.`)
  return zones[0]
}

async function listARecords(zoneId) {
  return cf(`/zones/${zoneId}/dns_records?type=A`)
}

async function deleteRecord(zoneId, id) {
  return cf(`/zones/${zoneId}/dns_records/${id}`, { method: 'DELETE' })
}

async function createRecord(zoneId, name, ip) {
  return cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'A',
      name,
      content: ip,
      proxied: true,
      ttl: 1, // Auto
    }),
  })
}

async function main() {
  const zone = await findZone()
  console.log(`✓ Found zone ${zone.name} (id=${zone.id})`)

  const records = await listARecords(zone.id)
  console.log(`  ${records.length} A records currently in the zone:`)
  for (const r of records) console.log(`    - ${r.name} → ${r.content} (proxied=${r.proxied})`)

  // Clean up: delete any stray api.mucitkarinca.com (the wrong earlier attempt)
  const stray = records.filter(r => r.name === 'api.mucitkarinca.com' && r.content === TARGET_IP)
  for (const r of stray) {
    console.log(`  ✗ Deleting stray record ${r.name} → ${r.content}`)
    await deleteRecord(zone.id, r.id)
  }

  // Check the target record
  const existing = records.find(r => r.name === RECORD_NAME)
  if (existing) {
    if (existing.content === TARGET_IP && existing.proxied) {
      console.log(`✓ ${RECORD_NAME} already points at ${TARGET_IP} (proxied). Nothing to do.`)
    } else {
      console.log(`  ⟳ Updating ${RECORD_NAME}: ${existing.content} (proxied=${existing.proxied}) → ${TARGET_IP} (proxied=true)`)
      await cf(`/zones/${zone.id}/dns_records/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ type: 'A', name: RECORD_NAME, content: TARGET_IP, proxied: true, ttl: 1 }),
      })
      console.log(`✓ Updated.`)
    }
  } else {
    console.log(`  + Creating ${RECORD_NAME} → ${TARGET_IP} (proxied)`)
    await createRecord(zone.id, RECORD_NAME, TARGET_IP)
    console.log(`✓ Created.`)
  }

  console.log('\nDone. Verify with:')
  console.log(`  dig +short ${RECORD_NAME}`)
}

main().catch(err => {
  console.error('✗', err.message)
  process.exit(1)
})
