# CogniFlow

**A browser-based prototype for reflecting on speech and facial signals during technical interview practice.**

CogniFlow combines a coding workspace with camera and microphone capture, live feedback, and a post-session timeline. It explores how signals arriving at different rates can be aligned into feedback a user can inspect after practice.

## Implemented features

- **Interview workspace:** practice questions and a Monaco code editor in React.
- **Facial signals:** MediaPipe Face Landmarker produces blendshapes, converted into smoothed expression and facial-tension indicators.
- **Speech feedback:** browser speech recognition supplies transcripts; text rules identify fillers, hedges, and disfluency patterns.
- **Audio cadence:** microphone activity supports pause and speech-rush indicators.
- **Event aggregation:** a Web Worker buffers signals for 10 seconds so transcript chunks can be attached to corresponding events before finalization.
- **Session review:** Recharts displays a unified timeline; rule-based coaching cards summarize selected patterns.

Expression labels and the displayed stress score are heuristic indicators, not validated measurements of emotions or psychological state.

## Architecture

```text
Camera -> MediaPipe blendshapes -> expression formulas + smoothing --+
                                                                   |
Microphone -> audio activity / cadence -----------------------------+-> event buffer
                                                                   |      |
Browser speech recognition -> transcript + disfluency rules --------+      v
                                                               session timeline
                                                               + coaching cards
```

The main thread handles face inference and the React interface. `useEmotionEngine` coordinates session state and worker messages. The aggregator associates speech chunks with buffered facial/audio events using session-relative timestamps. Session review combines these events with the recorded score timeline.

## Current status

The active transcription path uses `SpeechRecognition` / `webkitSpeechRecognition`. An audio-capture worklet and Tier 2 worker are also present, but **Whisper model loading is currently disabled** in `src/workers/tier2Worker.js` because of worker responsiveness issues. Installed libraries and earlier design documents should not be read as evidence that this path is active.

Some design documents describe earlier or proposed architectures. Source code is the reference for current behavior.

## Run locally

Use a recent Node.js release compatible with Vite 8, such as Node.js 22.12 or newer.

```bash
git clone https://github.com/krarox22/cogniflow.git
cd cogniflow
npm ci
npm run dev
```

Open the URL printed by Vite and allow camera and microphone access. MediaPipe resources load from external URLs and require network access. Speech-recognition support varies by browser; a Chromium-based browser is a practical starting point.

```bash
npm run build
npm run preview
```

## Tests and evaluation

```bash
npm test
```

The Vitest suite covers signal formulas, smoothing, cadence transitions, stress-score calculations, event serialization, timeline alignment, and coaching-card rules. These tests verify defined software behavior; they do not establish emotion-recognition accuracy or improvement in interview performance.

The repository does not report a controlled user study or a benchmark of coaching effectiveness. Potential experiments include measuring event-alignment error, comparing feedback rules against annotated sessions, and studying whether users find the feedback understandable and useful.

## Code guide

| File | Role |
| --- | --- |
| [`src/App.jsx`](src/App.jsx) | Interview interface, capture, MediaPipe setup, and review |
| [`src/hooks/useEmotionEngine.js`](src/hooks/useEmotionEngine.js) | Session coordination and browser transcription |
| [`src/workers/aggregatorWorker.js`](src/workers/aggregatorWorker.js) | Buffered signal aggregation and transcript alignment |
| [`src/workers/tier2Worker.js`](src/workers/tier2Worker.js) | Inactive Whisper transcription path |
| [`src/utils/emotionFormulas.js`](src/utils/emotionFormulas.js) | Blendshape-derived indicators and smoothing |
| [`src/utils/signals.js`](src/utils/signals.js) | Cadence, freeze, and disfluency rules |
| [`src/utils/reportTimeline.js`](src/utils/reportTimeline.js) | Unified timeline and coaching cards |
| [`src/utils/__tests__/`](src/utils/__tests__/) | Core utility tests |

## Technical scope

The project demonstrates multimodal interface implementation, worker coordination, asynchronous event alignment, and testable feedback rules. It uses pretrained face detection and browser speech recognition rather than training a new model.

Browser speech recognition may use the browser vendor's service; the application should not be described as entirely offline or entirely local.
