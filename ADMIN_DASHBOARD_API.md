# 📊 Admin Dashboard API Contract

This document details the updated, high-performance response for the Admin Dashboard.

## 📍 Endpoint
`GET /admin/dashboard`

---

## 🏗️ Response Structure
The backend now provides dedicated "pre-filtered" lists and statistics to prevent frontend crashes and improve speed.

```json
{
  "users": [],         // Latest 10 users (Drivers + Owners)
  "trips": [],         // Latest 10 trips
  "payouts": [],       // Latest 10 payout requests
  "settings": {},      // Current system pricing/commission settings

  // 🚀 NEW: Dedicated Pending List (Use this for the "Pending Approval" widget)
  "pendingDrivers": [], 
  "pending": [],        // Alias for compatibility
  "driversPending": [], // Alias for compatibility

  // 📈 NEW: Real-time Statistics
  "stats": {
    "totalDrivers": 0,
    "totalOwners": 0,
    "totalTrips": 0,
    "pendingDriversCount": 0,
    "totalEarnings": 0
  }
}
```

---

## 🛠️ Frontend Migration Guide

### ❌ **Old Way (Don't do this)**
`const pending = dashboard.users.filter(u => u.status === 'PENDING');`
*Why?*: Because `users` is now paginated (limited to 10). If the pending driver is the 11th person, this filter will return an empty list.

### ✅ **New Way (Do this)**
`const pending = dashboard.pendingDrivers;`
*Why?*: Because the backend now looks through the **entire database** to find the pending drivers specifically for you and sends them in this dedicated array.

---

> [!TIP]
> **Realtime Updates**: When a new driver registers, the backend still emits the `admin:driver:pending_approval` event via WebSockets. You should prepend that new driver to the `pendingDrivers` array in your local state.
