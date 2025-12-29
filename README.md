# Smart Reminders - ChatGPT MCP Connector

A Model Context Protocol (MCP) server that provides an AI-powered reminder app widget for ChatGPT. Features natural language processing, gamification, and smart notifications.

**[Privacy Policy](PRIVACY.md)** | **[OpenAI Apps SDK](https://developers.openai.com/apps-sdk)**

## Features

- 🧠 Natural language task creation ("Call mom tomorrow at 5pm")
- 🎮 Gamification with points, levels, streaks, and achievements
- 📸 Screenshot import with OCR - upload a photo of your tasks
- 🔄 Recurring reminders (daily, weekly, monthly, custom)
- 📊 Progress tracking and analytics
- ✅ Smart categorization (work, family, health, errands, etc.)
- 🖨️ Print-friendly output

## Task Categories

1. **Work** - Professional tasks and deadlines
2. **Family** - Family-related reminders
3. **Health** - Medical appointments and wellness
4. **Errands** - Shopping and daily tasks
5. **Finance** - Bills and financial tasks
6. **Social** - Events and social commitments
7. **Learning** - Educational goals
8. **Travel** - Trip planning and bookings

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
pnpm install
```

### Build the Widget

```bash
pnpm run build
```

### Run Locally

```bash
pnpm start
```

Server runs on `http://localhost:8000`. **Note:** HTTP endpoints are for local development only.

### Deploy to Render.com

1. Push this repo to GitHub
2. Connect to Render.com
3. Create new Web Service from this repo
4. Render will auto-detect `render.yaml` and deploy

## How to Use in ChatGPT

1. Open ChatGPT in **Developer Mode**
2. Add MCP Connector with your deployed URL
3. Say: **"Show me my reminders"** or **"Add a reminder"**
4. The interactive widget appears!

### Example Prompts

- "Remind me to call mom tomorrow at 5pm"
- "Add: Buy groceries, Pay rent Friday, Schedule dentist"
- "Show my reminders for this week"
- "Create a daily reminder to take vitamins"
- "What tasks do I have today?"

## Tech Stack

- **MCP SDK** - Model Context Protocol for ChatGPT integration
- **Node.js + TypeScript** - Server runtime
- **Server-Sent Events (SSE)** - Real-time communication
- **React** - Widget UI components
- **Lucide Icons** - Beautiful icons

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
BUTTONDOWN_API_KEY=your_api_key
ANALYTICS_PASSWORD=your_password
```

## Privacy & Data Use

- **What we collect:** When the widget runs inside ChatGPT we receive the location (city/region/country), locale, and device/browser fingerprint via `_meta`.
- **How we use it:** These fields feed the `/analytics` dashboard only; we do not sell or share this data.
- **Retention:** Logs are stored for **30 days** in the `/logs` folder and then automatically rotated.
- **User input storage:** The widget caches your reminders in `localStorage`. Clear anytime with the "Reset" button.

## Monitoring & Alerts

- Visit `/analytics` (Basic Auth protected) to review the live dashboard.
- Alerts for tool failures and subscription issues are logged automatically.

## License

MIT
