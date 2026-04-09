# Payment Wiring Guide (SSOT Overhaul)

## Overview
We have transitioned to a **Single Source of Truth (SSOT)** pricing architecture. Hardcoded backend logic has been removed and replaced with a dynamic, database-driven engine.

## 🚀 Key Changes for Frontend

### 1. New Dashboard Controls (Admin)
The `Admin` dashboard can now control "Minimum Fare" logic. Ensure the following fields are wired in the Settings UI:
- `minimumFare`: The absolute floor price for any trip (e.g., 500 Naira).
- `minimumFareDistance`: The distance threshold where the minimum fare applies (e.g., 4.5 km).

### 2. The Snapshot Strategy
Pricing variables are now **snapshotted** (locked) the moment a `Trip` is created.
- **Why?** This prevents "Price Leaks." If an admin changes the Base Fare while a user is in a ride, that user is NOT affected.
- **Field Names**: The `Trip` object now includes `baseFareSnapshot`, `pricePerKmSnapshot`, etc. Use these for your "Receipt" or "History" views to show the rates agreed upon at the start.

### 3. Fare Breakdown Consistency
The backend now returns a `fareBreakdown` object in the trip response.
- **Frontend Action**: Stop performing manual math on the phone. Always use the `amount` or `fareBreakdown` returned by the API.

## 📡 API Integration Notes
- **`GET /admin/dashboard`**: Now returns `minimumFare` and `minimumFareDistance`.
- **`PATCH /admin/settings`**: Accepts the new fields.
- **`POST /rides`**: The returned `amount` is now derived from the dynamic engine.

---
> [!TIP]
> **Rounding Rule**: The backend rounds all fares to the **nearest 100**. Ensure your UI doesn't try to show more precision than the server provides.
