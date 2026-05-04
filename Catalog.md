# CogniFlow Project Catalog

## Project Overview
**Track:** Development Track  
**Project Name:** CogniFlow  
**Description:** CogniFlow is a behavioral tracking and interview coaching application. It leverages real-time computer vision (MediaPipe) and audio analysis to build a personal baseline and deliver a "Unified Behavioral Timeline" of stress, facial tension, and speech disfluencies. It then provides actionable Next Attempt Coaching cards to help users improve their technical communication under pressure.

## Archive Contents

### 1. Source Code (`/src`, `index.html`, `package.json`, `vite.config.js`)
Contains the full React and Vite frontend application. 
- **`src/App.jsx`**: The core application logic, state machine, unified behavioral timeline (Recharts), and coaching feedback integration.
- **`src/hooks/useEmotionEngine.js`**: Custom hook managing the real-time processing of camera and microphone inputs.
- **`src/utils/reportTimeline.js`**: Logic for aggregating signal events into a chartable timeline and generating targeted coaching cards (e.g., Tense Disfluency Recovery).
- **`src/questions.js`**: The local question bank containing coding problems used in the session.

### 2. Design and Documentation Documents
- **`SPEC.md`**: Outlines the system specification, application state machine (Lobby → Calibrating → Interviewing → Report), and task progression up to Week 6.
- **`DESIGN.md`**: Details the design principles, UI layout decisions, and the user experience logic for the prototype (e.g., zero extraneous cognitive load, ipsative fairness).
- **`FAILPROOF.md`**: A comprehensive breakdown of edge cases, camera/mic permission failures, state recovery, and performance mitigations.

## How to Run the Tool Locally
This application is built using React and Vite. To run it locally on your machine:
1. Ensure you have **Node.js** installed.
2. Unzip the project archive and open a terminal in the root directory.
3. Run `npm install` to install dependencies.
4. Run `npm run dev` to start the local development server.
5. Open the provided `localhost` URL in your web browser. Note: You must grant Camera and Microphone permissions to use the application.

## Hosted Demo (If Applicable)
*(Add your Vercel, Netlify, or GitHub Pages link here if you deployed it online)*

## Additional Materials
*(Add links to any final demo videos, Milestone 2 videos, or presentation slides here. Ensure they are accessible to anyone with a Georgia Tech account!)*
