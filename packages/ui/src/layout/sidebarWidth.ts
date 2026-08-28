import { createContext, useContext } from 'react';

// Current sidebar pixel width, provided by ThreePane (which owns the
// Resizer state). Lets sidebar content adapt density — e.g. the session
// rows show full dates once there's room. Defaults to the CSS default so
// consumers render sensibly outside a ThreePane (tests, storybook-ish use).
export const SidebarWidthContext = createContext<number>(240);

export function useSidebarWidth(): number {
  return useContext(SidebarWidthContext);
}

// Below this width the session rows stick to `HH:MM`; the 16-char
// `YYYY-MM-DD HH:MM` mono string plus id + agent tag needs ~340px.
export const WIDE_SIDEBAR_PX = 340;
