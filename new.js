const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let heartbeatTimer = null;
let statusBarItem = null;
let outputChannel = null;

function apiBaseUrl() {
  const config = vscode.workspace.getConfiguration("enforcer");
  return String(config.get("apiBaseUrl") || "http://localhost:4000").replace(
    /\/$/,
    "",
  );
}

async function getToken(context) {
  return await context.secrets.get("enforcer.token");
}

async function setToken(context, token) {
  await context.secrets.store("enforcer.token", token);
}

// @ts-ignore
async function clearToken(context) {
  await context.secrets.delete("enforcer.token");
}

// @ts-ignore
async function authedFetch(context, url, options = {}) {
  const token = await getToken(context);
  if (!token) throw new Error("Not logged in. Run: Enforcer: Login");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  return json;
}

async function activate(context) {
  await initializeState(context);

  outputChannel = vscode.window.createOutputChannel("The Enforcer");
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "enforcer.list";
  context.subscriptions.push(statusBarItem);

  updateStatusBar(context);
  updateContextKeys(context);
  statusBarItem.show();

  startHeartbeat(context);
  await checkForFailures(context);

  // React to config changes (production polish)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration("enforcer")) return;

      const config = vscode.workspace.getConfiguration("enforcer");
      const defaultMax = config.get("maxSlots") || 3;

      const state = getState(context);
      if (!state) return;

      // Policy: never exceed configured max (if user lowers it)
      if (state.maxSlots > defaultMax) {
        await updateState(context, { maxSlots: defaultMax });
        outputChannel?.appendLine(
          `[CONFIG] maxSlots capped to ${defaultMax} due to settings change.`,
        );
      } else {
        updateStatusBar(context);
        updateContextKeys(context);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("enforcer.add", () => addTask(context)),
    vscode.commands.registerCommand("enforcer.list", () => listTasks(context)),
    vscode.commands.registerCommand("enforcer.done", () =>
      completeTask(context),
    ),
    vscode.commands.registerCommand("enforcer.status", () =>
      showStatus(context),
    ),
    vscode.commands.registerCommand("enforcer.apology", () =>
      apologize(context),
    ),
    vscode.commands.registerCommand("enforcer.login", () => login(context)),
    vscode.commands.registerCommand("enforcer.logout", () => logout(context)),
    vscode.commands.registerCommand("enforcer.leaderboard", () =>
      openLeaderboard(context),
    ),
    vscode.commands.registerCommand("enforcer.register", () =>
      register(context),
    ),
  );
}

async function initializeState(context) {
  const state = context.globalState.get("enforcerState");
  const config = vscode.workspace.getConfiguration("enforcer");

  if (!state) {
    await context.globalState.update("enforcerState", {
      tasks: [],
      maxSlots: config.get("maxSlots") || 3,
      lockoutUntil: null,
      successStreak: 0,
      totalSuccess: 0,
      totalFailures: 0,
    });
    return;
  }

  // Normalize older states / ensure required fields exist (safe migrations)
  const normalized = {
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    maxSlots:
      typeof state.maxSlots === "number"
        ? state.maxSlots
        : config.get("maxSlots") || 3,
    lockoutUntil: state.lockoutUntil ?? null,
    successStreak: state.successStreak ?? 0,
    totalSuccess: state.totalSuccess ?? 0,
    totalFailures: state.totalFailures ?? 0,
  };

  // Cap by current config maxSlots (policy)
  const defaultMax = config.get("maxSlots") || 3;
  if (normalized.maxSlots > defaultMax) normalized.maxSlots = defaultMax;

  await context.globalState.update("enforcerState", normalized);
}

function getState(context) {
  return context.globalState.get("enforcerState");
}

async function updateState(context, updates) {
  const state = getState(context) || {};
  const newState = { ...state, ...updates };
  await context.globalState.update("enforcerState", newState);
  updateStatusBar(context);
  updateContextKeys(context);
}

function updateContextKeys(context) {
  const state = getState(context);
  if (!state) return;

  const locked = isLockedOut(context);
  const hasTasks = state.tasks.length > 0;
  vscode.commands.executeCommand("setContext", "enforcer.isLockedOut", locked);
  vscode.commands.executeCommand(
    "setContext",
    "enforcer.hasActiveTasks",
    hasTasks,
  );
}

function updateStatusBar(context) {
  if (!statusBarItem) return;

  const state = getState(context);
  if (!state) return;

  const activeTasks = state.tasks.length;
  const locked = isLockedOut(context);
  const config = vscode.workspace.getConfiguration("enforcer");
  const lifetimeMs = (config.get("taskLifetimeHours") || 24) * 60 * 60 * 1000;
  const now = Date.now();

  let blockChar = "█"; // Default: Solid
  let warningIcon = "";

  if (activeTasks > 0 && !locked) {
    const oldestTask = state.tasks.reduce((oldest, current) =>
      current.createdAt < oldest.createdAt ? current : oldest,
    );
    const timeRemaining = lifetimeMs - (now - oldestTask.createdAt);

    // 1. Determine Block "Decay"
    if (timeRemaining < 2 * 60 * 60 * 1000) {
      blockChar = "░"; // Critical: Faded
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
      warningIcon = "🔥 ";
    } else if (timeRemaining < 6 * 60 * 60 * 1000) {
      blockChar = "▒"; // Warning: Light shade
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
      warningIcon = "⚠️ ";
    } else if (timeRemaining < 12 * 60 * 60 * 1000) {
      blockChar = "▓"; // Half-way: Dark shade
      statusBarItem.backgroundColor = undefined;
    } else {
      blockChar = "█"; // Fresh: Solid
      statusBarItem.backgroundColor = undefined;
    }
  } else if (locked) {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
  } else {
    statusBarItem.backgroundColor = undefined;
  }

  // 2. Build the visual "Battery"
  const slots =
    blockChar.repeat(activeTasks) +
    ".".repeat(Math.max(0, state.maxSlots - activeTasks));

  const defaultMax = config.get("maxSlots") || 3;
  let statusText = `${warningIcon}BM: [${slots}] ${activeTasks}/${state.maxSlots}`;

  if (locked) statusText = "🚫 SYSTEM LOCKED";
  else if (state.maxSlots < defaultMax) statusText += " ⚠ REDUCED";

  statusBarItem.text = statusText;
}

function isLockedOut(context) {
  const state = getState(context);
  return state?.lockoutUntil && Date.now() < state.lockoutUntil;
}

function startHeartbeat(context) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  // Avoid unhandled promise rejections in timers
  heartbeatTimer = setInterval(() => {
    updateStatusBar(context);
    void checkForExpiredTasks(context);
  }, 60000);
}

async function checkForExpiredTasks(context) {
  const state = getState(context);
  if (!state) return;

  const config = vscode.workspace.getConfiguration("enforcer");
  const lifetimeMs = (config.get("taskLifetimeHours") || 24) * 60 * 60 * 1000;

  const now = Date.now();
  const expiredTasks = state.tasks.filter(
    (t) => now - t.createdAt > lifetimeMs,
  );

  if (expiredTasks.length > 0) await handleTaskExpiry(context, expiredTasks);
}

async function checkForFailures(context) {
  await checkForExpiredTasks(context);

  if (isLockedOut(context)) {
    const state = getState(context);
    const remainingMin = Math.ceil((state.lockoutUntil - Date.now()) / 60000);

    vscode.window.showErrorMessage(
      `[SYSTEM: CRITICAL FAILURE] LOCKED OUT FOR ${remainingMin}m.`,
      { modal: true },
    );
  }
}

async function handleTaskExpiry(context, expiredTasks) {
  const state = getState(context);
  if (!state) return;

  const config = vscode.workspace.getConfiguration("enforcer");

  if (config.get("shameLogEnabled")) await writeShameLog(context, expiredTasks);

  const lockoutMs = (config.get("lockoutMinutes") || 30) * 60 * 1000;
  const newMaxSlots = Math.max(1, state.maxSlots - 1);

  const expiredIds = new Set(expiredTasks.map((t) => t.id));
  const remainingTasks = state.tasks.filter((t) => !expiredIds.has(t.id));

  await updateState(context, {
    tasks: remainingTasks,
    maxSlots: newMaxSlots,
    lockoutUntil: Date.now() + lockoutMs,
    successStreak: 0,
    totalFailures: state.totalFailures + expiredTasks.length,
  });

  vscode.window.showErrorMessage(
    `[SYSTEM: CRITICAL FAILURE] ${expiredTasks.length} TASK(S) EXPIRED.`,
    { modal: true },
  );
  debounce(() => {
    syncStats(context).catch((e) => {
      outputChannel?.appendLine(`[SYNC] ${String(e?.message || e)}`);
    });
  }, 1200);
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function getRank(success, failures) {
  const total = success + failures;
  if (total === 0) return { title: "NEOPHYTE", icon: "🌱" };

  const ratio = (success / total) * 100;

  if (ratio >= 90) return { title: "PARAGON", icon: "💎" };
  if (ratio >= 75) return { title: "DISCIPLINED", icon: "⚔️" };
  if (ratio >= 50) return { title: "SLACKER", icon: "🐌" };
  if (ratio >= 25) return { title: "UNRELIABLE", icon: "⚠️" };
  return { title: "TARGET FOR ELIMINATION", icon: "💀" };
}

async function writeShameLog(context, expiredTasks) {
  try {
    const baseDir = context.globalStorageUri.fsPath;
    await ensureDir(baseDir);

    const shamePath = path.join(baseDir, ".bm_shame");
    const entries =
      expiredTasks
        .map((t) => `[FAIL] ${new Date().toISOString()} | "${t.text}"`)
        .join("\n") + "\n";

    await fs.promises.appendFile(shamePath, entries, "utf8");
  } catch (err) {
    outputChannel?.appendLine(
      `[ERROR] Failed to write shame log: ${String(err)}`,
    );
  }
}

function listTasks(context) {
  const state = getState(context);
  if (!state) return;

  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("The Enforcer");
  }

  const config = vscode.workspace.getConfiguration("enforcer");
  const lifetimeMs = (config.get("taskLifetimeHours") || 24) * 60 * 60 * 1000;
  const now = Date.now();
  const width = 66;

  const rank = getRank(state.totalSuccess, state.totalFailures);
  const total = state.totalSuccess + state.totalFailures;
  const ratio =
    total === 0 ? 100 : Math.round((state.totalSuccess / total) * 100);

  outputChannel.clear();
  outputChannel.appendLine(`┌${"─".repeat(width - 2)}┐`);
  outputChannel.appendLine(
    `│   THE ENFORCER | SLOTS: ${state.tasks.length}/${state.maxSlots} ACTIVE`.padEnd(
      width - 1,
    ) + "│",
  );
  outputChannel.appendLine(`├${"─".repeat(width - 2)}┤`);

  if (state.tasks.length === 0) {
    outputChannel.appendLine(
      `│ [SYSTEM: OPTIMIZED] NO ACTIVE OBJECTIVES`.padEnd(width - 1) + "│",
    );
  } else {
    state.tasks.forEach((t, i) => {
      const rem = Math.max(0, lifetimeMs - (now - t.createdAt));
      const h = String(Math.floor(rem / 3600000)).padStart(2, "0");
      const m = String(Math.floor((rem % 3600000) / 60000)).padStart(2, "0");
      const taskPart =
        `${String(i + 1).padStart(2, "0")}. ${String(t.text).substring(0, 30)}`.padEnd(
          35,
          ".",
        );
      outputChannel.appendLine(`│ ${taskPart} [${h}h ${m}m REMAINING] │`);
    });
  }

  outputChannel.appendLine(`└${"─".repeat(width - 2)}┘`);

  outputChannel.appendLine(`├${"─".repeat(width - 2)}┤`);
  outputChannel.appendLine(
    `│ EFFICIENCY: ${ratio}% | RANK: ${rank.icon} ${rank.title}`.padEnd(
      width - 1,
    ) + "│",
  );
  outputChannel.appendLine(`└${"─".repeat(width - 2)}┘`);

  const defaultMax = config.get("maxSlots") || 3;
  if (state.maxSlots < defaultMax) {
    outputChannel.appendLine(
      `\n[RECOVERY]: ${state.successStreak}/2 completions to restore slot.`,
    );
  }

  outputChannel.show(true);
}

async function addTask(context) {
  const state = getState(context);
  if (!state) return;

  if (isLockedOut(context)) {
    const remainingMin = Math.ceil((state.lockoutUntil - Date.now()) / 60000);
    return vscode.window.showErrorMessage(
      `LOCKED OUT (${remainingMin}m remaining).`,
      { modal: true },
    );
  }

  if (state.tasks.length >= state.maxSlots) {
    return vscode.window.showErrorMessage("NO SLOTS AVAILABLE.");
  }

  const taskText = await vscode.window.showInputBox({
    prompt: "Enter Objective (24h limit)",
    validateInput: (t) => (!t?.trim() ? "Task cannot be empty" : null),
  });

  if (!taskText) return;

  const newTask = {
    id: crypto.randomUUID(),
    text: taskText.trim(),
    createdAt: Date.now(),
  };

  await updateState(context, { tasks: [...state.tasks, newTask] });

  vscode.window.showInformationMessage(
    "Objective registered. 24h countdown started.",
  );

  // Optional: immediate check (deterministic behavior)
  await checkForExpiredTasks(context);
}

async function completeTask(context) {
  const state = getState(context);
  if (!state) return;

  if (state.tasks.length === 0) return;

  if (isLockedOut(context)) {
    const remainingMin = Math.ceil((state.lockoutUntil - Date.now()) / 60000);
    return vscode.window.showErrorMessage(
      `LOCKED OUT (${remainingMin}m remaining).`,
      { modal: true },
    );
  }

  const pick = await vscode.window.showQuickPick(
    state.tasks.map((t, i) => ({ label: `${i + 1}. ${t.text}`, task: t })),
    { placeHolder: "Select objective to mark complete" },
  );

  if (!pick) return;

  let newStreak = state.successStreak + 1;
  let newMaxSlots = state.maxSlots;

  const defaultMax =
    vscode.workspace.getConfiguration("enforcer").get("maxSlots") || 3;

  if (newStreak >= 2 && state.maxSlots < defaultMax) {
    newMaxSlots++;
    newStreak = 0;
    vscode.window.showInformationMessage(
      "[SYSTEM: RESTORED] Slot capacity increased.",
    );
  }

  await updateState(context, {
    // @ts-ignore
    tasks: state.tasks.filter((t) => t.id !== pick.task.id),
    successStreak: newStreak,
    maxSlots: newMaxSlots,
    totalSuccess: state.totalSuccess + 1,
  });

  vscode.window.showInformationMessage("Task completed.");
  debounce(() => {
    syncStats(context).catch((e) => {
      outputChannel?.appendLine(`[SYNC] ${String(e?.message || e)}`);
    });
  }, 1200);
}

async function apologize(context) {
  const state = getState(context);
  if (!state) return;

  if (!isLockedOut(context)) return;

  const phrase = "I will respect my deadlines";
  const input = await vscode.window.showInputBox({
    prompt: `Type EXACTLY: "${phrase}"`,
    validateInput: (t) => (t === phrase ? null : "Incorrect."),
  });

  if (input === phrase) {
    await updateState(context, { lockoutUntil: null });
    vscode.window.showWarningMessage("Lockout cleared. Do not fail again.");
  }
}

function showStatus(context) {
  const state = getState(context);
  if (!state) return;

  vscode.window.showInformationMessage(
    `Tasks: ${state.tasks.length}/${state.maxSlots} | Success: ${state.totalSuccess} | Failures: ${state.totalFailures}`,
  );
}

function deactivate() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (statusBarItem) statusBarItem.dispose();
  if (outputChannel) outputChannel.dispose();
}

// @ts-ignore
async function login(context) {
  const base = apiBaseUrl();

  const email = await vscode.window.showInputBox({
    prompt: "Email",
    validateInput: (v) => (!v?.includes("@") ? "Enter a valid email" : null),
  });
  if (!email) return;

  const password = await vscode.window.showInputBox({
    prompt: "Password",
    password: true,
    validateInput: (v) => (!v || v.length < 8 ? "Min 8 characters" : null),
  });
  if (!password) return;

  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));
  // @ts-ignore
  if (!res.ok) throw new Error(data?.message || "Login failed");

  // @ts-ignore
  await setToken(context, data.token);
  vscode.window.showInformationMessage(
    // @ts-ignore
    `Logged in as ${data.user?.name || email}`,
  );
}

// @ts-ignore
async function logout(context) {
  await clearToken(context);
  vscode.window.showInformationMessage("Logged out.");
}

// @ts-ignore
async function register(context) {
  const base = apiBaseUrl();

  const name = await vscode.window.showInputBox({
    prompt: "Name",
    validateInput: (v) => (!v?.trim() ? "Enter your name" : null),
  });
  if (!name) return;

  const email = await vscode.window.showInputBox({
    prompt: "Email",
    validateInput: (v) => (!v?.includes("@") ? "Enter a valid email" : null),
  });
  if (!email) return;

  const password = await vscode.window.showInputBox({
    prompt: "Password (min 8 chars)",
    password: true,
    validateInput: (v) => (!v || v.length < 8 ? "Min 8 characters" : null),
  });
  if (!password) return;

  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });

  const data = await res.json().catch(() => ({}));
  // @ts-ignore
  if (!res.ok) throw new Error(data?.message || "Register failed");

  // @ts-ignore
  await setToken(context, data.token);
  vscode.window.showInformationMessage(
    // @ts-ignore
    `Registered & logged in as ${data.user?.name || email}`,
  );
}

let syncTimer = null;
// @ts-ignore
// @ts-ignore
function debounce(fn, ms) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void fn(), ms);
}

// @ts-ignore
// @ts-ignore
async function syncStats(context) {
  const token = await getToken(context);
  if (!token) return; // silently skip if not logged in

  const state = getState(context);
  if (!state) return;

  const base = apiBaseUrl();

  await authedFetch(context, `${base}/api/stats/sync`, {
    method: "POST",
    body: JSON.stringify({
      totalSuccess: state.totalSuccess || 0,
      totalFailures: state.totalFailures || 0,
      successStreak: state.successStreak || 0,
    }),
  });
}

function badgeFor(score) {
  if (score >= 90) return "💎 PARAGON";
  if (score >= 75) return "⚔️ DISCIPLINED";
  if (score >= 50) return "🐌 SLACKER";
  if (score >= 25) return "⚠️ UNRELIABLE";
  return "💀 TARGET";
}

// @ts-ignore
async function openLeaderboard(context) {
  const base = apiBaseUrl();

  const panel = vscode.window.createWebviewPanel(
    "enforcerLeaderboard",
    "The Enforcer — Leaderboard",
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  async function loadData() {
    const topRes = await fetch(`${base}/api/leaderboard/global?limit=50`);
    const topJson = await topRes.json().catch(() => ({}));

    let meJson = null;
    try {
      meJson = await authedFetch(context, `${base}/api/leaderboard/me`, {
        method: "GET",
      });
    } catch {}

    // @ts-ignore
    return { top: topJson.top || [], me: meJson };
  }

  async function render() {
    const { top, me } = await loadData();

    panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: ui-sans-serif, system-ui; padding: 16px; }
  h2 { margin: 0 0 8px; }
  .muted { opacity: .7; font-size: 12px; margin-bottom: 12px; }
  .row { display:flex; justify-content:space-between; padding:10px 12px; border:1px solid #3333; border-radius:12px; margin:8px 0; }
  .me { border-color: #6d28d9; box-shadow: 0 0 0 2px #6d28d933; }
  .right { text-align:right; }
  button { padding: 8px 10px; border-radius: 10px; border:1px solid #3333; cursor:pointer; }
</style>
</head>
<body>
  <h2>Global Leaderboard</h2>
  <div class="muted">Tip: Run “Enforcer: Login” to see your personal rank.</div>
  <p><button id="refresh">Refresh</button></p>

  <div id="me">
    ${
      me?.me
        ? `<div class="row me">
            <div><b>#${me.rank}</b> ${me.me.name}<div class="muted">${badgeFor(me.me.disciplineScore)}</div></div>
            <div class="right"><b>${me.me.disciplineScore}</b><div class="muted">Streak ${me.me.successStreak || 0}</div></div>
          </div>`
        : `<div class="muted">Not logged in (your rank hidden).</div>`
    }
  </div>

  <div id="list">
    ${top
      .map(
        (u, i) => `
          <div class="row">
            <div><b>#${i + 1}</b> ${u.name}<div class="muted">${badgeFor(u.disciplineScore)}</div></div>
            <div class="right"><b>${u.disciplineScore}</b><div class="muted">S ${u.totalSuccess || 0} | F ${u.totalFailures || 0}</div></div>
          </div>
        `,
      )
      .join("")}
  </div>

<script>
  const vscode = acquireVsCodeApi();
  document.getElementById("refresh").addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });
</script>
</body>
</html>`;
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === "refresh") {
      await render();
    }
  });

  await render();
}

module.exports = { activate, deactivate };
