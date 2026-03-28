const router = require('express').Router();
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');
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
