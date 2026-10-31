import { describe, expect, it } from 'vitest';
import { CHAT_LIVE, CHAT_URL, PAGES } from '../src/lib/site';

// The marketing site and the chat app are two Workers on two origins.
describe('marketing site links', () => {
  it('sends people to the app on its own origin, never to a path on this site', () => {
    expect(CHAT_URL).toBe('https://shamwari.ai/chat/');
  });

  it('shows no "Open chat" link until the app is released', () => {
    expect(CHAT_LIVE).toBe(false); // the build flag PUBLIC_CHAT_LIVE=true is the release switch
  });

  it('has no internal chat page in its navigation', () => {
    expect(PAGES.some((p) => !p.external && p.path.includes('chat'))).toBe(false);
  });
});
