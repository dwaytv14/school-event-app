import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Icons are registered one by one; an icon that is used but not registered shows up blank. */
describe('icons', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('registers every icon the screens use', () => {
    const templates = [
      'src/app/home/home.page.html',
      'src/app/shared/components/attendance-summary/attendance-summary.html',
      'src/app/shared/components/state-panel/state-panel.html',
    ].map(read).join('\n');
    const code = [
      'src/app/home/home.page.ts',
      'src/app/shared/components/state-panel/state-panel.ts',
      'src/app/home/parts/home-base.directive.ts',
    ].map(read).join('\n');

    const used = new Set<string>();
    for (const match of templates.matchAll(/(?:name|icon)="([a-z0-9-]+-outline)"/g)) used.add(match[1]);
    for (const match of templates.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*-outline)'/g)) used.add(match[1]);
    for (const match of code.matchAll(/icon: '([a-z0-9-]+-outline)'/g)) used.add(match[1]);

    const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    const registered = new Set([...code.matchAll(/\b([a-z][A-Za-z0-9]+Outline)\b/g)].map((match) => match[1]));
    const missing = [...used].filter((name) => !registered.has(camel(name)));

    expect(used.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
