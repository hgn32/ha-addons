// server.js の computeViewState() が返す形。

export type FlowPhase =
  | "idle"
  | "starting"
  | "waiting"
  | "submitting"
  | "retrying"
  | "finishing";

export type RunSource = "" | "schedule" | "manual" | "verify";

export interface Notice {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

export interface AccountView {
  slug: string;
  name: string;
  scheduleTime: string;
  token: { present: boolean; daysLeft: number | null; length: number };
  busy: boolean;
  flow: {
    active: boolean;
    phase: FlowPhase;
    url: string;
    urlRotated: boolean;
    error: string;
    /** CLI の画面（診断用。トークンは伏せてある） */
    screen: string;
  };
  run: {
    running: boolean;
    at: string;
    ok: boolean | null;
    source: RunSource;
    summary: string;
    detail: string;
  };
  notice: Notice | null;
}

export interface ViewState {
  notifyEnabled: boolean;
  notifyProblem: string;
  accounts: AccountView[];
}
