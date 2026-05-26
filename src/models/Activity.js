const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action:    { type: String, required: true },
    detail:    { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },

    // Link to source expense / group for deep-linking
    expenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', index: true },
    groupId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },
    metadata:  { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: false },
);

// Index for fetching activities by context
ActivitySchema.index({ userId: 1, timestamp: -1 });
ActivitySchema.index({ userId: 1, groupId: 1, timestamp: -1 });

module.exports = mongoose.model('Activity', ActivitySchema);
