const router = require('express').Router();
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const requireAuth = require('../middleware/auth');
const { sendPush } = require('../utils/push');

router.use(requireAuth);

// GET /api/friends — accepted friends list
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const accepted = await FriendRequest.find({
      $or: [{ sender: userId }, { receiver: userId }],
      status: 'accepted',
    })
      .populate('sender',   'name email profilePic')
      .populate('receiver', 'name email profilePic');

    const friends = accepted.map(r =>
      r.sender._id.toString() === userId.toString() ? r.receiver : r.sender,
    );

    res.json({ friends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/friends/requests — incoming pending requests
router.get('/requests', async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      receiver: req.user._id,
      status: 'pending',
    }).populate('sender', 'name email profilePic');

    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/friends/balances — per-friend balance breakdown by group
router.get('/balances', async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // All groups user is a member of
    const groups = await Group.find({ members: req.user._id }).select('_id name');
    const groupIds = groups.map(g => g._id);
    const groupMap = {};
    groups.forEach(g => { groupMap[g._id.toString()] = g.name; });

    // All expenses across those groups (regardless of who created them)
    const expenses = await Expense.find({ groupId: { $in: groupIds } });

    // balances[personId][groupId] = net (positive = they owe me, negative = I owe them)
    const balances = {};

    for (const exp of expenses) {
      const payerId = exp.payerId.toString();
      const gid = exp.groupId.toString();
      const splits = exp.splitDetails instanceof Map
        ? exp.splitDetails
        : new Map(Object.entries(exp.splitDetails || {}));

      if (splits.size === 0) continue;

      if (payerId === userId) {
        // I paid — others owe me their share
        for (const [mid, share] of splits.entries()) {
          if (mid === userId || Number(share) <= 0) continue;
          if (!balances[mid]) balances[mid] = {};
          balances[mid][gid] = (balances[mid][gid] || 0) + Number(share);
        }
      } else if (splits.has(userId)) {
        // Someone else paid — I owe them my share
        const myShare = Number(splits.get(userId));
        if (myShare > 0) {
          if (!balances[payerId]) balances[payerId] = {};
          balances[payerId][gid] = (balances[payerId][gid] || 0) - myShare;
        }
      }
    }

    // Fetch user details for all involved people
    const involvedIds = Object.keys(balances);
    const users = await User.find({ _id: { $in: involvedIds } }).select('name email profilePic');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    let totalOwedToYou = 0;
    let totalYouOwe = 0;
    const friends = [];

    for (const [fid, groupBalances] of Object.entries(balances)) {
      const netBalance = Object.values(groupBalances).reduce((a, b) => a + b, 0);
      if (Math.abs(netBalance) < 0.01) continue;

      if (netBalance > 0) totalOwedToYou += netBalance;
      else totalYouOwe += Math.abs(netBalance);

      const breakdown = Object.entries(groupBalances)
        .filter(([, amt]) => Math.abs(amt) >= 0.01)
        .map(([gid, amt]) => ({
          groupId: gid,
          groupName: groupMap[gid] || 'Unknown Group',
          amount: parseFloat(Math.abs(amt).toFixed(2)),
          direction: amt > 0 ? 'owes_you' : 'you_owe',
        }))
        .sort((a, b) => b.amount - a.amount);

      const user = userMap[fid];
      friends.push({
        friendId: fid,
        name: user?.name || 'Unknown',
        email: user?.email || '',
        profilePic: user?.profilePic,
        netBalance: parseFloat(netBalance.toFixed(2)),
        breakdown,
      });
    }

    friends.sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));

    res.json({
      totalOwedToYou: parseFloat(totalOwedToYou.toFixed(2)),
      totalYouOwe: parseFloat(totalYouOwe.toFixed(2)),
      friends,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/friends/request/:userId — send friend request
router.post('/request/:userId', async (req, res) => {
  try {
    if (req.params.userId === req.user._id.toString())
      return res.status(400).json({ error: 'Cannot send request to yourself' });

    const existing = await FriendRequest.findOne({
      $or: [
        { sender: req.user._id, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user._id },
      ],
    });
    if (existing)
      return res.status(409).json({ error: 'Request already exists' });

    const request = await FriendRequest.create({
      sender: req.user._id,
      receiver: req.params.userId,
    });

    // Push to receiver
    const receiver = await User.findById(req.params.userId).select('fcmToken');
    if (receiver?.fcmToken) {
      sendPush(receiver.fcmToken, {
        title: 'New Friend Request',
        body: `${req.user.name} wants to be your friend`,
        data: { type: 'friend_request', requestId: request._id.toString() },
      });
    }

    res.status(201).json({ request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/friends/accept/:requestId
router.put('/accept/:requestId', async (req, res) => {
  try {
    const request = await FriendRequest.findOneAndUpdate(
      { _id: req.params.requestId, receiver: req.user._id, status: 'pending' },
      { status: 'accepted' },
      { new: true },
    );
    if (!request) return res.status(404).json({ error: 'Request not found' });

    // Push to original sender
    const sender = await User.findById(request.sender).select('fcmToken');
    if (sender?.fcmToken) {
      sendPush(sender.fcmToken, {
        title: 'Friend Request Accepted',
        body: `${req.user.name} accepted your friend request`,
        data: { type: 'friend_accepted' },
      });
    }

    res.json({ request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/friends/reject/:requestId
router.put('/reject/:requestId', async (req, res) => {
  try {
    const request = await FriendRequest.findOneAndUpdate(
      { _id: req.params.requestId, receiver: req.user._id, status: 'pending' },
      { status: 'rejected' },
      { new: true },
    );
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json({ request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/friends/:friendId — remove friend or cancel sent request
router.delete('/:friendId', async (req, res) => {
  try {
    await FriendRequest.findOneAndDelete({
      $or: [
        { sender: req.user._id, receiver: req.params.friendId },
        { sender: req.params.friendId, receiver: req.user._id },
      ],
    });
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
