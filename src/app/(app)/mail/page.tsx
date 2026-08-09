import Link from "next/link";
import { requireSession } from "@/lib/auth-helpers";
import { kstDateOf } from "@/lib/attendance";
import { GraphError } from "@/lib/graph/client";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import {
  getMailFolders,
  getMessage,
  getMessages,
  isMailFolderKey,
  MAIL_FOLDERS,
  type MailDetail,
  type MailFolderKey,
  type MailRecipient,
} from "@/lib/graph/mail";
import {
  Avatar,
  Card,
  FileTypeIcon,
  PageHeader,
  SourceChip,
} from "@/components/ui";

export const metadata = { title: "메일" };

// 메일 3패널 읽기(B1, R8.1) — 위임 Mail.Read. 폴더·메일 선택은 searchParams
// (?folder=, ?sel=) Link 전환. 답장·전달·쓰기는 전부 Outlook 딥링크 위임(쓰기 스코프 없음).
// 본문 HTML은 XSS 위험이 있어 렌더하지 않는다 — Prefer 헤더로 받은 text를 평문 출력.

const KST = "Asia/Seoul";
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 목록 시각 — 오늘(KST)이면 HH:mm, 아니면 M/D */
function listTimeLabel(iso: string, todayKst: string): string {
  const d = new Date(iso);
  const dateKst = kstDateOf(d);
  if (dateKst === todayKst) {
    return d.toLocaleTimeString("en-GB", {
      timeZone: KST,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return `${Number(dateKst.slice(5, 7))}/${Number(dateKst.slice(8, 10))}`;
}

/** 본문 시각 — "YYYY-MM-DD (요일) HH:mm" (KST) */
function detailTimeLabel(iso: string): string {
  const d = new Date(iso);
  const dateKst = kstDateOf(d);
  const dow = WEEKDAY[new Date(`${dateKst}T00:00:00Z`).getUTCDay()];
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateKst} (${dow}) ${time}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function extOf(name: string | null): string {
  const dot = name?.lastIndexOf(".") ?? -1;
  return dot > 0 ? name!.slice(dot + 1) : "";
}

function personLabel(r: MailRecipient | null | undefined): string {
  return r?.emailAddress?.name?.trim() || r?.emailAddress?.address || "(발신자 없음)";
}

function graphErrorLabel(e: unknown): string {
  return e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류";
}

const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[13px] font-medium transition hover:bg-canvas";

export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; sel?: string }>;
}) {
  await requireSession();
  const { folder: folderParam, sel } = await searchParams;
  const folder: MailFolderKey =
    folderParam && isMailFolderKey(folderParam) ? folderParam : "inbox";
  const folderLabel = MAIL_FOLDERS.find((f) => f.key === folder)!.label;
  const today = kstDateOf(new Date());

  const header = (
    <PageHeader
      title="메일"
      subtitle={<SourceChip brand="outlook">Outlook 연동 · Mail.Read</SourceChip>}
      actions={
        <>
          <a
            href="https://outlook.office.com/mail/"
            target="_blank"
            rel="noopener noreferrer"
            className={SECONDARY_BTN}
          >
            Outlook에서 열기
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3 text-ink-muted"
              aria-hidden
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6M10 14 21 3" />
            </svg>
          </a>
          <a
            href="https://outlook.office.com/mail/deeplink/compose"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
          >
            메일 쓰기
          </a>
        </>
      }
    />
  );

  // 강등 1 — 위임 토큰 없음(스코프 확장 전 구세션): 재로그인 안내, 페이지는 계속 동작
  const token = await getDelegatedGraphToken();
  if (!token) {
    return (
      <div>
        {header}
        <Card className="mt-5 border-dashed p-6 text-sm text-ink-secondary">
          메일을 보려면 <span className="font-semibold">다시 로그인</span>이
          필요합니다 — 로그인 시 Microsoft 동의 화면에서 메일 읽기 권한을 승인해
          주세요 (사이드바 하단 로그아웃 → 재로그인)
        </Card>
      </div>
    );
  }

  // 폴더·목록·(선택 시) 본문을 병렬 조회 — 본문 실패는 본문 패널 안에서만 강등
  const [listResult, detailResult] = await Promise.all([
    Promise.all([getMailFolders(token), getMessages(token, folder)]).then(
      ([folders, messages]) => ({ ok: true as const, folders, messages }),
      (e: unknown) => ({ ok: false as const, error: graphErrorLabel(e) }),
    ),
    sel
      ? getMessage(token, sel).then(
          (detail) => ({ ok: true as const, detail }),
          (e: unknown) => ({ ok: false as const, error: graphErrorLabel(e) }),
        )
      : null,
  ]);

  // 강등 2 — Graph 오류: 오류 카드
  if (!listResult.ok) {
    return (
      <div>
        {header}
        <Card className="mt-5 border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">메일 조회에 실패했습니다</p>
          <p className="mt-1">{listResult.error}</p>
        </Card>
      </div>
    );
  }
  const { folders, messages } = listResult;

  return (
    <div>
      {header}
      {/* 3패널 단일 카드 — 폴더 176px / 목록 336px / 본문 flex */}
      <Card className="mt-5 flex h-[calc(100vh-172px)] min-h-[520px] overflow-hidden">
        {/* 폴더 패널 */}
        <nav className="flex w-44 flex-none flex-col gap-0.5 p-3">
          {MAIL_FOLDERS.map(({ key, label }) => {
            const meta = folders.find((f) => f.key === key);
            const active = key === folder;
            // 카운트: 받은편지함=안읽음(파랑), 임시 보관함=보관 건수(무채색)
            const count =
              key === "inbox"
                ? (meta?.unreadItemCount ?? 0)
                : key === "drafts"
                  ? (meta?.totalItemCount ?? 0)
                  : 0;
            return (
              <Link
                key={key}
                href={`/mail?folder=${key}`}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition ${
                  active ? "bg-fill font-semibold" : "text-ink-sub hover:bg-canvas"
                }`}
              >
                {label}
                {count > 0 && (
                  <span
                    className={
                      key === "inbox"
                        ? "text-[11px] font-semibold text-blue-600"
                        : "text-[11px] text-ink-muted"
                    }
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* 목록 패널 */}
        <div className="flex min-h-0 w-[336px] flex-none flex-col border-x border-fill">
          <div className="flex items-center justify-between border-b border-fill px-3.5 py-3">
            <span className="text-[13px] font-semibold">{folderLabel}</span>
            <span className="text-[11px] text-ink-muted">최신순</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-muted">
                이 폴더에는 메일이 없습니다
              </p>
            ) : (
              messages.map((m) => {
                const unread = !m.isRead;
                const selected = m.id === sel;
                return (
                  <Link
                    key={m.id}
                    href={`/mail?folder=${folder}&sel=${encodeURIComponent(m.id)}`}
                    className={`block border-b border-fill px-3.5 py-2.5 transition ${
                      selected ? "bg-fill" : "hover:bg-canvas"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* 안읽음 점 6px — 읽은 메일은 투명 점으로 정렬 유지 */}
                      <span
                        className={`h-1.5 w-1.5 flex-none rounded-full ${
                          unread ? "bg-blue-600" : "bg-transparent"
                        }`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${
                          unread ? "font-semibold" : ""
                        }`}
                      >
                        {personLabel(m.from)}
                      </span>
                      {m.hasAttachments && (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3 w-3 flex-none text-ink-muted"
                          aria-label="첨부 있음"
                        >
                          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                      )}
                      <span className="flex-none text-[11px] text-ink-muted">
                        {listTimeLabel(m.receivedDateTime, today)}
                      </span>
                    </div>
                    <p
                      className={`ml-3.5 mt-0.5 truncate text-[13px] ${
                        unread ? "font-semibold" : ""
                      }`}
                    >
                      {m.subject?.trim() || "(제목 없음)"}
                    </p>
                    <p className="ml-3.5 mt-0.5 truncate text-xs text-ink-muted">
                      {m.bodyPreview ?? ""}
                    </p>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* 본문 패널 */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {!detailResult ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-muted">
              목록에서 메일을 선택하세요
            </div>
          ) : !detailResult.ok ? (
            <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <p className="font-semibold">메일 본문을 불러오지 못했습니다</p>
              <p className="mt-1">{detailResult.error}</p>
            </Card>
          ) : (
            <MailBody detail={detailResult.detail} />
          )}
        </div>
      </Card>
    </div>
  );
}

/** 본문 패널 — 제목 → 발신자 메타 → 평문 본문 → 첨부 칩(표시만) → 딥링크 액션 */
function MailBody({ detail }: { detail: MailDetail }) {
  const sender = detail.from?.emailAddress;
  const senderName = personLabel(detail.from);
  const to = (detail.toRecipients ?? [])
    .map((r) => r.emailAddress?.name?.trim() || r.emailAddress?.address || "")
    .filter(Boolean)
    .join(", ");
  // Prefer 헤더로 text 본문을 받았으므로 평문 그대로 출력(줄바꿈은 pre-wrap으로 유지)
  const text = detail.body?.content?.replace(/\r\n/g, "\n").trim() ?? "";
  const attachments = (detail.attachments ?? []).filter((a) => !a.isInline);

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-[-0.01em]">
        {detail.subject?.trim() || "(제목 없음)"}
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Avatar name={senderName} size="md" />
        <div className="min-w-0">
          <p className="text-sm">
            <span className="font-semibold">{senderName}</span>
            {sender?.address && (
              <span className="ml-1.5 text-xs text-ink-muted">
                &lt;{sender.address}&gt;
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            받는 사람: {to || "—"}
          </p>
        </div>
        <span className="ml-auto text-xs text-ink-muted">
          {detailTimeLabel(detail.receivedDateTime)}
        </span>
      </div>

      <div className="mt-4 whitespace-pre-wrap border-t border-fill pt-4 text-sm leading-[1.75] text-ink-body">
        {text || "(본문 없음)"}
      </div>

      {attachments.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
            >
              <FileTypeIcon ext={extOf(a.name)} size={24} />
              <span>
                <span className="block text-[13px] font-medium">
                  {a.name ?? "첨부 파일"}
                </span>
                {a.size != null && (
                  <span className="block text-[11px] text-ink-muted">
                    {formatSize(a.size)}
                  </span>
                )}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* 답장·전달 — 쓰기 스코프 없이 webLink 딥링크로 Outlook에 위임 */}
      {detail.webLink && (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            <a
              href={detail.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className={SECONDARY_BTN}
            >
              답장
            </a>
            <a
              href={detail.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className={SECONDARY_BTN}
            >
              전달
            </a>
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            답장·전달은 Outlook 웹에서 이 메일을 열어 진행합니다
          </p>
        </div>
      )}
    </div>
  );
}
