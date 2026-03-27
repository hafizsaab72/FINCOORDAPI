const router = require('express').Router();
const Expense = require('../models/Expense');
const Bill = require('../models/Bill');
const Group = require('../models/Group');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');

// DELETE /api/data — wipe all data for the authenticated user
router.delete('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    await Promise.all([
      Expense.deleteMany({ userId }),
      Bill.deleteMany({ userId }),
      Group.deleteMany({ createdBy: userId }),
      Activity.deleteMany({ userId }),
    ]);
    res.json({ message: 'All data cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
