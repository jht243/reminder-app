import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Bell, Plus, Check, X, Clock, Calendar, Search, Filter, Trash2,
  Edit2, Repeat, Trophy, Flame, Star, Award, Crown, Send,
  SortAsc, SortDesc, Timer, Briefcase, Users, Heart, ShoppingCart,
  Stethoscope, GraduationCap, Plane, Home, Sparkles, ChevronRight
} from "lucide-react";

type Priority = "low" | "medium" | "high" | "urgent";
type RecurrenceType = "none" | "daily" | "weekly" | "monthly";
type Category = "work" | "family" | "health" | "errands" | "finance" | "social" | "learning" | "travel" | "home" | "other";

interface Reminder {
  id: string;
  title: string;
  description?: string;
  dueDate: string;
  dueTime?: string;
  priority: Priority;
  category: Category;
  recurrence: RecurrenceType;
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
  confidence: number;
}

const COLORS = {
  primary: "#2F5C3B", // Forest Green
  primaryLight: "#E8F5E9", // Very light green
  secondary: "#8BA890", // Sage
  success: "#4CAF50",
  warning: "#FF9800",
  danger: "#E53935",
  bg: "#F4F7F4", // Soft grey-green background
  card: "#FFFFFF",
  textMain: "#1C241D",
  textSecondary: "#5C6B5F",
  textMuted: "#8C9E90",
  border: "#E0E8E0",
  inputBg: "#FFFFFF",
  gold: "#FFC107",
  purple: "#9C27B0"
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#4CAF50", medium: "#FF9800", high: "#FF5722", urgent: "#D32F2F"
};

const CATEGORY_CONFIG: Record<Category, { icon: any; color: string; label: string }> = {
  work: { icon: Briefcase, color: "#5D4037", label: "Work" }, // Earthy brown
  family: { icon: Users, color: "#D81B60", label: "Family" }, // Pink
  health: { icon: Stethoscope, color: "#00897B", label: "Health" }, // Teal
  errands: { icon: ShoppingCart, color: "#F57C00", label: "Errands" }, // Orange
  finance: { icon: Briefcase, color: "#5E35B1", label: "Finance" }, // Purple
  social: { icon: Heart, color: "#E53935", label: "Social" }, // Red
  learning: { icon: GraduationCap, color: "#039BE5", label: "Learning" }, // Light Blue
  travel: { icon: Plane, color: "#3949AB", label: "Travel" }, // Indigo
  home: { icon: Home, color: "#7CB342", label: "Home" }, // Light Green
  other: { icon: Star, color: "#757575", label: "Other" } // Grey
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
  
  // Parse recurrence
  let recurrence: RecurrenceType = "none";
  if (/every day|daily/i.test(lower)) { recurrence = "daily"; confidence += 10; }
  else if (/every week|weekly/i.test(lower)) { recurrence = "weekly"; confidence += 10; }
  else if (/every month|monthly/i.test(lower)) { recurrence = "monthly"; confidence += 10; }
  
  // Detect category
  const category = detectCategory(input);
  if (category !== "other") confidence += 15;
  
  // Detect priority
  const priority = detectPriority(input, dueDate);
  if (priority !== "medium") confidence += 10;
  
  // Extract clean title
  let title = input
    .replace(/at \d{1,2}:?\d{0,2}\s*(am|pm)?/gi, "")
    .replace(/\d{1,2}(am|pm)/gi, "")
    .replace(/today|tomorrow|tonight|next week|this weekend/gi, "")
    .replace(/in \d+ (days?|hours?|weeks?)/gi, "")
    .replace(/on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/gi, "")
    .replace(/urgent|asap|immediately|important|high priority|low priority|no rush/gi, "")
    .replace(/every (day|week|month)|daily|weekly|monthly/gi, "")
    .replace(/remind me( to)?/gi, "")
    .replace(/don't forget( to)?/gi, "")
    .replace(/need to/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  
  if (title) {
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

export default function ReminderApp({ initialData }: { initialData?: any }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [stats, setStats] = useState<UserStats>({
    totalPoints: 0, currentStreak: 0, longestStreak: 0,
    completedAllTime: 0, level: 1, achievements: [...DEFAULT_ACHIEVEMENTS]
  });
  
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
  const [showFilters, setShowFilters] = useState(false);
  
  const [toast, setToast] = useState<string | null>(null);
  const [achievement, setAchievement] = useState<{ name: string; icon: string } | null>(null);
  
  // Load from storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setReminders(JSON.parse(saved));
      const savedStats = localStorage.getItem(STATS_KEY);
      if (savedStats) setStats(JSON.parse(savedStats));
    } catch {}
  }, []);
  
  // Persist
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders)); }, [reminders]);
  useEffect(() => { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }, [stats]);
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
      completed: false,
      createdAt: new Date().toISOString(),
      pointsAwarded: 0
    };
    setReminders(prev => [...prev, newReminder]);
    setInput("");
    setParsed(null);
    setToast(`Created! Auto-categorized as ${CATEGORY_CONFIG[parsed.category].label}`);
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
      if (r.recurrence === "daily") next.setDate(next.getDate() + 1);
      else if (r.recurrence === "weekly") next.setDate(next.getDate() + 7);
      else if (r.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
      const newR: Reminder = { ...r, id: generateId(), dueDate: next.toISOString().split("T")[0], completed: false, completedAt: undefined, createdAt: new Date().toISOString(), pointsAwarded: 0 };
      setReminders(prev => [...prev.map(x => x.id === r.id ? updated : x), newR]);
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
  
  const snooze = (r: Reminder, mins: number) => {
    const d = new Date(); d.setMinutes(d.getMinutes() + mins);
    setReminders(prev => prev.map(x => x.id === r.id ? { ...r, dueDate: d.toISOString().split("T")[0], dueTime: `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}` } : x));
    setToast(`Snoozed ${mins}m`);
  };
  
  const del = (id: string) => { setReminders(prev => prev.filter(r => r.id !== id)); setToast("Deleted"); };
  
  const CategoryIcon = ({ cat }: { cat: Category }) => {
    const config = CATEGORY_CONFIG[cat];
    const Icon = config.icon;
    return <Icon size={16} color={config.color} />;
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.bg, minHeight: "100%", padding: 16 }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, padding: "12px 20px", borderRadius: 8, backgroundColor: COLORS.primary, color: "#fff", fontWeight: 500, zIndex: 1000, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>{toast}</div>}
      
      {achievement && (
        <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", padding: 32, borderRadius: 16, backgroundColor: COLORS.card, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", zIndex: 1001, textAlign: "center" }}>
          <div style={{ fontSize: 64 }}>{achievement.icon}</div>
          <h3 style={{ color: COLORS.gold, margin: "8px 0" }}>Achievement Unlocked!</h3>
          <p style={{ color: COLORS.textMain, fontWeight: 600 }}>{achievement.name}</p>
          <p style={{ color: COLORS.success }}>+50 bonus points!</p>
        </div>
      )}
      
      {/* Header & Stats - Condensed */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: COLORS.textMain, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={20} color={COLORS.primary} />
            Smart Reminders
          </h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: COLORS.textSecondary }}>Level {levelInfo.level} • {stats.totalPoints} pts</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ backgroundColor: COLORS.card, padding: "6px 12px", borderRadius: 20, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
            <Flame size={14} color={stats.currentStreak > 0 ? COLORS.warning : COLORS.textMuted} />
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.textMain }}>{stats.currentStreak}</span>
          </div>
          <div style={{ backgroundColor: COLORS.card, padding: "6px 12px", borderRadius: 20, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
            <Trophy size={14} color={COLORS.success} />
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.textMain }}>{stats.completedAllTime}</span>
          </div>
        </div>
      </div>
      
      {/* AI-First Input - Compact Card */}
      <div style={{ backgroundColor: COLORS.card, borderRadius: 20, padding: 16, marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="✨ Type a new reminder..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ width: "100%", padding: "14px 48px 14px 16px", borderRadius: 16, border: "none", backgroundColor: COLORS.bg, fontSize: 15, outline: "none", color: COLORS.textMain, fontWeight: 500 }}
          />
          {parsed ? (
            <button
              onClick={createFromParsed}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: 12, border: "none", backgroundColor: COLORS.primary, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(47, 92, 59, 0.3)" }}
            >
              <Send size={16} />
            </button>
          ) : (
            <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }}>
              <ChevronRight size={20} color={COLORS.textMuted} />
            </div>
          )}
        </div>
        
        {/* Smart Preview */}
        {parsed && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.primary, textTransform: "uppercase", letterSpacing: 0.5 }}>Preview</span>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>{parsed.confidence}% match</span>
            </div>
            
            <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textMain, marginBottom: 8 }}>{parsed.title}</div>
            
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 8, backgroundColor: COLORS.bg, fontSize: 12, color: COLORS.textSecondary }}>
                <Calendar size={12} />
                {formatDate(parsed.dueDate)}{parsed.dueTime && ` • ${formatTime(parsed.dueTime)}`}
              </span>
              
              <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 8, backgroundColor: `${CATEGORY_CONFIG[parsed.category].color}15`, fontSize: 12, color: CATEGORY_CONFIG[parsed.category].color, fontWeight: 500 }}>
                <CategoryIcon cat={parsed.category} />
                {CATEGORY_CONFIG[parsed.category].label}
              </span>
              
              {parsed.priority !== "medium" && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 8, backgroundColor: `${PRIORITY_COLORS[parsed.priority]}15`, fontSize: 12, color: PRIORITY_COLORS[parsed.priority], fontWeight: 500, textTransform: "capitalize" }}>
                  {parsed.priority}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Quick Stats & Filters Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: COLORS.textMain, margin: 0 }}>My Tasks</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowFilters(!showFilters)} style={{ width: 32, height: 32, borderRadius: 10, border: "none", backgroundColor: showFilters ? COLORS.primary : COLORS.card, color: showFilters ? "#fff" : COLORS.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}><Filter size={16} /></button>
          <button onClick={() => setSortAsc(!sortAsc)} style={{ width: 32, height: 32, borderRadius: 10, border: "none", backgroundColor: COLORS.card, color: COLORS.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>{sortAsc ? <SortAsc size={16} /> : <SortDesc size={16} />}</button>
        </div>
      </div>

      {showFilters && (
        <div style={{ marginBottom: 16, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
          {/* Category Chips */}
          <button onClick={() => setFilterCategory("all")} style={{ padding: "6px 12px", borderRadius: 20, border: "none", backgroundColor: filterCategory === "all" ? COLORS.primary : COLORS.card, color: filterCategory === "all" ? "#fff" : COLORS.textSecondary, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>All</button>
          {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
            <button key={k} onClick={() => setFilterCategory(k as Category)} style={{ padding: "6px 12px", borderRadius: 20, border: "none", backgroundColor: filterCategory === k ? v.color : COLORS.card, color: filterCategory === k ? "#fff" : COLORS.textSecondary, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>{v.label}</button>
          ))}
        </div>
      )}
      
      {/* Reminder List */}
      <div style={{ paddingBottom: 40 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.textMuted }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.card, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
              <Bell size={24} color={COLORS.secondary} />
            </div>
            <p style={{ fontSize: 15, margin: 0, fontWeight: 500, color: COLORS.textSecondary }}>All caught up!</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>Enjoy your day ✨</p>
          </div>
        ) : filtered.map(r => (
          <div key={r.id} style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", opacity: r.completed ? 0.6 : 1, transition: "transform 0.2s", borderLeft: `4px solid ${CATEGORY_CONFIG[r.category].color}` }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <button 
                onClick={() => r.completed ? uncomplete(r) : complete(r)} 
                style={{ 
                  width: 24, height: 24, borderRadius: "50%", 
                  border: `2px solid ${r.completed ? COLORS.success : COLORS.border}`, 
                  backgroundColor: r.completed ? COLORS.success : "transparent", 
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 
                }}
              >
                {r.completed && <Check size={14} color="#fff" />}
              </button>
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textMain, textDecoration: r.completed ? "line-through" : "none" }}>{r.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: COLORS.textMuted }}>{formatDate(r.dueDate)}</span>
                </div>
                
                {r.description && <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: "0 0 8px 0" }}>{r.description}</p>}
                
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: CATEGORY_CONFIG[r.category].color, fontWeight: 500, backgroundColor: `${CATEGORY_CONFIG[r.category].color}10`, padding: "2px 8px", borderRadius: 6 }}>
                    <CategoryIcon cat={r.category} />
                    {CATEGORY_CONFIG[r.category].label}
                  </span>
                  
                  {isOverdue(r) && <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.danger, backgroundColor: "#FFEBEE", padding: "2px 8px", borderRadius: 6 }}>Overdue</span>}
                  
                  {(r.priority === "high" || r.priority === "urgent") && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLORS[r.priority], backgroundColor: `${PRIORITY_COLORS[r.priority]}10`, padding: "2px 8px", borderRadius: 6, textTransform: "capitalize" }}>{r.priority}</span>
                  )}
                  
                  {r.dueTime && (
                    <span style={{ fontSize: 11, color: COLORS.textSecondary, display: "flex", alignItems: "center", gap: 3 }}>
                      <Clock size={11} /> {formatTime(r.dueTime)}
                    </span>
                  )}
                </div>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {!r.completed && <button onClick={() => setEditing(r)} style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}><Edit2 size={16} color={COLORS.textMuted} /></button>}
                <button onClick={() => del(r.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}><Trash2 size={16} color={COLORS.textMuted} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Edit Modal (only for editing existing reminders) */}
      {editing && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
          <div style={{ backgroundColor: COLORS.card, borderRadius: 16, width: "100%", maxWidth: 400, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}><h2 style={{ margin: 0, fontSize: 18, color: COLORS.textMain }}>Edit Reminder</h2><button onClick={() => setEditing(null)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={18} /></button></div>
            
            <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Title</label><input type="text" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14 }} /></div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div><label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Date</label><input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14 }} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Time</label><input type="time" value={editing.dueTime || ""} onChange={e => setEditing({ ...editing, dueTime: e.target.value || undefined })} style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14 }} /></div>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div><label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Category</label><select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value as Category })} style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14 }}>{Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
              <div><label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Priority</label><select value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value as Priority })} style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14 }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            </div>
            
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, display: "block", marginBottom: 4 }}>Repeat</label><select value={editing.recurrence} onChange={e => setEditing({ ...editing, recurrence: e.target.value as RecurrenceType })} style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14 }}><option value="none">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
            
            <div style={{ display: "flex", gap: 12 }}><button onClick={() => setEditing(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.card, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button><button onClick={() => updateReminder(editing)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", backgroundColor: COLORS.primary, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
