const router = require('express').Router();
const Bill = require('../models/Bill');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /api/bills
router.get('/', async (req, res) => {
  try {
    const bills = await Bill.find({ userId: req.user._id }).sort({ dueDate: 1 });
    res.json({ bills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bills
router.post('/', async (req, res) => {
  try {
    const { title, amount, dueDate, isRecurring, category, currency } = req.body;
    const bill = await Bill.create({
      userId: req.user._id,
      title,
      amount,
      dueDate,
      isRecurring: isRecurring ?? false,
      category: category || 'General',
      currency: currency || req.user.currency,
    });

    await Activity.create({
      userId: req.user._id,
      action: 'Added Bill',
      detail: `${title} — ${currency || req.user.currency}${Number(amount).toFixed(2)}`,
    });

    res.status(201).json({ bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bills/:id — edit a bill
router.put('/:id', async (req, res) => {
  try {
    const { title, amount, dueDate, isRecurring, category, currency } = req.body;
    const patch = {};
    if (title !== undefined) patch.title = title.trim();
    if (amount !== undefined) patch.amount = parseFloat(amount);
    if (dueDate !== undefined) patch.dueDate = dueDate;
    if (isRecurring !== undefined) patch.isRecurring = isRecurring;
    if (category !== undefined) patch.category = category;
    if (currency !== undefined) patch.currency = currency;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const bill = await Bill.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      patch,
      { new: true },
    );
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json({ bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bills/:id/handle
router.put('/:id/handle', async (req, res) => {
  try {
    const bill = await Bill.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status: 'handled' },
      { new: true },
    );
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    await Activity.create({
      userId: req.user._id,
      action: 'Bill Handled',
      detail: bill.title,
    });

    res.json({ bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bills/:id
router.delete('/:id', async (req, res) => {
  try {
    const bill = await Bill.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
