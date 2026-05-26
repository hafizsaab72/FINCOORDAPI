const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    type:          { type: String, enum: ['trip', 'home', 'couple', 'other'], default: 'other' },
    icon:          { type: String, default: '' },
    image:         { type: String, default: '' },
    startDate:     { type: Date },
    endDate:       { type: Date },
    simplifyDebts: { type: Boolean, default: true },
  },
  { timestamps: true },
);

GroupSchema.index({ members: 1, createdAt: -1 });

module.exports = mongoose.model('Group', GroupSchema);
