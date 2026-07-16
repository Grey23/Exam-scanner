export type Option = 'A' | 'B' | 'C' | 'D';

export interface BubbleCoordinate {
  cx: number;
  cy: number;
  radius: number;
}

export interface BubbleTemplate {
  question: number;
  options: {
    A: BubbleCoordinate;
    B: BubbleCoordinate;
    C: BubbleCoordinate;
    D: BubbleCoordinate;
  };
  topic?: string;
  competency?: string;
  level?: string;
}

/**
 * ROBUST OMR TEMPLATE (50 Questions) - Optimized for OpenCV scanning
 * 
 * Layout improvements for reliability:
 * - Larger corner markers (55x55) - easier contour detection
 * - Increased bubble radius (16px) - better fill detection
 * - More spacing between bubbles (48px) - reduces bleed/ambiguity
 * - Increased row height (32px) - cleaner separation
 * - Sheet size: 800 x 1131 (A4 aspect ratio)
 */

const START_Y = 320;
const ROW_HEIGHT = 32;
const COL1_X = 158;
const COL2_X = 518;
const BUBBLE_GAP = 48;
const RADIUS = 16;

function generateBubbles(): BubbleTemplate[] {
  const template: BubbleTemplate[] = [];

  for (let i = 1; i <= 50; i++) {
    const isCol2 = i > 25;
    const rowIndex = isCol2 ? i - 26 : i - 1;
    const startX = isCol2 ? COL2_X : COL1_X;
    const cy = START_Y + rowIndex * ROW_HEIGHT;

    template.push({
      question: i,
      options: {
        A: { cx: startX, cy: cy, radius: RADIUS },
        B: { cx: startX + BUBBLE_GAP, cy: cy, radius: RADIUS },
        C: { cx: startX + BUBBLE_GAP * 2, cy: cy, radius: RADIUS },
        D: { cx: startX + BUBBLE_GAP * 3, cy: cy, radius: RADIUS },
      }
    });
  }

  return template;
}

export const bubbles: BubbleTemplate[] = generateBubbles();
