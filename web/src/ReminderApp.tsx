import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Bell, Plus, Check, X, Clock, Calendar, Search, Filter, Trash2,
  Edit2, Repeat, Trophy, Flame, Star, Award, Crown, Send,
  SortAsc, SortDesc, Timer, Briefcase, Users, Heart, ShoppingCart,
  Stethoscope, GraduationCap, Plane, Home, Sparkles, ChevronRight, Upload, FileText, Download
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

interface ProgressionTask {
  id: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  completed: boolean;
  check: (reminders: Reminder[], stats: UserStats) => boolean;
}

interface UserStats {
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  completedAllTime: number;
  level: number;
  achievements: { id: string; name: string; icon: string; unlocked: boolean }[];
  completedTasks: string[]; // IDs of completed progression tasks
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

// Modern minimal color palette inspired by reference
const COLORS = {
  // Primary sage green palette
  primary: "#2D5A3D",
  primaryLight: "#4A7C59", 
  primaryBg: "#E8F0E8",
  primarySoft: "#D4E5D4",
  
  // Semantic colors
  success: "#3D7A5A",
  warning: "#D4A574",
  danger: "#C97070",
  
  // Background colors - cream/off-white tones
  bg: "#E8E4DE",           // Warm cream background
  card: "#FFFFFF",
  cardAlt: "#F8F6F3",      // Slightly warm white
  
  // Text colors - softer blacks
  textMain: "#2C3E2C",     // Dark sage for main text
  textSecondary: "#5A6B5A",
  textMuted: "#8A998A",
  
  // UI elements
  border: "#D8DED8",       // Very soft border
  inputBg: "#F5F3F0",
  gold: "#D4A574",         // Warm gold/tan
  accent: "#4A7C59",
  accentLight: "#E8F0E8",
  
  // Icon backgrounds (circular)
  iconBg: "#E8F0E8",
  iconBgAlt: "#D4E5D4"
};

// Softer priority colors
const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#6B9B7A", medium: "#D4A574", high: "#D49A6A", urgent: "#C97070"
};

// Category config with softer colors and round icon style
const CATEGORY_CONFIG: Record<Category, { icon: any; color: string; bg: string; label: string }> = {
  work: { icon: Briefcase, color: "#4A7C59", bg: "#E8F0E8", label: "Work" },
  family: { icon: Users, color: "#B87A9E", bg: "#F5E8F0", label: "Family" },
  health: { icon: Stethoscope, color: "#5A9B7A", bg: "#E8F5F0", label: "Health" },
  errands: { icon: ShoppingCart, color: "#D4A574", bg: "#F5F0E8", label: "Errands" },
  finance: { icon: Briefcase, color: "#7A6B9B", bg: "#F0E8F5", label: "Finance" },
  social: { icon: Heart, color: "#C97070", bg: "#F5E8E8", label: "Social" },
  learning: { icon: GraduationCap, color: "#5A8B9B", bg: "#E8F0F5", label: "Learning" },
  travel: { icon: Plane, color: "#6B7A9B", bg: "#E8ECF5", label: "Travel" },
  home: { icon: Home, color: "#7A9B6B", bg: "#ECF5E8", label: "Home" },
  other: { icon: Star, color: "#8A998A", bg: "#F0F0F0", label: "Other" }
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

// Import parsers
const parseICS = (content: string): Partial<Reminder>[] => {
  const events: Partial<Reminder>[] = [];
  const lines = content.split(/\r\n|\n|\r/);
  let inEvent = false;
  let current: any = {};
  
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true;
      current = {};
    } else if (line.startsWith("END:VEVENT")) {
      inEvent = false;
      if (current.summary) {
        events.push({
          title: current.summary,
          dueDate: current.dtstart ? current.dtstart.split("T")[0] : new Date().toISOString().split("T")[0],
          dueTime: current.dtstart && current.dtstart.includes("T") ? 
            `${current.dtstart.split("T")[1].substring(0,2)}:${current.dtstart.split("T")[1].substring(2,4)}` : undefined,
          priority: "medium",
          category: "other",
          recurrence: "none",
          completed: false,
          pointsAwarded: 0
        });
      }
    } else if (inEvent) {
      if (line.startsWith("SUMMARY:")) current.summary = line.substring(8);
      else if (line.startsWith("DTSTART")) {
        // Handle DTSTART;VALUE=DATE:20230101 or DTSTART:20230101T120000
        const val = line.split(":")[1];
        if (val) {
          // Basic ISO parsing (YYYYMMDD or YYYYMMDDTHHMMSS)
          const y = val.substring(0, 4), m = val.substring(4, 6), d = val.substring(6, 8);
          let dateStr = `${y}-${m}-${d}`;
          if (val.includes("T")) {
            const timePart = val.split("T")[1];
            dateStr += `T${timePart}`;
          }
          current.dtstart = dateStr;
        }
      }
    }
  }
  return events;
};

const parseCSV = (content: string): Partial<Reminder>[] => {
  const lines = content.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return []; // Need header + 1 row
  
  const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
  const titleIdx = headers.findIndex(h => h.includes("title") || h.includes("subject") || h.includes("summary") || h.includes("task"));
  const dateIdx = headers.findIndex(h => h.includes("date") || h.includes("due") || h.includes("start"));
  
  if (titleIdx === -1) return [];
  
  const results: Partial<Reminder>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim()); // Simple split, doesn't handle quoted commas
    if (cols.length <= titleIdx) continue;
    
    let dateStr = new Date().toISOString().split("T")[0];
    if (dateIdx !== -1 && cols[dateIdx]) {
      const parsed = new Date(cols[dateIdx]);
      if (!isNaN(parsed.getTime())) dateStr = parsed.toISOString().split("T")[0];
    }
    
    results.push({
      title: cols[titleIdx],
      dueDate: dateStr,
      priority: "medium",
      category: "other",
      recurrence: "none",
      completed: false,
      pointsAwarded: 0
    });
  }
  return results;
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

// Progression tasks - ordered sequence of onboarding tasks
// First 5 = adding different types of reminders, then mark complete tasks
const PROGRESSION_TASKS: Omit<ProgressionTask, 'completed'>[] = [
  // === ADDING REMINDERS (Tasks 1-5) ===
  {
    id: "first_reminder",
    name: "Getting Started",
    description: "Add your first reminder",
    icon: "🎯",
    points: 15,
    check: (reminders) => reminders.length >= 1
  },
  {
    id: "add_birthday",
    name: "Birthday Tracker",
    description: "Add a birthday reminder (include 'birthday' in title)",
    icon: "🎂",
    points: 15,
    check: (reminders) => reminders.some(r => /birthday/i.test(r.title))
  },
  {
    id: "add_work",
    name: "Stay Professional",
    description: "Add a work reminder (meeting, deadline, project)",
    icon: "💼",
    points: 15,
    check: (reminders) => reminders.some(r => r.category === "work")
  },
  {
    id: "add_family",
    name: "Family Matters",
    description: "Add a family reminder (call mom, visit grandma)",
    icon: "👨‍👩‍👧",
    points: 15,
    check: (reminders) => reminders.some(r => r.category === "family")
  },
  {
    id: "add_recurring",
    name: "Habit Builder",
    description: "Add a recurring reminder (daily, weekly, etc.)",
    icon: "🔄",
    points: 20,
    check: (reminders) => reminders.some(r => r.recurrence !== "none")
  },
  // === MARK COMPLETE TASKS (Tasks 6-8) ===
  {
    id: "first_complete",
    name: "Task Master",
    description: "Mark your first reminder as complete",
    icon: "✅",
    points: 20,
    check: (_, stats) => stats.completedAllTime >= 1
  },
  {
    id: "complete_3",
    name: "On a Roll",
    description: "Mark 3 reminders as complete",
    icon: "🎳",
    points: 25,
    check: (_, stats) => stats.completedAllTime >= 3
  },
  {
    id: "complete_5",
    name: "High Five",
    description: "Mark 5 reminders as complete",
    icon: "🖐️",
    points: 30,
    check: (_, stats) => stats.completedAllTime >= 5
  },
  // === ADVANCED TASKS (Tasks 9-12) ===
  {
    id: "add_health",
    name: "Health First",
    description: "Add a health reminder (doctor, vitamins, exercise)",
    icon: "💊",
    points: 15,
    check: (reminders) => reminders.some(r => r.category === "health")
  },
  {
    id: "add_bill",
    name: "Bill Tracker",
    description: "Add a bill/payment reminder (rent, utilities)",
    icon: "💰",
    points: 15,
    check: (reminders) => reminders.some(r => r.category === "finance" || /bill|rent|pay|mortgage|insurance/i.test(r.title))
  },
  {
    id: "start_streak",
    name: "Streak Starter",
    description: "Build a 2-day streak by marking reminders complete daily",
    icon: "🔥",
    points: 30,
    check: (_, stats) => stats.currentStreak >= 2 || stats.longestStreak >= 2
  },
  {
    id: "week_streak",
    name: "Week Warrior",
    description: "Maintain a 7-day streak",
    icon: "⚡",
    points: 100,
    check: (_, stats) => stats.currentStreak >= 7 || stats.longestStreak >= 7
  }
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
    completedAllTime: 0, level: 1, achievements: [...DEFAULT_ACHIEVEMENTS],
    completedTasks: []
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
  
  // Import Modal State
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    let file: File | null = null;
    if ('dataTransfer' in e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) file = e.dataTransfer.files[0];
    } else if (e.target.files && e.target.files[0]) {
      file = e.target.files[0];
    }
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      
      let imported: Partial<Reminder>[] = [];
      if (file!.name.endsWith(".ics") || file!.name.endsWith(".icl")) {
        imported = parseICS(content);
      } else if (file!.name.endsWith(".csv")) {
        imported = parseCSV(content);
      } else {
        setToast("Unsupported file type. Use .ics or .csv");
        return;
      }
      
      if (imported.length === 0) {
        setToast("No valid reminders found.");
        return;
      }
      
      // Merge imported reminders
      const newReminders: Reminder[] = imported.map(p => ({
        id: generateId(),
        title: p.title || "Untitled Reminder",
        dueDate: p.dueDate || new Date().toISOString().split("T")[0],
        dueTime: p.dueTime,
        priority: p.priority || "medium",
        category: p.category || "other",
        recurrence: p.recurrence || "none",
        recurrenceInterval: p.recurrenceInterval,
        recurrenceUnit: p.recurrenceUnit,
        completed: false,
        createdAt: new Date().toISOString(),
        pointsAwarded: 0
      }));
      
      setReminders(prev => [...prev, ...newReminders]);
      setImportOpen(false);
      setToast(`Imported ${newReminders.length} reminders!`);
      
      // Check for first import achievement (could be a new progression task later)
    };
    reader.readAsText(file);
  };

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
  
  // Track which tasks we've already processed to prevent double-awarding
  const processedTasksRef = useRef<Set<string>>(new Set(stats.completedTasks || []));
  
  // Check for newly completed progression tasks and award points
  // IMPORTANT: Tasks must be completed in SEQUENTIAL order
  useEffect(() => {
    const currentCompleted = stats.completedTasks || [];
    
    // Sync ref with current state
    currentCompleted.forEach(id => processedTasksRef.current.add(id));
    
    console.log("[Progression] Checking tasks. Current completed:", currentCompleted);
    console.log("[Progression] Reminders count:", reminders.length);
    console.log("[Progression] Stats:", { completedAllTime: stats.completedAllTime, currentStreak: stats.currentStreak });
    
    // Find the NEXT task in sequence (first one not completed)
    let nextTaskIndex = 0;
    for (let i = 0; i < PROGRESSION_TASKS.length; i++) {
      if (!processedTasksRef.current.has(PROGRESSION_TASKS[i].id)) {
        nextTaskIndex = i;
        break;
      }
    }
    
    const nextTask = PROGRESSION_TASKS[nextTaskIndex];
    if (!nextTask || processedTasksRef.current.has(nextTask.id)) {
      console.log("[Progression] All tasks completed or no next task");
      return;
    }
    
    console.log(`[Progression] Next task to complete: "${nextTask.id}"`);
    
    // Check if the next task's condition is met
    const isComplete = nextTask.check(reminders, stats);
    console.log(`[Progression] Task "${nextTask.id}": check=${isComplete}`);
    
    if (isComplete) {
      processedTasksRef.current.add(nextTask.id); // Mark as processed immediately
      console.log(`[Progression] Task "${nextTask.id}" COMPLETED! +${nextTask.points} pts`);
      
      setStats(prev => ({
        ...prev,
        totalPoints: prev.totalPoints + nextTask.points,
        completedTasks: [...new Set([...(prev.completedTasks || []), nextTask.id])]
      }));
      setToast(`🎉 "${nextTask.name}" complete! +${nextTask.points} pts`);
    }
  }, [reminders.length, stats.completedAllTime, stats.currentStreak, stats.longestStreak]);
  
  // Get the current progression task to show as hint (the NEXT task in sequence)
  const getCurrentProgressionTask = (): { text: string; icon: string; points: number; name: string } | null => {
    const completedTasks = stats.completedTasks || [];
    
    // Find the first task that is NOT in completedTasks (sequential order)
    for (const task of PROGRESSION_TASKS) {
      if (!completedTasks.includes(task.id)) {
        console.log(`[Hint] Next task: "${task.id}"`);
        return {
          text: task.description,
          icon: task.icon,
          points: task.points,
          name: task.name
        };
      }
    }
    
    // All tasks complete - show level progress
    return {
      text: `${Math.round(levelInfo.progress)}% to Level ${levelInfo.level + 1}`,
      icon: "👑",
      points: 0,
      name: "All Tasks Complete!"
    };
  };
  
  const hint = getCurrentProgressionTask();
  const completedTaskCount = (stats.completedTasks || []).length;
  const totalTaskCount = PROGRESSION_TASKS.length;
  
  console.log("[Render] completedTaskCount:", completedTaskCount, "hint:", hint?.name);
  
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
  
  // Snooze popup state - stores the reminder being snoozed
  const [snoozePopup, setSnoozePopup] = useState<Reminder | null>(null);
  
  const snooze = (r: Reminder, mins: number) => {
    const now = new Date();
    const newTime = new Date(now.getTime() + mins * 60 * 1000); // Use milliseconds for accuracy
    
    setReminders(prev => prev.map(x => x.id === r.id ? { 
      ...r, 
      dueDate: newTime.toISOString().split("T")[0], 
      dueTime: `${newTime.getHours().toString().padStart(2,"0")}:${newTime.getMinutes().toString().padStart(2,"0")}` 
    } : x));
    
    // Format the toast message based on duration
    let durationText = `${mins} minutes`;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      durationText = hours === 1 ? "1 hour" : `${hours} hours`;
    }
    if (mins >= 1440) {
      const days = Math.floor(mins / 1440);
      durationText = days === 1 ? "1 day" : `${days} days`;
    }
    
    setToast(`💤 Snoozed for ${durationText}`);
    setSnoozePopup(null);
  };
  
  const del = (id: string) => { setReminders(prev => prev.filter(r => r.id !== id)); setToast("Deleted"); };
  
  // Reset all progress (for debugging/fresh start)
  const resetProgress = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STATS_KEY);
    processedTasksRef.current.clear();
    setReminders([]);
    setStats({
      totalPoints: 0, currentStreak: 0, longestStreak: 0,
      completedAllTime: 0, level: 1, achievements: [...DEFAULT_ACHIEVEMENTS],
      completedTasks: []
    });
    setToast("Progress reset! Start fresh.");
    console.log("[Reset] All progress cleared");
  };
  
  // Round icon component for modern minimal style
  const CategoryIcon = ({ cat, size = 32 }: { cat: Category; size?: number }) => {
    const config = CATEGORY_CONFIG[cat];
    const Icon = config.icon;
    const iconSize = size * 0.5;
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: config.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0
      }}>
        <Icon size={iconSize} color={config.color} />
      </div>
    );
  };

  // Global input styles for box-sizing
  const inputStyle = { boxSizing: "border-box" as const };

  // Modern card shadow
  const cardShadow = "0 2px 8px rgba(0,0,0,0.04)";
  const cardRadius = 20;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.bg, minHeight: "100%", padding: 16, fontWeight: 400 }}>
      {/* Toast notification */}
      {toast && (
        <div style={{ 
          position: "fixed", top: 16, right: 16, 
          padding: "14px 24px", borderRadius: 50, 
          backgroundColor: COLORS.primary, color: "#fff", 
          fontWeight: 500, fontSize: 14, zIndex: 1000, 
          boxShadow: "0 4px 20px rgba(45,90,61,0.3)" 
        }}>
          {toast}
        </div>
      )}
      
      {/* Achievement popup */}
      {achievement && (
        <div style={{ 
          position: "fixed", top: "50%", left: "50%", 
          transform: "translate(-50%,-50%)", padding: 32, 
          borderRadius: 24, backgroundColor: COLORS.card, 
          boxShadow: "0 16px 48px rgba(0,0,0,0.15)", 
          zIndex: 1001, textAlign: "center" 
        }}>
          <div style={{ fontSize: 56 }}>{achievement.icon}</div>
          <h3 style={{ color: COLORS.primary, margin: "12px 0 4px", fontSize: 18, fontWeight: 600 }}>Achievement Unlocked!</h3>
          <p style={{ color: COLORS.textMain, fontWeight: 500, margin: 0, fontSize: 16 }}>{achievement.name}</p>
        </div>
      )}
      
      {/* Header Bar - rounded pill style */}
      <div style={{ 
        backgroundColor: COLORS.primary, 
        borderRadius: cardRadius, 
        padding: "16px 20px", 
        marginBottom: 12, 
        color: "#fff",
        boxShadow: "0 4px 16px rgba(45,90,61,0.2)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ 
              width: 36, height: 36, borderRadius: "50%", 
              backgroundColor: "rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <Bell size={18} />
            </div>
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px" }}>Smart Reminders</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <button 
              onClick={() => setImportOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 50,
                backgroundColor: "rgba(255,255,255,0.15)", color: "#fff",
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500
              }}
              title="Import from Calendar/Excel"
            >
              <Upload size={14} /> Import
            </button>
            <div style={{ 
              display: "flex", alignItems: "center", gap: 6, 
              backgroundColor: "rgba(255,255,255,0.12)", 
              padding: "6px 14px", borderRadius: 50 
            }} title="Your current level">
              <Crown size={14} color={COLORS.gold} />
              <span style={{ fontWeight: 500 }}>Level {levelInfo.level}</span>
            </div>
            <div style={{ 
              display: "flex", alignItems: "center", gap: 6, 
              backgroundColor: "rgba(255,255,255,0.12)", 
              padding: "6px 14px", borderRadius: 50 
            }} title="Total points earned">
              <Star size={14} color={COLORS.gold} />
              <span style={{ fontWeight: 500 }}>{stats.totalPoints} pts</span>
            </div>
            <div style={{ 
              display: "flex", alignItems: "center", gap: 6, 
              backgroundColor: stats.currentStreak > 0 ? "rgba(212,165,116,0.3)" : "rgba(255,255,255,0.12)", 
              padding: "6px 14px", borderRadius: 50 
            }} title="Days in a row">
              <Flame size={14} color={stats.currentStreak > 0 ? COLORS.gold : "rgba(255,255,255,0.5)"} />
              <span style={{ fontWeight: 500 }}>{stats.currentStreak} day streak</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Gamification Hint/Guide - modern card style */}
      {hint && (
        <div style={{ 
          backgroundColor: COLORS.card, 
          borderRadius: cardRadius, 
          padding: "16px 20px", 
          marginBottom: 12, 
          boxShadow: cardShadow
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Round icon background */}
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              backgroundColor: COLORS.iconBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24
            }}>
              {hint.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textMain, marginBottom: 2 }}>
                {hint.name} {hint.points > 0 && <span style={{ fontWeight: 400, color: COLORS.textMuted }}>• +{hint.points} pts</span>}
              </div>
              <span style={{ fontSize: 13, color: COLORS.textSecondary }}>{hint.text}</span>
            </div>
            <div style={{ 
              fontSize: 12, color: COLORS.textMuted, 
              backgroundColor: COLORS.cardAlt, 
              padding: "4px 10px", borderRadius: 50 
            }}>
              {completedTaskCount}/{totalTaskCount}
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 6, backgroundColor: COLORS.primaryBg, borderRadius: 50, overflow: "hidden" }}>
              <div style={{ 
                height: "100%", 
                width: `${(completedTaskCount / totalTaskCount) * 100}%`, 
                backgroundColor: COLORS.primary, 
                borderRadius: 50,
                transition: "width 0.3s ease"
              }} />
            </div>
            <button 
              onClick={resetProgress} 
              style={{ 
                fontSize: 11, color: COLORS.textMuted, background: "none", border: "none", 
                cursor: "pointer", padding: "4px 8px", borderRadius: 50,
                opacity: 0.6
              }}
              title="Reset all progress"
            >
              Reset
            </button>
          </div>
        </div>
      )}
      
      {/* All tasks complete celebration */}
      {completedTaskCount === totalTaskCount && totalTaskCount > 0 && (
        <div style={{ 
          backgroundColor: COLORS.card, 
          borderRadius: cardRadius, 
          padding: "16px 20px", 
          marginBottom: 12, 
          textAlign: "center",
          boxShadow: cardShadow
        }}>
          <span style={{ fontSize: 24 }}>🏆</span>
          <span style={{ marginLeft: 10, fontSize: 15, fontWeight: 500, color: COLORS.textMain }}>
            All tasks complete! You're a reminder master!
          </span>
        </div>
      )}
      
      {/* AI Input - Create New Task card */}
      <div style={{ 
        backgroundColor: COLORS.card, 
        borderRadius: cardRadius, 
        padding: 20, 
        marginBottom: 12, 
        boxShadow: cardShadow 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            backgroundColor: COLORS.iconBg,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Plus size={20} color={COLORS.primary} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textMain }}>Create New Task</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>Type naturally to add a reminder</div>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Try: 'Call mom tomorrow 3pm' or 'Pay rent Friday urgent'"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ 
              ...inputStyle, 
              width: "100%", 
              padding: "14px 54px 14px 18px", 
              borderRadius: 50, 
              border: `2px solid ${parsed ? COLORS.primaryLight : COLORS.border}`, 
              backgroundColor: COLORS.inputBg, 
              fontSize: 15, 
              outline: "none", 
              transition: "border-color 0.2s" 
            }}
          />
          {parsed && (
            <button 
              onClick={createFromParsed} 
              style={{ 
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", 
                width: 40, height: 40, borderRadius: "50%", border: "none", 
                backgroundColor: COLORS.primary, color: "#fff", 
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 8px rgba(45,90,61,0.3)"
              }}
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
        
        {/* Preview Card */}
        {parsed && (
          <div style={{ marginTop: 16, padding: 16, backgroundColor: COLORS.cardAlt, borderRadius: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textMain }}>{parsed.title}</span>
              <span style={{ fontSize: 11, color: COLORS.textMuted, backgroundColor: COLORS.card, padding: "4px 10px", borderRadius: 50 }}>{parsed.confidence}% match</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 50, backgroundColor: COLORS.card, fontSize: 13, color: COLORS.textSecondary }}>
                <Calendar size={14} /> {formatDate(parsed.dueDate)}{parsed.dueTime && ` ${formatTime(parsed.dueTime)}`}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 50, fontSize: 13, backgroundColor: CATEGORY_CONFIG[parsed.category].bg, color: CATEGORY_CONFIG[parsed.category].color }}>
                <CategoryIcon cat={parsed.category} size={20} /> {CATEGORY_CONFIG[parsed.category].label}
              </span>
              <span style={{ padding: "6px 12px", borderRadius: 50, fontSize: 13, fontWeight: 500, backgroundColor: `${PRIORITY_COLORS[parsed.priority]}20`, color: PRIORITY_COLORS[parsed.priority], textTransform: "capitalize" }}>
                {parsed.priority}
              </span>
              {parsed.recurrence !== "none" && <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 50, fontSize: 13, backgroundColor: COLORS.iconBg, color: COLORS.primary, fontWeight: 500 }}><Repeat size={13} /> {formatRecurrence(parsed)}</span>}
            </div>
          </div>
        )}
      </div>
      
      {/* Stats & Filters Row - modern pill style */}
      <div style={{ 
        backgroundColor: COLORS.card, 
        borderRadius: cardRadius, 
        padding: "14px 20px", 
        marginBottom: 12, 
        boxShadow: cardShadow,
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" 
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          {overdueCount > 0 && <span style={{ padding: "6px 14px", borderRadius: 50, fontSize: 13, fontWeight: 500, backgroundColor: `${COLORS.danger}15`, color: COLORS.danger }}>{overdueCount} overdue</span>}
          {todayCount > 0 && <span style={{ padding: "6px 14px", borderRadius: 50, fontSize: 13, fontWeight: 500, backgroundColor: `${COLORS.gold}20`, color: COLORS.gold }}>{todayCount} today</span>}
          <span style={{ padding: "6px 14px", borderRadius: 50, fontSize: 13, fontWeight: 500, backgroundColor: COLORS.iconBg, color: COLORS.primary }}>{reminders.filter(r => !r.completed).length} pending</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <Search size={16} color={COLORS.textMuted} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input type="text" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: 130, padding: "10px 14px 10px 36px", borderRadius: 50, border: "none", backgroundColor: COLORS.inputBg, fontSize: 14, outline: "none" }} />
          </div>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as any)} style={{ ...inputStyle, padding: "10px 16px", borderRadius: 50, border: "none", fontSize: 14, backgroundColor: COLORS.inputBg, cursor: "pointer" }}><option value="all">All</option>{Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} style={{ ...inputStyle, padding: "10px 16px", borderRadius: 50, border: "none", fontSize: 14, backgroundColor: COLORS.inputBg, cursor: "pointer" }}><option value="all">All</option><option value="pending">Pending</option><option value="completed">Done</option><option value="overdue">Overdue</option></select>
        </div>
      </div>
      
      {/* Reminder List - modern card style */}
      <div style={{ backgroundColor: COLORS.card, borderRadius: cardRadius, boxShadow: cardShadow, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: COLORS.textMuted }}>
            <div style={{ 
              width: 64, height: 64, borderRadius: "50%", 
              backgroundColor: COLORS.iconBg, 
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px"
            }}>
              <Bell size={28} color={COLORS.textMuted} />
            </div>
            <p style={{ fontSize: 16, margin: 0, fontWeight: 500, color: COLORS.textMain }}>No reminders yet</p>
            <p style={{ fontSize: 14, marginTop: 6, color: COLORS.textMuted }}>Type above to create your first one!</p>
          </div>
        ) : filtered.map((r, i) => (
          <div key={r.id} style={{ 
            padding: "16px 20px", 
            borderBottom: i < filtered.length - 1 ? `1px solid ${COLORS.border}` : "none", 
            backgroundColor: r.completed ? COLORS.cardAlt : COLORS.card, 
            opacity: r.completed ? 0.7 : 1 
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* Round checkbox */}
              <button 
                onClick={() => r.completed ? uncomplete(r) : complete(r)} 
                style={{ 
                  width: 28, height: 28, borderRadius: "50%", 
                  border: `2px solid ${r.completed ? COLORS.success : COLORS.border}`, 
                  backgroundColor: r.completed ? COLORS.success : "transparent", 
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 
                }}
              >
                {r.completed && <Check size={14} color="#fff" />}
              </button>
              
              {/* Category icon - round */}
              <CategoryIcon cat={r.category} size={40} />
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 500, color: COLORS.textMain, textDecoration: r.completed ? "line-through" : "none" }}>{r.title}</span>
                  {isOverdue(r) && <span style={{ padding: "3px 10px", borderRadius: 50, fontSize: 11, fontWeight: 500, backgroundColor: `${COLORS.danger}15`, color: COLORS.danger }}>Overdue</span>}
                  {r.recurrence !== "none" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 50, fontSize: 11, backgroundColor: COLORS.iconBg, color: COLORS.primary }}><Repeat size={11} /> {formatRecurrence(r)}</span>}
                </div>
                <div style={{ fontSize: 13, color: isOverdue(r) ? COLORS.danger : COLORS.textMuted, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock size={13} /> {formatDate(r.dueDate)}{r.dueTime && ` at ${formatTime(r.dueTime)}`}
                  <span style={{ padding: "3px 10px", borderRadius: 50, fontSize: 11, backgroundColor: `${PRIORITY_COLORS[r.priority]}15`, color: PRIORITY_COLORS[r.priority], textTransform: "capitalize" }}>{r.priority}</span>
                </div>
              </div>
              
              {/* Action buttons - round */}
              <div style={{ display: "flex", gap: 8 }}>
                {!r.completed && (
                  <button 
                    onClick={() => setSnoozePopup(r)} 
                    title="Snooze" 
                    style={{ 
                      width: 36, height: 36, borderRadius: "50%", border: "none", 
                      backgroundColor: COLORS.inputBg, 
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                    }}
                  >
                    <span style={{ fontSize: 16 }}>💤</span>
                  </button>
                )}
                {!r.completed && (
                  <button 
                    onClick={() => setEditing(r)} 
                    title="Edit" 
                    style={{ 
                      width: 36, height: 36, borderRadius: "50%", border: "none", 
                      backgroundColor: COLORS.inputBg, 
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" 
                    }}
                  >
                    <Edit2 size={16} color={COLORS.textMuted} />
                  </button>
                )}
                <button 
                  onClick={() => del(r.id)} 
                  title="Delete" 
                  style={{ 
                    width: 36, height: 36, borderRadius: "50%", border: "none", 
                    backgroundColor: `${COLORS.danger}10`, 
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" 
                  }}
                >
                  <Trash2 size={16} color={COLORS.danger} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Snooze Popup - modern style */}
      {snoozePopup && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
          <div style={{ backgroundColor: COLORS.card, borderRadius: 24, width: "100%", maxWidth: 320, padding: 28, textAlign: "center", boxShadow: "0 16px 48px rgba(0,0,0,0.15)" }}>
            <div style={{ 
              width: 64, height: 64, borderRadius: "50%", 
              backgroundColor: COLORS.iconBg, 
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px", fontSize: 32
            }}>
              💤
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, color: COLORS.textMain }}>Snooze Reminder</h3>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.4 }}>
              "{snoozePopup.title}"
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button 
                onClick={() => snooze(snoozePopup, 15)} 
                style={{ 
                  padding: "14px 20px", borderRadius: 50, border: "none", 
                  backgroundColor: COLORS.iconBg, color: COLORS.primary, 
                  fontSize: 15, fontWeight: 500, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10
                }}
              >
                <Clock size={18} /> 15 minutes
              </button>
              
              <button 
                onClick={() => snooze(snoozePopup, 60)} 
                style={{ 
                  padding: "14px 20px", borderRadius: 50, border: "none", 
                  backgroundColor: COLORS.iconBg, color: COLORS.primary, 
                  fontSize: 15, fontWeight: 500, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10
                }}
              >
                <Clock size={18} /> 1 hour
              </button>
              
              <button 
                onClick={() => snooze(snoozePopup, 1440)} 
                style={{ 
                  padding: "14px 20px", borderRadius: 50, border: "none", 
                  backgroundColor: COLORS.iconBg, color: COLORS.primary, 
                  fontSize: 15, fontWeight: 500, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10
                }}
              >
                <Calendar size={18} /> 1 day
              </button>
            </div>
            
            <button 
              onClick={() => setSnoozePopup(null)} 
              style={{ 
                marginTop: 20, padding: "12px 28px", borderRadius: 50, 
                border: "none", backgroundColor: COLORS.inputBg, 
                fontSize: 14, fontWeight: 500, cursor: "pointer", color: COLORS.textMuted
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      
      {/* Import Modal */}
      {importOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
          <div style={{ backgroundColor: COLORS.card, borderRadius: 24, width: "100%", maxWidth: 480, padding: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.textMain }}>Import Reminders</h2>
              <button onClick={() => setImportOpen(false)} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={18} color={COLORS.textMuted} /></button>
            </div>
            
            <p style={{ margin: "0 0 20px", fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
              Drag and drop an <b>.ics</b> (iCalendar) or <b>.csv</b> (Excel) file to import your reminders from other apps like Google Calendar, Outlook, or Apple Reminders.
            </p>
            
            <div 
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
              onDrop={handleFileUpload}
              style={{
                border: `2px dashed ${dragActive ? COLORS.primary : COLORS.border}`,
                borderRadius: 16,
                backgroundColor: dragActive ? `${COLORS.primary}10` : COLORS.inputBg,
                padding: 40,
                textAlign: "center",
                transition: "all 0.2s ease",
                cursor: "pointer",
                marginBottom: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12
              }}
            >
              <div style={{ width: 48, height: 48, borderRadius: "50%", backgroundColor: COLORS.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Upload size={24} color={COLORS.primary} />
              </div>
              <div>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: COLORS.textMain, marginBottom: 4 }}>
                  {dragActive ? "Drop file to import" : "Click or drag file here"}
                </span>
                <span style={{ fontSize: 13, color: COLORS.textMuted }}>
                  Supports .ics and .csv
                </span>
              </div>
              <input 
                type="file" 
                accept=".ics,.icl,.csv" 
                onChange={handleFileUpload}
                style={{ position: "absolute", width: "100%", height: "100%", opacity: 0, cursor: "pointer", display: "none" }}
                id="file-upload-input"
              />
              <label htmlFor="file-upload-input" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, cursor: "pointer" }} />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ padding: 16, backgroundColor: COLORS.cardAlt, borderRadius: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14, fontWeight: 600, color: COLORS.textMain }}>
                  <Calendar size={16} /> iCalendar (.ics)
                </div>
                <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted }}>
                  Best for Google Calendar, Apple Calendar, and ChatGPT exports.
                </p>
              </div>
              <div style={{ padding: 16, backgroundColor: COLORS.cardAlt, borderRadius: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 14, fontWeight: 600, color: COLORS.textMain }}>
                  <FileText size={16} /> CSV (.csv)
                </div>
                <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted }}>
                  Works with Outlook, Trello, Asana, and Excel sheets.
                </p>
              </div>
            </div>
            
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: COLORS.textMain }}>Pro Tip: Use AI to Plan</h4>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5, backgroundColor: COLORS.accentLight, padding: 12, borderRadius: 12 }}>
                Ask ChatGPT: "Create a study plan for my exam next week and export it as an ICS file." Then paste the text into a file and drop it here!
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal - modern style */}
      {editing && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16, overflowY: "auto" }}>
          <div style={{ backgroundColor: COLORS.card, borderRadius: 24, width: "100%", maxWidth: 420, padding: 24, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.textMain }}>Edit Reminder</h2>
              <button onClick={() => setEditing(null)} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={18} color={COLORS.textMuted} /></button>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textMuted, display: "block", marginBottom: 8 }}>Title</label>
              <input type="text" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} style={{ ...inputStyle, width: "100%", padding: 14, borderRadius: 14, border: "none", backgroundColor: COLORS.inputBg, fontSize: 15 }} />
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textMuted, display: "block", marginBottom: 8 }}>Category</label>
                <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value as Category })} style={{ ...inputStyle, width: "100%", padding: 14, borderRadius: 14, border: "none", backgroundColor: COLORS.inputBg, fontSize: 14 }}>{Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textMuted, display: "block", marginBottom: 8 }}>Priority</label>
                <select value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value as Priority })} style={{ ...inputStyle, width: "100%", padding: 14, borderRadius: 14, border: "none", backgroundColor: COLORS.inputBg, fontSize: 14 }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select>
              </div>
            </div>
            
            {/* Recurrence Section */}
            <div style={{ marginBottom: 16, padding: 16, backgroundColor: COLORS.cardAlt, borderRadius: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: COLORS.textMain, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: COLORS.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Repeat size={14} color={COLORS.primary} />
                </div>
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
                  style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 12, border: "none", fontSize: 14, backgroundColor: COLORS.card }}
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
                    <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Every</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="365"
                      value={editing.recurrenceInterval || 2} 
                      onChange={e => setEditing({ ...editing, recurrenceInterval: parseInt(e.target.value) || 1 })} 
                      style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 12, border: "none", fontSize: 14, backgroundColor: COLORS.card }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Unit</label>
                    <select 
                      value={editing.recurrenceUnit || "days"} 
                      onChange={e => setEditing({ ...editing, recurrenceUnit: e.target.value as any })} 
                      style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 12, border: "none", fontSize: 14, backgroundColor: COLORS.card }}
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
                    <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>Start Date</label>
                    <input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 12, border: "none", fontSize: 14, backgroundColor: COLORS.card }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>End Date (optional)</label>
                    <input type="date" value={editing.endDate || ""} onChange={e => setEditing({ ...editing, endDate: e.target.value || undefined })} style={{ ...inputStyle, width: "100%", padding: 12, borderRadius: 12, border: "none", fontSize: 14, backgroundColor: COLORS.card }} />
                  </div>
                </div>
              )}
            </div>
            
            {/* Date/Time for one-time reminders */}
            {editing.recurrence === "none" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textMuted, display: "block", marginBottom: 8 }}>Date</label>
                  <input type="date" value={editing.dueDate} onChange={e => setEditing({ ...editing, dueDate: e.target.value })} style={{ ...inputStyle, width: "100%", padding: 14, borderRadius: 14, border: "none", backgroundColor: COLORS.inputBg, fontSize: 14 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textMuted, display: "block", marginBottom: 8 }}>Time</label>
                  <input type="time" value={editing.dueTime || ""} onChange={e => setEditing({ ...editing, dueTime: e.target.value || undefined })} style={{ ...inputStyle, width: "100%", padding: 14, borderRadius: 14, border: "none", backgroundColor: COLORS.inputBg, fontSize: 14 }} />
                </div>
              </div>
            )}
            
            {/* Time for recurring reminders */}
            {editing.recurrence !== "none" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: COLORS.textMuted, display: "block", marginBottom: 8 }}>Reminder Time</label>
                <input type="time" value={editing.dueTime || ""} onChange={e => setEditing({ ...editing, dueTime: e.target.value || undefined })} style={{ ...inputStyle, width: "100%", padding: 14, borderRadius: 14, border: "none", backgroundColor: COLORS.inputBg, fontSize: 14 }} />
              </div>
            )}
            
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setEditing(null)} style={{ flex: 1, padding: 16, borderRadius: 50, border: "none", backgroundColor: COLORS.inputBg, fontSize: 15, fontWeight: 500, cursor: "pointer", color: COLORS.textMuted }}>Cancel</button>
              <button onClick={() => updateReminder(editing)} style={{ flex: 1, padding: 16, borderRadius: 50, border: "none", backgroundColor: COLORS.primary, color: "#fff", fontSize: 15, fontWeight: 500, cursor: "pointer", boxShadow: "0 4px 12px rgba(45,90,61,0.3)" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
