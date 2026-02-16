import type { SSEEvent, TaskResult, RubricItem } from '@/types';

// Mock plan structure for demo mode
interface MockPlan {
  task: string;
  brief: string;
  plan: string;
  rubric: string;
}

// Realistic mock data for demonstrating the UI

export const mockTask = "Research the current state of quantum computing in 2024, focusing on the leading companies, recent breakthroughs, and practical applications that are emerging.";

export const mockPlan: MockPlan = {
  task: mockTask,
  brief: "This research task requires investigating the quantum computing landscape as of 2024. The deliverable should cover three main areas: (1) key players in the industry including both established tech giants and promising startups, (2) significant technical breakthroughs in qubit stability, error correction, and scalability, and (3) real-world applications that have moved beyond theoretical to practical implementation.",
  plan: `## Research Approach

This investigation will follow a structured methodology to ensure comprehensive coverage of the quantum computing landscape.

### Phase 1: Industry Landscape

- **Major Players**: Research IBM, Google, IonQ, Rigetti, and D-Wave
- **Emerging Startups**: Identify promising newcomers like PsiQuantum, Xanadu
- **Geographic Distribution**: Map key research centers globally

For each company, we'll document:
1. Current qubit count and technology approach
2. Recent funding and partnerships
3. Published roadmaps and milestones

### Phase 2: Technical Breakthroughs

Focus on three key areas:

> Error correction remains the critical challenge for practical quantum computing

- **Qubit Stability**: Coherence times and decoherence mitigation
- **Error Correction**: Surface codes, topological approaches
- **Scalability**: Modular architectures, interconnects

### Phase 3: Practical Applications

Investigate real-world deployments in:

- **Financial Services**: Portfolio optimization, risk analysis
- **Pharmaceuticals**: Molecular simulation, drug discovery
- **Cryptography**: Post-quantum security preparations

### Phase 4: Synthesis

Compile findings into a coherent narrative that addresses all acceptance criteria, with proper citations and evidence.`,
  rubric: `1. Must identify at least 5 major quantum computing companies with their current qubit counts
2. Must explain the difference between superconducting and trapped-ion approaches
3. Must include at least 2 specific breakthroughs from 2024
4. Must describe at least 3 practical applications with real-world examples
5. Must acknowledge current limitations and timeline expectations
6. Information must be technically accurate and sourced from recent developments`,
};

export const mockRubric = `1. Must identify at least 5 major quantum computing companies with their current qubit counts
2. Must explain the difference between superconducting and trapped-ion approaches
3. Must include at least 2 specific breakthroughs from 2024
4. Must describe at least 3 practical applications with real-world examples
5. Must acknowledge current limitations and timeline expectations
6. Information must be technically accurate and sourced from recent developments`;

// Mock answer content (defined before mockEvents which uses it)
const mockAnswer = `Quantum computing in 2024 stands at an inflection point—no longer purely theoretical, yet not quite ready for widespread practical deployment. The field has seen remarkable progress across hardware, software, and applications.

**Leading Companies and Their Approaches**

IBM remains the most visible player, having unveiled their 1,121-qubit Condor processor in late 2023, the first to break the 1,000-qubit barrier. Their roadmap targets 100,000 qubits by 2033 through modular architectures. Google's quantum AI team made headlines with their Willow chip, demonstrating error correction below the threshold needed for fault-tolerant computing—a crucial milestone.

IonQ and Quantinuum represent the trapped-ion approach, which trades raw qubit count for higher fidelity and longer coherence times. IonQ's systems achieve 35 "algorithmic qubits" (a measure accounting for error rates), while Quantinuum has demonstrated the most advanced fault-tolerant operations to date. D-Wave continues to lead in quantum annealing with 5,000+ qubit systems optimized for specific optimization problems.

**Recent Breakthroughs**

Two developments stand out in 2024. First, Google's demonstration that error correction can actually reduce errors as you add more qubits—previously, more qubits meant more errors. This proves that the path to fault-tolerant quantum computing is viable. Second, multiple companies have achieved "quantum utility"—problems where quantum computers provide genuine advantages over classical simulation, even with current noisy hardware.

**Practical Applications Emerging**

The pharmaceutical industry has embraced quantum computing most aggressively. Cleveland Clinic's partnership with IBM explores drug discovery, while Moderna uses quantum simulation for mRNA research. In finance, JPMorgan Chase runs portfolio optimization experiments, and HSBC has begun implementing quantum-safe cryptography in anticipation of future threats. BMW and other manufacturers pilot supply chain optimization.

**Current Limitations**

We remain in the NISQ (Noisy Intermediate-Scale Quantum) era. Current systems of 50-1,000 qubits suffer error rates that limit practical computation depth. True fault-tolerant quantum computing—where errors can be corrected faster than they occur—requires millions of physical qubits to yield thousands of logical qubits. Expert consensus suggests cryptographically-relevant quantum computers remain a decade away, though the trajectory is clearer than ever.

The next few years will likely see continued hardware improvements, better error correction, and expansion of hybrid classical-quantum workflows that extract value from current machines while the technology matures.`;

// New format events matching UI_GUIDE.md API spec
export const mockEvents: SSEEvent[] = [
  {
    type: "brief",
    content: "This research task requires investigating the quantum computing landscape as of 2024. The deliverable should cover three main areas: (1) key players in the industry including both established tech giants and promising startups, (2) significant technical breakthroughs in qubit stability, error correction, and scalability, and (3) real-world applications that have moved beyond theoretical to practical implementation.",
  },
  {
    type: "rubric",
    run_id: "mock-run-123",
    content: mockRubric,
  },
  {
    type: "subagent_start",
    subagent_id: "sa_001",
    instruction: "Search for quantum computing companies and their current qubit counts in 2024",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_001",
    content: `Found 12 relevant results:
1. IBM announces 1,121-qubit Condor processor (Dec 2023)
2. Google's Willow chip achieves below-threshold error correction
3. IonQ's trapped-ion systems reach 35 algorithmic qubits
4. Quantinuum demonstrates fault-tolerant operations
5. D-Wave's 5000+ qubit annealing systems for optimization...`,
  },
  {
    type: "subagent_end",
    subagent_id: "sa_001",
  },
  {
    type: "subagent_start",
    subagent_id: "sa_002",
    instruction: "Search for quantum computing practical applications in 2024 including drug discovery and cryptography",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_002",
    content: `Found 8 relevant results:
1. Cleveland Clinic + IBM: Quantum-powered drug discovery research
2. JPMorgan Chase: Portfolio optimization using quantum algorithms
3. BMW: Supply chain and route optimization pilots
4. HSBC: Quantum-safe cryptography implementation
5. Moderna: Molecular simulation for mRNA research...`,
  },
  {
    type: "subagent_end",
    subagent_id: "sa_002",
  },
  {
    type: "subagent_start",
    subagent_id: "sa_003",
    instruction: "Search for quantum computing limitations and timeline for fault-tolerant systems",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_003",
    content: `Found 6 relevant results:
1. MIT Review: "Quantum advantage still years away for most applications"
2. Nature: Error rates remain primary challenge
3. IBM Roadmap: 100,000 qubits by 2033
4. Expert consensus: Cryptographically relevant QC ~2035
5. Current NISQ devices: 50-1000 qubits, high error rates...`,
  },
  {
    type: "subagent_end",
    subagent_id: "sa_003",
  },
  {
    type: "verification",
    attempt: 1,
    answer: "The comprehensive overview covers all required aspects of quantum computing in 2024.",
    result: "PASS: All rubric criteria met",
    is_error: false,
  },
  {
    type: "answer",
    content: mockAnswer,
  },
];

export const mockResult: TaskResult = {
  task: mockTask,
  answer: mockAnswer,
  rubric: mockRubric,
  run_id: "mock-run-123",
};

// Explore mode mock data with multiple takes
export const mockExploreTask = "Write a compelling opening paragraph for an essay about climate change.";

const mockExploreTakes = `Take 1: The Urgent Warning

The clock is ticking. With each passing second, glaciers retreat another inch, sea levels rise another millimeter, and another species edges closer to extinction. Climate change isn't a distant threat lurking on the horizon—it's the defining crisis of our generation, unfolding in real-time across every continent and ocean. The question is no longer whether we should act, but whether we still can.

===

Take 2: The Human Story

Maria remembered when the river ran full past her village. Now, in what should be the rainy season, she walks three miles to find water that's safe to drink. Her story echoes across the Global South, where climate change has already arrived—not as charts or projections, but as drought, displacement, and desperation. This is not a future crisis; it is a present reality for billions.

===

Take 3: The Opportunity Lens

What if the greatest challenge of our era is also our greatest opportunity? Climate change demands a transformation of how we power our homes, move through cities, grow our food, and build our economies. Nations that embrace this transition aren't just saving the planet—they're positioning themselves to lead the industries of tomorrow.

===

Take 4: The Scientific Narrative

In 1896, Swedish scientist Svante Arrhenius first calculated that burning fossil fuels could warm the planet. Over a century later, his predictions have proven remarkably accurate. The science is now unequivocal: atmospheric CO2 has risen 50% since pre-industrial times, global temperatures have increased 1.1°C, and the rate of change is accelerating. What was once theory is now measured reality.`;

export const mockSetLevelGaps = `**Missing Perspectives:**
- Economic inequality lens: How climate change disproportionately affects developing nations
- Generational perspective: Youth activism and intergenerational justice
- Systems thinking: Feedback loops and tipping points
- Solution-focused: Technologies and policies already working

**Shared Assumptions Across All Takes:**
- Western/global north framing
- Assumes reader unfamiliar with topic
- Anthropocentric view (humans as actors, not part of ecosystem)`;

export const mockExploreBriefs = [
  `**Angle:** Urgent warning / crisis framing
**Core assumption:** Reader needs to feel urgency to care
**Prioritizes:** Emotional impact, immediacy
**Ignores:** Solutions, nuance
**Key question:** Can we make them feel the crisis is NOW?`,
  `**Angle:** Human story / personal narrative
**Core assumption:** Stories connect more than data
**Prioritizes:** Empathy, relatability
**Ignores:** Global scale, systemic issues
**Key question:** Can one person's story represent the whole?`,
  `**Angle:** Opportunity / positive framing
**Core assumption:** Hope motivates more than fear
**Prioritizes:** Economic opportunity, innovation
**Ignores:** Current suffering, justice issues
**Key question:** Is this too optimistic for the reality?`,
  `**Angle:** Scientific / evidence-based
**Core assumption:** Facts convince skeptics
**Prioritizes:** Credibility, accuracy
**Ignores:** Emotional connection
**Key question:** Will data alone move people?`,
];

export const mockExploreResult: TaskResult = {
  task: mockExploreTask,
  answer: mockExploreTakes,
  rubric: "Exploration complete. 4 distinct takes generated with different perspectives: urgent warning, human story, opportunity framing, and scientific narrative.",
  run_id: "mock-explore-123",
  mode: "explore",
  takes: [
    `Take 1: The Urgent Warning

The clock is ticking. Every second, we pump another 1,000 tons of carbon dioxide into our atmosphere. Every minute, we lose another 30 football fields of forest. Every day, another species vanishes forever. The numbers are staggering, almost incomprehensible—yet they represent our lived reality, a slow-motion catastrophe unfolding in real-time.`,
    `Take 2: The Human Story

Maria remembers when the river ran clear. Growing up in the highlands of Peru, she would drink straight from the glacier-fed stream behind her village. That was twenty years ago. Today, at thirty-two, she walks three hours each way to collect water from a dwindling spring, watching the glacier that sustained her community shrink a little more each summer.`,
    `Take 3: The Opportunity Lens

What if the greatest challenge of our era is also our greatest opportunity? Climate change demands a transformation of how we power our homes, move through cities, grow our food, and build our economies. Nations that embrace this transition aren't just saving the planet—they're positioning themselves to lead the industries of tomorrow.`,
    `Take 4: The Scientific Narrative

In 1896, Swedish scientist Svante Arrhenius first calculated that burning fossil fuels could warm the planet. Over a century later, his predictions have proven remarkably accurate. The science is now unequivocal: atmospheric CO2 has risen 50% since pre-industrial times, global temperatures have increased 1.1°C, and the rate of change is accelerating. What was once theory is now measured reality.`,
  ],
  set_level_gaps: mockSetLevelGaps,
  briefs: mockExploreBriefs,
};

export const mockExploreEvents: SSEEvent[] = [
  // Briefs generated in parallel
  {
    type: "brief",
    content: mockExploreBriefs[0],
    index: 1,
    total: 1,
    angle: "Urgent warning / crisis framing",
  },
  {
    type: "brief",
    content: mockExploreBriefs[1],
    index: 2,
    total: 2,
    angle: "Human story / personal narrative",
  },
  {
    type: "brief",
    content: mockExploreBriefs[2],
    index: 3,
    total: 3,
    angle: "Opportunity / positive framing",
  },
  {
    type: "brief",
    content: mockExploreBriefs[3],
    index: 4,
    total: 4,
    angle: "Scientific / evidence-based",
  },
  // Takes generated by subagents
  {
    type: "subagent_start",
    subagent_id: "sa_001",
    instruction: "Draft Take 1: An urgent, alarming opening that emphasizes the immediacy of the crisis",
    purpose: "take",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_001",
    content: "Drafted urgent warning take focusing on ticking clock metaphor and real-time crisis framing.",
  },
  {
    type: "subagent_end",
    subagent_id: "sa_001",
  },
  {
    type: "subagent_start",
    subagent_id: "sa_002",
    instruction: "Draft Take 2: A human-centered narrative opening with a personal story",
    purpose: "take",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_002",
    content: "Drafted human story take with Maria's water crisis narrative.",
  },
  {
    type: "subagent_end",
    subagent_id: "sa_002",
  },
  {
    type: "subagent_start",
    subagent_id: "sa_003",
    instruction: "Draft Take 3: An optimistic, opportunity-focused opening",
    purpose: "take",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_003",
    content: "Drafted opportunity lens take reframing challenge as transformation.",
  },
  {
    type: "subagent_end",
    subagent_id: "sa_003",
  },
  {
    type: "subagent_start",
    subagent_id: "sa_004",
    instruction: "Draft Take 4: A scientific, fact-based opening",
    purpose: "take",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_004",
    content: "Drafted scientific narrative take with historical arc from Arrhenius to present.",
  },
  {
    type: "subagent_end",
    subagent_id: "sa_004",
  },
  // Set-level gaps subagent
  {
    type: "subagent_start",
    subagent_id: "sa_005",
    instruction: "Review all takes together: What perspective is missing? What do all takes assume that might be wrong?",
    purpose: "set_level_gaps",
  },
  {
    type: "subagent_chunk",
    subagent_id: "sa_005",
    content: "Identified missing perspectives: economic inequality, generational, systems thinking, solution-focused. Shared assumptions: Western framing, unfamiliar reader, anthropocentric view.",
  },
  {
    type: "subagent_end",
    subagent_id: "sa_005",
  },
  {
    type: "verification",
    attempt: 1,
    answer: "4 distinct takes generated with set-level gaps",
    result: "PASS: All takes are genuinely different perspectives, gaps identified",
    is_error: false,
  },
  {
    type: "answer",
    content: mockExploreTakes,
  },
];

// Mock iterate result
export const mockIterateAnswer = `Quantum computing in 2024 represents a pivotal moment in technological history—the field has transitioned from laboratory curiosity to commercial reality, though significant challenges remain.

**Industry Leaders and Technology Approaches**

The competitive landscape is dominated by two distinct technological paradigms. **Superconducting qubits** are championed by IBM (1,121-qubit Condor), Google (Willow chip), and Rigetti, offering faster gate operations but requiring extreme cooling near absolute zero. **Trapped-ion systems** from IonQ (35 algorithmic qubits) and Quantinuum provide superior coherence times and connectivity, making them better suited for certain algorithms despite slower operations.

D-Wave's quantum annealers (5,000+ qubits) take a different approach entirely, excelling at optimization problems but unable to run general quantum algorithms.

**Key 2024 Milestones**

1. **Error Correction Breakthrough**: Google demonstrated that adding more qubits can now *reduce* rather than increase errors—the holy grail needed for practical quantum computing.
2. **Quantum Utility**: Multiple teams achieved problems where quantum computers genuinely outperform classical supercomputers.
3. **Modular Architectures**: IBM's Heron processor shows the path to scaling through connected smaller processors.

**Real-World Deployments**

- **Pharmaceuticals**: Cleveland Clinic + IBM for drug discovery; Moderna for mRNA vaccine research
- **Finance**: JPMorgan portfolio optimization; HSBC quantum-safe cryptography
- **Automotive**: BMW supply chain optimization; Mercedes materials simulation

**Honest Timeline Assessment**

Current NISQ devices (50-1,000 qubits) have error rates limiting practical computation. Fault-tolerant quantum computing requires millions of physical qubits. Conservative expert consensus: cryptographically-relevant quantum computers by ~2035.`;

export const mockIterateResult: TaskResult = {
  task: mockTask,
  answer: mockIterateAnswer,
  rubric: mockRubric,
  run_id: "mock-iterate-123",
};

export const mockRubricItems: RubricItem[] = [
  {
    id: "1",
    criterion: "Must identify at least 5 major quantum computing companies with their current qubit counts",
    passed: true,
    evidence: "Identified IBM (1,121 qubits), Google (Willow chip), IonQ (35 algorithmic qubits), Quantinuum, and D-Wave (5,000+ qubits)",
  },
  {
    id: "2",
    criterion: "Must explain the difference between superconducting and trapped-ion approaches",
    passed: true,
    evidence: "Explained that trapped-ion 'trades raw qubit count for higher fidelity and longer coherence times'",
  },
  {
    id: "3",
    criterion: "Must include at least 2 specific breakthroughs from 2024",
    passed: true,
    evidence: "Covered Google's error correction milestone and multiple companies achieving 'quantum utility'",
  },
  {
    id: "4",
    criterion: "Must describe at least 3 practical applications with real-world examples",
    passed: true,
    evidence: "Described drug discovery (Cleveland Clinic, Moderna), finance (JPMorgan, HSBC), and manufacturing (BMW)",
  },
  {
    id: "5",
    criterion: "Must acknowledge current limitations and timeline expectations",
    passed: true,
    evidence: "Discussed NISQ era, error rates, and estimated fault-tolerant QC 'a decade away'",
  },
  {
    id: "6",
    criterion: "Information must be technically accurate and sourced from recent developments",
    passed: undefined, // Partially verified
    evidence: "Technical details align with known announcements; some claims require verification against primary sources",
  },
];

// Simulated streaming for demo
export function createMockStream(
  onEvent: (event: SSEEvent) => void,
  onComplete: (result: TaskResult) => void,
  speed: number = 1
) {
  let index = 0;
  const baseDelay = 800 / speed;

  const streamNext = () => {
    if (index < mockEvents.length) {
      const event = mockEvents[index];
      onEvent(event);
      index++;
      setTimeout(streamNext, baseDelay + Math.random() * 500);
    } else {
      // Stream complete, send result
      setTimeout(() => {
        onComplete(mockResult);
      }, 500);
    }
  };

  return {
    start: () => setTimeout(streamNext, 300),
    stop: () => { index = mockEvents.length; },
  };
}
