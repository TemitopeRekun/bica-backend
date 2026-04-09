# 🚀 Bica Frontend Migration Summary

This document summarizes the major breaking changes and security hardening implemented in the Backend today. Please share this with the mobile team immediately.

---

## 1. 🔐 Registration Hardening (Strict DTO)
**Endpoint**: `POST /auth/register`

We have moved to a **Strict Whitelist** model for production security.
- **Breaking Change**: Fields like `id`, `rating`, `trips`, and `avatar` are now **FORBIDDEN** in the signup payload. Sending them will result in a `400 Bad Request`.
- **Naming Standard**: Document fields must strictly use the `ImageUrl` suffix:
    - ✅ `licenseImageUrl`
    - ✅ `ninImageUrl`
    - ✅ `selfieImageUrl`

---

## 🛡️ 2. Admin Banking Guard (New Workflow)
**Action**: Approving a Driver

The system now enforces a "Banking First" rule to prevent payment failures in production.
- **Rule**: You **CANNOT** approve a driver (`status: APPROVED`) unless their Monnify sub-account is active.
- **Error**: If you try to approve an unbanked driver, the backend returns a `400` error: *"Monnify sub-account must be created first."*
- **Solution**: Admins must click the new **"Retry Sub-Account"** button (`POST /admin/users/:id/retry-subaccount`) and see a success message before clicking "Approve."

---

## 📊 3. Dashboard Data Evolution
**Endpoint**: `GET /admin/dashboard`

The dashboard structure is now high-performance and "Empty-Safe":
- **Paging**: `users`, `trips`, and `payouts` now return the **latest 10 items** only. Do not rely on filtering these lists for "Pending" items.
- **New Lists**: Use the dedicated `pendingDrivers` array for the approval widget.
- **New Stats**: Use the `stats` object for summary counters (Earnings, Total Users, etc.).

---

## 🛠️ 4. Quick Reference: New Endpoints
| Feature | Method | URL |
| :--- | :--- | :--- |
| **Manual Bank Setup** | `POST` | `/admin/users/:id/retry-subaccount` |
| **System Settings** | `GET` | `/admin/settings` (For pricing/commission) |

---

> [!IMPORTANT]
> **Production Note**: All these changes are live on the dev server. Please ensure the mobile app's `SignUpScreen.tsx` is updated to remove system-generated fields before the next build.
