const router = require('express').Router();
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const Activity = require('../models/Activity');
const Group = require('../models/Group');
const requireAuth = require('../middleware/auth');
const { scanReceipt } = require('../utils/ocr');
const { validateExpenseSplit, toMinorUnits } = require('../utils/validation');
const {
  updateBalancesOnExpenseCreate,
  updateBalancesOnExpenseDelete,
  updateBalancesOnExpenseEdit
} = require('../utils/balances');

// All routes require auth
router.use(requireAuth);

// GET /api/expenses?groupId=...
router.get('/', async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const includeDeleted = req.query.includeDeleted === 'true';

    const baseQuery = includeDeleted ? {} : { isDeleted: { $ne: true } };

    if (req.query.groupId) {
      // --- Group context: verify membership, return ALL group expenses ---
      const group = await Group.findById(req.query.groupId).select('members');
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (!group.members.some(m => m.toString() === myId)) {
        return res.status(403).json({ error: 'Not a member of this group' });
      }

      const expenses = await Expense.find({
        ...baseQuery,
        groupId: req.query.groupId,
      }).sort({ expenseDate: -1 });

      res.json({ expenses });
    } else {
      // --- Personal context: expenses where I'm a participant or creator ---
      // Use $and to cleanly separate the non-group filter from the user-participation filter.
      const expenses = await Expense.find({
        ...baseQuery,
        $and: [
          {
            $or: [
              { groupId: { $exists: false } },
              { groupId: null },
            ],
          },
          {
            $or: [
              { createdBy: req.user._id },
              { 'payments.userId': req.user._id },
              { 'splits.userId': req.user._id },
              { directParticipants: req.user._id },
            ],
          },
        ],
      }).sort({ expenseDate: -1 });

      res.json({ expenses });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses/:id
router.get('/:id', async (req, res) => {
  try {
    const myId = req.user._id.toString();

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid expense ID format' });
    }

    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Check access: user must be creator, payer, splitter, or direct participant
    const isCreator = expense.createdBy && expense.createdBy.toString() === myId;
    const isPayer = expense.payments && expense.payments.some(function(p) { return p.userId && p.userId.toString() === myId; });
    const isSplitter = expense.splits && expense.splits.some(function(s) { return s.userId && s.userId.toString() === myId; });
    const isDirectParticipant = expense.directParticipants && expense.directParticipants.some(function(p) { return p.toString() === myId; });

    // For group expenses, members can also view
    let isGroupMember = false;
    if (expense.groupId) {
      const group = await Group.findById(expense.groupId).select('members');
      if (group) {
        isGroupMember = group.members.some(function(m) { return m.toString() === myId; });
      }
    }

    if (!isCreator && !isPayer && !isSplitter && !isDirectParticipant && !isGroupMember) {
      return res.status(403).json({ error: 'Not authorized to view this expense' });
    }

    res.json({ expense });
  } catch (err) {
    console.error('GET /expenses/:id error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/expenses
router.post('/', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      groupId,
      title,
      description,
      totalAmount,
      currency,
      date,
      splitType,
      payments,
      splits,
      notes,
      category,
      isRecurring,
      recurrenceRule,
      contextType,
      directParticipants,
      participants,
    } = req.body;

    // --- Build expense data ---
    const expenseData = {
      title: title || description || 'Expense',
      description: description || title || 'Expense',
      totalAmount: toMinorUnits(totalAmount),
      baseCurrency: currency || req.user.currency || 'INR',
      contextType: contextType || (groupId ? 'group' : 'non_group'),
      groupId: groupId || null,
      directParticipants: directParticipants || [],
      payments: (payments || []).map(p => ({
        userId: p.userId,
        amount: toMinorUnits(p.amount),
        originalCurrency: currency || req.user.currency || 'INR',
      })),
      splits: (splits || []).map(s => ({
        userId: s.userId,
        owedAmount: toMinorUnits(s.owedAmount || s.computedAmount || 0),
        shareType: s.shareType || splitType || 'equal',
        shareValue: s.shareValue || 1,
        isExcluded: s.isExcluded || false,
      })),
      splitType: splitType || 'equal',
      notes: notes || '',
      category: category || 'general',
      expenseDate: date ? new Date(date) : new Date(),
      isRecurring: isRecurring || false,
      recurrenceRule: recurrenceRule || null,
      createdBy: req.user._id,
      userId: req.user._id,
    };

    // --- Store participant display names for non-group (direct) expenses ---
    // Non-group expenses may involve friends whose IDs aren't in our User collection,
    // so we persist the names the user entered alongside the expense.
    if (contextType === 'non_group' && participants && participants.length > 0) {
      const nameMap = new Map();
      participants.forEach(p => {
        if (p.userId && p.name && p.name.trim().length > 0) {
          nameMap.set(p.userId.toString(), p.name.trim());
        }
      });
      if (nameMap.size > 0) {
        expenseData.participantNames = nameMap;
      }
    }

    // --- VALIDATE ---
    const validation = validateExpenseSplit(expenseData);
    if (!validation.isValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: 'Invalid expense',
        details: validation.errors
      });
    }

    // --- Create expense within transaction ---
    const [expense] = await Expense.create([expenseData], { session });

    // --- Update materialized balances ---
    try {
      await updateBalancesOnExpenseCreate(expense, session);
    } catch (balanceErr) {
      await session.abortTransaction();
      session.endSession();
      console.error('Balance update failed:', balanceErr.message);
      return res.status(500).json({ error: 'Balance update failed', details: balanceErr.message });
    }

    // --- Create activity ---
    await Activity.create([{
      userId: req.user._id,
      action: 'Added Expense',
      detail: `${expenseData.title} — ${expenseData.baseCurrency}${(expenseData.totalAmount / 100).toFixed(2)}`,
      expenseId: expense._id,
      groupId: expenseData.groupId,
      metadata: { splitType: expenseData.splitType },
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ expense });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/expenses/:id
router.patch('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { totalAmount, notes, description, title, currency, splitType, payments, splits, date, category, participants } = req.body;

    // Fetch old expense
    const oldExpense = await Expense.findOne({
      _id: req.params.id,
      $or: [{ createdBy: req.user._id }, { userId: req.user._id }],
    }).session(session);

    if (!oldExpense) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Expense not found' });
    }

    const patch = {};
    if (title !== undefined) patch.title = title.trim();
    if (description !== undefined) patch.description = description;
    if (totalAmount != null) patch.totalAmount = toMinorUnits(totalAmount);
    if (notes != null) patch.notes = notes;
    if (currency) patch.baseCurrency = currency;
    if (splitType) patch.splitType = splitType;
    if (category) patch.category = category;
    if (date) patch.expenseDate = new Date(date);

    if (payments && Array.isArray(payments)) {
      patch.payments = payments.map(p => ({
        userId: p.userId,
        amount: toMinorUnits(p.amount),
        originalCurrency: currency || oldExpense.baseCurrency,
      }));
    }
    if (splits && Array.isArray(splits)) {
      patch.splits = splits.map(s => ({
        userId: s.userId,
        owedAmount: toMinorUnits(s.owedAmount || s.computedAmount || 0),
        shareType: s.shareType || splitType || oldExpense.splitType,
        shareValue: s.shareValue || 1,
        isExcluded: s.isExcluded || false,
      }));
    }
    if (participants && Array.isArray(participants)) {
      // Rebuild participantNames map when participants are updated (e.g. after edit).
      const nameMap = new Map();
      participants.forEach(p => {
        if (p.userId && p.name && p.name.trim().length > 0) {
          nameMap.set(p.userId.toString(), p.name.trim());
        }
      });
      if (nameMap.size > 0) {
        patch.participantNames = nameMap;
      }
    }

    // Apply patch
    const patchedDoc = { ...oldExpense.toObject(), ...patch };

    // Validate patched expense
    const validation = validateExpenseSplit(patchedDoc);
    if (!validation.isValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: 'Invalid expense after patch',
        details: validation.errors
      });
    }

    // Update expense
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, $or: [{ createdBy: req.user._id }, { userId: req.user._id }] },
      { $set: patch, $inc: { version: 1 } },
      { new: true, session }
    );

    // Reverse old balances, apply new balances
    await updateBalancesOnExpenseEdit(oldExpense, expense, session);

    // Create activity
    await Activity.create([{
      userId: req.user._id,
      action: 'Edited Expense',
      detail: `${expense.title} — ${expense.baseCurrency}${(expense.totalAmount / 100).toFixed(2)}`,
      expenseId: expense._id,
      groupId: expense.groupId,
      metadata: { splitType: expense.splitType },
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.json({ expense });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id — SOFT DELETE
router.delete('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      $or: [{ createdBy: req.user._id }, { userId: req.user._id }],
    }).session(session);

    if (!expense) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Reverse balances
    await updateBalancesOnExpenseDelete(expense, session);

    // Soft delete
    expense.isDeleted = true;
    expense.deletedAt = new Date();
    expense.deletedBy = req.user._id;
    await expense.save({ session });

    // Create activity
    await Activity.create([{
      userId: req.user._id,
      action: 'Deleted Expense',
      detail: `${expense.title}`,
      expenseId: expense._id,
      groupId: expense.groupId,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Deleted', expenseId: expense._id });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses/scan-receipt
router.post('/scan-receipt', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'image (base64) is required' });

    const result = await scanReceipt(image);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
