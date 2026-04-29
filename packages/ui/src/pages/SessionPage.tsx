import { ReplayPage } from './ReplayPage';
import { ReviewPage } from './ReviewPage';
import { SessionFilesPage } from './SessionFilesPage';
import { SessionOverviewPage } from './SessionOverviewPage';

export interface SessionPageProps {
  workspace: string;
  session: string;
  tab: 'overview' | 'review' | 'replay' | 'files';
}

// Thin dispatcher — the shell's tab bar (in App.tsx's TopBar) already
// handles navigation between tabs. We just render the appropriate page.
export function SessionPage({ workspace, session, tab }: SessionPageProps) {
  switch (tab) {
    case 'review':
      return <ReviewPage workspace={workspace} session={session} />;
    case 'replay':
      return <ReplayPage workspace={workspace} session={session} />;
    case 'overview':
      return <SessionOverviewPage workspace={workspace} session={session} />;
    case 'files':
      return <SessionFilesPage workspace={workspace} session={session} />;
    default:
      return null;
  }
}
