
export type Option = 'A' | 'B' | 'C' | 'D';

export interface BubbleCoordinate {
  cx: number;
  cy: number;
  radius: number; // Add this line to include the radius property
}

export interface BubbleTemplate {
  question: number;
  options: {
    A: BubbleCoordinate;
    B: BubbleCoordinate;
    C: BubbleCoordinate;
    D: BubbleCoordinate;
  };
    topic?: string;       // ✅ added
    competency?: string;  // ✅ added
    level?: string;       // ✅ added
}

// Fixed coordinates for a 20-question sheet (2-column layout)
// Left column: Q1–10, Right column: Q11–20
export const bubbles: BubbleTemplate[] = [



  // Column 1: Q1–10 (cx - 5)
  { question: 1, options: { A: { cx: 85, cy: 235, radius: 18 }, B: { cx: 125, cy: 235, radius: 18 }, C: { cx: 165, cy: 235, radius: 18 }, D: { cx: 205, cy: 235, radius: 18 } } },
  { question: 2, options: { A: { cx: 85, cy: 280, radius: 18 }, B: { cx: 125, cy: 280, radius: 18 }, C: { cx: 165, cy: 280, radius: 18 }, D: { cx: 205, cy: 280, radius: 18 } } },
  { question: 3, options: { A: { cx: 85, cy: 320, radius: 18 }, B: { cx: 125, cy: 320, radius: 18 }, C: { cx: 165, cy: 320, radius: 18 }, D: { cx: 205, cy: 320, radius: 18 } } },
  { question: 4, options: { A: { cx: 85, cy: 365, radius: 18 }, B: { cx: 125, cy: 365, radius: 18 }, C: { cx: 165, cy: 365, radius: 18 }, D: { cx: 205, cy: 365, radius: 18 } } },
  { question: 5, options: { A: { cx: 85, cy: 410, radius: 18 }, B: { cx: 125, cy: 410, radius: 18 }, C: { cx: 165, cy: 410, radius: 18 }, D: { cx: 205, cy: 410, radius: 18 } } },
  { question: 6, options: { A: { cx: 85, cy: 450, radius: 18 }, B: { cx: 125, cy: 450, radius: 18 }, C: { cx: 165, cy: 450, radius: 18 }, D: { cx: 205, cy: 450, radius: 18 } } },
  { question: 7, options: { A: { cx: 85, cy: 495, radius: 18 }, B: { cx: 125, cy: 495, radius: 18 }, C: { cx: 165, cy: 495, radius: 18 }, D: { cx: 205, cy: 495, radius: 18 } } },
  { question: 8, options: { A: { cx: 85, cy: 535, radius: 18 }, B: { cx: 125, cy: 535, radius: 18 }, C: { cx: 165, cy: 535, radius: 18 }, D: { cx: 205, cy: 535, radius: 18 } } },
  { question: 9, options: { A: { cx: 85, cy: 580, radius: 18 }, B: { cx: 125, cy: 580, radius: 18 }, C: { cx: 165, cy: 580, radius: 18 }, D: { cx: 205, cy: 580, radius: 18 } } },
  { question: 10, options: { A: { cx: 85, cy: 620, radius: 18 }, B: { cx: 125, cy: 620, radius: 18 }, C: { cx: 165, cy: 620, radius: 18 }, D: { cx: 205, cy: 620, radius: 18 } } },

  // Column 2: Q11–20
  { question: 11, options: { A: { cx: 350, cy: 235, radius: 18 }, B: { cx: 388, cy: 235, radius: 18 }, C: { cx: 427, cy: 235, radius: 18 }, D: { cx: 465, cy: 235, radius: 18 } } },
  { question: 12, options: { A: { cx: 350, cy: 280, radius: 18 }, B: { cx: 388, cy: 280, radius: 18 }, C: { cx: 427, cy: 280, radius: 18 }, D: { cx: 465, cy: 280, radius: 18 } } },
  { question: 13, options: { A: { cx: 350, cy: 320, radius: 18 }, B: { cx: 388, cy: 320, radius: 18 }, C: { cx: 427, cy: 320, radius: 18 }, D: { cx: 465, cy: 320, radius: 18 } } },
  { question: 14, options: { A: { cx: 350, cy: 365, radius: 18 }, B: { cx: 388, cy: 365, radius: 18 }, C: { cx: 427, cy: 365, radius: 18 }, D: { cx: 465, cy: 365, radius: 18 } } },
  { question: 15, options: { A: { cx: 350, cy: 410, radius: 18 }, B: { cx: 388, cy: 410, radius: 18 }, C: { cx: 427, cy: 410, radius: 18 }, D: { cx: 465, cy: 410, radius: 18 } } },
  { question: 16, options: { A: { cx: 350, cy: 450, radius: 18 }, B: { cx: 388, cy: 450, radius: 18 }, C: { cx: 427, cy: 450, radius: 18 }, D: { cx: 465, cy: 450, radius: 18 } } },
  { question: 17, options: { A: { cx: 350, cy: 495, radius: 18 }, B: { cx: 388, cy: 495, radius: 18 }, C: { cx: 427, cy: 495, radius: 18 }, D: { cx: 465, cy: 495, radius: 18 } } },
  { question: 18, options: { A: { cx: 350, cy: 535, radius: 18 }, B: { cx: 388, cy: 535, radius: 18 }, C: { cx: 427, cy: 535, radius: 18 }, D: { cx: 465, cy: 535, radius: 18 } } },
  { question: 19, options: { A: { cx: 350, cy: 580, radius: 18 }, B: { cx: 388, cy: 580, radius: 18 }, C: { cx: 427, cy: 580, radius: 18 }, D: { cx: 465, cy: 580, radius: 18 } } },
  { question: 20, options: { A: { cx: 350, cy: 620, radius: 18 }, B: { cx: 388, cy: 620, radius: 18 }, C: { cx: 427, cy: 620, radius: 18 }, D: { cx: 465, cy: 620, radius: 18 } } },

  // Column 3: Q21–30
  { question: 21, options: { A: { cx: 610, cy: 235, radius: 18 }, B: { cx: 650, cy: 235, radius: 18 }, C: { cx: 690, cy: 235, radius: 18 }, D: { cx: 730, cy: 235, radius: 18 } } },
  { question: 22, options: { A: { cx: 610, cy: 280, radius: 18 }, B: { cx: 650, cy: 280, radius: 18 }, C: { cx: 690, cy: 280, radius: 18 }, D: { cx: 730, cy: 280, radius: 18 } } },
  { question: 23, options: { A: { cx: 610, cy: 320, radius: 18 }, B: { cx: 650, cy: 320, radius: 18 }, C: { cx: 690, cy: 320, radius: 18 }, D: { cx: 730, cy: 320, radius: 18 } } },
  { question: 24, options: { A: { cx: 610, cy: 365, radius: 18 }, B: { cx: 650, cy: 365, radius: 18 }, C: { cx: 690, cy: 365, radius: 18 }, D: { cx: 730, cy: 365, radius: 18 } } },
  { question: 25, options: { A: { cx: 610, cy: 410, radius: 18 }, B: { cx: 650, cy: 410, radius: 18 }, C: { cx: 690, cy: 410, radius: 18 }, D: { cx: 730, cy: 410, radius: 18 } } },
  { question: 26, options: { A: { cx: 610, cy: 450, radius: 18 }, B: { cx: 650, cy: 450, radius: 18 }, C: { cx: 690, cy: 450, radius: 18 }, D: { cx: 730, cy: 450, radius: 18 } } },
  { question: 27, options: { A: { cx: 610, cy: 495, radius: 18 }, B: { cx: 650, cy: 495, radius: 18 }, C: { cx: 690, cy: 495, radius: 18 }, D: { cx: 730, cy: 495, radius: 18 } } },
  { question: 28, options: { A: { cx: 610, cy: 535, radius: 18 }, B: { cx: 650, cy: 535, radius: 18 }, C: { cx: 690, cy: 535, radius: 18 }, D: { cx: 730, cy: 535, radius: 18 } } },
  { question: 29, options: { A: { cx: 610, cy: 580, radius: 18 }, B: { cx: 650, cy: 580, radius: 18 }, C: { cx: 690, cy: 580, radius: 18 }, D: { cx: 730, cy: 580, radius: 18 } } },
  { question: 30, options: { A: { cx: 610, cy: 620, radius: 18 }, B: { cx: 650, cy: 620, radius: 18 }, C: { cx: 690, cy: 620, radius: 18 }, D: { cx: 730, cy: 620, radius: 18 } } },

  // Column 4: Q31–40
  { question: 31, options: { A: { cx: 85, cy: 690, radius: 18 }, B: { cx: 125, cy: 690, radius: 18 }, C: { cx: 165, cy: 690, radius: 18 }, D: { cx: 205, cy: 690, radius: 18 } } },
  { question: 32, options: { A: { cx: 85, cy: 730, radius: 18 }, B: { cx: 125, cy: 730, radius: 18 }, C: { cx: 165, cy: 730, radius: 18 }, D: { cx: 205, cy: 730, radius: 18 } } },
  { question: 33, options: { A: { cx: 85, cy: 775, radius: 18 }, B: { cx: 125, cy: 775, radius: 18 }, C: { cx: 165, cy: 775, radius: 18 }, D: { cx: 205, cy: 775, radius: 18 } } },
  { question: 34, options: { A: { cx: 85, cy: 815, radius: 18 }, B: { cx: 125, cy: 815, radius: 18 }, C: { cx: 165, cy: 815, radius: 18 }, D: { cx: 205, cy: 815, radius: 18 } } },
  { question: 35, options: { A: { cx: 85, cy: 860, radius: 18 }, B: { cx: 125, cy: 860, radius: 18 }, C: { cx: 165, cy: 860, radius: 18 }, D: { cx: 205, cy: 860, radius: 18 } } },
  { question: 36, options: { A: { cx: 85, cy: 905, radius: 18 }, B: { cx: 125, cy: 905, radius: 18 }, C: { cx: 165, cy: 905, radius: 18 }, D: { cx: 205, cy: 905, radius: 18 } } },
  { question: 37, options: { A: { cx: 85, cy: 945, radius: 18 }, B: { cx: 125, cy: 945, radius: 18 }, C: { cx: 165, cy: 945, radius: 18 }, D: { cx: 205, cy: 945, radius: 18 } } },
  { question: 38, options: { A: { cx: 85, cy: 990, radius: 18 }, B: { cx: 125, cy: 990, radius: 18 }, C: { cx: 165, cy: 990, radius: 18 }, D: { cx: 205, cy: 990, radius: 18 } } },
  { question: 39, options: { A: { cx: 85, cy: 1030, radius: 18 }, B: { cx: 125, cy: 1030, radius: 18 }, C: { cx: 165, cy: 1030, radius: 18 }, D: { cx: 205, cy: 1030, radius: 18 } } },
  { question: 40, options: { A: { cx: 85, cy: 1075, radius: 18 }, B: { cx: 125, cy: 1075, radius: 18 }, C: { cx: 165, cy: 1075, radius: 18 }, D: { cx: 205, cy: 1075, radius: 18 } } },

  // Column 5: Q41–50
  { question: 41, options: { A: { cx: 347, cy: 690, radius: 18 }, B: { cx: 387, cy: 690, radius: 18 }, C: { cx: 427, cy: 690, radius: 18 }, D: { cx: 467, cy: 690, radius: 18 } } },
  { question: 42, options: { A: { cx: 347, cy: 730, radius: 18 }, B: { cx: 387, cy: 730, radius: 18 }, C: { cx: 427, cy: 730, radius: 18 }, D: { cx: 467, cy: 730, radius: 18 } } },
  { question: 43, options: { A: { cx: 347, cy: 775, radius: 18 }, B: { cx: 387, cy: 775, radius: 18 }, C: { cx: 427, cy: 775, radius: 18 }, D: { cx: 467, cy: 775, radius: 18 } } },
  { question: 44, options: { A: { cx: 347, cy: 815, radius: 18 }, B: { cx: 387, cy: 815, radius: 18 }, C: { cx: 427, cy: 815, radius: 18 }, D: { cx: 467, cy: 815, radius: 18 } } },
  { question: 45, options: { A: { cx: 347, cy: 860, radius: 18 }, B: { cx: 387, cy: 860, radius: 18 }, C: { cx: 427, cy: 860, radius: 18 }, D: { cx: 467, cy: 860, radius: 18 } } },
  { question: 46, options: { A: { cx: 347, cy: 900, radius: 18 }, B: { cx: 387, cy: 900, radius: 18 }, C: { cx: 427, cy: 900, radius: 18 }, D: { cx: 467, cy: 900, radius: 18 } } },
  { question: 47, options: { A: { cx: 347, cy: 945, radius: 18 }, B: { cx: 387, cy: 945, radius: 18 }, C: { cx: 427, cy: 945, radius: 18 }, D: { cx: 467, cy: 945, radius: 18 } } },
  { question: 48, options: { A: { cx: 347, cy: 985, radius: 18 }, B: { cx: 387, cy: 985, radius: 18 }, C: { cx: 427, cy: 985, radius: 18 }, D: { cx: 467, cy: 985, radius: 18 } } },
  { question: 49, options: { A: { cx: 347, cy: 1030, radius: 18 }, B: { cx: 387, cy: 1030, radius: 18 }, C: { cx: 427, cy: 1030, radius: 18 }, D: { cx: 467, cy: 1030, radius: 18 } } },
  { question: 50, options: { A: { cx: 347, cy: 1073, radius: 18 }, B: { cx: 387, cy: 1073, radius: 18 }, C: { cx: 427, cy: 1073, radius: 18 }, D: { cx: 467, cy: 1073, radius: 18 } } },
    
  
  ];
