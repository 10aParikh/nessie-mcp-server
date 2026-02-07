import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// --- CONFIGURATION ---
const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const NESSIE_API_KEY = process.env.NESSIE_API_KEY;
const NESSIE_BASE_URL = "http://api.nessieisreal.com";

if (!NESSIE_API_KEY) {
  console.error("Error: NESSIE_API_KEY is missing.");
}

// --- INITIALIZE MCP SERVER ---
const mcpServer = new McpServer({
  name: "NessieBankAgent",
  version: "1.0.0",
});

// --- HELPER FUNCTION ---
async function callNessie(method: string, endpoint: string, data?: any) {
  try {
    const response = await axios({
      method,
      url: `${NESSIE_BASE_URL}${endpoint}`,
      params: { key: NESSIE_API_KEY },
      data,
      headers: { "Content-Type": "application/json" }
    });
    return response.data;
  } catch (error: any) {
    // Return error as data so the AI knows what went wrong
    return { error: error.response?.data || error.message };
  }
}

// --- DEFINE TOOLS ---

// Tool 1: Get Customer Accounts
mcpServer.tool(
  "get_customer_accounts",
  "Get all bank accounts for a specific customer ID",
  { customerId: z.string().describe("The Customer ID (e.g., 64e3f...)") },
  async ({ customerId }) => {
    const data = await callNessie("GET", `/customers/${customerId}/accounts`);
    if (data.error) return { content: [{ type: "text", text: `Error: ${JSON.stringify(data.error)}` }] };
    
    // Format the output for the AI to read easily
    const summary = data.map((acc: any) => 
      `- ${acc.nickname} (${acc.type}): $${acc.balance} (ID: ${acc._id})`
    ).join("\n");

    return {
      content: [{ type: "text", text: `Accounts found:\n${summary}` }],
    };
  }
);

// Tool 2: Transfer Money
mcpServer.tool(
  "transfer_money",
  "Transfer funds between two accounts",
  {
    payerId: z.string().describe("ID of the source account"),
    payeeId: z.string().describe("ID of the destination account"),
    amount: z.number().describe("Amount to transfer"),
  },
  async ({ payerId, payeeId, amount }) => {
    const payload = {
      medium: "balance",
      payee_id: payeeId,
      amount: amount,
      transaction_date: new Date().toISOString().split("T")[0],
    };

    const data = await callNessie("POST", `/accounts/${payerId}/transfers`, payload);
    
    if (data.error) return { content: [{ type: "text", text: `Transfer Failed: ${JSON.stringify(data.error)}` }] };

    return {
      content: [{ type: "text", text: `Transfer Successful: ${data.message}\nTransferred $${amount} from ${payerId} to ${payeeId}.` }],
    };
  }
);

// --- SSE TRANSPORT (REQUIRED FOR DEDALUS) ---

// 1. The stream endpoint Dedalus connects to
app.get("/sse", async (req, res) => {
  console.log("Dedalus connected via SSE");
  const transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);
});

// 2. The message handler for incoming requests
app.post("/messages", async (req, res) => {
  // The SSE transport handles the session; we just need to acknowledge the POST
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Nessie MCP Server running on port ${PORT}`);
});