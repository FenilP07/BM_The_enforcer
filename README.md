# THE ENFORCER

A Brutalist, command-line driven task-limiter that punishes procrastination and rewards execution.

## Philosophy

- **Forced Focus**: Maximum 3 tasks. No exceptions.
- **The 24-Hour Rule**: Tasks are "living" entities. If they aren't killed (completed) within 24 hours, they kill your productivity (lockout).
- **Functional Guilt**: Failure results in system degradation, social shame (logs), and mechanical lockouts.
- **Zero UI**: No mouse, no sidebars, no buttons. Only commands.

## Installation

1. Copy this extension folder to your VS Code extensions directory:
   - **Windows**: `%USERPROFILE%\.vscode\extensions\`
   - **macOS/Linux**: `~/.vscode/extensions/`

2. Reload VS Code

3. The Enforcer is now active

## Commands

Access all commands via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

| Command | Action |
|---------|--------|
| `BM: Add Task` | Register a new task (fails if locked out or slots full) |
| `BM: List Tasks` | Display active tasks with countdown timers |
| `BM: Complete Task` | Mark a task as done (increments rehabilitation) |
| `BM: Apologize` | Clear lockout early by typing a shame string |
| `BM: Show Status` | View lifetime statistics and current state |

## The Stakes System

### Slot Demotion
- **Start**: 3 task slots
- **Failure Penalty**: Each expired task reduces maximum slots by 1 (minimum: 1)
- **Rehabilitation**: Complete 2 tasks consecutively on time to restore 1 lost slot

### The Lockout
When a task expires:
- **Input Freeze**: `BM: Add Task` disabled for 30 minutes
- **Early Release**: Type `BM: Apologize` and enter the randomly generated shame string exactly

### The Shame Log
- **Location**: `.bm_shame` file in your workspace root
- **Automatic Entry**: Each failure appends a timestamped record
- **Social Pressure**: Option to commit failures to Git

## Status Bar

The Enforcer displays real-time status in the VS Code status bar (bottom-left):

```
BM: [███░] 3/3
BM: [██░] 2/3 !! CAPACITY REDUCED !!
BM: [█░] 1/2 !! CAPACITY REDUCED !! [LOCKED]
```

Click the status bar to view full task list.

## Example Workflow

```
1. Add task: Cmd+Shift+P → "BM: Add Task" → "Refactor authentication"
   [SYSTEM: OPTIMIZED] Task registered. You have 24 hours. Don't fail.

2. Check status: Cmd+Shift+P → "BM: List Tasks"
   ┌──────────────────────────────────────────────┐
   │  THE ENFORCER | SLOTS: [█░░] 1/3 ACTIVE      │
   ├──────────────────────────────────────────────┤
   │ 01. Refactor authentication..[ 23h 54m REMAINING] │
   └──────────────────────────────────────────────┘

3. Complete task: Cmd+Shift+P → "BM: Complete Task" → Select task
   [SYSTEM: OPTIMIZED] Task completed. Well done.

4. If you fail:
   [SYSTEM: CRITICAL FAILURE]
   
   TASKS EXPIRED:
     - Refactor authentication
   
   PENALTIES:
   - CAPACITY REDUCED: 3 → 2
   - LOCKOUT: 30 MINUTES
   - SHAME LOG UPDATED
```

## Technical Details

### State Management
All state is stored in VS Code's `globalState`:
- `tasks`: Array of active tasks with timestamps
- `maxSlots`: Current maximum task capacity (1-3)
- `lockoutUntil`: Timestamp when lockout expires (null if not locked)
- `successStreak`: Consecutive completions toward rehabilitation
- `totalSuccess`: Lifetime completed tasks
- `totalFailures`: Lifetime expired tasks

### Heartbeat Check
Every 5 minutes, The Enforcer checks for expired tasks and immediately triggers penalties.

### Startup Behavior
On VS Code startup, The Enforcer:
1. Checks for any tasks that expired while offline
2. Applies all accumulated penalties
3. Shows lockout notification if applicable

## Non-Goals

❌ No "snooze" button  
❌ No task editing (once committed, you do it or you fail)  
❌ No cloud sync (your failures stay on your machine)  
❌ No "easy mode"  

## License

MIT - Use at your own psychological risk.

## Warning

This extension is designed to create stress and accountability through negative reinforcement. It is a productivity tool for those who respond to pressure and consequences. If you prefer positive reinforcement or have anxiety around deadlines, **this is not for you**.

The shame log can be committed to Git. Be aware of what you're exposing if working in shared repositories.
