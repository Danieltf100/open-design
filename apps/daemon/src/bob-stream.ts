// @ts-nocheck
/**
 * Bob CLI stream parser
 * 
 * Parses Bob's JSON line-delimited stream format into Open Design events.
 * Bob emits events with types: init, message, tool_use, tool_result, result
 */

export function createBobStreamHandler(onEvent) {
  let buffer = '';

  function feed(chunk) {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      
      let event;
      try {
        event = JSON.parse(line);
      } catch (err) {
        // Invalid JSON - log and skip
        console.warn(`[bob-stream] Failed to parse line: ${err.message}`);
        onEvent({ type: 'raw', line });
        continue;
      }
      
      handleEvent(event);
    }
  }

  function flush() {
    const rem = buffer.trim();
    buffer = '';
    if (!rem) return;
    
    try {
      handleEvent(JSON.parse(rem));
    } catch (err) {
      console.warn(`[bob-stream] Failed to parse final line: ${err.message}`);
      onEvent({ type: 'raw', line: rem });
    }
  }

  function handleEvent(event) {
    if (!event || typeof event !== 'object') return;
    
    switch (event.type) {
      case 'init':
        // Session initialization - emit status event
        onEvent({
          type: 'status',
          label: 'initializing',
          model: event.model ?? null,
          sessionId: event.session_id ?? null,
        });
        break;
        
      case 'message':
        if (event.role === 'assistant' && event.content) {
          // Assistant message content (streaming or complete)
          // delta: true means streaming chunk, false means complete message
          onEvent({
            type: 'text_delta',
            delta: event.content,
          });
        }
        break;
        
      case 'tool_use':
        // Tool call from the agent
        onEvent({
          type: 'tool_use',
          id: event.tool_id,
          name: event.tool_name,
          input: event.parameters || {},
        });
        break;
        
      case 'tool_result':
        // Tool execution result
        onEvent({
          type: 'tool_result',
          toolUseId: event.tool_id,
          content: event.output || '',
          isError: event.status !== 'success',
        });
        break;
        
      case 'result':
        // Final result with stats - emit usage if available
        if (event.status === 'success' && event.stats) {
          const usage = {};
          if (typeof event.stats.input_tokens === 'number') {
            usage.input_tokens = event.stats.input_tokens;
          }
          if (typeof event.stats.output_tokens === 'number') {
            usage.output_tokens = event.stats.output_tokens;
          }
          if (typeof event.stats.total_tokens === 'number') {
            usage.total_tokens = event.stats.total_tokens;
          }
          
          if (Object.keys(usage).length > 0) {
            onEvent({
              type: 'usage',
              usage,
              durationMs: typeof event.stats.duration_ms === 'number' 
                ? event.stats.duration_ms 
                : undefined,
            });
          }
        }
        break;
        
      default:
        // Unknown event type - log but don't fail
        console.warn(`[bob-stream] Unknown event type: ${event.type}`);
        onEvent({ type: 'raw', line: JSON.stringify(event) });
        break;
    }
  }

  return { feed, flush };
}