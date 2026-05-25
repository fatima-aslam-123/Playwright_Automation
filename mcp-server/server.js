import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The project root is one level up from this mcp-server directory.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Run a Playwright spec file and resolve with its combined output.
function runSpec(specFile) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "npx",
      ["playwright", "test", specFile, "--reporter=list"],
      { cwd: projectRoot, shell: true }
    );

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });

    child.on("error", (err) => {
      resolvePromise(`Failed to run ${specFile}: ${err.message}`);
    });

    child.on("close", (code) => {
      resolvePromise(
        `${output}\n[playwright exited with code ${code}]`
      );
    });
  });
}

const runCompanies = () => runSpec("tests/companies.spec.js");
const runContacts = () => runSpec("tests/contacts.spec.js");
const runRecruitment = () => runSpec("tests/recruitment.spec.js");

const server = new Server(
  {
    name: "playwright-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 1. LIST TOOLS (IMPORTANT)
server.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    return {
      tools: [
        {
          name: "run_companies_tests",
          description: "Run companies spec file",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "run_contacts_tests",
          description: "Run contacts spec file",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "run_recruitment_tests",
          description: "Run recruitment spec file",
          inputSchema: {
            type: "object",
            properties: {}
          }
        }
      ]
    };
  }
);

// 2. CALL TOOL (IMPORTANT)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;

  if (name === "run_companies_tests") {
    const result = await runCompanies();
    return { content: [{ type: "text", text: result }] };
  }

  if (name === "run_contacts_tests") {
    const result = await runContacts();
    return { content: [{ type: "text", text: result }] };
  }

  if (name === "run_recruitment_tests") {
    const result = await runRecruitment();
    return { content: [{ type: "text", text: result }] };
  }

  throw new Error("Tool not found");
});

// CONNECT TRANSPORT
const transport = new StdioServerTransport();
await server.connect(transport);