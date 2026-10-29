'use client';

import { useEffect } from 'react';
import { FallbackProps } from 'react-error-boundary';

import { CenteredCard, primaryButton } from '@/components/ui/CenteredCard';

export default function Error({ error, resetErrorBoundary }: FallbackProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <CenteredCard title="Something went wrong" body="The dashboard hit an unexpected error.">
      <button onClick={resetErrorBoundary} className={primaryButton}>
        Try again
      </button>
    </CenteredCard>
  );
}
