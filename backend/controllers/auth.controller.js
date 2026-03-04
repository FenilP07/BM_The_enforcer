import { z } from "zod";
import User from "../models/user.model.js";
import bcrypt from "bcrypt";
import { config } from "../config/config.js";
import jwt from "jsonwebtoken";

const registerSchema = z.object({
  email: z.email(),
  name: z.string().min(2).max(50),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "30d" });
}

const userRegister = async (req, res, next) => {
  try {
    const { email, name, password } = registerSchema.parse(req.body);
    const exists = await User.findOne({
      email: email.toLowerCase(),
    });
    if (exists)
      return res.status(409).json({
        message: "Email already in use",
      });
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      email: email.toLowerCase(),
      name,
      passwordHash,
      disciplineScore: 0,
    });

    const token = signToken(user._id.toString());

    return res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        disciplineScore: user.disciplineScore,
      },
    });
  } catch (error) {
    next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({
      email: email.toLowerCase(),
    });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user._id.toString());

    return res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        disciplineScore: user.disciplineScore,
      },
    });
  } catch (error) {
    next(error);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user });
  } catch (err) {
    next(err);
  }
};

export { userRegister, loginUser, me };
