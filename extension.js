const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

let heartbeatTimer = null;
let statusBarItem = null;
let outputChannel = null;

function activate(context) {
  initializeState(context);

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
  checkForFailures(context);

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
  );
}

function initializeState(context) {
  const state = context.globalState.get("enforcerState");
  const config = vscode.workspace.getConfiguration("enforcer");
  if (!state) {
    context.globalState.update("enforcerState", {
      tasks: [],
      maxSlots: config.get("maxSlots") || 3,
      lockoutUntil: null,
      successStreak: 0,
      totalSuccess: 0,
      totalFailures: 0,
    });
  }
}

function getState(context) {
  return context.globalState.get("enforcerState");
}

function updateState(context, updates) {
  const state = getState(context);
  const newState = { ...state, ...updates };
  context.globalState.update("enforcerState", newState);
  updateStatusBar(context);
  updateContextKeys(context);
}

function updateContextKeys(context) {
  const state = getState(context);
  const locked = isLockedOut(context);
  const hasTasks = state.tasks.length > 0;
  vscode.commands.executeCommand("setContext", "enforcer.isLockedOut", locked);
  vscode.commands.executeCommand(
    "setContext",
    "enforcer.hasActiveTasks",
    hasTasks,
  );
}

// RESTORED: Old High-Contrast Status Bar Look
function updateStatusBar(context) {
  const state = getState(context);
  const activeTasks = state.tasks.length;
  const locked = isLockedOut(context);

  const slots =
    "█".repeat(activeTasks) +
    "░".repeat(Math.max(0, state.maxSlots - activeTasks));
  let statusText = `BM: [${slots}] ${activeTasks}/${state.maxSlots}`;

  if (locked) statusText += " 🔒 LOCKED";
  else if (
    state.maxSlots <
    (vscode.workspace.getConfiguration("enforcer").get("maxSlots") || 3)
  ) {
    statusText += " ⚠ CAPACITY REDUCED";
  }

  statusBarItem.text = statusText;
}

function isLockedOut(context) {
  const state = getState(context);
  return state.lockoutUntil && Date.now() < state.lockoutUntil;
}

function startHeartbeat(context) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => checkForExpiredTasks(context), 60000);
}

function checkForExpiredTasks(context) {
  const state = getState(context);
  const config = vscode.workspace.getConfiguration("enforcer");
  const lifetimeMs = (config.get("taskLifetimeHours") || 24) * 60 * 60 * 1000;
  const now = Date.now();
  const expiredTasks = state.tasks.filter(
    (t) => now - t.createdAt > lifetimeMs,
  );

  if (expiredTasks.length > 0) handleTaskExpiry(context, expiredTasks);
}

function checkForFailures(context) {
  checkForExpiredTasks(context);
  if (isLockedOut(context)) {
    const state = getState(context);
    const remainingMin = Math.ceil((state.lockoutUntil - Date.now()) / 60000);
    vscode.window.showErrorMessage(
      `[SYSTEM: CRITICAL FAILURE] LOCKED OUT FOR ${remainingMin}m.`,
      { modal: true },
    );
  }
}

function handleTaskExpiry(context, expiredTasks) {  
  const state = getState(context);
  const config = vscode.workspace.getConfiguration("enforcer");
  if (config.get("shameLogEnabled")) writeShameLog(expiredTasks);

  const lockoutMs = (config.get("lockoutMinutes") || 30) * 60 * 1000;
  const newMaxSlots = Math.max(1, state.maxSlots - 1);
  updateState(context, {
    tasks: state.tasks.filter((t) => !expiredTasks.some((e) => e.id === t.id)),
    maxSlots: newMaxSlots,
    lockoutUntil: Date.now() + lockoutMs,
    successStreak: 0,
    totalFailures: state.totalFailures + expiredTasks.length,
  });
  vscode.window.showErrorMessage(
    `[SYSTEM: CRITICAL FAILURE] ${expiredTasks.length} TASK(S) EXPIRED.`,
    { modal: true },
  );
}

function writeShameLog(expiredTasks) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return;
  const shamePath = path.join(folders[0].uri.fsPath, ".bm_shame");
  const entries =
    expiredTasks
      .map((t) => `[FAIL] ${new Date().toISOString()} | "${t.text}"`)
      .join("\n") + "\n";
  try {
    fs.appendFileSync(shamePath, entries);
  } catch (err) {}
}

// RESTORED: Brutalist Box-Drawing List
function listTasks(context) {
  const state = getState(context);
  const config = vscode.workspace.getConfiguration("enforcer");
  const lifetimeMs = (config.get("taskLifetimeHours") || 24) * 60 * 60 * 1000;
  const now = Date.now();
  const width = 66;

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
        `${String(i + 1).padStart(2, "0")}. ${t.text.substring(0, 30)}`.padEnd(
          35,
          ".",
        );
      outputChannel.appendLine(`│ ${taskPart} [${h}h ${m}m REMAINING] │`);
    });
  }

  outputChannel.appendLine(`└${"─".repeat(width - 2)}┘`);
  if (state.maxSlots < (config.get("maxSlots") || 3)) {
    outputChannel.appendLine(
      `\n[RECOVERY]: ${state.successStreak}/2 completions to restore slot.`,
    );
  }
  outputChannel.show(true);
}

async function addTask(context) {
  const state = getState(context);
  if (isLockedOut(context)) return;
  if (state.tasks.length >= state.maxSlots)
    return vscode.window.showErrorMessage("NO SLOTS AVAILABLE.");

  const taskText = await vscode.window.showInputBox({
    prompt: "Enter Objective (24h limit)",
    validateInput: (t) => (!t?.trim() ? "Task cannot be empty" : null),
  });
  if (!taskText) return;

  state.tasks.push({
    id: Date.now(),
    text: taskText.trim(),
    createdAt: Date.now(),
  });
  updateState(context, { tasks: state.tasks });
  vscode.window.showInformationMessage(
    "Objective registered. 24h countdown started.",
  );
}

async function completeTask(context) {
  const state = getState(context);
  if (state.tasks.length === 0) return;
  const pick = await vscode.window.showQuickPick(
    state.tasks.map((t, i) => ({ label: `${i + 1}. ${t.text}`, task: t })),
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

  updateState(context, {
    tasks: state.tasks.filter((t) => t.id !== pick.task.id),
    successStreak: newStreak,
    maxSlots: newMaxSlots,
    totalSuccess: state.totalSuccess + 1,
  });
  vscode.window.showInformationMessage("Task completed.");
}

async function apologize(context) {
  if (!isLockedOut(context)) return;
  const phrase = "I will respect my deadlines";
  const input = await vscode.window.showInputBox({
    prompt: `Type EXACTLY: "${phrase}"`,
    validateInput: (t) => (t === phrase ? null : "Incorrect."),
  });
  if (input === phrase) {
    updateState(context, { lockoutUntil: null });
    vscode.window.showWarningMessage("Lockout cleared. Do not fail again.");
  }
}

function showStatus(context) {
  const state = getState(context);
  vscode.window.showInformationMessage(
    `Tasks: ${state.tasks.length}/${state.maxSlots} | Success: ${state.totalSuccess} | Failures: ${state.totalFailures}`,
  );
}

function deactivate() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (statusBarItem) statusBarItem.dispose();
}

module.exports = { activate, deactivate };
