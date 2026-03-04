import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDB() {
  if (!config.mongoUri) throw new Error("Missing MONGO_URI)");
  await mongoose.connect(config.mongoUri);
  console.log("Connected to MongoDB");
}
