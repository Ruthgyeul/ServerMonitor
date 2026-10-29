// Client for /api/alerts/mute. `null` minutes clears every mute.
export async function setMute(minutes: number | null): Promise<boolean> {
  try {
    const response = await fetch('/api/alerts/mute', {
      method: minutes === null ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: minutes === null ? undefined : JSON.stringify({ minutes })
    });
    return response.ok;
  } catch {
    return false;
  }
}
