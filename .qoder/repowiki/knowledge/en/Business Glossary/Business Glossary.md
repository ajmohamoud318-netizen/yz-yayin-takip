---
kind: business_term
name: Business Glossary
category: business_term
scope:
    - '**'
---

### YZ Yayın Takip
- Definition：The project name — a full-stack publishing workflow tracker for YZ Yayın, covering projects, print orders, demos/ozalit approvals, handovers, meetings, and team collaboration.
- Aliases：Yayin Takip、YT

### Ozalit
- Definition：A proof/sample approval step in the print-order pipeline (the Turkish term for a physical or digital sample that must be approved before printing). Migrated from single to multi-party approval across multiple stages.
- Aliases：demo ozalit、ozalit onayı

### Matbaa
- Definition：The 'printing house' stage in the order lifecycle — the phase where an order is handed off to the printer for production.
- Aliases：matbaa aşaması

### Baskı Onayı
- Definition：Print approval workflow — a dual/multi-party sign-off gate required before an order proceeds to the matbaa stage.
- Aliases：baskı onay、print approval

### Teslim Talebi / Teslim Onayı
- Definition：Handover request and handover approval — the workflow around delivering completed work to the next party in the chain.
- Aliases：handover、delivery request

### Hedef Proje Fikri
- Definition：Target project idea — a prospective project concept captured before it becomes a real project, with optional images and details.
- Aliases：target project idea

### X-User-Id header auth
- Definition：Development-only trust model where the server accepts a caller-supplied `X-User-Id` header as the authenticated identity instead of cookies or OAuth; gated behind `TRUST_HEADER_AUTH` and intended to be disabled once real cookie/OAuth sessions are deployed.
- Aliases：header auth、trusted header

### Dokploy
- Definition：The deployment platform used in production; it supplies environment variables (including DATABASE_URL, CORS_ORIGINS, etc.) and resolves internal service slugs for inter-service communication.
