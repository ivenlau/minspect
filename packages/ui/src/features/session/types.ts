import type { HunkData } from '../../components/Hunk';

export interface ReviewEdit {
  id: string;
  file_path: string;
  before_hash: string | null;
  after_hash: string;
  git_head: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_call_explanation: string | null;
  hunks: HunkData[];
}

export interface Badge {
  id: string;
  label: string;
  level: 'info' | 'warn' | 'danger';
  detail?: string;
}

export interface ReviewTurn {
  id: string;
  idx: number;
  user_prompt: string;
  agent_reasoning: string | null;
  agent_final_message: string | null;
  started_at: number;
  ended_at: number | null;
  edits: ReviewEdit[];
  badges: Badge[];
}

export interface ReviewResp {
  agent: string | null;
  turns: ReviewTurn[];
}
