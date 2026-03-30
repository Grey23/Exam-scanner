/**
 * OMR (Optical Mark Recognition) Configuration
 * Production-ready settings for mobile exam scanner
 * 
 * RECOMMENDED ANSWER SHEET SPECIFICATIONS:
 * ============================================
 * 
 * Paper Size: A4 (210mm x 297mm) or Letter (8.5" x 11")
 * Print Resolution: 300 DPI minimum (600 DPI recommended)
 * 
 * CORNER MARKERS:
 * - Size: 15mm x 15mm (0.6" x 0.6") solid black squares
 * - Position: 20mm from each corner (margin from edges)
 * - Style: 100% K (pure black), no grayscale
 * - Minimum contrast ratio: 10:1 against background
 * 
 * BUBBLE SPECIFICATIONS:
 * - Diameter: 12mm (0.47") for reliable detection
 * - Spacing: 8mm center-to-center horizontally between options
 * - Row spacing: 10mm between question rows
 * - Style: Hollow circles with 1.5pt stroke weight
 * - Fill target: Student should fill at least 70% of bubble area
 * 
 * LAYOUT FOR 50 QUESTIONS:
 * - Header area: 60mm height (for roll number, name, etc.)
 * - Questions area: 200mm height
 * - 2 columns of 25 questions each
 * - Column margin: 15mm from paper edge
 * - Column gap: 20mm between columns
 * 
 * PRINT GUIDELINES:
 * - Use pure black ink (K=100%, no CMY mix)
 * - White paper: 80-100 gsm, minimal texture
 * - Avoid glossy/coated paper (causes glare)
 * - Ensure printer calibration for accurate dimensions
 */

// =====================================================
// SHEET DIMENSIONS (in pixels at 800px width)
// =====================================================
export const SHEET_CONFIG = {
  // Normalized sheet size after perspective warp
  WIDTH: 800,
  HEIGHT: 1131, // A4 aspect ratio (1.414)

  // Header section (contains roll number, student info)
  HEADER_HEIGHT: 250,

  // Corner marker specifications
  CORNER_MARKER: {
    SIZE_MM: 15,           // 15mm x 15mm
    MARGIN_MM: 20,         // 20mm from edges
    MIN_AREA_RATIO: 0.002, // Min % of image area
    MAX_AREA_RATIO: 0.02,  // Max % of image area
    MIN_SOLIDITY: 0.85,    // How "solid" the marker must be
    ASPECT_MIN: 0.6,       // Min aspect ratio (near square)
    ASPECT_MAX: 1.6,       // Max aspect ratio (near square)
  },

  // Bubble specifications
  BUBBLE: {
    RADIUS_PX: 16,         // Bubble radius in pixels (warped image)
    SPACING_PX: 38,        // Horizontal spacing between bubble centers
    ROW_SPACING_PX: 45,    // Vertical spacing between question rows
    MIN_FILL_RATIO: 0.55,  // Minimum filled ratio to count as marked
    FILL_SEPARATION: 0.35, // Min separation between best and second-best
  },

  // Quality thresholds
  QUALITY: {
    MAX_TILT_ANGLE: 10,        // Max acceptable tilt in degrees
    SHADOW_THRESHOLD: 0.7,     // Cell mean < 70% of avg = shadow detected
    EDGE_MARGIN_RATIO: 0.05,   // Corners must be 5% away from edges
    MIN_CONFIDENCE: 0.5,       // Minimum confidence score to accept scan
  },

  // Detection thresholds
  DETECTION: {
    // Adaptive thresholding parameters
    ADAPTIVE_BLOCK_SIZE: 31,   // Must be odd
    ADAPTIVE_C: 15,            // Constant subtracted from mean

    // Morphological operations
    MORPH_KERNEL_SIZE: 5,      // For closing operation

    // Contour detection
    CONTOUR_APPROX_EPSILON: 0.02, // Polygon approximation factor

    // Bubble fill scoring
    INNER_RADIUS_RATIO: 0.55,  // Inner sampling region
    OUTER_RADIUS_RATIO: 1.55,  // Outer sampling region (background)
    MIN_FILL_SCORE: 12,        // Minimum fill score to consider
    MAX_FILL_SCORE: 26,        // Maximum expected fill score
  },

  // Camera capture settings
  CAMERA: {
    PREFERRED_WIDTH: 1920,
    PREFERRED_HEIGHT: 1080,
    MIN_PREVIEW_WIDTH: 640,
    MIN_PREVIEW_HEIGHT: 480,
    ERROR_ALERT_COOLDOWN_MS: 6000,
  },

  // Performance settings
  PERFORMANCE: {
    TEMPLATE_OFFSET_SEARCH_RADIUS: 14,
    SAMPLE_STEP_DIVISOR: 900,  // For corner marker detection
    MAX_PIXELS_PER_MARKER: 250,
  },
} as const;

// =====================================================
// THRESHOLD TUNING GUIDE
// =====================================================
export const THRESHOLD_TUNING = {
  /**
   * ADAPTIVE THRESHOLDING (for bubble detection):
   * 
   * ADAPTIVE_BLOCK_SIZE (odd number, typically 11-51):
   * - Larger values = more global threshold, better for uneven lighting
   * - Smaller values = more local adaptation, better for high contrast
   * - Recommended: 21-31 for mobile captures
   * 
   * ADAPTIVE_C (constant subtracted from mean):
   * - Higher values = more pixels become black (more sensitive)
   * - Lower values = fewer pixels become black (less sensitive)
   * - Recommended: 10-20 for typical answer sheets
   * 
   * BUBBLE FILL DETECTION:
   * 
   * MIN_FILL_RATIO (0.0 - 1.0):
   * - Percentage of bubble area that must be filled
   * - 0.55 = 55% filled (catches most pencil marks)
   * - Increase to 0.65 for stricter detection
   * - Decrease to 0.45 for lighter pencil marks
   * 
   * FILL_SEPARATION (0.0 - 1.0):
   * - Gap between best and second-best fill ratios
   * - Prevents multiple marks from being counted
   * - 0.35 = 35% separation required
   * - Increase for stricter single-mark detection
   */

  presets: {
    // For dark pencil/pen marks
    DARK_MARKS: {
      adaptiveBlockSize: 21,
      adaptiveC: 12,
      minFillRatio: 0.50,
      fillSeparation: 0.30,
    },
    // For light pencil marks
    LIGHT_MARKS: {
      adaptiveBlockSize: 31,
      adaptiveC: 18,
      minFillRatio: 0.45,
      fillSeparation: 0.25,
    },
    // For high-contrast printed sheets
    HIGH_CONTRAST: {
      adaptiveBlockSize: 15,
      adaptiveC: 8,
      minFillRatio: 0.60,
      fillSeparation: 0.40,
    },
    // For challenging lighting conditions
    LOW_LIGHT: {
      adaptiveBlockSize: 41,
      adaptiveC: 20,
      minFillRatio: 0.40,
      fillSeparation: 0.20,
    },
  },
};

// =====================================================
// ERROR HANDLING MESSAGES
// =====================================================
export const ERROR_MESSAGES = {
  PAPER_NOT_DETECTED: 'Paper not detected. Please align the whole sheet within the camera view.',
  PARTIAL_CAPTURE: 'Paper is partially cut off. Please capture the entire sheet.',
  TILT_TOO_SEVERE: 'Paper is tilted too much. Please hold the camera straight.',
  SHADOW_DETECTED: 'Shadow detected on sheet. Please improve lighting conditions.',
  MULTIPLE_MARKS: 'Multiple answers detected for question {q}. Please verify.',
  LOW_CONFIDENCE: 'Scan confidence is low. Please try again with better lighting.',
  OPENCV_NOT_READY: 'OpenCV is not ready. Please wait or restart the app.',
  CAMERA_PERMISSION_DENIED: 'Camera permission denied. Please allow camera access.',
  NO_ANSWER_KEY: 'No answer key found. Please set up the exam first.',
};

// =====================================================
// DEBUG VISUALIZATION COLORS
// =====================================================
export const DEBUG_COLORS = {
  CORNER_MARKER: 'lime',
  CORNER_LABEL: 'lime',
  QUAD_OUTLINE: 'rgba(0, 255, 0, 0.5)',
  CORRECT_ANSWER: 'lime',
  WRONG_ANSWER: 'red',
  CORRECT_ANSWER_HIGHLIGHT: 'yellow',
  UNANSWERED: 'blue',
  HEATMAP_HIGH: 'rgba(255, 0, 0, 0.5)',    // Red = high fill
  HEATMAP_LOW: 'rgba(0, 0, 255, 0.5)',     // Blue = low fill
};

// =====================================================
// TYPE DEFINITIONS
// =====================================================
export interface QualityMetrics {
  tiltAngle: number;
  shadowDetected: boolean;
  partialCapture: boolean;
  confidenceScore: number;
}

export interface ScanResult {
  id: number;
  headerImage: string;
  fullImage: string;
  answers: Array<{
    question: number;
    marked: 'A' | 'B' | 'C' | 'D' | null;
    correctAnswer: 'A' | 'B' | 'C' | 'D' | null;
    correct: boolean;
    topic?: string | null;
    competency?: string | null;
    level?: string | null;
  }>;
  score: number;
  total: number;
  subjectId: number;
  classId: number;
  studentId: number | null;
  rollNumber: string | null;
  studentName: string | null;
  timestamp: string;
  qualityMetrics?: QualityMetrics;
}

export interface ThresholdPreset {
  adaptiveBlockSize: number;
  adaptiveC: number;
  minFillRatio: number;
  fillSeparation: number;
}

/**
 * HELPER: Calculate bubble coordinates for a given sheet layout
 * Use this to generate bubble templates for different question counts
 */
export function generateBubbleTemplate(config: {
  sheetWidth: number;
  sheetHeight: number;
  headerHeight: number;
  numQuestions: number;
  numColumns: number;
  bubbleRadius: number;
  bubbleSpacing: number;
  rowSpacing: number;
  marginX: number;
}): Array<{
  question: number;
  options: {
    A: { cx: number; cy: number; radius: number };
    B: { cx: number; cy: number; radius: number };
    C: { cx: number; cy: number; radius: number };
    D: { cx: number; cy: number; radius: number };
  };
}> {
  const {
    sheetWidth,
    sheetHeight,
    headerHeight,
    numQuestions,
    numColumns,
    bubbleRadius,
    bubbleSpacing,
    rowSpacing,
    marginX,
  } = config;

  const questionsPerColumn = Math.ceil(numQuestions / numColumns);
  const columnWidth = (sheetWidth - 2 * marginX) / numColumns;

  const bubbles: Array<any> = [];

  for (let q = 1; q <= numQuestions; q++) {
    const colIndex = Math.floor((q - 1) / questionsPerColumn);
    const rowIndex = (q - 1) % questionsPerColumn;

    const columnStartX = marginX + colIndex * columnWidth + columnWidth / 2;
    const rowY = headerHeight + 50 + rowIndex * rowSpacing;

    // Center the 4 options within the column
    const optionsStartX = columnStartX - (1.5 * bubbleSpacing);

    bubbles.push({
      question: q,
      options: {
        A: { cx: optionsStartX, cy: rowY, radius: bubbleRadius },
        B: { cx: optionsStartX + bubbleSpacing, cy: rowY, radius: bubbleRadius },
        C: { cx: optionsStartX + 2 * bubbleSpacing, cy: rowY, radius: bubbleRadius },
        D: { cx: optionsStartX + 3 * bubbleSpacing, cy: rowY, radius: bubbleRadius },
      },
    });
  }

  return bubbles;
}

/**
 * HELPER: Print answer sheet layout specifications
 */
export function printSheetSpecs(): string {
  return `
╔══════════════════════════════════════════════════════════════╗
║         OMR ANSWER SHEET SPECIFICATIONS                       ║
╠══════════════════════════════════════════════════════════════╣
║  PAPER SIZE: A4 (210mm × 297mm) or Letter (8.5" × 11")       ║
║  PRINT RESOLUTION: 300 DPI minimum (600 DPI recommended)     ║
╠══════════════════════════════════════════════════════════════╣
║  CORNER MARKERS:                                              ║
║    • Size: 15mm × 15mm solid black squares                   ║
║    • Position: 20mm from each paper edge                      ║
║    • Style: 100% K (pure black), no grayscale                 ║
╠══════════════════════════════════════════════════════════════╣
║  BUBBLES:                                                     ║
║    • Diameter: 12mm (0.47")                                   ║
║    • Horizontal spacing: 8mm center-to-center                 ║
║    • Vertical spacing: 10mm between rows                       ║
║    • Style: Hollow circles, 1.5pt stroke                      ║
║    • Fill target: 70%+ of bubble area                          ║
╠══════════════════════════════════════════════════════════════╣
║  LAYOUT (50 questions):                                       ║
║    • Header area: 60mm height                                  ║
║    • Questions: 2 columns × 25 rows                            ║
║    • Column margin: 15mm from edges                            ║
║    • Column gap: 20mm                                          ║
╠══════════════════════════════════════════════════════════════╣
║  PRINT GUIDELINES:                                            ║
║    • Use pure black ink (K=100%)                              ║
║    • White uncoated paper: 80-100 gsm                         ║
║    • Avoid glossy paper (causes glare)                         ║
║    • Calibrate printer for accurate dimensions                 ║
╚══════════════════════════════════════════════════════════════╝
`.trim();
}
