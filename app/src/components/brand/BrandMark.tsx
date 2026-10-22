import { cn } from '@/lib/cn';

/**
 * Marca de dash-bi — "Escalones", variante 02.
 *
 * Un perfil escalonado dibujado con un trazo continuo de 9 px sobre una
 * rejilla de 48, cerrado por un nodo circular. El trazo usa el token
 * `primary` y el nodo el `accent`, así que el mark hereda solo el color
 * del tema (claro, oscuro o corporate) sin duplicar tokens.
 *
 * Las tres variantes existen para tres contextos distintos:
 *
 * - `color`  — el mark de la app. Nodo en `accent`.
 * - `mono`   — un solo tono. Para superficies donde el color no existe.
 * - `current` — hereda el color del texto. Para impresión, donde el mark
 *   tiene que salir en la tinta del documento y no en el tema de la app.
 *
 * La geometría está fijada por `tests/unit/components/brand/BrandMark.test.tsx`:
 * cambiarla es un cambio de marca, no un refactor.
 */
export type BrandMarkVariant = 'color' | 'mono' | 'current';

export type BrandMarkProps = {
  /** Lado del cuadrado, en píxeles. */
  size?: number;
  variant?: BrandMarkVariant;
  className?: string;
  /**
   * Nombre accesible. Si se omite, el mark es decorativo (`aria-hidden`),
   * que es lo correcto porque el nombre de la marca siempre lo acompaña.
   */
  title?: string;
};

const STROKE: Record<BrandMarkVariant, string> = {
  color: 'hsl(var(--color-primary-hsl))',
  mono: 'hsl(var(--color-primary-hsl))',
  current: 'currentColor',
};

const NODE: Record<BrandMarkVariant, string> = {
  color: 'hsl(var(--color-accent-hsl))',
  mono: 'hsl(var(--color-primary-hsl))',
  current: 'currentColor',
};

export function BrandMark({
  size = 28,
  variant = 'color',
  className,
  title,
}: BrandMarkProps) {
  const decorative = title === undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('inline-block shrink-0', className)}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M12 34V14H25V25H30"
        fill="none"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: STROKE[variant] }}
      />
      <circle cx={35} cy={25} r={6} style={{ fill: NODE[variant] }} />
    </svg>
  );
}
