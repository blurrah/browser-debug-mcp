import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Browser, chromium } from "playwright";

// Create an MCP server
const server = new McpServer({
	name: "demo-server",
	version: "1.0.0",
});

let browser: Browser | undefined;
const logs: string[] = [];

async function ensureBrowser() {
	if (!browser) {
		try {
			browser = await chromium.connectOverCDP("http://localhost:9222");
		} catch (error) {
			console.error("Failed to connect to browser", error);
			return null;
		}
	}

	const context =
		(await browser.contexts())[0] ||
		(await browser.newContext({
			viewport: {
				width: 1920,
				height: 1080,
			},
		}));

	const page = await context.newPage();

	page.on("console", (msg) => {
		logs.push(`${msg.type()}: ${msg.text()}`);
	});

	return page;
}

server.registerTool("get_logs", {}, async () => {
	const browser = await ensureBrowser();
	if (!browser) {
		return {
			isError: true,
			content: [{ type: "text", text: "Failed to connect to browser" }],
		};
	}

	return {
		isError: false,
		content: [
			{
				type: "text",
				text: logs.join("\n"),
			},
		],
	};
});

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
