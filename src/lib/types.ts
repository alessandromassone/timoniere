export type CoverPageKind = "cover_3" | "cover_4" | "cover_1" | "cover_2";
export type LegacyCoverPageKind = "cover_front" | "cover_back";
export type PageKind = CoverPageKind | LegacyCoverPageKind | "content";

export type Issue = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type EditorialStatus = {
  id: string;
  issue_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

export type Article = {
  id: string;
  issue_id: string;
  title: string;
  match_key: string;
  assignee: string;
  character_count: number | null;
  status_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MagazinePage = {
  id: string;
  issue_id: string;
  article_id: string | null;
  position: number;
  kind: PageKind;
  title: string;
  assignee: string;
  character_count: number | null;
  status_id: string | null;
  warning_enabled: boolean;
  warning_note: string | null;
  created_at: string;
  updated_at: string;
};

export type PageDraft = Pick<
  MagazinePage,
  "title" | "assignee" | "character_count" | "status_id" | "warning_enabled" | "warning_note"
>;
