import React from "react";
import { createRoot } from "react-dom/client";

import ReminderApp from "./ReminderApp";

const __RUN_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
(window as any).__reminder_widget_run_id = __RUN_ID;

const __WIDGET_START_MS =
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

const __sinceStartMs = () => {
  const now =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  return Math.round(now - __WIDGET_START_MS);
};

const __log = (...args: any[]) =>
  console.log(`[t+${__sinceStartMs()}ms]`, ...args);

const __getBaseUrl = () => {
  try {
    const raw = (window as any).openai?.serverUrl || "";
    if (!raw) return "https://reminder-app-3pz5.onrender.com";
    try {
      const origin = new URL(raw).origin;
      if (/oaiusercontent\.com$/i.test(origin)) {
        return "https://reminder-app-3pz5.onrender.com";
      }
      return origin;
    } catch {
      if (/oaiusercontent\.com/i.test(raw)) {
        return "https://reminder-app-3pz5.onrender.com";
      }
      return raw;
    }
  } catch {
    return "https://reminder-app-3pz5.onrender.com";
  }
};

const __report = async (event: string, data: Record<string, any>) => {
  try {
    const baseUrl = __getBaseUrl();
    await fetch(`${baseUrl}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        data: {
          ...data,
          runId: __RUN_ID,
          t_ms: __sinceStartMs(),
        },
      }),
    });
  } catch {
    // ignore
  }
};

let __lastLifecycle: Record<string, any> = { runId: __RUN_ID };
const __mark = (phase: string, extra: Record<string, any> = {}) => {
  __lastLifecycle = {
    ...__lastLifecycle,
    phase,
    t_ms: __sinceStartMs(),
    ...extra,
  };
};

__mark("boot", {
  baseUrl: __getBaseUrl(),
  hasOpenAI: !!(window as any).openai,
});

__report("widget_boot", {
  baseUrl: __getBaseUrl(),
  hasOpenAI: !!(window as any).openai,
}).catch(() => {});

window.addEventListener(
  "error",
  (ev: any) => {
    const err = ev?.error;
    __log("[GlobalError]", ev?.message, err);
    __mark("global_error", {
      message: ev?.message,
      filename: ev?.filename,
      lineno: ev?.lineno,
      colno: ev?.colno,
    });
    __report("widget_global_error", {
      message: ev?.message,
      filename: ev?.filename,
      lineno: ev?.lineno,
      colno: ev?.colno,
      error: err?.message || String(err || ""),
      stack: err?.stack,
      lastLifecycle: __lastLifecycle,
    });
  },
  true
);

window.addEventListener(
  "unhandledrejection",
  (ev: any) => {
    const reason = ev?.reason;
    __log("[UnhandledRejection]", reason);
    __mark("unhandled_rejection", {
      reason: reason?.message || String(reason || ""),
    });
    __report("widget_unhandled_rejection", {
      reason: reason?.message || String(reason || ""),
      stack: reason?.stack,
      lastLifecycle: __lastLifecycle,
    });
  },
  true
);

window.setTimeout(() => {
  __log("[Heartbeat] alive @3s");
  __mark("heartbeat", { at: "3s" });
  __report("widget_heartbeat", { at: "3s", lastLifecycle: __lastLifecycle }).catch(() => {});
}, 3000);
window.setTimeout(() => {
  __log("[Heartbeat] alive @5s");
  __mark("heartbeat", { at: "5s" });
  __report("widget_heartbeat", { at: "5s", lastLifecycle: __lastLifecycle }).catch(() => {});
}, 5000);
window.setTimeout(() => {
  __log("[Heartbeat] alive @7s");
  __mark("heartbeat", { at: "7s" });
  __report("widget_heartbeat", { at: "7s", lastLifecycle: __lastLifecycle }).catch(() => {});
}, 7000);

document.addEventListener("visibilitychange", () => {
  const state = document.visibilityState;
  __mark("visibility", { visibilityState: state });
  __report("widget_visibility", { visibilityState: state, lastLifecycle: __lastLifecycle }).catch(() => {});
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Widget Error Boundary caught error:", error, errorInfo);
    __mark("react_error_boundary", {
      error: error?.message || "Unknown error",
    });
    // Log to server
    try {
      __report("crash", {
        error: error?.message || "Unknown error",
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
        lastLifecycle: __lastLifecycle,
      }).catch(() => {});
    } catch (e) {
        // Ignore reporting errors
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, textAlign: "center", fontFamily: "sans-serif", color: "#DC2626", wordBreak: "break-word" }}>
          <h3>Something went wrong.</h3>
          <p>Please try refreshing the page.</p>
          {/* Debug Info */}
          <details style={{ marginTop: 10, textAlign: "left", fontSize: "12px", color: "#666" }}>
            <summary>Debug Error Details</summary>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 10, borderRadius: 4 }}>
              {(this.state as any).error?.toString()}
              <br />
              {(this.state as any).error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

// Add hydration type definitions
interface OpenAIGlobals {
  toolOutput?: any;
  structuredContent?: any;
  toolInput?: any;
  result?: {
    structuredContent?: any;
  };
}

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isBoilerplateInput = (text: string): boolean =>
  /^((add|set|create)\s+)?(a\s+)?(daily\s+|weekly\s+|monthly\s+)?reminders?\.?$/i.test(text) ||
  /^remind\s+me\.?$/i.test(text);

const hasMeaningfulHydrationData = (data: any): boolean => {
  if (!data || typeof data !== "object") return false;

  // Fields that should trigger hydration/create behavior.
  if (
    isNonEmptyString(data.natural_input) ||
    isNonEmptyString(data.title) ||
    isNonEmptyString(data.complete_query) ||
    isNonEmptyString(data.due_date) ||
    isNonEmptyString(data.due_time) ||
    isNonEmptyString(data.recurrence) ||
    isNonEmptyString(data.description) ||
    isNonEmptyString(data.priority)
  ) {
    return true;
  }

  if (Array.isArray(data.tags) && data.tags.length > 0) return true;
  if (Array.isArray(data.recurrence_days) && data.recurrence_days.length > 0) return true;

  // Action-only payloads are too weak and often arrive before real tool output.
  return false;
};

const hydrationQualitySignals = (data: any) => {
  const natural = typeof data?.natural_input === "string" ? data.natural_input.trim() : "";
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  const hasNaturalInput = isNonEmptyString(natural) && !isBoilerplateInput(natural);
  const hasTitle = isNonEmptyString(title) && !isBoilerplateInput(title);
  const hasDateHint = isNonEmptyString(data?.due_date);
  const hasTimeHint = isNonEmptyString(data?.due_time);
  const hasRecurrenceHint = isNonEmptyString(data?.recurrence) && data.recurrence !== "none";
  const hasQueryHint = isNonEmptyString(data?.complete_query);
  const hasAction = isNonEmptyString(data?.action);

  return {
    hasNaturalInput,
    hasTitle,
    hasDateHint,
    hasTimeHint,
    hasRecurrenceHint,
    hasQueryHint,
    hasAction,
  };
};

const scoreHydrationCandidate = (data: any): number => {
  const q = hydrationQualitySignals(data);
  let score = 0;
  if (q.hasNaturalInput) score += 60;
  if (q.hasTitle) score += 30;
  if (q.hasDateHint) score += 20;
  if (q.hasTimeHint) score += 15;
  if (q.hasRecurrenceHint) score += 10;
  if (q.hasQueryHint) score += 8;
  if (q.hasAction) score += 2;
  score += Math.min(Object.keys(data || {}).length, 10);
  return score;
};

// Hydration Helper
const getHydrationData = (): any => {
  console.log("[Hydration] Starting hydration check...");
  
  // Check for window.openai
  if (typeof window === 'undefined') {
    console.log("[Hydration] Window is undefined");
    return {};
  }
  
  const oa = (window as any).openai as OpenAIGlobals;
  if (!oa) {
    console.log("[Hydration] window.openai not found, rendering with defaults");
    return {};
  }

  console.log("[Hydration] window.openai found:", Object.keys(oa));

  // Prioritize sources as per reference implementation
  const candidates = [
    oa.toolOutput,
    oa.structuredContent,
    oa.result?.structuredContent,
    oa.toolInput
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      Object.keys(candidate).length > 0 &&
      hasMeaningfulHydrationData(candidate)
    ) {
      console.log("[Hydration] Found data:", candidate);
      return candidate;
    }
  }
  
  console.log("[Hydration] No data found in any candidate source");
  return {};
};

console.log("[Main] Reminder App main.tsx loading...");
__log("[Main] Starting (baseUrl)", __getBaseUrl());

// App wrapper - Reminder App
function App({ initialData }: { initialData: any }) {
  return <ReminderApp initialData={initialData} />;
}

// Get initial data
const container = document.getElementById("reminder-app-root") || document.getElementById("travel-checklist-root");

if (!container) {
  throw new Error("reminder-app-root element not found");
}

const root = createRoot(container);

let __appliedLateHydration = false;
let __renderCount = 0;
let __currentInitialData: any = null;
type HydrationCandidate = {
  source: string;
  data: any;
  score: number;
  keys: string[];
  atMs: number;
};
let __hydrationCandidates: HydrationCandidate[] = [];
let __hydrationSettleTimer: number | null = null;
const HYDRATION_SETTLE_MS = 350;

const renderApp = (data: any) => {
  __renderCount += 1;
  __currentInitialData = data;
  __mark("render", {
    renderCount: __renderCount,
    initialDataKeys: data && typeof data === "object" ? Object.keys(data) : [],
  });
  __report("widget_render", {
    renderCount: __renderCount,
    initialDataKeys: data && typeof data === "object" ? Object.keys(data) : [],
    hydrationPrefill: {
      hasNaturalInput: !!(data && typeof data === "object" && (data as any).natural_input),
      hasAction: !!(data && typeof data === "object" && (data as any).action),
      hasCompleteQuery: !!(data && typeof data === "object" && (data as any).complete_query),
    },
    lastLifecycle: __lastLifecycle,
  }).catch(() => {});

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App initialData={data} />
      </ErrorBoundary>
    </React.StrictMode>
  );
};

const selectBestHydrationCandidate = (): HydrationCandidate | null => {
  if (__hydrationCandidates.length === 0) return null;
  return __hydrationCandidates
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.atMs - a.atMs;
    })[0];
};

const flushHydrationCandidates = () => {
  __hydrationSettleTimer = null;
  if (__appliedLateHydration) return;
  const best = selectBestHydrationCandidate();
  if (!best) return;

  const merged = {
    ...(typeof __currentInitialData === "object" && __currentInitialData ? __currentInitialData : {}),
    ...best.data,
  };
  __appliedLateHydration = true;
  __mark("hydration_candidate_selected", {
    source: best.source,
    score: best.score,
    keys: best.keys,
    candidateCount: __hydrationCandidates.length,
  });
  __report("widget_hydration_candidate_selected", {
    source: best.source,
    score: best.score,
    keys: best.keys,
    candidateCount: __hydrationCandidates.length,
    quality: hydrationQualitySignals(best.data),
    mergedKeys: Object.keys(merged),
    lastLifecycle: __lastLifecycle,
  }).catch(() => {});
  __hydrationCandidates = [];
  renderApp(merged);
};

const queueHydrationCandidate = (source: string, candidate: any) => {
  const keys = candidate && typeof candidate === "object" ? Object.keys(candidate) : [];
  if (!hasMeaningfulHydrationData(candidate)) {
    __report("widget_hydration_candidate_rejected", {
      source,
      keys,
      reason: "not_meaningful_or_empty",
      lastLifecycle: __lastLifecycle,
    }).catch(() => {});
    return;
  }
  if (__appliedLateHydration) {
    __report("widget_hydration_candidate_rejected", {
      source,
      keys,
      reason: "already_applied",
      lastLifecycle: __lastLifecycle,
    }).catch(() => {});
    return;
  }

  const score = scoreHydrationCandidate(candidate);
  __hydrationCandidates.push({
    source,
    data: candidate,
    score,
    keys,
    atMs: __sinceStartMs(),
  });

  __report("widget_hydration_candidate_scored", {
    source,
    keys,
    score,
    quality: hydrationQualitySignals(candidate),
    lastLifecycle: __lastLifecycle,
  }).catch(() => {});

  if (__hydrationSettleTimer !== null) {
    window.clearTimeout(__hydrationSettleTimer);
  }
  __hydrationSettleTimer = window.setTimeout(flushHydrationCandidates, HYDRATION_SETTLE_MS);
};

// Initial render
const initialData = getHydrationData();
__currentInitialData = {};
__log("[Hydration] initialData keys", initialData && typeof initialData === "object" ? Object.keys(initialData) : []);
__mark("hydration_initial", {
  initialDataKeys: initialData && typeof initialData === "object" ? Object.keys(initialData) : [],
});
__report("widget_hydration_initial", {
  initialDataKeys: initialData && typeof initialData === "object" ? Object.keys(initialData) : [],
  hydrationPrefill: {
    hasNaturalInput: !!(initialData && typeof initialData === "object" && (initialData as any).natural_input),
    hasAction: !!(initialData && typeof initialData === "object" && (initialData as any).action),
    hasCompleteQuery: !!(initialData && typeof initialData === "object" && (initialData as any).complete_query),
  },
  hasOpenAI: !!(window as any).openai,
  openaiKeys: (window as any).openai ? Object.keys((window as any).openai) : [],
  lastLifecycle: __lastLifecycle,
}).catch(() => {});
renderApp({});
queueHydrationCandidate("initial", initialData);

// Listen for MCP Apps bridge tool-result notifications (official docs pattern)
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (!msg || msg.jsonrpc !== "2.0") return;

  if (msg.method === "ui/notifications/tool-result") {
    const payload = msg.params;
    const data = payload?.structuredContent;
    __mark("hydration_jsonrpc", {
      method: msg.method,
      keys: data && typeof data === "object" ? Object.keys(data) : [],
    });
    queueHydrationCandidate("jsonrpc_tool_result", data);
  }
}, { passive: true });

// Listen for late hydration events (Apps SDK pattern)
window.addEventListener('openai:set_globals', (ev: any) => {
  const globals = ev?.detail?.globals;
  if (globals) {
    console.log("[Hydration] Late event received:", globals);
    __mark("hydration_late_event", {
      globalsKeys: globals && typeof globals === "object" ? Object.keys(globals) : [],
      alreadyApplied: __appliedLateHydration,
    });
    __report("widget_hydration_late_event", {
      globalsKeys: globals && typeof globals === "object" ? Object.keys(globals) : [],
      alreadyApplied: __appliedLateHydration,
      lastLifecycle: __lastLifecycle,
    }).catch(() => {});
    
    // Extract data from the event globals similar to getHydrationData
    const candidates = [
      globals.toolOutput,
      globals.structuredContent,
      globals.result?.structuredContent,
      globals.toolInput
    ];
    
    for (let i = 0; i < candidates.length; i++) {
      queueHydrationCandidate(`set_globals_${i}`, candidates[i]);
    }
  }
});
