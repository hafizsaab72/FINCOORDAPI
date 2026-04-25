const router = require('express').Router();
const Group = require('../models/Group');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

// GET /api/groups
router.get('/', async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id })
      .populate('members', 'name email profilePic')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    res.json({ groups });
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

// PATCH /api/groups/:id — rename (any member can rename)
router.patch('/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const group = await Group.findOneAndUpdate(
      { _id: req.params.id, members: req.user._id },
      { name: name.trim() },
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
