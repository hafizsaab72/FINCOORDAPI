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
