# FinCoord E2E Test Report
Date: 2026-05-10T14:21:33.864Z
Server: http://localhost:3050/api

| # | Test | Status | Detail |
|---|------|--------|--------|
| 1 | Setup Users | PASS ✅ | 4 users created |
| 2 | Setup Group | PASS ✅ | group=6a00946a31a3d12bdebff5c3 |
| 3 | Single-Payer Equal | PASS ✅ | id=6a00946a31a3d12bdebff5c9 |
| 4 | Multi-Payer | PASS ✅ | id=6a00946a31a3d12bdebff5d1 |
| 5 | Exact Split | PASS ✅ | id=6a00946b31a3d12bdebff5d9 |
| 6 | Percentage Split | PASS ✅ | id=6a00946b31a3d12bdebff5e1 |
| 7 | Invalid Split Rejected | PASS ✅ | status=400 |
| 8 | Expense Visibility (creator) | PASS ✅ | 4 expenses |
| 9 | Expense Visibility (member) | PASS ✅ | 4 expenses |
| 10 | Group Balances | PASS ✅ | 4 members, simplified=2 |
| 11 | Simplified Debts | PASS ✅ | 2 transactions |
| 12 | Settlement | PASS ✅ | status=200 |
| 13 | Legacy Compat | PASS ✅ | payments=1, splits=1 |
| 14 | Recalculate Balances | PASS ✅ | status=200 |
| 15 | Dashboard | PASS ✅ | net=181333, groups=1 |
| 16 | Cleanup | PASS ✅ |  |

**Summary: 16/16 tests passed**
