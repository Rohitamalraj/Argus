// Decode a JSON file passed as a base64 secret (Render environment variables).
// Pasting a secret often drags in a PowerShell prompt, a line break or a doubled copy. Take the first complete
// JSON object out of whatever decodes, and fail with a clear message (never printing the content) if there is none.

/** The first balanced {...} object in `text`, or undefined. Braces inside strings are respected. */
export function firstJsonObject(text) {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break; // not valid from this brace; try the next one
        }
      }
    }
  }
  return undefined;
}

/** Decode `b64` into a JSON object. Returns { value } or { error } (a message that is safe to log). */
export function decodeJsonSecret(name, b64) {
  const compact = String(b64).replace(/\s+/g, '');
  // Extra characters before the real value shift the base64 alignment, so also try dropping 1 to 3 leading characters.
  for (let offset = 0; offset < 4; offset++) {
    let text = Buffer.from(compact.slice(offset), 'base64').toString('utf8');
    // someone pasted the base64 of a base64 string: decode once more
    if (!text.includes('{') && /^[A-Za-z0-9+/=]+$/.test(text.trim())) text = Buffer.from(text.trim(), 'base64').toString('utf8');
    const value = firstJsonObject(text);
    if (value) return { value };
  }
  return {
    error: `${name} did not decode to a JSON object (${compact.length} characters). Copy the full output of the command with "| clip" and paste it with nothing before or after it.`,
  };
}
