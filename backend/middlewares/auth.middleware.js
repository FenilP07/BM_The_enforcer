import jwt from "jsonwebtoken";
import { config } from "../config/config.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // FIXED: Changed from req.userId to req.user for consistency
    req.user = { id: payload.sub };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid Token" });
  }
}
