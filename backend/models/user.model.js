import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    totalSuccess: { type: Number, default: 0 },
    totalFailures: { type: Number, default: 0 },
    successStreak: { type: Number, default: 0 },

    disciplineScore: { type: Number, default: 0, index: true },
    lastSyncedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("User", userSchema);
