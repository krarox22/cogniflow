# CogniFlow — System Specification (Completed Weeks 1-6)

## Roadmap Status
**✓ DONE (Weeks 1-6):** Sensing + Calibration, Session lifecycle + Question bank, Stress fusion + Report card + Recharts.
**▶ PENDING (Weeks 7-12):** Pilot study (n=5), Milestone 2 video, Full user study (n=15-20), Analysis, Final paper, Demo video.

## Overview
This document specifies the exact build blocks that transitioned CogniFlow from a sensing prototype into the fully functional session-based application present today. All code features up to Week 6 are fully implemented.

---

## State Machine

The app currently jumps straight into calibration on load. This needs to change. The app must move through four phases in sequence:

```
LOBBY → CALIBRATING → INTERVIEWING → REPORT
```

Implement this as a single `phase` state variable in `App.jsx`:

```js
const [phase, setPhase] = useState('LOBBY')
```

Every major UI section conditionally renders based on this value. Nothing renders unless the phase matches.

---

## Week 4 — Session Lifecycle

### Task 1: Lobby Screen

**What it is:** The first screen the user sees when the app loads. It replaces the auto-start calibration.

**What it must contain:**
- CogniFlow header (already exists, keep it)
- The selected question displayed clearly: name, difficulty badge, and a 2–3 line description
- A Start Interview button — clicking this moves phase to `CALIBRATING`
- A small note below the button: "A 10-second calibration will run first"
- A "Next question →" link that cycles to the next question in the question bank

**What it must NOT contain:**
- No camera feed on this screen
- No stress index
- No face tracking

---

### Task 2: Calibration Trigger Fix

**What it is:** The calibration currently starts automatically when the camera loads. It should only start when the user clicks Start Interview on the lobby.

**What to change:**
- In the first `useEffect`, do not set `calibPhase` to `'calibrating'` automatically
- Instead, set `cameraReady` to true but keep `calibPhase` as `'idle'`
- When the user clicks Start Interview, set `calibPhase` to `'calibrating'` and record `calibStartRef.current = Date.now()`
- The calibration overlay appears only when `phase === 'CALIBRATING'`
- When calibration finishes (progress hits 100%), automatically move `phase` to `'INTERVIEWING'`

---

### Task 3: Session Timer

**What it is:** A live timer in the header showing how long the interview has been running.

**What to build:**
- A `sessionTime` state variable initialized to 0
- A `useEffect` that runs a `setInterval` every 1000ms when `phase === 'INTERVIEWING'`
- The interval increments `sessionTime` by 1 each second
- Display it in the header formatted as `MM:SS` — for example `04:32`
- Clear the interval when phase changes away from `INTERVIEWING`

**Display format function:**
```js
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}
```

---

### Task 4: End Session Button

**What it is:** A button the user clicks when they finish coding. It ends the session and moves to the report card.

**What to build:**
- A red-bordered button in the header that only shows when `phase === 'INTERVIEWING'`
- Clicking it sets `phase` to `'REPORT'`
- Clicking it also stops the session timer
- Clicking it freezes the final sessionData array so it can be read by the report card

---

### Task 5: Question Bank

**What it is:** A small JSON array of 5 interview problems. The lobby displays one at a time and the user can cycle through them.

**Create a new file:** `src/questions.js`

```js
export const questions = [
  {
    id: 1,
    title: 'Two Sum',
    difficulty: 'Easy',
    description: 'Given an array of integers and a target, return the indices of the two numbers that add up to the target.',
    starterCode: `function twoSum(nums, target) {\n  // your solution here\n}\n\nconsole.log(twoSum([2, 7, 11, 15], 9)); // [0, 1]`
  },
  {
    id: 2,
    title: 'Valid Palindrome',
    difficulty: 'Easy',
    description: 'Given a string, return true if it reads the same forward and backward, ignoring spaces and case.',
    starterCode: `function isPalindrome(s) {\n  // your solution here\n}\n\nconsole.log(isPalindrome('racecar')); // true`
  },
  {
    id: 3,
    title: 'FizzBuzz',
    difficulty: 'Easy',
    description: 'Print numbers 1 to n. For multiples of 3 print Fizz, for multiples of 5 print Buzz, for both print FizzBuzz.',
    starterCode: `function fizzBuzz(n) {\n  // your solution here\n}\n\nfizzBuzz(15);`
  },
  {
    id: 4,
    title: 'Reverse a String',
    difficulty: 'Easy',
    description: 'Write a function that reverses a string and returns the result.',
    starterCode: `function reverseString(s) {\n  // your solution here\n}\n\nconsole.log(reverseString('hello')); // 'olleh'`
  },
  {
    id: 5,
    title: 'Contains Duplicate',
    difficulty: 'Easy',
    description: 'Given an array of integers, return true if any value appears more than once.',
    starterCode: `function containsDuplicate(nums) {\n  // your solution here\n}\n\nconsole.log(containsDuplicate([1, 2, 3, 1])); // true`
  }
]
```

**In App.jsx:**
- Import questions: `import { questions } from './questions'`
- Add state: `const [questionIndex, setQuestionIndex] = useState(0)`
- Current question: `const currentQuestion = questions[questionIndex]`
- Next question button: `setQuestionIndex((questionIndex + 1) % questions.length)`
- Pass `currentQuestion.starterCode` as the `defaultValue` prop of Monaco Editor

---

## Week 5 — Data Logging and Basic Report Card

### Task 6: Session Data Logging

**What it is:** Every 2 seconds during the interview, save a snapshot of the current state to an array. This array powers the report card.

**What to build:**
- A `sessionData` ref: `const sessionDataRef = useRef([])`
- A `useEffect` that runs when `phase === 'INTERVIEWING'`
- Inside it, a `setInterval` every 2000ms that pushes a snapshot:

```js
sessionDataRef.current.push({
  time: formatTime(sessionTimeRef.current),
  stress: Math.round(stressScore),
  blinks: blinkCount,
  audioLevel: Math.round(audioLevelRef.current)
})
```

- Use a ref for sessionTime inside the interval to avoid stale closure: `const sessionTimeRef = useRef(0)`
- Keep `sessionTime` state for display, sync it with the ref on each tick
- Clear the interval when phase leaves `INTERVIEWING`

---

### Task 7: Basic Report Card Screen

**What it is:** A summary screen that shows after the user clicks End Session. No Recharts yet — just the four key numbers.

**What to display:**

Calculate these from `sessionDataRef.current` when phase becomes `REPORT`:

```js
const avgStress = Math.round(
  sessionData.reduce((sum, d) => sum + d.stress, 0) / sessionData.length
)
const peakStress = Math.max(...sessionData.map(d => d.stress))
const peakTime = sessionData.find(d => d.stress === peakStress)?.time
const totalBlinks = sessionData[sessionData.length - 1]?.blinks ?? 0
const duration = formatTime(sessionData.length * 2)
```

**Layout — four metric cards in a row:**
- Average stress (green if under 40, amber if under 70, red otherwise)
- Peak stress with timestamp below it
- Total blinks
- Session duration

**Below the cards:**
- Two reflection prompts as plain text questions:
  - "Your stress peaked at {peakTime}. What were you thinking about at that moment?"
  - "What would you do differently if you attempted this problem again?"

**A Start New Session button** at the bottom that resets everything:
- Sets `phase` back to `'LOBBY'`
- Clears `sessionDataRef.current` to `[]`
- Resets `sessionTime` to 0
- Resets `stressScore` to 0
- Resets `blinkCount` to 0

---

### Task 8: Unified Behavioral Timeline and Coaching

**What it is:** The stress timeline is upgraded to a unified behavioral timeline that plots multiple physiological markers simultaneously, coupled with actionable coaching cards based on behavior.

**What to build:**
- Update Recharts to use `ComposedChart` with lines for continuous signals (Stress, Facial tension).
- Add scatter points for discrete signals (Pause, Rush, Freeze, Disfluency, Tense Disfluency).
- Implement `generateCoachingCards` in `reportTimeline.js` to dynamically create coaching feedback for detected behavioral patterns, such as "Tense Disfluency Recovery".
- Render the Next Attempt Coaching section and Reflection Prompts within the Report Card view.

---

## File Structure (Current as of Week 6)

```
cogniflow/
├── src/
│   ├── App.jsx          ← main file, updated with state machine
│   ├── App.css          ← existing styles
│   ├── questions.js     ← NEW: question bank
│   └── main.jsx         ← unchanged
├── vite.config.js       ← unchanged (MediaPipe fix already in place)
└── package.json         ← unchanged
```

---

## Build Order

Do these in this exact order to avoid breaking what already works:

1. Add `questions.js` — no risk, standalone file
2. Add `phase` state to App.jsx, default to `'LOBBY'`
3. Build the lobby screen UI — wrap it in `{phase === 'LOBBY' && <LobbyScreen />}`
4. Fix calibration trigger — connect it to the Start button click
5. Add session timer
6. Add End Session button
7. Add session data logging
8. Build report card screen

Each step can be tested independently before moving to the next.
