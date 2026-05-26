/**
 * Balance Computation Utilities
 *
 * - Incremental per-user net balance updates (fast, on each expense)
 * - Full recalculation (for repair/integrity checks)
 * - Debt simplification algorithm (greedy largest-first)
 * - Group balance retrieval from user's perspective
 */

const Balance = require('../models/Balance');

/**
 * Incrementally update per-user net balances when an expense is created.
 * Called within a MongoDB transaction session.
 *
 * Per-user net = totalPaid - totalOwed
 * Positive = user is owed money (over-paid)
 * Negative = user owes money (under-paid)
 */
async function updateBalancesOnExpenseCreate(expense, session) {
  const { groupId, directParticipants, payments, splits } = expense;

  // Compute per-user totals for this expense
  const paidBy = new Map();
  const owedBy = new Map();

  for (const p of payments) {
    const uid = p.userId.toString();
    paidBy.set(uid, (paidBy.get(uid) || 0) + p.amount);
  }
  for (const s of splits) {
    const uid = s.userId.toString();
    owedBy.set(uid, (owedBy.get(uid) || 0) + s.owedAmount);
  }

  // For non-group expenses, use a synthetic group key or store with groupId: null
  // We store with groupId: null and userId. The unique index allows this.
  const balanceGroupId = groupId || null;

  // Update each user's balance record
  const allUsers = new Set([...paidBy.keys(), ...owedBy.keys()]);
  for (const userId of allUsers) {
    const paid = paidBy.get(userId) || 0;
    const owed = owedBy.get(userId) || 0;
    const net = paid - owed;

    await Balance.findOneAndUpdate(
      { groupId: balanceGroupId, userId },
      {
        $inc: {
          netBalance: net,
          totalPaid: paid,
          totalOwed: owed,
          expenseCount: 1
        },
        $set: {
          lastUpdatedAt: new Date(),
          lastExpenseId: expense._id
        }
      },
      { upsert: true, session }
    );
  }
}

/**
 * Incrementally reverse per-user net balances when an expense is deleted (soft delete).
 */
async function updateBalancesOnExpenseDelete(expense, session) {
  const { groupId, payments, splits } = expense;
  const balanceGroupId = groupId || null;

  const paidBy = new Map();
  const owedBy = new Map();

  for (const p of payments) {
    const uid = p.userId.toString();
    paidBy.set(uid, (paidBy.get(uid) || 0) + p.amount);
  }
  for (const s of splits) {
    const uid = s.userId.toString();
    owedBy.set(uid, (owedBy.get(uid) || 0) + s.owedAmount);
  }

  for (const userId of new Set([...paidBy.keys(), ...owedBy.keys()])) {
    const paid = paidBy.get(userId) || 0;
    const owed = owedBy.get(userId) || 0;
    const net = paid - owed;

    await Balance.findOneAndUpdate(
      { groupId: balanceGroupId, userId },
      {
        $inc: {
          netBalance: -net,
          totalPaid: -paid,
          totalOwed: -owed,
          expenseCount: -1
        },
        $set: { lastUpdatedAt: new Date() }
      },
      { upsert: false, session }
    );
  }
}

/**
 * Update balances when an expense is edited.
 * Reverses old expense balances, then applies new expense balances.
 */
async function updateBalancesOnExpenseEdit(oldExpense, newExpense, session) {
  await updateBalancesOnExpenseDelete(oldExpense, session);
  await updateBalancesOnExpenseCreate(newExpense, session);
}

/**
 * Full recalculation from all expenses — for repair/integrity checks.
 * Resets all balances for the group and recalculates from scratch.
 */
async function recalculateGroupBalances(groupId) {
  const Expense = require('../models/Expense');
  const expenses = await Expense.find({ groupId, isDeleted: { $ne: true } });

  // Delete existing balances for this group
  await Balance.deleteMany({ groupId });

  // Compute per-user totals
  const userNets = new Map(); // userId -> { paid, owed }

  for (const expense of expenses) {
    for (const p of expense.payments) {
      const uid = p.userId.toString();
      const entry = userNets.get(uid) || { paid: 0, owed: 0 };
      entry.paid += p.amount;
      userNets.set(uid, entry);
    }
    for (const s of expense.splits) {
      const uid = s.userId.toString();
      const entry = userNets.get(uid) || { paid: 0, owed: 0 };
      entry.owed += s.owedAmount;
      userNets.set(uid, entry);
    }
  }

  // Bulk write new balances
  const bulkOps = [];
  for (const [userId, entry] of userNets) {
    const net = entry.paid - entry.owed;
    bulkOps.push({
      updateOne: {
        filter: { groupId, userId },
        update: {
          $set: {
            netBalance: net,
            totalPaid: entry.paid,
            totalOwed: entry.owed,
            lastUpdatedAt: new Date()
          }
        },
        upsert: true
      }
    });
  }

  if (bulkOps.length > 0) {
    await Balance.bulkWrite(bulkOps);
  }

  return { recalculated: bulkOps.length };
}

/**
 * Get balances for a group from a user's perspective.
 * Uses the materialized Balance collection (fast).
 *
 * Returns:
 * - totalOwedToYou: sum of what others owe you (from simplified view)
 * - totalYouOwe: sum of what you owe others
 * - netBalance: totalOwedToYou - totalYouOwe
 * - userBalances: array of { otherUserId, netBalance } from your perspective
 */
async function getGroupBalances(groupId, userId) {
  const balances = await Balance.find({ groupId });

  // Build full balance map for simplified debt computation
  const balanceMap = new Map();
  for (const bal of balances) {
    if (!bal.userId) continue; // skip old/invalid records
    balanceMap.set(bal.userId.toString(), bal.netBalance);
  }

  // Compute simplified debts for the whole group
  const simplifiedTransactions = simplifyDebts(balanceMap);

  // Compute this user's position from simplified transactions
  let totalOwedToYou = 0;
  let totalYouOwe = 0;

  for (const tx of simplifiedTransactions) {
    if (tx.to === userId.toString()) totalOwedToYou += tx.amount;
    if (tx.from === userId.toString()) totalYouOwe += tx.amount;
  }

  // Build per-member balances from user's perspective
  const userBalances = [];

  for (const bal of balances) {
    if (!bal.userId) continue;
    const mid = bal.userId.toString();
    if (mid === userId.toString()) continue;
    userBalances.push({
      otherUserId: mid,
      netBalance: bal.netBalance,
      lastUpdatedAt: bal.lastUpdatedAt
    });
  }

  // Also compute the "effective" pairwise from simplified transactions
  const effectiveMap = new Map();
  for (const tx of simplifiedTransactions) {
    if (tx.from === userId.toString()) {
      effectiveMap.set(tx.to, (effectiveMap.get(tx.to) || 0) - tx.amount);
    }
    if (tx.to === userId.toString()) {
      effectiveMap.set(tx.from, (effectiveMap.get(tx.from) || 0) + tx.amount);
    }
  }

  return {
    totalOwedToYou,
    totalYouOwe,
    netBalance: totalOwedToYou - totalYouOwe,
    userBalances,
    simplifiedTransactions,
    effectiveMap
  };
}

/**
 * Debt Simplification Algorithm
 *
 * Given per-user net balances, produces at most N-1 transactions
 * that settle all debts.
 *
 * Algorithm: Greedy largest-first
 * 1. Calculate net balance for each person (paid - owed)
 * 2. Separate into creditors (positive net) and debtors (negative net)
 * 3. Greedily match largest debtor to largest creditor
 * 4. Repeat until all balances are zero
 *
 * Time: O(V log V) where V = number of users
 * Result: at most V - 1 transactions
 */
function simplifyDebts(balanceMap) {
  const debts = [];

  const creditors = []; // [userId, amount] — they are owed money
  const debtors = [];   // [userId, amount] — they owe money

  for (const [userId, balance] of balanceMap) {
    if (balance > 0) creditors.push([userId, balance]);
    else if (balance < 0) debtors.push([userId, -balance]);
  }

  creditors.sort((a, b) => b[1] - a[1]);
  debtors.sort((a, b) => b[1] - a[1]);

  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const [debtorId, debtAmount] = debtors[i];
    const [creditorId, creditAmount] = creditors[j];

    const settlementAmount = Math.min(debtAmount, creditAmount);

    debts.push({
      from: debtorId,
      to: creditorId,
      amount: settlementAmount
    });

    debtors[i][1] -= settlementAmount;
    creditors[j][1] -= settlementAmount;

    if (debtors[i][1] === 0) i++;
    if (creditors[j][1] === 0) j++;
  }

  return debts;
}

/**
 * Get simplified debts for a specific user from a group.
 * Returns who the user should pay / who should pay the user.
 */
async function getSimplifiedDebtsForUser(groupId, userId) {
  const balances = await Balance.find({ groupId });

  const balanceMap = new Map();
  for (const bal of balances) {
    if (!bal.userId) continue;
    balanceMap.set(bal.userId.toString(), bal.netBalance);
  }

  return simplifyDebts(balanceMap).filter(
    tx => tx.from === userId.toString() || tx.to === userId.toString()
  );
}

/**
 * Compute per-user net balances across all non-group (direct) expenses.
 * Queries the Expense collection directly for maximum accuracy.
 *
 * Returns a Map<userId, netBalance> where netBalance = paid - owed (minor units).
 * Positive = user is owed money; negative = user owes money.
 */
async function getNonGroupBalancesForUser(userId) {
  const Expense = require('../models/Expense');

  const expenses = await Expense.find({
    groupId: null,
    isDeleted: { $ne: true },
    $or: [
      { 'payments.userId': userId },
      { 'splits.userId': userId },
      { directParticipants: userId },
      { createdBy: userId },
    ],
  });

  const userNetMap = new Map();

  for (const expense of expenses) {
    for (const p of expense.payments) {
      const uid = p.userId.toString();
      userNetMap.set(uid, (userNetMap.get(uid) || 0) + p.amount);
    }
    for (const s of expense.splits) {
      const uid = s.userId.toString();
      userNetMap.set(uid, (userNetMap.get(uid) || 0) - s.owedAmount);
    }
  }

  return userNetMap;
}

/**
 * Get non-group balances from a user's perspective.
 * Runs simplifyDebts on all non-group expenses and extracts pairwise
 * relationships for the given user.
 *
 * Returns a Map<otherUserId, { net, totalOwedToYou, totalYouOwe }>
 * where amounts are in minor units.
 */
async function getNonGroupBalancesPerspective(userId) {
  const userNetMap = await getNonGroupBalancesForUser(userId);
  const simplified = simplifyDebts(userNetMap);

  const result = new Map();
  for (const tx of simplified) {
    if (tx.from === userId.toString()) {
      // user owes tx.to
      const entry = result.get(tx.to) || { net: 0, totalOwedToYou: 0, totalYouOwe: 0 };
      entry.net -= tx.amount;
      entry.totalYouOwe += tx.amount;
      result.set(tx.to, entry);
    } else if (tx.to === userId.toString()) {
      // tx.from owes user
      const entry = result.get(tx.from) || { net: 0, totalOwedToYou: 0, totalYouOwe: 0 };
      entry.net += tx.amount;
      entry.totalOwedToYou += tx.amount;
      result.set(tx.from, entry);
    }
  }

  return result;
}

module.exports = {
  updateBalancesOnExpenseCreate,
  updateBalancesOnExpenseDelete,
  updateBalancesOnExpenseEdit,
  recalculateGroupBalances,
  getGroupBalances,
  simplifyDebts,
  getSimplifiedDebtsForUser,
  getNonGroupBalancesForUser,
  getNonGroupBalancesPerspective,
};
