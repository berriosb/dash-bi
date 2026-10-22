// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { BrandMark } from '@/components/brand/BrandMark';

/**
 * El mark de dash-bi es "Escalones" en su variante 02: un perfil escalonado
 * dibujado con un trazo continuo y remates redondeados, cerrado por un nodo
 * circular en magenta.
 *
 * Estos tests fijan la geometría del asset: cualquier cambio en `d`, `cx`,
 * `cy` o `r` es un cambio de marca y debe pasar por una revisión explícita.
 */
describe('BrandMark', () => {
  it('dibuja el perfil escalonado con el trazo continuo de la variante 02', () => {
    const { container } = render(<BrandMark />);
    const path = container.querySelector('path');

    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toBe('M12 34V14H25V25H30');
    expect(path?.getAttribute('stroke-width')).toBe('9');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
    expect(path?.getAttribute('fill')).toBe('none');
  });

  it('cierra el perfil con el nodo circular de la variante 02', () => {
    const { container } = render(<BrandMark />);
    const node = container.querySelector('circle');

    expect(node).not.toBeNull();
    expect(node?.getAttribute('cx')).toBe('35');
    expect(node?.getAttribute('cy')).toBe('25');
    expect(node?.getAttribute('r')).toBe('6');
  });

  it('usa el token primary para el trazo y el accent para el nodo en la variante color', () => {
    const { container } = render(<BrandMark variant="color" />);
    const path = container.querySelector('path');
    const node = container.querySelector('circle');

    expect(path?.style.stroke).toBe('hsl(var(--color-primary-hsl))');
    expect(node?.style.fill).toBe('hsl(var(--color-accent-hsl))');
  });

  it('dibuja el nodo en el mismo tono que el trazo en la variante mono', () => {
    const { container } = render(<BrandMark variant="mono" />);
    const path = container.querySelector('path');
    const node = container.querySelector('circle');

    expect(path?.style.stroke).toBe('hsl(var(--color-primary-hsl))');
    expect(node?.style.fill).toBe('hsl(var(--color-primary-hsl))');
  });

  it('hereda el color del texto en la variante current, para impresión', () => {
    const { container } = render(<BrandMark variant="current" />);
    const path = container.querySelector('path');
    const node = container.querySelector('circle');

    expect(path?.style.stroke).toBe('currentColor');
    expect(node?.style.fill).toBe('currentColor');
  });

  it('es decorativo por defecto, porque el nombre siempre lo acompaña', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelector('title')).toBeNull();
  });

  it('expone un nombre accesible cuando se le pasa title', () => {
    const { container } = render(<BrandMark title="dash-bi" />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.querySelector('title')?.textContent).toBe('dash-bi');
  });

  it('aplica el tamaño solicitado en ambos lados', () => {
    const { container } = render(<BrandMark size={48} />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('48');
    expect(svg?.getAttribute('height')).toBe('48');
  });

  it('usa 28 px por defecto, el tamaño del bloque de marca del sidebar', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('28');
    expect(svg?.getAttribute('height')).toBe('28');
  });
});
