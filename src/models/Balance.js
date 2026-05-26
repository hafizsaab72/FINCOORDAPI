const mongoose = require('mongoose');

/**
 * Balance Document — Per-User Net Balance
 *
 * Stores each user's net financial position within a group.
 * Updated incrementally on each expense creation/deletion.
 *
 * netBalance interpretation (from the user's perspective):
 * - positive = user is OWED money by the group (they over-paid)
 * - negative = user OWES money to the group (they under-paid)
 * - zero = settled up
 *
 * For global debt simplification, read all balances for a group
 * and run simplifyDebts() on the per-user net values.
 */
const BalanceSchema = new mongoose.Schema({
  // Scope: null for 1:1 direct balances, groupId for group balances
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },

  // The user this balance belongs to
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

  // Net balance in minor units (paid - owed)
  netBalance: { type: Number, default: 0 },

  // Audit fields
  totalPaid: { type: Number, default: 0 },
  totalOwed: { type: Number, default: 0 },

  // Metadata
  lastExpenseId: { type: mongoose.Schema.Types.ObjectId },
  lastUpdatedAt: { type: Date, default: Date.now },
  expenseCount: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Unique index: one balance record per user per group
BalanceSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Balance', BalanceSchema);
