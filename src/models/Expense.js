const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema(
  {
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    groupId:      { type: mongoose.Schema.Types.Mixed, ref: 'Group', required: true }, // ObjectId or 'direct'
    payerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount:       { type: Number, required: true, min: 0 },
    notes:        { type: String, default: '' },
    date:         { type: Date, default: Date.now },
    splitMethod:  { type: String, enum: ['equal', 'percentage', 'custom'], default: 'equal' },
    splitDetails: { type: Map, of: Number, default: {} },
    currency:     { type: String, default: 'USD' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Expense', ExpenseSchema);
