const router = require('express').Router();
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
const Group = require('../models/Group');
const Balance = require('../models/Balance');
const Expense = require('../models/Expense');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');
const { sendPush } = require('../utils/push');
const { getNonGroupBalancesPerspective, simplifyDebts } = require('../utils/balances');

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

    // Use materialized Balance collection (fast, consistent with new schema)
    const balances = await Balance.find({
      groupId: { $in: groupIds }
    });

    const personMap = new Map();
    for (const bal of balances) {
      if (!bal.userId) continue; // skip old/invalid records
      const otherId = bal.userId.toString();
      if (otherId === userId) continue; // skip self

      // netBalance is from that user's perspective
      // positive = they are owed, negative = they owe
      // From my perspective: if they owe (negative), I might be owed
      // We need to compute the effective pairwise net from simplified debts
      // For now, use raw net as approximation
      const net = -bal.netBalance; // invert: if they owe, I might be owed

      if (!personMap.has(otherId)) {
        personMap.set(otherId, {
          friendId: otherId,
          totalOwedToYou: 0,
          totalYouOwe: 0,
          netBalance: 0,
          breakdown: []
        });
      }

      const p = personMap.get(otherId);
      const groupName = groupMap[bal.groupId?.toString()] || 'Direct';

      p.netBalance += net;
      if (net > 0) p.totalOwedToYou += net;
      else if (net < 0) p.totalYouOwe += Math.abs(net);

      p.breakdown.push({
        groupId: bal.groupId?.toString() || null,
        groupName,
        amount: parseFloat((Math.abs(net) / 100).toFixed(2)),
        direction: net > 0 ? 'owes_you' : 'you_owe',
      });
    }

    // 2. Non-group (direct) balances
    const nonGroupMap = await getNonGroupBalancesPerspective(userId);

    for (const [otherId, data] of nonGroupMap) {
      if (otherId === userId) continue;
      if (!personMap.has(otherId)) {
        personMap.set(otherId, {
          friendId: otherId,
          totalOwedToYou: 0,
          totalYouOwe: 0,
          netBalance: 0,
          breakdown: []
        });
      }

      const p = personMap.get(otherId);
      p.netBalance += data.net;
      if (data.net > 0) p.totalOwedToYou += data.net;
      else if (data.net < 0) p.totalYouOwe += Math.abs(data.net);

      p.breakdown.push({
        groupId: null,
        groupName: 'Direct',
        amount: parseFloat((Math.abs(data.net) / 100).toFixed(2)),
        direction: data.net > 0 ? 'owes_you' : 'you_owe',
      });
    }

    // Fetch user details for all involved people
    const involvedIds = Array.from(personMap.keys());
    const users = await User.find({ _id: { $in: involvedIds } }).select('name email profilePic');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    let totalOwedToYou = 0;
    let totalYouOwe = 0;
    const friends = [];

    for (const p of personMap.values()) {
      const netBalance = p.netBalance / 100; // convert to major units
      if (Math.abs(netBalance) < 0.01) continue;

      if (netBalance > 0) totalOwedToYou += p.totalOwedToYou / 100;
      else totalYouOwe += p.totalYouOwe / 100;

      const breakdown = p.breakdown
        .filter(b => b.amount >= 0.01)
        .sort((a, b) => b.amount - a.amount);

      const user = userMap[p.friendId];
      friends.push({
        friendId: p.friendId,
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

// GET /api/friends/requests/sent — outgoing pending requests
router.get('/requests/sent', async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      sender: req.user._id,
      status: 'pending',
    }).populate('receiver', 'name email profilePic');
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/friends/:friendId/remind — send payment reminder push
router.post('/:friendId/remind', async (req, res) => {
  try {
    const friend = await User.findById(req.params.friendId).select('fcmToken name');
    if (!friend) return res.status(404).json({ error: 'User not found' });
    if (friend.fcmToken) {
      sendPush(friend.fcmToken, {
        title: 'Payment Reminder',
        body: `${req.user.name} is reminding you about a pending balance`,
        data: { type: 'payment_reminder', fromUserId: req.user._id.toString() },
      });
    }
    res.json({ sent: true });
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

// POST /api/friends/:friendId/settle — record a direct friend-to-friend settlement
router.post('/:friendId/settle', async (req, res) => {
  try {
    const friendId = req.params.friendId;
    const myId = req.user._id.toString();
    const { amount, note } = req.body;

    // 1. Compute the simplified debt between me and this friend
    const nonGroupMap = await getNonGroupBalancesPerspective(myId);
    const netFromSimplified = nonGroupMap.get(friendId)?.net ?? 0;

    // netFromSimplified > 0  → friend owes me (in minor units)
    // netFromSimplified < 0  → I owe friend (in minor units)
    if (Math.abs(netFromSimplified) < 1) {
      return res.status(400).json({ error: 'No balance with this friend. Add an expense first.' });
    }

    const iOwe = netFromSimplified; // positive = I owe them
    const maxSettlement = Math.min(
      amount ? Math.round(parseFloat(amount) * 100) : Math.abs(iOwe),
      Math.abs(iOwe),
    );

    if (maxSettlement <= 0) {
      return res.status(400).json({ error: 'Nothing to settle.' });
    }

    // 2. Verify friend relationship
    const friendUser = await User.findById(friendId).select('name');
    const friendName = friendUser?.name || 'Unknown';

    // 3. Create a settlement expense (groupId = null → direct expense)
    const settlementExpense = await Expense.create({
      title: note || 'Settlement',
      description: note || `Settlement with ${friendName}`,
      totalAmount: maxSettlement,
      baseCurrency: req.user.currency || 'INR',
      contextType: 'non_group',
      groupId: null,
      directParticipants: [myId, friendId],
      isSettlement: true,
      settlementFrom: myId,
      settlementTo: friendId,
      payments: [{ userId: myId, amount: maxSettlement }],
      splits: [{ userId: friendId, owedAmount: maxSettlement, shareType: 'exact' }],
      splitType: 'exact',
      createdBy: req.user._id,
      userId: req.user._id,
      category: 'settlement',
    });

    // 4. Update balances
    const { updateBalancesOnExpenseCreate } = require('../utils/balances');
    await updateBalancesOnExpenseCreate(settlementExpense, null);

    // 5. Log activity
    await Activity.create({
      userId: req.user._id,
      action: 'Settled Up',
      detail: `${req.user.name} settled ${(maxSettlement / 100).toFixed(2)} with ${friendName}`,
      expenseId: settlementExpense._id,
      metadata: { withFriendId: friendId, amount: maxSettlement },
    });

    res.json({
      settled: maxSettlement,
      settlementExpenseId: settlementExpense._id,
      message: `Successfully settled ${(maxSettlement / 100).toFixed(2)}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
