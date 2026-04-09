# Frontend Integration Guide: Ride Synchronization & Timeline

This document explains the WebSocket and Lifecycle synchronization model between the Bica Driver and Owner applications.

## 1. WebSocket Infrastructure
- **Namespace**: `/rides`
- **Room System**: Every user (Driver or Owner) MUST join their private room upon connection to receive targeted events.
  - **Event**: `owner:register` or `driver:register`
  - **Payload**: `{ ownerId: string }` or `{ driverId: string }`
  - **Result**: Backend joins the socket to room `user:${userId}`.

## 2. The "Sync-Burst" Strategy
To prevent the UI from getting "stuck" due to network glitches, the backend now employs a **Sync-Burst** strategy. Instead of sending a single state change, the server broadcasts redundant signals to ensure the UI "unlocks" regardless of its current state.

### Key Example: Driver Arrives
If a Driver arrives before the Owner app has processed the "Acceptance" screen:
1.  **Signal A**: `ride:accepted` (Forces the Owner's Search screen to close)
2.  **Signal B**: `ride:progress` (milestone: `arrived`) (Updates the timeline dots)
3.  **Signal C**: `trip:status` (status: `ARRIVED`) (Generic state update)

## 3. Core Event Map

| Event Name | Recipient | Payload Category | Trigger Case |
| :--- | :--- | :--- | :--- |
| `ride:request` | Driver | New Trip Data | **New!** Use this to trigger the Accept/Decline popup. |
| `ride:assigned` | Driver | New Trip Data | Standard assignment event (Legacy fallback). |
| `ride:accepted` | Owner | Driver Info | Moves Owner from "Searching" to "Driver Assigned". |
| `ride:progress`| Owner | `{ milestone: string }`| **Critical!** Drives the timeline dots (`assigned`, `arrived`, `inprogress`, `completed`). |
| `ride:cancelled`| Driver | `{ tripId: string }` | **New!** Instantly clears any pending request card from the driver app. |
| `trip:status` | Both | Full Trip Object | Generic sync event fired on every state change. |

## 4. State Resilience (Backend Logic)
The backend now supports **"Fail-Forward"** and **"Idempotent Updates"**:

### Handle State Jumps
If the frontend is on the "Assigned" screen but receives a `trip:status` of `IN_PROGRESS`, it should jump directly to the "Active Trip" screen. Avoid strict sequential state requirements in the UI.

### Stale Update Handling (HTTP 400)
If a driver app attempts to send an `ARRIVED` status but the trip is already `IN_PROGRESS` on the server, the server will now return a **200 OK** with the advanced state. The frontend should use this response to immediately refresh its local state.

## 5. Timeline Milestones (`ride:progress`)
The `ride:progress` event is the primary source of truth for the **Owner's Timeline Progress**.
- `assigned`: Driver has accepted.
- `arrived`: Driver is at the pickup location.
- `inprogress`: Trip has started.
- `completed`: Trip ended; transition to Payment.
