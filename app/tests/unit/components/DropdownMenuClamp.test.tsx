// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Regression lock for an off-screen clipping bug that no gate can catch.
 *
 * `DropdownMenuContent` shipped shadcn's `overflow-hidden` without the stock
 * `max-h-[var(--radix-dropdown-menu-content-available-height)]` clamp. Radix
 * exposes that CSS variable but never applies `maxHeight` itself (verified
 * against `@radix-ui/react-dropdown-menu@2.1.21`), so the menu had neither a
 * clamp nor a scrollbar.
 *
 * That stayed invisible while every item was a single short line. Switching
 * the archetype descriptions to the `ARCHETYPES` registry made them up to ~104
 * characters inside a fixed `w-64`, so the items wrapped and the list grew to
 * roughly 740px — taller than the space above a top-of-page trigger. The tail
 * of the list rendered off-screen with no way to scroll to it.
 *
 * The invariant worth locking is the clamp itself: any menu content in this app
 * must be able to scroll when the viewport is short.
 */
describe('DropdownMenuContent — viewport clamping', () => {
  function renderMenu() {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>abrir</DropdownMenuTrigger>
        <DropdownMenuContent data-testid="menu">
          {Array.from({ length: 30 }, (_, i) => (
            <DropdownMenuItem key={i}>opción {i}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
    return screen.getByTestId('menu');
  }

  it('clamps its height to the space Radix says is available', () => {
    const menu = renderMenu();
    expect(menu.className).toContain(
      'max-h-[var(--radix-dropdown-menu-content-available-height)]',
    );
  });

  it('can scroll when the content exceeds the clamp', () => {
    const menu = renderMenu();
    // `overflow-hidden` clips silently; a scrollable axis must be declared or
    // the overflow content is simply unreachable.
    expect(menu.className).toContain('overflow-y-auto');
  });

  it('still clips to the rounded corners', () => {
    const menu = renderMenu();
    expect(menu.className).toContain('overflow-hidden');
  });

  it('uses the DropdownMenu variant of the Radix variable, not Select or Menu', () => {
    // The three Radix primitives each publish a different variable name.
    // Copying the wrong one yields a class that resolves to nothing and
    // silently restores the bug.
    const menu = renderMenu();
    expect(menu.className).not.toContain('--radix-menu-content-available-height');
    expect(menu.className).not.toContain('--radix-select-content-available-height');
  });
});
