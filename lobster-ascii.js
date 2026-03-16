/**
 * Lobster ASCII Avatar Animation Frames
 * 
 * Each animation is an array of frames, where each frame is an array of lines.
 * All frames within an animation have IDENTICAL dimensions to prevent jitter.
 * 
 * Canvas size: 14 chars wide × 3 lines tall (compact version)
 * 
 * Usage:
 *   import { animations, getFrame, validateAlignment } from './lobster-ascii.js';
 *   const frame = getFrame('happy', frameIndex);
 */

// Strict dimensions for alignment
const CANVAS_WIDTH = 14;
const CANVAS_HEIGHT = 3;

/**
 * Pad a line to exact width
 */
function padLine(line, width = CANVAS_WIDTH) {
  if (line.length > width) {
    return line.slice(0, width);
  }
  return line + ' '.repeat(width - line.length);
}

/**
 * Normalize a frame to exact dimensions
 */
function normalizeFrame(frame) {
  // Ensure correct number of lines
  while (frame.length < CANVAS_HEIGHT) {
    frame.push('');
  }
  // Pad each line
  return frame.slice(0, CANVAS_HEIGHT).map(line => padLine(line));
}

// Raw animation data - REFINED for stable body positioning
// Body core )=[face]=( stays centered at position 2-11
// Only antennae, claws, and decorations animate
const rawAnimations = {
  idle: {
    frameRate: 800,
    loop: true,
    frames: [
      [
        "  \\|  |/     ",  // antennae slightly apart
        "  )=[°_°]=(  ",
        "    /^^\\     "
      ],
      [
        "  \\|  |/     ",  // same position
        "  )=[°‿°]=(  ",  // subtle smile
        "    /^^\\     "
      ],
      [
        "   \\||/      ",  // antennae together
        "  )=[°_°]=(  ",
        "    /^^\\     "
      ]
    ]
  },
  
  happy: {
    frameRate: 250,
    loop: true,
    frames: [
      [
        " \\|    |/    ",  // antennae wide
        "  )=[^_^]=(  ",
        "    /^^\\     "
      ],
      [
        "  \\|  |/     ",  // bounce up (less space below)
        "  )=[^o^]=(  ",
        "   /^^\\      "
      ],
      [
        " \\|    |/    ",
        "  )=[^‿^]=(  ",
        "    /^^\\     "
      ],
      [
        "  \\|  |/     ",  // bounce up
        "  )=[^_^]=(  ",
        "   /^^\\      "
      ]
    ]
  },
  
  sleepy: {
    frameRate: 1500,
    loop: true,
    frames: [
      [
        "   \\\\//      ",  // droopy antennae
        "  )=[- -]=(  ",
        "    /^^\\     "
      ],
      [
        "    \\/       ",  // more droopy
        "  )=[-_-]=(  ",  // eyes closed more
        "    /^^\\     "
      ]
    ]
  },
  
  overwhelmed: {
    frameRate: 80,
    loop: true,
    frames: [
      [
        " ~\\|  |/     ",  // shake left
        " ~)=[@_@]=( ",
        "  ~/^^\\      "
      ],
      [
        "  \\|  |/     ",  // center
        "  )=[@_@]=(  ",
        "   /^^\\      "
      ],
      [
        "  \\|  |/~    ",  // shake right
        "  )=[@_@]=(~ ",
        "   /^^\\~     "
      ]
    ]
  },
  
  thinking: {
    frameRate: 700,
    loop: true,
    frames: [
      [
        "  \\|  |/     ",
        "  )=[o_o]=(  ",
        "    /^^\\   ° "   // thought bubble starting
      ],
      [
        "  \\|  |/   ° ",  // bubble rising
        "  )=[o.o]=(  ",
        "    /^^\\     "
      ],
      [
        "  \\|  |/ °°  ",  // bubble at top
        "  )=[ō_ō]=(  ",
        "    /^^\\     "
      ]
    ]
  },
  
  frustrated: {
    frameRate: 350,
    loop: true,
    frames: [
      [
        "  \\|  |/     ",
        "  )=X>_<X=(  ",  // claws crossing
        "    /^^\\     "
      ],
      [
        "  \\|  |/     ",
        " (=X>_<X=)   ",  // claws fully crossed
        "    /^^\\     "
      ],
      [
        "  \\|  |/     ",
        "  X=>_<=X    ",  // arms akimbo
        "    /^^\\     "
      ]
    ]
  }
};

// Normalize all frames
const animations = {};
for (const [name, anim] of Object.entries(rawAnimations)) {
  animations[name] = {
    ...anim,
    frames: anim.frames.map(normalizeFrame)
  };
}

/**
 * Get a specific frame from an animation
 */
function getFrame(animationName, frameIndex) {
  const anim = animations[animationName];
  if (!anim) return null;
  const idx = frameIndex % anim.frames.length;
  return anim.frames[idx];
}

/**
 * Get a frame as a single string (lines joined with newlines)
 */
function getFrameString(animationName, frameIndex) {
  const frame = getFrame(animationName, frameIndex);
  return frame ? frame.join('\n') : null;
}

/**
 * Validate that all frames in an animation have identical dimensions
 */
function validateAlignment() {
  const issues = [];
  
  for (const [name, anim] of Object.entries(animations)) {
    for (let i = 0; i < anim.frames.length; i++) {
      const frame = anim.frames[i];
      
      // Check height
      if (frame.length !== CANVAS_HEIGHT) {
        issues.push(`${name}[${i}]: height=${frame.length}, expected=${CANVAS_HEIGHT}`);
      }
      
      // Check width of each line
      for (let j = 0; j < frame.length; j++) {
        if (frame[j].length !== CANVAS_WIDTH) {
          issues.push(`${name}[${i}][${j}]: width=${frame[j].length}, expected=${CANVAS_WIDTH}`);
        }
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Get list of animation names
 */
function getAnimationNames() {
  return Object.keys(animations);
}

/**
 * Get animation metadata
 */
function getAnimationInfo(name) {
  const anim = animations[name];
  if (!anim) return null;
  return {
    name,
    frameCount: anim.frames.length,
    frameRate: anim.frameRate,
    loop: anim.loop,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT
  };
}

// Export for ES modules
export {
  animations,
  getFrame,
  getFrameString,
  validateAlignment,
  getAnimationNames,
  getAnimationInfo,
  CANVAS_WIDTH,
  CANVAS_HEIGHT
};

// Export for CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    animations,
    getFrame,
    getFrameString,
    validateAlignment,
    getAnimationNames,
    getAnimationInfo,
    CANVAS_WIDTH,
    CANVAS_HEIGHT
  };
}
