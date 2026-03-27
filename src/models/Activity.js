const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action:    { type: String, required: true },
    detail:    { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

module.exports = mongoose.model('Activity', ActivitySchema);
