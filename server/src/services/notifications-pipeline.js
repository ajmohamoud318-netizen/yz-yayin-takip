/**
 * Project pipeline notifications.
 *
 * Sibling to `notifications.js` (the orchestrator) and
 * `notifications-domains.js` (orders / meetings / handovers / hedef
 * projeler). The project pipeline is its own concern because the volume
 * is high — every project / demo / ozalit / ekran / catalog event flows
 * through here — and the recipient-resolution rules differ from the
 * orders path (e.g. designers get the demo/ozalit ping, but only the
 * requester + relevant leader get the order change-request ping).
 *
 * Each `notifyProject*` / `notifyDemo*` / `notifyOzalit*` /
 * `notifyEkranDemo*` is called from a tx client so a notification is
 * committed iff the state change it describes is committed.
 *
 * Sends the same emit() primitive the rest of the notification system
 * uses; recipient resolution piggy-backs on
 * `loadProjectAssignees` (project + subtask-owner merge) so designers
 * who split a project across Kapak / Kutu / Ses each get their own ping.
 */

import { loadProjectAssignees } from './project-repository.js'
import { activeUserIdsByRole, emit } from './notifications.js'

/**
 * Greetings for a fresh project assignment, picked at random.
 *
 * This is the only notification in the app that OPENS someone's work rather
 * than chasing it, so the copy is deliberately warmer than everything else
 * (the rest stay terse on purpose — "Ozalit teslimi bekleniyor" is a task,
 * not a greeting). Rotating the wording keeps it from going stale for people
 * who get assigned several books a month.
 *
 * Rules for anything added here:
 *  • Never repeat the project title — it is already the bold line directly
 *    above this text in both the bell and the phone lock screen.
 *  • Keep it under ~45 characters. iOS truncates the body to roughly two
 *    short lines on the lock screen, and the punchline must survive.
 *  • Warm, not cutesy. These go to colleagues at work, every single time.
 */
export const ASSIGNMENT_GREETINGS = Object.freeze([
  'Yeni proje sizde ✨ Hadi başlayalım!',
  'Yeni bir kitap sizi bekliyor 📚',
  'Bu kitap size emanet 📖',
  'Yeni proje elinizde, kolay gelsin! 💪',
  'Sıradaki kitap sizin, başarılar! 🌟',
  'Yeni bir sayfa açılıyor ✨',
  'Taze bir proje geldi, sıra sizde! 🎨',
  'Yeni bir tasarım başlıyor ✏️',
  'Güzel işler çıkaralım! 🎯',
  'Yeni proje hazır, ilham dolu olsun 🌱',
])

/** Pick one greeting. Exported so tests can stub the randomness. */
export function pickAssignmentGreeting(rand = Math.random) {
  const i = Math.floor(rand() * ASSIGNMENT_GREETINGS.length)
  // Guard the edges: a rand() that returns exactly 1 (or anything out of
  // range) would index past the end and emit an empty notification body.
  return ASSIGNMENT_GREETINGS[Math.min(Math.max(i, 0), ASSIGNMENT_GREETINGS.length - 1)]
}

/**
 * New project created → tell the assigned designer(s).
 *
 * The greeting is chosen once, here, and stored on the notification row — so
 * it stays put across refreshes and matches whatever the push already
 * delivered. Picking at render time instead would make the same notification
 * say something different every poll.
 */
export async function notifyProjectCreated(client, { project, actor, assignees }) {
  const designerIds = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  return emit(client, {
    recipientIds: designerIds,
    actorId: actor?.id,
    type: 'assignment',
    title: project.title,
    body: pickAssignmentGreeting(),
    tone: 'green',
    projectId: project.id,
    link: `/projects/${project.id}`,
    event: { type: 'project.created', aggregateId: project.id },
  })
}

/**
 * A delivered demo was just marked "Teslim Alındı" (received).
 *
 * Not a stage transition — the project stays at demo_onay — so it can't ride
 * notifyProjectTransition, but it's the event that unblocks the approval, and
 * until now it was silent: whoever didn't click stayed unaware the gate had
 * opened. Either the team leader or an assigned designer can acknowledge, so
 * we fan out to both sides and let emit() drop the actor — "whoever marked it,
 * the other one hears about it".
 *
 * The two sides get different copy on purpose: the leader is the only one who
 * can act on it now (approval is theirs alone at this stage), the designers
 * are just being kept in the loop.
 *
 * ⚠️ Unlike every other notification, the bold `title` line here is the PERSON,
 * not the book — "Aylin / «Kitap» demoyu teslim aldı". These two events are the
 * only ones whose news is *who acted*, and the first thing a phone shows is the
 * title, so leading with the project buried the answer one line down. The book
 * moves into the body, which nothing truncates — long titles survive intact.
 */
export async function notifyDemoReceived(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  const base = {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    event: { type: 'project.demo_received', aggregateId: project.id },
  }
  const a = await emit(client, {
    ...base, recipientIds: leaders, type: 'demo_approval_pending', tone: 'amber',
    body: `${project.title} demoyu teslim aldı, onayınızı bekliyor`,
  })
  const b = await emit(client, {
    ...base, event: null, recipientIds: designers, type: 'demo_received', tone: 'blue',
    body: `${project.title} demoyu teslim aldı, onay bekleniyor`,
  })
  return a + b
}

/**
 * A delivered ozalit was just marked "Teslim Alındı" (received) — the ozalit
 * twin of notifyDemoReceived (migration 035).
 *
 * Ozalit approval is multi-party, but leader-first: acknowledging the proof
 * unblocks the team leaders only, and the assigned designers counter-sign after
 * one of them approves (computeOzalitOnayApproval). So this takes the same
 * split as the demo — leaders are asked to act, designers are kept in the loop
 * — and the designers' "your turn" ping comes later, from the partial-approval
 * branch of notifyProjectTransition. emit() drops the actor, so whoever clicked
 * doesn't get told about their own click.
 */
export async function notifyOzalitReceived(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  const base = {
    // Person as the title, book in the body — see notifyDemoReceived.
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    event: { type: 'project.ozalit_received', aggregateId: project.id },
  }
  const a = await emit(client, {
    ...base, recipientIds: leaders, type: 'ozalit_approval_pending', tone: 'amber',
    body: `${project.title} ozaliti teslim aldı, onayınızı bekliyor`,
  })
  const b = await emit(client, {
    ...base, event: null, recipientIds: designers, type: 'ozalit_received', tone: 'blue',
    body: `${project.title} ozaliti teslim aldı, ekip lideri onayı bekleniyor`,
  })
  return a + b
}

/**
 * The Baskı Onay Formu was just marked "hazırlandı" (prepared) — the maker
 * half of migration 045's dual-approval pair. Only the OTHER active team
 * leaders are told an approval is now owed; the preparer isn't (emit()
 * drops the actor via actorId), and there are no designers/printers in this
 * loop — the checker step is team_leader-only, same as the preparer step.
 */
export async function notifyBaskiOnayPrepared(client, { project, actor, teamLeaderIds }) {
  const leaders = teamLeaderIds ?? (await activeUserIdsByRole(client, 'team_leader'))
  const who = actor?.name ?? 'Ekipten biri'
  return emit(client, {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: leaders, type: 'baski_onay_prepared', tone: 'amber',
    body: `${project.title} için baskı onay formunu hazırladı, onayınız bekleniyor`,
    event: { type: 'project.baski_onay_prepared', aggregateId: project.id },
  })
}

/**
 * The matbaa marked they've begun physical work on a demo/ozalit
 * ("Başladım", migration 048) — flag-only, no stage change. Tells the
 * leader + assigned designers, since it's the signal that free cancel/edit
 * is over and any further change now needs the matbaa's OK.
 */
export async function notifyDemoStarted(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'demo_started', tone: 'blue',
    body: 'Matbaa demo çalışmasına başladı, iptal veya düzenleme artık değişiklik isteği gerektirir',
    event: { type: 'project.demo_started', aggregateId: project.id },
  })
}

export async function notifyOzalitStarted(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'ozalit_started', tone: 'blue',
    body: 'Matbaa ozalit çalışmasına başladı, iptal veya düzenleme artık değişiklik isteği gerektirir',
    event: { type: 'project.ozalit_started', aggregateId: project.id },
  })
}

/**
 * The leader/assigned designer asked the matbaa to accept a cancel/edit
 * (migration 048) — tells the printers, who are the ones who can act.
 */
export async function notifyDemoChangeRequested(client, { project, actor, note }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  const who = actor?.name ?? 'Ekipten biri'
  return emit(client, {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: printers, type: 'demo_change_requested', tone: 'amber',
    body: note
      ? `${project.title} için demoda değişiklik istedi, not: ${note}, kabul veya red bekleniyor`
      : `${project.title} için demoda değişiklik istedi, kabul veya red bekleniyor`,
    event: { type: 'project.demo_change_requested', aggregateId: project.id },
  })
}

export async function notifyOzalitChangeRequested(client, { project, actor, note }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  const who = actor?.name ?? 'Ekipten biri'
  return emit(client, {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: printers, type: 'ozalit_change_requested', tone: 'amber',
    body: note
      ? `${project.title} için ozalitte değişiklik istedi, not: ${note}, kabul veya red bekleniyor`
      : `${project.title} için ozalitte değişiklik istedi, kabul veya red bekleniyor`,
    event: { type: 'project.ozalit_change_requested', aggregateId: project.id },
  })
}

/**
 * The matbaa accepted a pending change-request — tells the requester (and
 * the rest of the leader/designer set) that free cancel/edit is open again.
 */
export async function notifyDemoChangeAccepted(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'demo_change_accepted', tone: 'green',
    body: 'Matbaa değişiklik talebinizi kabul etti, iptal veya düzenleme artık yapılabilir',
    event: { type: 'project.demo_change_accepted', aggregateId: project.id },
  })
}

export async function notifyOzalitChangeAccepted(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'ozalit_change_accepted', tone: 'green',
    body: 'Matbaa değişiklik talebinizi kabul etti, iptal veya düzenleme artık yapılabilir',
    event: { type: 'project.ozalit_change_accepted', aggregateId: project.id },
  })
}

/**
 * The matbaa declined a pending change-request — the requester has to wait
 * for normal delivery and use the existing Reddet flow.
 */
export async function notifyDemoChangeDeclined(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'demo_change_declined', tone: 'rose',
    body: 'Matbaa değişiklik talebinizi reddetti, normal teslim süreci devam ediyor',
    event: { type: 'project.demo_change_declined', aggregateId: project.id },
  })
}

export async function notifyOzalitChangeDeclined(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'ozalit_change_declined', tone: 'rose',
    body: 'Matbaa değişiklik talebinizi reddetti, normal teslim süreci devam ediyor',
    event: { type: 'project.ozalit_change_declined', aggregateId: project.id },
  })
}

/**
 * A demo/ozalit request was cancelled outright (migration 048) — tells the
 * printers, whose pending delivery just disappeared from their queue.
 */
export async function notifyDemoCancelled(client, { project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: printers, type: 'demo_cancelled', tone: 'rose',
    body: 'Demo talebi iptal edildi, tasarıma geri döndü, bekleyen işiniz kalmadı',
    event: { type: 'project.demo_cancelled', aggregateId: project.id },
  })
}

export async function notifyOzalitCancelled(client, { project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: printers, type: 'ozalit_cancelled', tone: 'rose',
    body: 'Ozalit talebi iptal edildi, tasarıma geri döndü, bekleyen işiniz kalmadı',
    event: { type: 'project.ozalit_cancelled', aggregateId: project.id },
  })
}

/**
 * The leader/assigned designer edited a demo/ozalit form that's still
 * sitting with the matbaa (before they started work) — tells the printers
 * the sheet changed so they don't work from stale values.
 */
export async function notifyDemoEdited(client, { project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: printers, type: 'demo_edited', tone: 'amber',
    body: 'Demo formu güncellendi, yeni haliyle inceleyin',
    event: { type: 'project.demo_edited', aggregateId: project.id },
  })
}

export async function notifyOzalitEdited(client, { project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: printers, type: 'ozalit_edited', tone: 'amber',
    body: 'Ozalit formu güncellendi, yeni haliyle inceleyin',
    event: { type: 'project.ozalit_edited', aggregateId: project.id },
  })
}

/**
 * The leader/assigned designer asked for an Ekran Demo Onayı instead of a
 * physical re-demo (migration 050) — tells the team leaders, who are the
 * only ones who can act on it.
 */
export async function notifyEkranDemoRequested(client, { project, actor }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  return emit(client, {
    actorId: actor?.id, title: who, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: leaders, type: 'ekran_demo_requested', tone: 'amber',
    body: `${project.title} için ekran demo onayı istedi, onayınız bekleniyor`,
    event: { type: 'project.ekran_demo_requested', aggregateId: project.id },
  })
}

/**
 * A team leader declined a pending Ekran Demo Onayı — tells the requester
 * (and the rest of the leader/designer set) to fall back to the normal
 * physical Demo İste.
 */
export async function notifyEkranDemoRejected(client, { project, actor, assignees, reason }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project.title, projectId: project.id, link: `/projects/${project.id}`,
    recipientIds: [...leaders, ...designers], type: 'ekran_demo_rejected', tone: 'rose',
    body: reason
      ? `Ekran demo onayı reddedildi: ${reason}, normal demo süreciyle devam edin`
      : 'Ekran demo onayı reddedildi, normal demo süreciyle devam edin',
    event: { type: 'project.ekran_demo_rejected', aggregateId: project.id },
  })
}

/**
 * A project pipeline transition (advance / approve / reject) just committed.
 * `toStage` / `fromStage` / `action` come straight from the history row the
 * route already built. We map the resulting state to the people who now need
 * to know — and skip the actor.
 *
 * `assignees` may be passed by callers that already loaded it (advance /
 * approve / receive routes do); otherwise we resolve it here (reject route).
 */
export async function notifyProjectTransition(client, {
  project, fromStage, toStage, action, actor, assignees,
}) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const printers = await activeUserIdsByRole(client, 'printer')
  const sales = await activeUserIdsByRole(client, 'satis')
  const base = { actorId: actor?.id, title: project.title, projectId: project.id,
    event: { type: 'project.transition', aggregateId: project.id } }

  // Rejection back to Tasarım → the designer has to rework.
  if (action === 'reject' && toStage === 'tasarim') {
    return emit(client, {
      ...base, recipientIds: designers, type: 'rejection', tone: 'rose',
      body: 'Revizyon gerekiyor, tasarıma geri döndü', link: `/projects/${project.id}`,
    })
  }

  // Demo approved but HELD: the leader signed off at <100% progress, so the
  // stage doesn't move and a second demo is owed once the design is finished.
  // Caught before the switch because from === to here — falling through to
  // `demo_onay` would re-send "waiting for your approval" to the very people
  // who have nothing left to approve.
  if (action === 'approve' && toStage === fromStage &&
      (toStage === 'demo_onay' || toStage === 'cin_demo_onay')) {
    return emit(client, {
      ...base, recipientIds: designers, type: 'demo_held', tone: 'amber',
      body: 'Demo onaylandı, tasarım bitince demo gerekiyor', link: `/projects/${project.id}`,
    })
  }

  // One party signed off on the ozalit but the round isn't complete, so the
  // stage stays put (from === to). Caught before the switch for the same reason
  // as the held demo above: `case 'ozalit_onay'` would re-announce the matbaa's
  // delivery to a room that has already taken delivery of it. Whoever still
  // owes an approval is asked for it — and since approval is leader-first, a
  // leader's sign-off is exactly what turns this into the designers' cue.
  if (action === 'approve' && toStage === fromStage && toStage === 'ozalit_onay') {
    const approved = new Set((project.ozalit_approvals ?? []).map((a) => a.id))
    const pending = [...leaders, ...designers].filter((id) => !approved.has(id))
    return emit(client, {
      ...base, recipientIds: pending, type: 'ozalit_approval_pending', tone: 'amber',
      body: `${actor?.name ?? 'Ekipten biri'} ozaliti onayladı, onayınız bekleniyor`,
      link: `/projects/${project.id}`,
    })
  }

  switch (toStage) {
    // Matbaa must deliver the requested demo.
    case 'demo_teslim':
    case 'cin_demo_teslim':
      // ?action=teslim tells ProjectDetail to open the demo form itself on
      // arrival, instead of the printer landing on the page and having to
      // find the "Teslim Edin" button — the printer's whole job here IS the
      // form, so skip the extra tap.
      return emit(client, {
        ...base, recipientIds: printers, type: 'demo_delivery_pending', tone: 'blue',
        body: 'Demo teslimi bekleniyor', link: `/projects/${project.id}?action=teslim`,
      })

    // Matbaa delivered the demo. NOT an approval ping: nobody can approve yet
    // — computeApproval refuses until the delivery is marked "Teslim Alındı",
    // and that acknowledgement is the leader's OR an assigned designer's to
    // give. Telling a designer "your approval is awaited" named an action they
    // don't have; the approval ping is sent later, by notifyDemoReceived().
    case 'demo_onay':
    case 'cin_demo_onay':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'demo_receipt_pending', tone: 'amber',
        body: 'Matbaa demoyu teslim etti, "Teslim Alındı" bekleniyor', link: `/projects/${project.id}`,
      })

    // Reaching ozalit_teslim: either the demo was just approved (designer may
    // now request ozalit), the designer requested ozalit (matbaa must
    // deliver), or a reject/not-received sent it back locked to the matbaa
    // for redelivery (no fresh request needed — same as demo's teslim case).
    case 'ozalit_teslim':
      if (project.ozalit_requested || project.reject_target === 'matbaa') {
        // Same ?action=teslim handoff as demo_teslim above.
        return emit(client, {
          ...base, recipientIds: printers, type: 'ozalit_delivery_pending', tone: 'blue',
          body: 'Ozalit teslimi bekleniyor', link: `/projects/${project.id}?action=teslim`,
        })
      }
      return emit(client, {
        ...base, recipientIds: designers, type: 'ozalit_requestable', tone: 'blue',
        body: 'Demo onaylandı, ozalit isteyebilirsiniz', link: `/projects/${project.id}`,
      })

    // Matbaa delivered the ozalit. Like the demo case above, this is NOT an
    // approval ping: since migration 035 computeOzalitOnayApproval refuses
    // until the proof is marked "Teslim Alındı". The approval ping follows
    // from notifyOzalitReceived once someone acknowledges it.
    case 'ozalit_onay':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'ozalit_receipt_pending', tone: 'amber',
        body: 'Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor', link: `/projects/${project.id}`,
      })

    // Everyone signed off on the ozalit (TR) / the demo (ÇİN, migration 047's
    // cin_baski_onay mirror gate) — a team leader now needs to PREPARE the
    // Baskı Onay Formu (migration 045's maker half); every active leader is
    // told, since any one of them may do it.
    case 'baski_onay':
    case 'cin_baski_onay':
      return emit(client, {
        ...base, recipientIds: leaders, type: 'baski_onay_pending', tone: 'amber',
        body: toStage === 'cin_baski_onay'
          ? 'Demo onaylandı, baskı onay formu hazırlanması bekleniyor'
          : 'Ozalit onaylandı, baskı onay formu hazırlanması bekleniyor',
        link: `/projects/${project.id}`,
      })

    // Baskı onayı approved (both pipelines, migration 047) → matbaa is IN
    // PRINT immediately, no separate "take into production" step anymore.
    //
    // Split by role because the destination is not the same for both, and a
    // link the recipient can't open is worse than no link: /baski-listesi is
    // guarded to `printer`, so a team leader tapping that push was bounced
    // straight back to the dashboard. Printers get the queue they act on;
    // leaders + designers get the project itself, which they can always open.
    // Assigned designers are included because for a ÇİN project this stage IS
    // the "your book cleared the print gate" moment; TR designers hear it at
    // ozalit_teslim instead, but a second confirmation is harmless.
    case 'baskida': {
      const ready = { ...base, tone: 'green' }
      const a = await emit(client, {
        ...ready, recipientIds: printers, type: 'production_ready',
        body: 'Proje baskıda alındı', link: '/baski-listesi',
      })
      const b = await emit(client, {
        ...ready, event: null, recipientIds: [...leaders, ...designers], type: 'in_production',
        body: 'Baskıya alındı', link: `/projects/${project.id}`,
      })
      return a + b
    }

    case 'gumruk':
      return emit(client, {
        ...base, recipientIds: leaders, type: 'in_customs', tone: 'blue',
        body: 'Gümrük aşamasında', link: `/projects/${project.id}`,
      })

    case 'satista':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers, ...sales], type: 'on_sale', tone: 'pink',
        body: 'Satışa çıktı 🎉', link: `/projects/${project.id}`,
      })

    default:
      return 0
  }
}

/**
 * A project was soft-deleted. Whoever might have it queued — the assigned
 * designer(s), active printers (a demo/ozalit delivery could be sitting in
 * their queue), and the other active team leaders — get told it's gone,
 * instead of just finding it silently missing from their lists next time
 * they act on it.
 *
 * Team leaders are linked to "Silinen Projeler" since they're the ones who can
 * restore it. Designers/printers can't reach that page, and the project detail
 * 404s once deleted — so they go to the project LIST instead.
 *
 * Note the explicit link rather than leaving it null: both the bell and
 * `buildPayload` fall back to `/projects/<id>` whenever a notification carries
 * a project id, so "no link" quietly became "link to the deleted project" —
 * a tap that 404s. If you ever want a genuinely inert notification, the
 * fallback has to change too.
 */
export async function notifyProjectDeleted(client, { project, actor, assignees }) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const printers = await activeUserIdsByRole(client, 'printer')
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const base = {
    actorId: actor?.id, title: project.title, projectId: project.id,
    type: 'project_deleted', tone: 'rose', body: 'Proje silindi',
    event: { type: 'project.deleted', aggregateId: project.id },
  }
  const a = await emit(client, { ...base, recipientIds: [...designers, ...printers], link: '/projects' })
  const b = await emit(client, { ...base, event: null, recipientIds: leaders, link: '/deleted-projects' })
  return a + b
}

/**
 * A product was taken out of the Ürünler catalog ("kaldırıldı"), or put back.
 *
 * Sales is the audience that actually loses/regains something here: the product
 * simply stops appearing in their catalog, and an order they were about to
 * raise now 400s. Telling them beats letting the row vanish silently.
 *
 * Other team leaders are copied because catalog membership is shared state —
 * the same reason `notifyProjectDeleted` copies them. Designers and printers
 * are NOT: delisting changes nothing about the production work they own.
 *
 * The link goes to /urunler either way; a delisted product still shows there
 * for the leader, and for Sales the page is where they'd notice the change.
 */
export async function notifyProductCatalogChanged(client, { project, actor, hidden }) {
  const sales = await activeUserIdsByRole(client, 'satis')
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    recipientIds: [...sales, ...leaders],
    actorId: actor?.id,
    title: project.title,
    projectId: project.id,
    type: hidden ? 'product_delisted' : 'product_relisted',
    tone: hidden ? 'amber' : 'green',
    body: hidden
      ? 'Ürün katalogdan kaldırıldı, baskı verilemez'
      : 'Ürün katalogda tekrar yayında',
    link: '/urunler',
    event: { type: hidden ? 'product.delisted' : 'product.relisted', aggregateId: project.id },
  })
}
