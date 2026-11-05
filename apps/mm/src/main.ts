import { runBot } from "./bot.ts";
import { loadConfig, loadMonitorConfig, loadProposerConfig, loadRelayConfig, loadSettlerConfig } from "./config.ts";
import { listCommand } from "./list.ts";
import { monitorCommand } from "./monitor.ts";
import { positionsCommand } from "./positions.ts";
import { proposeCommand } from "./propose.ts";
import { settleCommand } from "./settle.ts";
import { writeCommand } from "./write.ts";

const [command, ...args] = process.argv.slice(2);

if (command === undefined) await runBot(loadConfig(process.env), loadRelayConfig(process.env));
else if (command === "write") await writeCommand(loadConfig(process.env), args[0], args[1]);
else if (command === "list") await listCommand(loadConfig(process.env), args[0] === "--once");
else if (command === "positions") await positionsCommand(loadConfig(process.env));
else if (command === "monitor") await monitorCommand(loadMonitorConfig(process.env), args[0] === "--once");
else if (command === "propose") await proposeCommand(loadProposerConfig(process.env), args[0] === "--once");
else if (command === "settle") await settleCommand(loadSettlerConfig(process.env), args[0] === "--once");
else throw new Error(`unknown command ${command}; use: (none) | write <series_id> <collateral_amount> | list [--once] | positions | monitor [--once] | propose [--once] | settle [--once]`);
