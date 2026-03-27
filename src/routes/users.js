const router = require('express').Router();
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const requireAuth = require('../middleware/auth');

// GET /api/users/search?q=name_or_email
// Returns users not already friends or pending, excludes self
router.get('/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2)
      return res.json({ users: [] });

    const userId = req.user._id;

    // Find all active relationships involving current user
    const requests = await FriendRequest.find({
      $or: [{ sender: userId }, { receiver: userId }],
      status: { $ne: 'rejected' },
    }).select('sender receiver status');

    // Build exclusion set and relationship map
    const excludeIds = new Set([userId.toString()]);
    const relationMap = {}; // userId → { status, requestId, direction }
    requests.forEach(r => {
      const otherId =
        r.sender.toString() === userId.toString()
          ? r.receiver.toString()
          : r.sender.toString();
      excludeIds.add(otherId);
      relationMap[otherId] = {
        status: r.status,
        requestId: r._id,
        direction: r.sender.toString() === userId.toString() ? 'sent' : 'received',
      };
    });

    const users = await User.find({
      _id: { $nin: [...excludeIds] },
      $or: [
        { name:  { $regex: q.trim(), $options: 'i' } },
        { email: { $regex: q.trim(), $options: 'i' } },
      ],
    })
      .select('name email profilePic')
      .limit(20);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/invite/:userId — public, no auth required (for deep link landing)
router.get('/invite/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('name email profilePic');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
