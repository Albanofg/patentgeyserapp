# Patent Geyser V1

## Overview
Patent Geyser V1 specializes in software, SaaS, and blockchain inventions — utility patents only, not design patents. It is a web application designed to assist inventors in drafting provisional patent applications. Its core purpose is to guide users through a structured workflow to create draft applications suitable for USPTO filing or attorney review.

## User Preferences
Preferred communication style: Simple, everyday language.

## How It Works
Patent Geyser uses n8n as its AI orchestration layer. Each module sends structured data to n8n webhooks, which process the information through AI workflows and return enriched results. This back-and-forth happens at every stage — user input goes to n8n, AI processes and responds, and the user reviews before proceeding to the next module.

### Module 1 - Intake & Screening
- User submits invention idea with optional source code
- n8n webhook triggers Advocate/Examiner AI debate
- Advocate highlights strengths; Examiner challenges weaknesses
- Re-analysis sends data back to n8n for additional AI review
- "Inspect & Refine" extracts individual ideas via n8n for user approval

### Module 2 - Concept Refinement
- 2a: Core concept sent to n8n for AI expansion
- 2b: n8n extracts patentable ideas; user selects which to pursue

### Module 3 - Prior Art Research
- Selected concepts sent to n8n for detailed prior art search
- AI returns existing patents and publications grouped by concept

### Module 4 - White Space & Provisional Draft
- 4a: n8n analyzes constraints, white space, and differentiation strategies
- 4b: n8n generates multiple claim variations; user selects preferred claims
- 4c: Selected claims sent to n8n to compile full provisional specification
- 4-Pannu (optional): n8n helps validate inventorship under USPTO criteria

### Module 5 - The Showcase
- Provisional spec and claims sent to n8n → Eraser.io for technical diagrams
- User can generate broader claims (another n8n round-trip)
- Compare specific vs. broad claims and select preferred set
- Export final draft as PDF/DOCX for USPTO filing

## System Architecture

### Frontend
The frontend is built with React 18, TypeScript, and Vite. It uses Wouter for routing, TanStack Query for server state management, and Shadcn/UI (based on Radix UI) for components. A sequential navigation system enforces workflow progression. A custom design system using DM Sans (UI) and IBM Plex Mono (code/monospace) fonts provides distinct visual personalities for each agent stage. State management relies on session-based authentication via cookies and server-driven project state synchronized through TanStack Query.

### Backend
The backend utilizes Node.js with Express.js and TypeScript, providing a RESTful API. Session-based authentication is managed with `express-session` and a PostgreSQL session store, with bcrypt for password hashing.

### Data Storage
Drizzle ORM with a PostgreSQL dialect (Neon serverless adapter) is used for data management. The database schema includes `users`, `projects`, `agent_data` (for flexible JSONB agent output), `idea_snapshots` (to track idea evolution across stages), and `pannu_records`.

## External Dependencies

### Third-Party Services
*   **n8n:** AI orchestration and workflow automation platform. Used for all AI agent processing, including brainstorming, idea modification, prior art search, white space analysis, claims writing, provisional drafting, Pannu test assistance, diagram generation, and broader claims generation. All webhooks include `sessionId` for continuity.
*   **Eraser.io:** Integrated for generating technical diagrams (flowcharts, system diagrams) based on the provisional specification.
*   **Google Fonts CDN:** For IBM Plex Sans and IBM Plex Mono fonts.

### Key Libraries
*   `@neondatabase/serverless`: PostgreSQL connectivity.
*   `drizzle-orm`, `drizzle-kit`, `drizzle-zod`: ORM for database interaction.
*   `@radix-ui/*`: Accessible UI component primitives.
*   `react-hook-form`, `@hookform/resolvers`: Form validation.
*   `connect-pg-simple`: PostgreSQL session storage.
*   `date-fns`: Date utilities.