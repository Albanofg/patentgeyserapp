# Patent Geyser - Complete Process Documentation

## Overview
Patent Geyser is a 5-module workflow system that helps inventors draft provisional patent applications for software, SaaS, and blockchain inventions (utility patents). It guides users through a structured process from initial idea to a complete patent-ready document suitable for USPTO filing or attorney review.

---

## MODULE 1: INTAKE & SCREENING (The Debate)

**Purpose:** Initial idea submission and AI-powered analysis to identify patentable aspects.

**How It Works:**
1. Idea Submission: User uploads source code or provides a text description of their invention
2. The Debate: Two AI personas analyze the idea:
   - The Advocate: Highlights strengths, potential, and patentable aspects
   - The Examiner: Identifies weaknesses, potential prior art concerns, and areas needing refinement
3. Inspect & Refine: After the debate, AI extracts individual patentable concepts/ideas from the submission
4. User Review: For each extracted idea, the user can:
   - Approve it as-is
   - Modify the wording or focus
   - Reject it entirely
5. Add Custom Ideas: Users can manually add their own ideas that weren't automatically extracted
6. Selection: User selects which approved ideas to carry forward to Module 2

**Key Outputs:** List of approved and refined patentable ideas

---

## MODULE 2: CONCEPT REFINEMENT (Expand & Select)

**Purpose:** AI expands approved ideas into full patentable concepts with technical depth.

**How It Works:**
1. Concept Expansion: AI takes each selected idea and expands it into a comprehensive patentable concept including:
   - Technical implementation details
   - Novel aspects and innovations
   - Potential applications and use cases
2. Patentability Analysis: Each expanded concept is analyzed for:
   - Novelty (is it new?)
   - Non-obviousness (would it be obvious to someone skilled in the field?)
   - Utility (does it have practical application?)
3. User Selection: User reviews all expanded concepts and selects which ones to pursue for prior art research

**Key Outputs:** Selected expanded concepts ready for prior art analysis

---

## MODULE 3: PRIOR ART RESEARCH (Patent Landscape)

**Purpose:** Analyze existing patents to understand the landscape and identify opportunities.

**How It Works:**
1. Semantic Patent Search: AI conducts intelligent patent matching based on the selected concepts
2. Grouping: Results are organized by relevance and similarity to your invention
3. Analysis: For each prior art result, the system identifies:
   - How similar it is to your concept
   - Key claims and coverage
   - Potential overlap concerns
4. Gap Identification: System begins identifying "white space" - areas where your invention could be positioned as novel

**Key Outputs:** Prior art findings organized by concept, with similarity analysis

---

## MODULE 4: WHITE SPACE & CLAIMS GENERATION

**Purpose:** Identify differentiation strategies and generate patent claims.

**How It Works:**
1. White Space Analysis (Nugget Analysis): 
   - AI analyzes prior art constraints
   - Identifies "white space" opportunities (gaps in existing patents)
   - Suggests differentiation strategies for each concept
2. Claims Generation: 
   - AI generates multiple claim variations (specific claims)
   - Claims are structured with independent claims and dependent claims
   - Each claim targets specific novel aspects identified in white space analysis
3. User Selection: User reviews claims and selects which ones to include
4. Provisional Specification Compilation: AI generates the complete provisional patent draft including:
   - TITLE: Descriptive title of the invention
   - BACKGROUND: Technical field and problem being solved
   - SUMMARY: Brief overview of the invention
   - DETAILED DESCRIPTION: Full technical explanation with embodiments
   - RAMIFICATIONS AND SCOPE: Variations and scope of protection
   - ABSTRACT: Concise summary for patent databases
   - CLAIMS: The legal protection statements

**Key Outputs:** Complete provisional patent specification with claims

---

## MODULE 5: THE SHOWCASE (Final Review & Export)

**Purpose:** Review, finalize, and export the provisional patent application.

**Features:**

### Summary Tab
- View the complete provisional specification
- All sections (Title, Background, Summary, Detailed Description, etc.)
- Read-only review of the full document

### Specific Claims Tab
- Review the generated specific claims from Module 4
- These are narrower, more detailed claims

### Broad Claims Tab
- Option to generate "broader claims" for comparison
- Broader claims provide wider protection but may be more vulnerable to prior art
- User can compare specific vs. broad claims and choose which to use in final export

### Technical Diagrams
- AI generates technical diagrams via Eraser.io including:
  - System architecture diagrams
  - Flowcharts showing process steps
  - Component interaction diagrams
- Diagrams are generated based on the provisional specification

### Re-Generate Options
- Re-Generate Diagrams: Create new diagrams without affecting claims
- Re-Generate Broader Claims: Get new broader claims without affecting diagrams

### Export Options
- PDF Export: Professional PDF suitable for USPTO filing
- DOCX Export: Editable Word document for attorney review
- Exports include all sections, claims, and embedded diagrams

### Optional: Pannu Test
The Pannu Test helps validate inventorship under US patent law (35 U.S.C. 116). Each inventor must satisfy ALL three prongs:

1. Contribution to Conception: The person contributed to the conception of the invention
2. Contribution to at Least One Claim: The contribution appears in at least one claim
3. More Than Explanation of Known Concepts: The contribution goes beyond merely explaining well-known concepts

The Pannu Test assistant helps users answer questions about each inventor's contributions to ensure proper inventorship documentation.

---

## ADDITIONAL FEATURES

### Quick Prior Art Check
- Standalone tool accessible from the sidebar
- Search for prior art on any concept without going through the full workflow
- Useful for quick validation before starting a full project

### Q&A Assistant
- AI-powered chat assistant
- Can answer questions about the Patent Geyser process
- Has knowledge of the user's current project status and data
- Helps explain patent concepts and terminology

### Project Management
- Create multiple patent projects
- Each project tracks progress through all 5 modules
- Projects save all data including debates, concepts, claims, and drafts

---

## KEY PATENT TERMINOLOGY

- Provisional Patent Application: A preliminary patent filing that establishes an early filing date. Valid for 12 months, after which a full (non-provisional) application must be filed.
- Claims: Legal statements that define the scope of patent protection. The most important part of any patent.
- Independent Claim: A claim that stands alone and doesn't reference other claims.
- Dependent Claim: A claim that references and adds limitations to an independent claim.
- Prior Art: Any existing patents, publications, products, or public knowledge that existed before your filing date.
- White Space: Gaps in existing patent coverage where your invention can be positioned as novel.
- PHOSITA: "Person Having Ordinary Skill In The Art" - the hypothetical person used to evaluate obviousness.
- Novelty: The requirement that an invention must be new (not previously disclosed).
- Non-Obviousness: The requirement that an invention wouldn't be obvious to a PHOSITA.
- Utility: The requirement that an invention must have practical usefulness.
- USPTO: United States Patent and Trademark Office - the agency that grants patents.

---

## DATA FLOW SUMMARY

Module 1 (Intake) -> Approved Ideas -> Module 2 (Refinement) -> Selected Concepts -> Module 3 (Prior Art) -> Prior Art Findings -> Module 4 (White Space & Claims) -> Provisional Draft + Claims -> Module 5 (Showcase) -> Final Export (PDF/DOCX)
