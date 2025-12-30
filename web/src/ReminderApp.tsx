import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Bell, Plus, Check, X, Clock, Calendar, Search, Filter, Trash2,
  Edit2, Repeat, Trophy, Flame, Star, Award, Crown, Send,
  SortAsc, SortDesc, Timer, Briefcase, Users, Heart, ShoppingCart,
  Stethoscope, GraduationCap, Plane, Home, Sparkles, ChevronRight, Upload, FileText, Download, Camera, Wand2
} from "lucide-react";

// Analytics tracking helper - sends events to server
const trackEvent = (event: string, data: Record<string, any> = {}) => {
  try {
    const rawServerUrl = (window as any).openai?.serverUrl || "";
    let baseUrl = rawServerUrl;
    try {
      if (rawServerUrl) baseUrl = new URL(rawServerUrl).origin;
    } catch {
      baseUrl = rawServerUrl;
    }
    // In ChatGPT web-sandbox, openai.serverUrl may be missing; a relative /api/track will hit
    // the sandbox origin (oaiusercontent.com) which can fail. Force a safe fallback.
    if (!baseUrl || /oaiusercontent\.com$/i.test(baseUrl)) {
      baseUrl = "https://reminder-app-3pz5.onrender.com";
    }

    fetch(`${baseUrl}/api/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        data: {
          ...data,
          ts: Date.now(),
        },
      }),
    }).catch(() => {}); // Silent fail - don't block UI
  } catch (e) {
    // Silent fail
  }
};

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
  recurrenceDays?: number[]; // Specific days of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
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
  lastActiveDate: string | null; // Track last day user completed a task for proper streak
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
  recurrenceDays?: number[]; // Specific days of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
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

// Quick filter chips configuration - modern emoji-based filtering
const QUICK_FILTERS: { id: string; label: string; emoji: string; color: string; bg: string }[] = [
  { id: "all", label: "All", emoji: "📋", color: COLORS.primary, bg: COLORS.iconBg },
  { id: "urgent", label: "Urgent", emoji: "🔥", color: "#C97070", bg: "#F5E8E8" },
  { id: "today", label: "Today", emoji: "📅", color: "#D4A574", bg: "#F5F0E8" },
  { id: "overdue", label: "Overdue", emoji: "⚠️", color: "#C97070", bg: "#F5E8E8" },
  { id: "completed", label: "Done", emoji: "✅", color: "#3D7A5A", bg: "#E8F5E8" },
  { id: "work", label: "Work", emoji: "💼", color: "#4A7C59", bg: "#E8F0E8" },
  { id: "family", label: "Family", emoji: "👨‍👩‍👧", color: "#B87A9E", bg: "#F5E8F0" },
  { id: "health", label: "Health", emoji: "💪", color: "#5A9B7A", bg: "#E8F5F0" },
  { id: "errands", label: "Errands", emoji: "🛒", color: "#D4A574", bg: "#F5F0E8" },
  { id: "finance", label: "Finance", emoji: "💰", color: "#7A6B9B", bg: "#F0E8F5" },
  { id: "social", label: "Social", emoji: "🎉", color: "#C97070", bg: "#F5E8E8" },
  { id: "learning", label: "Learn", emoji: "📚", color: "#5A8B9B", bg: "#E8F0F5" },
  { id: "travel", label: "Travel", emoji: "✈️", color: "#6B7A9B", bg: "#E8ECF5" },
  { id: "home", label: "Home", emoji: "🏠", color: "#7A9B6B", bg: "#ECF5E8" },
];

// Check if a reminder was recently completed (within 1 minute)
const isRecentlyCompleted = (r: Reminder): boolean => {
  if (!r.completed || !r.completedAt) return false;
  const completedTime = new Date(r.completedAt).getTime();
  const now = Date.now();
  const diff = now - completedTime;
  const isRecent = diff < 60000;
  // console.log(`[Debug] isRecentlyCompleted: ${r.title}, Diff: ${diff}ms, Result: ${isRecent}`);
  return isRecent;
};

const generateId = () => `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const formatDate = (dateStr: string) => {
  // Parse as local date, not UTC (YYYY-MM-DD format)
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(todayOnly); tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.getTime() === todayOnly.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatTime = (time?: string) => {
  if (!time) return "";
  const [h, m] = time.split(":"); const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
};

const isOverdue = (r: Reminder) => {
  // If completed and NOT recently completed, it's not overdue (it's done)
  // If recently completed, we still consider it "overdue" for 1 minute so it stays in the Overdue section
  if (r.completed && !isRecentlyCompleted(r)) return false;
  
  // Parse date as local time, not UTC
  const [year, month, day] = r.dueDate.split('-').map(Number);
  const [hours, minutes] = (r.dueTime || "23:59").split(':').map(Number);
  const dueDateTime = new Date(year, month - 1, day, hours, minutes);
  return dueDateTime < new Date();
};

// Helper to parse date string as local date (not UTC)
const parseLocalDate = (dateStr: string): Date => {
  // "YYYY-MM-DD" format - parse as local, not UTC
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
};

// Helper to get time-based section for a reminder
const getTimeSection = (r: Reminder): "overdue" | "today" | "tomorrow" | "thisWeek" | "later" => {
  // If completed and NOT recently completed, it goes to 'later' (or usually filtered out)
  // If recently completed, we want it to stay in its original section
  if (r.completed && !isRecentlyCompleted(r)) return "later";
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
  
  // Parse dueDate as local date, not UTC
  const dueDateOnly = parseLocalDate(r.dueDate);
  
  if (isOverdue(r)) return "overdue";
  if (dueDateOnly.getTime() === today.getTime()) return "today";
  if (dueDateOnly.getTime() === tomorrow.getTime()) return "tomorrow";
  if (dueDateOnly < weekEnd) return "thisWeek";
  return "later";
};

// Section labels with emojis for modern look
const SECTION_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  overdue: { label: "Overdue", emoji: "⚠️", color: "#C97070" },
  today: { label: "Today", emoji: "📅", color: "#D4A574" },
  tomorrow: { label: "Tomorrow", emoji: "🌅", color: "#5A8B9B" },
  thisWeek: { label: "This Week", emoji: "📆", color: "#4A7C59" },
  later: { label: "Later", emoji: "📌", color: "#8A998A" },
};

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

// Priority detection - ONLY from explicit user keywords, never auto-inferred
const detectPriority = (text: string, dueDate?: string): Priority => {
  const lower = text.toLowerCase();
  
  // Only set priority if user explicitly states it
  if (/\b(urgent|asap|immediately|critical|emergency)\b/.test(lower)) return "urgent";
  if (/\b(important|high priority|crucial|must)\b/.test(lower)) return "high";
  if (/\b(low priority|whenever|no rush|eventually)\b/.test(lower)) return "low";
  
  // Default to medium - user can change in settings
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
  
  // Parse time - comprehensive time detection
  let dueTime: string | undefined;
  
  // Named time words first (before numeric patterns)
  if (/\bmidnight\b/i.test(lower)) {
    dueTime = "00:00"; confidence += 15;
  } else if (/\bnoon\b|\bmidday\b/i.test(lower)) {
    dueTime = "12:00"; confidence += 15;
  } else if (/\b(early\s*)?morning\b/i.test(lower) && !/this morning/i.test(lower)) {
    dueTime = /early/i.test(lower) ? "06:00" : "09:00"; confidence += 10;
  } else if (/\bevening\b/i.test(lower)) {
    dueTime = "18:00"; confidence += 10;
  } else if (/\bafternoon\b/i.test(lower)) {
    dueTime = "14:00"; confidence += 10;
  } else if (/\bnight\b/i.test(lower) && !/tonight/i.test(lower)) {
    dueTime = "21:00"; confidence += 10;
  } else if (/\bend of day\b|\beod\b/i.test(lower)) {
    dueTime = "17:00"; confidence += 10;
  }
  
  // Numeric time patterns
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
    { regex: /(\d{1,2}):(\d{2})\s*(am|pm)/i, handler: (m: RegExpMatchArray) => {
      let h = parseInt(m[1]); const min = m[2];
      if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[3].toLowerCase() === "am" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:${min}`;
    }},
    { regex: /(\d{1,2})(am|pm)/i, handler: (m: RegExpMatchArray) => {
      let h = parseInt(m[1]);
      if (m[2].toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[2].toLowerCase() === "am" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:00`;
    }}
  ];
  
  if (!dueTime) {
    for (const p of timePatterns) {
      const match = input.match(p.regex);
      if (match) { dueTime = p.handler(match); confidence += 20; break; }
    }
  }
  
  // Parse date - use local date format to avoid UTC timezone issues
  const formatLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let dueDate = formatLocalDate(today); // Default to today (local)
  
  if (lower.includes("today")) { 
    dueDate = formatLocalDate(today); // Explicitly set to today
    confidence += 20; 
  }
  else if (lower.includes("tonight")) { 
    dueDate = formatLocalDate(today);
    dueTime = dueTime || "20:00"; 
    confidence += 20;
  }
  else if (lower.includes("tomorrow")) {
    const tom = new Date(today); tom.setDate(tom.getDate() + 1);
    dueDate = formatLocalDate(tom); 
    confidence += 20;
  }
  else if (lower.includes("next week")) {
    const next = new Date(today); next.setDate(next.getDate() + 7);
    dueDate = formatLocalDate(next); confidence += 15;
  }
  else if (lower.includes("this weekend")) {
    const sat = new Date(today);
    const dayOfWeek = sat.getDay();
    // If it's already weekend (Sat=6 or Sun=0), use today, otherwise go to Saturday
    if (dayOfWeek === 0) {
      // Sunday - use today
    } else if (dayOfWeek === 6) {
      // Saturday - use today
    } else {
      // Weekday - go to next Saturday
      sat.setDate(sat.getDate() + (6 - dayOfWeek));
    }
    dueDate = formatLocalDate(sat); confidence += 15;
  }
  else if (lower.includes("this morning")) {
    dueDate = formatLocalDate(today);
    dueTime = dueTime || "09:00";
    confidence += 15;
  }
  else if (lower.includes("this afternoon")) {
    dueDate = formatLocalDate(today);
    dueTime = dueTime || "14:00";
    confidence += 15;
  }
  else if (lower.includes("this evening")) {
    dueDate = formatLocalDate(today);
    dueTime = dueTime || "18:00";
    confidence += 15;
  }
  else {
    // "in X days/hours"
    const daysMatch = lower.match(/in (\d+) days?/);
    const hoursMatch = lower.match(/in (\d+) hours?/);
    const weeksMatch = lower.match(/in (\d+) weeks?/);
    
    if (daysMatch) {
      const fut = new Date(today); fut.setDate(fut.getDate() + parseInt(daysMatch[1]));
      dueDate = formatLocalDate(fut); confidence += 15;
    } else if (hoursMatch) {
      const fut = new Date(); fut.setHours(fut.getHours() + parseInt(hoursMatch[1]));
      dueDate = formatLocalDate(fut);
      dueTime = `${fut.getHours().toString().padStart(2, "0")}:${fut.getMinutes().toString().padStart(2, "0")}`;
      confidence += 15;
    } else if (weeksMatch) {
      const fut = new Date(today); fut.setDate(fut.getDate() + parseInt(weeksMatch[1]) * 7);
      dueDate = formatLocalDate(fut); confidence += 15;
    }
    
    // Day names - check if it's today's day name or a future day
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const shortDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    for (let i = 0; i < days.length; i++) {
      const dayRegex = new RegExp(`\\b(on\\s+)?(${days[i]}|${shortDays[i]})\\b`, 'i');
      if (dayRegex.test(lower)) {
        const target = new Date(today);
        const currentDay = today.getDay();
        
        // Calculate days until target day
        let diff = (i - currentDay + 7) % 7;
        // If diff is 0, it means today - keep it as today unless "next" is specified
        if (diff === 0 && /\bnext\b/i.test(lower)) {
          diff = 7; // Go to next week
        }
        
        target.setDate(target.getDate() + diff);
        dueDate = formatLocalDate(target);
        confidence += 15;
        break;
      }
    }
  }
  
  // Parse recurrence - Enhanced with custom intervals and semantic inference
  let recurrence: RecurrenceType = "none";
  let recurrenceInterval: number | undefined;
  let recurrenceUnit: "days" | "weeks" | "months" | "years" | undefined;
  let recurrenceDays: number[] | undefined;
  
  // Day name to number mapping
  const dayNameToNum: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6
  };
  
  // Helper to extract day numbers from text
  const extractDays = (text: string): number[] => {
    const days: number[] = [];
    const dayPattern = /\b(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/gi;
    let match;
    while ((match = dayPattern.exec(text)) !== null) {
      const dayNum = dayNameToNum[match[1].toLowerCase()];
      if (dayNum !== undefined && !days.includes(dayNum)) {
        days.push(dayNum);
      }
    }
    return days.sort((a, b) => a - b);
  };
  
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
  // 2. Multi-day weekly patterns like "every tuesday and thursday" or "every mon, wed, fri"
  else if (/\bevery\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)(\s*(,|and)\s*(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat))+/i.test(lower)) {
    recurrence = "weekly"; 
    recurrenceInterval = 1; 
    recurrenceUnit = "weeks";
    // Extract specific days
    const daysMatch = lower.match(/every\s+((?:sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)(?:\s*(?:,|and)\s*(?:sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat))*)/i);
    if (daysMatch) {
      recurrenceDays = extractDays(daysMatch[1]);
    }
    confidence += 15;
  }
  // 2b. "every monday/tuesday/etc" = weekly on that day (single day)
  else if (/\bevery\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/i.test(lower)) {
    recurrence = "weekly"; 
    recurrenceInterval = 1; 
    recurrenceUnit = "weeks";
    // Extract the single day
    const singleDayMatch = lower.match(/every\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/i);
    if (singleDayMatch) {
      const dayNum = dayNameToNum[singleDayMatch[1].toLowerCase()];
      if (dayNum !== undefined) recurrenceDays = [dayNum];
    }
    confidence += 15;
  }
  // 3. Standard recurrence keywords
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
    // Do NOT infer daily recurrence from pet-related phrases. Users often mean a one-time reminder
    // (e.g. "feed my dog tomorrow at noon"). Only set recurrence when explicitly requested.
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
    .replace(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(\s*(,|and)\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday))*/gi, "")
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
    recurrenceDays,
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
    totalPoints: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null,
    completedAllTime: 0, level: 1, achievements: [...DEFAULT_ACHIEVEMENTS],
    completedTasks: []
  };
  
  // Priority 1: initialData from server (hydration)
  // IMPORTANT: Do not let empty server hydration wipe local state. Only treat server reminders
  // as authoritative if the server explicitly has saved data or if reminders are non-empty.
  if (initialData?.reminders && Array.isArray(initialData.reminders)) {
    const hasSavedData = initialData?.has_saved_data === true;
    const len = initialData.reminders.length;
    if (hasSavedData || len > 0) {
      console.log("[Load] Using initialData from server:", len, "reminders", { hasSavedData });
      return {
        reminders: initialData.reminders,
        stats: initialData.stats || defaultStats
      };
    }
    console.log("[Load] Ignoring empty initialData from server (avoiding wipe)");
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

  const hydrationAppliedRef = useRef<Set<string>>(new Set());
  const hydrationAutoCreateAppliedRef = useRef<Set<string>>(new Set());
  const pendingAutoCreateRef = useRef<{ signature: string; text: string } | null>(null);
  const pendingCompletionRef = useRef<{ action: "complete" | "uncomplete"; query: string } | null>(null);
  
  // Edit mode (only after creation)
  const [editing, setEditing] = useState<Reminder | null>(null);
  
  // Filters
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [filterCategory, setFilterCategory] = useState<Category | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "completed" | "overdue">("all");
  const [sortField, setSortField] = useState<"dueDate" | "priority" | "category">("dueDate");
  const [sortAsc, setSortAsc] = useState(true);
  
  // Modern quick filter - single active chip
  const [quickFilter, setQuickFilter] = useState<"all" | "urgent" | "today" | "overdue" | "completed" | Category>("all");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  
  // Track when tasks were first viewed (for glow effect)
  const [viewedTasks, setViewedTasks] = useState<Record<string, number>>({});
  
  // Track recently completed tasks to keep them visible for 1 minute
  // Map of reminderId -> timestamp when it should disappear
  // This is NOT persisted, so completed items disappear on refresh
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<Record<string, number>>({});
  
  // Helper to check if a reminder should stay visible (state-based, not persisted)
  const isVisibleCompleted = (r: Reminder): boolean => {
    if (!r.completed) return false;
    const expiresAt = recentlyCompletedIds[r.id];
    return expiresAt !== undefined && Date.now() < expiresAt;
  };
  
  const [toast, setToast] = useState<string | null>(null);
  const [achievement, setAchievement] = useState<{ name: string; icon: string } | null>(null);
  
  // Import Modal State
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  
  // Screenshot Import Modal State
  const [screenshotModal, setScreenshotModal] = useState<{
    open: boolean;
    imageData: string | null;
    analyzing: boolean;
    progress: number;
  }>({ open: false, imageData: null, analyzing: false, progress: 0 });
  
  // Celebration popup - only show once per completion cycle
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);

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

  // Track widget load on mount
  useEffect(() => {
    // Dedupe: ChatGPT host can remount widgets or re-hydrate multiple times.
    // We only want one widget_load per session.
    try {
      const key = "__reminder_widget_load_tracked";
      const already =
        (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key) === "1") ||
        (window as any)[key] === true;
      if (already) return;
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, "1");
      (window as any)[key] = true;
    } catch {
      // If storage is blocked, fall back to per-page guard.
      const key = "__reminder_widget_load_tracked";
      if ((window as any)[key] === true) return;
      (window as any)[key] = true;
    }

    trackEvent("load", {
      reminderCount: reminders.length,
      hasStats: !!stats.totalPoints,
    });
  }, []); // Only on mount

  const normalizeQuery = (q: string) =>
    q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const bestMatchReminder = (
    query: string,
    desiredCompleted: boolean
  ): Reminder | null => {
    const nq = normalizeQuery(query);
    if (!nq) return null;
    const candidates = reminders.filter((r) => r.completed === desiredCompleted);
    let best: { r: Reminder; score: number } | null = null;
    for (const r of candidates) {
      const nr = normalizeQuery(r.title);
      if (!nr) continue;
      if (nr === nq) return r;
      if (nr.includes(nq) || nq.includes(nr)) {
        const score = Math.min(nr.length, nq.length) / Math.max(nr.length, nq.length);
        if (!best || score > best.score) best = { r, score };
      }
    }
    return best ? best.r : null;
  };

  const inferActionFromNaturalInput = (text: string): { action?: "create" | "complete" | "uncomplete"; query?: string; prefill?: string } => {
    const t = text.trim();
    const lower = t.toLowerCase();
    const completeMatch = lower.match(/^\s*(mark|set)\s+(it\s+)?(as\s+)?(complete|completed|done)\s+(that\s+)?(i\s+)?(.+)$/i);
    if (completeMatch && completeMatch[6]) {
      return { action: "complete", query: completeMatch[6].trim(), prefill: t };
    }
    const uncompleteMatch = lower.match(/^\s*(undo|uncomplete|mark)\s+(it\s+)?(as\s+)?(not\s+complete|incomplete|not\s+done)\s+(that\s+)?(i\s+)?(.+)$/i);
    if (uncompleteMatch && uncompleteMatch[6]) {
      return { action: "uncomplete", query: uncompleteMatch[6].trim(), prefill: t };
    }
    return { action: "create", prefill: t };
  };

  const buildPrefillText = (data: any): string => {
    const natural = typeof data?.natural_input === "string" ? data.natural_input.trim() : "";
    if (natural) return natural;
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    if (!title) return "";

    const dueDate = typeof data?.due_date === "string" ? data.due_date.trim() : "";
    const dueTime = typeof data?.due_time === "string" ? data.due_time.trim() : "";
    const recurrence = typeof data?.recurrence === "string" ? data.recurrence.trim() : "";

    const parts: string[] = [];
    parts.push(`remind me to ${title}`);
    if (recurrence && recurrence !== "none") {
      parts.push(recurrence);
    }
    if (dueDate) {
      parts.push(`on ${dueDate}`);
    }
    if (dueTime) {
      parts.push(`at ${dueTime}`);
    }
    return parts.join(" ");
  };

  useEffect(() => {
    if (!initialData || typeof initialData !== "object") return;

    const prefill = buildPrefillText(initialData);
    const actionRaw = typeof initialData.action === "string" ? initialData.action : "";
    const completeQueryRaw = typeof initialData.complete_query === "string" ? initialData.complete_query : "";
    const infer = prefill ? inferActionFromNaturalInput(prefill) : {};
    const effectiveAction =
      actionRaw === "complete" || actionRaw === "uncomplete" || actionRaw === "create" || actionRaw === "open"
        ? actionRaw
        : infer.action;
    const effectiveQuery = completeQueryRaw || infer.query || "";

    const signature = JSON.stringify({ prefill, action: effectiveAction || "", query: effectiveQuery });
    if (hydrationAppliedRef.current.has(signature)) return;

    const hasAny = Boolean(prefill) || Boolean(effectiveAction) || Boolean(effectiveQuery);
    if (!hasAny) return;

    hydrationAppliedRef.current.add(signature);

    if (prefill) {
      setInput(prefill);
      try {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(prefill.length, prefill.length);
      } catch {
        // ignore
      }
      trackEvent("hydration_prefill", {
        hasNaturalInput: !!initialData?.natural_input,
        action: effectiveAction || "",
      });
    }

    // Auto-create reminders when hydration indicates creation intent.
    // This should only run once per unique hydration payload.
    const wantsCreate = effectiveAction === "create" || effectiveAction === "open" || !effectiveAction;
    if (wantsCreate && prefill && prefill.trim()) {
      pendingAutoCreateRef.current = { signature, text: prefill };
    }

    if (effectiveAction === "complete" || effectiveAction === "uncomplete") {
      const query = effectiveQuery || prefill;
      if (typeof query === "string" && query.trim()) {
        pendingCompletionRef.current = {
          action: effectiveAction,
          query: query.trim(),
        };
      }
    }
  }, [initialData]);

  // Apply auto-create once parsing has produced a ParsedReminder.
  useEffect(() => {
    const pending = pendingAutoCreateRef.current;
    if (!pending) return;
    if (hydrationAutoCreateAppliedRef.current.has(pending.signature)) {
      pendingAutoCreateRef.current = null;
      return;
    }
    // Wait until input is actually set and parsing has run.
    if (!input || input.trim() !== pending.text.trim()) return;
    if (!parsed) return;

    hydrationAutoCreateAppliedRef.current.add(pending.signature);
    pendingAutoCreateRef.current = null;
    trackEvent("hydration_autocreate", {
      inputLength: input.length,
      confidence: parsed.confidence,
      recurrence: parsed.recurrence,
    });
    createFromParsed();
  }, [input, parsed]);
  
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
  
  // Force re-render every 5 seconds to update recently completed items visibility
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(interval);
  }, []);
  
  // Notify height changes
  useEffect(() => {
    const notify = () => { if ((window as any).openai?.notifyIntrinsicHeight) (window as any).openai.notifyIntrinsicHeight(); };
    notify(); window.addEventListener("resize", notify);
    return () => window.removeEventListener("resize", notify);
  }, [reminders, parsed, editing]);
  
  // Filter and sort reminders with quick filter support
  const filtered = useMemo(() => {
    let f = [...reminders];
    
    // Apply search
    if (search) { 
      const q = search.toLowerCase(); 
      f = f.filter(r => r.title.toLowerCase().includes(q) || r.category.includes(q)); 
    }
    
    // Apply quick filter
    if (quickFilter !== "all") {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      if (quickFilter === "urgent") {
        f = f.filter(r => (!r.completed || isVisibleCompleted(r)) && r.priority === "urgent");
      } else if (quickFilter === "today") {
        f = f.filter(r => (!r.completed || isVisibleCompleted(r)) && r.dueDate === todayStr);
      } else if (quickFilter === "overdue") {
        f = f.filter(r => isOverdue(r));
      } else if (quickFilter === "completed") {
        f = f.filter(r => r.completed && !isVisibleCompleted(r));
      } else {
        f = f.filter(r => (!r.completed || isVisibleCompleted(r)) && r.category === quickFilter);
      }
    }
    
    return f;
  }, [reminders, search, quickFilter, tick, recentlyCompletedIds]);
  
  // Group reminders by time section for smart display
  const groupedByTime = useMemo(() => {
    const groups: Record<string, Reminder[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      thisWeek: [],
      later: []
    };
    
    filtered.filter(r => !r.completed || isVisibleCompleted(r)).forEach(r => {
      const section = getTimeSection(r);
      groups[section].push(r);
    });
    return groups;
  }, [filtered, tick, recentlyCompletedIds]);
  
  // Section order for display
  const sectionOrder = ["overdue", "today", "tomorrow", "thisWeek", "later"] as const;
  
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
  
  // Day number to short name mapping
  const dayNumToShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  
  // Helper to format recurrence for display
  const formatRecurrence = (r: Reminder | ParsedReminder): string => {
    if (r.recurrence === "none") return "";
    if (r.recurrence === "daily") return "Daily";
    if (r.recurrence === "weekly") {
      // If specific days are set, show them
      if (r.recurrenceDays && r.recurrenceDays.length > 0) {
        if (r.recurrenceDays.length === 7) return "Daily";
        if (r.recurrenceDays.length === 1) return `Every ${dayNumToShort[r.recurrenceDays[0]]}`;
        return r.recurrenceDays.map(d => dayNumToShort[d]).join(", ");
      }
      return "Weekly";
    }
    if (r.recurrence === "monthly") return "Monthly";
    if (r.recurrence === "yearly") return "Yearly";
    if (r.recurrence === "custom" && r.recurrenceInterval && r.recurrenceUnit) {
      return `Every ${r.recurrenceInterval} ${r.recurrenceUnit}`;
    }
    return "";
  };
  
  // Create from parsed input - supports comma-separated bulk input
  const createFromParsed = () => {
    if (!input.trim()) { setToast("Type something to create a reminder"); return; }
    
    // Check for comma-separated bulk input
    const segments = input.split(",").map(s => s.trim()).filter(s => s.length > 0);
    
    if (segments.length > 1) {
      // Bulk create mode
      const newReminders: Reminder[] = segments.map(segment => {
        const parsedSegment = parseNaturalLanguage(segment);
        return {
          id: generateId(),
          title: parsedSegment.title,
          dueDate: parsedSegment.dueDate,
          dueTime: parsedSegment.dueTime,
          priority: parsedSegment.priority,
          category: parsedSegment.category,
          recurrence: parsedSegment.recurrence,
          recurrenceInterval: parsedSegment.recurrenceInterval,
          recurrenceUnit: parsedSegment.recurrenceUnit,
          recurrenceDays: parsedSegment.recurrenceDays,
          completed: false,
          createdAt: new Date().toISOString(),
          pointsAwarded: 0
        };
      });
      setReminders(prev => [...prev, ...newReminders]);
      setInput("");
      setParsed(null);
      setToast(`Created ${newReminders.length} reminders!`);
    } else {
      // Single reminder mode
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
        recurrenceDays: parsed.recurrenceDays,
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
    }
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
    trackEvent("complete_task", { category: r.category, priority: r.priority, isRecurring: r.recurrence !== "none" });
    const early = new Date(`${r.dueDate}T${r.dueTime || "23:59"}`) > new Date();
    let pts = 10 + (early ? 5 : 0) + (r.priority === "urgent" ? 15 : 0) + stats.currentStreak * 2;
    
    // Add to recently completed to keep visible for 1 minute
    // Use state-based tracking which is more reliable than deriving from completedAt
    setRecentlyCompletedIds(prev => ({ ...prev, [r.id]: Date.now() + 60000 }));
    
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
    
    // Calculate streak properly based on actual days
    const today = new Date().toISOString().split("T")[0];
    let newStreak = stats.currentStreak;
    if (stats.lastActiveDate !== today) {
      // First completion of the day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      
      if (stats.lastActiveDate === yesterdayStr) {
        // Consecutive day - increase streak
        newStreak = stats.currentStreak + 1;
      } else if (!stats.lastActiveDate) {
        // First ever completion
        newStreak = 1;
      } else {
        // Streak broken - restart at 1
        newStreak = 1;
      }
    }
    
    const newStats = { ...stats, totalPoints: stats.totalPoints + pts, completedAllTime: stats.completedAllTime + 1, currentStreak: newStreak, lastActiveDate: today };
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
    // Remove from recently completed tracking
    setRecentlyCompletedIds(prev => {
      const next = { ...prev };
      delete next[r.id];
      return next;
    });
    
    setReminders(prev => prev.map(x => x.id === r.id ? { ...r, completed: false, completedAt: undefined } : x));
    setStats(s => ({ ...s, totalPoints: Math.max(0, s.totalPoints - r.pointsAwarded), completedAllTime: Math.max(0, s.completedAllTime - 1) }));
  };

  useEffect(() => {
    const pending = pendingCompletionRef.current;
    if (!pending) return;

    const match = bestMatchReminder(pending.query, pending.action === "uncomplete");
    if (!match) {
      trackEvent("hydration_complete_no_match", {
        action: pending.action,
        query: pending.query,
        reminderCount: reminders.length,
      });
      pendingCompletionRef.current = null;
      return;
    }

    if (pending.action === "complete") {
      trackEvent("hydration_complete_apply", { query: pending.query, matchedId: match.id });
      complete(match);
    } else {
      trackEvent("hydration_uncomplete_apply", { query: pending.query, matchedId: match.id });
      uncomplete(match);
    }
    pendingCompletionRef.current = null;
  }, [reminders]);
  
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
  
  const del = (id: string) => { 
    trackEvent("delete_reminder", { id });
    setReminders(prev => prev.filter(r => r.id !== id)); 
    setToast("Deleted"); 
  };
  
  // Reset all progress (for debugging/fresh start)
  const resetProgress = () => {
    trackEvent("reset_progress", { reminderCount: reminders.length, totalPoints: stats.totalPoints });
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STATS_KEY);
    processedTasksRef.current.clear();
    setReminders([]);
    setStats({
      totalPoints: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null,
      completedAllTime: 0, level: 1, achievements: [...DEFAULT_ACHIEVEMENTS],
      completedTasks: []
    });
    setToast("Progress reset! Start fresh.");
    console.log("[Reset] All progress cleared");
  };

  // Generate 40 sample reminders for testing
  const generate40Reminders = () => {
    const sampleTasks = [
      { title: "Call mom", category: "family" as Category, priority: "medium" as Priority },
      { title: "Team standup meeting", category: "work" as Category, priority: "high" as Priority },
      { title: "Pay electricity bill", category: "finance" as Category, priority: "urgent" as Priority },
      { title: "Gym workout", category: "health" as Category, priority: "medium" as Priority },
      { title: "Buy groceries", category: "errands" as Category, priority: "medium" as Priority },
      { title: "Dentist appointment", category: "health" as Category, priority: "high" as Priority },
      { title: "Submit project report", category: "work" as Category, priority: "urgent" as Priority },
      { title: "Pick up dry cleaning", category: "errands" as Category, priority: "low" as Priority },
      { title: "Birthday gift for Sarah", category: "social" as Category, priority: "medium" as Priority },
      { title: "Book flight tickets", category: "travel" as Category, priority: "high" as Priority },
      { title: "Online course lesson", category: "learning" as Category, priority: "medium" as Priority },
      { title: "Water the plants", category: "home" as Category, priority: "low" as Priority },
      { title: "Car oil change", category: "errands" as Category, priority: "medium" as Priority },
      { title: "Reply to client email", category: "work" as Category, priority: "high" as Priority },
      { title: "Dinner with friends", category: "social" as Category, priority: "medium" as Priority },
      { title: "Renew gym membership", category: "health" as Category, priority: "low" as Priority },
      { title: "Fix kitchen faucet", category: "home" as Category, priority: "medium" as Priority },
      { title: "Cancel unused subscription", category: "finance" as Category, priority: "low" as Priority },
      { title: "Family video call", category: "family" as Category, priority: "medium" as Priority },
      { title: "Prepare presentation slides", category: "work" as Category, priority: "high" as Priority },
      { title: "Take vitamins", category: "health" as Category, priority: "low" as Priority },
      { title: "Schedule car inspection", category: "errands" as Category, priority: "medium" as Priority },
      { title: "Read book chapter", category: "learning" as Category, priority: "low" as Priority },
      { title: "Pack for weekend trip", category: "travel" as Category, priority: "high" as Priority },
      { title: "Clean bathroom", category: "home" as Category, priority: "medium" as Priority },
      { title: "Review investment portfolio", category: "finance" as Category, priority: "medium" as Priority },
      { title: "Call insurance company", category: "finance" as Category, priority: "high" as Priority },
      { title: "Kids school pickup", category: "family" as Category, priority: "urgent" as Priority },
      { title: "Coffee with mentor", category: "social" as Category, priority: "medium" as Priority },
      { title: "Update resume", category: "work" as Category, priority: "low" as Priority },
      { title: "Yoga class", category: "health" as Category, priority: "medium" as Priority },
      { title: "Return Amazon package", category: "errands" as Category, priority: "medium" as Priority },
      { title: "Practice Spanish", category: "learning" as Category, priority: "low" as Priority },
      { title: "Check hotel reviews", category: "travel" as Category, priority: "low" as Priority },
      { title: "Organize closet", category: "home" as Category, priority: "low" as Priority },
      { title: "Pay credit card", category: "finance" as Category, priority: "urgent" as Priority },
      { title: "Anniversary dinner reservation", category: "family" as Category, priority: "high" as Priority },
      { title: "Code review for PR", category: "work" as Category, priority: "high" as Priority },
      { title: "Meal prep Sunday", category: "health" as Category, priority: "medium" as Priority },
      { title: "Game night with neighbors", category: "social" as Category, priority: "low" as Priority },
    ];

    const today = new Date();
    const newReminders: Reminder[] = sampleTasks.map((task, i) => {
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + Math.floor(i / 4)); // Spread over ~10 days
      const hour = 8 + (i % 12); // Vary times between 8am and 8pm
      return {
        id: generateId(),
        title: task.title,
        dueDate: dueDate.toISOString().split("T")[0],
        dueTime: `${hour.toString().padStart(2, "0")}:${(i % 2 === 0 ? "00" : "30")}`,
        priority: task.priority,
        category: task.category,
        recurrence: "none" as RecurrenceType,
        completed: false,
        createdAt: new Date().toISOString(),
        pointsAwarded: 0
      };
    });

    setReminders(prev => [...prev, ...newReminders]);
    setToast(`Generated ${newReminders.length} sample reminders!`);
  };

  // Screenshot handler - auto-analyzes with OCR and adds tasks
  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent | File) => {
    trackEvent("screenshot_import", { method: "upload" });
    let file: File | null = null;
    
    if (e instanceof File) {
      file = e;
    } else if ('dataTransfer' in e) {
      e.preventDefault();
      file = e.dataTransfer.files?.[0] || null;
    } else {
      file = e.target.files?.[0] || null;
      e.target.value = ""; // Reset input
    }
    
    if (!file) return;

    // Check if it's an image
    if (!file.type.startsWith("image/")) {
      setToast("Please upload an image file");
      return;
    }

    // Convert to base64 and show modal with analyzing state
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setScreenshotModal({ open: true, imageData: base64, analyzing: true, progress: 0 });
      
      try {
        // Run OCR with Tesseract.js (lazy-load to avoid crashing widget on startup)
        const { default: Tesseract } = await import("tesseract.js");
        const result = await Tesseract.recognize(base64, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text") {
              setScreenshotModal(prev => ({ ...prev, progress: Math.round(m.progress * 100) }));
            }
          }
        });
        
        const extractedText = result.data.text;
        
        // Parse extracted text into tasks
        const lines = extractedText.split(/\r\n|\n|\r/).filter((l: string) => l.trim().length > 3);
        const newReminders: Reminder[] = [];
        
        for (const line of lines) {
          const cleanLine = line.replace(/^[-*•☐☑✓✔□■●◯○\[\]]\s*/g, "").trim();
          if (cleanLine.length < 3) continue;
          
          const parsed = parseNaturalLanguage(cleanLine);
          newReminders.push({
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
          });
        }
        
        if (newReminders.length > 0) {
          setReminders(prev => [...prev, ...newReminders]);
          setScreenshotModal({ open: false, imageData: null, analyzing: false, progress: 0 });
          setToast(`✅ Added ${newReminders.length} tasks from screenshot!`);
        } else {
          setScreenshotModal(prev => ({ ...prev, analyzing: false }));
          setToast("No tasks found in screenshot. Try a clearer image.");
        }
      } catch (error) {
        setScreenshotModal(prev => ({ ...prev, analyzing: false }));
        setToast("Failed to analyze screenshot");
      }
    };
    reader.readAsDataURL(file);
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
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.bg, minHeight: "100%", padding: 16, fontWeight: 400, maxWidth: "100%", overflowX: "hidden" }}>
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
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px" }}>Create Reminders</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
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
      
      {/* Gamification Hint/Guide - modern card style - hide when all complete */}
      {hint && completedTaskCount < totalTaskCount && (
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
      
      {/* All tasks complete celebration popup - dismissible, shown once */}
      {completedTaskCount === totalTaskCount && totalTaskCount > 0 && !celebrationDismissed && (
        <div style={{ 
          position: "fixed", 
          top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: "rgba(0,0,0,0.4)", 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center", 
          zIndex: 1200, 
          padding: 16 
        }}>
          <div style={{ 
            backgroundColor: COLORS.card, 
            borderRadius: 24, 
            padding: 32, 
            textAlign: "center",
            boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
            maxWidth: 360
          }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.textMain, marginBottom: 8 }}>
              All Tasks Complete!
            </div>
            <div style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 }}>
              You're a reminder master! Keep up the great work.
            </div>
            <button
              onClick={() => setCelebrationDismissed(true)}
              style={{
                padding: "12px 32px",
                borderRadius: 50,
                backgroundColor: COLORS.primary,
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600
              }}
            >
              Continue
            </button>
          </div>
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
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>Type naturally • Separate multiple tasks with commas</div>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="e.g. 'Feed cat, Pay bill tomorrow, Cancel Netflix Thursday'"
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
      
      {/* Modern Quick Filter Chips - with scroll arrows for PC */}
      <div style={{ 
        backgroundColor: COLORS.card, 
        borderRadius: cardRadius, 
        padding: "10px 12px", 
        marginBottom: 12, 
        boxShadow: cardShadow
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Search icon/expanded input */}
          {searchExpanded ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <input 
                type="text" 
                placeholder="Search..." 
                value={search} 
                onChange={e => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchExpanded(false); }}
                autoFocus
                style={{ 
                  ...inputStyle, 
                  width: 120,
                  padding: "8px 12px", 
                  borderRadius: 50, 
                  border: `2px solid ${COLORS.primary}`,
                  backgroundColor: COLORS.inputBg, 
                  fontSize: 13, 
                  outline: "none" 
                }} 
              />
              <button
                onClick={() => { setSearch(""); setSearchExpanded(false); }}
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  border: "none", backgroundColor: COLORS.cardAlt,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
                }}
              >
                <X size={14} color={COLORS.textMuted} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchExpanded(true)}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: "none", backgroundColor: COLORS.cardAlt,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0
              }}
            >
              <Search size={14} color={COLORS.textMuted} />
            </button>
          )}
          
          {/* Left scroll arrow */}
          <button
            onClick={() => {
              const container = document.getElementById("filter-chips-scroll");
              if (container) container.scrollBy({ left: -150, behavior: "smooth" });
            }}
            style={{
              width: 28, height: 28, borderRadius: "50%",
              border: "none", backgroundColor: COLORS.cardAlt,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}
          >
            <ChevronRight size={14} color={COLORS.textMuted} style={{ transform: "rotate(180deg)" }} />
          </button>
          
          {/* Scrollable filter chips */}
          <div 
            id="filter-chips-scroll"
            style={{ 
              display: "flex", 
              gap: 6, 
              alignItems: "center",
              overflowX: "auto",
              flex: 1,
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              padding: "2px 0"
            }}
          >
            {/* Quick filter chips */}
          {QUICK_FILTERS.map(filter => {
            const isActive = quickFilter === filter.id;
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const count = filter.id === "all" 
              ? reminders.filter(r => !r.completed || isVisibleCompleted(r)).length
              : filter.id === "urgent" 
                ? reminders.filter(r => (!r.completed || isVisibleCompleted(r)) && r.priority === "urgent").length
              : filter.id === "today"
                ? reminders.filter(r => (!r.completed || isVisibleCompleted(r)) && r.dueDate === todayStr).length
              : filter.id === "overdue"
                ? reminders.filter(r => isOverdue(r)).length
              : filter.id === "completed"
                ? reminders.filter(r => r.completed && !isVisibleCompleted(r)).length
              : reminders.filter(r => (!r.completed || isVisibleCompleted(r)) && r.category === filter.id).length;
            
            return (
              <button
                key={filter.id}
                onClick={() => setQuickFilter(filter.id as any)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 50,
                  border: isActive ? `2px solid ${filter.color}` : "2px solid transparent",
                  backgroundColor: isActive ? filter.bg : COLORS.cardAlt,
                  color: isActive ? filter.color : COLORS.textSecondary,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  transition: "all 0.2s"
                }}
              >
                <span style={{ fontSize: 14 }}>{filter.emoji}</span>
                {filter.label}
                {count > 0 && (
                  <span style={{ 
                    fontSize: 11, 
                    backgroundColor: isActive ? filter.color : COLORS.textMuted,
                    color: "#fff",
                    padding: "2px 6px",
                    borderRadius: 50,
                    minWidth: 18,
                    textAlign: "center"
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          </div>
          
          {/* Right scroll arrow */}
          <button
            onClick={() => {
              const container = document.getElementById("filter-chips-scroll");
              if (container) container.scrollBy({ left: 150, behavior: "smooth" });
            }}
            style={{
              width: 28, height: 28, borderRadius: "50%",
              border: "none", backgroundColor: COLORS.cardAlt,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}
          >
            <ChevronRight size={14} color={COLORS.textMuted} />
          </button>
        </div>
      </div>
      
      {/* Reminder List - Time-based sections OR Completed list */}
      {quickFilter === "completed" ? (
        // Show completed items list
        filtered.length === 0 ? (
          <div style={{ backgroundColor: COLORS.card, borderRadius: cardRadius, boxShadow: cardShadow, textAlign: "center", padding: 48, color: COLORS.textMuted }}>
            <div style={{ 
              width: 64, height: 64, borderRadius: "50%", 
              backgroundColor: COLORS.iconBg, 
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px"
            }}>
              <Check size={28} color={COLORS.textMuted} />
            </div>
            <p style={{ fontSize: 16, margin: 0, fontWeight: 500, color: COLORS.textMain }}>No completed reminders</p>
            <p style={{ fontSize: 14, marginTop: 6, color: COLORS.textMuted }}>Complete some tasks to see them here!</p>
          </div>
        ) : (
          <div style={{ backgroundColor: COLORS.card, borderRadius: cardRadius, boxShadow: cardShadow, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", backgroundColor: COLORS.cardAlt, borderBottom: `1px solid ${COLORS.border}` }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.success }}>✅ Completed ({filtered.length})</span>
            </div>
            {filtered.map((r, i) => (
              <div key={r.id} style={{ 
                padding: "12px 16px", 
                borderBottom: i < filtered.length - 1 ? `1px solid ${COLORS.border}` : "none",
                backgroundColor: COLORS.card,
                opacity: 0.7
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button 
                    onClick={() => uncomplete(r)} 
                    style={{ 
                      width: 24, height: 24, borderRadius: "50%", 
                      border: `2px solid ${COLORS.success}`, 
                      backgroundColor: COLORS.success, 
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 
                    }}
                  >
                    <Check size={12} color="#fff" />
                  </button>
                  <span style={{ fontSize: 18, opacity: 0.5 }}>
                    {QUICK_FILTERS.find(f => f.id === r.category)?.emoji || "📌"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontSize: 14, fontWeight: 500, color: COLORS.textMuted,
                      textDecoration: "line-through"
                    }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                      Completed {r.completedAt ? new Date(r.completedAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                  <button 
                    onClick={() => del(r.id)} 
                    style={{ 
                      width: 28, height: 28, borderRadius: "50%", border: "none", 
                      backgroundColor: `${COLORS.danger}10`, 
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" 
                    }}
                  >
                    <Trash2 size={12} color={COLORS.danger} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filtered.filter(r => !r.completed || isVisibleCompleted(r)).length === 0 ? (
        <div style={{ backgroundColor: COLORS.card, borderRadius: cardRadius, boxShadow: cardShadow, textAlign: "center", padding: 48, color: COLORS.textMuted }}>
          <div style={{ 
            width: 64, height: 64, borderRadius: "50%", 
            backgroundColor: COLORS.iconBg, 
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px"
          }}>
            <Bell size={28} color={COLORS.textMuted} />
          </div>
          <p style={{ fontSize: 16, margin: 0, fontWeight: 500, color: COLORS.textMain }}>
            {quickFilter === "all" ? "No reminders yet" : `No ${quickFilter} reminders`}
          </p>
          <p style={{ fontSize: 14, marginTop: 6, color: COLORS.textMuted }}>
            {quickFilter === "all" ? "Type above to create your first one!" : "Try a different filter"}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sectionOrder.map(sectionKey => {
            const sectionReminders = groupedByTime[sectionKey];
            if (sectionReminders.length === 0) return null;
            
            const config = SECTION_CONFIG[sectionKey];
            const isCollapsed = collapsedSections.has(sectionKey);
            
            return (
              <div key={sectionKey} style={{ backgroundColor: COLORS.card, borderRadius: cardRadius, boxShadow: cardShadow, overflow: "hidden" }}>
                {/* Section Header - Clickable to collapse */}
                <button
                  onClick={() => {
                    setCollapsedSections(prev => {
                      const next = new Set(prev);
                      if (next.has(sectionKey)) next.delete(sectionKey);
                      else next.add(sectionKey);
                      return next;
                    });
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    backgroundColor: sectionKey === "overdue" ? `${config.color}10` : COLORS.cardAlt,
                    border: "none",
                    cursor: "pointer",
                    borderBottom: isCollapsed ? "none" : `1px solid ${COLORS.border}`
                  }}
                >
                  <span style={{ fontSize: 16 }}>{config.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: config.color }}>{config.label}</span>
                  <span style={{ 
                    fontSize: 12, 
                    backgroundColor: config.color,
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 50,
                    marginLeft: 4
                  }}>
                    {sectionReminders.length}
                  </span>
                  <ChevronRight 
                    size={16} 
                    color={COLORS.textMuted} 
                    style={{ 
                      marginLeft: "auto", 
                      transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                      transition: "transform 0.2s"
                    }} 
                  />
                </button>
                
                {/* Section Items */}
                {!isCollapsed && sectionReminders.map((r, i) => {
                  // Check if task is new and should highlight (5 seconds after creation)
                  const shouldHighlight = r.createdAt && (Date.now() - new Date(r.createdAt).getTime()) < 5000;
                  
                  return (
                  <div 
                    key={r.id} 
                    style={{ 
                    padding: "12px 16px", 
                    borderBottom: i < sectionReminders.length - 1 ? `1px solid ${COLORS.border}` : "none",
                    backgroundColor: shouldHighlight ? COLORS.primaryBg : (r.completed ? COLORS.cardAlt : COLORS.card),
                    opacity: r.completed ? 0.7 : 1,
                    transition: "background-color 1s ease-out"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* Compact checkbox */}
                      <button 
                        onClick={() => r.completed ? uncomplete(r) : complete(r)} 
                        style={{ 
                          width: 24, height: 24, borderRadius: "50%", 
                          border: `2px solid ${r.completed ? COLORS.success : COLORS.border}`, 
                          backgroundColor: r.completed ? COLORS.success : "transparent", 
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 
                        }}
                      >
                        {r.completed && <Check size={12} color="#fff" />}
                      </button>
                      
                      {/* Category emoji instead of icon for compactness */}
                      <span style={{ fontSize: 18, opacity: r.completed ? 0.5 : 1 }}>
                        {QUICK_FILTERS.find(f => f.id === r.category)?.emoji || "📌"}
                      </span>
                      
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          fontSize: 14, 
                          fontWeight: 500, 
                          color: r.completed ? COLORS.textMuted : COLORS.textMain,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          textDecoration: r.completed ? "line-through" : "none"
                        }}>
                          {r.title}
                        </div>
                        <div style={{ 
                          fontSize: 12, 
                          color: sectionKey === "overdue" ? COLORS.danger : COLORS.textMuted, 
                          marginTop: 2,
                          display: "flex",
                          alignItems: "center",
                          gap: 6
                        }}>
                          {r.dueTime && <span>{formatTime(r.dueTime)}</span>}
                          {r.priority !== "medium" && (
                            <span style={{ 
                              padding: "1px 6px", 
                              borderRadius: 50, 
                              fontSize: 10, 
                              backgroundColor: `${PRIORITY_COLORS[r.priority]}20`, 
                              color: PRIORITY_COLORS[r.priority],
                              textTransform: "capitalize"
                            }}>
                              {r.priority}
                            </span>
                          )}
                          {r.recurrence !== "none" && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                              <Repeat size={10} color={COLORS.primary} />
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Compact action buttons */}
                      <div style={{ display: "flex", gap: 4 }}>
                        <button 
                          onClick={() => setEditing(r)} 
                          style={{ 
                            width: 28, height: 28, borderRadius: "50%", border: "none", 
                            backgroundColor: COLORS.inputBg, 
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" 
                          }}
                        >
                          <Edit2 size={12} color={COLORS.textMuted} />
                        </button>
                        <button 
                          onClick={() => del(r.id)} 
                          style={{ 
                            width: 28, height: 28, borderRadius: "50%", border: "none", 
                            backgroundColor: `${COLORS.danger}10`, 
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" 
                          }}
                        >
                          <Trash2 size={12} color={COLORS.danger} />
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      
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
          <div style={{ backgroundColor: COLORS.card, borderRadius: 24, width: "100%", maxWidth: 520, padding: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.textMain }}>Import from AI</h2>
              <button onClick={() => setImportOpen(false)} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={18} color={COLORS.textMuted} /></button>
            </div>
            
            <p style={{ margin: "0 0 16px", fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
              Ask ChatGPT to <b>"generate a study plan as an ICS code block"</b>, OR just paste a list of tasks directly here (e.g. "Buy milk tomorrow").
            </p>

            {/* Magic Paste Area */}
            <div style={{ position: "relative", marginBottom: 20 }}>
              <textarea
                placeholder={`BEGIN:VCALENDAR
BEGIN:VEVENT
...
OR just paste a list:
- Buy milk tomorrow
- Call mom at 5pm
- Submit report next Friday`}
                style={{
                  width: "100%",
                  height: 160,
                  padding: 16,
                  borderRadius: 16,
                  border: `2px solid ${COLORS.border}`,
                  backgroundColor: COLORS.inputBg,
                  fontSize: 13,
                  fontFamily: "monospace",
                  resize: "none",
                  outline: "none",
                  ...inputStyle
                }}
                onChange={(e) => {
                  const content = e.target.value;
                  if (content.length > 10) {
                    // Auto-detect and parse
                    let count = 0;
                    if (content.includes("BEGIN:VCALENDAR")) {
                      count = parseICS(content).length;
                    } else if (content.includes(",") && content.split("\n")[0].includes(",")) {
                      count = parseCSV(content).length;
                    } else {
                      // Count non-empty lines for natural language
                      count = content.split(/\r\n|\n|\r/).filter(l => l.trim().length > 2).length;
                    }
                    
                    if (count > 0) {
                      setToast(`Ready to import ${count} tasks...`);
                    }
                  }
                }}
                id="magic-paste"
              />
              <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", gap: 8 }}>
                 <button
                  onClick={() => {
                    const content = (document.getElementById("magic-paste") as HTMLTextAreaElement).value;
                    let imported: Partial<Reminder>[] = [];
                    
                    if (content.includes("BEGIN:VCALENDAR")) {
                      imported = parseICS(content);
                    } else if (content.includes(",") && content.split("\n")[0].includes(",")) {
                      imported = parseCSV(content);
                    } else {
                      // Bulk Natural Language parsing
                      const lines = content.split(/\r\n|\n|\r/).filter(l => l.trim().length > 2);
                      imported = lines.map(line => {
                        // Remove bullet points if present
                        const cleanLine = line.replace(/^[-*•]\s*/, "").trim();
                        const parsed = parseNaturalLanguage(cleanLine);
                        
                        // Map ParsedReminder to Reminder structure
                        return {
                          title: parsed.title,
                          dueDate: parsed.dueDate,
                          dueTime: parsed.dueTime,
                          priority: parsed.priority,
                          category: parsed.category,
                          recurrence: parsed.recurrence,
                          recurrenceInterval: parsed.recurrenceInterval,
                          recurrenceUnit: parsed.recurrenceUnit,
                          completed: false,
                          pointsAwarded: 0
                        };
                      });
                    }
                    
                    if (imported.length === 0) {
                      setToast("Could not recognize format.");
                      return;
                    }
                    
                    const newReminders: Reminder[] = imported.map(p => ({
                      id: generateId(),
                      title: p.title || "Untitled",
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
                  }}
                  style={{
                    padding: "8px 16px", borderRadius: 50,
                    backgroundColor: COLORS.primary, color: "#fff",
                    border: "none", cursor: "pointer",
                    fontSize: 13, fontWeight: 600,
                    boxShadow: "0 4px 12px rgba(45,90,61,0.2)"
                  }}
                >
                  Import Text
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", opacity: 0.6 }}>
              <div style={{ height: 1, backgroundColor: COLORS.border, flex: 1 }} />
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>OR DROP FILE</span>
              <div style={{ height: 1, backgroundColor: COLORS.border, flex: 1 }} />
            </div>
            
            <div 
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
              onDrop={handleFileUpload}
              style={{
                border: `2px dashed ${dragActive ? COLORS.primary : COLORS.border}`,
                borderRadius: 16,
                backgroundColor: dragActive ? `${COLORS.primary}10` : COLORS.cardAlt,
                padding: 20,
                textAlign: "center",
                transition: "all 0.2s ease",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12
              }}
            >
              <Upload size={20} color={COLORS.textMuted} />
              <span style={{ fontSize: 13, color: COLORS.textSecondary, fontWeight: 500 }}>
                {dragActive ? "Drop file now" : "Upload .ics or .csv file"}
              </span>
              <input 
                type="file" 
                accept=".ics,.icl,.csv" 
                onChange={handleFileUpload}
                style={{ position: "absolute", width: "100%", height: "100%", opacity: 0, cursor: "pointer", display: "none" }}
                id="file-upload-input"
              />
              <label htmlFor="file-upload-input" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, cursor: "pointer" }} />
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Import Modal */}
      {screenshotModal.open && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
          <div style={{ backgroundColor: COLORS.card, borderRadius: 24, width: "100%", maxWidth: 560, padding: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: COLORS.textMain }}>
                📸 Import from Screenshot
              </h2>
              <button 
                onClick={() => setScreenshotModal({ open: false, imageData: null, analyzing: false, progress: 0 })} 
                style={{ width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: COLORS.inputBg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <X size={18} color={COLORS.textMuted} />
              </button>
            </div>
            
            {/* Analyzing State */}
            {screenshotModal.analyzing ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textMain, marginBottom: 12 }}>
                  Analyzing screenshot...
                </div>
                <div style={{ 
                  width: "100%", 
                  height: 8, 
                  backgroundColor: COLORS.border, 
                  borderRadius: 4,
                  overflow: "hidden",
                  marginBottom: 8
                }}>
                  <div style={{
                    width: `${screenshotModal.progress}%`,
                    height: "100%",
                    backgroundColor: COLORS.primary,
                    transition: "width 0.3s ease"
                  }} />
                </div>
                <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                  {screenshotModal.progress}% complete
                </div>
              </div>
            ) : (
              <>
                {/* Drag & Drop Zone */}
                <div
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleScreenshotUpload(file);
                  }}
                  style={{
                    border: `2px dashed ${COLORS.primary}`,
                    borderRadius: 16,
                    backgroundColor: `${COLORS.primary}08`,
                    padding: 40,
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  onClick={() => document.getElementById("screenshot-file-input")?.click()}
                >
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textMain, marginBottom: 8 }}>
                    Drop screenshot here
                  </div>
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 16 }}>
                    or click to browse
                  </div>
                  <div style={{ 
                    display: "inline-block",
                    padding: "10px 20px", 
                    backgroundColor: COLORS.primary, 
                    color: "#fff", 
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600
                  }}>
                    Upload Screenshot
                  </div>
                  <input
                    id="screenshot-file-input"
                    type="file"
                    accept="image/*"
                    onChange={handleScreenshotUpload}
                    style={{ display: "none" }}
                  />
                </div>
                
                <div style={{ fontSize: 12, color: COLORS.textMuted, textAlign: "center", marginTop: 16 }}>
                  Tasks will be automatically extracted and added to your list
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div style={{ 
        marginTop: 24, 
        padding: 20, 
        backgroundColor: COLORS.card, 
        borderRadius: cardRadius, 
        boxShadow: cardShadow 
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textMain, marginBottom: 12 }}>Quick Actions</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {/* Screenshot Upload - Opens Modal */}
          <button
            onClick={() => setScreenshotModal({ open: true, imageData: null, analyzing: false, progress: 0 })}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 16px", borderRadius: 50,
              backgroundColor: COLORS.cardAlt, color: COLORS.textMain,
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              border: `1px solid ${COLORS.border}`,
              transition: "all 0.2s"
            }}
          >
            <Camera size={16} color={COLORS.primary} />
            📸 AI Screenshot Import
          </button>
          
          {/* Generate 40 Reminders */}
          <button
            onClick={generate40Reminders}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 16px", borderRadius: 50,
              backgroundColor: COLORS.cardAlt, color: COLORS.textMain,
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              border: `1px solid ${COLORS.border}`,
              transition: "all 0.2s"
            }}
          >
            <Wand2 size={16} color={COLORS.primary} />
            Generate 40 Reminders
          </button>
        </div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 10 }}>
          📸 Upload a screenshot of your existing reminders to import them instantly
        </div>
      </div>

      {/* Footer Buttons */}
      <div style={{ 
        marginTop: 16, 
        padding: "14px 20px", 
        backgroundColor: COLORS.card, 
        borderRadius: cardRadius, 
        boxShadow: cardShadow,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        justifyContent: "center"
      }}>
        <button
          onClick={() => window.print()}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 50,
            backgroundColor: COLORS.cardAlt, color: COLORS.textSecondary,
            fontSize: 13, fontWeight: 500, cursor: "pointer",
            border: `1px solid ${COLORS.border}`
          }}
        >
          🖨️ Print
        </button>
        <button
          onClick={resetProgress}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 50,
            backgroundColor: COLORS.cardAlt, color: COLORS.textSecondary,
            fontSize: 13, fontWeight: 500, cursor: "pointer",
            border: `1px solid ${COLORS.border}`
          }}
        >
          🔄 Reset
        </button>
        <button
          onClick={() => window.open("https://buymeacoffee.com/jhteplitsky", "_blank")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 50,
            backgroundColor: "#FFDD00", color: "#000",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            border: "none"
          }}
        >
          ☕ Donate
        </button>
        <button
          onClick={() => window.open("mailto:jonathan@teplitsky.com?subject=Reminder%20App%20Feedback", "_blank")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderRadius: 50,
            backgroundColor: COLORS.cardAlt, color: COLORS.textSecondary,
            fontSize: 13, fontWeight: 500, cursor: "pointer",
            border: `1px solid ${COLORS.border}`
          }}
        >
          💬 Feedback
        </button>
      </div>

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
