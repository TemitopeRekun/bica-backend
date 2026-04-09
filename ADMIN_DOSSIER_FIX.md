# 🔧 Admin Dossier — Backend Fix & UX Guidance

This document explains the root cause of the "sub-account missing" bug and provides specific guidance for the frontend team.

---

## 🐛 Root Cause: Missing Banking Data in User Dossier

### What happened?
The `GET /users/:id` endpoint (used to load the Dossier modal) was **not returning any banking fields**. The frontend had no data to evaluate, so it defaulted to "sub-account missing" — even when one existed in the database.

### What was fixed (Backend)?
`findOne()` now returns the full banking picture:

```json
{
  "id": "...",
  "name": "Temitope Ogunrekun",
  "approvalStatus": "PENDING",

  // NOW AVAILABLE:
  "bankName": "GTBank",
  "bankCode": "058",
  "accountNumber": "012345xxxx",
  "accountName": "Temitope Ogunrekun",
  "monnifySubAccountCode": "MFY_SUB_xxxxx",

  // Computed flags — use THESE to drive your UI:
  "subAccountActive": true,
  "canRetrySubAccountSetup": false
}
```

---

## ✅ Frontend Action Items

### 1. Fix the Dossier Banking Banner
Use `subAccountActive` (not absence of `monnifySubAccountCode`) to decide what to show:

```typescript
// ✅ Correct
if (driver.subAccountActive) {
  show("✅ Monnify account active — ready to approve")
} else if (driver.canRetrySubAccountSetup) {
  show("⚠️ Sub-account missing — show Retry button")
} else {
  show("❌ Bank details incomplete — cannot create sub-account")
}
```

### 2. Show the Retry Button
Only show the **Retry Sub-Account** button when `canRetrySubAccountSetup === true`.
After the retry succeeds, the backend returns `{ subAccountActive: true }` — use this to update local state **immediately** (don't wait for a full dashboard reload).

### 3. Remove Redundant Buttons
The "Review Required" and "Review & Approve" actions are the same workflow. Consolidate to a single **"Open Dossier"** action that opens the modal, then let the state of `subAccountActive` determine whether the Approve button is enabled or greyed out.

---

## 📱 Mobile Friendliness Checklist

Since this is a **mobile-first app**, the Admin Dossier modal must:

- [ ] Use a **bottom sheet** instead of a centered modal (friendlier on small screens)
- [ ] Make document images (`licenseImageUrl`, etc.) full-width and tappable to zoom
- [ ] The **Approve / Reject / Block** action buttons must be at the **bottom** of the screen (thumb-reachable zone)
- [ ] The banking status banner (`subAccountActive`) should be a clear green/red pill chip, not just text
- [ ] The **Retry** button must have a loading spinner while the `POST /admin/users/:id/retry-subaccount` call is in-flight

---

> [!IMPORTANT]
> **After the retry succeeds**, do NOT refetch the entire dashboard. Instead, locally patch the driver object in your state:
> ```typescript
> setDriver(prev => ({ ...prev, subAccountActive: true, canRetrySubAccountSetup: false }))
> ```
> This eliminates the stale UI problem.
