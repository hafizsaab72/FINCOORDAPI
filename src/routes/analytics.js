const router = require('express').Router();
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

/**
 * GET /api/analytics/summary?friendId=
 *
 * Returns total spending, user's share, and category breakdown
 * across all expenses (group + non-group) involving the current user.
 * Optionally filters to expenses involving a specific friend.
 */
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user._id;
    const friendId = req.query.friendId;

    // Find all groups the user belongs to
    const myGroups = await Group.find({ members: userId }).select('_id');
    const groupIds = myGroups.map(g => g._id);

    // Build base query: all expenses (group + non-group) where user is involved
    const baseQuery = {
      isDeleted: { $ne: true },
      $or: [
        { groupId: { $in: groupIds } },
        {
          groupId: null,
          $or: [
            { createdBy: userId },
            { 'payments.userId': userId },
            { 'splits.userId': userId },
            { directParticipants: userId },
          ],
        },
      ],
    };

    let expenses = await Expense.find(baseQuery);

    // If friendId provided, filter to expenses involving that friend
    if (friendId) {
      expenses = expenses.filter(e => {
        const inPayers = e.payments.some(p => p.userId.toString() === friendId);
        const inSplits = e.splits.some(s => s.userId.toString() === friendId);
        return inPayers || inSplits;
      });
    }

    let totalSpent = 0;
    let yourShare = 0;
    const categoryMap = new Map();
    const payerMap = new Map();

    for (const expense of expenses) {
      totalSpent += expense.totalAmount;

      // Find user's split
      const mySplit = expense.splits.find(
        s => s.userId.toString() === userId.toString()
      );
      const myShare = mySplit ? mySplit.owedAmount : 0;
      yourShare += myShare;

      // Category breakdown (use expense category, fallback to first word of title)
      const cat = expense.category || expense.title?.split(' ')[0] || 'Other';
      const entry = categoryMap.get(cat) || { category: cat, amount: 0, count: 0 };
      entry.amount += expense.totalAmount;
      entry.count += 1;
      categoryMap.set(cat, entry);

      // Top payers
      for (const p of expense.payments) {
        const pid = p.userId.toString();
        payerMap.set(pid, (payerMap.get(pid) || 0) + p.amount);
      }
    }

    // Build category breakdown sorted by amount desc
    const categoryBreakdown = Array.from(categoryMap.values())
      .map(c => ({
        category: c.category,
        amount: parseFloat((c.amount / 100).toFixed(2)),
        count: c.count,
        percentage: totalSpent > 0
          ? parseFloat(((c.amount / totalSpent) * 100).toFixed(1))
          : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Build top payers sorted by amount desc
    const topPayers = Array.from(payerMap.entries())
      .map(([payerId, amount]) => ({
        payerId,
        amount: parseFloat((amount / 100).toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    res.json({
      totalSpent: parseFloat((totalSpent / 100).toFixed(2)),
      yourShare: parseFloat((yourShare / 100).toFixed(2)),
      expenseCount: expenses.length,
      categoryBreakdown,
      topPayers,
    });
  } catch (err) {
    console.error('[ANALYTICS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
