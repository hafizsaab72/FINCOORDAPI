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
| Dev Server | nodemon |

---

## Project Structure

```
/FinCoordAPI
├── server.js              # Entry point — DB connect + listen
└── /src
    ├── app.js             # Express app, route mounting, middleware
    ├── /middleware
    │   └── auth.js        # JWT requireAuth middleware
    ├── /models
    │   ├── User.js        # name, email, password, phone, bio, profilePic, currency
    │   ├── Expense.js     # amount, description, paidBy, group, splits
    │   ├── Bill.js        # title, amount, dueDate, category, recurrence
    │   ├── Group.js       # name, members[], createdBy
    │   ├── Activity.js    # type, description, user, ref
    │   └── FriendRequest.js  # sender, receiver, status (pending/accepted/rejected)
    └── /routes
        ├── auth.js        # /api/auth — register, login, me, profile, account
        ├── expenses.js    # /api/expenses — CRUD
        ├── bills.js       # /api/bills — CRUD
        ├── groups.js      # /api/groups — CRUD
        ├── activities.js  # /api/activities — list
        ├── data.js        # /api/data — bulk delete user data
        ├── users.js       # /api/users — search, invite preview
        └── friends.js     # /api/friends — friend requests CRUD
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

> Note: URL-encode special characters in the MongoDB password (e.g. `$` → `%24`).

**3. Start the server:**
```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

Server listens on `0.0.0.0:3000` by default.

---

## API Reference

All protected routes require the header:
```
Authorization: Bearer <token>
```

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | No | Create account. Body: `{ name, email, password }` |
| POST | `/login` | No | Sign in. Body: `{ email, password }` |
| GET | `/me` | Yes | Get current user profile |
| PUT | `/profile` | Yes | Update profile. Body: `{ name?, phone?, bio?, currency?, profilePic? }` |
| DELETE | `/account` | Yes | Delete account and all associated data |

### Expenses — `/api/expenses`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List user's expenses |
| POST | `/` | Yes | Create expense |
| PUT | `/:id` | Yes | Update expense |
| DELETE | `/:id` | Yes | Delete expense |

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
| GET | `/search?q=` | Yes | Search users by name or email (excludes self + existing relationships) |
| GET | `/invite/:userId` | No | Public — get user info for invite deep link landing page |

### Friends — `/api/friends`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | List accepted friends |
| GET | `/requests` | Yes | List incoming pending requests |
| POST | `/request/:userId` | Yes | Send a friend request |
| PUT | `/accept/:requestId` | Yes | Accept a received request |
| PUT | `/reject/:requestId` | Yes | Reject a received request |
| DELETE | `/:friendId` | Yes | Remove friend or cancel sent request |

---

## Notes

- **Profile photos** are stored as base64 data URLs directly in the User document. Images should be compressed to ≤400×400px at 70% quality before upload to stay well within MongoDB's 16MB BSON limit.
- **Password hashing** is done via a Mongoose `pre('save')` hook using bcryptjs (10 rounds).
- **Friend request deduplication** is enforced by a unique compound index on `{ sender, receiver }`.

---

**Version:** 1.0.0
