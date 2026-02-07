import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const NESSIE_API_KEY = process.env.NESSIE_API_KEY;
const BASE_URL = "http://api.nessieisreal.com";

if (!NESSIE_API_KEY) {
  console.warn("WARNING: NESSIE_API_KEY is not set.");
}

const mcpServer = new McpServer({
  name: "NessieBankAgent",
  version: "1.0.0",
});

async function callNessie(method: string, endpoint: string, data?: any) {
  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      params: { key: NESSIE_API_KEY },
      data,
      headers: { "Content-Type": "application/json" }
    });
    return response.data;
  } catch (error: any) {
    return { error: error.response?.data || error.message };
  }
}

// --- TOOLS ---

mcpServer.tool(
  "get_customer_accounts",
  "Get all accounts for a specific customer",
  { customerId: z.string() },
  async ({ customerId }) => {
    const data = await callNessie("GET", `/customers/${customerId}/accounts`);
    if (data.error) return { content: [{ type: "text", text: `Error: ${JSON.stringify(data.error)}` }] };
    
    const summary = Array.isArray(data) 
      ? data.map((acc: any) => `- ${acc.nickname} (${acc.type}): $${acc.balance} (ID: ${acc._id})`).join("\n")
      : JSON.stringify(data);

    return { content: [{ type: "text", text: `Accounts:\n${summary}` }] };
  }
);

mcpServer.tool(
  "transfer_money",
  "Transfer money between accounts",
  {
    payerId: z.string(),
    payeeId: z.string(),
    amount: z.number(),
  },
  async ({ payerId, payeeId, amount }) => {
    const payload = {
      medium: "balance",
      payee_id: payeeId,
      amount,
      transaction_date: new Date().toISOString().split("T")[0],
    };
    const data = await callNessie("POST", `/accounts/${payerId}/transfers`, payload);
    if (data.error) return { content: [{ type: "text", text: `Failed: ${JSON.stringify(data.error)}` }] };
    return { content: [{ type: "text", text: `Success: ${data.message}` }] };
  }
);

// --- DEDALUS REQUIRED ROUTES ---

// 1. The entry point MUST be named /mcp for Dedalus validation
app.get("/mcp", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);
});

// 2. The message handler
app.post("/messages", async (req, res) => {
  await mcpServer.handleMessage(req.body); // Keep this standard
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Nessie MCP Server running on port ${PORT}`);
});