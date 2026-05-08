import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const bobAgentDef = {
  id: 'bob',
  name: 'Bob CLI',
  bin: 'bob',
  versionArgs: ['--version'],
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    // Bob automatically selects the best model for the task.
    // It does NOT accept a --model flag; model selection is internal.
  ],
  // Bob accepts prompt via stdin when -p is omitted. We use stdin instead of
  // -p flag to avoid Windows ENAMETOOLONG (CreateProcess ~32KB limit) with
  // long prompts that include complete skills and design-systems.
  // The daemon will write the prompt to child.stdin automatically.
  buildArgs: (_prompt, _imagePaths, extraAllowedDirs = [], _options = {}) => {
    const args = [];
    
    // Bob uses --output-format stream-json for structured streaming output
    args.push('--output-format', 'stream-json');
    
    // Non-interactive mode: auto-approve all actions (required for daemon usage)
    args.push('--yolo');
    
    // Bob does NOT accept --model flag; it selects models automatically
    // based on task requirements. Do not add model selection logic here.
    
    // Add extra allowed directories if provided
    // Bob uses --include-directories (not --add-dir) for workspace expansion
    const dirs = (extraAllowedDirs || []).filter(
      (d) => typeof d === 'string' && d.length > 0,
    );
    for (const d of dirs) {
      args.push('--include-directories', d);
    }
    
    return args;
  },
  // Bob reads prompt from stdin when -p flag is omitted
  promptViaStdin: true,
  // Bob outputs structured JSON events via --output-format stream-json
  // Uses dedicated bob-stream-json parser for Bob's specific event format
  streamFormat: 'bob-stream-json',
} satisfies RuntimeAgentDef;

// Made with Bob
