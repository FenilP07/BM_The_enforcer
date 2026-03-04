import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.route.js";
import statesRoutes from "./routes/states.route.js";
import leaderboardRoutes from "./routes/leaderboard.route.js";
import { errorHandler, notFound } from "./middlewares/error.middleware.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(morgan("dev"));

  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/health", (req, res) =>
    res.json({
      ok: true,
    }),
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/stats", statesRoutes);
  app.use("/api/leaderboard", leaderboardRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
