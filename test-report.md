# FinCoord API Backend Test Report
Generated: 2026-05-10T10:30:00Z
Runner: Agent 1 (ASA)

## Summary
**Result: 11/11 PASSED** ✅

## Fixes Applied During Testing

### 1. Known Issue — `src/routes/groups.js` `GET /:id/expenses` crash
- **Problem**: `e.payerId.toString()` crashed because new schema uses `payments[]` not `payerId`
- **Fix**: Rewrote response mapping to use `payments`, `splits`, `splitType` with legacy-compat virtuals (`payerId`, `amount`, `splitMethod`, `splitDetails`) for frontend transition

### 2. `src/routes/friends.js` `GET /balances` crash
- **Problem**: Used old `userPair.userA/userB` schema which no longer exists in Balance model
- **Fix**: Rewrote to query `Balance.find({ groupId: { $in: groupIds } })` and aggregate per-person using `userId`-based records

### 3. `src/routes/export.js` undefined fields
- **Problem**: Referenced old schema fields `e.amount`, `e.splitMethod`, `e.date`, `e.currency`
- **Fix**: Updated to `e.totalAmount`, `e.splitType`, `e.expenseDate`, `e.baseCurrency`; also fixed `sort({ expenseDate: -1 })`

### 4. `src/routes/expenses.js` `PATCH /:id` silent failure
- **Problem**: Updated old fields `amount`, `splitMethod`, `splitDetails` which no longer exist
- **Fix**: Updated to patch new fields: `totalAmount`, `notes`, `description`, `baseCurrency`, `splitType`, `expenseDate`, `payments`, `splits`

### 5. `src/routes/dashboard.js` crash
- **Problem**: Used old `userPair` in MongoDB aggregation and JS code; Balance schema migrated to `userId`
- **Fix**: Completely rewrote to use `getGroupBalances()` utility per group, leveraging materialized Balance collection

### 6. `src/routes/groups.js` `GET /` crash
- **Problem**: `bal.userId.toString()` crashed on old Balance records missing `userId`
- **Fix**: Added `if (!bal.userId) continue` skip guard

### 7. `src/utils/balances.js` null-safety
- **Problem**: `bal.userId.toString()` crashed on legacy/invalid Balance documents
- **Fix**: Added `if (!bal.userId) continue` in `getGroupBalances`, `getSimplifiedDebtsForUser`, and userBalances loop

### 8. `src/routes/groups.js` `POST /:id/settle` crash
- **Problem**: Used old `userPair.userA/userB` Balance query
- **Fix**: Rewrote to use `getGroupBalances()` and find simplified transaction between current user and target member

### 9. `src/routes/expenses.js` sort field
- **Problem**: `sort({ date: -1 })` — `date` no longer exists in Expense schema
- **Fix**: Changed to `sort({ expenseDate: -1 })` in both group and personal expense queries

### 10. Dead code removal
- **Problem**: `computeBalances` and `simplifyDebts` local functions in `groups.js` referenced old schema (`payerId`, `amount`, `splitMethod`, `splitDetails`)
- **Fix**: Removed unused dead code (they were never called but confused the codebase)

### 11. Test script fixes
- **Problem**: Used fake user IDs (`user_a`, `user_b`, `user_c`) that failed ObjectId validation; visibility test split sum didn't equal totalAmount
- **Fix**: Rewrote `test-backend.js` to register real test users dynamically, fixed split math

## Test Results

| Component | Status | Notes |
|-----------|--------|-------|
| Visibility | ✅ PASS | Group expenses visible to members |
| Validation | ✅ PASS | Rejects invalid splits, accepts valid ones |
| Multi-Payer | ✅ PASS | 2 payers, 3 splits created correctly |
| Balances | ✅ PASS | Materialized per-member balances returned |
| Dashboard | ✅ PASS | Global view aggregates all groups |
| Legacy Compat | ✅ PASS | `payerId`/`amount`/`splitDetails` auto-converted to new model |
| Group List | ✅ PASS | `myBalance` present for each group |
| Group Expenses Route | ✅ PASS | No crash, new schema fields returned |
| Friends Balances Route | ✅ PASS | No crash, per-friend balances computed |
| Export Route | ✅ PASS | Valid fields (no undefined values) |
| Patch Expense Route | ✅ PASS | Updates `description`, `notes`, `splitType`, `totalAmount` |

## Recommendation
Backend is stable. Ready for Phase 3 frontend work.
