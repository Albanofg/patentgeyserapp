import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface SelectedKeyConcept {
  type?: string; // "independent" or "dependent N"
  text?: string;
  number?: number;
  parentConcept?: number | null;
}

export interface ProvisionalPayload {
  sessionId?: string;
  category?: string;
  coreIdea?: string;
  mainIdea?: string;
  expandedConcept?: string;
  selectedKeyConcepts?: SelectedKeyConcept[];
}

interface KeyConceptGroup {
  independent: string;
  dependents: string[];
}

interface ParsedInput {
  sessionId: string;
  category: string;
  coreIdea: string;
  expandedConcept: string;
  keyConceptGroups: KeyConceptGroup[];
  keyConceptsText: string;
  totalKeyConcepts: number;
}

interface Sections {
  title?: string;
  background?: string;
  summary?: string;
  architecture?: string;
  data_structures?: string;
  operations?: string;
  alternatives?: string;
  detailed_description?: string;
  ramifications_and_scope?: string;
  abstract?: string;
}

// --- Payload Parser (ported from n8n "Payload Parser1" node) ---
function parsePayload(payload: ProvisionalPayload): ParsedInput {
  const sessionId = payload.sessionId || "";
  const category = payload.category || "";
  const coreIdea = payload.coreIdea || payload.mainIdea || "";
  const expandedConcept = payload.expandedConcept || "";

  const keyConceptGroups: KeyConceptGroup[] = [];
  let currentIndependent: string | null = null;
  let dependents: string[] = [];

  if (Array.isArray(payload.selectedKeyConcepts)) {
    for (const concept of payload.selectedKeyConcepts) {
      if (concept.type === "independent") {
        if (currentIndependent != null) {
          keyConceptGroups.push({ independent: currentIndependent, dependents: dependents.slice() });
        }
        currentIndependent = concept.text || "";
        dependents = [];
      } else {
        dependents.push(concept.text || "");
      }
    }
    if (currentIndependent != null) {
      keyConceptGroups.push({ independent: currentIndependent, dependents: dependents.slice() });
    }
  }

  const keyConceptsText = keyConceptGroups
    .map(
      (g, i) =>
        `Primary Concept ${i + 1}:\n${g.independent}\n\nSupporting Concepts:\n${g.dependents.join("\n\n")}`,
    )
    .join("\n\n---\n\n");

  return {
    sessionId,
    category,
    coreIdea,
    expandedConcept,
    keyConceptGroups,
    keyConceptsText,
    totalKeyConcepts: payload.selectedKeyConcepts?.length || 0,
  };
}

// --- Agent wrapper: loads config/prompt from disk and calls the model ---
async function runAgent(agentName: string, userMessage: string): Promise<string> {
  const config = loadAgentConfig(`module5/5a-provisional/${agentName}.config.json`);
  const systemPrompt = loadPrompt(`module5/5a-provisional/${agentName}.md`);
  const result = await callAgent({
    systemPrompt,
    userMessage,
    config,
    usage: { agentCode: `module5/5a-${agentName}` },
  });
  return (result || "").trim();
}

// --- Per-agent user prompts (ported verbatim from n8n workflow) ---

function titleUserPrompt(p: ParsedInput): string {
  return (
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `**EXPANDED CONCEPT:**\n${p.expandedConcept}\n\n` +
    `**KEY CONCEPTS:**\n${p.keyConceptsText}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: PATENT TITLE**\n\n` +
    `Draft the title for a provisional patent application that will appear on the USPTO filing.\n\n` +
    `**USPTO TITLE REQUIREMENTS:**\n` +
    `- Technically precise - identify the exact technical field\n` +
    `- Innovation clarity - state what the invention does\n` +
    `- Professional format - no marketing language, pure technical description\n` +
    `- Concise but complete - typically 10-15 words\n\n` +
    `**EXAMPLES OF EFFECTIVE TITLES:**\n` +
    `- "System and Method for Autonomous Multi-Application Workflow Synthesis via Observational Learning"\n` +
    `- "Apparatus for Real-Time Semantic Action Abstraction Across Heterogeneous Software Environments"\n` +
    `- "Cross-Platform Workflow Orchestration Using Behavioral Pattern Recognition"\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the title text. No explanations, no preamble, no markdown.`
  );
}

function backgroundUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `**EXPANDED CONCEPT:**\n${p.expandedConcept}\n\n` +
    `**KEY CONCEPTS:**\n${p.keyConceptsText}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: BACKGROUND SECTION**\n\n` +
    `The background section establishes why this invention is necessary by documenting the deficiencies in existing solutions. Patent examiners use this section to understand the problem space and evaluate novelty.\n\n` +
    `**REQUIRED CONTENT:**\n\n` +
    `**1. FIELD OF THE INVENTION**\n` +
    `State the precise technical domain - not just "software" but the specific area like "cross-application process automation using machine learning-based behavioral inference." Identify the specific industry problem space and establish technical context.\n\n` +
    `**2. DESCRIPTION OF RELATED ART**\n` +
    `Identify and analyze existing solution categories. For each category of prior art:\n` +
    `- Explain what it does technically\n` +
    `- Document its specific limitations and deficiencies  \n` +
    `- Explain why it fails to solve the problem adequately\n` +
    `- Identify technical gaps (e.g., "requires explicit user programming," "cannot infer cross-application workflows," "limited to predefined templates")\n\n` +
    `Consider these categories of prior art:\n` +
    `- Traditional RPA (Robotic Process Automation) tools\n` +
    `- Workflow automation platforms (Zapier, IFTTT, n8n, Make)\n` +
    `- Task recording/macro tools\n` +
    `- AI assistants and copilots\n` +
    `- Low-code/no-code platforms\n` +
    `- Script-based automation\n` +
    `- Enterprise integration platforms\n` +
    `- Any other relevant existing approaches\n\n` +
    `**3. TECHNICAL PROBLEMS WITH PRIOR ART**\n` +
    `Document specific technical deficiencies:\n` +
    `- Manual workflow design overhead\n` +
    `- Inability to discover implicit user patterns\n` +
    `- No cross-application behavioral learning\n` +
    `- Template-based limitations\n` +
    `- Lack of autonomous workflow synthesis\n` +
    `- No semantic action abstraction\n` +
    `- Inability to personalize without explicit configuration\n` +
    `- Poor handling of disparate application environments\n\n` +
    `For each problem, explain why it's technically significant and what failures or inefficiencies it causes.\n\n` +
    `**WRITING APPROACH:**\n` +
    `Be comprehensive and thorough. Use technical terminology. Build a clear case for why existing solutions are inadequate. Reference specific technical deficiencies, not marketing claims. Write in formal technical prose.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the background text. No section headers in the output, no markdown formatting.`
  );
}

function summaryUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**BACKGROUND SECTION (ALREADY WRITTEN):**\n${s.background}\n\n` +
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `**KEY CONCEPTS:**\n${p.keyConceptsText}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: SUMMARY SECTION**\n\n` +
    `The summary presents the solution to the problems documented in the background. This is where you explain what the invention IS and how it addresses the deficiencies in prior art.\n\n` +
    `**REQUIRED CONTENT:**\n\n` +
    `**1. INVENTION OVERVIEW**\n` +
    `State clearly what the invention is and its core technical approach. Explain how it fundamentally differs from the prior art discussed in the background.\n\n` +
    `**2. KEY INNOVATIONS**\n` +
    `Explain each major innovation component:\n` +
    `- **Autonomous discovery**: How the system learns by observation rather than programming\n` +
    `- **Semantic abstraction**: How it understands user intent from raw interactions\n` +
    `- **Cross-application synthesis**: How it chains actions across disparate tools\n` +
    `- **Personalization without configuration**: How it adapts to individual users\n` +
    `- **De novo workflow creation**: How it creates new automations rather than using templates\n\n` +
    `**3. TECHNICAL ADVANTAGES**\n` +
    `Explain the specific benefits and how they solve the problems identified in the background:\n` +
    `- Eliminates manual workflow design burden\n` +
    `- Discovers hidden efficiency opportunities\n` +
    `- Adapts to individual user patterns\n` +
    `- Handles heterogeneous application environments\n` +
    `- Creates truly personalized automations\n` +
    `- Reduces technical expertise requirements\n` +
    `- Continuously learns and refines workflows\n\n` +
    `**4. CONNECTION TO DETAILED DESCRIPTION**\n` +
    `Bridge to the upcoming detailed description by indicating that comprehensive technical specifications follow.\n\n` +
    `**WRITING APPROACH:**\n` +
    `Be confident and comprehensive. Focus on WHAT the invention does and WHY it's valuable, saving the detailed HOW for the next section. Make it clear this invention solves the problems documented in the background. Use technical but accessible language.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the summary text. No section headers in the output, no markdown formatting.`
  );
}

function architectureUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**SUMMARY:**\n${s.summary}\n\n` +
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `**EXPANDED CONCEPT:**\n${p.expandedConcept}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: SYSTEM ARCHITECTURE (Part 1 of Detailed Description)**\n\n` +
    `Document the complete system architecture with every component properly identified and described. This is the structural foundation that enables a PHOSITA to understand what needs to be built.\n\n` +
    `**COMPONENT INVENTORY WITH REFERENCE NUMERALS:**\n\n` +
    `Assign unique reference numerals to every component in the system. Use the format (100), (102), (104), etc.\n\n` +
    `Example components to identify and describe:\n` +
    `- Computing System (100)\n` +
    `- User Device (102)\n` +
    `- Interaction Monitoring Agent (104)\n` +
    `- Operating System Event Hook (106)\n` +
    `- Raw Interaction Data Repository (108)\n` +
    `- Secure Data Transmission Protocol (110)\n` +
    `- Backend Server Infrastructure (112)\n` +
    `- Action Abstraction and Normalization Service (114)\n` +
    `- Pattern Recognition Engine (116)\n` +
    `- Machine Learning Model (118)\n` +
    `- Workflow Discovery Engine (120)\n` +
    `- Workflow Synthesis Module (122)\n` +
    `- Synthesized Workflow Repository (124)\n` +
    `- Cross-Application Integration Layer (126)\n` +
    `- Application Connectors (128)\n` +
    `- Automation Execution Environment (130)\n` +
    `- Orchestration Engine (132)\n` +
    `- User Interface Module (134)\n` +
    `- [Continue with all necessary components]\n\n` +
    `**FOR EACH COMPONENT, DESCRIBE:**\n\n` +
    `**Structure - What is it made of?**\n` +
    `- Hardware components: Specify CPU, RAM, storage, network requirements\n` +
    `- Software components: Programming language, frameworks, libraries, dependencies\n` +
    `- Data components: Database type, schema structure, indexing strategy\n\n` +
    `**Location - Where does it exist?**\n` +
    `- On user's local device?\n` +
    `- On cloud server infrastructure?\n` +
    `- Edge compute location?\n` +
    `- Distributed across multiple locations?\n\n` +
    `**Connectivity - How does it connect?**\n` +
    `- What protocols does it use? (HTTP, WebSocket, gRPC, TCP, UDP)\n` +
    `- What APIs does it expose or consume?\n` +
    `- What message formats? (JSON, Protobuf, XML)\n` +
    `- Authentication and security mechanisms?\n\n` +
    `**Function - What does it do?**\n` +
    `- Input: What data or signals does it receive?\n` +
    `- Processing: What computations or transformations does it perform?\n` +
    `- Output: What does it produce or send?\n` +
    `- Purpose: Why is this component necessary?\n\n` +
    `**PHYSICAL RELATIONSHIPS:**\n` +
    `Explain how components are physically or logically connected:\n` +
    `- "The Interaction Monitoring Agent (104) runs as a background process on User Device (102) and communicates with Backend Server (112) via Secure Transmission Protocol (110)..."\n` +
    `- "Pattern Recognition Engine (116) queries Raw Interaction Data Repository (108) using SQL queries over TCP connection..."\n\n` +
    `**WRITING APPROACH:**\n` +
    `Use reference numerals consistently throughout. Be specific about technologies and implementations. Provide enough detail that a PHOSITA could design the system architecture.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the architecture description text. No section headers in output, no markdown formatting. This will be Part 1 of the Detailed Description section.`
  );
}

function dataStructuresUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**SYSTEM ARCHITECTURE (ALREADY WRITTEN):**\n${s.architecture}\n\n` +
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: DATA STRUCTURES & FORMATS (Part 2 of Detailed Description)**\n\n` +
    `Document every data structure, format, and protocol used in the system. This enables a PHOSITA to understand how information is represented, stored, and transmitted.\n\n` +
    `**REQUIRED DATA STRUCTURES:**\n\n` +
    `**1. RAW INTERACTION EVENTS**\n` +
    `Define the complete structure for captured user interactions:\n\n` +
    `Fields to document:\n` +
    `- Timestamp (format specification: ISO8601, Unix epoch, etc.)\n` +
    `- Event type (enumeration of all possible types)\n` +
    `- Application identifier (how applications are uniquely identified)\n` +
    `- Window/element identification (DOM path, accessibility tree, window handle)\n` +
    `- Input data (keystrokes, mouse coordinates, values entered)\n` +
    `- Application state (current view, open documents, active elements)\n` +
    `- Contextual metadata (user session, device info, environment variables)\n\n` +
    `Explain the serialization format (JSON, Protocol Buffers, etc.) and provide example structure.\n\n` +
    `**2. ABSTRACTED ACTIONS**\n` +
    `Define the standardized action format that makes actions application-agnostic:\n\n` +
    `Fields to document:\n` +
    `- Action identifier (UUID, sequential ID)\n` +
    `- Action type (standardized verb taxonomy: create, read, update, delete, navigate, etc.)\n` +
    `- Source application (reference to application from which action originated)\n` +
    `- Target element (abstracted element identifier)\n` +
    `- Parameters (action-specific data in key-value format)\n` +
    `- Semantic intent (interpreted purpose of the action)\n` +
    `- Confidence score (if applicable for ML-based abstraction)\n\n` +
    `Explain how normalization works across different application types.\n\n` +
    `**3. PATTERN RECOGNITION OUTPUT**\n` +
    `Define how identified patterns are represented:\n\n` +
    `Structure to document:\n` +
    `- Pattern identifier\n` +
    `- Action sequence (ordered list of action references)\n` +
    `- Frequency metrics (how often pattern occurs)\n` +
    `- Temporal characteristics (typical timing between actions)\n` +
    `- Contextual triggers (conditions under which pattern occurs)\n` +
    `- Confidence metrics (statistical significance)\n\n` +
    `**4. WORKFLOW DEFINITIONS (DAG)**\n` +
    `Define the workflow representation in complete detail:\n\n` +
    `Structure to document:\n` +
    `- Workflow identifier\n` +
    `- Workflow metadata (name, description, creation date)\n` +
    `- Nodes array (each node represents an atomic action)\n` +
    `  - Node identifier\n` +
    `  - Action reference\n` +
    `  - Input parameter mappings\n` +
    `  - Output data structure\n` +
    `- Edges array (each edge represents flow between nodes)\n` +
    `  - Source node\n` +
    `  - Target node\n` +
    `  - Condition (optional conditional logic)\n` +
    `  - Data transformation (how data passes between nodes)\n` +
    `- Triggers array (what causes workflow to execute)\n` +
    `  - Trigger type\n` +
    `  - Trigger conditions\n` +
    `  - Trigger parameters\n` +
    `- Personalization metadata\n` +
    `  - User-specific adaptations\n` +
    `  - Historical performance metrics\n` +
    `  - Optimization parameters\n\n` +
    `**5. EXECUTION STATE**\n` +
    `Define how workflow execution state is tracked:\n\n` +
    `Fields to document:\n` +
    `- Execution identifier\n` +
    `- Workflow reference\n` +
    `- Current node\n` +
    `- Execution status (running, paused, completed, failed)\n` +
    `- Node execution history\n` +
    `- Variable state (current values of all variables)\n` +
    `- Error information (if applicable)\n\n` +
    `**STORAGE & TRANSMISSION:**\n` +
    `Explain how these structures are:\n` +
    `- Stored in databases (schema design, indexing)\n` +
    `- Transmitted over network (serialization, compression)\n` +
    `- Secured (encryption at rest and in transit)\n` +
    `- Versioned (handling schema evolution)\n\n` +
    `**WRITING APPROACH:**\n` +
    `Be technically precise. Provide enough detail that a PHOSITA could implement these data structures. Use consistent terminology. Reference the component architecture from Part 1 using reference numerals where relevant.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the data structures description text. No section headers in output, no markdown formatting. This will be Part 2 of the Detailed Description section.`
  );
}

function operationsUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**SYSTEM ARCHITECTURE:**\n${s.architecture}\n\n` +
    `**DATA STRUCTURES:**\n${s.data_structures}\n\n` +
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: OPERATIONAL WORKFLOW (Part 3 of Detailed Description)**\n\n` +
    `Provide a complete chronological narrative of how the system operates from start to finish. A PHOSITA must be able to understand the exact sequence of operations.\n\n` +
    `**CHRONOLOGICAL NARRATIVE STRUCTURE:**\n\n` +
    `Use reference numerals from the architecture section consistently throughout. Write in a flowing narrative that traces execution.\n\n` +
    `**PHASE 1: INTERACTION CAPTURE**\n\n` +
    `Begin with: "During normal system operation, a user interacts with applications on User Device (102). When the user performs an action—such as clicking a button, entering text, or switching applications—the Interaction Monitoring Agent (104) detects this event through Operating System Event Hook (106)..."\n\n` +
    `Continue with:\n` +
    `- How the event is captured (specific OS APIs or hooks used)\n` +
    `- What information is extracted\n` +
    `- How the event is packaged into the Event Data Structure\n` +
    `- Any filtering or preprocessing that occurs\n\n` +
    `**PHASE 2: DATA TRANSMISSION & STORAGE**\n\n` +
    `"The captured Event Object is transmitted from User Device (102) to Backend Server (112) via Secure Data Transmission Protocol (110), which implements TLS 1.3 encryption..."\n\n` +
    `Continue with:\n` +
    `- Network communication mechanism\n` +
    `- Security and authentication\n` +
    `- How the server receives and validates the data\n` +
    `- Storage in Raw Interaction Data Repository (108)\n` +
    `- Database operations (insert, index, etc.)\n\n` +
    `**PHASE 3: ACTION ABSTRACTION**\n\n` +
    `"Action Abstraction and Normalization Service (114) periodically queries Raw Interaction Data Repository (108) for new events. For each event, the service..."\n\n` +
    `Continue with:\n` +
    `- How raw events are processed\n` +
    `- Application-specific interpretation logic\n` +
    `- Semantic analysis mechanism\n` +
    `- Creation of Abstracted Action objects\n` +
    `- Storage of abstracted actions\n\n` +
    `**PHASE 4: PATTERN RECOGNITION**\n\n` +
    `"Pattern Recognition Engine (116) analyzes the stream of Abstracted Actions to identify recurring sequences. The engine employs..."\n\n` +
    `Continue with:\n` +
    `- Specific algorithms or ML models used\n` +
    `- How patterns are identified (sequence mining, neural network inference, etc.)\n` +
    `- Statistical significance testing\n` +
    `- Pattern storage and indexing\n` +
    `- Continuous learning updates\n\n` +
    `**PHASE 5: WORKFLOW DISCOVERY**\n\n` +
    `"Workflow Discovery Engine (120) examines identified patterns to determine which represent genuine automation opportunities..."\n\n` +
    `Continue with:\n` +
    `- Criteria for workflow candidacy\n` +
    `- Cross-application sequence detection\n` +
    `- Implicit data dependency identification\n` +
    `- Contextual trigger inference\n\n` +
    `**PHASE 6: WORKFLOW SYNTHESIS**\n\n` +
    `"Workflow Synthesis Module (122) constructs executable workflow definitions from discovered patterns..."\n\n` +
    `Continue with:\n` +
    `- DAG construction algorithm\n` +
    `- Node and edge creation\n` +
    `- Parameter mapping logic\n` +
    `- Personalization incorporation\n` +
    `- Workflow validation\n\n` +
    `**PHASE 7: WORKFLOW STORAGE & PRESENTATION**\n\n` +
    `"The synthesized workflow is stored in Synthesized Workflow Repository (124) and presented to the user via User Interface Module (134)..."\n\n` +
    `Continue with:\n` +
    `- Repository storage mechanism\n` +
    `- User notification method\n` +
    `- Workflow display in UI\n` +
    `- User review and approval process\n\n` +
    `**PHASE 8: WORKFLOW EXECUTION**\n\n` +
    `"When a user activates a workflow, or when a trigger condition is met, Automation Execution Environment (130) instantiates the workflow for execution..."\n\n` +
    `Continue with:\n` +
    `- Trigger detection mechanism\n` +
    `- Execution initialization\n` +
    `- Node-by-node execution with Orchestration Engine (132)\n` +
    `- Cross-Application Integration Layer (126) invocation\n` +
    `- API calls to target applications\n` +
    `- Data flow between nodes\n` +
    `- Error handling and retry logic\n` +
    `- Execution state tracking\n` +
    `- Completion handling\n\n` +
    `**PHASE 9: CONTINUOUS REFINEMENT**\n\n` +
    `"As the workflow executes and as the user continues working, the system continues monitoring to refine and optimize..."\n\n` +
    `Continue with:\n` +
    `- Performance metrics collection\n` +
    `- Workflow adjustment logic\n` +
    `- User feedback incorporation\n` +
    `- Model retraining process\n\n` +
    `**WRITING APPROACH:**\n` +
    `Write as a flowing narrative, not bullet points. Use reference numerals constantly to tie back to the architecture. Describe the technical mechanism for each step. A PHOSITA should be able to implement the system's logic from this description.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the operational workflow description text. No section headers in output, no markdown formatting. This will be Part 3 of the Detailed Description section.`
  );
}

function alternativesUserPrompt(_p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**SYSTEM ARCHITECTURE:**\n${s.architecture}\n\n` +
    `**OPERATIONS:**\n${s.operations}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: ALTERNATIVE EMBODIMENTS (Part 4 of Detailed Description)**\n\n` +
    `Document technical variations that achieve the same inventive function. This shows that the invention is not limited to one specific implementation but represents a broader inventive concept.\n\n` +
    `**HARDWARE & INFRASTRUCTURE ALTERNATIVES:**\n\n` +
    `**Deployment Architectures:**\n` +
    `Explain that while the primary embodiment may describe a cloud-based architecture, the invention can be implemented in alternative configurations:\n` +
    `- Pure cloud infrastructure (all components on remote servers)\n` +
    `- On-premise deployment (enterprise data center)\n` +
    `- Hybrid architecture (monitoring agents on user devices, processing in cloud)\n` +
    `- Edge computing (processing at network edge closer to users)\n` +
    `- Peer-to-peer distributed (no central server)\n\n` +
    `For each, explain what changes from the primary embodiment and what remains the same inventively.\n\n` +
    `**Compute Platforms:**\n` +
    `Describe platform flexibility:\n` +
    `- Desktop systems (Windows, macOS, Linux)\n` +
    `- Mobile devices (iOS, Android with platform-specific monitoring approaches)\n` +
    `- Embedded systems (resource-constrained implementations)\n` +
    `- Browser-based (web extension architecture)\n` +
    `- Mixed heterogeneous environments\n\n` +
    `**Hardware Acceleration:**\n` +
    `Explain optional hardware acceleration:\n` +
    `- GPU acceleration for machine learning inference\n` +
    `- TPU or specialized AI accelerators\n` +
    `- FPGA for low-latency pattern matching\n` +
    `- Distributed computing clusters\n\n` +
    `**SOFTWARE & TECHNOLOGY ALTERNATIVES:**\n\n` +
    `**Programming Languages:**\n` +
    `While the primary embodiment might use Python, explain that implementation language is not limiting:\n` +
    `- Compiled languages (Go, Rust, C++) for performance-critical components\n` +
    `- JVM languages (Java, Kotlin, Scala) for enterprise integration\n` +
    `- JavaScript/TypeScript for web-based components\n` +
    `- Multiple languages in microservices architecture\n\n` +
    `**Machine Learning Frameworks:**\n` +
    `Explain ML framework flexibility:\n` +
    `- TensorFlow for large-scale neural networks\n` +
    `- PyTorch for research and development\n` +
    `- JAX for high-performance computing\n` +
    `- Scikit-learn for traditional ML algorithms\n` +
    `- Custom implementations of algorithms\n\n` +
    `**Database Technologies:**\n` +
    `Describe database alternatives:\n` +
    `- Relational databases (PostgreSQL, MySQL) for structured data\n` +
    `- NoSQL (MongoDB, Cassandra) for flexible schemas\n` +
    `- Time-series databases (InfluxDB, TimescaleDB) for event streams\n` +
    `- Graph databases (Neo4j) for relationship tracking\n` +
    `- Vector databases (Pinecone, Weaviate) for embeddings\n\n` +
    `**ALGORITHMIC ALTERNATIVES:**\n\n` +
    `**Pattern Recognition:**\n` +
    `Explain alternative approaches to pattern discovery:\n` +
    `- Statistical methods: Markov chains, Hidden Markov Models, Bayesian networks\n` +
    `- Deep learning: Transformer architectures, LSTM networks, GRU networks\n` +
    `- Traditional ML: Random forests, gradient boosting, decision trees\n` +
    `- Sequence mining: PrefixSpan, SPADE, CloSpan algorithms\n` +
    `- Hybrid approaches combining multiple techniques\n\n` +
    `**Workflow Optimization:**\n` +
    `Describe alternative optimization methods:\n` +
    `- Reinforcement learning for workflow improvement\n` +
    `- Genetic algorithms for workflow synthesis\n` +
    `- Simulated annealing for parameter optimization\n` +
    `- Constraint satisfaction for workflow validation\n\n` +
    `**INTEGRATION ALTERNATIVES:**\n\n` +
    `**Application Integration Methods:**\n` +
    `Explain that applications can be integrated through various means:\n` +
    `- API-based integration (REST, GraphQL, gRPC)\n` +
    `- UI automation (Selenium, Playwright, Puppeteer)\n` +
    `- Native SDKs and libraries\n` +
    `- Browser extensions\n` +
    `- Hybrid approaches combining multiple methods\n\n` +
    `**WRITING APPROACH:**\n` +
    `Be comprehensive in showing technical variations. Use language like "in alternative embodiments," "additionally," "furthermore," "alternatively" to show scope. The goal is to demonstrate that the core inventive concept applies across many technical implementations.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the alternatives description text. No section headers in output, no markdown formatting. This will be Part 4 of the Detailed Description section.`
  );
}

function ramificationsUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**DETAILED DESCRIPTION (ALREADY WRITTEN):**\n${s.detailed_description}\n\n` +
    `**CORE INNOVATION:**\n${p.coreIdea}\n\n` +
    `**KEY CONCEPTS:**\n${p.keyConceptsText}\n\n` +
    `---\n\n` +
    `**YOUR MISSION: RAMIFICATIONS AND SCOPE SECTION**\n\n` +
    `The detailed description showed one way to build the invention. This section demonstrates the breadth of the invention by showing the full range of variations, alternatives, and applications. This maximizes patent scope and defensibility.\n\n` +
    `**PURPOSE:**\n` +
    `Show that the invention isn't limited to one specific implementation but covers a broad class of related approaches. This prevents competitors from designing around the patent by making trivial modifications.\n\n` +
    `**REQUIRED CONTENT:**\n\n` +
    `**1. ALTERNATIVE MATERIALS & TECHNOLOGIES**\n\n` +
    `For a software invention, cover the full technology stack:\n\n` +
    `**Programming & Frameworks:**\n` +
    `Explain that the system can be implemented in various programming languages (Python, JavaScript, Go, Rust, Java, C++, etc.), using different frameworks appropriate to each language. The choice of implementation language doesn't change the fundamental invention.\n\n` +
    `**Data Storage:**\n` +
    `Describe how different database technologies can be used depending on requirements: relational databases for structured data, NoSQL for flexibility, time-series databases for event streams, graph databases for relationship tracking, vector databases for embeddings.\n\n` +
    `**Infrastructure:**\n` +
    `Explain deployment flexibility: cloud platforms (AWS, Azure, GCP), on-premise infrastructure, hybrid approaches, edge computing, serverless architectures. The hosting model doesn't change the core invention.\n\n` +
    `**2. DEPLOYMENT SCENARIOS & ENVIRONMENTS**\n\n` +
    `**Scale Variations:**\n` +
    `Explain how the invention adapts across scales:\n` +
    `- Personal single-user automation on individual devices\n` +
    `- Team/workgroup automation (small organizations)\n` +
    `- Department-level deployment (medium scale)\n` +
    `- Enterprise-wide deployment (large scale)\n` +
    `- Multi-tenant SaaS (service provider model)\n\n` +
    `**Platform Variations:**\n` +
    `Describe deployment across platforms:\n` +
    `- Desktop operating systems (Windows, macOS, Linux)\n` +
    `- Mobile platforms (iOS, Android)\n` +
    `- Web browsers\n` +
    `- Embedded systems and IoT devices\n` +
    `- Mixed-platform environments\n\n` +
    `**3. APPLICATIONS & USE CASES**\n\n` +
    `Beyond the primary use case, explain how this invention applies to:\n\n` +
    `**Industry-Specific Applications:**\n` +
    `Healthcare, finance, legal, manufacturing, retail, education, government - for each relevant industry, explain how the same core technology addresses that industry's automation needs.\n\n` +
    `**Functional Categories:**\n` +
    `- Personal productivity optimization\n` +
    `- Business process automation\n` +
    `- Data migration and integration\n` +
    `- Testing and quality assurance\n` +
    `- Security and compliance monitoring\n` +
    `- Customer support operations\n` +
    `- Content creation workflows\n\n` +
    `**Cross-Industry Patterns:**\n` +
    `Any multi-step process involving multiple applications, any repetitive task with observable patterns, any workflow requiring data coordination between systems.\n\n` +
    `**4. ALGORITHMIC & METHODOLOGICAL ALTERNATIVES**\n\n` +
    `**Pattern Recognition Approaches:**\n` +
    `Explain that the pattern recognition can be achieved through various technical approaches: statistical methods (Markov models, Bayesian networks), deep learning (Transformers, recurrent networks), traditional ML (decision trees, ensemble methods), or hybrid approaches combining multiple techniques.\n\n` +
    `**Optimization Methods:**\n` +
    `Describe alternative approaches to workflow optimization: reinforcement learning, evolutionary algorithms, constraint satisfaction, heuristic search.\n\n` +
    `**5. INTEGRATION METHODS**\n\n` +
    `**Application Integration:**\n` +
    `Explain that applications can be integrated through various technical means: REST APIs, GraphQL, gRPC, native SDKs, UI automation frameworks, browser extensions, or hybrid approaches combining multiple methods.\n\n` +
    `**WRITING APPROACH:**\n` +
    `Be comprehensive and thorough. Use language like "in alternative embodiments," "additionally," "furthermore," "in various implementations" to show scope. The goal is to demonstrate that the core inventive concept applies broadly across many technical variations.\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the ramifications text. No section headers in the output, no markdown formatting. Be thorough in showing the breadth of patent coverage.`
  );
}

function abstractUserPrompt(p: ParsedInput, s: Sections): string {
  return (
    `**PATENT TITLE:**\n${s.title}\n\n` +
    `**SUMMARY:**\n${s.summary}\n\n` +
    `**KEY CONCEPTS:**\n${p.keyConceptsText}\n\n\n\n` +
    `---\n\n` +
    `**YOUR MISSION: PATENT ABSTRACT**\n\n` +
    `Write the abstract for this provisional patent application. The abstract is the first thing anyone reads and must provide a complete but concise overview.\n\n` +
    `**USPTO ABSTRACT REQUIREMENTS:**\n` +
    `- Maximum 150 words (this is a strict USPTO requirement)\n` +
    `- Single paragraph with no line breaks\n` +
    `- Technical precision required\n` +
    `- Must be understandable to both technical and non-technical readers\n` +
    `- Should enable someone to understand the invention without reading further\n` +
    `- No marketing language or subjective claims\n\n` +
    `**REQUIRED ELEMENTS:**\n\n` +
    `**Opening Statement:**\n` +
    `State what the invention is: "A computing system for..."\n\n` +
    `**Problem Context:**\n` +
    `Briefly explain what problem it solves: "Existing approaches require explicit programming and cannot..."\n\n` +
    `**Technical Solution:**\n` +
    `Explain how it works: "The system monitors user interactions, abstracts actions into standardized formats, employs machine learning to identify patterns, and autonomously synthesizes executable workflows..."\n\n` +
    `**Result:**\n` +
    `State the outcome: "Enabling zero-configuration, personalized automation across disparate applications."\n\n` +
    `**WRITING REQUIREMENTS:**\n` +
    `- One continuous paragraph\n` +
    `- Exactly 150 words or fewer (count carefully)\n` +
    `- Technical accuracy\n` +
    `- Clear and direct language\n` +
    `- Follow USPTO formatting conventions\n\n` +
    `**OUTPUT:**\n` +
    `Provide only the abstract text as a single paragraph. No preamble, no markdown formatting.`
  );
}

function abstractFixerUserPrompt(args: {
  p: ParsedInput;
  s: Sections;
  abstract: string;
  wordCount: number;
}): string {
  const { p, s, abstract, wordCount } = args;
  return (
    `**COMPLIANCE FAILURE: ABSTRACT EXCEEDS 150-WORD USPTO LIMIT**\n\n` +
    `**FAILED ABSTRACT (${wordCount} words):**\n${abstract}\n\n` +
    `---\n\n` +
    `**PATENT BEING DESCRIBED:**\n\n` +
    `**Title:** ${s.title}\n\n` +
    `**Core Innovation:** ${p.coreIdea}\n\n` +
    `**Technical Summary:** ${s.summary}\n\n` +
    `**Key Concepts:** ${p.keyConceptsText}\n\n` +
    `---\n\n` +
    `**YOUR TASK:**\n\n` +
    `The abstract above is ${wordCount} words. USPTO maximum is 150 words.\n\n` +
    `Rewrite this abstract to describe THE EXACT SAME INVENTION in under 150 words.\n\n` +
    `PRESERVE:\n` +
    `- Every system component mentioned\n` +
    `- Every process and action described\n` +
    `- Every input/output relationship\n` +
    `- Every technical outcome stated\n\n` +
    `The rewritten abstract must be legally equivalent - a patent attorney must confirm both versions describe the same invention with the same scope.\n\n` +
    `**TARGET:** 120-140 words\n` +
    `**MAXIMUM:** 150 words\n\n` +
    `**OUTPUT:** The rewritten abstract only. Single paragraph. No commentary.`
  );
}

// --- Word counting + Final Assembly (ported from n8n) ---
function countWords(text: string): number {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

const MAX_ABSTRACT_FIX_ATTEMPTS = 3;

function buildFormattedDocument(args: {
  title: string;
  abstract: string;
  background: string;
  summary: string;
  detailedDescription: string;
  ramifications: string;
  keyConcepts: string[];
}): string {
  const sep = "═══════════════════════════════════════════════════════════════════";
  return [
    "TITLE:",
    args.title,
    "",
    sep,
    "",
    "ABSTRACT:",
    args.abstract,
    "",
    sep,
    "",
    "BACKGROUND:",
    args.background,
    "",
    sep,
    "",
    "SUMMARY:",
    args.summary,
    "",
    sep,
    "",
    "DETAILED DESCRIPTION:",
    args.detailedDescription,
    "",
    sep,
    "",
    "RAMIFICATIONS AND SCOPE:",
    args.ramifications,
    "",
    sep,
    "",
    "KEY CONCEPTS:",
    args.keyConcepts.join("\n\n"),
  ].join("\n");
}

// --- Orchestrator ---

export async function runProvisional(payload: ProvisionalPayload) {
  console.log(">>> [M5-5a PROVISIONAL] <<< starting 9-10 agent pipeline");

  try {
    const parsed = parsePayload(payload);
    const sections: Sections = {};

    // Stage 1: Title
    console.log(">>> [M5-5a PROVISIONAL] <<< 1/9 title");
    sections.title = await runAgent("title", titleUserPrompt(parsed));

    // Stage 2: Background
    console.log(">>> [M5-5a PROVISIONAL] <<< 2/9 background");
    sections.background = await runAgent("background", backgroundUserPrompt(parsed, sections));

    // Stage 3: Summary
    console.log(">>> [M5-5a PROVISIONAL] <<< 3/9 summary");
    sections.summary = await runAgent("summary", summaryUserPrompt(parsed, sections));

    // Abstract only depends on title + summary, so it can run in parallel with
    // the architecture → data-structures → operations → alternatives →
    // ramifications chain. Saves the ~25s + any fixer-loop time off the
    // critical path. The two branches mutate disjoint fields of `sections`
    // (abstract reads only title/summary; the chain writes the rest).
    console.log(
      ">>> [M5-5a PROVISIONAL] <<< running abstract chain || detailed-description chain in parallel",
    );

    const abstractChain = (async () => {
      console.log(">>> [M5-5a PROVISIONAL] <<< abstract (parallel)");
      let abstract = await runAgent("abstract", abstractUserPrompt(parsed, sections));
      let wordCount = countWords(abstract);

      for (
        let attempt = 0;
        wordCount > 150 && attempt < MAX_ABSTRACT_FIX_ATTEMPTS;
        attempt++
      ) {
        console.log(
          `>>> [M5-5a PROVISIONAL] <<< abstract ${wordCount} words > 150, fixer attempt ${attempt + 1}/${MAX_ABSTRACT_FIX_ATTEMPTS}`,
        );
        abstract = await runAgent(
          "abstract-fixer",
          abstractFixerUserPrompt({ p: parsed, s: sections, abstract, wordCount }),
        );
        wordCount = countWords(abstract);
      }
      return abstract;
    })();

    const detailedDescriptionChain = (async () => {
      console.log(">>> [M5-5a PROVISIONAL] <<< architecture (parallel)");
      sections.architecture = await runAgent(
        "architecture",
        architectureUserPrompt(parsed, sections),
      );

      console.log(">>> [M5-5a PROVISIONAL] <<< data-structures (parallel)");
      sections.data_structures = await runAgent(
        "data-structures",
        dataStructuresUserPrompt(parsed, sections),
      );

      console.log(">>> [M5-5a PROVISIONAL] <<< operations (parallel)");
      sections.operations = await runAgent("operations", operationsUserPrompt(parsed, sections));

      console.log(">>> [M5-5a PROVISIONAL] <<< alternatives (parallel)");
      sections.alternatives = await runAgent(
        "alternatives",
        alternativesUserPrompt(parsed, sections),
      );

      // Combine Detailed Description (matches n8n "Combine Detailed Description" node)
      sections.detailed_description = [
        sections.architecture,
        sections.data_structures,
        sections.operations,
        sections.alternatives,
      ].join("\n\n");

      console.log(">>> [M5-5a PROVISIONAL] <<< ramifications (parallel)");
      sections.ramifications_and_scope = await runAgent(
        "ramifications",
        ramificationsUserPrompt(parsed, sections),
      );
    })();

    const [abstractResult] = await Promise.all([abstractChain, detailedDescriptionChain]);
    sections.abstract = abstractResult;

    // Final Assembly
    const keyConceptsArray: string[] = [];
    let keyConceptNumber = 1;
    for (const group of parsed.keyConceptGroups) {
      keyConceptsArray.push(`${keyConceptNumber}. ${group.independent}`);
      keyConceptNumber++;
      for (const dep of group.dependents) {
        keyConceptsArray.push(`${keyConceptNumber}. ${dep}`);
        keyConceptNumber++;
      }
    }

    const wordCounts = {
      title: countWords(sections.title || ""),
      abstract: countWords(sections.abstract || ""),
      background: countWords(sections.background || ""),
      summary: countWords(sections.summary || ""),
      detailed_description: countWords(sections.detailed_description || ""),
      ramifications: countWords(sections.ramifications_and_scope || ""),
    };
    const totalWords = Object.values(wordCounts).reduce((a, b) => a + b, 0);

    const formattedDocument = buildFormattedDocument({
      title: sections.title || "",
      abstract: sections.abstract || "",
      background: sections.background || "",
      summary: sections.summary || "",
      detailedDescription: sections.detailed_description || "",
      ramifications: sections.ramifications_and_scope || "",
      keyConcepts: keyConceptsArray,
    });

    console.log(
      `>>> [M5-5a PROVISIONAL] <<< done — ${keyConceptsArray.length} key concepts, ${totalWords} total words (abstract ${wordCounts.abstract})`,
    );

    return {
      success: true as const,
      sessionId: parsed.sessionId,
      category: parsed.category,
      coreIdea: parsed.coreIdea,
      expandedConcept: parsed.expandedConcept,
      keyConceptGroups: parsed.keyConceptGroups,
      title: sections.title || "",
      abstract: sections.abstract || "",
      background: sections.background || "",
      summary: sections.summary || "",
      detailed_description: sections.detailed_description || "",
      ramifications_and_scope: sections.ramifications_and_scope || "",
      keyConcepts: keyConceptsArray,
      keyConcepts_count: keyConceptsArray.length,
      word_counts: wordCounts,
      total_words: totalWords,
      formatted_document: formattedDocument,
      broad_concepts_glossary: [] as string[],
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(">>> [M5-5a PROVISIONAL] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "Provisional generation failed";
    return { success: false as const, error: errorMessage };
  }
}
