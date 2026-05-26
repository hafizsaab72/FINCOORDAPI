const router = require('express').Router();
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const Activity = require('../models/Activity');
const Balance = require('../models/Balance');
const requireAuth = require('../middleware/auth');
const { recalculateGroupBalances } = require('../utils/balances');

// DELETE /api/data — wipe all data for the authenticated user
router.delete('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all groups affected by this user's expenses BEFORE deleting
    const userExpenses = await Expense.find({
      $or: [
        { createdBy: userId },
        { userId },
        { directParticipants: userId },
      ],
    }).select('groupId');

    const affectedGroupIds = [...new Set(
      userExpenses.map(e => e.groupId?.toString()).filter(Boolean)
    )];

    await Promise.all([
      // Expenses: delete where user is creator, legacy owner, or direct participant
      Expense.deleteMany({
        $or: [
          { createdBy: userId },
          { userId },
          { directParticipants: userId },
        ],
      }),
      Group.deleteMany({ createdBy: userId }),
      Activity.deleteMany({ userId }),
      // Clear materialized balance cache so dashboard/group balances reset
      Balance.deleteMany({ userId }),
    ]);

    // Recalculate balances for all affected groups so other members' records are correct
    for (const groupId of affectedGroupIds) {
      await recalculateGroupBalances(groupId).catch(() => {});
    }

    res.json({ message: 'All data cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
