export type Verdict = "keep" | "speculative" | "reject";
export type Confidence = "confirmed" | "speculative" | "hidden";

export interface VerifiedReference {
  timestamp_s: number;
  source_frame_id: string;
  work_title: string;
  work_creator: string;
  work_year: number | null;
  work_type: string;
  reasoning: string;
  raw_confidence: number;
  verdict: Verdict;
  final_confidence: Confidence;
  supporting_elements: string[];
  wikipedia_url: string | null;
  wikipedia_thumbnail_url?: string | null;
}

export interface FrameAnalysis {
  timestamp_s: number;
  frame_id: string;
  composition: string;
  palette: string[];
  palette_hex?: string[];
  camera_move: string;
  costume_setting: string;
  distinctive_features: string[];
  raw_description: string;
  confidence_in_observation: number;
}

export interface Report {
  youtube_id: string;
  title: string;
  channel: string;
  duration_s: number;
  references: VerifiedReference[];
  frame_analyses: FrameAnalysis[];
  created_at?: string;
}

export type PipelineStep =
  | "ingest" | "shots" | "vision" | "crossref" | "verify" | "done" | "error";

export interface PipelineEvent {
  step: PipelineStep;
  message: string;
  progress: number;
  payload: Record<string, unknown>;
}
