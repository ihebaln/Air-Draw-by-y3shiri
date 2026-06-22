/* ============================================================
   AIR DRAW — Complete Guide for Students
   Gesture-based drawing app using MediaPipe hand tracking
   ============================================================ */

// ── STATE CONTAINER ──────────────────────────────────────────────
// This object holds ALL the data our app needs to work
const state = {
  handLandmarker: null,           // The AI model that detects hands
  webcamStream: null,             // The video feed from your camera
  isReady: false,                 // Becomes true when everything is loaded

  // Drawing settings
  strokes: [],                    // Array of all completed drawings (each stroke is an object)
  currentStroke: null,            // The line you're currently drawing
  activeColor: '#00f0ff',         // Current color (cyan by default)
  thickness: 6,                   // Brush size in pixels
  glowIntensity: 60,              // Glow effect intensity (0-100)

  // Gesture tracking
  currentGesture: 'idle',         // What gesture is happening now ('idle', 'drawing', etc.)
  previousGesture: 'idle',        // The gesture from the last frame
  gestureStableFrames: 0,         // How many frames the gesture has been the same (for stability)
  gestureStartTime: 0,            // When the current gesture started (in milliseconds)

  isModalOpen: true,              // Is the onboarding popup showing?

  // Grab and move
  isGrabbing: false,              // Are we grabbing a stroke?
  grabStartPos: null,             // Where the grab started
  grabOffset: { x: 0, y: 0 },     // How much the grabbed stroke has moved
  totalOffset: { x: 0, y: 0 },    // Total movement since start
  nearestStrokeIdx: -1,           // Index of the stroke we're grabbing

  // Eraser
  eraserRadius: 28,               // Size of the eraser circle

  // Camera
  showCamera: true,               // Show the camera feed?
  cameraOpacity: 1.0,             // How transparent the camera is (1 = full brightness)

  // Particles (sparkles when you draw)
  particles: [],                  // Array of particle objects

  // Smoothing (makes drawing less jittery)
  smoothPos: { x: 0, y: 0 },      // Smoothed finger position
  smoothFactor: 0.35,             // How much smoothing to apply (0-1)

  // Canvas size
  width: 0,                       // Width of the browser window
  height: 0,                      // Height of the browser window

  // Audio
  audioCtx: null,                 // For playing sound effects
};

// ── DOM ELEMENTS ──────────────────────────────────────────────
// Get references to all HTML elements we need to control
const $ = (id) => document.getElementById(id);                    // Shortcut function for getting elements

const loadingScreen = $('loading-screen');                       // The loading animation screen
const appEl = $('app');                                         // The main app container
const webcamEl = $('webcam');                                   // The hidden video element
const cameraCanvas = $('camera-canvas');                        // Canvas for the camera feed
const drawingCanvas = $('drawing-canvas');                      // Canvas for drawings
const uiCanvas = $('ui-canvas');                                // Canvas for overlays (hands, cursor)

const cameraCtx = cameraCanvas.getContext('2d');                // Drawing context for camera canvas
const drawingCtx = drawingCanvas.getContext('2d');              // Drawing context for drawing canvas
const uiCtx = uiCanvas.getContext('2d');                        // Drawing context for UI canvas

const gestureHud = $('gesture-hud');                            // The bottom bar showing current gesture
const gestureIcon = $('gesture-icon');                          // The emoji in the gesture bar
const gestureLabel = $('gesture-label');                        // The text in the gesture bar

const thicknessSlider = $('thickness-slider');                  // Slider for brush size
const thicknessValue = $('thickness-value');                    // Label showing brush size number

const glowSlider = $('glow-slider');                            // Slider for glow effect
const glowValue = $('glow-value');                              // Label showing glow percentage

const cameraModeText = $('camera-mode-text');                   // Text showing camera mode (ON/DIM/OFF)
const cameraModeIndicator = $('camera-mode-indicator');         // The clickable camera indicator

const onboardingModal = $('onboarding-modal');                  // The popup that shows at startup
const btnStart = $('btn-start');                                // The "Let's Go!" button

// ── AUDIO SYSTEM ──────────────────────────────────────────────
// Creates simple sound effects for interactions

function getAudioCtx() {                                        // Gets or creates the audio context
  if (!state.audioCtx) {                                        // If we don't have one yet
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); // Create it
  }
  return state.audioCtx;                                        // Return the audio context
}

function playTone(freq, duration, type = 'sine', volume = 0.06) { // Play a beep sound
  try {                                                         // Try to play (might fail if no audio)
    const ctx = getAudioCtx();                                  // Get the audio context
    const osc = ctx.createOscillator();                         // Create an oscillator (makes sound)
    const gain = ctx.createGain();                              // Create a gain node (controls volume)
    osc.type = type;                                            // Set the wave type ('sine' is smooth)
    osc.frequency.setValueAtTime(freq, ctx.currentTime);       // Set the pitch (frequency)
    gain.gain.setValueAtTime(volume, ctx.currentTime);         // Set the volume
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration); // Fade out
    osc.connect(gain);                                          // Connect oscillator to gain
    gain.connect(ctx.destination);                              // Connect gain to speakers
    osc.start();                                                // Start the sound
    osc.stop(ctx.currentTime + duration);                       // Stop after duration
  } catch (e) { /* audio not available */ }                    // Ignore errors (no audio is OK)
}

function playDrawStart() { playTone(880, 0.08, 'sine', 0.04); } // Sound when you start drawing
function playDrawEnd() { playTone(440, 0.1, 'sine', 0.03); }    // Sound when you stop drawing
function playEraseSound() { playTone(200, 0.06, 'triangle', 0.03); } // Sound when erasing
function playGrabSound() { playTone(660, 0.1, 'sine', 0.05); }  // Sound when grabbing
function playDropSound() { playTone(330, 0.15, 'sine', 0.04); } // Sound when dropping
function playModeSwitch() { playTone(1200, 0.05, 'sine', 0.03); } // Sound when switching modes

// ── CANVAS SETUP ──────────────────────────────────────────────
// Makes the canvas fill the entire browser window

function resizeCanvases() {                                     // Called when window resizes
  const w = window.innerWidth;                                  // Get window width
  const h = window.innerHeight;                                 // Get window height
  state.width = w;                                              // Store width in state
  state.height = h;                                             // Store height in state
  
  [cameraCanvas, drawingCanvas, uiCanvas].forEach(c => {       // For each canvas
    c.width = w;                                                // Set width
    c.height = h;                                               // Set height
  });
}

window.addEventListener('resize', () => {                       // When window resizes
  resizeCanvases();                                             // Resize all canvases
  redrawStrokes();                                              // Redraw everything
});

// ── MEDIAPIPE LOADING ─────────────────────────────────────────
// Loads the hand tracking AI model

async function initMediaPipe() {                                // Async function (loads from internet)
  // Dynamically import MediaPipe's vision library from CDN
  const { FilesetResolver, HandLandmarker } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs'
  );

  const vision = await FilesetResolver.forVisionTasks(          // Set up the AI environment
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );

  state.handLandmarker = await HandLandmarker.createFromOptions(vision, { // Create the hand detector
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', // The AI model file
      delegate: 'GPU'                                           // Use GPU for faster processing
    },
    runningMode: 'VIDEO',                                       // We're processing video frames
    numHands: 1,                                                // Only track one hand
    minHandDetectionConfidence: 0.6,                            // 60% confidence needed (lower = faster)
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  return true;                                                  // Return success
}

// ── WEBCAM SETUP ──────────────────────────────────────────────
// Starts the camera

async function initWebcam() {                                   // Async function (waits for camera)
  const stream = await navigator.mediaDevices.getUserMedia({    // Request camera access
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } // 720p, front camera
  });
  webcamEl.srcObject = stream;                                  // Give the video element the camera stream
  state.webcamStream = stream;                                  // Store stream in state

  return new Promise((resolve) => {                             // Wait for video to load
    webcamEl.onloadedmetadata = () => {                         // When video metadata loads
      webcamEl.play();                                          // Start playing video
      resolve();                                                // Resolve the promise
    };
  });
}

// ── GESTURE DETECTION ────────────────────────────────────────
// Detects what gesture the hand is making

function detectGesture(landmarks) {                             // Takes hand landmarks as input
  if (!landmarks || landmarks.length === 0) return 'none';      // If no hand, return 'none'

  const lm = landmarks;                                         // Shorter variable name

  // Get specific finger landmarks (each finger has 4 points)
  const thumbTip = lm[4];                                       // Thumb tip
  const thumbIP = lm[3];                                        // Thumb middle joint
  const indexTip = lm[8];                                       // Index finger tip
  const indexPIP = lm[6];                                       // Index finger middle joint
  const middleTip = lm[12];                                     // Middle finger tip
  const middlePIP = lm[10];                                     // Middle finger middle joint
  const ringTip = lm[16];                                       // Ring finger tip
  const ringPIP = lm[14];                                       // Ring finger middle joint
  const pinkyTip = lm[20];                                      // Pinky tip
  const pinkyPIP = lm[18];                                      // Pinky middle joint

  // Check if each finger is UP (y decreases going up in screen coordinates)
  const indexUp = indexTip.y < indexPIP.y - 0.02;               // Is index finger raised? (with threshold)
  
  // Check if other fingers are DOWN (tip below middle joint)
  const middleDown = middleTip.y > middlePIP.y;                // Is middle finger curled?
  const ringDown = ringTip.y > ringPIP.y;                      // Is ring finger curled?
  const pinkyDown = pinkyTip.y > pinkyPIP.y;                   // Is pinky curled?

  // Check if fingers are UP (for open palm)
  const middleUp = middleTip.y < middlePIP.y;                  // Is middle finger raised?
  const ringUp = ringTip.y < ringPIP.y;                        // Is ring finger raised?
  const pinkyUp = pinkyTip.y < pinkyPIP.y;                     // Is pinky raised?
  const thumbOut = Math.abs(thumbTip.x - thumbIP.x) > 0.03 || thumbTip.y < thumbIP.y; // Is thumb out?

  // Pinch detection: thumb and index finger close together
  const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y); // Distance between thumb and index
  const isPinching = pinchDist < 0.06;                         // Are they close enough to pinch?

  // Now classify the gesture based on finger positions

  if (isPinching && !middleUp && !ringUp && !pinkyUp) {        // Pinch gesture (thumb + index)
    return 'pinch';
  }

  if (indexUp && middleUp && ringUp && pinkyUp && thumbOut) { // Open palm (all fingers up)
    return 'open_palm';
  }

  if (indexUp && middleDown && ringDown && pinkyDown) {       // Only index finger up = DRAWING
    return 'index_finger';
  }

  if (!indexUp && !middleUp && !ringUp && !pinkyUp) {         // All fingers down = FIST
    return 'fist';
  }

  return 'idle';                                               // Anything else = IDLE
}

// ── GESTURE STABILIZATION ─────────────────────────────────────
// Prevents gestures from flickering by requiring consistent frames

function stabilizeGesture(rawGesture) {                        // Takes raw gesture from detection
  if (rawGesture === state.currentGesture) {                   // If same as last frame
    state.previousGesture = rawGesture;                        // Store it
    state.gestureStableFrames = 0;                             // Reset counter
    return state.currentGesture;                               // Return current gesture
  }

  if (rawGesture === state.previousGesture) {                  // If same as previous frame
    state.gestureStableFrames++;                               // Increase stability counter
  } else {                                                     // If different
    state.previousGesture = rawGesture;                        // Store new candidate
    state.gestureStableFrames = 1;                             // Start counting
  }

  const threshold = rawGesture === 'pinch' ? 3 : 4;           // Pinch needs 3 frames, others need 4

  if (state.gestureStableFrames >= threshold) {                // If stable enough
    const oldGesture = state.currentGesture;                   // Store old gesture
    state.currentGesture = rawGesture;                         // Change to new gesture
    state.gestureStableFrames = 0;                             // Reset counter
    state.gestureStartTime = Date.now();                       // Record when gesture started

    if (oldGesture !== rawGesture) {                           // If gesture actually changed
      onGestureChange(oldGesture, rawGesture);                 // Handle the change
    }
    return rawGesture;                                         // Return new gesture
  }

  return state.currentGesture;                                 // Not stable yet, keep current
}

function onGestureChange(from, to) {                           // Called when gesture changes
  // Play sounds based on new gesture
  if (to === 'index_finger') playDrawStart();                 // Start drawing = sound
  else if (to === 'open_palm') playModeSwitch();              // Switch to erase = sound
  else if (to === 'pinch') playGrabSound();                   // Grab = sound
  else if (from === 'index_finger') playDrawEnd();            // Stop drawing = sound

  // End current stroke if we were drawing
  if (from === 'index_finger' && state.currentStroke) {       // If we were drawing
    if (state.currentStroke.points.length > 1) {              // If we drew something
      state.strokes.push({ ...state.currentStroke });         // Save it to completed strokes
    }
    state.currentStroke = null;                                // Clear current stroke
  }

  // End grab if we were grabbing
  if (from === 'pinch') {                                     // If we were grabbing
    endGrab();                                                 // End the grab
  }

  updateGestureHUD(to);                                       // Update the bottom bar
}

function updateGestureHUD(gesture) {                          // Updates the gesture bar at bottom
  const map = {                                               // Map gestures to icons and labels
    'index_finger': { icon: '☝️', label: 'Drawing', cls: 'drawing' },
    'open_palm':    { icon: '✋', label: 'Erasing', cls: 'erasing' },
    'pinch':        { icon: '🤏', label: 'Grab', cls: 'grabbing' },
    'fist':         { icon: '✊', label: 'Idle', cls: '' },
    'idle':         { icon: '🖐️', label: 'Ready', cls: '' },
    'none':         { icon: '👋', label: 'Show hand', cls: '' },
  };
  const info = map[gesture] || map['idle'];                   // Get info for current gesture
  gestureIcon.textContent = info.icon;                        // Set emoji
  gestureLabel.textContent = info.label;                      // Set label text
  gestureHud.className = info.cls;                            // Set CSS class for styling
}

// ── DRAWING LOGIC ──────────────────────────────────────────────

function getLandmarkPos(landmark) {                            // Convert AI coordinates to screen position
  return {                                                     // Mirror X (so it feels natural)
    x: (1 - landmark.x) * state.width,                        // X position (mirrored)
    y: landmark.y * state.height                               // Y position
  };
}

function smoothPosition(rawPos) {                             // Smooth out jittery finger movement
  state.smoothPos.x += (rawPos.x - state.smoothPos.x) * state.smoothFactor; // Blend towards raw position
  state.smoothPos.y += (rawPos.y - state.smoothPos.y) * state.smoothFactor; // (higher factor = more smooth)
  return { x: state.smoothPos.x, y: state.smoothPos.y };     // Return smoothed position
}

function handleDrawing(landmarks) {                           // Called when user is drawing
  const indexTip = landmarks[8];                              // Get index finger tip
  const rawPos = getLandmarkPos(indexTip);                   // Convert to screen position
  const pos = smoothPosition(rawPos);                         // Smooth the position

  // Buffer: Ignore drawing for first 300ms to avoid trailing lines from transition
  if (Date.now() - state.gestureStartTime < 300) {           // If gesture just started
    state.smoothPos = { ...rawPos };                         // Reset smooth position
    return;                                                   // Don't draw yet
  }

  if (!state.currentStroke) {                                // If not already drawing
    state.currentStroke = {                                   // Start a new stroke
      points: [pos],                                          // First point
      color: state.activeColor,                               // Current color
      thickness: state.thickness,                             // Current brush size
      glow: state.glowIntensity,                              // Current glow setting
    };
    state.smoothPos = { ...rawPos };                         // Reset smooth position
  } else {                                                   // If already drawing
    state.currentStroke.points.push({ ...pos });             // Add point to current stroke
  }

  emitParticles(pos.x, pos.y, state.activeColor);           // Create sparkles
  redrawStrokes();                                           // Redraw everything
}

function handleErasing(landmarks) {                          // Called when user is erasing
  const wrist = landmarks[0];                                // Get wrist position
  const middleMCP = landmarks[9];                            // Get middle finger base
  const palmCenter = {                                       // Calculate palm center (between wrist and middle)
    x: (1 - (wrist.x + middleMCP.x) / 2) * state.width,
    y: ((wrist.y + middleMCP.y) / 2) * state.height
  };

  const radius = state.eraserRadius;                         // Eraser size
  let erased = false;                                        // Track if we erased anything

  // Segment-based erasing: split strokes, keeping only points outside eraser
  const newStrokes = [];                                     // New array for strokes
  for (let i = 0; i < state.strokes.length; i++) {          // Loop through all strokes
    const stroke = state.strokes[i];                         // Get current stroke
    const segments = [];                                     // Array to hold segments
    let currentSegment = [];                                 // Current segment we're building

    for (const p of stroke.points) {                         // Loop through points in stroke
      const dx = p.x - palmCenter.x;                         // Distance from palm center (X)
      const dy = p.y - palmCenter.y;                         // Distance from palm center (Y)
      const dist = Math.sqrt(dx * dx + dy * dy);             // Total distance

      if (dist >= radius) {                                  // If point is outside eraser
        currentSegment.push(p);                               // Keep it in current segment
      } else {                                               // If point is inside eraser
        erased = true;                                       // We erased something!
        if (currentSegment.length >= 2) {                    // If segment has at least 2 points
          segments.push(currentSegment);                     // Save the segment
        }
        currentSegment = [];                                 // Start new segment
      }
    }

    if (currentSegment.length >= 2) {                        // Save the last segment
      segments.push(currentSegment);
    }

    if (segments.length === 0 && stroke.points.length > 0) { // Entire stroke erased (ignore)
      // (don't add anything back)
    } else if (segments.length === 1 && segments[0].length === stroke.points.length) { // Stroke untouched
      newStrokes.push(stroke);                               // Keep the whole stroke
    } else {                                                 // Stroke was split
      for (const seg of segments) {                          // For each segment
        newStrokes.push({                                    // Create a new stroke
          points: seg,
          color: stroke.color,
          thickness: stroke.thickness,
          glow: stroke.glow,
        });
      }
    }
  }

  state.strokes = newStrokes;                                // Replace strokes with new array

  if (erased) {                                              // If we erased something
    playEraseSound();                                         // Play erase sound
  }

  // Draw eraser circle on UI canvas (visual feedback)
  uiCtx.beginPath();                                         // Start drawing circle
  uiCtx.arc(palmCenter.x, palmCenter.y, radius, 0, Math.PI * 2); // Draw circle
  uiCtx.strokeStyle = 'rgba(255, 45, 107, 0.5)';            // Pink outline
  uiCtx.lineWidth = 1.5;                                     // Thin line
  uiCtx.setLineDash([5, 5]);                                 // Dashed line
  uiCtx.stroke();                                            // Draw outline
  uiCtx.setLineDash([]);                                     // Reset to solid
  uiCtx.fillStyle = 'rgba(255, 45, 107, 0.05)';             // Very faint pink fill
  uiCtx.fill();                                              // Fill the circle

  redrawStrokes();                                           // Redraw everything
}

function handleGrab(landmarks) {                             // Called when user is grabbing
  const thumbTip = landmarks[4];                             // Get thumb tip
  const indexTip = landmarks[8];                             // Get index tip
  const pinchPos = {                                         // Calculate pinch position (between thumb and index)
    x: (1 - (thumbTip.x + indexTip.x) / 2) * state.width,
    y: ((thumbTip.y + indexTip.y) / 2) * state.height
  };

  if (!state.isGrabbing) {                                   // If not already grabbing
    state.isGrabbing = true;                                 // Start grabbing
    state.grabStartPos = { ...pinchPos };                   // Store start position
    state.nearestStrokeIdx = findNearestStroke(pinchPos);   // Find the stroke nearest to pinch
  } else {                                                   // If already grabbing
    const dx = pinchPos.x - state.grabStartPos.x;           // How much X moved since start
    const dy = pinchPos.y - state.grabStartPos.y;           // How much Y moved since start

    if (state.nearestStrokeIdx >= 0 && state.nearestStrokeIdx < state.strokes.length) { // If we found a stroke
      const stroke = state.strokes[state.nearestStrokeIdx];  // Get that stroke
      const prevDx = state.grabOffset.x;                     // Previous offset X
      const prevDy = state.grabOffset.y;                     // Previous offset Y
      const deltaDx = dx - prevDx;                           // Change in X since last frame
      const deltaDy = dy - prevDy;                           // Change in Y since last frame
      
      for (let i = 0; i < stroke.points.length; i++) {      // Move every point in the stroke
        stroke.points[i].x += deltaDx;                       // Move X
        stroke.points[i].y += deltaDy;                       // Move Y
      }
    }

    state.grabOffset = { x: dx, y: dy };                    // Store new offset
  }

  // Draw grab indicator (gold ring on UI canvas)
  uiCtx.beginPath();                                         // Start drawing circle
  uiCtx.arc(pinchPos.x, pinchPos.y, 18, 0, Math.PI * 2);    // Draw circle
  uiCtx.strokeStyle = 'rgba(255, 215, 0, 0.7)';            // Gold outline
  uiCtx.lineWidth = 2;                                       // 2px thick
  uiCtx.stroke();                                            // Draw outline
  uiCtx.fillStyle = 'rgba(255, 215, 0, 0.1)';              // Gold fill (very faint)
  uiCtx.fill();                                              // Fill circle

  // Highlight grabbed stroke (glowing border)
  if (state.nearestStrokeIdx >= 0 && state.nearestStrokeIdx < state.strokes.length) {
    drawStrokeHighlight(state.strokes[state.nearestStrokeIdx]); // Highlight the grabbed stroke
  }

  redrawStrokes();                                           // Redraw everything
}

function endGrab() {                                         // Called when grab ends
  if (state.isGrabbing && state.nearestStrokeIdx >= 0) {    // If we were grabbing a stroke
    playDropSound();                                         // Play drop sound
  }

  state.isGrabbing = false;                                  // Turn off grabbing
  state.grabStartPos = null;                                 // Clear start position
  state.grabOffset = { x: 0, y: 0 };                        // Reset offset
  state.nearestStrokeIdx = -1;                               // Clear nearest stroke
  redrawStrokes();                                           // Redraw everything
}

function findNearestStroke(pos) {                            // Find the stroke closest to a position
  let minDist = Infinity;                                    // Start with infinite distance
  let nearestIdx = -1;                                       // No stroke found yet

  for (let i = 0; i < state.strokes.length; i++) {          // Loop through all strokes
    const stroke = state.strokes[i];                         // Get current stroke
    for (const p of stroke.points) {                        // Loop through points in stroke
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);       // Distance to point
      if (d < minDist) {                                     // If closer than previous
        minDist = d;                                         // Update minimum distance
        nearestIdx = i;                                      // Store the stroke index
      }
    }
  }

  return minDist < 80 ? nearestIdx : -1;                    // Return index if within 80px
}

function drawStrokeHighlight(stroke) {                       // Draw a glowing border around a stroke
  if (!stroke || stroke.points.length < 2) return;          // Need at least 2 points
  uiCtx.save();                                              // Save canvas state
  uiCtx.beginPath();                                         // Start path
  uiCtx.moveTo(stroke.points[0].x, stroke.points[0].y);    // Move to first point
  for (let i = 1; i < stroke.points.length; i++) {          // Loop through points
    uiCtx.lineTo(stroke.points[i].x, stroke.points[i].y);   // Draw line to point
  }
  uiCtx.strokeStyle = 'rgba(255, 215, 0, 0.3)';            // Gold color (faint)
  uiCtx.lineWidth = stroke.thickness + 12;                  // Thicker than the stroke
  uiCtx.lineCap = 'round';                                   // Round line ends
  uiCtx.lineJoin = 'round';                                  // Round line joins
  uiCtx.setLineDash([8, 8]);                                 // Dashed line
  uiCtx.stroke();                                            // Draw the outline
  uiCtx.setLineDash([]);                                     // Reset to solid
  uiCtx.restore();                                           // Restore canvas state
}

// ── STROKE RENDERING ──────────────────────────────────────────

function drawGlowStroke(ctx, stroke, isCurrentStroke = false) { // Draw a stroke with glow effect
  if (!stroke || stroke.points.length < 2) return;          // Need at least 2 points

  const pts = stroke.points;                                 // Get points
  const color = stroke.color;                                // Get color
  const width = stroke.thickness;                            // Get width
  const glowMult = stroke.glow / 100;                       // Convert glow to multiplier (0-1)

  ctx.save();                                                // Save canvas state
  ctx.lineCap = 'round';                                     // Round line ends
  ctx.lineJoin = 'round';                                    // Round line joins

  // Pass 1: Outer glow (big, blurry, faint)
  if (glowMult > 0) {                                        // If glow is enabled
    ctx.beginPath();                                         // Start path
    ctx.moveTo(pts[0].x, pts[0].y);                         // Move to first point
    for (let i = 1; i < pts.length; i++) {                  // Loop through points
      const prev = pts[i - 1];                               // Previous point
      const curr = pts[i];                                   // Current point
      const mx = (prev.x + curr.x) / 2;                     // Midpoint X (for smooth curve)
      const my = (prev.y + curr.y) / 2;                     // Midpoint Y
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);         // Smooth curve
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); // Last point
    ctx.strokeStyle = color;                                 // Use same color
    ctx.lineWidth = width * 3;                               // 3x wider
    ctx.globalAlpha = 0.1 * glowMult;                       // Very faint (10% of glow)
    ctx.shadowColor = color;                                 // Shadow color
    ctx.shadowBlur = 35 * glowMult;                         // Big blur
    ctx.stroke();                                            // Draw it
  }

  // Pass 2: Mid glow (medium, slightly blurry)
  if (glowMult > 0) {                                        // If glow is enabled
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 1.6;                             // 1.6x wider
    ctx.globalAlpha = 0.35 * glowMult;                      // 35% opacity
    ctx.shadowBlur = 15 * glowMult;                         // Medium blur
    ctx.stroke();
  }

  // Pass 3: Core line (solid, sharp)
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const mx = (prev.x + curr.x) / 2;
    const my = (prev.y + curr.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.strokeStyle = lightenColor(color, 0.5);               // Brighter version of color
  ctx.lineWidth = width;                                     // Normal width
  ctx.globalAlpha = 1;                                       // Fully opaque
  ctx.shadowBlur = 6 * glowMult;                            // Small blur
  ctx.shadowColor = color;                                   // Shadow color
  ctx.stroke();

  ctx.restore();                                             // Restore canvas state
}

function lightenColor(hex, amount) {                         // Make a hex color brighter
  const r = parseInt(hex.slice(1, 3), 16);                  // Get red value (0-255)
  const g = parseInt(hex.slice(3, 5), 16);                  // Get green value
  const b = parseInt(hex.slice(5, 7), 16);                  // Get blue value
  const nr = Math.min(255, Math.round(r + (255 - r) * amount)); // Lighten red
  const ng = Math.min(255, Math.round(g + (255 - g) * amount)); // Lighten green
  const nb = Math.min(255, Math.round(b + (255 - b) * amount)); // Lighten blue
  return `rgb(${nr}, ${ng}, ${nb})`;                         // Return new color
}

function redrawStrokes() {                                  // Redraw all strokes on the drawing canvas
  drawingCtx.clearRect(0, 0, state.width, state.height);   // Clear the canvas

  for (const stroke of state.strokes) {                    // Loop through all completed strokes
    drawGlowStroke(drawingCtx, stroke);                    // Draw each one
  }

  if (state.currentStroke && state.currentStroke.points.length > 1) { // If currently drawing
    drawGlowStroke(drawingCtx, state.currentStroke, true); // Draw current stroke (with glow)
  }
}

// ── PARTICLES (SPARKLES) ──────────────────────────────────────

function emitParticles(x, y, color) {                       // Create sparkles at a position
  for (let i = 0; i < 2; i++) {                             // Create 2 particles
    state.particles.push({                                  // Add to particle array
      x, y,                                                 // Position
      vx: (Math.random() - 0.5) * 3,                        // Random X velocity (-1.5 to 1.5)
      vy: (Math.random() - 0.5) * 3,                        // Random Y velocity
      life: 1,                                              // Full life
      decay: 0.02 + Math.random() * 0.03,                   // Random decay rate
      size: 2 + Math.random() * 3,                          // Random size (2-5)
      color,                                                // Same color as stroke
    });
  }
}

function updateAndDrawParticles(ctx) {                     // Update and draw all particles
  for (let i = state.particles.length - 1; i >= 0; i--) { // Loop backwards (for safe removal)
    const p = state.particles[i];                          // Get particle
    p.x += p.vx;                                           // Move X
    p.y += p.vy;                                           // Move Y
    p.life -= p.decay;                                     // Reduce life
    p.size *= 0.97;                                        // Shrink

    if (p.life <= 0) {                                     // If particle is dead
      state.particles.splice(i, 1);                        // Remove it
      continue;                                            // Skip to next
    }

    ctx.save();                                            // Save canvas state
    ctx.globalAlpha = p.life * 0.7;                       // Fade out with life
    ctx.fillStyle = p.color;                               // Same color
    ctx.shadowColor = p.color;                             // Glow color
    ctx.shadowBlur = 10;                                   // Glow size
    ctx.beginPath();                                       // Start drawing circle
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);            // Draw circle
    ctx.fill();                                            // Fill it
    ctx.restore();                                         // Restore canvas state
  }
}

// ── HAND SKELETON DRAWING ────────────────────────────────────

const HAND_CONNECTIONS = [                                 // Which hand landmarks connect to each other
  [0,1],[1,2],[2,3],[3,4],      // Thumb
  [0,5],[5,6],[6,7],[7,8],      // Index
  [0,9],[9,10],[10,11],[11,12], // Middle
  [0,13],[13,14],[14,15],[15,16], // Ring
  [0,17],[17,18],[18,19],[19,20], // Pinky
  [5,9],[9,13],[13,17],          // Palm connections
];

function drawHandSkeleton(ctx, landmarks) {                // Draw the hand skeleton overlay
  if (!landmarks) return;                                  // If no landmarks, do nothing

  ctx.save();                                              // Save canvas state
  ctx.globalAlpha = 0.3;                                   // Make it faint

  // Draw connections (lines between landmarks)
  for (const [a, b] of HAND_CONNECTIONS) {                // For each connection
    const pa = getLandmarkPos(landmarks[a]);              // Get position of first point
    const pb = getLandmarkPos(landmarks[b]);              // Get position of second point
    ctx.beginPath();                                       // Start path
    ctx.moveTo(pa.x, pa.y);                               // Move to first point
    ctx.lineTo(pb.x, pb.y);                               // Draw line to second point
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';        // White color (faint)
    ctx.lineWidth = 1.5;                                   // Thin line
    ctx.stroke();                                          // Draw the line
  }

  // Draw landmarks (dots at each point)
  for (let i = 0; i < landmarks.length; i++) {            // Loop through all landmarks
    const pos = getLandmarkPos(landmarks[i]);             // Get position
    ctx.beginPath();                                       // Start drawing circle
    ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);            // Draw circle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';          // White (faint)
    ctx.fill();                                            // Fill it
  }

  // Highlight fingertips (bigger, brighter dots)
  const tips = [4, 8, 12, 16, 20];                        // The landmarks that are fingertips
  for (const t of tips) {                                 // Loop through fingertips
    const pos = getLandmarkPos(landmarks[t]);             // Get position
    ctx.beginPath();                                       // Start drawing circle
    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);            // Bigger circle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';          // Brighter white
    ctx.shadowColor = '#ffffff';                           // White glow
    ctx.shadowBlur = 10;                                   // Glow size
    ctx.fill();                                            // Fill it
    ctx.shadowBlur = 0;                                   // Reset shadow
  }

  ctx.restore();                                           // Restore canvas state
}

// ── DRAWING CURSOR INDICATOR ────────────────────────────────

function drawCursorIndicator(ctx, landmarks, gesture) {   // Show where you're drawing
  if (gesture === 'index_finger') {                       // If we're drawing
    const pos = getLandmarkPos(landmarks[8]);             // Get index finger tip position
    ctx.save();                                           // Save canvas state
    
    // Outer ring
    ctx.beginPath();                                      // Start drawing circle
    ctx.arc(pos.x, pos.y, state.thickness / 2 + 6, 0, Math.PI * 2); // Circle
    ctx.strokeStyle = state.activeColor;                  // Current color
    ctx.lineWidth = 1.5;                                  // Thin outline
    ctx.globalAlpha = 0.5;                                // Faint
    ctx.shadowColor = state.activeColor;                  // Glow color
    ctx.shadowBlur = 8;                                   // Glow size
    ctx.stroke();                                         // Draw circle
    
    // Inner dot
    ctx.beginPath();                                      // Start drawing circle
    ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);            // Small circle
    ctx.fillStyle = state.activeColor;                   // Current color
    ctx.globalAlpha = 0.9;                                // Bright
    ctx.fill();                                           // Fill it
    ctx.restore();                                        // Restore canvas state
  }
}

// ── MAIN RENDER LOOP ──────────────────────────────────────────

let lastVideoTime = -1;                                   // Track last processed video frame

function renderLoop() {                                  // Main animation loop (runs 60x per second)
  if (!state.handLandmarker || !state.isReady) {        // If MediaPipe not ready
    requestAnimationFrame(renderLoop);                   // Wait and try again
    return;
  }

  const video = webcamEl;                                // Get video element
  const now = performance.now();                         // Current time

  // Draw camera feed (FULL BRIGHTNESS)
  cameraCtx.clearRect(0, 0, state.width, state.height); // Clear camera canvas
  cameraCtx.save();                                      // Save canvas state
  cameraCtx.translate(state.width, 0);                  // Move to right edge
  cameraCtx.scale(-1, 1);                               // Flip horizontally (mirror)
  cameraCtx.drawImage(video, 0, 0, state.width, state.height); // Draw the camera
  cameraCtx.restore();                                   // Restore canvas state

  uiCtx.clearRect(0, 0, state.width, state.height);     // Clear UI canvas

  // Process hand landmarks (skip if video not ready)
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;                   // Update last processed time

    const results = state.handLandmarker.detectForVideo(video, now); // Run AI on current frame

    if (results.landmarks && results.landmarks.length > 0) { // If hand detected
      const landmarks = results.landmarks[0];            // Get the first hand
      const rawGesture = detectGesture(landmarks);       // Detect gesture
      const gesture = stabilizeGesture(rawGesture);      // Stabilize it

      if (!state.isModalOpen) {                          // If onboarding is closed
        if (gesture === 'index_finger') handleDrawing(landmarks); // Draw
        if (gesture === 'open_palm') handleErasing(landmarks);    // Erase
        if (gesture === 'pinch') handleGrab(landmarks);           // Grab
        
        if (gesture !== 'index_finger' && state.currentStroke && state.currentStroke.points.length > 1) {
          state.strokes.push({ ...state.currentStroke }); // Save if not drawing
          state.currentStroke = null;
        }
      }

      drawHandSkeleton(uiCtx, landmarks);                // Draw hand overlay
      drawCursorIndicator(uiCtx, landmarks, gesture);    // Draw cursor
    } else {                                             // No hand detected
      if (state.currentGesture !== 'none') {             // If gesture was something
        onGestureChange(state.currentGesture, 'none');   // Change to 'none'
        state.currentGesture = 'none';
      }
      if (state.currentStroke && state.currentStroke.points.length > 1) { // If drawing
        state.strokes.push({ ...state.currentStroke });   // Save the stroke
        state.currentStroke = null;
        redrawStrokes();
      }
    }
  }

  updateAndDrawParticles(uiCtx);                        // Update and draw sparkles

  requestAnimationFrame(renderLoop);                    // Request next frame
}

// ── UI EVENT HANDLERS ──────────────────────────────────────────

// Color palette buttons
document.querySelectorAll('.color-swatch').forEach(btn => { // For each color button
  btn.addEventListener('click', () => {                   // When clicked
    document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active')); // Remove active from all
    btn.classList.add('active');                          // Mark this one as active
    state.activeColor = btn.dataset.color;               // Update active color
    playTone(1000, 0.05, 'sine', 0.03);                 // Play sound
  });
});

// Thickness slider
thicknessSlider.addEventListener('input', () => {        // When slider moves
  state.thickness = parseInt(thicknessSlider.value);     // Update thickness
  thicknessValue.textContent = `${state.thickness}px`;  // Update label
});

// Glow slider
glowSlider.addEventListener('input', () => {              // When slider moves
  state.glowIntensity = parseInt(glowSlider.value);      // Update glow
  glowValue.textContent = `${state.glowIntensity}%`;    // Update label
});

// Undo button
$('btn-undo').addEventListener('click', () => {          // When undo clicked
  if (state.strokes.length > 0) {                        // If there are strokes
    state.strokes.pop();                                 // Remove last stroke
    redrawStrokes();                                     // Redraw
    playTone(500, 0.08, 'sine', 0.03);                 // Play sound
  }
});

// Clear button
$('btn-clear').addEventListener('click', () => {         // When clear clicked
  state.strokes = [];                                    // Clear all strokes
  state.currentStroke = null;                            // Clear current stroke
  state.particles = [];                                  // Clear particles
  redrawStrokes();                                       // Redraw
  playTone(300, 0.15, 'triangle', 0.04);               // Play sound
});

// Camera toggle button (cycles: ON → DIM → OFF)
$('btn-camera-toggle').addEventListener('click', () => { // When camera button clicked
  if (state.showCamera && state.cameraOpacity > 0.7) {  // If camera is ON (full brightness)
    state.cameraOpacity = 0.4;                           // Change to DIM
    cameraModeText.textContent = 'Camera DIM';           // Update label
    cameraModeIndicator.classList.remove('dark-mode');
  } else if (state.showCamera && state.cameraOpacity <= 0.7) { // If camera is DIM
    state.showCamera = false;                            // Turn OFF
    state.cameraOpacity = 0;
    cameraModeText.textContent = 'Dark Canvas';          // Update label
    cameraModeIndicator.classList.add('dark-mode');
    $('btn-camera-toggle').classList.remove('active');
  } else {                                               // If camera is OFF
    state.showCamera = true;                             // Turn ON (full brightness)
    state.cameraOpacity = 1.0;
    cameraModeText.textContent = 'Camera ON';
    cameraModeIndicator.classList.remove('dark-mode');
    $('btn-camera-toggle').classList.add('active');
  }
  playModeSwitch();                                      // Play sound
});

// Click camera indicator to toggle too
cameraModeIndicator.addEventListener('click', () => {    // When indicator clicked
  $('btn-camera-toggle').click();                        // Trigger button click
});

// Save button
$('btn-save').addEventListener('click', () => {          // When save clicked
  const exportCanvas = document.createElement('canvas'); // Create temporary canvas
  exportCanvas.width = state.width;                      // Set width
  exportCanvas.height = state.height;                    // Set height
  const exportCtx = exportCanvas.getContext('2d');

  exportCtx.fillStyle = '#07070d';                      // Dark background
  exportCtx.fillRect(0, 0, state.width, state.height); // Fill

  exportCtx.drawImage(drawingCanvas, 0, 0);            // Copy drawing canvas

  const link = document.createElement('a');              // Create download link
  link.download = `air-draw-${Date.now()}.png`;        // Set filename
  link.href = exportCanvas.toDataURL('image/png');     // Convert to PNG
  link.click();                                          // Auto-download

  playTone(800, 0.1, 'sine', 0.04);                    // Play sound
});

// Onboarding start button
btnStart.addEventListener('click', () => {               // When "Let's Go" clicked
  onboardingModal.classList.add('hidden');               // Hide modal
  state.isModalOpen = false;                             // Mark as closed
  playTone(800, 0.1, 'sine', 0.04);                    // Play sound
  updateGestureHUD('idle');                             // Reset HUD
});

// ── INITIALIZATION ─────────────────────────────────────────────

async function init() {                                  // Main startup function
  resizeCanvases();                                      // Set initial canvas size

  try {
    const [mpReady] = await Promise.all([               // Load everything in parallel
      initMediaPipe(),                                  // Load MediaPipe
      initWebcam()                                      // Start camera
    ]);

    state.isReady = true;                               // Mark as ready

    const loaderFill = document.querySelector('.loader-bar-fill'); // Get loading bar
    loaderFill.style.animation = 'none';                // Stop animation
    loaderFill.style.width = '100%';                    // Fill completely
    loaderFill.style.transition = 'width 0.4s ease';   // Smooth fill

    setTimeout(() => {                                  // After 600ms
      loadingScreen.classList.add('fade-out');          // Fade out loading screen
      appEl.classList.remove('hidden');                 // Show the app
      onboardingModal.classList.remove('hidden');       // Show onboarding
    }, 600);

    setTimeout(() => {                                  // After 1200ms
      loadingScreen.style.display = 'none';            // Fully hide loading screen
    }, 1200);

    renderLoop();                                       // Start the main loop

  } catch (error) {                                     // If something fails
    console.error('Failed to initialize Air Draw:', error);
    document.querySelector('.loader-subtitle').textContent =  // Show error message
      'Error: Camera access required. Please allow camera permissions and reload.';
    document.querySelector('.loader-subtitle').style.color = '#ff2d6b';
    document.querySelector('.loader-bar').style.display = 'none';
  }
}

init();                                                 // Start the app!