const mongoose = require('mongoose');

/**
 * Payment Entry — Who paid how much
 * Supports multi-payer scenarios (e.g., Alice paid ₹500, Bob paid ₹300)
 */
const PaymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true }, // stored in minor units (paise/cents)
  originalCurrency: { type: String, default: 'INR' },
  exchangeRate: { type: Number, default: 1.0 } // to base currency if different
}, { _id: false });

/**
 * Split Entry — Who owes how much
 */
const SplitEntrySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  owedAmount: { type: Number, required: true }, // minor units
  shareType: {
    type: String,
    enum: ['equal', 'exact', 'percentage', 'shares', 'adjustment'],
    default: 'equal'
  },
  shareValue: { type: Number, default: 1 }, // e.g., 50 for 50%, or 2 for 2 shares, or adjustment delta
  isExcluded: { type: Boolean, default: false }
}, { _id: false });

/**
 * Recurrence Rule — For recurring expenses
 */
const RecurrenceRuleSchema = new mongoose.Schema({
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'fortnightly', 'monthly', 'yearly'],
    required: true
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null }
}, { _id: false });

/**
 * Attachment — Photos, documents, receipts
 */
const AttachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  filename: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Expense Document
 *
 * Core financial transaction record.
 * Supports both group expenses and direct 1:1 expenses.
 * Supports multi-payer scenarios.
 */
const ExpenseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true }, // legacy fallback / alias
  totalAmount: { type: Number, required: true }, // minor units
  baseCurrency: { type: String, default: 'INR' },

  // Context: either group or non-group (mutually exclusive)
  contextType: {
    type: String,
    enum: ['group', 'non_group'],
    required: true
  },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },
  directParticipants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Core split data (embedded — always read together with expense)
  payments: [PaymentSchema],         // who paid how much
  splits: [SplitEntrySchema],        // who owes how much
  splitType: {
    type: String,
    enum: ['equal', 'exact', 'percentage', 'shares', 'adjustment'],
    default: 'equal'
  },

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // legacy field, keep for compat
  expenseDate: { type: Date, default: Date.now },
  category: { type: String, default: 'general' },
  notes: { type: String },
  receiptUrl: { type: String },
  attachments: [AttachmentSchema],

  // Recurring
  isRecurring: { type: Boolean, default: false },
  recurrenceRule: RecurrenceRuleSchema,

  // Settlement flag (for "Settle Up" transactions)
  isSettlement: { type: Boolean, default: false },
  settlementFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  settlementTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  version: { type: Number, default: 1 } // optimistic locking
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// --- CRITICAL INDEXES ---
ExpenseSchema.index({ groupId: 1, expenseDate: -1, isDeleted: 1 });
ExpenseSchema.index({ directParticipants: 1, expenseDate: -1, isDeleted: 1 });
ExpenseSchema.index({ 'payments.userId': 1, expenseDate: -1 });
ExpenseSchema.index({ 'splits.userId': 1, expenseDate: -1 });
ExpenseSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
