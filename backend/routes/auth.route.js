import express from "express";
import { loginUser, me, userRegister } from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/register", userRegister);
router.post("/login", loginUser);
router.get("/me", requireAuth, me);

export default router;
