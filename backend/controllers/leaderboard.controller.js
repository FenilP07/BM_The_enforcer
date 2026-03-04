import User from "../models/user.model.js";

const SORT = {
  disciplineScore: -1,
  totalSuccess: -1,
  totalFailures: 1,
  updatedAt: 1,
};

export const globalLeaderboard = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const top = await User.find({})
      // @ts-ignore
      .sort(SORT)
      .limit(limit)
      .select("name disciplineScore totalSuccess totalFailures successStreak");

    res.json({ top });
  } catch (error) {
    next(error);
  }
};

export const leaderboard = async (req, res, next) => {
  try {
    const me = await User.findById(req.user.id).select(
      "name disciplineScore totalSuccess totalFailures successStreak",
    );
    if (!me) return res.status(404).json({ message: "User not found" });

    const rank =
      (await User.countDocuments({
        $or: [
          { disciplineScore: { $gt: me.disciplineScore } },
          {
            disciplineScore: me.disciplineScore,
            totalSuccess: { $gt: me.totalSuccess },
          },
          {
            disciplineScore: me.disciplineScore,
            totalSuccess: me.totalSuccess,
            totalFailures: { $lt: me.totalFailures },
          },
        ],
      })) + 1;

    res.json({ me, rank });
  } catch (err) {
    next(err);
  }
};
