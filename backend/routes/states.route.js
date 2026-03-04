import express from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { syncStates } from "../controllers/states.controller.js";

const router = express.Router();

router.post("/sync", requireAuth, syncStates);

export default router;
