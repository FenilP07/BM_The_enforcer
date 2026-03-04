import express from "express";
import {
  globalLeaderboard,
  leaderboard,
} from "../controllers/leaderboard.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/global", globalLeaderboard);
router.get("/me", requireAuth, leaderboard);

export default router;
