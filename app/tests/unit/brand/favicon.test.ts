import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// tests/unit/brand → app/tests/unit/brand → app/tests/unit → app/tests → app
const APP_ROOT = resolve(__dirname, '../../..');
const ICON = resolve(APP_ROOT, 'src/app/icon.svg');

/**
 * El favicon es un archivo estático: Next.js lo sirve desde `app/src/app/`.
 * No puede leer los tokens del tema, así que lleva los colores de la marca
 * escritos y una regla `prefers-color-scheme` para el modo oscuro.
 *
 * Estos tests lo atan al mismo asset que `BrandMark`: si cambia la
 * geometría del mark, tiene que cambiar en los dos lados.
 */
describe('favicon de dash-bi', () => {
  let source: string;

  beforeAll(() => {
    if (!existsSync(ICON)) {
      throw new Error(`Missing favicon: ${ICON}`);
    }
    source = readFileSync(ICON, 'utf8');
  });

  it('existe el archivo de favicon en la raíz de la app', () => {
    expect(existsSync(ICON)).toBe(true);
  });

  it('usa la misma geometría que el componente BrandMark', () => {
    expect(source).toContain('d="M12 34V14H25V25H30"');
    expect(source).toContain('stroke-width="9"');
    expect(source).toContain('cx="35"');
    expect(source).toContain('cy="25"');
    expect(source).toContain('r="6"');
  });

  it('lleva los colores de la marca: Signal Indigo y Review Magenta', () => {
    expect(source).toContain('#5048e5');
    expect(source).toContain('#de177a');
  });

  it('tiene una variante para el modo oscuro', () => {
    expect(source).toContain('prefers-color-scheme: dark');
  });
});
