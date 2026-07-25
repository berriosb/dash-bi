import * as React from 'react';
import { cn } from '@/lib/cn';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/60', className)}
      aria-busy="true"
      aria-live="polite"
      {...props}
    />
  );
}

export { Skeleton };