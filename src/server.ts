import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type ReminderWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve project root: prefer ASSETS_ROOT only if it actually has an assets/ directory
const DEFAULT_ROOT_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = (() => {
  const envRoot = process.env.ASSETS_ROOT;
  if (envRoot) {
    const candidate = path.resolve(envRoot);
    try {
      const candidateAssets = path.join(candidate, "assets");
      if (fs.existsSync(candidateAssets)) {
        return candidate;
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_ROOT_DIR;
})();

const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");
const LOGS_DIR = path.resolve(__dirname, "..", "logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

type AnalyticsEvent = {
  timestamp: string;
  event: string;
  [key: string]: any;
};

function logAnalytics(event: string, data: Record<string, any> = {}) {
  const entry: AnalyticsEvent = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };

  const logLine = JSON.stringify(entry);
  console.log(logLine);

  const today = new Date().toISOString().split("T")[0];
  const logFile = path.join(LOGS_DIR, `${today}.log`);
  fs.appendFileSync(logFile, logLine + "\n");
}

function getRecentLogs(days: number = 7): AnalyticsEvent[] {
  const logs: AnalyticsEvent[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const logFile = path.join(LOGS_DIR, `${dateStr}.log`);

    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, "utf8");
      const lines = content.trim().split("\n");
      lines.forEach((line) => {
        try {
          logs.push(JSON.parse(line));
        } catch (e) {}
      });
    }
  }

  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function classifyDevice(userAgent?: string | null): string {
  if (!userAgent) return "Unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "iOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("linux")) return "Linux";
  if (ua.includes("cros")) return "ChromeOS";
  return "Other";
}

function computeSummary(args: any) {
  // Compute reminder summary
  const title = args.title || "";
  const dueDate = args.due_date || "";
  const priority = args.priority || "medium";
  const recurrence = args.recurrence || "none";
  
  return {
    title,
    due_date: dueDate,
    priority,
    recurrence,
    has_notification: args.notification !== "none"
  };
}

function readWidgetHtml(componentName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`
    );
  }

  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  let htmlContents: string | null = null;
  let loadedFrom = "";

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
    loadedFrom = directPath;
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) => file.startsWith(`${componentName}-`) && file.endsWith(".html")
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      const fallbackPath = path.join(ASSETS_DIR, fallback);
      htmlContents = fs.readFileSync(fallbackPath, "utf8");
      loadedFrom = fallbackPath;
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "${componentName}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }

  // Log what was loaded and check for "5%" in the badge
  const has5Percent = htmlContents.includes('<span class="rate-num">5%</span>');
  const isBlank = htmlContents.includes('<span class="rate-num"></span>');
  console.log(`[Widget Load] File: ${loadedFrom}`);
  console.log(`[Widget Load] Has "5%": ${has5Percent}, Is Blank: ${isBlank}`);
  console.log(`[Widget Load] HTML length: ${htmlContents.length} bytes`);

  return htmlContents;
}

// Use git commit hash for deterministic cache-busting across deploys
// Added timestamp suffix to force cache invalidation for width fix
const VERSION = (process.env.RENDER_GIT_COMMIT?.slice(0, 7) || Date.now().toString()) + '-' + Date.now();

const STABLE_TEMPLATE_URI = "ui://widget/reminder-app.html";

function widgetMeta(widget: ReminderWidget, bustCache: boolean = false) {
  const templateUri = widget.templateUri;

  return {
    "openai/outputTemplate": templateUri,
    "openai/widgetDescription":
      "Create Reminders App - An AI-powered reminder app with natural language input. No input is required to open the app: prompts like 'create a reminder', 'open the reminder app', or 'show my reminders' should open the widget immediately. If you do provide details (e.g. 'Call mom tomorrow at 5pm'), they'll be parsed automatically. Features gamification with points, streaks, and achievements. Supports recurring reminders, categories, and priority levels.",
    "openai/componentDescriptions": {
      "task-input": "Natural language input for creating reminders - just type what you need to remember.",
      "reminder-list": "Organized display of reminders with category filters, search, and sorting.",
      "gamification-header": "Stats bar showing level, points, and daily streak.",
      "screenshot-import": "Upload a screenshot of tasks to auto-import them via OCR.",
    },
    "openai/widgetKeywords": [
      "reminder",
      "reminders",
      "task",
      "tasks",
      "todo",
      "to-do",
      "schedule",
      "alert",
      "notification",
      "deadline",
      "due date",
      "recurring",
      "snooze"
    ],
    "openai/sampleConversations": [
      { "user": "Create a reminder", "assistant": "Opening Create Reminders App." },
      { "user": "Open the reminder app", "assistant": "Opening Create Reminders App." },
      { "user": "Remind me to call mom tomorrow at 3pm", "assistant": "Opening Create Reminders App. I've added 'Call mom' for tomorrow at 3pm." },
      { "user": "I need to buy groceries, pay rent on Friday, and schedule a dentist appointment", "assistant": "Opening Create Reminders App. I've added 3 reminders for you." },
      { "user": "Set a daily reminder to take vitamins at 9am", "assistant": "Done! I've created a daily recurring reminder for vitamins at 9am." },
      { "user": "What tasks do I have this week?", "assistant": "Here are your reminders for this week in Create Reminders App." },
    ],
    "openai/starterPrompts": [
      "Create a reminder",
      "Open the reminder app",
      "Remind me to call mom tomorrow at 5pm",
      "Add: Buy groceries, Pay bills Friday, Call dentist",
      "Set a daily reminder to take vitamins",
      "What tasks do I have today?",
      "Help me stay organized with reminders",
      "Create a reminder for my meeting next Monday",
    ],
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [
        "https://reminder-app-3pz5.onrender.com"
      ],
      resource_domains: [
        "https://reminder-app-3pz5.onrender.com"
      ],
    },
    "openai/widgetDomain": "https://web-sandbox.oaiusercontent.com",
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}

const widgets: ReminderWidget[] = [
  {
    id: "create-reminders-app",
    title: "Create Reminders App — AI-powered reminder app with gamification",
    templateUri: STABLE_TEMPLATE_URI,
    invoking:
      "Opening Create Reminders App...",
    invoked:
      "Here is Create Reminders App. No input is required to open — add reminders using natural language when you're ready.",
    html: readWidgetHtml("reminder-app"),
  },
];

const widgetsById = new Map<string, ReminderWidget>();
const widgetsByUri = new Map<string, ReminderWidget>();

widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  widgetsByUri.set(widget.templateUri, widget);
  // Be tolerant if ChatGPT or middleware adds/removes query params.
  // We treat ui://widget/<name>.html as the canonical identity.
  const baseUri = widget.templateUri.split("?")[0];
  widgetsByUri.set(baseUri, widget);
});

const toolInputSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "The reminder title or what to be reminded about." },
    description: { type: "string", description: "Optional detailed description." },
    due_date: { type: "string", description: "Due date in YYYY-MM-DD format." },
    due_time: { type: "string", description: "Due time in HH:MM format." },
    priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level." },
    tags: { type: "array", items: { type: "string" }, description: "Tags for categorization." },
    recurrence: { type: "string", enum: ["none", "daily", "weekly", "monthly"], description: "Recurrence pattern." },
    recurrence_days: {
      type: "array",
      items: { type: "number" },
      description: "For weekly recurrence: list of weekday numbers (0=Sun..6=Sat), e.g. [2,4] for Tue/Thu.",
    },
    notification: { type: "string", enum: ["none", "email", "sms", "both"], description: "Notification method." },
    notification_email: { type: "string", description: "Email for notifications." },
    notification_phone: { type: "string", description: "Phone for SMS notifications." },
    natural_input: { type: "string", description: "Natural language input like 'remind me to call mom tomorrow at 3pm'." },
    action: {
      type: "string",
      enum: ["open", "create", "complete", "uncomplete"],
      description: "Optional intent for the widget to apply on open. 'open'/'create' prefill input, 'complete' marks a reminder complete, 'uncomplete' reverses completion.",
    },
    complete_query: {
      type: "string",
      description: "If action is 'complete' or 'uncomplete', this is the reminder title/query to match (e.g. 'mailed the check to my landlord').",
    },
  },
  required: [],
  additionalProperties: false,
  $schema: "http://json-schema.org/draft-07/schema#",
} as const;

const toolInputParser = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  due_date: z.string().optional(),
  due_time: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  tags: z.array(z.string()).optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  recurrence_days: z.array(z.number().int().min(0).max(6)).optional(),
  notification: z.enum(["none", "email", "sms", "both"]).optional(),
  notification_email: z.string().optional(),
  notification_phone: z.string().optional(),
  natural_input: z.string().optional(),
  action: z.enum(["open", "create", "complete", "uncomplete"]).optional(),
  complete_query: z.string().optional(),
});

// Storage for user reminders (in-memory, persists during server lifetime)
const userRemindersStore: Map<string, { reminders: any[], stats: any, savedAt: number }> = new Map();

// Save reminders tool schema
const saveRemindersSchema = {
  type: "object",
  properties: {
    reminders: {
      type: "array",
      description: "Array of reminder objects to save.",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    stats: { type: "object", description: "User stats object." },
    savedAt: { type: "number", description: "Timestamp when saved." },
  },
  required: ["reminders"],
  additionalProperties: true,
  $schema: "http://json-schema.org/draft-07/schema#",
} as const;

// Create the save_reminders tool
const saveRemindersTool: Tool = {
  name: "save_reminders",
  description: "Save user's reminders and stats for persistence. Called automatically by the widget.",
  inputSchema: saveRemindersSchema,
  outputSchema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      savedCount: { type: "number" },
      savedAt: { type: "number" },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const tools: Tool[] = [
  // Add save_reminders tool
  ...(process.env.EXPOSE_SAVE_TOOL === "1" ? [saveRemindersTool] : []),
  // Add widget tools
  ...widgets.map((widget) => ({
  name: widget.id,
  description:
    "Open Create Reminders App. No input is required: prompts like 'create a reminder', 'open the reminder app', or 'show my reminders' should open the widget immediately. If the user provides reminder details (e.g. 'Call mom tomorrow at 3pm'), they will be parsed and pre-filled. Use this tool to create, view, and manage reminders (search/filter, recurring, snooze, gamification).",
  inputSchema: toolInputSchema,
  outputSchema: {
    type: "object",
    properties: {
      ready: { type: "boolean" },
      timestamp: { type: "string" },
      title: { type: "string" },
      due_date: { type: "string" },
      due_time: { type: "string" },
      priority: { type: "string" },
      recurrence: { type: "string" },
      notification: { type: "string" },
      natural_input: { type: "string" },
      action: { type: "string" },
      complete_query: { type: "string" },
      input_source: { type: "string", enum: ["user", "default"] },
      summary: {
        type: "object",
        properties: {
          title: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          priority: { type: ["string", "null"] },
          recurrence: { type: ["string", "null"] },
          has_notification: { type: ["boolean", "null"] },
        },
      },
      suggested_followups: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  title: widget.title,
  securitySchemes: [{ type: "noauth" }],
  _meta: {
    ...widgetMeta(widget),
    "openai/visibility": "public",
    securitySchemes: [{ type: "noauth" }],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}))];

const resources: Resource[] = widgets.map((widget) => ({
  uri: widget.templateUri,
  name: widget.title,
  description:
    "HTML template for Create Reminders App - an AI-powered reminder app.",
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget),
}));

const resourceTemplates: ResourceTemplate[] = widgets.map((widget) => ({
  uriTemplate: widget.templateUri,
  name: widget.title,
  description:
    "Template descriptor for Create Reminders App.",
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget),
}));

function createReminderAppServer(): Server {
  const server = new Server(
    {
      name: "reminder-app",
      version: "0.1.0",
      description:
        "Create Reminders App - an AI-powered reminder app with natural language processing, gamification, and smart notifications.",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => {
      console.log(`[MCP] resources/list called, returning ${resources.length} resources`);
      resources.forEach((r: any) => {
        console.log(`  - ${r.uri} (${r.name})`);
      });
      return { resources };
    }
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request: ReadResourceRequest) => {
      const requestedUri = request.params.uri;
      const normalizedUri = requestedUri.split("?")[0];
      const widget = widgetsByUri.get(requestedUri) ?? widgetsByUri.get(normalizedUri);

      if (!widget) {
        console.error("[ReadResource] Unknown resource", {
          requestedUri,
          normalizedUri,
          knownUris: Array.from(widgetsByUri.keys()).slice(0, 25),
          knownUriCount: widgetsByUri.size,
        });
        throw new Error(`Unknown resource: ${requestedUri}`);
      }

      console.log("[ReadResource] Serving widget resource", {
        requestedUri,
        normalizedUri,
        widgetUri: widget.templateUri,
        htmlBytes: widget.html?.length ?? 0,
      });

      const htmlToSend = widget.html;

      return {
        contents: [
          {
            uri: widget.templateUri,
            mimeType: "text/html+skybridge",
            text: htmlToSend,
            _meta: widgetMeta(widget),
          },
        ],
      };
    }
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({ resourceTemplates })
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({ tools })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const startTime = Date.now();
      let userAgentString: string | null = null;
      let deviceCategory = "Unknown";
      
      // Log the full request to debug _meta location
      console.log("Full request object:", JSON.stringify(request, null, 2));
      
      try {
        // Handle save_reminders tool for persistence
        if (request.params.name === "save_reminders") {
          const args = request.params.arguments as any || {};
          const sessionId = (request as any)._meta?.sessionId || "default";
          
          // Store reminders in memory
          userRemindersStore.set(sessionId, {
            reminders: args.reminders || [],
            stats: args.stats || {},
            savedAt: Date.now(),
          });
          
          console.log(`[Save] Saved ${args.reminders?.length || 0} reminders for session ${sessionId}`);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  savedCount: args.reminders?.length || 0,
                  savedAt: Date.now(),
                }),
              },
            ],
            structuredContent: {
              success: true,
              savedCount: args.reminders?.length || 0,
              savedAt: Date.now(),
            },
          };
        }
        
        const widget = widgetsById.get(request.params.name);

        if (!widget) {
          logAnalytics("tool_call_error", {
            error: "Unknown tool",
            toolName: request.params.name,
          });
          throw new Error(`Unknown tool: ${request.params.name}`);
        }

        // Parse and validate input parameters
        let args: z.infer<typeof toolInputParser> = {};
        try {
          args = toolInputParser.parse(request.params.arguments ?? {});
        } catch (parseError: any) {
          logAnalytics("parameter_parse_error", {
            toolName: request.params.name,
            params: request.params.arguments,
            error: parseError.message,
          });
          throw parseError;
        }

        // Capture user context from _meta - try multiple locations
        const meta = (request as any)._meta || request.params?._meta || {};
        const userLocation = meta["openai/userLocation"];
        const userLocale = meta["openai/locale"];
        const userAgent = meta["openai/userAgent"];
        userAgentString = typeof userAgent === "string" ? userAgent : null;
        deviceCategory = classifyDevice(userAgentString);
        
        // Debug log
        console.log("Captured meta:", { userLocation, userLocale, userAgent });

        // If ChatGPT didn't pass structured arguments, try to infer reminder details from freeform text in meta
        try {
          const candidates: any[] = [
            meta["openai/subject"],
            meta["openai/userPrompt"],
            meta["openai/userText"],
            meta["openai/lastUserMessage"],
            meta["openai/inputText"],
            meta["openai/requestText"],
          ];
          const userText = candidates.find((t) => typeof t === "string" && t.trim().length > 0) || "";

          // Use natural_input if provided, or fallback to userText
          if (!args.natural_input && userText) {
            args.natural_input = userText;
          }

          // Try to infer priority from keywords
          if (args.priority === undefined) {
            if (/urgent|asap|immediately|critical/i.test(userText)) args.priority = "urgent";
            else if (/important|high priority/i.test(userText)) args.priority = "high";
            else if (/low priority|whenever|no rush/i.test(userText)) args.priority = "low";
          }
          
          // Try to infer recurrence from keywords
          if (args.recurrence === undefined) {
            if (/every day|daily/i.test(userText)) args.recurrence = "daily";
            else if (/every week|weekly/i.test(userText)) args.recurrence = "weekly";
            else if (/every month|monthly/i.test(userText)) args.recurrence = "monthly";
          }

        } catch (e) {
          console.warn("Parameter inference from meta failed", e);
        }


        const responseTime = Date.now() - startTime;

        // Check if we are using defaults (i.e. no arguments provided)
        const usedDefaults = Object.keys(args).length === 0;

        // Infer likely user query from parameters
        const inferredQuery = [] as string[];
        if (args.title) inferredQuery.push(`Title: ${args.title}`);
        if (args.due_date) inferredQuery.push(`Due: ${args.due_date}`);
        if (args.priority) inferredQuery.push(`Priority: ${args.priority}`);
        if (args.natural_input) inferredQuery.push(`Input: ${args.natural_input.substring(0, 50)}`);

        logAnalytics("tool_call_success", {
          toolName: request.params.name,
          params: args,
          inferredQuery: inferredQuery.length > 0 ? inferredQuery.join(", ") : "Create Reminders App",
          responseTime,

          device: deviceCategory,
          userLocation: userLocation
            ? {
                city: userLocation.city,
                region: userLocation.region,
                country: userLocation.country,
                timezone: userLocation.timezone,
              }
            : null,
          userLocale,
          userAgent,
        });

        // Use a stable template URI so toolOutput reliably hydrates the component
        const widgetMetadata = widgetMeta(widget, false);
        console.log(`[MCP] Tool called: ${request.params.name}, returning templateUri: ${(widgetMetadata as any)["openai/outputTemplate"]}`);

        // Try to load saved reminders for this session
        const sessionId = (request as any)._meta?.sessionId || "default";
        const savedData = userRemindersStore.get(sessionId);
        const hasSavedData = !!(savedData && Array.isArray(savedData.reminders) && savedData.reminders.length > 0);
        
        // Build structured content once so we can log it and return it.
        // For the reminder app, expose fields relevant to reminder details
        const structured = {
          ready: true,
          timestamp: new Date().toISOString(),
          ...args,
          input_source: usedDefaults ? "default" : "user",
          has_saved_data: hasSavedData,
          // Only include reminders/stats if we actually have them.
          ...(hasSavedData
            ? {
                reminders: savedData?.reminders || [],
                stats: savedData?.stats || null,
              }
            : {}),
          // Summary + follow-ups for natural language UX
          summary: computeSummary(args),
          suggested_followups: [
            "Show my reminders",
            "What's due today?",
            "Set a daily reminder",
            "Snooze this reminder"
          ],
        } as const;

        // Embed the widget resource in _meta to mirror official examples and improve hydration reliability
        const metaForReturn = {
          ...widgetMetadata,
          "openai.com/widget": {
            type: "resource",
            resource: {
              uri: widget.templateUri,
              mimeType: "text/html+skybridge",
              text: widget.html,
              title: widget.title,
            },
          },
        } as const;

        console.log("[MCP] Returning outputTemplate:", (metaForReturn as any)["openai/outputTemplate"]);
        console.log("[MCP] Returning structuredContent:", structured);

        // Log success analytics
        try {
          // Check for "empty" result - when no main reminder inputs are provided
          const hasMainInputs = args.title || args.natural_input || args.due_date;
          
          if (!hasMainInputs) {
             logAnalytics("tool_call_empty", {
               toolName: request.params.name,
               params: request.params.arguments || {},
               reason: "No reminder details provided"
             });
          } else {
          logAnalytics("tool_call_success", {
            responseTime,
            params: request.params.arguments || {},
            inferredQuery: inferredQuery.join(", "),
            userLocation,
            userLocale,
            device: deviceCategory,
          });
          }
        } catch {}

        // Return empty content to suppress extra text after widget
        // The widget provides all necessary UI - no narration needed
        return {
          content: [],
          structuredContent: structured,
          _meta: metaForReturn,
        };
      } catch (error: any) {
        logAnalytics("tool_call_error", {
          error: error.message,
          stack: error.stack,
          responseTime: Date.now() - startTime,
          device: deviceCategory,
          userAgent: userAgentString,
        });
        throw error;
      }
    }
  );

  return server;
}

type SessionRecord = {
  server: Server;
  transport: SSEServerTransport;
};

const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";
const subscribePath = "/api/subscribe";
const analyticsPath = "/analytics";
const analyticsJsonPath = "/analytics.json";
const analyticsCrashJsonPath = "/analytics/crash.json";
const trackEventPath = "/api/track";
const healthPath = "/health";
const domainVerificationPath = "/.well-known/openai-apps-challenge";
const domainVerificationToken = "X1gWNzpJNaRnK2C8chFlLAGup9c5jHr6-7hTFMrDs-k";

const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD || "changeme123";

function checkAnalyticsAuth(req: IncomingMessage, url?: URL): boolean {
  const qpKey = url?.searchParams.get("key");
  if (qpKey && qpKey === ANALYTICS_PASSWORD) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
  const [username, password] = credentials.split(":");

  return username === "admin" && password === ANALYTICS_PASSWORD;
}

function sanitizeAnalyticsLog(log: AnalyticsEvent): AnalyticsEvent {
  const out: AnalyticsEvent = { ...log };
  const redactKeys = [
    "email",
    "feedback",
    "title",
    "description",
    "natural_input",
    "notification_email",
    "notification_phone",
    "userLocation",
    "userAgent",
    "inferredQuery",
    "params",
  ];

  redactKeys.forEach((k) => {
    if (k in out) {
      (out as any)[k] = "[redacted]";
    }
  });

  // Truncate large strings (stack traces etc) to avoid huge responses.
  Object.keys(out).forEach((k) => {
    const v = (out as any)[k];
    if (typeof v === "string" && v.length > 2000) {
      (out as any)[k] = v.slice(0, 2000) + "…";
    }
  });

  return out;
}

function humanizeEventName(event: string): string {
  const eventMap: Record<string, string> = {
    // Core analytics events
    tool_call_success: "Tool Call Success",
    tool_call_error: "Tool Call Error",
    tool_call_empty: "Tool Call Empty",
    parameter_parse_error: "Parameter Parse Error",
    // Reminder-specific widget events
    widget_create_reminder: "Create Reminder",
    widget_complete_task: "Complete Task",
    widget_uncomplete_task: "Uncomplete Task",
    widget_delete_reminder: "Delete Reminder",
    widget_edit_reminder: "Edit Reminder",
    widget_filter_change: "Filter Change",
    widget_category_change: "Category Change",
    widget_search: "Search",
    widget_screenshot_import: "Screenshot Import",
    widget_reset_progress: "Reset Progress",
    // General widget events
    widget_user_feedback: "User Feedback",
    widget_test_event: "Test Event",
    widget_followup_click: "Follow-up Click",
    widget_crash: "Widget Crash",
    widget_load: "Widget Load",
    widget_hydration_success: "Hydration Success",
    widget_hydration_error: "Hydration Error",
  };
  return eventMap[event] || event;
}

function formatEventDetails(log: AnalyticsEvent): string {
  const excludeKeys = ["timestamp", "event"];
  const details: Record<string, any> = {};
  
  Object.keys(log).forEach((key) => {
    if (!excludeKeys.includes(key)) {
      details[key] = log[key];
    }
  });
  
  if (Object.keys(details).length === 0) {
    return "—";
  }
  
  return JSON.stringify(details, null, 0);
}

type AlertEntry = {
  id: string;
  level: "warning" | "critical";
  message: string;
};

function evaluateAlerts(logs: AnalyticsEvent[]): AlertEntry[] {
  const alerts: AlertEntry[] = [];
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  // 1. Tool Call Failures
  const toolErrors24h = logs.filter(
    (l) =>
      l.event === "tool_call_error" &&
      new Date(l.timestamp).getTime() >= dayAgo
  ).length;

  if (toolErrors24h > 5) {
    alerts.push({
      id: "tool-errors",
      level: "critical",
      message: `Tool failures in last 24h: ${toolErrors24h} (>5 threshold)`,
    });
  }

  // 2. Parameter Parsing Errors
  const parseErrorsWeek = logs.filter(
    (l) =>
      l.event === "parameter_parse_error" &&
      new Date(l.timestamp).getTime() >= weekAgo
  ).length;

  if (parseErrorsWeek > 3) {
    alerts.push({
      id: "parse-errors",
      level: "warning",
      message: `Parameter parse errors in last 7d: ${parseErrorsWeek} (>3 threshold)`,
    });
  }

  // 3. Empty Result Sets (e.g. missing reminder inputs)
  const successCalls = logs.filter(
    (l) => l.event === "tool_call_success" && new Date(l.timestamp).getTime() >= weekAgo
  );
  const emptyResults = logs.filter(
    (l) => l.event === "tool_call_empty" && new Date(l.timestamp).getTime() >= weekAgo
  ).length;

  const totalCalls = successCalls.length + emptyResults;
  if (totalCalls > 0 && (emptyResults / totalCalls) > 0.2) {
    alerts.push({
      id: "empty-results",
      level: "warning",
      message: `Empty result rate ${((emptyResults / totalCalls) * 100).toFixed(1)}% (>20% threshold)`,
    });
  }

  // 4. Widget Load Failures (Crashes)
  const widgetCrashes = logs.filter(
    (l) => l.event === "widget_crash" && new Date(l.timestamp).getTime() >= dayAgo
  ).length;

  if (widgetCrashes > 0) {
    alerts.push({
      id: "widget-crash",
      level: "critical",
      message: `Widget crashes in last 24h: ${widgetCrashes} (Fix immediately)`,
    });
  }

  // 5. Buttondown Subscription Failures
  const recentSubs = logs.filter(
    (l) =>
      (l.event === "widget_notify_me_subscribe" ||
        l.event === "widget_notify_me_subscribe_error") &&
      new Date(l.timestamp).getTime() >= weekAgo
  );

  const subFailures = recentSubs.filter(
    (l) => l.event === "widget_notify_me_subscribe_error"
  ).length;

  const failureRate =
    recentSubs.length > 0 ? subFailures / recentSubs.length : 0;

  if (recentSubs.length >= 5 && failureRate > 0.1) {
    alerts.push({
      id: "buttondown-failures",
      level: "warning",
      message: `Buttondown failure rate ${(failureRate * 100).toFixed(
        1
      )}% over last 7d (${subFailures}/${recentSubs.length})`,
    });
  }

  return alerts;
}

function generateAnalyticsDashboard(logs: AnalyticsEvent[], alerts: AlertEntry[]): string {
  const errorLogs = logs.filter((l) => l.event.includes("error"));
  const successLogs = logs.filter((l) => l.event === "tool_call_success");
  const parseLogs = logs.filter((l) => l.event === "parameter_parse_error");
  const widgetEvents = logs.filter((l) => l.event.startsWith("widget_"));

  const avgResponseTime =
    successLogs.length > 0
      ? (successLogs.reduce((sum, l) => sum + (l.responseTime || 0), 0) /
          successLogs.length).toFixed(0)
      : "N/A";

  const paramUsage: Record<string, number> = {};
  const priorityDist: Record<string, number> = {};
  const categoryDist: Record<string, number> = {};
  
  successLogs.forEach((log) => {
    if (log.params) {
      Object.keys(log.params).forEach((key) => {
        if (log.params[key] !== undefined) {
          paramUsage[key] = (paramUsage[key] || 0) + 1;
        }
      });
      // Track priority distribution
      if (log.params.priority) {
        const priority = log.params.priority;
        priorityDist[priority] = (priorityDist[priority] || 0) + 1;
      }
    }
  });
  
  const widgetInteractions: Record<string, number> = {};
  widgetEvents.forEach((log) => {
    const humanName = humanizeEventName(log.event);
    widgetInteractions[humanName] = (widgetInteractions[humanName] || 0) + 1;
  });
  
  // Recurrence distribution
  const recurrenceDist: Record<string, number> = {};
  successLogs.forEach((log) => {
    if (log.params?.recurrence) {
      const recurrence = log.params.recurrence;
      recurrenceDist[recurrence] = (recurrenceDist[recurrence] || 0) + 1;
    }
  });

  // Reminder Actions
  const actionCounts: Record<string, number> = {
    "Create Reminder": 0,
    "Complete Task": 0,
    "Filter Change": 0, 
    "Search": 0,
    "Screenshot Import": 0,
    "Reset Progress": 0
  };

  widgetEvents.forEach(log => {
      if (log.event === "widget_create_reminder") actionCounts["Create Reminder"]++;
      if (log.event === "widget_complete_task") actionCounts["Complete Task"]++;
      if (log.event === "widget_filter_change") actionCounts["Filter Change"]++;
      if (log.event === "widget_search") actionCounts["Search"]++;
      if (log.event === "widget_screenshot_import") actionCounts["Screenshot Import"]++;
      if (log.event === "widget_reset_progress") actionCounts["Reset Progress"]++;
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reminder App Analytics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #1a1a1a; margin-bottom: 10px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card h2 { font-size: 14px; color: #666; text-transform: uppercase; margin-bottom: 10px; }
    .card .value { font-size: 32px; font-weight: bold; color: #1a1a1a; }
    .card.error .value { color: #dc2626; }
    .card.success .value { color: #16a34a; }
    .card.warning .value { color: #ea580c; }
    table { width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e5e5; }
    th { background: #f9fafb; font-weight: 600; color: #374151; font-size: 12px; text-transform: uppercase; }
    td { color: #1f2937; font-size: 14px; }
    tr:last-child td { border-bottom: none; }
    .error-row { background: #fef2f2; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .timestamp { color: #9ca3af; font-size: 12px; }
    td strong { color: #1f2937; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Reminder App Analytics</h1>
    <p class="subtitle">Last 7 days • Auto-refresh every 60s</p>
    
    <div class="grid">
      <div class="card ${alerts.length ? "warning" : ""}">
        <h2>Alerts</h2>
        ${
          alerts.length
            ? `<ul style="padding-left:16px;margin:0;">${alerts
                .map(
                  (a) =>
                    `<li><strong>${a.level.toUpperCase()}</strong> — ${a.message}</li>`
                )
                .join("")}</ul>`
            : '<p style="color:#16a34a;">No active alerts</p>'
        }
      </div>
      <div class="card success">
        <h2>Total Calls</h2>
        <div class="value">${successLogs.length}</div>
      </div>
      <div class="card error">
        <h2>Errors</h2>
        <div class="value">${errorLogs.length}</div>
      </div>
      <div class="card warning">
        <h2>Parse Errors</h2>
        <div class="value">${parseLogs.length}</div>
      </div>
      <div class="card">
        <h2>Avg Response Time</h2>
        <div class="value">${avgResponseTime}<span style="font-size: 16px; color: #666;">ms</span></div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>Parameter Usage</h2>
      <table>
        <thead><tr><th>Parameter</th><th>Times Used</th><th>Usage %</th></tr></thead>
        <tbody>
          ${Object.entries(paramUsage)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([param, count]) => `
            <tr>
              <td><code>${param}</code></td>
              <td>${count}</td>
              <td>${((count / successLogs.length) * 100).toFixed(1)}%</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="grid" style="margin-bottom: 20px;">
      <div class="card">
        <h2>Priority Distribution</h2>
        <table>
          <thead><tr><th>Priority</th><th>Count</th></tr></thead>
          <tbody>
            ${Object.entries(priorityDist).length > 0 ? Object.entries(priorityDist)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .map(
                ([priority, count]) => `
              <tr>
                <td>${priority}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
      
       <div class="card">
        <h2>User Actions</h2>
        <table>
          <thead><tr><th>Action</th><th>Count</th></tr></thead>
          <tbody>
            ${Object.entries(actionCounts)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([action, count]) => `
              <tr>
                <td>${action}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>


    <div class="card" style="margin-bottom: 20px;">
      <h2>Widget Interactions</h2>
      <table>
        <thead><tr><th>Action</th><th>Count</th></tr></thead>
        <tbody>
          ${Object.entries(widgetInteractions).length > 0 ? Object.entries(widgetInteractions)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([action, count]) => `
            <tr>
              <td>${action}</td>
              <td>${count}</td>
            </tr>
          `
            )
            .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="grid" style="margin-bottom: 20px;">
      <div class="card">
        <h2>Recurrence Types</h2>
        <table>
          <thead><tr><th>Type</th><th>Count</th></tr></thead>
          <tbody>
            ${Object.entries(recurrenceDist).length > 0 ? Object.entries(recurrenceDist)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .map(
                ([recurrence, count]) => `
              <tr>
                <td>${recurrence}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>User Queries (Inferred from Tool Calls)</h2>
      <table>
        <thead><tr><th>Date</th><th>Query</th><th>Location</th><th>Locale</th></tr></thead>
        <tbody>
          ${successLogs.length > 0 ? successLogs
            .slice(0, 20)
            .map(
              (log) => `
            <tr>
              <td class="timestamp" style="white-space: nowrap;">${new Date(log.timestamp).toLocaleString()}</td>
              <td style="max-width: 400px;">${log.inferredQuery || "general search"}</td>
              <td style="font-size: 12px; color: #6b7280;">${log.userLocation ? `${log.userLocation.city || ''}, ${log.userLocation.region || ''}, ${log.userLocation.country || ''}`.replace(/^, |, $/g, '') : '—'}</td>
              <td style="font-size: 12px; color: #6b7280;">${log.userLocale || '—'}</td>
            </tr>
          `
            )
            .join("") : '<tr><td colspan="4" style="text-align: center; color: #9ca3af;">No queries yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>User Feedback</h2>
      <table>
        <thead><tr><th>Date</th><th>Feedback</th></tr></thead>
        <tbody>
          ${logs.filter(l => l.event === "widget_user_feedback").length > 0 ? logs
            .filter(l => l.event === "widget_user_feedback")
            .slice(0, 20)
            .map(
              (log) => `
            <tr>
              <td class="timestamp" style="white-space: nowrap;">${new Date(log.timestamp).toLocaleString()}</td>
              <td style="max-width: 600px;">${log.feedback || "—"}</td>
            </tr>
          `
            )
            .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No feedback yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Recent Events (Last 50)</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
        <tbody>
          ${logs
            .slice(0, 50)
            .map(
              (log) => `
            <tr class="${log.event.includes("error") ? "error-row" : ""}">
              <td class="timestamp">${new Date(log.timestamp).toLocaleString()}</td>
              <td><strong>${humanizeEventName(log.event)}</strong></td>
              <td style="font-size: 12px; max-width: 600px; overflow: hidden; text-overflow: ellipsis;">${formatEventDetails(log)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </div>
  <script>setTimeout(() => location.reload(), 60000);</script>
</body>
</html>`;
}

async function handleAnalytics(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!checkAnalyticsAuth(req, url)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Analytics Dashboard"',
      "Content-Type": "text/plain",
    });
    res.end("Authentication required");
    return;
  }

  try {
    const logs = getRecentLogs(7);
    const alerts = evaluateAlerts(logs);
    alerts.forEach((alert) =>
      console.warn("[ALERT]", alert.id, alert.message)
    );
    const html = generateAnalyticsDashboard(logs, alerts);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch (error) {
    console.error("Analytics error:", error);
    res.writeHead(500).end("Failed to generate analytics");
  }
}

async function handleAnalyticsJson(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Content-Type", "application/json");

  if (!checkAnalyticsAuth(req, url)) {
    res.writeHead(401).end(JSON.stringify({ error: "Authentication required" }));
    return;
  }

  try {
    const logs = getRecentLogs(7);
    const alerts = evaluateAlerts(logs);
    const runId = url.searchParams.get("runId");
    const filtered = runId ? logs.filter((l) => String((l as any).runId ?? "") === runId) : logs;
    res.writeHead(200).end(
      JSON.stringify({
        ok: true,
        alerts,
        logs: filtered,
      })
    );
  } catch (error: any) {
    console.error("Analytics JSON error:", error);
    res.writeHead(500).end(JSON.stringify({ error: "Failed to generate analytics" }));
  }
}

async function handleAnalyticsCrashJson(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Content-Type", "application/json");

  // No-auth endpoint, but sanitized + limited scope.
  try {
    const logs = getRecentLogs(2);
    const runId = url.searchParams.get("runId");
    const filtered = logs
      .filter((l) => {
        const e = String(l.event ?? "");
        // Only include widget lifecycle + crash diagnostics.
        if (!e.startsWith("widget_")) return false;
        return (
          e.includes("crash") ||
          e.includes("global_error") ||
          e.includes("unhandled") ||
          e.includes("track_ingest_error") ||
          e.includes("boot") ||
          e.includes("render") ||
          e.includes("hydration") ||
          e.includes("heartbeat") ||
          e.includes("visibility") ||
          e.includes("load")
        );
      })
      .filter((l) => (runId ? String((l as any).runId ?? "") === runId : true))
      .slice(0, 500)
      .map(sanitizeAnalyticsLog);

    res.writeHead(200).end(
      JSON.stringify({
        ok: true,
        logs: filtered,
      })
    );
  } catch (error: any) {
    console.error("Crash analytics JSON error:", error);
    res.writeHead(500).end(JSON.stringify({ error: "Failed to generate crash analytics" }));
  }
}

async function handleTrackEvent(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const contentLength = req.headers["content-length"];
    const userAgent = String(req.headers["user-agent"] ?? "");
    const forwardedFor = String(req.headers["x-forwarded-for"] ?? "");
    const remoteAddress = (req.socket as any)?.remoteAddress;

    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch (parseError: any) {
      console.error("[TrackEvent] JSON parse error", {
        error: parseError?.message,
        bodyLength: body.length,
        contentLength,
        userAgent,
        forwardedFor,
        remoteAddress,
        bodySnippet: body.slice(0, 500),
      });

      logAnalytics("widget_track_ingest_error", {
        stage: "parse",
        error: parseError?.message,
        bodyLength: body.length,
        contentLength,
        userAgent,
      });

      res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { event, data } = parsed ?? {};

    if (!event) {
      res.writeHead(400).end(JSON.stringify({ error: "Missing event name" }));
      return;
    }

    const eventName = String(event);
    const finalEvent = eventName.startsWith("widget_") ? eventName : `widget_${eventName}`;
    const payload = (data && typeof data === "object") ? data : {};

    // Attach request metadata so we can correlate crashes to client environments.
    const enriched = {
      ...payload,
      _req: {
        contentLength,
        userAgent,
        forwardedFor,
        remoteAddress,
      },
    };

    // Keep this log line compact; details should be in analytics.
    console.log("[TrackEvent]", finalEvent, {
      runId: (payload as any)?.runId,
      t_ms: (payload as any)?.t_ms,
      bodyLength: body.length,
    });

    logAnalytics(finalEvent, enriched);

    res.writeHead(200).end(JSON.stringify({ success: true }));
  } catch (error) {
    console.error("Track event error:", error);
    logAnalytics("widget_track_ingest_error", {
      stage: "handler",
      error: (error as any)?.message ?? String(error),
    });
    res.writeHead(500).end(JSON.stringify({ error: "Failed to track event" }));
  }
}

// Buttondown API integration
async function subscribeToButtondown(email: string, topicId: string, topicName: string) {
  const BUTTONDOWN_API_KEY = process.env.BUTTONDOWN_API_KEY;
  
  console.log("[Buttondown] subscribeToButtondown called", { email, topicId, topicName });
  console.log("[Buttondown] API key present:", !!BUTTONDOWN_API_KEY, "length:", BUTTONDOWN_API_KEY?.length ?? 0);

  if (!BUTTONDOWN_API_KEY) {
    throw new Error("BUTTONDOWN_API_KEY not set in environment variables");
  }

  const metadata: Record<string, any> = {
    topicName,
    source: "reminder-app",
    subscribedAt: new Date().toISOString(),
  };

  const requestBody = {
    email_address: email,
    tags: [topicId],
    metadata,
  };

  console.log("[Buttondown] Sending request body:", JSON.stringify(requestBody));

  const response = await fetch("https://api.buttondown.email/v1/subscribers", {
    method: "POST",
    headers: {
      "Authorization": `Token ${BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  console.log("[Buttondown] Response status:", response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = "Failed to subscribe";
    
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.detail) {
        errorMessage = errorData.detail;
      } else if (errorData.code) {
        errorMessage = `Error: ${errorData.code}`;
      }
    } catch {
      errorMessage = errorText;
    }
    
    throw new Error(errorMessage);
  }

  return await response.json();
}

// Update existing subscriber with new topic
async function updateButtondownSubscriber(email: string, topicId: string, topicName: string) {
  const BUTTONDOWN_API_KEY = process.env.BUTTONDOWN_API_KEY;
  
  if (!BUTTONDOWN_API_KEY) {
    throw new Error("BUTTONDOWN_API_KEY not set in environment variables");
  }

  // First, get the subscriber ID
  const searchResponse = await fetch(`https://api.buttondown.email/v1/subscribers?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: {
      "Authorization": `Token ${BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!searchResponse.ok) {
    throw new Error("Failed to find subscriber");
  }

  const subscribers = await searchResponse.json();
  if (!subscribers.results || subscribers.results.length === 0) {
    throw new Error("Subscriber not found");
  }

  const subscriber = subscribers.results[0];
  const subscriberId = subscriber.id;

  // Update the subscriber with new tag and metadata
  const existingTags = subscriber.tags || [];
  const existingMetadata = subscriber.metadata || {};

  // Add new topic to tags if not already there
  const updatedTags = existingTags.includes(topicId) ? existingTags : [...existingTags, topicId];

  // Add new topic to metadata (Buttondown requires string values)
  const topicKey = `topic_${topicId}`;
  const topicData = JSON.stringify({
    name: topicName,
    subscribedAt: new Date().toISOString(),
  });
  
  const updatedMetadata = {
    ...existingMetadata,
    [topicKey]: topicData,
    source: "reminder-app",
  };

  const updateRequestBody = {
    tags: updatedTags,
    metadata: updatedMetadata,
  };

  console.log("[Buttondown] updateButtondownSubscriber called", { email, topicId, topicName, subscriberId });
  console.log("[Buttondown] Sending update request body:", JSON.stringify(updateRequestBody));

  const updateResponse = await fetch(`https://api.buttondown.email/v1/subscribers/${subscriberId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Token ${BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updateRequestBody),
  });

  console.log("[Buttondown] Update response status:", updateResponse.status, updateResponse.statusText);

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`Failed to update subscriber: ${errorText}`);
  }

  return await updateResponse.json();
}

async function handleSubscribe(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    // Support both old (settlementId/settlementName) and new (topicId/topicName) field names
    const parsed = JSON.parse(body);
    const email = parsed.email;
    const topicId = parsed.topicId || parsed.settlementId || "reminder-app";
    const topicName = parsed.topicName || parsed.settlementName || "Reminder App Updates";
    if (!email || !email.includes("@")) {
      res.writeHead(400).end(JSON.stringify({ error: "Invalid email address" }));
      return;
    }

    const BUTTONDOWN_API_KEY_PRESENT = !!process.env.BUTTONDOWN_API_KEY;
    if (!BUTTONDOWN_API_KEY_PRESENT) {
      res.writeHead(500).end(JSON.stringify({ error: "Server misconfigured: BUTTONDOWN_API_KEY missing" }));
      return;
    }

    try {
      await subscribeToButtondown(email, topicId, topicName);
      res.writeHead(200).end(JSON.stringify({ 
        success: true, 
        message: "Successfully subscribed! You'll receive portfolio optimization tips and updates." 
      }));
    } catch (subscribeError: any) {
      const rawMessage = String(subscribeError?.message ?? "").trim();
      const msg = rawMessage.toLowerCase();
      const already = msg.includes('already subscribed') || msg.includes('already exists') || msg.includes('already on your list') || msg.includes('subscriber already exists') || msg.includes('already');

      if (already) {
        console.log("Subscriber already on list, attempting update", { email, topicId, message: rawMessage });
        try {
          await updateButtondownSubscriber(email, topicId, topicName);
          res.writeHead(200).end(JSON.stringify({ 
            success: true, 
            message: "You're now subscribed to this topic!" 
          }));
        } catch (updateError: any) {
          console.warn("Update subscriber failed, returning graceful success", {
            email,
            topicId,
            error: updateError?.message,
          });
          logAnalytics("widget_notify_me_subscribe_error", {
            stage: "update",
            email,
            error: updateError?.message,
          });
          res.writeHead(200).end(JSON.stringify({
            success: true,
            message: "You're already subscribed! We'll keep you posted.",
          }));
        }
        return;
      }

      logAnalytics("widget_notify_me_subscribe_error", {
        stage: "subscribe",
        email,
        error: rawMessage || "unknown_error",
      });
      throw subscribeError;
    }
  } catch (error: any) {
    console.error("Subscribe error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    logAnalytics("widget_notify_me_subscribe_error", {
      stage: "handler",
      email: undefined,
      error: error.message || "unknown_error",
    });
    res.writeHead(500).end(JSON.stringify({ 
      error: error.message || "Failed to subscribe. Please try again." 
    }));
  }
}

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createReminderAppServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (
      req.method === "OPTIONS" &&
      (url.pathname === ssePath || url.pathname === postPath)
    ) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === healthPath) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
      return;
    }

    if (req.method === "GET" && url.pathname === domainVerificationPath) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end(
        domainVerificationToken
      );
      return;
    }

    if (req.method === "GET" && url.pathname === ssePath) {
      await handleSseRequest(res);
      return;
    }

    if (req.method === "POST" && url.pathname === postPath) {
      await handlePostMessage(req, res, url);
      return;
    }

    if (url.pathname === subscribePath) {
      await handleSubscribe(req, res);
      return;
    }

    if (url.pathname === analyticsPath) {
      await handleAnalytics(req, res, url);
      return;
    }

    if (url.pathname === analyticsJsonPath) {
      await handleAnalyticsJson(req, res, url);
      return;
    }

    if (url.pathname === analyticsCrashJsonPath) {
      await handleAnalyticsCrashJson(req, res, url);
      return;
    }

    if (url.pathname === trackEventPath) {
      await handleTrackEvent(req, res);
      return;
    }

    // Serve alias for legacy loader path -> our main widget HTML
    if (req.method === "GET" && url.pathname === "/assets/reminder-app.html") {
      const mainAssetPath = path.join(ASSETS_DIR, "reminder-app.html");
      console.log(`[Debug Legacy] Request: ${url.pathname}, Main Path: ${mainAssetPath}, Exists: ${fs.existsSync(mainAssetPath)}`);
      if (fs.existsSync(mainAssetPath) && fs.statSync(mainAssetPath).isFile()) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(mainAssetPath).pipe(res);
        return;
      }
    }

    // Serve static assets from /assets directory
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const assetPath = path.join(ASSETS_DIR, url.pathname.slice(8));
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const ext = path.extname(assetPath).toLowerCase();
        const contentTypeMap: Record<string, string> = {
          ".js": "application/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".svg": "image/svg+xml"
        };
        const contentType = contentTypeMap[ext] || "application/octet-stream";
        res.writeHead(200, { 
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        });

        fs.createReadStream(assetPath).pipe(res);
        return;
      }
    }

    res.writeHead(404).end("Not Found");
  }
);

httpServer.on("clientError", (err: Error, socket) => {
  const anyErr = err as any;
  const code = anyErr?.code as string | undefined;
  const now = Date.now();

  const shouldLog = (() => {
    if (code === "ERR_HTTP_REQUEST_TIMEOUT") {
      return now - (httpServer as any).__lastTimeoutLogMs > 60_000;
    }
    return true;
  })();

  if (code === "ERR_HTTP_REQUEST_TIMEOUT") {
    (httpServer as any).__suppressedTimeoutLogs =
      ((httpServer as any).__suppressedTimeoutLogs ?? 0) + (shouldLog ? 0 : 1);

    if (shouldLog) {
      const suppressed = (httpServer as any).__suppressedTimeoutLogs ?? 0;
      (httpServer as any).__lastTimeoutLogMs = now;
      (httpServer as any).__suppressedTimeoutLogs = 0;
      console.error(
        "HTTP client error (request timeout)",
        JSON.stringify({ code, suppressedLastMinute: suppressed })
      );
    }

    socket.end("HTTP/1.1 408 Request Timeout\r\n\r\n");
    return;
  }

  if (shouldLog) {
    console.error("HTTP client error", err);
  }
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

function startMonitoring() {
  // Check alerts every hour
  setInterval(() => {
    try {
      const logs = getRecentLogs(7);
      const alerts = evaluateAlerts(logs);
      
      if (alerts.length > 0) {
        console.log("\n=== 🚨 ACTIVE ALERTS 🚨 ===");
        alerts.forEach(alert => {
          console.log(`[ALERT] [${alert.level.toUpperCase()}] ${alert.message}`);
        });
        console.log("===========================\n");
      }
    } catch (e) {
      console.error("Monitoring check failed:", e);
    }
  }, 60 * 60 * 1000); // 1 hour
}

httpServer.listen(port, () => {
  startMonitoring();
  console.log(`Reminder App MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(
    `  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`
  );
});
