# CogniFlow — Design Specification

## Roadmap Status
**✓ DONE (Weeks 1-6):** Sensing + Calibration, Session lifecycle + Question bank, Stress fusion + Report card + Recharts.
**▶ PENDING (Weeks 7-12):** Pilot study (n=5), Milestone 2 video, Full user study (n=15-20), Analysis, Final paper, Demo video.

## Design Principles (from proposal)

Every design decision must satisfy three constraints simultaneously:

1. **Zero extraneous cognitive load** — nothing on screen should demand attention away from the code
2. **Ipsative fairness** — the system judges you against yourself, not others
3. **Positive reappraisal** — all language is encouraging, never alarming

---

## Screen 1: Lobby

### Purpose
Give the user a moment to read the problem, prepare mentally, and choose when to begin. This is the low-stakes moment before pressure starts.

### Layout
```
┌─────────────────────────────────────────────────────┐
│  ● CogniFlow   Interview Coach          [not started]│
├─────────────────────────────────────────────────────┤
│                                                     │
│   QUESTION                                          │
│   ┌─────────────────────────────────────────────┐   │
│   │  Two Sum                         [Easy]     │   │
│   │                                             │   │
│   │  Given an array of integers and a target,  │   │
│   │  return the indices of two numbers that     │   │
│   │  add up to the target.                      │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│   HOW IT WORKS                                      │
│   ① Allow camera and microphone                    │
│   ② Look naturally at screen during calibration    │
│   ③ Code your solution                             │
│   ④ Click End Session when done                    │
│                                                     │
│         [ Start Interview ]                         │
│   A 10-second calibration will run first            │
│                                                     │
│                        Next question: Valid Palindrome → │
└─────────────────────────────────────────────────────┘
```

### Design decisions
- Camera activates on page load so the user can see themselves before starting — this reduces surprise during calibration
- Start button is disabled until `cameraReady === true` — prevents a blank calibration
- The "1-second calibration will run first" note sets expectations so the overlay does not feel like a surprise
- No stress index or tracking indicators visible on this screen — this is a rest state
- The header shows "not started" so the user knows the session has not begun yet

### Colors
- Background: `#0f0f0f` (same as interview screen for visual consistency)
- Start button: green border `#22c55e`, dark green background `#0D2E1A`
- Difficulty badge Easy: blue background `#1e3a5f`, blue text `#60a5fa`

---

## Screen 2: Calibration Overlay

### Purpose
Record the user's neutral behavioral baseline without making it feel like a test. Language and visual design must communicate warmth and low stakes.

### Layout
```
┌─────────────────────────────────────────────────────┐
│  (interview screen dimmed behind overlay)           │
│                                                     │
│         ◎                                           │
│                                                     │
│   Setting your personal baseline                    │
│                                                     │
│   Look naturally at the screen for 10 seconds.     │
│   CogniFlow is learning your neutral eye state.     │
│                                                     │
│   All scores will be relative to you —              │
│   not a generic average.                            │
│                                                     │
│   ████████████░░░░░░░░░░░░  68% complete            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Design decisions
- The overlay sits over the interview screen (not a separate route) so the transition out feels instant when calibration finishes
- The circle icon pulses slowly at 4 seconds — same rhythm as the breathing border — to begin conditioning the user's breathing before the interview starts
- Language says "learning your neutral eye state" not "measuring you" — positions the system as an ally
- Progress bar is amber during calibration — it turns green when complete
- When calibration finishes: overlay fades out in 500ms, interview begins immediately with no additional click required

### What appears after calibration completes
A small green badge in the face tracking panel (already built):
```
✓ Baseline set — neutral EAR: 0.0430
Blink threshold: 0.0301 (baseline × 0.70)
```

---

## Screen 3: Interview (updated from Week 3)

### Changes from Week 3 version
- Add session timer to header
- Add End Session button to header (red border, only visible during interview)
- Monaco Editor now loads starter code from the selected question

### Updated header layout
```
● CogniFlow   Interview Coach    Blinks: 14   Stress: 22%   04:32   [End Session]
```

### End Session button design
- Position: far right of header
- Border: `1px solid #ef4444`
- Background: `#1a0000`
- Text: `End Session` in red `#ef4444`
- On hover: background becomes slightly lighter
- Size: small, unobtrusive — 11px font

### Why small and red?
The button needs to be findable but not distracting. Red signals stop/danger which is appropriate for ending a session. Small size prevents accidental clicks while coding.

---

## Screen 4: Report Card

### Purpose
Turn raw stress data into something the user can learn from. Not a grade — a mirror.

### Layout
```
┌─────────────────────────────────────────────────────┐
│  ● CogniFlow   Session complete — Two Sum           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Avg      │ │ Peak     │ │ Blinks   │ │Duration│ │
│  │ stress   │ │ stress   │ │          │ │        │ │
│  │          │ │          │ │          │ │        │ │
│  │   28%    │ │   67%    │ │   38     │ │  8:34  │ │
│  │          │ │ at 2:40  │ │          │ │        │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│                                                     │
│  UNIFIED BEHAVIORAL TIMELINE                        │
│  [Recharts ComposedChart with Lines and Scatters]   │
│                                                     │
│  NEXT ATTEMPT COACHING                              │
│  ┌─────────────────────────────────────────────┐   │
│  │ Tense Disfluency Recovery                   │   │
│  │ Detected: 1 disfluency overlapping...       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  REFLECTION PROMPTS                                 │
│  ┌─────────────────────────────────────────────┐   │
│  │ Your stress peaked at 2:40. What were you   │   │
│  │ thinking about at that moment?              │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ What would you do differently if you        │   │
│  │ attempted this problem again?               │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│              [ Start New Session ]                  │
└─────────────────────────────────────────────────────┘
```

### Metric card colors
- Avg stress below 40%: green `#22c55e`
- Avg stress 40–69%: amber `#f59e0b`
- Avg stress 70%+: red `#ef4444`
- Peak stress: always amber (it is a spike, not a failure)
- Blinks and Duration: always white (neutral data)

### Reflection prompt design
- Left border accent `3px solid #3b82f6` (blue)
- Background: `#1a1a1a`
- Text: white, 12px
- No input field — these are prompts for private thought, not data collection

### Language rules for the report card
- Never say "you were stressed" — say "stress was elevated"
- Never say "you failed" or "you struggled" — say "stress peaked here"
- Always frame the peak as information, not judgment
- The reflection prompts end with a question mark — they invite, they do not accuse

### Recharts timeline and Coaching (Week 6)
The stress timeline is fully functional and implemented via a `ResponsiveContainer` and `ComposedChart` from `recharts`:
- Container layout: dark background (`#1a1a1a`) bounded by a subtle border (`1px solid #333`).
- Data plotting: Uses `sessionData` mapped dynamically onto X (`time`) and Y axes for continuous signals like `stress` and `facialTension` (Lines).
- Discrete Markers: Includes `Scatter` points for Pause, Rush, Freeze, Disfluency, and Tense Disfluency.
- Includes a responsive, dark-themed `Tooltip` rendered to inspect all discrete and continuous metrics per entry.
- **Next Attempt Coaching**: Dynamically generates cards (e.g., "Tense Disfluency Recovery") with meaning, strategy, and practice tips based on overlapping stress signals.

---

## Transition Animations

| Transition | Duration | Type |
|---|---|---|
| Lobby → Calibration overlay appears | 300ms | fade in |
| Calibration overlay → Interview | 500ms | fade out |
| Interview → Report card | 300ms | fade in |
| Report card → Lobby (new session) | instant | no animation — fresh start |

Use CSS opacity transitions. Do not use React animation libraries for this — they add unnecessary dependencies. A simple `transition: opacity 0.3s ease` on the overlay div is sufficient.

---

## Accessibility Notes

- The Start Interview button must be keyboard-accessible (it already will be as a `<button>`)
- The End Session button must never be reachable by tab during the interview — it should not pull focus away from the Monaco Editor
- All color changes (breathing border, metric card colors) should never be the only indicator — always pair color with text labels
- The calibration progress bar must have an `aria-label` for screen readers: `aria-label="Calibration progress"`

---

## Current Limitations / Out of Scope (For User Studies)

- **No algorithmic predictive modeling** — Currently, the stress fusion model leverages real-time discrete blink/audio thresholds correctly; complex ML models are reserved for later.
- **No replay functionality** — Video buffer playback click-to-replay handling is for future integration (requires shifting to WebRTC buffering, currently strictly frame analysis).
- **No user accounts or data persistence** — all data lives in memory for this prototype
- **No dark/light mode toggle** — dark mode only
- **No mobile layout** — desktop only for the prototype
- **No dynamic question generation** — fixed question bank of 5 problems as stated in proposal
