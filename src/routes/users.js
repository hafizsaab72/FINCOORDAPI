const router = require('express').Router();
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const requireAuth = require('../middleware/auth');

// GET /api/users/search?q=name_or_email&includeFriends=true
// Returns users not already friends or pending, excludes self.
// Pass includeFriends=true to also include accepted friends (e.g. group member search).
router.get('/search', requireAuth, async (req, res) => {
  try {
    const { q, includeFriends } = req.query;
    if (!q || q.trim().length < 2)
      return res.json({ users: [] });

    const userId = req.user._id;

    // Find all active relationships involving current user
    const requests = await FriendRequest.find({
      $or: [{ sender: userId }, { receiver: userId }],
      status: { $ne: 'rejected' },
    }).select('sender receiver status');

    // Build exclusion set — always exclude self and pending/sent requests.
    // When includeFriends=true, accepted friends are NOT excluded so they
    // can be found for group-member searches.
    const excludeIds = new Set([userId.toString()]);
    const relationMap = {}; // userId → { status, requestId, direction }
    requests.forEach(r => {
      const otherId =
        r.sender.toString() === userId.toString()
          ? r.receiver.toString()
          : r.sender.toString();
      const isAccepted = r.status === 'accepted';
      if (!(includeFriends === 'true' && isAccepted)) {
        excludeIds.add(otherId);
      }
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
        { phone: { $regex: q.trim().replace(/\D/g, '').slice(-10) } },
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

// POST /api/users/match-contacts — match device contacts against registered users
router.post('/match-contacts', requireAuth, async (req, res) => {
  try {
    const { phones = [], emails = [] } = req.body;
    const userId = req.user._id;

    // Normalize phone numbers to last 10 digits
    const normalizedPhones = [...new Set(
      phones
        .map(p => p.replace(/\D/g, ''))
        .filter(p => p.length >= 7)
        .map(p => p.slice(-10)),
    )];

    const normalizedEmails = [...new Set(
      emails.map(e => e.toLowerCase().trim()).filter(Boolean),
    )];

    if (normalizedPhones.length === 0 && normalizedEmails.length === 0) {
      return res.json({ users: [] });
    }

    // Build exclusion set from existing relationships
    const existing = await FriendRequest.find({
      $or: [{ sender: userId }, { receiver: userId }],
      status: { $ne: 'rejected' },
    }).select('sender receiver');

    const excludeIds = new Set([userId.toString()]);
    existing.forEach(r => {
      excludeIds.add(r.sender.toString());
      excludeIds.add(r.receiver.toString());
    });

    // Build match clauses
    const orClauses = [];
    if (normalizedEmails.length > 0) {
      orClauses.push({ email: { $in: normalizedEmails } });
    }
    // Match phones where stored value ends with the normalized 10-digit string
    normalizedPhones.forEach(p => {
      orClauses.push({ phone: { $regex: p + '$' } });
    });

    const users = await User.find({
      _id: { $nin: [...excludeIds] },
      $or: orClauses,
    })
      .select('name email profilePic phone')
      .limit(100);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/device-token — register FCM token after login
router.post('/device-token', requireAuth, async (req, res) => {
  try {
    const { token: fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'token required' });
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
