const router = require('express').Router();
const Expense = require('../models/Expense');
const Bill = require('../models/Bill');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /api/export?format=csv|json
router.get('/', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const expenses = await Expense.find({ userId: req.user._id }).sort({ date: -1 });
    const bills = await Bill.find({ userId: req.user._id }).sort({ dueDate: -1 });

    const cleanExpenses = expenses.map(e => ({
      type: 'expense',
      id: e._id,
      date: e.date,
      description: e.notes,
      amount: e.amount,
      currency: e.currency,
      groupId: e.groupId?.toString(),
      splitMethod: e.splitMethod,
    }));

    const cleanBills = bills.map(b => ({
      type: 'bill',
      id: b._id,
      date: b.dueDate,
      description: b.title,
      amount: b.amount,
      currency: b.currency,
      category: b.category,
      status: b.status,
    }));

    const data = [...cleanExpenses, ...cleanBills];

    if (format === 'csv') {
      const rows = [
        'Type,ID,Date,Description,Amount,Currency,Category,Status,GroupID,SplitMethod',
      ];
      for (const item of data) {
        rows.push([
          item.type,
          item.id,
          new Date(item.date).toISOString(),
          `"${(item.description || '').replace(/"/g, '""')}"`,
          item.amount,
          item.currency,
          item.category || '',
          item.status || '',
          item.groupId || '',
          item.splitMethod || '',
        ].join(','));
      }
      const csv = rows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=fincoord_export.csv');
      res.send(csv);
    } else {
      res.json({ data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
