# BICA Backend API Guide

This guide documents the backend contract the frontend should use for the current codebase.

## Base URL

- Local API base URL: `http://localhost:3001`
- Socket.IO rides namespace: `http://localhost:3001/rides`
- Socket.IO admin namespace: `http://localhost:3001/admin`

## Global Backend Behavior

- HTTP server: NestJS + Fastify
- Validation: global `ValidationPipe`
- Extra request fields are rejected
- Unknown body/query fields can trigger `400 Bad Request`
- CORS currently allows:
- `http://localhost:3000`
- `http://localhost:5173`

## Authentication

- Protected routes require `Authorization: Bearer <token>`
- JWT payload shape:

```ts
type JwtPayload = {
  sub: string;
  email: string;
  role: 'OWNER' | 'DRIVER' | 'ADMIN';
};
```

- `CurrentUser()` inside controllers resolves to that JWT payload

## Core Enums

```ts
type UserRole = 'OWNER' | 'DRIVER' | 'ADMIN';

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type TripStatus =
  | 'PENDING'
  | 'SEARCHING'
  | 'PENDING_ACCEPTANCE'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'SCHEDULED'
  | 'DECLINED';

type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED';
```

## Common Models Returned By The API

```ts
type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  rating: number;
  totalTrips: number;
  avatarUrl: string | null;
  walletBalance: number;
  isBlocked: boolean;
  isOnline: boolean;
  carType: string | null;
  carModel: string | null;
  carYear: string | null;
  gender: string | null;
  address: string | null;
  nationality: string | null;
  age: string | null;
  nin: string | null;
  transmission: string | null;
  approvalStatus: ApprovalStatus | null;
  licenseImageUrl: string | null;
  ninImageUrl: string | null;
  selfieImageUrl: string | null;
  backgroundCheckAccepted: boolean;
  locationLat: number | null;
  locationLng: number | null;
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  monnifySubAccountCode: string | null;
  createdAt: string;
  updatedAt: string;
};
```

```ts
type LocationResult = {
  id: string;
  display_name: string;
  description: string;
  lat: number;
  lon: number;
  category: string;
};
```

```ts
type Trip = {
  id: string;
  status: TripStatus;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destAddress: string;
  destLat: number;
  destLng: number;
  amount: number;
  distanceKm: number;
  commissionAmount: number;
  driverEarnings: number;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  startedAt: string | null;
  estimatedMins: number | null;
  finalFare: number | null;
  fareBreakdown: Record<string, unknown> | null;
  paymentStatus: PaymentStatus;
  monnifyTxRef: string | null;
  paidAt: string | null;
  ownerId: string;
  driverId: string | null;
};
```

## Auth Endpoints

### `POST /auth/register`

Registers a new user and immediately returns a token.

Request body:

```ts
type RegisterRequest = {
  name: string;
  email: string;
  phone: string;
  password: string; // min length 6
  role: 'OWNER' | 'DRIVER' | 'ADMIN';
  carType?: string;
  carModel?: string;
  carYear?: string;
  gender?: string;
  address?: string;
  nationality?: string;
  age?: string;
  nin?: string;
  transmission?: string;
  bankName?: string;
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
};
```

Notes:

- If `role === 'DRIVER'`, these are required at runtime even though the DTO marks them optional:
- `bankName`
- `bankCode`
- `accountNumber`
- `accountName`
- Drivers are created with `approvalStatus: 'PENDING'`
- Owners are created with `approvalStatus: 'APPROVED'`
- Driver sub-account creation happens asynchronously after registration

Response:

```ts
type AuthResponse = {
  token: string;
  user: User;
};
```

### `POST /auth/login`

Request body:

```ts
type LoginRequest = {
  email: string;
  password: string; // min length 6
};
```

Response:

```ts
type AuthResponse = {
  token: string;
  user: User;
};
```

### `GET /auth/me`

Auth required: yes

Response:

```ts
type MeResponse = User;
```

## Users Endpoints

All `/users` routes are protected by auth. Some also require roles.

### `GET /users`

Auth required: yes

Role required: `ADMIN`

Optional query:

```ts
type GetUsersQuery = {
  role?: UserRole;
};
```

Response:

```ts
type GetUsersResponse = User[];
```

### `GET /users/drivers/available`

Auth required: yes

Accessible by: any authenticated user

Query params:

```ts
type AvailableDriversQuery = {
  pickupLat?: string; // parsed to number
  pickupLng?: string; // parsed to number
  transmission?: string; // typically 'Manual' or 'Automatic'
};
```

Behavior:

- Returns only drivers who are:
- `role === DRIVER`
- `approvalStatus === APPROVED`
- `isBlocked === false`
- `isOnline === true`
- have both `locationLat` and `locationLng`
- have no active trip in `PENDING_ACCEPTANCE`, `ASSIGNED`, or `IN_PROGRESS`
- If `pickupLat` and `pickupLng` are passed, results are sorted nearest-first
- Transmission filtering currently allows:
- `Manual` request: drivers with `Manual` or `Both`
- `Automatic` request: drivers with `Automatic`, `Both`, or `null`

Response:

```ts
type AvailableDriver = {
  id: string;
  name: string;
  rating: number;
  totalTrips: number;
  avatarUrl: string | null;
  transmission: string | null;
  locationLat: number | null;
  locationLng: number | null;
  distanceKm: number | null;
  estimatedArrivalMins: number | null;
};

type AvailableDriversResponse = AvailableDriver[];
```

Frontend note:

- This is the main endpoint owners should use to show selectable nearby drivers

### `GET /users/:id`

Auth required: yes

Role required: `ADMIN`

Response:

```ts
type GetUserResponse = User;
```

### `PATCH /users/:id/approval`

Auth required: yes

Role required: `ADMIN`

Request body:

```ts
type UpdateApprovalRequest = {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
};
```

Response:

```ts
type UpdateApprovalResponse = {
  id: string;
  name: string;
  approvalStatus: ApprovalStatus;
};
```

### `PATCH /users/:id/block`

Auth required: yes

Role required: `ADMIN`

Request body:

```ts
type ToggleBlockRequest = {
  isBlocked: boolean;
};
```

Response:

```ts
type ToggleBlockResponse = {
  id: string;
  name: string;
  isBlocked: boolean;
};
```

### `PATCH /users/location`

Auth required: yes

Role required: `DRIVER`

Request body:

```ts
type UpdateLocationRequest = {
  lat?: number | null;
  lng?: number | null;
};
```

Validation notes:

- If supplied, `lat` must be between `-90` and `90`
- If supplied, `lng` must be between `-180` and `180`
- DTO allows optional values; current service writes whatever is sent

Response:

```ts
type UpdateLocationResponse = {
  id: string;
  locationLat: number | null;
  locationLng: number | null;
};
```

Frontend note:

- Updating location through HTTP is what affects driver discoverability for ride matching
- Socket `driver:location` is for live tracking events, not database persistence

### `PATCH /users/online`

Auth required: yes

Role required: `DRIVER`

Request body:

```ts
type UpdateOnlineStatusRequest = {
  isOnline: boolean;
};
```

Response:

```ts
type UpdateOnlineStatusResponse = {
  id: string;
  name: string;
  isOnline: boolean;
  locationLat: number | null;
  locationLng: number | null;
};
```

Backend side effects:

- Updates `user.isOnline`
- Emits websocket presence events:
- `driver:online` or `driver:offline` to the driver socket if registered
- `driver:availability` broadcast on the rides namespace

Frontend note:

- Toggling online does not create a new socket connection
- The frontend should not expect a fresh `Client connected` log from the backend on toggle alone

## Locations Endpoints

These routes are public and do not require auth.

### `GET /locations/search`

Query params:

```ts
type SearchLocationsQuery = {
  q: string; // minimum length 2
  biasLat?: string;
  biasLng?: string;
};
```

Behavior:

- For normal search text, backend uses Google Places Autocomplete
- For category-like queries such as `hotel`, `shopping mall`, `restaurant`, `airport`, backend uses nearby text search
- If `biasLat` and `biasLng` are provided, nearby category search is centered around them
- Search results are cached in Redis

Response:

```ts
type SearchLocationsResponse = LocationResult[];
```

Frontend note:

- For “destination category” chips like hotels or shopping malls, pass the current pickup/current location as `biasLat` and `biasLng`
- That gives closer results instead of broad Lagos-wide matches

### `GET /locations/reverse`

Query params:

```ts
type ReverseGeocodeQuery = {
  lat: string;
  lng: string;
};
```

Response:

```ts
type ReverseGeocodeResponse = LocationResult;
```

Behavior:

- Returns a best-effort readable current location
- Falls back to:

```ts
{
  id: `gps_${lat}_${lng}`,
  display_name: 'Current Location',
  description: '<lat>, <lng>',
  lat,
  lon: lng,
  category: 'Residential'
}
```

### `GET /locations/route`

Query params:

```ts
type RouteQuery = {
  originLat: string;
  originLng: string;
  destLat: string;
  destLng: string;
};
```

Response:

```ts
type RouteResponse = {
  distanceKm: number;
  estimatedMins: number;
  currentTrafficMins: number;
  fareEstimate: {
    low: number;
    high: number;
  };
};
```

Frontend note:

- Use this after pickup and destination are selected
- Send `distanceKm` and `estimatedMins` from this response into ride creation

## Rides Endpoints

All `/rides` routes are protected by auth and role checks are endpoint-specific.

### `POST /rides`

Auth required: yes

Role required: `OWNER`

Request body:

```ts
type CreateRideRequest = {
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destAddress: string;
  destLat: number;
  destLng: number;
  distanceKm: number;
  estimatedMins?: number;
  scheduledAt?: string; // ISO date string
  transmission?: string;
  driverId: string;
};
```

Behavior:

- The owner must choose a specific `driverId`
- Backend re-checks that the chosen driver:
- exists
- is online
- has no active assigned/in-progress/pending-acceptance trip
- Trip is created with `status: 'PENDING_ACCEPTANCE'`
- Backend emits `ride:assigned` to the selected driver socket
- Backend starts a 60 second auto-decline timer

Response:

```ts
type CreateRideResponse = Trip & {
  owner: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
    rating: number;
    transmission: string | null;
  } | null;
  estimatedArrivalMins: number | null;
};
```

Frontend note:

- If backend responds with `This driver is no longer online`, refresh available drivers and ask the owner to pick again

### `GET /rides/history`

Auth required: yes

Accessible by: any authenticated user

Behavior:

- `ADMIN`: all trips
- `DRIVER`: trips where `driverId === current user`
- `OWNER`: trips where `ownerId === current user`

Response:

```ts
type RideHistoryResponse = Array<
  Trip & {
    owner: {
      id: string;
      name: string;
      avatarUrl: string | null;
    };
    driver: {
      id: string;
      name: string;
      avatarUrl: string | null;
    } | null;
  }
>;
```

### `POST /rides/:id/accept`

Auth required: yes

Intended caller: assigned driver

Response:

```ts
type AcceptRideResponse = Trip & {
  owner: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
    rating: number;
    transmission: string | null;
  } | null;
};
```

Backend side effect:

- Emits `ride:accepted` to owner socket

### `POST /rides/:id/decline`

Auth required: yes

Intended caller: assigned driver

Response:

```ts
type DeclineRideResponse = {
  message: string;
};
```

Backend side effect:

- Emits `ride:declined` to owner socket

### `GET /rides/:id`

Auth required: yes

Accessible by: trip owner or trip driver only

Response:

```ts
type GetRideResponse = Trip & {
  owner: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
    rating: number;
  } | null;
};
```

### `PATCH /rides/:id/status`

Auth required: yes

Used mainly by driver, with some owner/admin cases based on status.

Request body:

```ts
type UpdateRideStatusRequest = {
  status: TripStatus;
};
```

Allowed transitions currently enforced:

- `PENDING_ACCEPTANCE -> ASSIGNED | DECLINED`
- `ASSIGNED -> IN_PROGRESS | CANCELLED`
- `IN_PROGRESS -> COMPLETED`
- `SEARCHING -> CANCELLED`

Important permission rules:

- `IN_PROGRESS` and `COMPLETED`: driver or admin only
- `CANCELLED`: owner or admin only

Response:

```ts
type UpdateRideStatusResponse = Trip & {
  driver: {
    id: string;
    name: string;
    walletBalance: number;
  } | null;
  owner: {
    id: string;
    name: string;
  };
  fareBreakdown: {
    baseFare: number;
    distanceKm: number;
    distanceComponent: number;
    timeComponent: number;
    totalMins: number;
    estimatedMins: number | null;
    actualMins: number;
    finalFare: number;
    driverEarnings: number;
    commissionAmount: number;
  } | null;
};
```

Backend side effects on completion:

- sets `completedAt`
- calculates final fare using `baseFare + (distanceKm * pricePerKm) + (actualMins * timeRate)`
- updates `amount`, `finalFare`, `commissionAmount`, `driverEarnings`
- increments driver `walletBalance`
- increments `totalTrips` for driver and owner
- emits `trip:completed` to owner socket

### `POST /rides/:id/cancel`

Auth required: yes

Intended caller: owner

Response:

- Same shape as `PATCH /rides/:id/status`

## Payments Endpoints

### `GET /payments/banks`

Auth required: no

Response:

```ts
type Bank = {
  name: string;
  code: string;
};

type BanksResponse = Bank[];
```

Frontend note:

- Use this to populate driver bank selection during registration

### `POST /payments/webhook`

Auth required: no

Intended caller: Monnify only

Frontend note:

- Frontend should never call this route

Response:

```ts
type WebhookAckResponse = {
  status: 'received';
};
```

### `POST /payments/initiate/:tripId`

Auth required: yes

Role required: `OWNER`

Behavior:

- Only the trip owner can initiate
- Trip must already be `COMPLETED`
- Trip must not already be paid
- Driver must have `monnifySubAccountCode`

Response:

```ts
type InitiatePaymentResponse = {
  checkoutUrl: string;
  transactionReference: string;
  amount: number;
  driverEarnings: number;
  platformEarnings: number;
};
```

Frontend flow:

1. Owner completes ride flow.
2. Call this endpoint.
3. Redirect or open `checkoutUrl`.
4. After payment, refresh ride/payment history as needed.

### `GET /payments/wallet`

Auth required: yes

Role required: `DRIVER`

Response:

```ts
type WalletSummaryResponse = {
  name: string;
  currentBalance: number; // internal cleared-earnings tracker for the current period
  totalEarned: number;
  totalTrips: number;
  bankName: string | null;
  accountNumber: string | null; // masked like ****1234
  subAccountActive: boolean;
  recentPayments: Array<{
    id: string;
    totalAmount: number;
    driverAmount: number;
    paidAt: string;
    paymentMethod: string | null;
  }>;
};
```

### `GET /payments/history`

Auth required: yes

Accessible by: any authenticated user

Behavior:

- `ADMIN`: all payment records
- `DRIVER`: records for trips where driver is current user
- `OWNER`: records for trips where owner is current user

Response:

```ts
type PaymentHistoryResponse = Array<{
  id: string;
  tripId: string;
  totalAmount: number;
  driverAmount: number;
  platformAmount: number;
  monnifyTxRef: string;
  paymentMethod: string | null;
  paidAt: string;
  webhookPayload: Record<string, unknown>;
  createdAt: string;
  trip: {
    id: string;
    pickupAddress: string;
    destAddress: string;
    status: TripStatus;
    owner: {
      name: string;
    };
    driver: {
      name: string;
    } | null;
  };
}>;
```

### `GET /payments/pending`

Auth required: yes

Role required: `ADMIN`

Response:

```ts
type PendingPaymentsResponse = Array<
  Trip & {
    owner: {
      name: string;
      email: string;
      phone: string;
    };
    driver: {
      name: string;
    } | null;
  }
>;
```

### `POST /payments/wallet/reset`

Auth required: yes

Role required: `ADMIN`

Frontend note:

- This clears the driver's tracked wallet balances for a new period
- It is an admin ledger reset action, not a driver payout action

## Settings Endpoints

### `GET /settings`

Auth required: no

Response:

```ts
type SettingsResponse = {
  id: number;
  baseFare: number;
  pricePerKm: number;
  timeRate: number;
  commission: number;
  autoApprove: boolean;
  updatedAt: string;
  updatedById: string | null;
};
```

### `PATCH /settings`

Auth required: yes

Role required: `ADMIN`

Request body:

```ts
type UpdateSettingsRequest = {
  baseFare?: number;
  pricePerKm?: number;
  timeRate?: number;
  commission?: number; // 1..100
  autoApprove?: boolean;
};
```

Response:

- Same shape as `GET /settings`

## Admin Endpoints

All `/admin` routes require:

- valid bearer token
- `role === 'ADMIN'`

### `GET /admin/dashboard`

Recommended admin bootstrap endpoint.

Response:

```ts
type AdminDashboardResponse = {
  users: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: 'OWNER' | 'DRIVER';
    rating: number;
    totalTrips: number;
    avatarUrl: string | null;
    approvalStatus: ApprovalStatus | null;
    isBlocked: boolean;
    isOnline: boolean;
    carType: string | null;
    carModel: string | null;
    carYear: string | null;
    transmission: string | null;
    nin: string | null;
    licenseImageUrl: string | null;
    ninImageUrl: string | null;
    selfieImageUrl: string | null;
    walletBalance: number;
    locationLat: number | null;
    locationLng: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
  trips: Array<
    Trip & {
      owner: {
        id: string;
        name: string;
      };
      driver: {
        id: string;
        name: string;
      } | null;
    }
  >;
  settings: SettingsResponse;
};
```

### `GET /admin/users`

Response:

- same `users` array shape returned by `GET /admin/dashboard`

### `GET /admin/trips`

Response:

- same `trips` array shape returned by `GET /admin/dashboard`

## WebSocket Guide

Namespace:

- `/rides`

Recommended frontend connection example:

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001/rides');
```

### Client -> Server Events

#### `driver:register`

Use after a driver logs in and socket connects.

```ts
type DriverRegisterEvent = {
  driverId: string;
};
```

#### `owner:register`

Use after an owner logs in and socket connects.

```ts
type OwnerRegisterEvent = {
  ownerId: string;
};
```

#### `driver:location`

Live tracking + persistence event.

```ts
type DriverLocationEvent = {
  driverId: string;
  lat: number;
  lng: number;
};
```

Important:

- This updates `User.locationLat` and `User.locationLng` in the database
- This also emits `location:updated` to clients tracking that driver

#### `track:driver`

Used by clients that want live updates for one driver.

```ts
type TrackDriverEvent = {
  driverId: string;
};
```

### Server -> Client Events

#### `ride:assigned`

Sent to the assigned driver after owner creates a ride.

Payload:

- same trip-like object returned from `POST /rides`, plus `estimatedArrivalMins: null`

#### `ride:accepted`

Sent to owner when driver accepts.

```ts
type RideAcceptedEvent = {
  tripId: string;
  driver: {
    id: string;
    name: string;
    phone: string;
    avatarUrl: string | null;
    rating: number;
    transmission: string | null;
  } | null;
  estimatedArrivalMins: number;
};
```

#### `ride:declined`

Sent to owner when driver declines or auto-times out.

```ts
type RideDeclinedEvent = {
  tripId: string;
  reason: 'declined' | 'timeout';
  message: string;
};
```

#### `trip:completed`

Sent to owner when trip is marked completed.

```ts
type TripCompletedEvent = {
  tripId: string;
  fareBreakdown: Record<string, unknown>;
};
```

#### `location:updated`

Sent to clients who joined `track:driver`.

```ts
type LocationUpdatedEvent = {
  driverId: string;
  lat: number;
  lng: number;
  timestamp: string;
};
```

#### `driver:online`

Sent to the driver socket when `/users/online` changes state to online.

#### `driver:offline`

Sent to the driver socket when `/users/online` changes state to offline.

#### `driver:availability`

Broadcast event emitted on every online/offline toggle.

```ts
type DriverAvailabilityEvent = {
  driverId: string;
  isOnline: boolean;
  timestamp: string;
  locationLat?: number | null;
  locationLng?: number | null;
};
```

Frontend note:

- Use this event to refresh owner-side driver lists or update driver presence badges in real time

## Admin WebSocket Guide

Namespace:

- `/admin`

Recommended frontend connection example:

```ts
import { io } from 'socket.io-client';

const adminSocket = io('http://localhost:3001/admin');
```

### Client -> Server Events

#### `admin:register`

Use after an admin logs in and the admin socket connects.

```ts
type AdminRegisterEvent = {
  adminId: string;
};
```

### Server -> Client Events

#### `admin:dashboard:update`

Generic dashboard refresh signal emitted for every important admin-visible mutation.

```ts
type AdminDashboardUpdateEvent = {
  event: string;
  timestamp: string;
  [key: string]: unknown;
};
```

Recommended frontend behavior:

- on receipt, refetch `GET /admin/dashboard`

#### `admin:user:updated`

Emitted when:

- a driver approval status changes
- a user is blocked or unblocked

```ts
type AdminUserUpdatedEvent = {
  action: 'approval_changed' | 'block_changed';
  user: Record<string, unknown>;
  timestamp: string;
};
```

#### `admin:driver:pending_approval`

Emitted when a new driver registers and needs admin approval.

```ts
type AdminPendingDriverEvent = {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: 'DRIVER';
    approvalStatus: ApprovalStatus | null;
    createdAt: string;
  };
  timestamp: string;
};
```

#### `admin:trip:updated`

Emitted when trips are created or change status.

Possible actions currently include:

- `created`
- `accepted`
- `declined`
- `timed_out`
- `status_changed`

```ts
type AdminTripUpdatedEvent = {
  action: string;
  trip: Record<string, unknown>;
  timestamp: string;
};
```

#### `admin:settings:updated`

Emitted when system settings are changed by admin.

```ts
type AdminSettingsUpdatedEvent = {
  settings: SettingsResponse;
  timestamp: string;
};
```

#### `admin:payment:updated`

Emitted when a trip payment is initiated, paid, or fails.

Possible actions currently include:

- `initiated`
- `paid`
- `failed`

```ts
type AdminPaymentUpdatedEvent = {
  action: string;
  payment: Record<string, unknown>;
  timestamp: string;
};
```

## Error Patterns The Frontend Should Expect

Common status codes:

- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `500 Internal Server Error`

Typical error response shape from Nest:

```ts
type ErrorResponse = {
  statusCode: number;
  message: string | string[];
  error: string;
};
```

Examples of important backend messages:

- `No token provided`
- `Invalid or expired token`
- `Invalid credentials`
- `Account suspended. Please contact support.`
- `User not found`
- `Trip not found`
- `Driver not found`
- `This driver is no longer online`
- `This driver has just been assigned another trip. Please select a different driver.`
- `Payment can only be initiated for completed trips`
- `Driver payment account not configured. Please contact support.`

## Frontend Integration Notes

- Persist the JWT after login/register and send it on every protected request
- After socket connect, immediately emit either `driver:register` or `owner:register`
- After admin socket connect, emit `admin:register`
- Driver app should do both:
- `PATCH /users/location` if using the HTTP update flow directly
- `socket.emit('driver:location', ...)` for live map tracking and latest-location persistence
- Owner app should use `GET /users/drivers/available` before ride creation
- Owner app should use `GET /locations/route` before creating a ride
- Category destination search should call `GET /locations/search?q=<category>&biasLat=<pickupLat>&biasLng=<pickupLng>`
- Online/offline toggle should call `PATCH /users/online`; do not expect a brand-new socket connection when toggling
- Admin dashboard can either:
- refetch `GET /admin/dashboard` after important admin actions
- or listen for `admin:dashboard:update` and refetch on that event
- Driver earnings are paid directly by Monnify split on successful payment
- `walletBalance` should be treated as an internal cleared-earnings tracker, useful for summaries and monthly reset
- Do not build frontend payout-request or payout-approval flows for normal driver earnings in this mode
