const router = require('express').Router();
const Expense = require('../models/Expense');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');
const { scanReceipt } = require('../utils/ocr');

// All routes require auth
router.use(requireAuth);

// GET /api/expenses?groupId=...
router.get('/', async (req, res) => {
  try {
    const filter = { userId: req.user._id };
    if (req.query.groupId) filter.groupId = req.query.groupId;
    const expenses = await Expense.find(filter).sort({ date: -1 });
    res.json({ expenses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses
router.post('/', async (req, res) => {
  try {
    const { groupId, payerId, amount, notes, date, splitMethod, splitDetails, currency } = req.body;
    const expense = await Expense.create({
      userId: req.user._id,
      groupId,
      payerId: payerId || req.user._id.toString(),
      amount,
      notes,
      date,
      splitMethod,
      splitDetails,
      currency: currency || req.user.currency,
    });

    await Activity.create({
      userId: req.user._id,
      action: 'Added Expense',
      detail: notes || `${currency || req.user.currency}${Number(amount).toFixed(2)}`,
    });

    res.status(201).json({ expense });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
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
