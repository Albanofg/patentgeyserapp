/**
 * Robust helper to parse audit data from n8n webhook responses
 * Handles various formats:
 * - Direct object: {audit_log: [...]}
 * - Array with one audit object: [{audit_log: [...]}]
 * - Array with multiple audit objects: [{agent: "Advocate", audit_log: [...]}, {agent: "Examiner", audit_log: [...]}]
 * - JSON with leading text/metadata
 * - With or without markdown code fences
 */
export function parseAuditData(message: string): any | null {
  if (!message) return null;
  
  try {
    // Remove leading/trailing whitespace
    let cleanedMessage = message.trim();
    
    // Remove markdown code fences if present
    if (cleanedMessage.includes('```')) {
      cleanedMessage = cleanedMessage.replace(/^```(?:json|javascript)?\s*/m, '').replace(/\s*```$/m, '');
    }
    
    // Try to extract JSON from text (handles cases where there's explanatory text before JSON)
    const jsonMatch = cleanedMessage.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanedMessage = jsonMatch[0];
    }
    
    const parsed = JSON.parse(cleanedMessage);
    
    // Handle array format - check ALL elements, not just the first
    if (Array.isArray(parsed)) {
      // Look for ANY element with audit_log
      for (const item of parsed) {
        if (item && typeof item === 'object' && item.audit_log && Array.isArray(item.audit_log)) {
          return item; // Return first valid audit object found
        }
      }
      
      // Check if the array itself IS the audit_log (array of items with status field)
      if (parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'status' in parsed[0]) {
        // Filter out DISMISSED items - these mean "nothing to audit"
        const validItems = parsed.filter((item: any) => item.status !== "DISMISSED");
        if (validItems.length > 0) {
          return { audit_log: validItems };
        }
        // If all items are DISMISSED, return null to show "nothing to audit" message
        return null;
      }
      
      return null;
    }
    
    // Handle direct object format
    if (parsed && typeof parsed === 'object' && parsed.audit_log && Array.isArray(parsed.audit_log)) {
      return parsed;
    }
    
    // Handle nested formats like {result: {audit_log: [...]}}
    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        const value = parsed[key];
        if (value && typeof value === 'object' && value.audit_log && Array.isArray(value.audit_log)) {
          return value;
        }
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if agent messages contain audit format data
 */
export function hasAuditFormat(agentsDebate: any[]): boolean {
  if (!Array.isArray(agentsDebate)) return false;
  
  return agentsDebate.some((agent: any) => {
    if (!agent || !agent.message) return false;
    return parseAuditData(agent.message) !== null;
  });
}
