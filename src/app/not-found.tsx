import Link from 'next/link';

import { CenteredCard, primaryButton } from '@/components/ui/CenteredCard';

export default function NotFound() {
  return (
    <CenteredCard title="404 · Page not found" body="The page you're looking for doesn't exist.">
      <Link href="/" className={primaryButton}>
        Return home
      </Link>
    </CenteredCard>
  );
}
