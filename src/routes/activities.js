const router = require('express').Router();
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /api/activities?limit=20
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const activities = await Activity.find({ userId: req.user._id })
      .sort({ timestamp: -1 })
      .limit(limit);
    res.json({ activities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
