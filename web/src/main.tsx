import React from "react";
import { createRoot } from "react-dom/client";

import ReminderApp from "./ReminderApp";

 const __WIDGET_START_MS = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
 const __sinceStartMs = () => {
   const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
   return Math.round(now - __WIDGET_START_MS);
 };
 const __log = (...args: any[]) => console.log(`[t+${__sinceStartMs()}ms]`, ...args);
 const __getBaseUrl = () => {
   try {
     return (window as any).openai?.serverUrl || "";
   } catch {
     return "";
   }
 };
 const __report = async (event: string, data: Record<string, any>) => {
   try {
     const baseUrl = __getBaseUrl();
     await fetch(`${baseUrl}/api/track`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ event, data }),
     });
   } catch {
     // ignore
   }
 };

 // Capture crashes that bypass React error boundaries (e.g. unhandled promise rejections)
 window.addEventListener(
   "error",
   (ev: any) => {
     const err = ev?.error;
     __log("[GlobalError]", ev?.message, err);
     __report("widget_global_error", {
       t_ms: __sinceStartMs(),
       message: ev?.message,
       filename: ev?.filename,
       lineno: ev?.lineno,
       colno: ev?.colno,
       error: err?.message || String(err || ""),
       stack: err?.stack,
     });
   },
   true
 );
 window.addEventListener(
   "unhandledrejection",
   (ev: any) => {
     const reason = ev?.reason;
     __log("[UnhandledRejection]", reason);
     __report("widget_unhandled_rejection", {
       t_ms: __sinceStartMs(),
       reason: reason?.message || String(reason || ""),
       stack: reason?.stack,
     });
   },
   true
 );

 // Heartbeat logs so we can correlate "crash around 3-6s" precisely.
 window.setTimeout(() => __log("[Heartbeat] alive @3s"), 3000);
 window.setTimeout(() => __log("[Heartbeat] alive @5s"), 5000);
 window.setTimeout(() => __log("[Heartbeat] alive @7s"), 7000);

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
    // Log to server
    try {
        const baseUrl = __getBaseUrl();
        fetch(`${baseUrl}/api/track`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event: "crash",
                data: {
                    error: error?.message || "Unknown error",
                    stack: error?.stack,
                    componentStack: errorInfo?.componentStack
                }
            })
        }).catch(e => console.error("Failed to report crash", e));
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
    if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) {
      console.log("[Hydration] Found data:", candidate);
      return candidate;
    }
  }
  
  console.log("[Hydration] No data found in any candidate source");
  return {};
};

console.log("[Main] Reminder App main.tsx loading...");

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

const renderApp = (data: any) => {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App key={Date.now()} initialData={data} />
      </ErrorBoundary>
    </React.StrictMode>
  );
};

// Initial render
const initialData = getHydrationData();
renderApp(initialData);

// Listen for late hydration events (Apps SDK pattern)
window.addEventListener('openai:set_globals', (ev: any) => {
  const globals = ev?.detail?.globals;
  if (globals) {
    console.log("[Hydration] Late event received:", globals);
    
    // Extract data from the event globals similar to getHydrationData
    const candidates = [
      globals.toolOutput,
      globals.structuredContent,
      globals.result?.structuredContent,
      globals.toolInput
    ];
    
    for (const candidate of candidates) {
       if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) {
          console.log("[Hydration] Re-rendering with late data:", candidate);
          // Force re-mount by changing key, ensuring initialData is applied fresh
          renderApp(candidate);
          return;
       }
    }
  }
});
