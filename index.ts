#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Browser, chromium, type Page } from "playwright";
import { z } from "zod";

// Create an MCP server
const server = new McpServer({
	name: "browser-debug-server",
	version: "1.0.0",
});

let browser: Browser | undefined;
// Map to store logs per tab (page URL as key)
const tabLogs = new Map<string, string[]>();
const pagesWithListeners = new WeakSet<Page>();

async function getPageIdentifier(page: Page): Promise<string> {
	try {
		const url = page.url();
		const title = await page.title().catch(() => "Untitled");
		return `${title} - ${url}`;
	} catch {
		return "Unknown Tab";
	}
}

async function attachListenerToPage(page: Page) {
	if (!pagesWithListeners.has(page)) {
		page.on("console", async (msg) => {
			const pageId = await getPageIdentifier(page);
			if (!tabLogs.has(pageId)) {
				tabLogs.set(pageId, []);
			}
			const logs = tabLogs.get(pageId);
			if (logs) {
				logs.push(`${msg.type()}: ${msg.text()}`);
			}
		});
		pagesWithListeners.add(page);
	}
}

async function ensureBrowserAndGetPages(): Promise<Page[]> {
	if (!browser) {
		try {
			browser = await chromium.connectOverCDP("http://localhost:9222");
		} catch (error) {
			console.error("Failed to connect to browser", error);
			return [];
		}
	}

	const allPages: Page[] = [];
	const contexts = browser.contexts();

	for (const context of contexts) {
		const pages = context.pages();
		allPages.push(...pages);

		// Attach listeners to all pages
		for (const page of pages) {
			await attachListenerToPage(page);
		}
	}

	return allPages;
}

server.registerTool("list_tabs", {}, async () => {
	const allPages = await ensureBrowserAndGetPages();

	if (allPages.length === 0) {
		return {
			isError: false,
			content: [
				{
					type: "text",
					text: "No tabs found. Make sure Chrome is running with --remote-debugging-port=9222",
				},
			],
		};
	}

	const tabList: string[] = [];
	for (let i = 0; i < allPages.length; i++) {
		const page = allPages[i];
		const pageId = await getPageIdentifier(page);
		const logsCount = tabLogs.get(pageId)?.length || 0;
		tabList.push(`${i + 1}. ${pageId} (${logsCount} logs)`);
	}

	return {
		isError: false,
		content: [
			{
				type: "text",
				text: `Found ${allPages.length} tab(s):\n${tabList.join("\n")}`,
			},
		],
	};
});

server.registerTool(
	"get_logs",
	{
		inputSchema: {
			tabIndex: z
				.number()
				.describe("The tab number from list_tabs (1, 2, 3, etc)"),
		},
	},
	async (args) => {
		const allPages = await ensureBrowserAndGetPages();
		const index = args.tabIndex - 1;

		if (index < 0 || index >= allPages.length) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Invalid tab index. Please use a number between 1 and ${allPages.length}`,
					},
				],
			};
		}

		const page = allPages[index];
		const pageId = await getPageIdentifier(page);
		const logs = tabLogs.get(pageId) || [];

		return {
			isError: false,
			content: [
				{
					type: "text",
					text:
						logs.length > 0
							? logs.join("\n")
							: `No console logs for tab: ${pageId}`,
				},
			],
		};
	},
);

server.registerTool(
	"clear_logs",
	{
		inputSchema: {
			tabIndex: z
				.number()
				.describe("The tab number from list_tabs (1, 2, 3, etc)"),
		},
	},
	async (args) => {
		const allPages = await ensureBrowserAndGetPages();
		const index = args.tabIndex - 1;

		if (index < 0 || index >= allPages.length) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Invalid tab index. Please use a number between 1 and ${allPages.length}`,
					},
				],
			};
		}

		const page = allPages[index];
		const pageId = await getPageIdentifier(page);
		tabLogs.set(pageId, []);

		return {
			isError: false,
			content: [
				{
					type: "text",
					text: `Cleared logs for: ${pageId}`,
				},
			],
		};
	},
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
