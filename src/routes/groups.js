const router = require('express').Router();
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

/**
 * Compute per-person net balances from current user's POV.
 * Returns Record<userId, net> — positive = they owe me, negative = I owe them.
 */
function computeBalances(expenses, myId) {
  const balances = {};

  for (const expense of expenses) {
    const payerId = expense.payerId.toString();
    const amount = expense.amount;
    const splitMethod = expense.splitMethod;
    const splitDetails = Object.fromEntries(expense.splitDetails || new Map());
    const participants = Object.keys(splitDetails);

    if (participants.length === 0) continue;

    const getShare = (userId) => {
      if (splitMethod === 'equal') return amount / participants.length;
      if (splitMethod === 'percentage') return (amount * (splitDetails[userId] || 0)) / 100;
      return splitDetails[userId] || 0;
    };

    if (payerId === myId) {
      // I paid — each other participant owes me their share
      for (const userId of participants) {
        if (userId === myId) continue;
        const share = getShare(userId);
        if (share > 0.001) {
          balances[userId] = (balances[userId] || 0) + share;
        }
      }
    } else if (participants.includes(myId)) {
      // Someone else paid and I have a share — I owe the payer
      const myShare = getShare(myId);
      if (myShare > 0.001) {
        balances[payerId] = (balances[payerId] || 0) - myShare;
      }
    }
  }

  return balances;
}

// GET /api/groups — list all groups with per-group myBalance
router.get('/', async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const groups = await Group.find({ members: req.user._id })
      .populate('members', 'name email profilePic')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    const groupIds = groups.map(g => g._id);
    const allExpenses = await Expense.find({ groupId: { $in: groupIds } });

    // Index expenses by groupId
    const expensesByGroup = {};
    for (const expense of allExpenses) {
      const gid = expense.groupId.toString();
      if (!expensesByGroup[gid]) expensesByGroup[gid] = [];
      expensesByGroup[gid].push(expense);
    }

    const result = groups.map(group => {
      const gid = group._id.toString();
      const expenses = expensesByGroup[gid] || [];
      const balances = computeBalances(expenses, myId);

      let totalOwedToYou = 0;
      let totalYouOwe = 0;
      const topDebts = [];

      for (const [userId, net] of Object.entries(balances)) {
        if (net > 0.005) {
          totalOwedToYou += net;
          const member = group.members.find(m => m._id.toString() === userId);
          topDebts.push({ userId, name: member?.name ?? 'Unknown', net });
        } else if (net < -0.005) {
          totalYouOwe += Math.abs(net);
        }
      }

      topDebts.sort((a, b) => b.net - a.net);

      const obj = group.toObject();
      obj.myBalance = {
        net: totalOwedToYou - totalYouOwe,
        totalOwedToYou,
        totalYouOwe,
        topDebts: topDebts.slice(0, 3),
      };
      return obj;
    });

    res.json({ groups: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/balances — per-member net balances
router.get('/:id/balances', async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const group = await Group.findById(req.params.id)
      .populate('members', 'name email profilePic');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m._id.toString() === myId)) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const expenses = await Expense.find({ groupId: group._id });
    const balances = computeBalances(expenses, myId);

    let totalOwedToYou = 0;
    let totalYouOwe = 0;
    const memberBalances = [];

    for (const member of group.members) {
      const memberId = member._id.toString();
      if (memberId === myId) {
        memberBalances.push({
          memberId, name: member.name, email: member.email,
          profilePic: member.profilePic, isMe: true, net: 0,
        });
        continue;
      }
      const net = balances[memberId] || 0;
      if (net > 0.005) totalOwedToYou += net;
      else if (net < -0.005) totalYouOwe += Math.abs(net);
      memberBalances.push({
        memberId, name: member.name, email: member.email,
        profilePic: member.profilePic, isMe: false, net,
      });
    }

    res.json({ totalOwedToYou, totalYouOwe, memberBalances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/expenses — paginated expenses in group
router.get('/:id/expenses', async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const group = await Group.findById(req.params.id).select('members');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m.toString() === myId)) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const skip = parseInt(req.query.skip) || 0;

    const [expenses, total] = await Promise.all([
      Expense.find({ groupId: req.params.id }).sort({ date: -1 }).skip(skip).limit(limit),
      Expense.countDocuments({ groupId: req.params.id }),
    ]);

    const result = expenses.map(e => ({
      ...e.toObject(),
      payerId: e.payerId.toString(),
      splitDetails: Object.fromEntries(e.splitDetails || new Map()),
    }));

    res.json({ expenses: result, total, hasMore: skip + limit < total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/leave — leave a group (non-creator only)
router.post('/:id/leave', async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m.toString() === myId)) {
      return res.status(403).json({ error: 'Not a member' });
    }
    if (group.createdBy.toString() === myId) {
      return res.status(400).json({ error: 'Group creator cannot leave. Delete the group instead.' });
    }
    group.members = group.members.filter(m => m.toString() !== myId);
    await group.save();
    res.json({ message: 'Left group' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/settle — record a settlement payment
router.post('/:id/settle', async (req, res) => {
  try {
    const { payerId, receiverId, amount, currency } = req.body;
    if (!payerId || !receiverId || !amount) {
      return res.status(400).json({ error: 'payerId, receiverId, and amount are required' });
    }
    const group = await Group.findById(req.params.id)
      .populate('members', 'name');
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const memberIds = group.members.map(m => m._id.toString());
    if (!memberIds.includes(payerId) || !memberIds.includes(receiverId)) {
      return res.status(400).json({ error: 'Both users must be group members' });
    }

    const expense = await Expense.create({
      userId: req.user._id,
      groupId: group._id,
      payerId,
      amount: parseFloat(amount),
      notes: 'Settlement',
      splitMethod: 'custom',
      splitDetails: { [receiverId]: parseFloat(amount) },
      currency: currency || req.user.currency || 'USD',
    });

    const payerName = group.members.find(m => m._id.toString() === payerId)?.name ?? 'Someone';
    const receiverName = group.members.find(m => m._id.toString() === receiverId)?.name ?? 'Someone';
    await Activity.create({
      userId: req.user._id,
      action: 'Settled Up',
      detail: `${payerName} paid ${receiverName} ${currency || ''}${parseFloat(amount).toFixed(2)}`,
    });

    res.status(201).json({
      expense: {
        ...expense.toObject(),
        payerId: expense.payerId.toString(),
        splitDetails: Object.fromEntries(expense.splitDetails || new Map()),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id
router.get('/:id', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members', 'name email profilePic')
      .populate('createdBy', 'name email');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Not a member' });
    }
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups
router.post('/', async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    const members = [...new Set([req.user._id.toString(), ...(memberIds || [])])];
    const group = await Group.create({ name, createdBy: req.user._id, members });
    await group.populate('members', 'name email profilePic');

    await Activity.create({
      userId: req.user._id,
      action: 'Created Group',
      detail: name,
    });

    res.status(201).json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/groups/:id — update group fields (name, type, image, dates, simplifyDebts)
router.patch('/:id', async (req, res) => {
  try {
    const { name, type, image, startDate, endDate, simplifyDebts } = req.body;
    const patch = {};
    if (name !== undefined) patch.name = name.trim();
    if (type !== undefined) patch.type = type;
    if (image !== undefined) patch.image = image;
    if (startDate !== undefined) patch.startDate = startDate || null;
    if (endDate !== undefined) patch.endDate = endDate || null;
    if (simplifyDebts !== undefined) patch.simplifyDebts = simplifyDebts;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const group = await Group.findOneAndUpdate(
      { _id: req.params.id, members: req.user._id },
      patch,
      { new: true },
    )
      .populate('members', 'name email profilePic')
      .populate('createdBy', 'name email');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/members — add a member by userId
router.post('/:id/members', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const group = await Group.findOneAndUpdate(
      { _id: req.params.id, members: req.user._id },
      { $addToSet: { members: userId } },
      { new: true },
    )
      .populate('members', 'name email profilePic')
      .populate('createdBy', 'name email');
    if (!group) return res.status(404).json({ error: 'Group not found' });

    await Activity.create({
      userId: req.user._id,
      action: 'Added Member',
      detail: group.name,
    });

    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id/members/:userId — remove a member (only creator)
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!group) return res.status(403).json({ error: 'Only the group creator can remove members' });
    if (req.params.userId === group.createdBy.toString()) {
      return res.status(400).json({ error: 'Cannot remove the group creator' });
    }
    group.members = group.members.filter(m => m.toString() !== req.params.userId);
    await group.save();
    await group.populate('members', 'name email profilePic');
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id
router.delete('/:id', async (req, res) => {
  try {
    const group = await Group.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!group) return res.status(404).json({ error: 'Group not found or not owner' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
