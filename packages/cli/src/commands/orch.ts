/**
 * Orch Command
 *
 * Orchestration layer management via the fleet server.
 *
 * Usage:
 *   kyberbot orch status                    — Dashboard overview
 *   kyberbot orch init                      — Initialize orchestration
 *   kyberbot orch org                       — Show org chart
 *   kyberbot orch org set <agent>           — Set/update org node
 *   kyberbot orch org remove <agent>        — Remove from org chart
 *   kyberbot orch goals                     — List goals
 *   kyberbot orch goals create              — Create a goal
 *   kyberbot orch goals <id>                — Goal detail
 *   kyberbot orch issues                    — List issues (kanban)
 *   kyberbot orch issues create             — Create an issue
 *   kyberbot orch issues <id>               — Issue detail
 *   kyberbot orch issues assign <id> <agent>
 *   kyberbot orch issues transition <id> <status>
 *   kyberbot orch inbox                     — Pending inbox items
 *   kyberbot orch inbox resolve <id>        — Resolve inbox item
 *   kyberbot orch activity                  — Activity log
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getServerPort } from '../config.js';

const PRIMARY = chalk.hex('#10b981');
const ACCENT = chalk.hex('#22d3ee');
const WARN = chalk.hex('#f59e0b');
const DIM = chalk.dim;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getFleetPort(): number {
  try { return getServerPort(); } catch { return 3456; }
}

async function orchFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const port = getFleetPort();
  const url = `http://localhost:${port}/fleet/orch${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const token = process.env.KYBERBOT_API_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

function handleConnectionError(error: unknown): never {
  if ((error as Error).name === 'AbortError') {
    console.error(chalk.red('Error: Fleet server not responding (timeout)'));
  } else {
    console.error(chalk.red('Error: Could not reach fleet server. Is it running?'));
    console.error(DIM('  Try: kyberbot fleet start'));
  }
  process.exit(1);
}

function priorityColor(p: string): string {
  switch (p) {
    case 'critical': return chalk.red(p);
    case 'high': return chalk.hex('#f59e0b')(p);
    case 'medium': return ACCENT(p);
    case 'low': return DIM(p);
    default: return p;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'done': case 'completed': case 'resolved': return chalk.green(s);
    case 'in_progress': case 'active': return ACCENT(s);
    case 'blocked': return chalk.red(s);
    case 'cancelled': return DIM(s);
    case 'in_review': return chalk.hex('#a78bfa')(s);
    default: return chalk.white(s);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

export function createOrchCommand(): Command {
  const orch = new Command('orch')
    .description('Orchestration layer — goals, issues, org chart');

  // ── status ────────────────────────────────────────────────────────
  orch
    .command('status')
    .description('Dashboard overview')
    .action(async () => {
      try {
        const res = await orchFetch('/dashboard');
        if (!res.ok) { console.error(chalk.red('Error fetching dashboard')); process.exit(1); }
        const data = await res.json() as any;

        console.log();
        console.log(PRIMARY.bold('  Orchestration Dashboard'));
        console.log();

        // Org
        if (data.org.length > 0) {
          console.log(`  ${DIM('Agents:')}  ${data.org.map((n: any) => `${ACCENT(n.agent_name)} (${n.role})`).join(', ')}`);
        } else {
          console.log(`  ${DIM('Agents:')}  ${DIM('No org chart configured. Run: kyberbot orch init')}`);
        }

        // Goals
        console.log(`  ${DIM('Goals:')}   ${PRIMARY(data.goals.active)} active, ${data.goals.completed} completed (${data.goals.total} total)`);

        // Issues
        const c = data.issues.counts;
        const parts = [
          c.in_progress ? `${ACCENT(c.in_progress)} in progress` : null,
          c.todo ? `${c.todo} todo` : null,
          c.blocked ? `${chalk.red(c.blocked)} blocked` : null,
          c.backlog ? `${DIM(c.backlog)} backlog` : null,
          c.in_review ? `${c.in_review} in review` : null,
          c.done ? `${chalk.green(c.done)} done` : null,
        ].filter(Boolean);
        console.log(`  ${DIM('Issues:')}  ${parts.length > 0 ? parts.join(', ') : DIM('none')}`);

        // Inbox
        if (data.inbox.pending > 0) {
          console.log(`  ${DIM('Inbox:')}   ${WARN(`${data.inbox.pending} pending`)}`);
        } else {
          console.log(`  ${DIM('Inbox:')}   ${DIM('clear')}`);
        }

        // Recent activity
        if (data.activity.length > 0) {
          console.log();
          console.log(`  ${DIM('Recent Activity')}`);
          for (const e of data.activity.slice(0, 5)) {
            const time = new Date(e.created_at).toLocaleTimeString();
            console.log(`    ${DIM(time)} ${ACCENT(e.actor)} ${e.action} ${DIM(e.entity_type)}${e.entity_id ? ` #${e.entity_id}` : ''}`);
          }
        }
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  // ── init ──────────────────────────────────────────────────────────
  orch
    .command('init')
    .description('Initialize orchestration — set CEO, build org chart')
    .option('--ceo <agent>', 'Designate CEO agent')
    .action(async (options: { ceo?: string }) => {
      try {
        // Get fleet agents
        const fleetRes = await fetch(`http://localhost:${getFleetPort()}/fleet`);
        if (!fleetRes.ok) { console.error(chalk.red('Fleet not running')); process.exit(1); }
        const fleet = await fleetRes.json() as any;
        const agents = fleet.agents.filter((a: any) => a.status !== 'unreachable');

        if (agents.length === 0) {
          console.error(chalk.red('No agents in fleet. Register agents first.'));
          process.exit(1);
        }

        console.log();
        console.log(PRIMARY.bold('  Initializing Orchestration'));
        console.log();

        // Set up org chart from fleet
        const ceoName = options.ceo || agents[0].name;
        let first = true;
        for (const agent of agents) {
          const isCeo = agent.name === ceoName;
          await orchFetch(`/org/${agent.name}`, {
            method: 'PUT',
            body: JSON.stringify({
              role: isCeo ? 'CEO' : 'engineer',
              title: isCeo ? 'Chief Executive Officer' : 'Engineer',
              reports_to: isCeo ? null : ceoName,
              is_ceo: isCeo,
            }),
          });
          const icon = isCeo ? '👑' : '  ';
          console.log(`  ${icon} ${ACCENT(agent.name)} — ${isCeo ? 'CEO' : `reports to ${ceoName}`}`);
          first = false;
        }

        console.log();
        console.log(PRIMARY('  Orchestration initialized.'));
        console.log(DIM('  Set goals: kyberbot orch goals create'));
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  // ── org ───────────────────────────────────────────────────────────
  const orgCmd = orch
    .command('org')
    .description('Show org chart');

  orgCmd
    .action(async () => {
      try {
        const res = await orchFetch('/org');
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        const data = await res.json() as any;

        if (data.nodes.length === 0) {
          console.log(DIM('\n  No org chart. Run: kyberbot orch init\n'));
          return;
        }

        console.log();
        console.log(PRIMARY.bold('  Org Chart'));
        console.log();

        // Build tree
        const nodes = data.nodes as any[];
        const root = nodes.filter((n: any) => !n.reports_to);
        function printTree(node: any, indent: string = '  ') {
          const ceoTag = node.is_ceo ? ' 👑' : '';
          console.log(`${indent}${ACCENT(node.agent_name)} — ${node.role}${node.title ? ` (${node.title})` : ''}${ceoTag}`);
          const children = nodes.filter((n: any) => n.reports_to === node.agent_name);
          for (const child of children) {
            printTree(child, indent + '  ');
          }
        }
        for (const r of root) printTree(r);
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  orgCmd
    .command('set <agent>')
    .description('Set/update org node')
    .requiredOption('-r, --role <role>', 'Agent role (e.g., CEO, CTO, engineer)')
    .option('-t, --title <title>', 'Agent title')
    .option('--reports-to <agent>', 'Manager agent name')
    .option('--ceo', 'Designate as CEO')
    .option('-d, --department <dept>', 'Department')
    .action(async (agent: string, options: any) => {
      try {
        const res = await orchFetch(`/org/${agent}`, {
          method: 'PUT',
          body: JSON.stringify({
            role: options.role,
            title: options.title,
            reports_to: options.reportsTo,
            is_ceo: options.ceo || false,
            department: options.department,
          }),
        });
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        console.log(PRIMARY(`\n  Updated ${agent} in org chart\n`));
      } catch (error) { handleConnectionError(error); }
    });

  orgCmd
    .command('remove <agent>')
    .description('Remove agent from org chart')
    .action(async (agent: string) => {
      try {
        await orchFetch(`/org/${agent}`, { method: 'DELETE' });
        console.log(PRIMARY(`\n  Removed ${agent} from org chart\n`));
      } catch (error) { handleConnectionError(error); }
    });

  // ── goals ─────────────────────────────────────────────────────────
  const goalsCmd = orch
    .command('goals')
    .description('List goals');

  goalsCmd
    .action(async () => {
      try {
        const res = await orchFetch('/goals');
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        const data = await res.json() as any;

        if (data.goals.length === 0) {
          console.log(DIM('\n  No goals. Create one: kyberbot orch goals create\n'));
          return;
        }

        console.log();
        console.log(PRIMARY.bold('  Goals'));
        console.log();
        for (const g of data.goals) {
          const owner = g.owner_agent ? ` → ${ACCENT(g.owner_agent)}` : '';
          console.log(`  #${g.id}  [${statusColor(g.status)}]  ${g.title} (${g.level})${owner}`);
        }
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  goalsCmd
    .command('create')
    .description('Create a new goal')
    .requiredOption('--title <title>', 'Goal title')
    .option('--description <desc>', 'Goal description')
    .option('--level <level>', 'Goal level (company|team|agent)', 'company')
    .option('--owner <agent>', 'Owner agent')
    .option('--parent <id>', 'Parent goal ID')
    .option('--due <date>', 'Due date (YYYY-MM-DD)')
    .action(async (options: any) => {
      try {
        const res = await orchFetch('/goals', {
          method: 'POST',
          body: JSON.stringify({
            title: options.title,
            description: options.description,
            level: options.level,
            owner_agent: options.owner,
            parent_goal_id: options.parent ? Number(options.parent) : undefined,
            due_date: options.due,
          }),
        });
        if (!res.ok) { console.error(chalk.red('Error creating goal')); process.exit(1); }
        const data = await res.json() as any;
        console.log(PRIMARY(`\n  Created goal #${data.goal.id}: ${data.goal.title}\n`));
      } catch (error) { handleConnectionError(error); }
    });

  goalsCmd
    .command('show <id>')
    .description('Show goal detail')
    .action(async (id: string) => {
      try {
        const res = await orchFetch(`/goals/${id}`);
        if (!res.ok) { console.error(chalk.red('Goal not found')); process.exit(1); }
        const data = await res.json() as any;
        const g = data.goal;

        console.log();
        console.log(PRIMARY.bold(`  Goal #${g.id}: ${g.title}`));
        console.log(`  ${DIM('Level:')}   ${g.level}`);
        console.log(`  ${DIM('Status:')}  ${statusColor(g.status)}`);
        if (g.owner_agent) console.log(`  ${DIM('Owner:')}   ${ACCENT(g.owner_agent)}`);
        if (g.description) console.log(`  ${DIM('Desc:')}    ${g.description}`);

        if (data.kpis.length > 0) {
          console.log();
          console.log(`  ${DIM('KPIs:')}`);
          for (const kpi of data.kpis) {
            const pct = kpi.target_value ? Math.round((kpi.current_value / kpi.target_value) * 100) : '—';
            console.log(`    ${kpi.name}: ${kpi.current_value}${kpi.unit || ''} / ${kpi.target_value ?? '—'}${kpi.unit || ''} (${pct}%)`);
          }
        }

        if (data.children.length > 0) {
          console.log();
          console.log(`  ${DIM('Sub-goals:')}`);
          for (const c of data.children) {
            console.log(`    #${c.id} [${statusColor(c.status)}] ${c.title}`);
          }
        }
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  // ── issues ────────────────────────────────────────────────────────
  const issuesCmd = orch
    .command('issues')
    .description('List issues (kanban view)');

  issuesCmd
    .action(async () => {
      try {
        const res = await orchFetch('/issues');
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        const data = await res.json() as any;

        if (data.issues.length === 0) {
          console.log(DIM('\n  No issues. Create one: kyberbot orch issues create\n'));
          return;
        }

        console.log();
        console.log(PRIMARY.bold('  Issues'));
        console.log();

        // Group by status
        const groups: Record<string, any[]> = {};
        for (const issue of data.issues) {
          if (!groups[issue.status]) groups[issue.status] = [];
          groups[issue.status].push(issue);
        }

        const order = ['in_progress', 'todo', 'blocked', 'in_review', 'backlog', 'done', 'cancelled'];
        for (const status of order) {
          const items = groups[status];
          if (!items || items.length === 0) continue;
          console.log(`  ${statusColor(status).toUpperCase()} (${items.length})`);
          for (const i of items) {
            const assignee = i.assigned_to ? ACCENT(i.assigned_to) : DIM('unassigned');
            console.log(`    #${i.id}  ${priorityColor(i.priority)}  ${i.title}  → ${assignee}`);
          }
          console.log();
        }
      } catch (error) { handleConnectionError(error); }
    });

  issuesCmd
    .command('create')
    .description('Create a new issue')
    .requiredOption('--title <title>', 'Issue title')
    .option('--description <desc>', 'Issue description')
    .option('--priority <p>', 'Priority (critical|high|medium|low)', 'medium')
    .option('--assign <agent>', 'Assign to agent')
    .option('--goal <id>', 'Link to goal ID')
    .option('--parent <id>', 'Parent issue ID')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--status <s>', 'Initial status', 'todo')
    .action(async (options: any) => {
      try {
        const res = await orchFetch('/issues', {
          method: 'POST',
          body: JSON.stringify({
            title: options.title,
            description: options.description,
            priority: options.priority,
            assigned_to: options.assign,
            goal_id: options.goal ? Number(options.goal) : undefined,
            parent_id: options.parent ? Number(options.parent) : undefined,
            labels: options.labels,
            status: options.status,
            created_by: 'human',
          }),
        });
        if (!res.ok) { console.error(chalk.red('Error creating issue')); process.exit(1); }
        const data = await res.json() as any;
        console.log(PRIMARY(`\n  Created issue #${data.issue.id}: ${data.issue.title}\n`));
      } catch (error) { handleConnectionError(error); }
    });

  issuesCmd
    .command('show <id>')
    .description('Show issue detail')
    .action(async (id: string) => {
      try {
        const res = await orchFetch(`/issues/${id}`);
        if (!res.ok) { console.error(chalk.red('Issue not found')); process.exit(1); }
        const data = await res.json() as any;
        const i = data.issue;

        console.log();
        console.log(PRIMARY.bold(`  Issue #${i.id}: ${i.title}`));
        console.log(`  ${DIM('Status:')}    ${statusColor(i.status)}`);
        console.log(`  ${DIM('Priority:')}  ${priorityColor(i.priority)}`);
        console.log(`  ${DIM('Assignee:')}  ${i.assigned_to ? ACCENT(i.assigned_to) : DIM('unassigned')}`);
        if (i.goal_id) console.log(`  ${DIM('Goal:')}      #${i.goal_id}`);
        if (i.checkout_by) console.log(`  ${DIM('Checkout:')}  ${ACCENT(i.checkout_by)}`);
        if (i.description) {
          console.log();
          console.log(`  ${i.description}`);
        }

        if (data.comments.length > 0) {
          console.log();
          console.log(`  ${DIM('── Comments ──')}`);
          for (const c of data.comments) {
            const time = new Date(c.created_at).toLocaleString();
            console.log();
            console.log(`  ${ACCENT(c.author_agent)} ${DIM(`(${time})`)}`);
            console.log(`  ${c.content}`);
          }
        }
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  issuesCmd
    .command('assign <id> <agent>')
    .description('Assign issue to an agent')
    .action(async (id: string, agent: string) => {
      try {
        const res = await orchFetch(`/issues/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ assigned_to: agent }),
        });
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        console.log(PRIMARY(`\n  Assigned #${id} to ${agent}\n`));
      } catch (error) { handleConnectionError(error); }
    });

  issuesCmd
    .command('transition <id> <status>')
    .description('Transition issue status')
    .action(async (id: string, status: string) => {
      try {
        const res = await orchFetch(`/issues/${id}/transition`, {
          method: 'POST',
          body: JSON.stringify({ status, actor: 'human' }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as any;
          console.error(chalk.red(`Error: ${body.error || 'Invalid transition'}`));
          process.exit(1);
        }
        console.log(PRIMARY(`\n  Issue #${id} → ${status}\n`));
      } catch (error) { handleConnectionError(error); }
    });

  issuesCmd
    .command('comment <id> <message>')
    .description('Add a comment to an issue')
    .action(async (id: string, message: string) => {
      try {
        const res = await orchFetch(`/issues/${id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ author: 'human', content: message }),
        });
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        console.log(PRIMARY(`\n  Comment added to #${id}\n`));
      } catch (error) { handleConnectionError(error); }
    });

  // ── inbox ─────────────────────────────────────────────────────────
  const inboxCmd = orch
    .command('inbox')
    .description('Human inbox — items needing attention');

  inboxCmd
    .action(async () => {
      try {
        const res = await orchFetch('/inbox?status=pending');
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        const data = await res.json() as any;

        if (data.items.length === 0) {
          console.log(DIM('\n  Inbox is clear.\n'));
          return;
        }

        console.log();
        console.log(PRIMARY.bold(`  Inbox (${data.items.length} pending)`));
        console.log();
        for (const item of data.items) {
          const urgencyIcon = item.urgency === 'high' ? '🔴' : item.urgency === 'normal' ? '🟡' : '🔵';
          const time = new Date(item.created_at).toLocaleString();
          console.log(`  ${urgencyIcon} #${item.id} from ${ACCENT(item.source_agent)} ${DIM(`(${time})`)}`);
          console.log(`    ${item.title}`);
          if (item.body) console.log(`    ${DIM(item.body.slice(0, 120))}`);
          if (item.related_issue_id) console.log(`    ${DIM(`Related: issue #${item.related_issue_id}`)}`);
          console.log();
        }
      } catch (error) { handleConnectionError(error); }
    });

  inboxCmd
    .command('resolve <id>')
    .description('Resolve an inbox item')
    .action(async (id: string) => {
      try {
        await orchFetch(`/inbox/${id}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ resolved_by: 'human' }),
        });
        console.log(PRIMARY(`\n  Inbox item #${id} resolved\n`));
      } catch (error) { handleConnectionError(error); }
    });

  // ── activity ──────────────────────────────────────────────────────
  orch
    .command('activity')
    .description('Show recent activity log')
    .option('-a, --agent <name>', 'Filter by actor')
    .option('-l, --limit <n>', 'Number of entries', '20')
    .action(async (options: { agent?: string; limit?: string }) => {
      try {
        const params = new URLSearchParams({ limit: options.limit || '20' });
        if (options.agent) params.set('actor', options.agent);

        const res = await orchFetch(`/activity?${params.toString()}`);
        if (!res.ok) { console.error(chalk.red('Error')); process.exit(1); }
        const data = await res.json() as any;

        if (data.entries.length === 0) {
          console.log(DIM('\n  No activity yet.\n'));
          return;
        }

        console.log();
        console.log(PRIMARY.bold('  Activity Log'));
        console.log();
        for (const e of data.entries) {
          const time = new Date(e.created_at).toLocaleString();
          console.log(`  ${DIM(time)}  ${ACCENT(e.actor)}  ${e.action}  ${DIM(e.entity_type)}${e.entity_id ? ` #${e.entity_id}` : ''}`);
        }
        console.log();
      } catch (error) { handleConnectionError(error); }
    });

  return orch;
}
