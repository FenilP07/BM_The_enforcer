import { z } from "zod";
import User from "../models/user.model.js";

const syncSchema = z.object({
  totalSuccess: z.number().int().min(0),
  totalFailures: z.number().int().min(0),
  successStreak: z.number().int().min(0),
});

function calcScore({ success, failures, streak }) {
  const total = success + failures;
  if (total === 0) return 100;
  const completionRate = success / total;
  const base = completionRate * 80;
  const streakBonus = Math.min(streak * 2, 15);
  const failurePenalty = Math.min(failures * 0.5, 15);
  const score = base + streakBonus - failurePenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export const syncStates = async (req, res, next) => {
  try {
    const { totalSuccess, totalFailures, successStreak } = syncSchema.parse(
      req.body,
    );

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (
      totalSuccess < user.totalSuccess ||
      totalFailures < user.totalFailures
    ) {
      return res.status(400).json({ message: "Totals cannot decrease" });
    }

    const disciplineScore = calcScore({
      success: totalSuccess,
      failures: totalFailures,
      streak: successStreak,
    });

    user.totalSuccess = totalSuccess;
    user.totalFailures = totalFailures;
    user.successStreak = successStreak;
    user.disciplineScore = disciplineScore;
    user.lastSyncedAt = new Date();

    await user.save();

    res.json({
      ok: true,
      disciplineScore,
      totals: { totalSuccess, totalFailures, successStreak },
    });
  } catch (error) {
    next(error);
  }
};
