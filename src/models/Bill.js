const mongoose = require('mongoose');

const BillSchema = new mongoose.Schema(
  {
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title:       { type: String, required: true, trim: true },
    amount:      { type: Number, required: true, min: 0 },
    dueDate:     { type: Date, required: true },
    isRecurring: { type: Boolean, default: false },
    status:      { type: String, enum: ['pending', 'handled', 'overdue'], default: 'pending' },
    category:    { type: String, default: 'General' },
    currency:    { type: String, default: 'USD' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Bill', BillSchema);
