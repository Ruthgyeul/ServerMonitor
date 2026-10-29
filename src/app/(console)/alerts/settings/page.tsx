import { redirect } from 'next/navigation';

// Alert thresholds moved under Configure; keep old links and bookmarks working.
export default function AlertSettingsRedirect() {
  redirect('/settings/rules');
}
