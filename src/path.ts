export function normalizePath(input: string): string {
  const absolute = input.startsWith('/');
  const trailingSlash = input.length > 1 && input.endsWith('/');
  const segments: string[] = [];

  for (const segment of input.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      const last = segments.at(-1);
      if (last && last !== '..') {
        segments.pop();
      } else if (!absolute) {
        segments.push('..');
      }
      continue;
    }
    segments.push(segment);
  }

  let normalized = `${absolute ? '/' : ''}${segments.join('/')}`;
  if (!normalized) {
    normalized = absolute ? '/' : '.';
  }
  if (trailingSlash && normalized !== '/') {
    normalized += '/';
  }
  return normalized;
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

export function relativePath(from: string, to: string): string {
  const fromAbsolute = from.startsWith('/');
  const toAbsolute = to.startsWith('/');
  if (fromAbsolute !== toAbsolute) {
    return normalizePath(to);
  }

  const fromParts = pathParts(from);
  const toParts = pathParts(to);
  let common = 0;

  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  return [
    ...Array.from({ length: fromParts.length - common }, () => '..'),
    ...toParts.slice(common),
  ].join('/');
}

export function dirnamePath(input: string): string {
  const stripped = stripTrailingSlashes(input);
  if (!stripped || stripped === '/') {
    return stripped === '/' ? '/' : '.';
  }
  const index = stripped.lastIndexOf('/');
  if (index < 0) {
    return '.';
  }
  if (index === 0) {
    return '/';
  }
  return stripped.slice(0, index);
}

export function basenamePath(input: string): string {
  const stripped = stripTrailingSlashes(input);
  if (!stripped || stripped === '/') {
    return '';
  }
  const index = stripped.lastIndexOf('/');
  return index < 0 ? stripped : stripped.slice(index + 1);
}

function pathParts(input: string): string[] {
  const normalized = normalizePath(input);
  if (normalized === '.' || normalized === '/') {
    return [];
  }
  return normalized.replace(/^\/+/, '').split('/');
}

function stripTrailingSlashes(input: string): string {
  return input.replace(/\/+$/, '') || (input.startsWith('/') ? '/' : '');
}
