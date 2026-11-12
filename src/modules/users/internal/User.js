const { Schema } = require('mongoose');

/**
 * Users module owns `users` in users_db.
 * Other modules may store userId only — never query this collection.
 */
const addressSchema = new Schema(
  {
    line1: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    phone: { type: String, trim: true },
    address: { type: addressSchema, required: true },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: 'users',
  }
);

userSchema.index({ email: 1 }, { unique: true });

function createUserModel(connection) {
  return connection.models.User || connection.model('User', userSchema);
}

module.exports = { userSchema, createUserModel };
