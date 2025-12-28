import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Bell, Plus, Check, X, Clock, Calendar, Search, Filter, Trash2,
  Edit2, Repeat, Trophy, Flame, Star, Award, Crown, Send,
  SortAsc, SortDesc, Timer, Briefcase, Users, Heart, ShoppingCart,
  Stethoscope, GraduationCap, Plane, Home, Sparkles, ChevronRight
} from "lucide-react";

type Priority = "low" | "medium" | "high" | "urgent";
type RecurrenceType = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
type Category = "work" | "family" | "health" | "errands" | "finance" | "social" | "learning" | "travel" | "home" | "other";

interface Reminder {
  id: string;
  title: string;
  description?: string;
  dueDate: string; // Start date for recurring reminders
  dueTime?: string;
  endDate?: string; // End date for recurring reminders (optional)
  priority: Priority;
  category: Category;
  recurrence: RecurrenceType;
  recurrenceInterval?: number; // e.g., 3 for "every 3 days"
  recurrenceUnit?: "days" | "weeks" | "months" | "years";
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  pointsAwarded: number;
}

interface UserStats {
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  completedAllTime: number;
  level: number;
  achievements: { id: string; name: string; icon: string; unlocked: boolean }[];
}

interface ParsedReminder {
  title: string;
  dueDate: string;
  dueTime?: string;
  priority: Priority;
  category: Category;
  recurrence: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: "days" | "weeks" | "months" | "years";
  confidence: number;
}

const COLORS = {
  primary: "#2D5A3D", primaryLight: "#56C596", primaryBg: "#E8F5E9",
  success: "#2E7D32", warning: "#F59E0B", danger: "#D32F2F",
  bg: "#F5F7F5", card: "#FFFFFF", cardAlt: "#FAFBFA",
  textMain: "#1A1A1A", textSecondary: "#5F6368", textMuted: "#9CA3AF",
  border: "#E0E5E0", inputBg: "#F8FAF8", gold: "#F59E0B", 
  accent: "#3D7A5A", accentLight: "#E6F4EA"
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#10B981", medium: "#F59E0B", high: "#F97316", urgent: "#EF4444"
};

const CATEGORY_CONFIG: Record<Category, { icon: any; color: string; label: string }> = {
  work: { icon: Briefcase, color: "#3B82F6", label: "Work" },
  family: { icon: Users, color: "#EC4899", label: "Family" },
  health: { icon: Stethoscope, color: "#10B981", label: "Health" },
  errands: { icon: ShoppingCart, color: "#F59E0B", label: "Errands" },
  finance: { icon: Briefcase, color: "#8B5CF6", label: "Finance" },
  social: { icon: Heart, color: "#EF4444", label: "Social" },
  learning: { icon: GraduationCap, color: "#06B6D4", label: "Learning" },
  travel: { icon: Plane, color: "#6366F1", label: "Travel" },
  home: { icon: Home, color: "#84CC16", label: "Home" },
  other: { icon: Star, color: "#64748B", label: "Other" }
};

const STORAGE_KEY = "REMINDER_APP_DATA";
const STATS_KEY = "REMINDER_APP_STATS";

const generateId = () => `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatTime = (time?: string) => {
  if (!time) return "";
  const [h, m] = time.split(":"); const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
};

const isOverdue = (r: Reminder) => !r.completed && new Date(`${r.dueDate}T${r.dueTime || "23:59"}`) < new Date();

// Smart category detection based on keywords
const detectCategory = (text: string): Category => {
  const lower = text.toLowerCase();
  
  // Work keywords
  if (/\b(meeting|email|report|deadline|project|client|boss|office|presentation|call with|sync|standup|review|submit|proposal)\b/.test(lower)) return "work";
  
  // Family keywords
  if (/\b(mom|dad|mother|father|sister|brother|family|kids|children|son|daughter|wife|husband|grandma|grandpa|parent|anniversary)\b/.test(lower)) return "family";
  
  // Health keywords
  if (/\b(doctor|dentist|gym|workout|exercise|medicine|prescription|appointment|therapy|vitamin|checkup|hospital|health)\b/.test(lower)) return "health";
  
  // Errands keywords
  if (/\b(buy|grocery|store|shop|pick up|drop off|return|mail|post office|bank|dry clean|repair)\b/.test(lower)) return "errands";
  
  // Finance keywords
  if (/\b(pay|bill|invoice|tax|budget|investment|rent|mortgage|insurance|account)\b/.test(lower)) return "finance";
  
  // Social keywords
  if (/\b(party|dinner|lunch|coffee|friend|birthday|celebration|event|hangout|catch up)\b/.test(lower)) return "social";
  
  // Learning keywords
  if (/\b(study|class|course|book|read|learn|homework|exam|test|practice|lesson|tutorial)\b/.test(lower)) return "learning";
  
  // Travel keywords
  if (/\b(flight|hotel|trip|vacation|travel|pack|passport|booking|reservation|airport)\b/.test(lower)) return "travel";
  
  // Home keywords
  if (/\b(clean|laundry|dishes|fix|repair|garden|lawn|organize|declutter|cook|water plants)\b/.test(lower)) return "home";
  
  return "other";
};

// Smart priority detection
const detectPriority = (text: string, dueDate?: string): Priority => {
  const lower = text.toLowerCase();
  
  // Explicit priority keywords
  if (/\b(urgent|asap|immediately|critical|emergency)\b/.test(lower)) return "urgent";
  if (/\b(important|high priority|crucial|must)\b/.test(lower)) return "high";
  if (/\b(low priority|whenever|no rush|eventually)\b/.test(lower)) return "low";
  
  // Infer from due date proximity
  if (dueDate) {
    const due = new Date(dueDate);
    const today = new Date();
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "urgent";
    if (diffDays <= 1) return "high";
    if (diffDays <= 3) return "medium";
  }
  
  return "medium";
};

// Full natural language parser
const parseNaturalLanguage = (input: string): ParsedReminder => {
  const lower = input.toLowerCase();
  const today = new Date();
  let confidence = 0;
  
  // Parse time
  let dueTime: string | undefined;
  const timePatterns = [
    { regex: /at (\d{1,2}):(\d{2})\s*(am|pm)?/i, handler: (m: RegExpMatchArray) => {
      let h = parseInt(m[1]); const min = m[2];
      if (m[3]?.toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:${min}`;
    }},
    { regex: /at (\d{1,2})\s*(am|pm)/i, handler: (m: RegExpMatchArray) => {
      let h = parseInt(m[1]);
      if (m[2].toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[2].toLowerCase() === "am" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:00`;
    }},
    { regex: /(\d{1,2})(am|pm)/i, handler: (m: RegExpMatchArray) => {
      let h = parseInt(m[1]);
      if (m[2].toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[2].toLowerCase() === "am" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:00`;
    }}
  ];
  
  for (const p of timePatterns) {
    const match = input.match(p.regex);
    if (match) { dueTime = p.handler(match); confidence += 20; break; }
  }
  
  // Parse date
  let dueDate = today.toISOString().split("T")[0]; // Default to today
  
  if (lower.includes("today")) { confidence += 20; }
  else if (lower.includes("tonight")) { 
    dueTime = dueTime || "20:00"; confidence += 20;
  }
  else if (lower.includes("tomorrow")) {
    const tom = new Date(today); tom.setDate(tom.getDate() + 1);
    dueDate = tom.toISOString().split("T")[0]; confidence += 20;
  }
  else if (lower.includes("next week")) {
    const next = new Date(today); next.setDate(next.getDate() + 7);
    dueDate = next.toISOString().split("T")[0]; confidence += 15;
  }
  else if (lower.includes("this weekend")) {
    const sat = new Date(today);
    sat.setDate(sat.getDate() + (6 - sat.getDay()));
    dueDate = sat.toISOString().split("T")[0]; confidence += 15;
  }
  else {
    // "in X days/hours"
    const daysMatch = lower.match(/in (\d+) days?/);
    const hoursMatch = lower.match(/in (\d+) hours?/);
    const weeksMatch = lower.match(/in (\d+) weeks?/);
    
    if (daysMatch) {
      const fut = new Date(today); fut.setDate(fut.getDate() + parseInt(daysMatch[1]));
      dueDate = fut.toISOString().split("T")[0]; confidence += 15;
    } else if (hoursMatch) {
      const fut = new Date(); fut.setHours(fut.getHours() + parseInt(hoursMatch[1]));
      dueDate = fut.toISOString().split("T")[0];
      dueTime = `${fut.getHours().toString().padStart(2, "0")}:${fut.getMinutes().toString().padStart(2, "0")}`;
      confidence += 15;
    } else if (weeksMatch) {
      const fut = new Date(today); fut.setDate(fut.getDate() + parseInt(weeksMatch[1]) * 7);
      dueDate = fut.toISOString().split("T")[0]; confidence += 15;
    }
    
    // Day names
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (let i = 0; i < days.length; i++) {
      if (lower.includes(days[i]) || lower.includes(`on ${days[i]}`)) {
        const target = new Date(today);
        const diff = (i - today.getDay() + 7) % 7 || 7;
        target.setDate(target.getDate() + diff);
        dueDate = target.toISOString().split("T")[0];
        confidence += 15;
        break;
      }
    }
  }
  
  // Parse recurrence - Enhanced with custom intervals and semantic inference
  let recurrence: RecurrenceType = "none";
  let recurrenceInterval: number | undefined;
  let recurrenceUnit: "days" | "weeks" | "months" | "years" | undefined;
  
  // 1. Explicit custom intervals: "every X days/weeks/months/years"
  const customRecurrenceMatch = lower.match(/every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)/i);
  if (customRecurrenceMatch) {
    const num = parseInt(customRecurrenceMatch[1]);
    const unit = customRecurrenceMatch[2].toLowerCase();
    recurrenceInterval = num;
    
    if (unit.startsWith("day")) {
      recurrenceUnit = "days";
      recurrence = num === 1 ? "daily" : "custom";
    } else if (unit.startsWith("week")) {
      recurrenceUnit = "weeks";
      recurrence = num === 1 ? "weekly" : "custom";
    } else if (unit.startsWith("month")) {
      recurrenceUnit = "months";
      recurrence = num === 1 ? "monthly" : "custom";
    } else if (unit.startsWith("year")) {
      recurrenceUnit = "years";
      recurrence = num === 1 ? "yearly" : "custom";
    }
    confidence += 15;
  }
  // 2. Standard recurrence keywords
  else if (/\bevery\s*day\b|daily/i.test(lower)) { 
    recurrence = "daily"; recurrenceInterval = 1; recurrenceUnit = "days"; confidence += 10; 
  }
  else if (/\bevery\s*week\b|weekly/i.test(lower)) { 
    recurrence = "weekly"; recurrenceInterval = 1; recurrenceUnit = "weeks"; confidence += 10; 
  }
  else if (/\bevery\s*month\b|monthly/i.test(lower)) { 
    recurrence = "monthly"; recurrenceInterval = 1; recurrenceUnit = "months"; confidence += 10; 
  }
  else if (/\bevery\s*year\b|yearly|annually/i.test(lower)) { 
    recurrence = "yearly"; recurrenceInterval = 1; recurrenceUnit = "years"; confidence += 10; 
  }
  // 3. Bi-weekly, bi-monthly patterns
  else if (/bi-?weekly|every other week|every 2 weeks/i.test(lower)) {
    recurrence = "custom"; recurrenceInterval = 2; recurrenceUnit = "weeks"; confidence += 12;
  }
  else if (/bi-?monthly|every other month|every 2 months/i.test(lower)) {
    recurrence = "custom"; recurrenceInterval = 2; recurrenceUnit = "months"; confidence += 12;
  }
  // 4. Semantic inference - Infer recurrence from context
  else {
    // Birthday = yearly
    if (/\bbirthday\b/i.test(lower)) {
      recurrence = "yearly"; recurrenceInterval = 1; recurrenceUnit = "years"; confidence += 10;
    }
    // Anniversary = yearly
    else if (/\banniversary\b/i.test(lower)) {
      recurrence = "yearly"; recurrenceInterval = 1; recurrenceUnit = "years"; confidence += 10;
    }
    // Medication/vitamins/pills = daily (unless otherwise specified)
    else if (/\b(medication|medicine|vitamin|vitamins|pill|pills|meds)\b/i.test(lower) && recurrence === "none") {
      recurrence = "daily"; recurrenceInterval = 1; recurrenceUnit = "days"; confidence += 8;
    }
    // Rent/mortgage = monthly
    else if (/\b(rent|mortgage)\b/i.test(lower) && !/paid|pay.*off/i.test(lower)) {
      recurrence = "monthly"; recurrenceInterval = 1; recurrenceUnit = "months"; confidence += 8;
    }
    // Paycheck/salary = bi-weekly or monthly (default to bi-weekly)
    else if (/\b(paycheck|payday|salary)\b/i.test(lower)) {
      recurrence = "custom"; recurrenceInterval = 2; recurrenceUnit = "weeks"; confidence += 6;
    }
    // Subscription renewals = monthly
    else if (/\b(subscription|renewal|renew)\b/i.test(lower)) {
      recurrence = "monthly"; recurrenceInterval = 1; recurrenceUnit = "months"; confidence += 6;
    }
    // Trash/garbage = weekly
    else if (/\b(trash|garbage|recycling|bins)\b/i.test(lower)) {
      recurrence = "weekly"; recurrenceInterval = 1; recurrenceUnit = "weeks"; confidence += 8;
    }
    // Water plants = weekly (common pattern)
    else if (/\bwater\s*(the\s*)?(plants?|flowers?|garden)\b/i.test(lower)) {
      recurrence = "weekly"; recurrenceInterval = 1; recurrenceUnit = "weeks"; confidence += 6;
    }
    // Gym/workout = daily or every other day (default every other day)
    else if (/\b(gym|workout|exercise)\b/i.test(lower) && recurrence === "none") {
      recurrence = "custom"; recurrenceInterval = 2; recurrenceUnit = "days"; confidence += 5;
    }
    // Feed pet = daily
    else if (/\bfeed\s*(my\s*)?(cat|dog|pet|fish|bird)\b/i.test(lower)) {
      recurrence = "daily"; recurrenceInterval = 1; recurrenceUnit = "days"; confidence += 8;
    }
    // Walk dog = daily
    else if (/\bwalk\s*(my\s*)?(dog|puppy)\b/i.test(lower)) {
      recurrence = "daily"; recurrenceInterval = 1; recurrenceUnit = "days"; confidence += 8;
    }
    // Oil change = every 3 months
    else if (/\boil\s*change\b/i.test(lower)) {
      recurrence = "custom"; recurrenceInterval = 3; recurrenceUnit = "months"; confidence += 6;
    }
    // Haircut = monthly
    else if (/\bhaircut\b/i.test(lower)) {
      recurrence = "monthly"; recurrenceInterval = 1; recurrenceUnit = "months"; confidence += 5;
    }
    // Dentist = every 6 months
    else if (/\bdentist\b/i.test(lower) && !/appointment|tomorrow|today/i.test(lower)) {
      recurrence = "custom"; recurrenceInterval = 6; recurrenceUnit = "months"; confidence += 5;
    }
  }
  
  // Detect category
  const category = detectCategory(input);
  if (category !== "other") confidence += 15;
  
  // Detect priority
  const priority = detectPriority(input, dueDate);
  if (priority !== "medium") confidence += 10;
  
  // Extract clean title - remove all parsed elements
  // Order matters: remove longer/more specific patterns first
  let title = input
    // Remove common reminder prefixes FIRST
    .replace(/^remind\s+me\s+(to\s+)?/gi, "")
    .replace(/^don't\s+forget\s+(to\s+)?/gi, "")
    .replace(/^i\s+need\s+to\s+/gi, "")
    .replace(/^need\s+to\s+/gi, "")
    // Remove recurrence patterns (most specific first)
    .replace(/\bevery\s+\d+\s+days?\b/gi, "")
    .replace(/\bevery\s+\d+\s+weeks?\b/gi, "")
    .replace(/\bevery\s+\d+\s+months?\b/gi, "")
    .replace(/\bevery\s+\d+\s+years?\b/gi, "")
    .replace(/\bevery\s+other\s+(day|week|month|year)\b/gi, "")
    .replace(/\bevery\s*day\b/gi, "")
    .replace(/\bevery\s*week\b/gi, "")
    .replace(/\bevery\s*month\b/gi, "")
    .replace(/\bevery\s*year\b/gi, "")
    .replace(/\bdaily\b/gi, "")
    .replace(/\bweekly\b/gi, "")
    .replace(/\bmonthly\b/gi, "")
    .replace(/\byearly\b/gi, "")
    .replace(/\bannually\b/gi, "")
    .replace(/\bbi-?weekly\b/gi, "")
    .replace(/\bbi-?monthly\b/gi, "")
    // Remove time patterns
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
    .replace(/\b\d{1,2}\s*(am|pm)\b/gi, "")
    // Remove date patterns
    .replace(/\btoday\b/gi, "")
    .replace(/\btomorrow\b/gi, "")
    .replace(/\btonight\b/gi, "")
    .replace(/\bnext\s+week\b/gi, "")
    .replace(/\bthis\s+weekend\b/gi, "")
    .replace(/\bin\s+\d+\s+(days?|hours?|weeks?|months?)\b/gi, "")
    .replace(/\bon\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    // Remove priority keywords
    .replace(/\burgent\b/gi, "")
    .replace(/\basap\b/gi, "")
    .replace(/\bimmediately\b/gi, "")
    .replace(/\bimportant\b/gi, "")
    .replace(/\bhigh\s+priority\b/gi, "")
    .replace(/\blow\s+priority\b/gi, "")
    .replace(/\bno\s+rush\b/gi, "")
    // Clean up whitespace and connectors
    .replace(/\s+to\s+$/gi, "")  // trailing "to"
    .replace(/^\s*to\s+/gi, "")  // leading "to"
    .replace(/\s+/g, " ")
    .trim();
  
  // Capitalize first letter if we have a title
  if (title && title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
    confidence += 25;
  }
  
  return {
    title: title || input,
    dueDate,
    dueTime,
    priority,
    category,
    recurrence,
    recurrenceInterval,
    recurrenceUnit,
    confidence: Math.min(confidence, 100)
  };
};

const calcLevel = (pts: number) => {
  let lvl = 1, needed = 100, total = 0;
  while (pts >= total + needed) { total += needed; lvl++; needed = lvl * 100; }
  return { level: lvl, xpToNext: needed - (pts - total), progress: ((pts - total) / needed) * 100 };
};

const DEFAULT_ACHIEVEMENTS = [
  { id: "first", name: "First Step", icon: "🎯", unlocked: false },
  { id: "streak3", name: "On Fire", icon: "🔥", unlocked: false },
  { id: "streak7", name: "Week Warrior", icon: "⚡", unlocked: false },
  { id: "complete10", name: "Getting Started", icon: "⭐", unlocked: false },
  { id: "complete50", name: "Productive", icon: "🏆", unlocked: false },
];

// Helper to persist state via OpenAI Apps SDK
const persistState = (reminders: Reminder[], stats: UserStats) => {
  const state = { reminders, stats, savedAt: Date.now() };
  
  // 1. Use OpenAI widget state (persists within conversation)
  if ((window as any).openai?.setWidgetState) {
    try {
      (window as any).openai.setWidgetState(state);
      console.log("[Persist] Saved to widget state");
    } catch (e) {
      console.error("[Persist] Widget state error:", e);
    }
  }
  
  // 2. Also save to localStorage as fallback
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error("[Persist] localStorage error:", e);
  }
  
  // 3. Call save tool if available (for cross-session persistence)
  if ((window as any).openai?.callTool) {
    try {
      (window as any).openai.callTool("save_reminders", state).catch((e: any) => {
        console.log("[Persist] callTool not available or failed:", e);
      });
    } catch (e) {
      // Tool may not exist, that's ok
    }
  }
};

// Helper to load initial state
const loadInitialState = (initialData: any): { reminders: Reminder[], stats: UserStats } => {
  const defaultStats: UserStats = {
    totalPoints: 0, currentStreak: 0, longestStreak: 0,
    completedAllTime: 0, level: 1, achievements: [...DEFAULT_ACHIEVEMENTS]
  };
  
  // Priority 1: initialData from server (hydration)
  if (initialData?.reminders && Array.isArray(initialData.reminders)) {
    console.log("[Load] Using initialData from server:", initialData.reminders.length, "reminders");
    return {
      reminders: initialData.reminders,
      stats: initialData.stats || defaultStats
    };
  }
  
  // Priority 2: Check window.openai widget state
  try {
    const widgetState = (window as any).openai?.widgetState;
    if (widgetState?.reminders && Array.isArray(widgetState.reminders)) {
      console.log("[Load] Using widget state:", widgetState.reminders.length, "reminders");
      return {
        reminders: widgetState.reminders,
        stats: widgetState.stats || defaultStats
      };
    }
  } catch (e) {}
  
  // Priority 3: localStorage fallback
  try {
    const savedReminders = localStorage.getItem(STORAGE_KEY);
    const savedStats = localStorage.getItem(STATS_KEY);
    if (savedReminders) {
      const reminders = JSON.parse(savedReminders);
      console.log("[Load] Using localStorage:", reminders.length, "reminders");
      return {
        reminders,
        stats: savedStats ? JSON.parse(savedStats) : defaultStats
      };
    }
  } catch (e) {}
  
  console.log("[Load] No saved data found, starting fresh");
  return { reminders: [], stats: defaultStats };
};

export default function ReminderApp({ initialData }: { initialData?: any }) {
  // Load initial state from best available source
  const initial = useMemo(() => loadInitialState(initialData), []);
  
  const [reminders, setReminders] = useState<Reminder[]>(initial.reminders);
  const [stats, setStats] = useState<UserStats>(initial.stats);
  
  // AI-first: single input field
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState<ParsedReminder | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Edit mode (only after creation)
  const [editing, setEditing] = useState<Reminder | null>(null);
  
  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<Category | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "completed" | "overdue">("all");
  const [sortField, setSortField] = useState<"dueDate" | "priority" | "category">("dueDate");
  const [sortAsc, setSortAsc] = useState(true);
  
  const [toast, setToast] = useState<string | null>(null);
  const [achievement, setAchievement] = useState<{ name: string; icon: string } | null>(null);
  
  // Persist whenever reminders or stats change
  useEffect(() => {
    persistState(reminders, stats);
  }, [reminders, stats]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }}, [toast]);
  useEffect(() => { if (achievement) { const t = setTimeout(() => setAchievement(null), 4000); return () => clearTimeout(t); }}, [achievement]);
  
  // Real-time parsing as user types
  useEffect(() => {
    if (input.length > 2) {
      setParsed(parseNaturalLanguage(input));
    } else {
      setParsed(null);
    }
  }, [input]);
  
  // Notify height changes
  useEffect(() => {
    const notify = () => { if ((window as any).openai?.notifyIntrinsicHeight) (window as any).openai.notifyIntrinsicHeight(); };
    notify(); window.addEventListener("resize", notify);
    return () => window.removeEventListener("resize", notify);
  }, [reminders, parsed, editing]);
  
  // Filter and sort reminders
  const filtered = useMemo(() => {
    let f = [...reminders];
    if (search) { const q = search.toLowerCase(); f = f.filter(r => r.title.toLowerCase().includes(q) || r.category.includes(q)); }
    if (filterCategory !== "all") f = f.filter(r => r.category === filterCategory);
    if (filterStatus === "pending") f = f.filter(r => !r.completed && !isOverdue(r));
    else if (filterStatus === "completed") f = f.filter(r => r.completed);
    else if (filterStatus === "overdue") f = f.filter(r => isOverdue(r));
    f.sort((a, b) => {
      if (sortField === "dueDate") return (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()) * (sortAsc ? 1 : -1);
      if (sortField === "category") return a.category.localeCompare(b.category) * (sortAsc ? 1 : -1);
      const order = { urgent: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] - order[b.priority]) * (sortAsc ? 1 : -1);
    });
    return f;
  }, [reminders, search, filterCategory, filterStatus, sortField, sortAsc]);
  
  // Group reminders by category
  const groupedByCategory = useMemo(() => {
    const groups: Record<Category, Reminder[]> = { work: [], family: [], health: [], errands: [], finance: [], social: [], learning: [], travel: [], home: [], other: [] };
    filtered.forEach(r => groups[r.category].push(r));
    return groups;
  }, [filtered]);
  
  const overdueCount = reminders.filter(isOverdue).length;
  const todayCount = reminders.filter(r => !r.completed && r.dueDate === new Date().toISOString().split("T")[0]).length;
  const levelInfo = calcLevel(stats.totalPoints);
  
  // Helper to format recurrence for display
  const formatRecurrence = (r: Reminder | ParsedReminder): string => {
    if (r.recurrence === "none") return "";
    if (r.recurrence === "daily") return "Daily";
    if (r.recurrence === "weekly") return "Weekly";
    if (r.recurrence === "monthly") return "Monthly";
    if (r.recurrence === "yearly") return "Yearly";
    if (r.recurrence === "custom" && r.recurrenceInterval && r.recurrenceUnit) {
      return `Every ${r.recurrenceInterval} ${r.recurrenceUnit}`;
    }
    return "";
  };
  
  // Create from parsed input - ONE CLICK!
  const createFromParsed = () => {
    if (!parsed || !parsed.title.trim()) { setToast("Type something to create a reminder"); return; }
    const newReminder: Reminder = {
      id: generateId(),
      title: parsed.title,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      category: parsed.category,
      recurrence: parsed.recurrence,
      recurrenceInterval: parsed.recurrenceInterval,
      recurrenceUnit: parsed.recurrenceUnit,
      completed: false,
      createdAt: new Date().toISOString(),
      pointsAwarded: 0
    };
    setReminders(prev => [...prev, newReminder]);
    setInput("");
    setParsed(null);
    
    // Enhanced toast message
    const recurrenceText = formatRecurrence(parsed);
    const msg = recurrenceText 
      ? `Created ${recurrenceText.toLowerCase()} reminder!`
      : `Created! Auto-categorized as ${CATEGORY_CONFIG[parsed.category].label}`;
    setToast(msg);
  };
  
  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && parsed) {
      e.preventDefault();
      createFromParsed();
    }
  };
  
  // Update reminder (edit mode)
  const updateReminder = (updated: Reminder) => {
    setReminders(prev => prev.map(r => r.id === updated.id ? updated : r));
    setEditing(null);
    setToast("Updated!");
  };
  
  const complete = (r: Reminder) => {
    const early = new Date(`${r.dueDate}T${r.dueTime || "23:59"}`) > new Date();
    let pts = 10 + (early ? 5 : 0) + (r.priority === "urgent" ? 15 : 0) + stats.currentStreak * 2;
    
    const updated = { ...r, completed: true, completedAt: new Date().toISOString(), pointsAwarded: pts };
    
    if (r.recurrence !== "none") {
      const next = new Date(r.dueDate);
      const interval = r.recurrenceInterval || 1;
      
      if (r.recurrence === "daily") next.setDate(next.getDate() + 1);
      else if (r.recurrence === "weekly") next.setDate(next.getDate() + 7);
      else if (r.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
      else if (r.recurrence === "yearly") next.setFullYear(next.getFullYear() + 1);
      else if (r.recurrence === "custom" && r.recurrenceUnit) {
        if (r.recurrenceUnit === "days") next.setDate(next.getDate() + interval);
        else if (r.recurrenceUnit === "weeks") next.setDate(next.getDate() + interval * 7);
        else if (r.recurrenceUnit === "months") next.setMonth(next.getMonth() + interval);
        else if (r.recurrenceUnit === "years") next.setFullYear(next.getFullYear() + interval);
      }
      
      // Check if next date is past end date
      const nextDateStr = next.toISOString().split("T")[0];
      const shouldCreateNext = !r.endDate || nextDateStr <= r.endDate;
      
      if (shouldCreateNext) {
        const newR: Reminder = { ...r, id: generateId(), dueDate: nextDateStr, completed: false, completedAt: undefined, createdAt: new Date().toISOString(), pointsAwarded: 0 };
        setReminders(prev => [...prev.map(x => x.id === r.id ? updated : x), newR]);
      } else {
        setReminders(prev => prev.map(x => x.id === r.id ? updated : x));
        setToast("Recurring series complete!");
      }
    } else {
      setReminders(prev => prev.map(x => x.id === r.id ? updated : x));
    }
    
    const newStats = { ...stats, totalPoints: stats.totalPoints + pts, completedAllTime: stats.completedAllTime + 1, currentStreak: stats.currentStreak + 1 };
    if (newStats.currentStreak > newStats.longestStreak) newStats.longestStreak = newStats.currentStreak;
    newStats.level = calcLevel(newStats.totalPoints).level;
    
    if (!newStats.achievements[0].unlocked && newStats.completedAllTime >= 1) { newStats.achievements[0].unlocked = true; setAchievement(newStats.achievements[0]); pts += 50; }
    if (!newStats.achievements[1].unlocked && newStats.currentStreak >= 3) { newStats.achievements[1].unlocked = true; setAchievement(newStats.achievements[1]); pts += 50; }
    if (!newStats.achievements[2].unlocked && newStats.currentStreak >= 7) { newStats.achievements[2].unlocked = true; setAchievement(newStats.achievements[2]); pts += 50; }
    if (!newStats.achievements[3].unlocked && newStats.completedAllTime >= 10) { newStats.achievements[3].unlocked = true; setAchievement(newStats.achievements[3]); pts += 50; }
    if (!newStats.achievements[4].unlocked && newStats.completedAllTime >= 50) { newStats.achievements[4].unlocked = true; setAchievement(newStats.achievements[4]); pts += 50; }
    
    setStats(newStats); setToast(`+${pts} points!`);
  };
  
  const uncomplete = (r: Reminder) => {
    setReminders(prev => prev.map(x => x.id === r.id ? { ...r, completed: false, completedAt: undefined } : x));
    setStats(s => ({ ...s, totalPoints: Math.max(0, s.totalPoints - r.pointsAwarded), completedAllTime: Math.max(0, s.completedAllTime - 1) }));
  };
  
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  
  const snooze = (r: Reminder, mins: number) => {
    setSnoozingId(r.id);
    const d = new Date(); d.setMinutes(d.getMinutes() + mins);
    setReminders(prev => prev.map(x => x.id === r.id ? { ...r, dueDate: d.toISOString().split("T")[0], dueTime: `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}` } : x));
    setToast(`💤 Snoozed for ${mins} minutes`);
    setTimeout(() => setSnoozingId(null), 500);
  };
  
  const del = (id: string) => { setReminders(prev => prev.filter(r => r.id !== id)); setToast("Deleted"); };
  
  const CategoryIcon = ({ cat }: { cat: Category }) => {
    const config = CATEGORY_CONFIG[cat];
    const Icon = config.icon;
    return <Icon size={16} color={config.color} />;
  };

  // Global input styles for box-sizing
  const inputStyle = { boxSizing: "border-box" as const };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.bg, minHeight: "100%", padding: 16 }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, padding: "12px 20px", borderRadius: 10, backgroundColor: COLORS.primary, color: "#fff", fontWeight: 600, fontSize: 14, zIndex: 1000, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>{toast}</div>}
      
      {achievement && (
        <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", padding: 28, borderRadius: 20, backgroundColor: COLORS.card, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", zIndex: 1001, textAlign: "center" }}>
          <div style={{ fontSize: 56 }}>{achievement.icon}</div>
          <h3 style={{ color: COLORS.primary, margin: "12px 0 4px", fontSize: 18, fontWeight: 700 }}>Achievement Unlocked!</h3>
          <p style={{ color: COLORS.textMain, fontWeight: 600, margin: 0, fontSize: 16 }}>{achievement.name}</p>
        </div>
      )}
      
      {/* Header Bar */}
      <div style={{ backgroundColor: COLORS.primary, borderRadius: 14, padding: "14px 18px", marginBottom: 14, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={22} />
            <span style={{ fontSize: 18, fontWeight: 700 }}>Smart Reminders</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 14, fontWeight: 500 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Crown size={16} color={COLORS.gold} /> Lv {levelInfo.level}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Star size={16} color={COLORS.gold} /> {stats.totalPoints}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Flame size={16} color={stats.currentStreak > 0 ? COLORS.gold : "rgba(255,255,255,0.5)"} /> {stats.currentStreak}</span>
          </div>
        </div>
      </div>
      
      {/* AI Input - Main Focus */}
      <div style={{ backgroundColor: COLORS.card, borderRadius: 14, padding: 16, marginBottom: 14, border: `1px solid ${COLORS.border}` }}>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Try: 'Call mom tomorrow 3pm' or 'Pay rent Friday urgent'"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ ...inputStyle, width: "100%", padding: "14px 50px 14px 16px", borderRadius: 10, border: `2px solid ${parsed ? COLORS.primaryLight : COLORS.border}`, backgroundColor: COLORS.inputBg, fontSize: 16, outline: "none", transition: "border-color 0.2s" }}
          />
          {parsed && (
            <button onClick={createFromParsed} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 36, height: 36, borderRadius: 8, border: "none", backgroundColor: COLORS.primary, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Send size={18} />
            </button>
          )}
        </div>
        
        {/* Preview Card */}
        {parsed && (
          <div style={{ marginTop: 14, padding: 14, backgroundColor: COLORS.accentLight, borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.textMain }}>{parsed.title}</span>
              <span style={{ fontSize: 12, color: COLORS.textMuted, backgroundColor: COLORS.card, padding: "3px 8px", borderRadius: 6 }}>{parsed.confidence}%</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, backgroundColor: COLORS.card, fontSize: 13, color: COLORS.textSecondary }}>
                <Calendar size={14} /> {formatDate(parsed.dueDate)}{parsed.dueTime && ` ${formatTime(parsed.dueTime)}`}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, fontSize: 13, backgroundColor: `${CATEGORY_CONFIG[parsed.category].color}18`, color: CATEGORY_CONFIG[parsed.category].color }}>
                <CategoryIcon cat={parsed.category} /> {CATEGORY_CONFIG[parsed.category].label}
              </span>
              <span style={{ padding: "5px 10px", borderRadius: 8, fontSize: 13, fontWeight: 500, backgroundColor: `${PRIORITY_COLORS[parsed.priority]}18`, color: PRIORITY_COLORS[parsed.priority], textTransform: "capitalize" }}>
                {parsed.priority}
              </span>
              {parsed.recurrence !== "none" && <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8, fontSize: 13, backgroundColor: `${COLORS.primary}15`, color: COLORS.primary, fontWeight: 500 }}><Repeat size={13} /> {formatRecurrence(parsed)}</span>}
            </div>
          </div>
        )}
      </div>
      
      {/* Stats & Filters Row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {overdueCount > 0 && <span style={{ padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: `${COLORS.danger}15`, color: COLORS.danger }}>{overdueCount} overdue</span>}
          {todayCount > 0 && <span style={{ padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: `${COLORS.warning}15`, color: COLORS.warning }}>{todayCount} today</span>}
          <span style={{ padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, backgroundColor: COLORS.accentLight, color: COLORS.primary }}>{reminders.filter(r => !r.completed).length} pending</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <Search size={16} color={COLORS.textMuted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input type="text" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: 120, padding: "8px 10px 8px 32px", borderRadius: 8, border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.card, fontSize: 14, outline: "none" }} />
          </div>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as any)} style={{ ...inputStyle, padding: "8px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card, cursor: "pointer" }}><option value="all">All</option>{Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} style={{ ...inputStyle, padding: "8px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card, cursor: "pointer" }}><option value="all">All</option><option value="pending">Pending</option><option value="completed">Done</option><option value="overdue">Overdue</option></select>
        </div>
      </div>
      
      {/* Reminder List */}
      <div style={{ backgroundColor: COLORS.card, borderRadius: 14, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>
            <Bell size={44} color={COLORS.border} style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 16, margin: 0, fontWeight: 500 }}>No reminders yet</p>
            <p style={{ fontSize: 14, marginTop: 6, color: COLORS.textMuted }}>Type above to create your first one!</p>
          </div>
        ) : filtered.map((r, i) => (
          <div key={r.id} style={{ padding: "14px 16px", borderBottom: i < filtered.length - 1 ? `1px solid ${COLORS.border}` : "none", backgroundColor: r.completed ? COLORS.cardAlt : COLORS.card, opacity: r.completed ? 0.7 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => r.completed ? uncomplete(r) : complete(r)} style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${r.completed ? COLORS.success : COLORS.border}`, backgroundColor: r.completed ? COLORS.success : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.completed && <Check size={14} color="#fff" />}</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 500, color: COLORS.textMain, textDecoration: r.completed ? "line-through" : "none" }}>{r.title}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: 12, backgroundColor: `${CATEGORY_CONFIG[r.category].color}12`, color: CATEGORY_CONFIG[r.category].color }}><CategoryIcon cat={r.category} /> {CATEGORY_CONFIG[r.category].label}</span>
                  {isOverdue(r) && <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, backgroundColor: `${COLORS.danger}12`, color: COLORS.danger }}>Overdue</span>}
                  {r.recurrence !== "none" && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 6, fontSize: 12, backgroundColor: `${COLORS.primary}10`, color: COLORS.primary }}><Repeat size={12} /> {formatRecurrence(r)}</span>}
                </div>
                <div style={{ fontSize: 13, color: isOverdue(r) ? COLORS.danger : COLORS.textMuted, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock size={13} /> {formatDate(r.dueDate)}{r.dueTime && ` at ${formatTime(r.dueTime)}`}
                  <span style={{ marginLeft: 6, padding: "2px 8px", borderRadius: 6, fontSize: 12, backgroundColor: `${PRIORITY_COLORS[r.priority]}12`, color: PRIORITY_COLORS[r.priority], textTransform: "capitalize" }}>{r.priority}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!r.completed && (
                  <button 
                    onClick={() => snooze(r, 15)} 
                    title="Snooze 15 minutes" 
                    style={{ 
                      width: 32, height: 32, borderRadius: 8, border: "none", 
                      backgroundColor: snoozingId === r.id ? COLORS.primaryLight : COLORS.inputBg, 
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.2s ease",
                      transform: snoozingId === r.id ? "scale(0.9)" : "scale(1)"
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: snoozingId === r.id ? "#fff" : COLORS.textMuted }}>💤</span>
                  </button>
                )}
                {!r.completed && <button onClick={() => setEditing(r)} title="Edit" style={{ width: 32, height: 32, borderRadius: 8, border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Edit2 size={16} color={COLORS.textMuted} /></button>}
                <button onClick={() => del(r.id)} title="Delete" style={{ width: 32, height: 32, borderRadius: 8, border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} color={COLORS.danger} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Edit Modal */}
      {editing && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16, overflowY: "auto" }}>
          <div style={{ backgroundColor: COLORS.card, borderRadius: 16, width: "100%", maxWidth: 420, padding: 20, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: COLORS.textMain }}>Edit Reminder</h2>
              <button onClick={() => setEditing(null)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={18} /></button>
            </div>
            
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Title</label>
              <input type="text" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15 }} />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Category</label>
                <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value as Category })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15 }}>{Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Priority</label>
                <select value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value as Priority })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15 }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select>
              </div>
            </div>
            
            {/* Recurrence Section */}
            <div style={{ marginBottom: 14, padding: 14, backgroundColor: COLORS.accentLight, borderRadius: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.primary, display: "block", marginBottom: 10 }}>
                <Repeat size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Repeat Settings
              </label>
              
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Frequency</label>
                <select 
                  value={editing.recurrence === "custom" ? "custom" : editing.recurrence} 
                  onChange={e => {
                    const val = e.target.value as RecurrenceType;
                    if (val === "custom") {
                      setEditing({ ...editing, recurrence: "custom", recurrenceInterval: editing.recurrenceInterval || 2, recurrenceUnit: editing.recurrenceUnit || "days" });
                    } else {
                      setEditing({ ...editing, recurrence: val, recurrenceInterval: undefined, recurrenceUnit: undefined });
                    }
                  }} 
                  style={{ ...inputStyle, width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card }}
                >
                  <option value="none">One-time (no repeat)</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom interval...</option>
                </select>
              </div>
              
              {/* Custom interval options */}
              {editing.recurrence === "custom" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Every</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="365"
                      value={editing.recurrenceInterval || 2} 
                      onChange={e => setEditing({ ...editing, recurrenceInterval: parseInt(e.target.value) || 1 })} 
                      style={{ ...inputStyle, width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Unit</label>
                    <select 
                      value={editing.recurrenceUnit || "days"} 
                      onChange={e => setEditing({ ...editing, recurrenceUnit: e.target.value as any })} 
                      style={{ ...inputStyle, width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card }}
                    >
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                      <option value="months">Months</option>
                      <option value="years">Years</option>
                    </select>
                  </div>
                </div>
              )}
              
              {/* Start and End Date for recurring */}
              {editing.recurrence !== "none" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Start Date</label>
                    <input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} style={{ ...inputStyle, width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>End Date (optional)</label>
                    <input type="date" value={editing.endDate || ""} onChange={e => setEditing({ ...editing, endDate: e.target.value || undefined })} style={{ ...inputStyle, width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, backgroundColor: COLORS.card }} />
                  </div>
                </div>
              )}
            </div>
            
            {/* Date/Time for one-time reminders */}
            {editing.recurrence === "none" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Date</label>
                  <input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15 }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Time</label>
                  <input type="time" value={editing.dueTime || ""} onChange={e => setEditing({ ...editing, dueTime: e.target.value || undefined })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15 }} />
                </div>
              </div>
            )}
            
            {/* Time for recurring reminders */}
            {editing.recurrence !== "none" && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.textSecondary, display: "block", marginBottom: 6 }}>Reminder Time</label>
                <input type="time" value={editing.dueTime || ""} onChange={e => setEditing({ ...editing, dueTime: e.target.value || undefined })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15 }} />
              </div>
            )}
            
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setEditing(null)} style={{ flex: 1, padding: 14, borderRadius: 10, border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.card, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => updateReminder(editing)} style={{ flex: 1, padding: 14, borderRadius: 10, border: "none", backgroundColor: COLORS.primary, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
