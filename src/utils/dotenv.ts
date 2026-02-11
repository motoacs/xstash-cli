const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseQuotedValue(raw: string): string {
  if (raw.length < 2) {
    return raw;
  }

  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }

  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return raw;
}

function stripInlineComment(raw: string): string {
  const commentIndex = raw.search(/\s#/);
  return commentIndex >= 0 ? raw.slice(0, commentIndex).trimEnd() : raw;
}

export async function loadDotEnvFromFile(path = '.env'): Promise<void> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const separatorIndex = withoutExport.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      continue;
    }

    if (Deno.env.get(key) !== undefined) {
      continue;
    }

    const rawValue = withoutExport.slice(separatorIndex + 1).trim();
    const normalized = parseQuotedValue(stripInlineComment(rawValue));
    Deno.env.set(key, normalized);
  }
}
