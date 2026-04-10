# Patent Geyser V1 - Design Guidelines

## Design Approach

**Selected System:** Carbon Design System principles with customized agent personalities

**Rationale:** Enterprise-grade design system optimized for data-heavy, professional applications. Provides consistency while allowing distinct visual personalities for each agent stage.

**Core Principle:** Five distinct agent experiences unified by consistent spacing, typography hierarchy, and interaction patterns - each agent has unique layout personality while maintaining professional cohesion.

---

## Typography System

**Font Stack:**
- Primary: IBM Plex Sans (via Google Fonts CDN)
- Monospace: IBM Plex Mono (for patent numbers, code snippets)

**Hierarchy:**
- Hero/Stage Titles: text-4xl font-bold (Agent introductions)
- Section Headers: text-2xl font-semibold
- Subsections: text-xl font-medium
- Body Text: text-base font-normal
- Labels/Metadata: text-sm font-medium
- Captions/Helper: text-xs

**Line Heights:**
- Headings: leading-tight
- Body content: leading-relaxed
- Forms/UI: leading-normal

---

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16
- Micro spacing (gaps, padding): 2, 4
- Component spacing: 6, 8
- Section spacing: 12, 16

**Container Strategy:**
- Dashboard/Lists: max-w-7xl mx-auto
- Document views: max-w-4xl mx-auto
- Forms: max-w-2xl mx-auto
- Full-width data tables: w-full with inner max-w-7xl

**Grid Patterns:**
- Dashboard: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Comparison views: grid-cols-1 lg:grid-cols-2
- Forms: Single column stack

---

## Agent-Specific Visual Personalities

### Agent 1 - "The Interview" (Conversational & Welcoming)
- **Layout:** Centered, single-column progression with max-w-2xl
- **Components:** Large form fields with generous padding (p-4), conversational prompts above each input
- **Unique Element:** Progress indicator showing 5-7 steps
- **Card Style:** Soft rounded-lg with border
- **Button Position:** Bottom-right sticky "Continue to Refinement"

### Agent 2 - "The Workshop" (Document Editor Feel)
- **Layout:** Two-column split (lg:grid-cols-2) - Draft spec left, context right
- **Components:** Editable text areas with toolbar-like headers, collapsible sections
- **Unique Element:** Side-by-side comparison panels with connecting arrows
- **Card Style:** Minimal borders, emphasis on content blocks
- **Button Position:** Top-right "Deep Prior Art Search"

### Agent 3 - "The Research Library" (Database/Search Interface)
- **Layout:** Table-dominant with filters sidebar (lg:grid-cols-[250px_1fr])
- **Components:** Searchable data table, filter chips, patent card grid (when not table view)
- **Unique Element:** Toggle between list/grid views, flag/bookmark icons on each result
- **Card Style:** Dense information cards with patent metadata
- **Button Position:** Floating bottom-right "Analyze White Space"

### Agent 4 - "The Strategy Room" (Executive Dashboard)
- **Layout:** Full-width comparison view with before/after columns
- **Components:** Diff-style highlighting, improvement metrics cards (grid-cols-3)
- **Unique Element:** Impact indicators (badges showing "New claims added", "Improved clarity")
- **Card Style:** Professional bordered cards with header ribbons
- **Button Position:** Center bottom "Generate Diagrams"

### Agent 5 - "The Showcase" (Polished Portfolio)
- **Layout:** Magazine-style with large preview areas
- **Components:** Document preview with zoom, diagram gallery (masonry or grid)
- **Unique Element:** Download buttons per section, final export CTA hero
- **Card Style:** Elevated shadows, polished frames around diagrams
- **Button Position:** Prominent center "Export Complete Draft" + "Complete Project"

---

## Core Component Library

### Navigation
- **Dashboard Header:** Logo left, user menu right, project search center
- **Agent Header:** Breadcrumb navigation (Dashboard > Project Name > Agent 3), agent name/description, progress bar (1 of 5)
- **Back Navigation:** Clear "← Previous Agent" link when applicable

### Forms & Inputs
- **Text Inputs:** border rounded px-4 py-3, focus:ring-2 focus:ring-offset-2
- **Textareas:** min-h-32 for short, min-h-64 for specifications
- **Dropdowns:** Custom styled select with chevron icon (Heroicons)
- **Radio/Checkbox:** Large click targets (h-5 w-5) with labels

### Data Display
- **Patent Cards:** Include patent number, title, filing date, relevance score, flag button
- **Specification Sections:** Collapsible accordion with section numbers
- **Comparison Blocks:** Side-by-side with visual diff highlighting (background treatments)
- **Metadata Labels:** Inline badges for status, category, stage

### Interactive Elements
- **Primary Buttons:** Large px-8 py-4 rounded-lg font-semibold with clear hierarchy
- **Secondary Buttons:** Outlined variant px-6 py-3
- **Icon Buttons:** Square h-10 w-10 for actions (edit, delete, download)
- **Loading States:** Spinner with "Processing with n8n..." message, progress bar if available

### Feedback & Status
- **Toast Notifications:** Top-right slide-in for saves, errors, confirmations
- **Auto-save Indicator:** Subtle "Saved 2 minutes ago" in form headers
- **Error States:** Inline validation below fields, summary banner at top
- **Empty States:** Illustration + helpful text when no projects/results

### Diagrams & Visuals
- **Diagram Display:** max-w-full with zoom modal on click
- **Diagram Grid:** grid-cols-1 md:grid-cols-2 gap-8 for multiple diagrams
- **Download Buttons:** Per-diagram "Download SVG/PNG" + "Download All"

---

## Interaction Patterns

**Sequential Flow:**
- Each agent transition shows brief loading screen with agent personality preview
- Clear "You're entering [Agent Name]" transition card
- Confirmation modals before moving forward if user has unsaved edits

**Auto-save:**
- Debounced save every 2 seconds on text input
- Visual feedback on save (checkmark icon fade-in)
- Last saved timestamp always visible

**Approval Flow:**
- Review checklist or summary before each transition button
- "Are you ready to move to [Next Agent]?" with preview of what happens next

---

## Icons
**Library:** Heroicons (via CDN)
**Common Icons:** 
- DocumentTextIcon (specifications)
- MagnifyingGlassIcon (prior art search)
- ChartBarIcon (analysis)
- PhotoIcon (diagrams)
- ArrowDownTrayIcon (downloads)

---

## Accessibility
- Form inputs: Proper label associations, aria-required, error announcements
- Focus indicators: Consistent 2px ring on all interactive elements
- Keyboard navigation: Tab order follows visual flow, skip links on agent headers
- ARIA landmarks: main, navigation, complementary for sidebars
- Loading states: aria-live regions for n8n processing updates