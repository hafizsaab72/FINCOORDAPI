const router = require('express').Router();
const Expense = require('../models/Expense');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /api/export?format=csv|json
router.get('/', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const expenses = await Expense.find({ createdBy: req.user._id }).sort({ expenseDate: -1 });

    const cleanExpenses = expenses.map(e => ({
      type: 'expense',
      id: e._id,
      date: e.expenseDate,
      title: e.title,
      description: e.description || e.notes,
      amount: e.totalAmount != null ? (e.totalAmount / 100).toFixed(2) : null,
      currency: e.baseCurrency,
      groupId: e.groupId?.toString(),
      splitMethod: e.splitType,
      category: e.category,
    }));

    if (format === 'csv') {
      const rows = [
        'Type,ID,Date,Title,Description,Amount,Currency,Category,GroupID,SplitMethod',
      ];
      for (const item of cleanExpenses) {
        rows.push([
          item.type,
          item.id,
          new Date(item.date).toISOString(),
          `"${(item.title || '').replace(/"/g, '""')}"`,
          `"${(item.description || '').replace(/"/g, '""')}"`,
          item.amount,
          item.currency,
          item.category || '',
          item.groupId || '',
          item.splitMethod || '',
        ].join(','));
      }
      const csv = rows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=fincoord_export.csv');
      res.send(csv);
    } else {
      res.json({ data: cleanExpenses });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
