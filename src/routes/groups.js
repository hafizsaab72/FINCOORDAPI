const router = require('express').Router();
const Group = require('../models/Group');
const Expense = require('../models/Expense');
const User = require('../models/User');
const Activity = require('../models/Activity');
const Balance = require('../models/Balance');
const requireAuth = require('../middleware/auth');
const {
  updateBalancesOnExpenseCreate,
  getGroupBalances,
  simplifyDebts: simplifyDebtsUtil,
  recalculateGroupBalances
} = require('../utils/balances');
const { toMinorUnits } = require('../utils/validation');

router.use(requireAuth);

// GET /api/groups — list all groups with per-group myBalance
router.get('/', async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const groups = await Group.find({ members: req.user._id })
      .populate('members', 'name email profilePic')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    const groupIds = groups.map(g => g._id.toString());

    // Use materialized per-user net balances for fast per-group summary
    const balances = await Balance.find({ groupId: { $in: groupIds } });

    // Index balances by groupId
    const balancesByGroup = {};
    for (const bal of balances) {
      if (!bal.userId) continue;
      const gid = bal.groupId.toString();
      if (!balancesByGroup[gid]) balancesByGroup[gid] = { users: new Map() };
      balancesByGroup[gid].users.set(bal.userId.toString(), bal.netBalance);
    }

    const result = groups.map(group => {
      const gid = group._id.toString();
      const groupBals = balancesByGroup[gid]?.users || new Map();

      // Build balance map for simplified debt computation
      const balanceMap = new Map();
      for (const member of group.members) {
        balanceMap.set(member._id.toString(), groupBals.get(member._id.toString()) || 0);
      }
      balanceMap.set(myId, groupBals.get(myId) || 0);

      // Compute simplified debts to find this user's position
      const simplified = simplifyDebtsUtil(balanceMap);
      let totalOwedToYou = 0;
      let totalYouOwe = 0;
      const topDebts = [];

      for (const tx of simplified) {
        if (tx.to === myId) {
          totalOwedToYou += tx.amount;
          const member = group.members.find(m => m._id.toString() === tx.from);
          topDebts.push({ userId: tx.from, name: member?.name ?? 'Unknown', net: tx.amount });
        }
        if (tx.from === myId) {
          totalYouOwe += tx.amount;
          const member = group.members.find(m => m._id.toString() === tx.to);
          topDebts.push({ userId: tx.to, name: member?.name ?? 'Unknown', net: -tx.amount });
        }
      }

      topDebts.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

      const obj = group.toObject();
      obj.myBalance = {
        net: parseFloat(((totalOwedToYou - totalYouOwe) / 100).toFixed(2)),
        totalOwedToYou: parseFloat((totalOwedToYou / 100).toFixed(2)),
        totalYouOwe: parseFloat((totalYouOwe / 100).toFixed(2)),
        topDebts: topDebts.slice(0, 3).map(d => ({
          ...d,
          net: parseFloat((d.net / 100).toFixed(2)),
        })),
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

    const balanceData = await getGroupBalances(req.params.id, myId);

    // Build a set of all userIds that appear in balance records,
    // so removed members with non-zero balances are still visible.
    const balanceUserIds = new Set(
      balanceData.userBalances.map(b => b.otherUserId.toString())
    );
    for (const member of group.members) {
      balanceUserIds.add(member._id.toString());
    }
    balanceUserIds.add(myId);

    // Look up names for any user not in the current member list
    // (e.g. a removed member whose balance hasn't been zeroed yet)
    const missingUserIds = [];
    for (const uid of balanceUserIds) {
      const found = group.members.find(m => m._id.toString() === uid);
      if (!found && uid !== myId) missingUserIds.push(uid);
    }
    const missingUsers = missingUserIds.length > 0
      ? await User.find({ _id: { $in: missingUserIds } }).select('name email profilePic')
      : [];
    const missingUserMap = new Map(missingUsers.map(u => [u._id.toString(), u]));

    const memberBalances = [];
    for (const uid of balanceUserIds) {
      if (uid === myId) {
        const me = group.members.find(m => m._id.toString() === myId);
        memberBalances.push({
          memberId: myId,
          name: me?.name ?? 'You',
          email: me?.email ?? '',
          profilePic: me?.profilePic,
          isMe: true,
          net: 0,
          isFormerMember: !group.members.some(m => m._id.toString() === myId),
        });
        continue;
      }

      const member = group.members.find(m => m._id.toString() === uid);
      const missing = missingUserMap.get(uid);
      const found = balanceData.userBalances.find(b => b.otherUserId.toString() === uid);
      const net = found ? found.netBalance : 0;

      // Skip former members who have been fully zeroed out after recalculation
      if (!member && !missing && Math.abs(net) < 0.005) continue;

      memberBalances.push({
        memberId: uid,
        name: member?.name ?? missing?.name ?? 'Unknown',
        email: member?.email ?? missing?.email ?? '',
        profilePic: member?.profilePic ?? missing?.profilePic,
        isMe: false,
        net,
        isFormerMember: !member,
      });
    }

    let simplifiedTransactions = null;
    if (group.simplifyDebts) {
      const balanceMap = new Map();
      for (const mb of memberBalances) {
        balanceMap.set(mb.memberId, mb.net);
      }
      // Ensure the current user is in the map even if they have no balance record
      const myBal = await Balance.findOne({ groupId: req.params.id, userId: req.user._id });
      balanceMap.set(myId, myBal ? myBal.netBalance : 0);

      simplifiedTransactions = simplifyDebtsUtil(balanceMap);
      for (const tx of simplifiedTransactions) {
        const fromMb = memberBalances.find(m => m.memberId === tx.from);
        const toMb = memberBalances.find(m => m.memberId === tx.to);
        tx.fromName = fromMb?.name ?? tx.from;
        tx.toName = toMb?.name ?? tx.to;
      }
    }

    res.json({
      totalOwedToYou: balanceData.totalOwedToYou,
      totalYouOwe: balanceData.totalYouOwe,
      memberBalances,
      simplifiedTransactions
    });
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
      Expense.find({ groupId: req.params.id, isDeleted: { $ne: true } })
        .sort({ expenseDate: -1 })
        .skip(skip)
        .limit(limit),
      Expense.countDocuments({ groupId: req.params.id, isDeleted: { $ne: true } }),
    ]);

    res.json({ expenses, total, hasMore: skip + limit < total });
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
    const { withMemberId, amount, paymentMethod, note } = req.body;
    const groupId = req.params.id;
    const myId = req.user._id.toString();

    // Verify group membership
    const group = await Group.findById(groupId)
      .populate('members', 'name');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m._id.toString() === myId)) {
      return res.status(403).json({ error: 'Not a member' });
    }

    // Use getGroupBalances to compute simplified debts
    const groupData = await getGroupBalances(groupId, req.user._id);

    // Find the simplified transaction between me and the other member
    const myTx = groupData.simplifiedTransactions.find(
      tx => (tx.from === myId && tx.to === withMemberId) || (tx.to === myId && tx.from === withMemberId)
    );

    if (!myTx) {
      return res.status(400).json({ error: 'No balance found with this member' });
    }

    // Determine who owes whom and how much
    const iOwe = myTx.from === myId ? myTx.amount : -myTx.amount;
    if (iOwe >= 0) {
      return res.status(400).json({
        error: 'You are not in debt with this member',
        currentBalance: -iOwe
      });
    }

    const maxSettlement = Math.min(
      amount ? Math.round(parseFloat(amount) * 100) : Math.abs(iOwe),
      Math.abs(iOwe)
    );

    if (maxSettlement <= 0) {
      return res.status(400).json({ error: 'Nothing to settle' });
    }

    // Create a settlement expense record (for audit trail)
    const settlementExpense = await Expense.create({
      title: note || `Settlement`,
      description: note || `Settlement with ${withMemberId}`,
      totalAmount: maxSettlement,
      baseCurrency: req.user.currency || 'INR',
      contextType: 'group',
      groupId,
      isSettlement: true,
      settlementFrom: myId,
      settlementTo: withMemberId,
      payments: [{ userId: myId, amount: maxSettlement }],
      splits: [{ userId: withMemberId, owedAmount: maxSettlement, shareType: 'exact' }],
      splitType: 'exact',
      createdBy: req.user._id,
      userId: req.user._id,
      category: 'settlement'
    });

    // Update balances (uses the same logic as regular expense creation)
    await updateBalancesOnExpenseCreate(settlementExpense, null);

    // Log activity
    const payerName = group.members.find(m => m._id.toString() === myId)?.name ?? 'Someone';
    const receiverName = group.members.find(m => m._id.toString() === withMemberId)?.name ?? 'Someone';
    await Activity.create({
      userId: req.user._id,
      action: 'Settled Up',
      detail: `${payerName} settled ${(maxSettlement / 100).toFixed(2)} with ${receiverName}`,
      expenseId: settlementExpense._id,
      groupId,
      metadata: {
        withMemberId,
        amount: maxSettlement,
        paymentMethod
      }
    });

    res.json({
      settled: maxSettlement,
      settlementExpenseId: settlementExpense._id,
      message: `Successfully settled ${(maxSettlement / 100).toFixed(2)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/recalculate-balances
router.post('/:id/recalculate-balances', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!group.members.some(m => m.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const result = await recalculateGroupBalances(req.params.id);
    res.json({ message: 'Balances recalculated', ...result });
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
    const { name, memberIds, type, icon, image, startDate, endDate, simplifyDebts } = req.body;
    const members = [...new Set([req.user._id.toString(), ...(memberIds || [])])];
    const group = await Group.create({
      name,
      createdBy: req.user._id,
      members,
      type: type || 'other',
      icon: icon || '',
      image: image || '',
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      simplifyDebts: simplifyDebts !== undefined ? simplifyDebts : true,
    });
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

// PATCH /api/groups/:id
router.patch('/:id', async (req, res) => {
  try {
    const { name, type, icon, image, startDate, endDate, simplifyDebts } = req.body;
    const patch = {};
    if (name !== undefined) patch.name = name.trim();
    if (type !== undefined) patch.type = type;
    if (icon !== undefined) patch.icon = icon;
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

// POST /api/groups/:id/members
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

// DELETE /api/groups/:id/members/:userId
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!group) return res.status(403).json({ error: 'Only the group creator can remove members' });
    if (req.params.userId === group.createdBy.toString()) {
      return res.status(400).json({ error: 'Cannot remove the group creator' });
    }
    group.members = group.members.filter(m => m.toString() !== req.params.userId);
    await group.save();

    // Recalculate balances so removed member's net is redistributed among remaining members.
    // This ensures simplified debts and per-member totals reflect the current membership.
    await recalculateGroupBalances(req.params.id);

    await group.populate('members', 'name email profilePic');
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id
router.delete('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const group = await Group.findOneAndDelete(
      { _id: req.params.id, createdBy: req.user._id }
    ).session(session);
    if (!group) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Group not found or not owner' });
    }

    // Cascade delete related data
    await Expense.deleteMany({ groupId: req.params.id }).session(session);
    await Balance.deleteMany({ groupId: req.params.id }).session(session);
    await Activity.deleteMany({ groupId: req.params.id }).session(session);

    await session.commitTransaction();
    res.json({ message: 'Deleted' });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
