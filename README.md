# FinCoordAPI

REST API backend for the FinCoord financial coordination app. Built with Express.js and MongoDB Atlas.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js v4 |
| Database | MongoDB Atlas (Mongoose v8) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Firebase | firebase-admin (Phone Auth token verification + FCM push) |
| OCR | tesseract.js (receipt scanning) |
| Dev Server | nodemon |

---

## Project Structure

```
/FinCoordAPI
├── server.js              # Entry point — DB connect + listen
├── firebase-service-account.json   # ← NOT committed (add to get phone auth + push working)
└── /src
    ├── app.js             # Express app, route mounting, CORS, middleware
    ├── /middleware
    │   └── auth.js        # JWT requireAuth middleware
    ├── /models
    │   ├── User.js        # name, email, password, phone, bio, profilePic,
    │   │                  #   currency, country, fcmToken, isPro
    │   ├── Expense.js     # amount, description, paidBy, group, splits
    │   ├── Bill.js        # title, amount, dueDate, category, recurrence
    │   ├── Group.js       # name, members[], createdBy
    │   ├── Activity.js    # type, description, user, ref
    │   └── FriendRequest.js  # sender, receiver, status
    ├── /routes
    │   ├── auth.js        # /api/auth
    │   ├── expenses.js    # /api/expenses (+ receipt OCR)
    │   ├── bills.js       # /api/bills
    │   ├── groups.js      # /api/groups
    │   ├── activities.js  # /api/activities
    │   ├── data.js        # /api/data (bulk delete)
    │   ├── users.js       # /api/users (search, invite, device token)
    │   └── friends.js     # /api/friends (requests + push notifications)
    └── /utils
        ├── push.js        # Firebase Admin SDK — sendPush() helper
        └── ocr.js         # Tesseract.js OCR + regex parsers
```

---

## Setup

**1. Install dependencies:**
```bash
npm install
```

**2. Create `.env` in the project root:**
```env
PORT=3000
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
```
> URL-encode special characters in the MongoDB password (e.g. `$` → `%24`).

**3. Firebase service account (for Phone Auth verification + FCM push):**
- Firebase Console → Project Settings → Service accounts → *Generate new private key*
- Save as `firebase-service-account.json` in the project root (already in `.gitignore`)

**4. Start the server:**
```bash
npm run dev   # development (nodemon)
npm start     # production
```

Server listens on `0.0.0.0:3000`.

---

## API Reference

All protected routes require:
```
Authorization: Bearer <token>
```

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | No | Create account. Body: `{ name, email, password }` |
| POST | `/login` | No | Sign in. Body: `{ email, password }` |
| POST | `/phone` | No | Phone OTP login. Body: `{ idToken, name?, country? }` — verifies Firebase ID token, finds or creates user by phone number |
| GET | `/me` | Yes | Get current user profile |
| PUT | `/profile` | Yes | Update profile. Body: `{ name?, phone?, bio?, currency?, profilePic?, email?, newPassword? }` |
| DELETE | `/account` | Yes | Delete account and all associated data |

> `PUT /profile` accepts `email` + `newPassword` to let phone-only users add email/password login to their account.

### Expenses — `/api/expenses`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List user's expenses |
| POST | `/` | Yes | Create expense |
| PUT | `/:id` | Yes | Update expense |
| DELETE | `/:id` | Yes | Delete expense |
| POST | `/scan-receipt` | Yes | OCR a receipt image. Body: `{ image: base64 }` → returns `{ amount, merchant, date, rawText }` |

### Bills — `/api/bills`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List user's bills |
| POST | `/` | Yes | Create bill |
| PUT | `/:id` | Yes | Update bill |
| DELETE | `/:id` | Yes | Delete bill |

### Groups — `/api/groups`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List user's groups |
| POST | `/` | Yes | Create group |
| PUT | `/:id` | Yes | Update group |
| DELETE | `/:id` | Yes | Delete group |

### Activities — `/api/activities`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List user's activity feed |

### Data — `/api/data`

| Method | Path | Auth | Description |
|---|---|---|---|
| DELETE | `/` | Yes | Delete all expenses, bills, groups, activities for current user |

### Users — `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/search?q=` | Yes | Search users by name or email |
| GET | `/invite/:userId` | No | Public — user info for invite deep link landing |
| POST | `/device-token` | Yes | Store FCM token. Body: `{ fcmToken }` |

### Friends — `/api/friends`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List accepted friends |
| GET | `/requests` | Yes | List incoming pending requests |
| POST | `/request/:userId` | Yes | Send a friend request (push notification sent to receiver) |
| PUT | `/accept/:requestId` | Yes | Accept a request (push notification sent to original sender) |
| PUT | `/reject/:requestId` | Yes | Reject a request |
| DELETE | `/:friendId` | Yes | Remove friend or cancel sent request |

---

## Notes

- **Phone Auth** — Firebase ID tokens are verified via `firebase-admin`. The `phone_number` field from the decoded token is used to find or create users. Phone numbers are stored in E.164 format (e.g. `+917760556716`).
- **Phone-only accounts** — Given a placeholder email (`phone_<digits>@fincoord.internal`) and a random password. Users can add a real email/password later via `PUT /api/auth/profile`.
- **Push notifications** — Sent via Firebase Admin SDK FCM. Requires `firebase-service-account.json`. Falls back silently if the token is missing or stale.
- **Receipt OCR** — Tesseract.js processes images server-side; no external API key required. Regex parsers extract total amount, merchant name, and date from raw text.
- **Profile photos** — Stored as base64 data URLs in the User document (≤400×400px, 70% quality to stay within MongoDB's 16 MB BSON limit).
- **Password hashing** — Mongoose `pre('save')` hook via bcryptjs (10 rounds). Password changes must go through `.save()` to trigger the hook, not `findByIdAndUpdate`.

---

**Version:** 1.4.0
